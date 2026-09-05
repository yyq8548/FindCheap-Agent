import { describe, expect, it, vi } from "vitest";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

describe("real-time official MCP integration", () => {
  it("recalls visual candidates from the official provider and preserves variant scope", async () => {
    const search = vi.fn(async () => [product({ productType: "dress", title: "Ivory floral mini dress",
      merchant: "DÔEN", brand: "DÔEN", sourceHost: "www.shopdoen.com",
      merchantUrl: "https://www.shopdoen.com/products/ivory-floral-dress",
      description: "ivory floral boat neck mini dress", availability: "OUT_OF_STOCK", availableSizes: [],
      availabilityScope: "PRODUCT_COLOR", imageUrl: "https://cdn.shopify.com/dress.jpg" })]);
    const replay = await connectReplay(async () => searchResult([]), { officialShopify: { search } });
    try {
      const first = await replay.client.callTool({ name: "search_visual_candidates", arguments: {
        query: "ivory floral mini dress", brand: "DÔEN", brandMode: "REQUIRED", contextMode: "NEW_PRODUCT", responseLocale: "zh-CN",
        visualInput: { productType: "dress", colors: ["ivory"], neckline: "boat neck", length: "mini" }
      } });
      expect(first.isError).not.toBe(true);
      const session = first.structuredContent as { visualSessionId: string; candidates: Array<{ candidateId: string }> };
      expect(session.candidates).toHaveLength(1);
      expect(search).toHaveBeenCalled();
      expect(first._meta?.["findcheap/searchTrace"]).not.toHaveProperty("officialCatalog");
      expect(first._meta?.["findcheap/searchTrace"]).toMatchObject({ officialStore: { status: "COMPLETE", productsReturned: 1 } });
      const final = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: session.visualSessionId, verdicts: [{ candidateId: session.candidates[0]!.candidateId,
          verdict: { classification: "HIGHLY_SIMILAR", matches: [
            { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
            { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "boat neck" }
          ], conflicts: [] } }]
      } });
      expect(final.isError).not.toBe(true);
      expect(final.structuredContent).toMatchObject({ products: [{ availableSizes: [], availabilityScope: "PRODUCT_COLOR" }],
        recommendation: { reasonCodes: expect.arrayContaining(["VARIANT_OUT_OF_STOCK"]) } });
      const content = final.structuredContent as { message: string };
      expect(content.message).toContain("缺货");
      expect(content.message).not.toContain("商家可信证据不足");
    } finally { await replay.close(); }
  });

  it("does not add official work or visual traces to the normal text fast path", async () => {
    const search = vi.fn(async () => { throw new Error("VISUAL_ONLY"); });
    const replay = await connectReplay(async () => searchResult([product()]), { officialShopify: { search } });
    try {
      const result = await replay.client.callTool({ name: "search_products", arguments: { query: "wig", contextMode: "NEW_PRODUCT" } });
      expect(result.isError).not.toBe(true);
      expect(search).not.toHaveBeenCalled();
      expect(result._meta?.["findcheap/searchTrace"]).not.toHaveProperty("visualFunnel");
    } finally { await replay.close(); }
  });
});
