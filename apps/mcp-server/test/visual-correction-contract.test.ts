import { describe, expect, it, vi } from "vitest";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

const visual = { productType: "dress", colors: ["ivory"], patterns: ["vertical pinstripes"], neckline: "square neck" };
const request = { query: "ivory striped dress", productType: "dress", responseLocale: "zh-CN", visualInput: visual };
const images = { load: async (url: string) => ({ data: Buffer.from(url).toString("base64"), mimeType: "image/jpeg" as const }) };
const item = (type: string, id = "1") => product({ title: `Ivory striped square neck ${type}`, productType: type,
  handle: id, variantDimensions: { Color: "Ivory" }, merchantUrl: `https://ishowbeauty.com/products/${id}`,
  description: `Ivory vertical pinstripes square neck ${type}`, imageUrl: `https://cdn.shopify.com/${id}.jpg` });
const rejected = { classification: "CONFLICT", matches: [], conflicts: [{ attribute: "NECKLINE", referenceEvidence: "square neck", candidateEvidence: "high neck" }] };

describe("visual correction retains the visual tool and the bounded flow", () => {
  it("routes a visual correction out of the text-only entrypoint before reading sources", async () => {
    const search = vi.fn(async () => searchResult([]));
    const replay = await connectReplay(search);
    try {
      const response = await replay.client.callTool({ name: "search_products", arguments: request });
      expect(response.isError).toBe(true);
      expect(response._meta?.["findcheap/errorDetails"]).toMatchObject({ recovery: {
        action: "USE_VISUAL_TOOL", requiredNextTool: "search_visual_candidates", maxAttempts: 1 } });
      expect(search).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("clarifies category ambiguity before retrieval and resumes the same goal with a review session", async () => {
    const search = vi.fn(async () => searchResult([item("camisole top")]));
    const replay = await connectReplay(search, { visualCandidateImages: images });
    try {
      const first = await replay.client.callTool({ name: "search_visual_candidates", arguments: { ...request,
        maxItemPriceCents: 10000, visualInput: { ...visual, categoryCandidates: ["dress", "camisole top"] } } });
      expect(first.structuredContent).toMatchObject({ status: "NEEDS_CLARIFICATION", candidates: [], goalRevision: 1 });
      expect(search).not.toHaveBeenCalled();
      const previous = CallToolResultSchema.parse(first).structuredContent!;
      const corrected = await replay.client.callTool({ name: "search_visual_candidates", arguments: {
        query: "ivory striped camisole top", productType: "camisole top", responseLocale: "zh-CN",
        contextMode: "CORRECT_PREVIOUS_PRODUCT", parentRenderId: previous.renderId,
        visualInput: { ...visual, productType: "camisole top" }
      } });
      expect(corrected.isError).not.toBe(true);
      expect(corrected.structuredContent).toMatchObject({ status: "OK", candidates: [expect.any(Object)],
        workflow: { finalAnswerAllowed: false, requiredNextTool: "finalize_visual_search" } });
      const session = corrected.structuredContent as { visualSessionId: string; candidates: { candidateId: string }[] };
      const final = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: session.visualSessionId, verdicts: session.candidates.map(candidate => ({ candidateId: candidate.candidateId, verdict: rejected }))
      } });
      expect(final.structuredContent).toMatchObject({ goalId: previous.goalId, goalRevision: 2 });
      expect(CallToolResultSchema.parse(final).structuredContent?.requirementLedger).toEqual(expect.arrayContaining([expect.objectContaining({ value: "10000" })]));
    } finally { await replay.close(); }
  });

  it("does not obtain a third review or a new budget by correcting an exhausted goal", async () => {
    const search = vi.fn(async () => searchResult(Array.from({ length: 7 }, (_, index) => item("dress", String(index)))));
    const replay = await connectReplay(search, { visualCandidateImages: images });
    try {
      let response = await replay.client.callTool({ name: "search_visual_candidates", arguments: request });
      const trace = response._meta?.["findcheap/searchTrace"] as { traceId: string };
      for (let round = 0; round < 2; round++) {
        const body = CallToolResultSchema.parse(response).structuredContent;
        const session = (body?.visualReview ?? body) as { visualSessionId: string; candidates: { candidateId: string }[] };
        response = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
          visualSessionId: session.visualSessionId, verdicts: session.candidates.map(candidate => ({ candidateId: candidate.candidateId, verdict: rejected }))
        } });
      }
      const calls = search.mock.calls.length;
      const correction = await replay.client.callTool({ name: "search_visual_candidates", arguments: { ...request,
        contextMode: "CORRECT_PREVIOUS_PRODUCT", parentRenderId: CallToolResultSchema.parse(response).structuredContent?.renderId } });
      expect(correction.structuredContent).toMatchObject({ status: "NO_IMAGE_CANDIDATES", recovery: {
        action: "REPORT_INCOMPLETE", reason: "BUDGET_EXHAUSTED" } });
      expect(correction._meta?.["findcheap/searchTrace"]).toMatchObject({ traceId: trace.traceId });
      expect(search.mock.calls.length).toBe(calls);
    } finally { await replay.close(); }
  });
});
