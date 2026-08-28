import { safeFetchWithProvenance } from "../../../packages/network-safety/src/safe-fetch.js";

const MAX_IMAGE_BYTES = 1_500_000;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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
      const url = new URL(rawUrl);
      if (
        url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
        url.port !== "" || url.hash !== ""
      ) throw new Error("VISUAL_CANDIDATE_IMAGE_UNAVAILABLE");
      const result = await fetchImage(
        { url: url.href },
        { allowedHosts: [url.hostname] }
      );
      const finalUrl = new URL(result.finalUrl);
      const contentType = result.response.headers.get("content-type")
        ?.split(";", 1)[0]?.trim().toLowerCase();
      const contentLength = result.response.headers.get("content-length");
      if (
        !result.response.ok || finalUrl.hostname !== url.hostname ||
        contentType === undefined || !ALLOWED_IMAGE_TYPES.has(contentType) ||
        (contentLength !== null && (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_IMAGE_BYTES))
      ) throw new Error("VISUAL_CANDIDATE_IMAGE_UNAVAILABLE");
      const bytes = await readBoundedBytes(result.response);
      return {
        data: Buffer.from(bytes).toString("base64"),
        mimeType: contentType as VisualCandidateImage["mimeType"]
      };
    }
  };
}

async function readBoundedBytes(response: Response): Promise<Uint8Array> {
  if (response.body === null) throw new Error("VISUAL_CANDIDATE_IMAGE_UNAVAILABLE");
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
        throw new Error("VISUAL_CANDIDATE_IMAGE_UNAVAILABLE");
      }
      chunks.push(value);
    }
    if (total === 0) throw new Error("VISUAL_CANDIDATE_IMAGE_UNAVAILABLE");
    return Buffer.concat(chunks, total);
  } finally {
    reader.releaseLock();
  }
}
