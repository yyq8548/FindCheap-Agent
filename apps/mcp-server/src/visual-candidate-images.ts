import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { safeFetchWithProvenance } from "../../../packages/network-safety/src/safe-fetch.js";

const MAX_IMAGE_BYTES = 1_500_000;
const SHOPIFY_CANDIDATE_WIDTH = 512;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_IMAGE_PROCESSING_MS = 2_000;
const MAX_IMAGE_WORKERS = 2;
const MAX_WAITING_IMAGE_WORKERS = 12;
let activeImageWorkers = 0;
const waitingImageWorkers: Array<{
  signal: AbortSignal;
  start: () => void;
  abort: () => void;
}> = [];

export type VisualCandidateImageFailureCode =
  | "INVALID_URL"
  | "UNSAFE_URL"
  | "REQUEST_FAILED"
  | "REQUEST_ABORTED"
  | "REQUEST_TIMEOUT"
  | "HTTP_ERROR"
  | "REDIRECT_NOT_APPROVED"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "RESPONSE_TOO_LARGE"
  | "OUTPUT_BUDGET_EXCEEDED"
  | "IMAGE_PIXEL_LIMIT_EXCEEDED"
  | "IMAGE_TRANSFORM_UNSUPPORTED"
  | "IMAGE_PROCESSING_FAILED"
  | "IMAGE_PROCESSING_TIMEOUT"
  | "IMAGE_PROCESSING_BUSY"
  | "EMPTY_BODY";

export class VisualCandidateImageError extends Error {
  constructor(
    readonly code: VisualCandidateImageFailureCode,
    readonly sourceHost?: string,
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "VisualCandidateImageError";
  }
}

export type VisualCandidateImage = {
  data: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  /** Hash of the bounded downloaded body, before local budget-dependent transforms.
   * Optional only for custom/legacy ports; never sourced from merchant metadata. */
  sourceContentSha256?: string;
};

export interface VisualCandidateImagePort {
  load(url: string, options?: { signal?: AbortSignal; maxDataChars?: number }): Promise<VisualCandidateImage>;
}

export function createVisualCandidateImagePort(
  fetchImage: typeof safeFetchWithProvenance = safeFetchWithProvenance,
  processingTimeoutMs = MAX_IMAGE_PROCESSING_MS
): VisualCandidateImagePort {
  return {
    async load(rawUrl, options = {}) {
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch (error) {
        throw new VisualCandidateImageError("INVALID_URL", undefined, { cause: error });
      }
      const sourceHost = url.hostname.toLocaleLowerCase("en-US");
      checkCancellation(options.signal, sourceHost);
      const maxBytes = options.maxDataChars === undefined ? MAX_IMAGE_BYTES
        : Math.min(MAX_IMAGE_BYTES, Math.floor(options.maxDataChars / 4) * 3);
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        throw new VisualCandidateImageError("OUTPUT_BUDGET_EXCEEDED", sourceHost);
      }
      if (
        url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
        url.port !== ""
      ) throw new VisualCandidateImageError("UNSAFE_URL", sourceHost);
      url.hash = "";
      const fetchUrl = boundedCandidateImageUrl(url);
      const allowedHosts = approvedRedirectHosts(url);
      let result: Awaited<ReturnType<typeof fetchImage>>;
      try {
        result = await fetchImage(
          { url: fetchUrl.href },
          { allowedHosts, maxResponseBytes: MAX_IMAGE_BYTES,
            ...(options.signal === undefined ? {} : { signal: options.signal }) }
        );
      } catch (error) {
        const code = options.signal?.aborted === true ? "REQUEST_ABORTED" as const
          : error instanceof Error && error.name === "TimeoutError" ? "REQUEST_TIMEOUT" as const
          : error instanceof Error && error.message.includes("response too large") ? "RESPONSE_TOO_LARGE" as const
          : error instanceof Error && error.message.includes("redirect blocked host")
          ? "REDIRECT_NOT_APPROVED" as const
          : "REQUEST_FAILED" as const;
        throw new VisualCandidateImageError(code, sourceHost, { cause: error });
      }
      const finalUrl = new URL(result.finalUrl);
      const contentType = result.response.headers.get("content-type")
        ?.split(";", 1)[0]?.trim().toLowerCase();
      const contentLength = result.response.headers.get("content-length");
      const fail = (code: VisualCandidateImageFailureCode): never => {
        void result.response.body?.cancel().catch(() => undefined);
        throw new VisualCandidateImageError(code, sourceHost);
      };
      if (options.signal?.aborted === true) fail("REQUEST_ABORTED");
      if (!result.response.ok) fail("HTTP_ERROR");
      if (!allowedHosts.includes(finalUrl.hostname.toLocaleLowerCase("en-US"))) {
        fail("REDIRECT_NOT_APPROVED");
      }
      if (contentType === undefined || !ALLOWED_IMAGE_TYPES.has(contentType)) {
        fail("UNSUPPORTED_CONTENT_TYPE");
      }
      if (contentLength !== null && (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_IMAGE_BYTES)) {
        fail("RESPONSE_TOO_LARGE");
      }
      if (contentType === "image/webp" && contentLength !== null && Number(contentLength) > maxBytes) {
        fail("IMAGE_TRANSFORM_UNSUPPORTED");
      }
      const bytes = await readBoundedBytes(result.response, sourceHost, options.signal);
      const sourceContentSha256 = createHash("sha256").update(bytes).digest("hex");
      if (contentType !== "image/webp") {
        const image = await resizeCandidateImage(bytes, contentType as "image/jpeg" | "image/png", sourceHost,
          maxBytes, options.signal, processingTimeoutMs);
        return { ...image, sourceContentSha256 };
      }
      if (bytes.length > maxBytes) fail("IMAGE_TRANSFORM_UNSUPPORTED");
      validateWebpDimensions(bytes, sourceHost);
      return {
        data: Buffer.from(bytes).toString("base64"),
        mimeType: contentType as VisualCandidateImage["mimeType"],
        sourceContentSha256
      };
    }
  };
}

/** WebP stays encoded; validate every container/bitstream size before forwarding it. */
function validateWebpDimensions(bytes: Uint8Array, sourceHost: string): void {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (code: VisualCandidateImageFailureCode = "IMAGE_PROCESSING_FAILED"): never => {
    throw new VisualCandidateImageError(code, sourceHost);
  };
  const bounded = (width: number, height: number) => {
    if (width < 1 || height < 1) fail();
    if (width > 8_192 || height > 8_192 || width * height > 4_000_000) fail("IMAGE_PIXEL_LIMIT_EXCEEDED");
    return { width, height };
  };
  if (data.length < 20 || data.toString("latin1", 0, 4) !== "RIFF" ||
      data.toString("latin1", 8, 12) !== "WEBP" || data.readUInt32LE(4) + 8 !== data.length) fail();
  let canvas: { width: number; height: number } | undefined;
  let image: { width: number; height: number } | undefined;
  for (let offset = 12; offset < data.length;) {
    if (offset + 8 > data.length) fail();
    const kind = data.toString("latin1", offset, offset + 4);
    const length = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    const next = start + length + length % 2;
    if (next > data.length) fail();
    if (kind === "VP8X") {
      if (offset !== 12 || canvas !== undefined || length !== 10) fail();
      const flags = data[start]!;
      if ((flags & 0xc1) !== 0 || data.readUIntLE(start + 1, 3) !== 0) fail();
      if ((flags & 2) !== 0) fail("IMAGE_TRANSFORM_UNSUPPORTED");
      canvas = bounded(data.readUIntLE(start + 4, 3) + 1, data.readUIntLE(start + 7, 3) + 1);
    } else if (kind === "VP8 ") {
      if (image !== undefined || length < 10 || (data[start]! & 1) !== 0 ||
          data.toString("hex", start + 3, start + 6) !== "9d012a") fail();
      const partitionLength = data.readUIntLE(start, 3) >>> 5;
      if (partitionLength === 0 || partitionLength > length - 3) fail();
      image = bounded(data.readUInt16LE(start + 6) & 0x3fff, data.readUInt16LE(start + 8) & 0x3fff);
    } else if (kind === "VP8L") {
      if (image !== undefined || length < 5 || data[start] !== 0x2f) fail();
      const bits = data.readUInt32LE(start + 1);
      if ((bits >>> 29) !== 0) fail();
      image = bounded((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    } else if (kind === "ANIM" || kind === "ANMF") fail("IMAGE_TRANSFORM_UNSUPPORTED");
    offset = next;
  }
  if (image === undefined || (canvas !== undefined &&
      (canvas.width !== image.width || canvas.height !== image.height))) fail();
}

async function resizeCandidateImage(
  bytes: Uint8Array, mimeType: "image/jpeg" | "image/png", sourceHost: string,
  maxBytes: number, signal: AbortSignal | undefined, timeoutMs: number
): Promise<VisualCandidateImage> {
  checkCancellation(signal, sourceHost);
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), Number.isFinite(timeoutMs)
    ? Math.max(1, Math.min(MAX_IMAGE_PROCESSING_MS, timeoutMs)) : MAX_IMAGE_PROCESSING_MS);
  const processingSignal = signal === undefined ? deadline.signal : AbortSignal.any([signal, deadline.signal]);
  let release: (() => void) | undefined;
  let worker: Worker | undefined;
  try {
    // Waiting consumes the same deadline; no worker or decoded buffer exists yet.
    release = await acquireImageWorker(processingSignal, sourceHost);
    processingSignal.throwIfAborted();
    const sourceWorker = new URL("./visual-image-worker.mjs", import.meta.url);
    const workerUrl = existsSync(sourceWorker) ? sourceWorker : new URL("./visual-image-worker.cjs", import.meta.url);
    const transfer = Uint8Array.from(bytes);
    const runningWorker = new Worker(workerUrl, {
      workerData: { bytes: transfer.buffer, mimeType, maxBytes }, transferList: [transfer.buffer],
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 }
    });
    worker = runningWorker;
    return await new Promise<VisualCandidateImage>((resolve, reject) => {
      let settled = false;
      const finish = (error?: VisualCandidateImageError, result?: VisualCandidateImage) => {
        if (settled) return;
        settled = true;
        processingSignal.removeEventListener("abort", abort);
        if (error !== undefined) reject(error);
        else resolve(result!);
      };
      const abort = () => finish(new VisualCandidateImageError(
        signal?.aborted === true ? "REQUEST_ABORTED" : "IMAGE_PROCESSING_TIMEOUT", sourceHost
      ));
      processingSignal.addEventListener("abort", abort, { once: true });
      runningWorker.once("error", () => finish(new VisualCandidateImageError("IMAGE_PROCESSING_FAILED", sourceHost)));
      runningWorker.once("exit", () => finish(new VisualCandidateImageError("IMAGE_PROCESSING_FAILED", sourceHost)));
      runningWorker.once("message", (message: unknown) => {
        if (message === null || typeof message !== "object") return finish(new VisualCandidateImageError("IMAGE_PROCESSING_FAILED", sourceHost));
        const result = message as { ok?: boolean; code?: string; bytes?: Uint8Array; mimeType?: string };
        if (result.ok === true && result.bytes instanceof Uint8Array && result.bytes.length <= maxBytes &&
            (result.mimeType === "image/jpeg" || result.mimeType === "image/png")) {
          finish(undefined, { data: Buffer.from(result.bytes).toString("base64"), mimeType: result.mimeType });
        } else {
          const safeCodes = ["IMAGE_PIXEL_LIMIT_EXCEEDED", "IMAGE_TRANSFORM_UNSUPPORTED", "OUTPUT_BUDGET_EXCEEDED"];
          finish(new VisualCandidateImageError(safeCodes.includes(result.code ?? "")
            ? result.code as VisualCandidateImageFailureCode : "IMAGE_PROCESSING_FAILED", sourceHost));
        }
      });
    });
  } catch (error) {
    checkCancellation(signal, sourceHost);
    if (deadline.signal.aborted) throw new VisualCandidateImageError("IMAGE_PROCESSING_TIMEOUT", sourceHost);
    if (error instanceof VisualCandidateImageError) throw error;
    throw new VisualCandidateImageError("IMAGE_PROCESSING_FAILED", sourceHost, { cause: error });
  } finally {
    clearTimeout(timer);
    // Keep the slot until the isolated heap has actually stopped.
    await worker?.terminate().catch(() => undefined);
    release?.();
  }
}

function acquireImageWorker(signal: AbortSignal, sourceHost: string): Promise<() => void> {
  signal.throwIfAborted();
  if (activeImageWorkers < MAX_IMAGE_WORKERS) {
    activeImageWorkers += 1;
    return Promise.resolve(releaseImageWorker);
  }
  if (waitingImageWorkers.length >= MAX_WAITING_IMAGE_WORKERS) {
    return Promise.reject(new VisualCandidateImageError("IMAGE_PROCESSING_BUSY", sourceHost));
  }
  return new Promise((resolve, reject) => {
    const entry = {
      signal,
      start: () => {
        signal.removeEventListener("abort", entry.abort);
        activeImageWorkers += 1;
        resolve(releaseImageWorker);
      },
      abort: () => {
        const index = waitingImageWorkers.indexOf(entry);
        if (index >= 0) waitingImageWorkers.splice(index, 1);
        reject(signal.reason);
      }
    };
    waitingImageWorkers.push(entry);
    signal.addEventListener("abort", entry.abort, { once: true });
  });
}

function releaseImageWorker(): void {
  activeImageWorkers -= 1;
  while (waitingImageWorkers.length > 0 && activeImageWorkers < MAX_IMAGE_WORKERS) {
    const next = waitingImageWorkers.shift()!;
    if (next.signal.aborted) next.abort();
    else next.start();
  }
}

function approvedRedirectHosts(url: URL): string[] {
  const sourceHost = url.hostname.toLocaleLowerCase("en-US");
  const hosts = [sourceHost];
  if (url.pathname.startsWith("/cdn/shop/")) hosts.push("cdn.shopify.com");
  return [...new Set(hosts)];
}

function boundedCandidateImageUrl(url: URL): URL {
  const bounded = new URL(url.href);
  if (bounded.hostname === "cdn.shopify.com" || bounded.hostname.endsWith(".shopifycdn.com") ||
      bounded.pathname.startsWith("/cdn/shop/")) {
    bounded.searchParams.set("width", String(SHOPIFY_CANDIDATE_WIDTH));
  } else if (bounded.hostname === "i.ebayimg.com") {
    bounded.pathname = bounded.pathname.replace(/s-l\d+(?=\.)/giu, "s-l500");
  }
  return bounded;
}

async function readBoundedBytes(
  response: Response, sourceHost: string, signal?: AbortSignal
): Promise<Uint8Array> {
  checkCancellation(signal, sourceHost);
  if (response.body === null) throw new VisualCandidateImageError("EMPTY_BODY", sourceHost);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      checkCancellation(signal, sourceHost);
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        cancel();
        throw new VisualCandidateImageError("RESPONSE_TOO_LARGE", sourceHost);
      }
      chunks.push(value);
    }
    if (total === 0) throw new VisualCandidateImageError("EMPTY_BODY", sourceHost);
    return Buffer.concat(chunks, total);
  } catch (error) {
    checkCancellation(signal, sourceHost);
    if (error instanceof VisualCandidateImageError) throw error;
    throw new VisualCandidateImageError("REQUEST_FAILED", sourceHost, { cause: error });
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function checkCancellation(signal: AbortSignal | undefined, sourceHost: string): void {
  if (signal?.aborted === true) throw new VisualCandidateImageError("REQUEST_ABORTED", sourceHost);
}
