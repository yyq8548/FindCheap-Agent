import { describe, expect, it, vi } from "vitest";
import type { ProductCardContent, ShopifyPort } from "../src/server.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

describe("visual fallback MCP policy", () => {
  it.each(["IN_STOCK", "UNKNOWN"] as const)("keeps %s scoped highly-similar discovery cards under the visual availability gate", async availability => {
    const original = product({ title: "Black boat neck mini dress", productType: "dress", availability,
      description: "Black boat neck mini dress", imageUrl: "https://cdn.shopify.com/stock-status.jpg" });
    const replay = await connectReplay(async () => searchResult([original]));
    try {
      const first = await replay.client.callTool({ name: "search_visual_candidates", arguments: {
        query: "black mini dress", productType: "dress", visualInput: { productType: "dress", colors: ["black"], neckline: "boat neck" }
      } });
      expect(first.isError).not.toBe(true);
      const session = first.structuredContent as { visualSessionId: string; candidates: Array<{ candidateId: string }> };
      expect(session.candidates).toHaveLength(1);
      const final = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: session.visualSessionId, verdicts: [{ candidateId: session.candidates[0]!.candidateId, verdict: {
          classification: "HIGHLY_SIMILAR", matches: [
            { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
            { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "boat neck" }
          ], conflicts: []
        } }]
      } });
      expect(final.isError).not.toBe(true);
      const content = final.structuredContent as ProductCardContent;
      expect(content.products[0]).toMatchObject({ matchStatus: "DISCOVERY_MATCH", availability,
        visualReviewAssessment: { recommendationScope: "SIMILAR" } });
      expect(content.recommendation?.state).toBe(availability === "IN_STOCK" ? "READY" : "RESEARCH_ONLY");
      if (availability === "UNKNOWN") expect(content.recommendation?.reasonCodes).toContain("SIMILAR_ONLY");
    } finally { await replay.close(); }
  });
  it("requires a fresh visual review after inspecting a changed variant, preserving the old snapshot", async () => {
    const original = product({ handle: "1001", title: "Black boat neck mini dress", productType: "dress",
      description: "Black boat neck mini dress", imageUrl: "https://cdn.shopify.com/black.jpg", checkoutPlatform: "SHOPIFY",
      variantDimensions: { Color: "Black", Size: "S" } });
    const changed = { ...original, handle: "1002", title: "Ivory boat neck mini dress", matchStatus: "EXACT" as const,
      variantDimensions: { Color: "Ivory", Size: "M" }, imageUrl: "https://cdn.shopify.com/ivory.jpg" };
    const replay = await connectReplay(async () => searchResult([original]), { selectedProducts: {
      inspect: async () => ({ productTitle: original.title, canonicalProductUrl: original.merchantUrl, variants: [changed] })
    } });
    try {
      const first = await replay.client.callTool({ name: "search_visual_candidates", arguments: {
        query: "black mini dress", productType: "dress", responseLocale: "zh-CN",
        visualInput: { productType: "dress", colors: ["black"], neckline: "boat neck", length: "mini" }
      } });
      const session = first.structuredContent as { visualSessionId: string; candidates: Array<{ candidateId: string }> };
      const final = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: session.visualSessionId, verdicts: [{ candidateId: session.candidates[0]!.candidateId,
          verdict: { classification: "SAME_STYLE", matches: [
            { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
            { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "boat neck" }
          ], conflicts: [] } }]
      } });
      const old = final.structuredContent as ProductCardContent;
      const inspected = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
        renderId: old.renderId, selectionId: old.products[0]!.selectionId, variantDimensions: { Size: "M" }
      } });
      expect(inspected.isError).not.toBe(true);
      const next = (inspected.structuredContent as { updatedSnapshot: ProductCardContent }).updatedSnapshot;
      expect(next.products[0]).toMatchObject({ handle: "1002", visualReviewRequired: true });
      expect(next.products[0]!.visualReviewAssessment).toBeUndefined();
      expect(next.products[0]!.visualMatchGroup).toBeUndefined();
      expect(next.recommendation).toMatchObject({ state: "RESEARCH_ONLY", reasonCodes: ["VISUAL_REVIEW_REQUIRED"] });
      const oldAgain = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: old.renderId } });
      expect(oldAgain.isError).not.toBe(true);
      expect(oldAgain.structuredContent).toMatchObject({ products: [{ handle: "1001", matchStatus: "SIMILAR",
        visualReviewAssessment: { recommendationScope: "SIMILAR" } }], recommendation: { state: "READY" } });
    } finally { await replay.close(); }
  });
  it("returns a default visual same-style choice with server-owned scope and immutable card identity", async () => {
    const original = product({ handle: "similar-dress", title: "Black boat neck mini dress", productType: "dress",
      description: "Black boat neck mini dress", imageUrl: "https://cdn.shopify.com/similar-dress.jpg" });
    const other = { ...original, handle: "similar-other", title: "Black boat neck second mini dress",
      merchantUrl: "https://ishowbeauty.com/products/other", imageUrl: "https://cdn.shopify.com/other.jpg" };
    const replay = await connectReplay(async () => ({ ...searchResult([original, other]), coverage: "PARTIAL" as const }), {
      visualCandidateImages: { load: async url => ({ data: Buffer.from(url).toString("base64"), mimeType: "image/jpeg" }) }
    });
    try {
      const first = await replay.client.callTool({ name: "search_visual_candidates", arguments: {
        query: "black mini dress", productType: "dress", responseLocale: "zh-CN",
        visualInput: { productType: "dress", colors: ["black"], neckline: "boat neck", length: "mini" }
      } });
      const session = first.structuredContent as { visualSessionId: string; candidates: Array<{ candidateId: string }> };
      expect(session.candidates).toHaveLength(2);
      const final = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: session.visualSessionId, verdicts: session.candidates.map(({ candidateId }) => ({ candidateId,
          verdict: { classification: "SAME_STYLE", matches: [
            { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
            { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "boat neck" }
          ], conflicts: [] } }))
      } });
      expect(final.isError).not.toBe(true);
      const content = final.structuredContent as ProductCardContent;
      expect(content.products).toHaveLength(2);
      expect(content.products[0]).toMatchObject({ handle: "similar-dress", matchStatus: "SIMILAR",
        visualMatchGroup: "SAME_STYLE", presentationGroup: "TRUSTED_MATCH", card: { matchBadge: "SIMILAR" },
        visualReviewAssessment: { recommendationScope: "SIMILAR" } });
      expect(content.recommendation).toMatchObject({ state: "READY", primarySelectionId: content.products[0]!.selectionId });
      expect(content).toMatchObject({ visualSearchOutcome: { sameItemStatus: "NOT_CONFIRMED", incomplete: true } });
      const compared = await replay.client.callTool({ name: "compare_selected_products", arguments: {
        renderId: content.renderId, selectionIds: content.products.map(entry => entry.selectionId), responseLocale: "zh-CN"
      } });
      expect(compared.isError).not.toBe(true);
      expect(compared.structuredContent).toMatchObject({ mode: "PRODUCT_CHOICES", priceComparability: "NOT_LIKE_FOR_LIKE",
        recommendation: { state: "READY", scope: "SIMILAR" }, entries: content.products.map(() => ({ matchStatus: "SIMILAR",
          visualReviewAssessment: { recommendationScope: "SIMILAR" } })) });
      expect(compared.structuredContent).not.toHaveProperty("priceDelta");
      expect(final._meta?.["findcheap/searchTrace"]).toMatchObject({ reviewInsufficient: 0 });
      expect(original.matchStatus).toBe("DISCOVERY_MATCH");
    } finally { await replay.close(); }
  });
  it("retains catalog out-of-stock evidence for image review without broadening ordinary text search", async () => {
    const unavailable = product({ handle: "unavailable-dress", title: "Black boat neck mini dress", productType: "dress",
      description: "Black boat neck mini dress", availability: "OUT_OF_STOCK", availabilityScope: "SELECTED_VARIANT",
      variantDimensions: { size: "M", color: "black" }, imageUrl: "https://cdn.shopify.com/unavailable-dress.jpg" });
    const before = structuredClone(unavailable);
    const search = vi.fn<ShopifyPort["search"]>(async input => searchResult(input.includeOutOfStock ? [unavailable] : []));
    const replay = await connectReplay(search);
    try {
      const first = await replay.client.callTool({ name: "search_visual_candidates", arguments: {
        query: "black mini dress", productType: "dress", responseLocale: "zh-CN",
        visualInput: { productType: "dress", colors: ["black"], neckline: "boat neck", length: "mini" }
      } });
      expect(first.isError).not.toBe(true);
      const session = first.structuredContent as { visualSessionId: string; candidates: Array<{ candidateId: string }> };
      expect(session.candidates).toHaveLength(1);
      expect(search).toHaveBeenCalledWith(expect.objectContaining({ includeOutOfStock: true }));
      const final = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: session.visualSessionId, verdicts: [{ candidateId: session.candidates[0]!.candidateId,
          verdict: { classification: "HIGHLY_SIMILAR", matches: [
            { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
            { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "boat neck" }
          ], conflicts: [] } }]
      } });
      expect(final.isError).not.toBe(true);
      const content = final.structuredContent as ProductCardContent;
      expect(content.products).toHaveLength(1);
      expect(content.products[0]).toMatchObject({ handle: "unavailable-dress", availability: "OUT_OF_STOCK",
        availabilityScope: "SELECTED_VARIANT", variantDimensions: { size: "M", color: "black" },
        itemPrice: { amountCents: 3641, currency: "USD" } });
      expect(content.recommendation).toMatchObject({ state: "RESEARCH_ONLY", reasonCodes: ["VARIANT_OUT_OF_STOCK", "SIMILAR_ONLY"] });
      expect(unavailable).toEqual(before);
      search.mockClear();
      const text = await replay.client.callTool({ name: "search_products", arguments: { query: "dress", productType: "dress" } });
      expect(text.isError).not.toBe(true);
      expect(text.structuredContent).toMatchObject({ products: [] });
      expect(search.mock.calls.every(([input]) => input.includeOutOfStock !== true)).toBe(true);
    } finally { await replay.close(); }
  });
});
