import { lookup } from "node:dns/promises";
import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { domainToASCII } from "node:url";

export const MAX_RESPONSE_BYTES = 5_000_000;
export const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

export type ResolvedAddress = {
  address: string;
  family: number;
};

export type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>;
export type SafeRequest = (
  url: URL,
  init: RequestInit,
  approvedAddresses: readonly ResolvedAddress[]
) => Promise<Response>;

export type FetchPolicy = {
  allowedHosts: readonly string[];
  resolve?: ResolveHost;
  request?: SafeRequest;
};

export type SafeFetchInput = { url: string };

const defaultResolve: ResolveHost = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

const defaultRequest = createPinnedRequest();

export function createPinnedRequest(
  requestImpl: typeof httpsRequest = httpsRequest
): SafeRequest {
  return async (url, init, approvedAddresses) => {
    if (url.protocol !== "https:" || url.port !== "") {
      throw new Error("request blocked: pinned transport requires HTTPS port 443");
    }
    const approved = approvedAddresses.filter(
      (entry): entry is ResolvedAddress & { family: 4 | 6 } =>
        (entry.family === 4 || entry.family === 6) &&
        isIP(entry.address) === entry.family &&
        !isForbiddenIp(entry.address)
    );
    if (approved.length === 0) throw new Error("request blocked: no approved address");

    return new Promise<Response>((resolve, reject) => {
      const requestOptions: RequestOptions = {
        protocol: "https:",
        hostname: url.hostname,
        port: 443,
        method: "GET",
        path: `${url.pathname}${url.search}`,
        servername: url.hostname,
        agent: false,
        headers: { connection: "close", "accept-encoding": "identity" },
        lookup: (_hostname, options, callback) => {
          const requestedFamily = typeof options === "number" ? options : options.family;
          const selected = approved.find(
            ({ family }) =>
              requestedFamily === undefined || requestedFamily === 0 || requestedFamily === family
          );
          if (selected === undefined) {
            callback(
              new Error("request blocked: no approved address for requested family"),
              "",
              4
            );
            return;
          }
          if (typeof options !== "number" && options.all === true) {
            callback(null, approved);
            return;
          }
          callback(null, selected.address, selected.family);
        }
      };
      if (init.signal !== null && init.signal !== undefined) requestOptions.signal = init.signal;

      const request = requestImpl(
        requestOptions,
        (incoming) => {
          try {
            const status = incoming.statusCode;
            if (status === undefined || status < 200 || status > 599) {
              incoming.destroy();
              reject(new Error("request blocked: invalid response status"));
              return;
            }
            const body = status === 204 || status === 304
              ? null
              : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
            const responseInit: ResponseInit = {
              status,
              headers: toWebHeaders(incoming.headers)
            };
            if (incoming.statusMessage !== undefined) {
              responseInit.statusText = incoming.statusMessage;
            }
            resolve(new Response(body, responseInit));
          } catch (error) {
            incoming.destroy();
            reject(new Error("request blocked: malformed response", { cause: error }));
          }
        }
      );
      request.once("error", reject);
      request.end();
    });
  };
}

export async function safeFetch(input: SafeFetchInput, policy: FetchPolicy): Promise<Response> {
  const allowedHosts = normalizeAllowedHosts(policy.allowedHosts);
  const resolve = policy.resolve ?? defaultResolve;
  const request = policy.request ?? defaultRequest;
  let current = parseTarget(input.url, false);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const redirectContext = hop > 0;
    const hostname = validateTarget(current, allowedHosts, redirectContext);
    const addresses = await resolveAndValidate(resolve, hostname, redirectContext);
    let response: Response;

    try {
      response = await request(
        current,
        { redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        addresses
      );
    } catch (error) {
      throw new Error(`${redirectContext ? "redirect " : ""}request blocked`, { cause: error });
    }

    if (isRedirect(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      if (hop === MAX_REDIRECTS) throw new Error("redirect limit exceeded");

      let location: string | null;
      try {
        location = response.headers.get("location");
      } catch (error) {
        throw new Error("redirect blocked: malformed headers", { cause: error });
      }
      if (!location) throw new Error("redirect blocked: missing location");
      current = parseTarget(location, true, current);
      continue;
    }

    try {
      enforceContentLength(response.headers, MAX_RESPONSE_BYTES);
    } catch (error) {
      await response.body?.cancel().catch(() => undefined);
      throw error;
    }
    return bufferResponse(response, MAX_RESPONSE_BYTES);
  }

  throw new Error("redirect limit exceeded");
}

function parseTarget(value: string, redirect: boolean, base?: URL): URL {
  try {
    const parsed = base === undefined ? new URL(value) : new URL(value, base);
    if (parsed.username || parsed.password) throw new Error("credentials are forbidden");
    return parsed;
  } catch (error) {
    throw new Error(`${redirect ? "redirect " : ""}blocked URL`, { cause: error });
  }
}

function validateTarget(current: URL, allowedHosts: ReadonlySet<string>, redirect: boolean): string {
  if (current.protocol !== "https:") {
    throw new Error(`${redirect ? "redirect " : ""}blocked protocol`);
  }
  if (current.port !== "") {
    throw new Error(`${redirect ? "redirect " : ""}blocked port`);
  }

  const hostname = normalizeHostname(current.hostname);
  if (!allowedHosts.has(hostname)) {
    throw new Error(`${redirect ? "redirect " : ""}blocked host`);
  }
  return hostname;
}

function normalizeAllowedHosts(hosts: readonly string[]): ReadonlySet<string> {
  const normalized = new Set<string>();
  for (const host of hosts) normalized.add(normalizeHostname(host));
  return normalized;
}

function normalizeHostname(host: string): string {
  const withoutFinalDot = host.trim().replace(/\.$/, "");
  const ascii = domainToASCII(withoutFinalDot).toLowerCase();
  if (
    ascii.length === 0 ||
    ascii.length > 253 ||
    ascii.includes("..") ||
    !/^[a-z0-9.-]+$/.test(ascii)
  ) {
    throw new Error("blocked host");
  }
  return ascii;
}

async function resolveAndValidate(
  resolve: ResolveHost,
  hostname: string,
  redirect: boolean
): Promise<ResolvedAddress[]> {
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolve(hostname);
  } catch (error) {
    throw new Error(`${redirect ? "redirect " : ""}DNS blocked`, { cause: error });
  }

  if (addresses.length === 0) {
    throw new Error(`${redirect ? "redirect " : ""}DNS blocked: no addresses`);
  }
  if (
    addresses.some(
      ({ address, family }) => (family !== 4 && family !== 6) || isForbiddenIp(address)
    )
  ) {
    throw new Error(`${redirect ? "redirect " : ""}blocked address`);
  }
  return addresses.map(({ address, family }) => ({ address, family }));
}

export function isForbiddenIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isForbiddenIpv4(address);
  if (family !== 6) return true;

  const words = parseIpv6(address);
  if (words === undefined) return true;

  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return isForbiddenIpv4(wordsToIpv4(words[6] ?? 0, words[7] ?? 0));
  }

  const ipv4Compatible = words.slice(0, 6).every((word) => word === 0);
  const nat64WellKnown = words[0] === 0x0064 && words[1] === 0xff9b && words[2] === 0;
  const nat64Local = words[0] === 0x0064 && words[1] === 0xff9b && words[2] === 1;
  const first = words[0] ?? 0;
  const outsideGlobalUnicast = (first & 0xe000) !== 0x2000;
  const protocolAssignments = first === 0x2001 && (words[1] ?? 0) <= 0x01ff;
  const documentation = first === 0x2001 && words[1] === 0x0db8;
  const documentationV2 = first === 0x3fff && ((words[1] ?? 0) & 0xf000) === 0;
  const sixToFour = first === 0x2002;
  return (
    ipv4Compatible ||
    nat64WellKnown ||
    nat64Local ||
    outsideGlobalUnicast ||
    protocolAssignments ||
    documentation ||
    documentationV2 ||
    sixToFour
  );
}

function isForbiddenIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }
  const [a = 0, b = 0, c = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function parseIpv6(address: string): number[] | undefined {
  const lower = address.toLowerCase();
  const halves = lower.split("::");
  if (halves.length > 2) return undefined;

  const left = parseIpv6Part(halves[0] ?? "");
  const right = parseIpv6Part(halves[1] ?? "");
  if (left === undefined || right === undefined) return undefined;
  if (halves.length === 1) return left.length === 8 ? left : undefined;

  const missing = 8 - left.length - right.length;
  if (missing < 1) return undefined;
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

function parseIpv6Part(part: string): number[] | undefined {
  if (part === "") return [];
  const words: number[] = [];
  const pieces = part.split(":");
  for (const [index, piece] of pieces.entries()) {
    if (piece.includes(".")) {
      if (index !== pieces.length - 1 || isIP(piece) !== 4) return undefined;
      const octets = piece.split(".").map(Number);
      words.push(((octets[0] ?? 0) << 8) | (octets[1] ?? 0));
      words.push(((octets[2] ?? 0) << 8) | (octets[3] ?? 0));
    } else {
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return undefined;
      words.push(Number.parseInt(piece, 16));
    }
  }
  return words;
}

function wordsToIpv4(high: number, low: number): string {
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function enforceContentLength(headers: Headers, maximum: number): void {
  let value: string | null;
  try {
    value = headers.get("content-length");
  } catch (error) {
    throw new Error("blocked malformed response headers", { cause: error });
  }
  if (value === null) return;
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error("blocked malformed Content-Length");
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw new Error("blocked malformed Content-Length");
  if (length > maximum) throw new Error("response too large");
}

async function bufferResponse(response: Response, maximum: number): Promise<Response> {
  if (response.body === null) {
    return new Response(null, responseInit(response));
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel().catch(() => undefined);
        throw new Error("response too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, responseInit(response));
}

function responseInit(response: Response): ResponseInit {
  return { status: response.status, statusText: response.statusText, headers: response.headers };
}

function toWebHeaders(source: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}
