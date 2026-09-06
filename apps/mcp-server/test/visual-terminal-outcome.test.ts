import { describe, expect, it, vi } from "vitest";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ProductCardContent } from "../src/server.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

type Review = { visualSessionId: string; candidates: Array<{ candidateId: string }> };
const similar = { classification: "SAME_STYLE", matches: [
  { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
  { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "boat neck" }
], conflicts: [] };
const conflict = { classification: "CONFLICT", matches: [], conflicts: [
  { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "deep V neck" }
] };

describe("visual terminal message consistency", () => {
  it.each(["zh-CN", "en-US"] as const)("does not tell a %s user that a retained READY similar card is no qualifying product", async responseLocale => {
    let relaxed = false;
    const sources = Array.from({ length: 7 }, (_, index) => product({ handle: `terminal-${index}`,
      title: `Black boat neck mini dress ${index}`, productType: "dress", description: "Black boat neck mini dress",
      availabilityScope: "PRODUCT_COLOR", availableSizes: ["S", "M"], variantDimensions: { Color: "Black", Size: "S" },
      merchantUrl: `https://ishowbeauty.com/products/terminal-${index}`, imageUrl: `https://cdn.shopify.com/terminal-${index}.jpg` }));
    const search = vi.fn(async () => ({ ...searchResult(relaxed ? [] : sources),
      questions: ["Only similar products were found. Provide an exact model."] }));
    const replay = await connectReplay(search, {
      awin: { search: async () => ({ source: "AWIN_PRODUCT_FEED", coverage: "COMPLETE", snapshotAt: "2026-09-04T19:51:00.000Z", products: [],
        diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 } }) },
      visualCandidateImages: { load: async url => ({ data: Buffer.from(url).toString("base64"), mimeType: "image/jpeg" }) }
    });
    try {
      const initial = await replay.client.callTool({ name: "search_visual_candidates", arguments: {
        query: "black boat neck mini dress", productType: "dress", responseLocale,
        visualInput: { productType: "dress", colors: ["black"], neckline: "boat neck", length: "mini",
          suspectedProductName: "Botanical collection" }
      } });
      expect(initial.isError).not.toBe(true);
      const first = initial.structuredContent as Review;
      expect(first.candidates).toHaveLength(6);
      const beforeContinuation = search.mock.calls.length;
      relaxed = true;
      const next = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: first.visualSessionId,
        verdicts: first.candidates.map(({ candidateId }, index) => ({ candidateId, verdict: index === 0 ? similar : conflict }))
      } });
      expect(next.isError).not.toBe(true);
      expect(search.mock.calls.length).toBeGreaterThan(beforeContinuation);
      const second = (next.structuredContent as ProductCardContent).visualReview as Review;
      expect(second.candidates).toHaveLength(1);
      const final = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: second.visualSessionId,
        verdicts: second.candidates.map(({ candidateId }) => ({ candidateId, verdict: conflict }))
      } });
      expect(final.isError).not.toBe(true);
      const content = final.structuredContent as ProductCardContent;
      expect(content.products).toHaveLength(1);
      expect(content.recommendation).toMatchObject({ state: "READY", primarySelectionId: content.products[0]!.selectionId });
      expect(content.visualSearchOutcome).toMatchObject({ sameItemStatus: "NOT_CONFIRMED", incomplete: false });
      expect(content.products[0]!.visualReviewAssessment).toMatchObject({ recommendationScope: "SIMILAR" });
      expect(content.questions).toEqual([]);
      expect(content.recovery).toBeUndefined();
      const noMatchAdvice = responseLocale === "zh-CN" ? "现有来源没有返回已核实符合要求的商品" : "No configured source returned a qualifying product";
      expect(content.message).not.toContain(noMatchAdvice);
      const modelText = CallToolResultSchema.parse(final).content.filter(block => block.type === "text").map(block => block.text).join("\n");
      expect(modelText).not.toContain(noMatchAdvice);
      expect(modelText).not.toContain("Chrome");
      const receipt = CallToolResultSchema.parse(final).content.find(block => block.type === "text" && block.text.includes('"findcheapContext"'));
      if (receipt?.type !== "text") throw new Error("missing text-only receipt");
      const context = JSON.parse(receipt.text.split("\n")[1]!).findcheapContext;
      expect(context).toMatchObject({ visualSearchOutcome: content.visualSearchOutcome, recommendation: content.recommendation,
        products: [{ selectionId: content.products[0]!.selectionId, visualReviewAssessment: { recommendationScope: "SIMILAR" },
          availabilityScope: "PRODUCT_COLOR", availableSizes: ["S", "M"], variantDimensions: { Size: "S" } }] });
      expect(final._meta?.["findcheap/searchTrace"]).toMatchObject({ reviewed: 7, reviewConflicts: 6, returned: 1,
        diagnosticScopes: { reviewed: "VISUAL_FLOW", returned: "CURRENT_RESPONSE", candidateFunnel: "CURRENT_RETRIEVAL" } });
      // This legacy field describes only images emitted in the current response,
      // not the seven candidates already reviewed across the two rounds.
      expect(final._meta?.["findcheap/visualEvaluation"]).toMatchObject({ reviewedCandidates: [],
        finalProductHashes: [expect.any(String)] });
      const rendered = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: content.renderId } });
      expect(rendered.isError).not.toBe(true);
      expect(rendered.structuredContent).toMatchObject({ message: content.message, visualSearchOutcome: content.visualSearchOutcome,
        recommendation: { state: "READY", primarySelectionId: content.products[0]!.selectionId } });
    } finally { await replay.close(); }
  });
});
