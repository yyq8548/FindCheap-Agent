import { describe, expect, it, vi } from "vitest";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

describe("visual correction independent review", () => {
  it("does not spend the search budget while awaiting the user's category answer", async () => {
    let monotonicMs = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => monotonicMs);
    const search = vi.fn(async () => searchResult([product({ title: "Ivory striped camisole top", productType: "camisole top",
      description: "Ivory striped square neck camisole top", imageUrl: "https://cdn.shopify.com/ivory-top.jpg" })]));
    const replay = await connectReplay(search);
    try {
      const first = CallToolResultSchema.parse(await replay.client.callTool({ name: "search_visual_candidates", arguments: {
        query: "ivory striped dress", productType: "dress", responseLocale: "zh-CN",
        visualInput: { productType: "dress", colors: ["ivory"], categoryCandidates: ["dress", "camisole top"] }
      } }));
      expect(first.structuredContent?.status).toBe("NEEDS_CLARIFICATION");
      expect(search).not.toHaveBeenCalled();
      monotonicMs += 181_000;
      const corrected = CallToolResultSchema.parse(await replay.client.callTool({ name: "search_visual_candidates", arguments: {
        query: "ivory striped camisole top", productType: "camisole top", responseLocale: "zh-CN",
        contextMode: "CORRECT_PREVIOUS_PRODUCT", parentRenderId: first.structuredContent?.renderId,
        visualInput: { productType: "camisole top", colors: ["ivory"] }
      } }));
      expect(corrected.isError).not.toBe(true);
      expect(corrected.structuredContent).toMatchObject({ status: "OK", candidates: [expect.any(Object)],
        workflow: { finalAnswerAllowed: false, requiredNextTool: "finalize_visual_search" } });
      expect(search).toHaveBeenCalled();
      expect(corrected._meta?.["findcheap/searchTrace"]).toMatchObject({ budgetExhausted: false,
        serviceBudget: { verifiedUserWaitMs: 0, observedClarificationWaitMs: 181_000, remainingMs: 180_000 } });
    } finally { await replay.close(); clock.mockRestore(); }
  });
});
