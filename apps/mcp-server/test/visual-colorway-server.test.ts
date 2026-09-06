import { describe, expect, it } from "vitest";
import type { ProductCardContent } from "../src/server.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

type Review = { visualSessionId: string; candidates: Array<{ candidateId: string }> };
const difference = { classification: "HIGHLY_SIMILAR", matches: [
  { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "boat neck" },
  { attribute: "SLEEVE", referenceEvidence: "cap sleeve", candidateEvidence: "cap sleeve" },
  { attribute: "LENGTH", referenceEvidence: "mini", candidateEvidence: "mini" }
], conflicts: [{ attribute: "COLOR", referenceEvidence: "black", candidateEvidence: "white" }] };

describe("MCP approved colorway directions", () => {
  it("describes the same source-brand boundary exposed by the executor", async () => {
    const replay = await connectReplay(async () => searchResult([]));
    try {
      const tool = (await replay.client.listTools()).tools.find(entry => entry.name === "finalize_visual_search");
      expect(tool?.description).toContain("source-proven same brand");
    } finally { await replay.close(); }
  });
  it.each(["doen", "OtherBrand", undefined])("binds the original top-level brand and keeps acceptance truthful for %s", brand => testColorway(brand));
});

async function testColorway(brand: string | undefined) {
  const sources = ["one", "two"].map(id => {
    const { brand: _brand, ...source } = product({ handle: id, title: "White boat neck cap sleeve mini dress", productType: "dress",
      description: "White boat neck cap sleeve mini dress", variantDimensions: { color: "white" },
      merchantUrl: `https://ishowbeauty.com/products/${id}`, imageUrl: `https://cdn.shopify.com/${id}.jpg` });
    return { ...source, ...(brand === undefined ? {} : { brand }) };
  });
  const before = structuredClone(sources);
  const replay = await connectReplay(async () => searchResult(sources), {
    visualCandidateImages: { load: async url => ({ data: Buffer.from(url).toString("base64"), mimeType: "image/jpeg" }) }
  });
  try {
    const initial = await replay.client.callTool({ name: "search_visual_candidates", arguments: {
      query: "black mini dress", productType: "dress", brand: "DÔEN", brandMode: "OBSERVED", visualInput: {
        productType: "dress", colors: ["black"], neckline: "boat neck", sleeveType: "cap sleeve", length: "mini"
      }
    } });
    expect(initial.isError).not.toBe(true);
    const review = initial.structuredContent as Review;
    expect(review.candidates).toHaveLength(2);
    const final = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
      visualSessionId: review.visualSessionId, verdicts: review.candidates.map(({ candidateId }) => ({ candidateId, verdict: difference }))
    } });
    expect(final.isError).not.toBe(true);
    const content = final.structuredContent as ProductCardContent;
    expect(content.products).toHaveLength(brand === "doen" ? 2 : 0);
    expect(final._meta?.["findcheap/searchTrace"]).toMatchObject({ reviewConflicts: brand === "doen" ? 0 : 2, reviewInsufficient: 0 });
    if (brand === "doen") {
      expect(content.recommendation).toMatchObject({ state: "READY", primarySelectionId: content.products[0]!.selectionId });
      const compared = await replay.client.callTool({ name: "compare_selected_products", arguments: {
        renderId: content.renderId, selectionIds: content.products.map(entry => entry.selectionId)
      } });
      expect(compared.isError).not.toBe(true);
      expect(compared.structuredContent).toMatchObject({ priceComparability: "NOT_LIKE_FOR_LIKE",
        recommendation: { state: "READY", scope: "SIMILAR" }, entries: [
          { visualReviewAssessment: { recommendationScope: "SIMILAR" } }, { visualReviewAssessment: { recommendationScope: "SIMILAR" } }
        ] });
    } else expect(content.recommendation?.state).not.toBe("READY");
    expect(sources).toEqual(before);
  } finally { await replay.close(); }
}
