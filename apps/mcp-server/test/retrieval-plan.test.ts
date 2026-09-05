import { describe, expect, it, vi } from "vitest";
import { parseAwinSearchInput, type AwinProduct, type AwinProductPort } from "../../../packages/awin-feed/src/index.js";
import { SearchProductsInputSchema, resolveSearchIntent, searchProducts } from "../src/search-products.js";
import type { ShopifyPort } from "../src/shopify-client.js";
import { classifySourceFailure } from "../src/source-failure.js";
import { compileSourceQuery } from "../src/retrieval-plan.js";
import { createShopifyGlobalCatalogPort } from "../src/shopify-global-catalog-client.js";
import { classifyShopifyCandidate, productQueryCategoryKeys } from "../src/shopify-match.js";
import { candidateFingerprint, sourceProductFingerprint } from "../src/visual-source-fingerprints.js";
import { mergeSearchRequirements } from "../src/search-requirements-context.js";
import { boundNamedIdentityRequirement } from "../src/named-product-identity.js";
import { evaluateFeature } from "../src/product-constraint-matcher.js";

const checkedAt = "2026-09-05T12:00:00.000Z";
const emptyShopify: ShopifyPort = { search: async () => ({ source: "SHOPIFY_GLOBAL_CATALOG", coverage: "COMPLETE", products: [],
  merchantsQueried: 0, merchantsSucceeded: 0, questions: [],
  comparison: { status: "DISCOVERY_ONLY", evidence: [], merchantCount: 0, offerCount: 0 },
  diagnostics: { apiDurationMs: 0, cacheStatus: "MISS", chromeFallbackEligible: true, queryAttempts: 1, fallbackQueryUsed: false,
    catalogProductsReturned: 0, catalogVariantsReturned: 0, catalogZeroResultAttempts: 1, outOfStockProductsExcluded: 0,
    identityProductsExcluded: 0, irrelevantProductsExcluded: 0, conditionProductsExcluded: 0, priceProductsExcluded: 0,
    trustedMerchantProductsReturned: 0, unverifiedMerchantProductsReturned: 0, unverifiedMerchantProductsExcluded: 0,
    riskyMerchantProductsExcluded: 0, merchantTrustRegistryVersion: "test", merchantsFailed: 0, coveragePercent: 100,
    failedMerchantIds: [], timedOutMerchantIds: [], registryVersion: "test", searchTimeoutMs: 100,
    selectionPolicy: "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE" } }) };
function result(products: AwinProduct[] = []) {
  return { source: "AWIN_PRODUCT_FEED" as const, coverage: "COMPLETE" as const, snapshotAt: checkedAt,
    diagnostics: { feedRows: products.length, validRows: products.length, rejectedRows: 0, queryMatches: products.length, priceProductsExcluded: 0 }, products };
}
const shampoos: AwinProduct[] = [1, 2, 3].map(id => ({ merchantId: String(id), merchant: `Store ${id}`, merchantProductId: String(id),
  title: `Moisturizing shampoo ${id}`, category: "shampoo", matchStatus: "DISCOVERY_MATCH", matchEvidence: ["category matched"], condition: "UNKNOWN",
  itemPrice: { amountCents: 1000 * id, currency: "USD" }, availability: "IN_STOCK", merchantUrl: `https://store${id}.example/products/shampoo`,
  affiliateUrl: `https://www.awin1.com/cread.php?awinmid=${id}&awinaffid=3047955&ued=https%3A%2F%2Fstore${id}.example%2Fproducts%2Fshampoo`, checkedAt }));

describe("bounded source retrieval regression", () => {
  it("reuses category aliases for continuation without inventing categories from candidate-only evidence", () => {
    expect(productQueryCategoryKeys("shampoo 洗发露 洗发水")).toEqual(["shampoo"]);
    expect(productQueryCategoryKeys("wig laptop")).toEqual(["laptop", "wig"]);
    expect(productQueryCategoryKeys("connector hair")).toEqual([]);
    expect(classifyShopifyCandidate("洗发露", { title: "Moisturizing shampoo", productType: "shampoo" }).status).toBe("DISCOVERY_MATCH");
    expect(classifyShopifyCandidate("shampoo", { title: "Short wig", productType: "wig" }).status).toBe("IRRELEVANT");
  });

  it("compiles the actual continued role query and does not pad it with old ordinary wigs", async () => {
    const ordinary = { ...shampoos[0]!, title: "Short human hair wig", category: "wig" };
    const previousInput = SearchProductsInputSchema.parse({ query: "wig", productType: "wig", maxItemPriceCents: 10000 });
    const previousCandidates = (await searchProducts(previousInput, { awin: { search: async () => result([ordinary]) }, shopify: emptyShopify })).candidates;
    const roleInput = mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "Honor of Kings Li Bai wig",
      contextMode: "CONTINUE_PREVIOUS_PRODUCT", requiredFeatures: ["Honor of Kings Li Bai character"] }), previousInput);
    const input = mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "Honor of Kings Li Bai default appearance wig",
      contextMode: "CONTINUE_PREVIOUS_PRODUCT", requiredFeatures: ["default appearance"] }), roleInput);
    const search = vi.fn<AwinProductPort["search"]>(async ({ signal: _signal, ...args }) => {
      parseAwinSearchInput(args); return result([ordinary]);
    });
    const execution = await searchProducts({ ...input, previousCandidates }, { awin: { search }, shopify: emptyShopify });
    expect(search.mock.calls.map(([args]) => args.query)).toEqual(["Honor of Kings Li Bai default wig", "王者荣耀 李白 原皮 假发"]);
    expect(search.mock.calls.every(([args]) => args.maxItemPriceCents === 10000)).toBe(true);
    expect(execution.candidates).toEqual([]);
  });

  it("binds a separate default-appearance feature to the requested role", () => {
    const requirement = boundNamedIdentityRequirement("default appearance", "Honor of Kings Li Bai wig");
    expect(evaluateFeature("王者荣耀 李白 原皮 假发", requirement)).toBe("MATCHED");
    expect(evaluateFeature("Default appearance Han Xin wig", requirement)).toBe("UNKNOWN");
    expect(evaluateFeature("Honor of Kings Li Bai wig. Not the default appearance", requirement)).toBe("CONTRADICTED");
    expect(boundNamedIdentityRequirement("long hair", "Honor of Kings Li Bai wig")).toBe("long hair");
    expect(boundNamedIdentityRequirement("default appearance", "Naruto Sasuke wig")).toBe("default appearance");
  });

  it("keeps EV charging station and branded category requests in discovery", () => {
    for (const brand of [undefined, "Tesla"]) {
      expect(resolveSearchIntent(SearchProductsInputSchema.parse({ query: `${brand ?? ""} EV charging station`.trim(), productType: "EV charging station", brand }))).toBe("CATEGORY_DISCOVERY");
    }
    expect(resolveSearchIntent(SearchProductsInputSchema.parse({ query: "Tesla charging station", productType: "EV charging station", brand: "Tesla" }))).toBe("CATEGORY_DISCOVERY");
    expect(resolveSearchIntent(SearchProductsInputSchema.parse({ query: "Tesla Wall Connector Gen 3", brand: "Tesla", productType: "EV charging station" }))).toBe("EXACT_PRODUCT");
  });

  it("compiles both Li Bai passes without invalid punctuation or bilingual AND queries", async () => {
    const search = vi.fn<AwinProductPort["search"]>(async ({ signal: _signal, ...input }) => { parseAwinSearchInput(input); return result(); });
    const input = SearchProductsInputSchema.parse({ query: "Honor of Kings Li Bai default costume wig 王者荣耀 李白 原皮 假发", productType: "wig",
      requiredFeatures: ["Li Bai (李白) from Honor of Kings (王者荣耀), default appearance"], maxItemPriceCents: 10000 });
    const execution = await searchProducts(input, { awin: { search }, shopify: emptyShopify });
    expect(execution.sourceStatus.awin).toBe("COMPLETE");
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[0]![0].query).not.toMatch(/\p{Script=Han}/u);
    expect(search.mock.calls[1]![0].query).toMatch(/李白/u);
    expect(search.mock.calls[1]![0].query).not.toMatch(/[(),]|Honor of Kings/u);
    expect(input.requiredFeatures).toEqual(["Li Bai (李白) from Honor of Kings (王者荣耀), default appearance"]);
  });

  it("stops after three qualified discovery choices instead of filling eight slots", async () => {
    const search = vi.fn<AwinProductPort["search"]>(async () => result(shampoos));
    const execution = await searchProducts(SearchProductsInputSchema.parse({ query: "shampoo", productType: "shampoo", limit: 8 }), { awin: { search }, shopify: emptyShopify });
    expect(execution.searchPasses).toBe(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(execution.candidateFunnel).toMatchObject({ sourceObservations: 3, sourceUnique: 3, eligibleUnique: 3, recommendableUnique: 3 });
  });

  it("preserves explicit same-product coverage despite three returned offers", async () => {
    const search = vi.fn<AwinProductPort["search"]>(async () => result(shampoos));
    const execution = await searchProducts(SearchProductsInputSchema.parse({ query: "shampoo", comparisonMode: "SAME_PRODUCT", limit: 8 }), { awin: { search }, shopify: emptyShopify });
    expect(execution.searchPasses).toBe(2);
    expect(search).toHaveBeenCalledTimes(2);
    expect(execution.candidateFunnel).toMatchObject({ sourceObservations: 6, sourceUnique: 3, eligibleUnique: 3 });
  });

  it("records observed product hashes before filtering without inventing a global relevance order", async () => {
    const observed = [{ ...shampoos[0]!, title: "Running shoes", category: "shoes" }, shampoos[2]!, shampoos[1]!];
    const execution = await searchProducts(SearchProductsInputSchema.parse({ query: "shampoo", productType: "shampoo" }), {
      awin: { search: async () => result(observed) }, shopify: emptyShopify
    });
    expect(execution.retrievedProductHashes).toEqual(observed.map(product => sourceProductFingerprint("AWIN", product).productHash));
    expect(execution.retrievedProductsTruncated).toBe(false);
    expect(execution.candidates.map(candidate => candidate.awinProduct?.title)).not.toContain("Running shoes");
  });

  it.each(["Honor of Kings Li Bai default wig", "王者荣耀 李白 原皮 假发"])("accepts a reviewed bilingual role identity without claiming exact SKU: %s", async title => {
    const execution = await searchProducts(SearchProductsInputSchema.parse({ query: "Honor of Kings Li Bai default costume wig 王者荣耀 李白 原皮 假发", productType: "wig" }), {
      awin: { search: async () => result([{ ...shampoos[0]!, title, category: "wig" }]) }, shopify: emptyShopify
    });
    expect(execution.candidates).toHaveLength(1);
    expect(execution.candidates[0]!.identityStatus).not.toBe("EXACT");
  });

  it.each(["Honor of Kings Han Xin default wig", "Genshin Impact Li Bai default wig", "王者荣耀 李白 凤求凰 假发"])("rejects a conflicting franchise, character or requested skin even if alternatives are enabled: %s", async title => {
    const execution = await searchProducts(SearchProductsInputSchema.parse({ query: "Honor of Kings Li Bai default costume wig 王者荣耀 李白 原皮 假发", productType: "wig", allowAlternatives: true }), {
      awin: { search: async () => result([{ ...shampoos[0]!, title, category: "wig" }]) }, shopify: emptyShopify
    });
    expect(execution.candidates).toHaveLength(0);
  });

  it("allows independently authorized recovery after a typed transient source failure", async () => {
    const execution = await searchProducts(SearchProductsInputSchema.parse({ query: "wig" }), {
      awin: { search: async () => { throw new DOMException("upstream stalled", "TimeoutError"); } }, shopify: emptyShopify
    });
    expect(execution.chromeFallbackEligible).toBe(true);
    expect(execution.sourceFailures).toContainEqual({ source: "AWIN", kind: "TIMEOUT", retryable: true });
  });

  it.each([
    [400, "SOURCE_REJECTED", false], [429, "RATE_LIMITED", true], [503, "UPSTREAM_ERROR", true]
  ] as const)("classifies provider HTTP %s without leaking private error data", (status, kind, retryable) => {
    const error = new Error("DATA_SOURCE_UNAVAILABLE", { cause: new Error(`Shopify Catalog service returned HTTP ${status}`) });
    expect(classifySourceFailure("SHOPIFY", error)).toEqual({ source: "SHOPIFY", kind, retryable });
  });

  it("does not translate unrelated bilingual text or discard a stable model from retrieval", () => {
    const mixed = "Formal black long dress 蓝色 上衣";
    expect(compileSourceQuery("AWIN", mixed, { pass: 2, identityQuery: mixed, visual: false })).toBe(mixed);
    const model = "Honor of Kings Li Bai WIG1234";
    expect(compileSourceQuery("AWIN", model, { pass: 2, identityQuery: model, visual: false })).toBe(model);
  });

  it("keeps HTTP rejection classification through the real Shopify adapter", async () => {
    const port = createShopifyGlobalCatalogPort({ SHOPIFY_AGENT_PROFILE_URL: "https://profile.example/profile.json" }, {
      fetch: async () => new Response("private upstream error", { status: 503 })
    });
    try {
      await port.search({ query: "wig", limit: 3 });
      expect.fail("expected provider error");
    } catch (error) {
      expect(classifySourceFailure("SHOPIFY", error)).toEqual({ source: "SHOPIFY", kind: "UPSTREAM_ERROR", retryable: true });
      expect(JSON.stringify(classifySourceFailure("SHOPIFY", error))).not.toContain("private");
    }
  });

  it("normalizes the reviewed role aliases at source prefiltering without borrowing identity across fields", () => {
    const query = "Honor of Kings Li Bai default wig";
    expect(classifyShopifyCandidate(query, { title: "王者荣耀 李白 原皮 假发", productType: "wig" }).status).toBe("DISCOVERY_MATCH");
    expect(classifyShopifyCandidate(query, { title: "Honor of Kings wig", description: "Li Bai default wig", productType: "wig" }).status).toBe("IRRELEVANT");
    expect(classifyShopifyCandidate(query, { title: "Not Honor of Kings Li Bai default wig", productType: "wig" }).status).toBe("IRRELEVANT");
  });

  it("rechecks bound old candidates without refreshing their timestamp or overriding new evidence", async () => {
    const previousCandidates = (await searchProducts(SearchProductsInputSchema.parse({ query: "shampoo" }), {
      awin: { search: async () => result(shampoos) }, shopify: emptyShopify
    })).candidates;
    const input = { ...SearchProductsInputSchema.parse({ query: "shampoo", productType: "shampoo", contextMode: "CONTINUE_PREVIOUS_PRODUCT", maxItemPriceCents: 1500 }), previousCandidates };
    const continued = await searchProducts(input, { awin: { search: async () => result() }, shopify: emptyShopify });
    expect(continued.candidates).toHaveLength(1);
    expect(continued.candidates[0]!.awinProduct?.checkedAt).toBe(checkedAt);
    expect(continued.retrievedProductHashes).toEqual([]);
    expect(continued.previousProductHashes).toEqual([candidateFingerprint(continued.candidates[0]!).productHash]);
    const updated = await searchProducts(input, { awin: { search: async () => result([{ ...shampoos[0]!, itemPrice: { amountCents: 2000, currency: "USD" } }]) }, shopify: emptyShopify });
    expect(updated.candidates).toHaveLength(0);
    expect(updated.previousProductHashes).toEqual([]);
    const newGoal = await searchProducts({ ...input, contextMode: "NEW_PRODUCT" }, { awin: { search: async () => result() }, shopify: emptyShopify });
    expect(newGoal.candidates).toHaveLength(0);
  });

  it.each(["Awin search query is invalid", "unapproved Awin merchant URL", "CATALOG_SCHEMA_CHANGED"])("does not allow recovery to conceal invalid or unsafe source data: %s", async message => {
    const execution = await searchProducts(SearchProductsInputSchema.parse({ query: "wig" }), {
      awin: { search: async () => { throw new Error(message); } }, shopify: emptyShopify
    });
    expect(execution.chromeFallbackEligible).toBe(false);
    expect(JSON.stringify(execution.sourceFailures)).not.toContain(message);
  });
});
