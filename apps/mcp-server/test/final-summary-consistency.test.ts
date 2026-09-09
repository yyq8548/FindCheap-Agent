import { describe, expect, it } from "vitest";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";
import { summarizeSearchProducts } from "../src/search-result-summary.js";

function coffee(index: number, confirmed: boolean) {
  return product({ handle: String(100 + index), merchantId: `roaster-${index}`, sourceHost: `roaster${index}.example`,
    merchantUrl: `https://roaster${index}.example/products/coffee`, title: confirmed ? "Whole Bean Coffee" : "House Blend Coffee",
    productType: "coffee", merchantTrust: { level: "UNKNOWN", verification: "UNVERIFIED", evidence: [] },
    recommendationTier: "HIGH_RATED_UNVERIFIED", productRating: { value: 4.7, count: 20, scaleMax: 5 } });
}
describe("final card count and evidence questions", () => {
  it("counts only eligible rated offers", () => {
    const summary = summarizeSearchProducts([0, 1, 2, 3, 4, 5].map(index => ({ ...coffee(index, index < 3),
      coupons: { verified: [] }, requestIdentityStatus: index < 3 ? "CONFIRMED" as const : "NEEDS_VERIFICATION" as const })));
    expect(summary).toMatchObject({ productCount: 6, qualifiedMatchCount: 3, highRatedQualifiedCount: 3 });
  });
  it("does not call coffee research cards qualified or ask the buyer to resolve missing merchant form evidence", async () => {
    const replay = await connectReplay(async () => searchResult([0, 1, 2, 3, 4, 5].map(index => coffee(index, index < 3))));
    try {
      const result = await replay.client.callTool({ name: "search_products", arguments: {
        query: "coffee beans", productType: "coffee beans", comparisonMode: "DISCOVERY", responseLocale: "en-US", limit: 6
      } });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      const content = result.structuredContent as { products: unknown[]; message: string; questions: string[] };
      expect(content.products).toHaveLength(6);
      expect(content.message).toContain("3 later result(s) qualify");
      expect(content.message).not.toContain("6 later result(s) qualify");
      expect(content.questions).toEqual([]);
    } finally { await replay.close(); }
  });
});
