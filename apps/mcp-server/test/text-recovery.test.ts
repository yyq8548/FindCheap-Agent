import { describe, expect, it, vi } from "vitest";
import { evaluateFeature, isColorRequirement } from "../src/product-constraint-matcher.js";
import { SearchProductsInputSchema, searchProducts } from "../src/search-products.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";
import type { ProductCardContent } from "../src/server.js";

const emptyAwin = { search: vi.fn(async () => ({ source: "AWIN_PRODUCT_FEED" as const, coverage: "COMPLETE" as const,
  snapshotAt: "2026-09-05T00:00:00.000Z", diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 }, products: [] })) };
const shampoo = () => product({ title: "Daily shampoo", productType: "shampoo", brand: "Example", description: "Gentle cleansing.",
  handle: "daily-shampoo", merchantUrl: "https://ishowbeauty.com/products/daily-shampoo" });

describe("text recovery", () => {
  it("does not classify non-color requirements as color selectors", () => {
    for (const value of ["suitable for oily scalp", "anti-dandruff", "cotton", "long sleeves"]) expect(isColorRequirement(value)).toBe(false);
    for (const value of ["black", "color: black", "black or red"]) expect(isColorRequirement(value)).toBe(true);
  });
  it.each(["suitable for oily scalp", "oily scalp", "油性头皮", "偏油"])("normalizes explicit scalp requirements: %s", feature => {
    expect(evaluateFeature("Shampoo for oily scalp. Anti-dandruff shampoo.", feature)).toBe("MATCHED");
  });
  it.each(["Not suitable for oily scalp.", "Unsuitable for oily scalp.", "不适合油性头皮。"])("rejects negated suitability: %s", text => {
    expect(evaluateFeature(text, "suitable for oily scalp")).toBe("CONTRADICTED");
  });
  it.each(["Oily scalp is a common issue.", "May cause an oily scalp.", "油性头皮是一种常见问题。"])("does not treat a scalp mention as suitability: %s", text => {
    expect(evaluateFeature(text, "oily scalp")).toBe("UNKNOWN");
  });
  it.each(["Gentle cleansing and scalp care.", "Contains zinc.", "Dandruff shampoo sold separately.", "Not an anti-dandruff shampoo."])("does not invent efficacy: %s", text => {
    expect(evaluateFeature(text, "anti-dandruff")).not.toBe("MATCHED");
  });
  it("uses compact feature retrieval without discarding either hard requirement", async () => {
    const search = vi.fn(async () => searchResult([shampoo()]));
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "shampoo", productType: "shampoo",
      requiredFeatures: ["suitable for oily scalp", "anti-dandruff"] }), { awin: emptyAwin, shopify: { search } });
    expect(search.mock.calls.map(call => (call as unknown as [{ query: string }])[0].query)).toEqual(["shampoo", "shampoo anti-dandruff"]);
    expect(result.candidates[0]?.requiredFeatureLimitations).toHaveLength(2);
    expect(result.chromeFallbackEligible).toBe(true);
  });
  it("offers recovery for 0 qualified plus research cards after a continuation", async () => {
    const replay = await connectReplay(async () => searchResult([shampoo()]), { awin: emptyAwin });
    try {
      const old = (await replay.client.callTool({ name: "search_products", arguments: { query: "shampoo", productType: "shampoo", responseLocale: "zh-CN" } })).structuredContent as ProductCardContent;
      const next = await replay.client.callTool({ name: "search_products", arguments: { query: "shampoo", contextMode: "CONTINUE_PREVIOUS_PRODUCT",
        parentRenderId: old.renderId, requiredFeatures: ["suitable for oily scalp", "anti-dandruff"], responseLocale: "zh-CN" } });
      expect(next.isError).not.toBe(true);
      expect(next.structuredContent).toMatchObject({ retrieval: { satisfied: 0, awaitingVerification: 1 },
        recovery: { action: "REQUEST_WEB_SEARCH", reason: "REQUIREMENTS_UNVERIFIED" } });
      expect(JSON.stringify(next.content)).toContain("扩大搜索");
      expect((await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: old.renderId } })).isError).not.toBe(true);
    } finally { await replay.close(); }
  });
  it("keeps outages distinct from zero qualified results", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "shampoo", productType: "shampoo", requiredFeatures: ["anti-dandruff"] }), {
      awin: { search: async () => { throw new Error("DATA_SOURCE_UNAVAILABLE"); } }, shopify: { search: async () => searchResult([shampoo()]) }
    });
    expect(result.chromeFallbackEligible).toBe(false);
  });
});
