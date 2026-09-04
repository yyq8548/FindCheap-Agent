import { safeFetchWithProvenance } from "../../../packages/network-safety/src/safe-fetch.js";

const MAX_IMAGE_BYTES = 1_500_000;
const SHOPIFY_CANDIDATE_WIDTH = 512;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type VisualCandidateImageFailureCode =
  | "INVALID_URL"
  | "UNSAFE_URL"
  | "REQUEST_FAILED"
  | "HTTP_ERROR"
  | "REDIRECT_NOT_APPROVED"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "RESPONSE_TOO_LARGE"
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
};

export interface VisualCandidateImagePort {
  load(url: string): Promise<VisualCandidateImage>;
}

export function createVisualCandidateImagePort(
  fetchImage: typeof safeFetchWithProvenance = safeFetchWithProvenance
): VisualCandidateImagePort {
  return {
    async load(rawUrl) {
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch (error) {
        throw new VisualCandidateImageError("INVALID_URL", undefined, { cause: error });
      }
      const sourceHost = url.hostname.toLocaleLowerCase("en-US");
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
          { allowedHosts }
        );
      } catch (error) {
        const code = error instanceof Error && error.message.includes("redirect blocked host")
          ? "REDIRECT_NOT_APPROVED" as const
          : "REQUEST_FAILED" as const;
        throw new VisualCandidateImageError(code, sourceHost, { cause: error });
      }
      const finalUrl = new URL(result.finalUrl);
      const contentType = result.response.headers.get("content-type")
        ?.split(";", 1)[0]?.trim().toLowerCase();
      const contentLength = result.response.headers.get("content-length");
      if (!result.response.ok) throw new VisualCandidateImageError("HTTP_ERROR", sourceHost);
      if (!allowedHosts.includes(finalUrl.hostname.toLocaleLowerCase("en-US"))) {
        throw new VisualCandidateImageError("REDIRECT_NOT_APPROVED", sourceHost);
      }
      if (contentType === undefined || !ALLOWED_IMAGE_TYPES.has(contentType)) {
        throw new VisualCandidateImageError("UNSUPPORTED_CONTENT_TYPE", sourceHost);
      }
      if (contentLength !== null && (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_IMAGE_BYTES)) {
        throw new VisualCandidateImageError("RESPONSE_TOO_LARGE", sourceHost);
      }
      const bytes = await readBoundedBytes(result.response, sourceHost);
      return {
        data: Buffer.from(bytes).toString("base64"),
        mimeType: contentType as VisualCandidateImage["mimeType"]
      };
    }
  };
}

function approvedRedirectHosts(url: URL): string[] {
  const sourceHost = url.hostname.toLocaleLowerCase("en-US");
  const hosts = [sourceHost];
  if (url.pathname.startsWith("/cdn/shop/")) hosts.push("cdn.shopify.com");
  return [...new Set(hosts)];
}

function boundedCandidateImageUrl(url: URL): URL {
  const bounded = new URL(url.href);
  if (bounded.hostname === "cdn.shopify.com" || bounded.hostname.endsWith(".shopifycdn.com")) {
    bounded.searchParams.set("width", String(SHOPIFY_CANDIDATE_WIDTH));
  } else if (bounded.hostname === "i.ebayimg.com") {
    bounded.pathname = bounded.pathname.replace(/s-l\d+(?=\.)/giu, "s-l500");
  }
  return bounded;
}

async function readBoundedBytes(response: Response, sourceHost: string): Promise<Uint8Array> {
  if (response.body === null) throw new VisualCandidateImageError("EMPTY_BODY", sourceHost);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new VisualCandidateImageError("RESPONSE_TOO_LARGE", sourceHost);
      }
      chunks.push(value);
    }
    if (total === 0) throw new VisualCandidateImageError("EMPTY_BODY", sourceHost);
    return Buffer.concat(chunks, total);
  } finally {
    reader.releaseLock();
  }
}
