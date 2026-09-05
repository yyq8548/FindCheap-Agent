import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { safeFetchWithProvenance } from "../../../packages/network-safety/src/safe-fetch.js";
import { parseWebProductDocument } from "./generic-official-store-search.js";
import type { SearchProductsInput } from "./search-products.js";
import type { ShopifyProduct } from "./shopify-client.js";
import { functionalQueryFeatures } from "./functional-requirements.js";
import { buildVisualRetrievalQuery } from "./visual-retrieval-query.js";

export const WEB_SEARCH_LIMITS = { durationMs: 60_000, merchantPages: 5, results: 3, discoveryQueries: 2 } as const;
const blockedHosts = ["google.com", "bing.com", "duckduckgo.com", "yahoo.com", "t.co", "bit.ly", "tinyurl.com"];

export function webProductUrl(value: string): string {
  const url = new URL(value);
  const path = decodeURIComponent(url.pathname);
  // eslint-disable-next-line no-control-regex -- URL normalization must not hide control characters.
  if (/[\u0000-\u0020\\]/u.test(value) || /[%\\]/u.test(path) || url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
    !url.hostname.includes(".") || url.hostname.endsWith(".") || isIP(url.hostname.replace(/^\[|\]$/gu, "")) ||
    path === "/" || /(?:^|\/)(?:search|collections?|categories|cart|checkout|accounts?|login|logout|admin|api)(?:\/|$)/iu.test(path) ||
    blockedHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) ||
    [...url.searchParams.keys()].some(key => !["variant", "size", "color", "type"].includes(key)) ||
    [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) throw new Error("WEB_URL_REJECTED");
  return url.href;
}

export const WebProductUrlSchema = z.string().max(4096).refine(value => {
  try { webProductUrl(value); return true; } catch { return false; }
}, "Use an exact credential-free HTTPS merchant product URL");

export type WebProductPagePort = { read(url: string, request: SearchProductsInput, signal: AbortSignal): Promise<ShopifyProduct> };
export function createWebProductPagePort(fetchPage = safeFetchWithProvenance): WebProductPagePort {
  return { async read(value, request, signal) {
    const url = webProductUrl(value);
    let requests = 0;
    const fetched = await fetchPage({ url }, { allowedHosts: [new URL(url).hostname], signal,
      maxResponseBytes: 1024 * 1024, onRead: delta => {
        requests += delta.requests ?? 0;
        if (requests > 1) throw new Error("WEB_REDIRECT_REJECTED");
      } });
    if (!fetched.response.ok || fetched.finalUrl !== url ||
      !/^text\/html(?:;|$)/iu.test(fetched.response.headers.get("content-type") ?? "")) throw new Error("WEB_PAGE_UNAVAILABLE");
    const bytes = new Uint8Array(await fetched.response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 1024 * 1024) throw new Error("WEB_PAGE_UNAVAILABLE");
    // Exact URL binds the offer; all requested colors (including disjunctions)
    // are evaluated by the shared requirement gate after parsing.
    return parseWebProductDocument(new TextDecoder("utf-8", { fatal: true }).decode(bytes), url, new Date(), request.requiredSize);
  } };
}

export const WebConsentStatusSchema = z.enum(["READY", "PERMISSION_DENIED", "PERMISSION_CANCELLED",
  "PERMISSION_UNAVAILABLE", "PERMISSION_TIMEOUT", "PERMISSION_ERROR", "APPROVAL_PENDING", "ALREADY_USED", "EXPIRED", "RETRY_LIMIT_REACHED"]);
type ConsentStatus = z.infer<typeof WebConsentStatusSchema>;
type ConsentResult = { status: ConsentStatus; retryable: boolean; attempt: number; token?: string; deadline?: number };
type Lease = { token: string; deadline: number; status: ConsentStatus; attempt: number; retryable: boolean };
/** One admission per immutable snapshot, at most two consent attempts after
 * classified transient errors. Never accept a
 * model-supplied boolean as permission; approval comes from the host UI. */
export class WebRecoverySessions {
  readonly #leases = new Map<string, Lease>();
  constructor(private readonly now: () => number = Date.now) {}
  forget(renderId: string): void { this.#leases.delete(renderId); }
  async begin(renderId: string, approve: () => Promise<"ACCEPT" | "DECLINE" | "CANCEL">): Promise<ConsentResult> {
    const previous = this.#leases.get(renderId);
    if (previous !== undefined && !previous.retryable) {
      const status = previous.status === "READY" ? previous.deadline <= this.now() ? "EXPIRED" : "ALREADY_USED" : previous.status;
      return { status, retryable: false, attempt: previous.attempt };
    }
    if ((previous?.attempt ?? 0) >= 2 || (previous === undefined && this.#leases.size >= 64)) {
      return { status: "RETRY_LIMIT_REACHED", retryable: false, attempt: previous?.attempt ?? 0 };
    }
    const lease: Lease = { token: randomUUID(), deadline: 0, status: "APPROVAL_PENDING", attempt: (previous?.attempt ?? 0) + 1, retryable: false };
    this.#leases.set(renderId, lease);
    try {
      const answer = await approve();
      lease.status = answer === "ACCEPT" ? "READY" : answer === "DECLINE" ? "PERMISSION_DENIED" : "PERMISSION_CANCELLED";
    } catch (error) {
      const code = error instanceof McpError ? error.code : undefined;
      lease.status = code === ErrorCode.RequestTimeout ? "PERMISSION_TIMEOUT"
        : code === ErrorCode.MethodNotFound ? "PERMISSION_UNAVAILABLE" : "PERMISSION_ERROR";
      lease.retryable = lease.attempt < 2 && (code === ErrorCode.RequestTimeout || code === ErrorCode.ConnectionClosed || code === ErrorCode.InternalError);
    }
    if (this.#leases.get(renderId) !== lease) return { status: "EXPIRED", retryable: false, attempt: lease.attempt };
    if (lease.status !== "READY") return { status: lease.status, retryable: lease.retryable, attempt: lease.attempt };
    lease.deadline = this.now() + WEB_SEARCH_LIMITS.durationMs;
    return { ...lease };
  }
  consume(renderId: string, token: string): number | undefined {
    const lease = this.#leases.get(renderId);
    if (lease?.status !== "READY" || lease.token !== token) return undefined;
    const remaining = lease.deadline - this.now();
    lease.status = remaining > 0 ? "ALREADY_USED" : "EXPIRED";
    return remaining > 0 ? remaining : undefined;
  }
}

export function webSearchQueries(request: SearchProductsInput): string[] {
  if (request.visualInput !== undefined) {
    // Never include imageUrl/source bytes. This authorization covers only
    // textual discovery and the subsequent read of explicit merchant pages.
    return [...new Set([false, true].map(relaxed => buildVisualRetrievalQuery(request.visualInput!, {
      ...(request.brand === undefined ? {} : { brand: request.brand }),
      ...(request.productType === undefined ? {} : { productType: request.productType }), relaxed
    })).filter(Boolean))].slice(0, WEB_SEARCH_LIMITS.discoveryQueries);
  }
  const identity = [request.brand, request.query, request.productType && !request.query.toLowerCase().includes(request.productType.toLowerCase()) ? request.productType : undefined].filter(Boolean).join(" ");
  const features = functionalQueryFeatures(request.requiredFeatures);
  const secondary = request.requiredFeatures.flatMap(value => functionalQueryFeatures([value])).find(value => !features.includes(value));
  return [...new Set([`${identity} ${features.join(" ")}`, `${identity} ${[...features, secondary].filter(Boolean).join(" ")}`]
    .map(value => value.replace(/\s+/gu, " ").trim().slice(0, 300)))];
}

export async function readWebCandidates(urls: readonly string[], request: SearchProductsInput, port: WebProductPagePort,
  durationMs: number): Promise<{ products: ShopifyProduct[]; rejected: number; unavailable: number }> {
  if (urls.length > WEB_SEARCH_LIMITS.merchantPages) throw new Error("WEB_PAGE_LIMIT");
  const distinct = new Map<string, string>();
  for (const value of urls) { const url = webProductUrl(value); const host = new URL(url).hostname;
    if (!distinct.has(host)) distinct.set(host, url); }
  const selected = [...distinct.values()];
  const controller = new AbortController();
  // Leave response time inside the plugin's 30-second per-tool host deadline.
  const timeout = setTimeout(() => controller.abort(), Math.min(durationMs, 25_000));
  const products: Array<ShopifyProduct | undefined> = Array.from({ length: selected.length });
  let unavailable = 0;
  try {
    // Count at most five explicit pages, two concurrent reads. An adapter that
    // ignores abort cannot extend this lease or mutate the returned snapshot.
    let next = 0;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (next < selected.length && !controller.signal.aborted) {
        const index = next++;
        const url = selected[index]!;
        let onAbort: (() => void) | undefined;
        try {
          const value = await Promise.race([port.read(url, request, controller.signal), new Promise<never>((_, reject) => {
            if (controller.signal.aborted) reject(new Error("WEB_TIMEOUT"));
            else { onAbort = () => reject(new Error("WEB_TIMEOUT")); controller.signal.addEventListener("abort", onAbort, { once: true }); }
          })]);
          if (value.sourceHost !== new URL(url).hostname || value.merchantUrl !== url || value.sourceKind !== "WEB_PRODUCT_PAGE") {
            throw new Error("WEB_IDENTITY_MISMATCH");
          }
          products[index] = value;
        } catch { unavailable++; }
        finally { if (onAbort !== undefined) controller.signal.removeEventListener("abort", onAbort); }
      }
    }));
    unavailable += selected.length - next;
  } finally { clearTimeout(timeout); }
  return { products: products.filter((value): value is ShopifyProduct => value !== undefined), rejected: urls.length - selected.length, unavailable };
}
