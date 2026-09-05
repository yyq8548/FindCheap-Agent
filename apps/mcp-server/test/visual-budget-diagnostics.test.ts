import { describe, expect, it, vi } from "vitest";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

function imageProducts(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const handle = `candidate-${String(index).padStart(2, "0")}`;
    return product({ handle, title: `Black boat neck mini dress ${index}`, productType: "dress",
      description: "black boat neck mini dress", imageUrl: `https://cdn.shopify.com/${handle}.jpg`,
      merchantUrl: `https://ishowbeauty.com/products/${handle}` });
  });
}

const request = { query: "black mini dress", productType: "dress", comparisonMode: "DISCOVERY", contextMode: "NEW_PRODUCT",
  visualInput: { productType: "dress", colors: ["black"], neckline: "boat neck", length: "mini" } };

describe("visual budget stop diagnostics", () => {
  it.each([12, 13])("marks image budget truncation only when %s candidates leave an unattempted tail", async (count) => {
    const load = vi.fn(async () => { throw new Error("SYNTHETIC_IMAGE_FAILURE"); });
    const replay = await connectReplay(async () => searchResult(imageProducts(count)), { visualCandidateImages: { load } });
    try {
      const response = await replay.client.callTool({ name: "search_visual_candidates", arguments: request });
      expect(response.isError).not.toBe(true);
      expect(load).toHaveBeenCalledTimes(12);
      expect(response._meta).toMatchObject({ "findcheap/searchTrace": {
        imageRequests: 12, budgetExhausted: count === 13,
        outcome: count === 13 ? "BUDGET_EXHAUSTED" : "NO_LOADABLE_IMAGES"
      } });
      expect(response.structuredContent).toMatchObject({ visualSearchFailure: {
        code: count === 13 ? "SEARCH_BUDGET_EXHAUSTED" : "NO_LOADABLE_IMAGES"
      } });
      if (count === 13) expect(response._meta).toMatchObject({ "findcheap/searchTrace": {
        imageReviewStop: { reason: "IMAGE_REQUEST_LIMIT", unattemptedCandidates: 1 }
      } });
      else expect(response._meta?.["findcheap/searchTrace"]).not.toHaveProperty("imageReviewStop");
    } finally { await replay.close(); }
  });

  it("retains an accepted result and MATCH_FOUND when its supplemental tail hits the image budget", async () => {
    const load = vi.fn(async (url: string) => {
      if (/candidate-0[0-2]|candidate-1[0-2]|candidate-09/u.test(url)) throw new Error("SYNTHETIC_IMAGE_FAILURE");
      return { data: "aW1hZ2U=", mimeType: "image/jpeg" as const };
    });
    const replay = await connectReplay(async () => searchResult(imageProducts(13)), { visualCandidateImages: { load } });
    try {
      const first = await replay.client.callTool({ name: "search_visual_candidates", arguments: request });
      const session = first.structuredContent as { visualSessionId: string; candidates: Array<{ candidateId: string }> };
      expect(session.candidates).toHaveLength(6);
      expect(first._meta?.["findcheap/visualEvaluation"]).toMatchObject({ version: 1, reviewedCandidates:
        Array.from({ length: 6 }, () => ({ productHash: expect.stringMatching(/^[a-f0-9]{64}$/u), imageSha256: expect.stringMatching(/^[a-f0-9]{64}$/u) })) });
      const serializedMeta = JSON.stringify(first._meta);
      expect(serializedMeta).not.toMatch(/https:\/\/|black mini dress|Black boat neck|aW1hZ2U=/u);
      const final = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: session.visualSessionId,
        verdicts: session.candidates.map(({ candidateId }, index) => ({ candidateId, verdict: index === 0
          ? { classification: "HIGHLY_SIMILAR", matches: [
            { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
            { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "boat neck" }
          ], conflicts: [] }
          : { classification: "CONFLICT", matches: [], conflicts: [
            { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "V neck" }
          ] }
        }))
      } });
      expect(final.isError).not.toBe(true);
      expect(final._meta).toMatchObject({ "findcheap/searchTrace": { outcome: "MATCH_FOUND", imageRequests: 12, budgetExhausted: true } });
      expect(final.structuredContent).toMatchObject({ products: [{ visualMatchGroup: "HIGHLY_SIMILAR" }], coverage: "PARTIAL" });
      expect(final.structuredContent).not.toHaveProperty("visualSearchFailure");
    } finally { await replay.close(); }
  });
});
