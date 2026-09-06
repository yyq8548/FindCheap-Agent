import { describe, expect, it, vi } from "vitest";
import { SearchProductsInputSchema, searchProducts } from "../src/search-products.js";
import type { ShopifyProduct, ShopifySearchInput, ShopifySearchResult } from "../src/shopify-client.js";
import type { AwinProductPort } from "../../../packages/awin-feed/src/index.js";
import { createOfficialShopifySearchPort, type OfficialShopifySearchInput } from "../src/shopify-official-store-search.js";

const sourcePageUrl = "https://www.shopdoen.com/products/cornella-dress-black";
const now = "2026-09-06T12:00:00.000Z";
const product: ShopifyProduct = {
  merchantId: "official-www.shopdoen.com", merchant: "DÔEN", brand: "DÔEN", sourceHost: "www.shopdoen.com",
  merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT", evidence: ["reviewed fixture"] },
  handle: "472002", title: "Cornella Dress -- Black", productType: "dress", gtins: [],
  variantDimensions: { Color: "Black", Size: "S" }, matchStatus: "DISCOVERY_MATCH", matchEvidence: [],
  condition: "UNKNOWN", itemPrice: { amountCents: 59_800, currency: "USD" }, availability: "IN_STOCK",
  merchantUrl: `${sourcePageUrl}?variant=472002`, checkedAt: now
};

function ports(sourceOverrides: Partial<ShopifyProduct> = {}, catalogProducts?: ShopifyProduct[]) {
  const sourceProduct = { ...product, ...sourceOverrides };
  const calls: OfficialShopifySearchInput[] = [];
  const queries: string[] = [];
  const awin: AwinProductPort = { search: async () => ({ source: "AWIN_PRODUCT_FEED", coverage: "COMPLETE", snapshotAt: now,
    diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 }, products: [] }) };
  const shopify = { search: vi.fn(async (input: ShopifySearchInput): Promise<ShopifySearchResult> => {
    queries.push(input.query ?? "");
    return { source: "SHOPIFY_GLOBAL_CATALOG", coverage: "COMPLETE", merchantsQueried: 1, merchantsSucceeded: 1,
      comparison: { status: "DISCOVERY_ONLY", evidence: [], merchantCount: 1, offerCount: 1 },
      diagnostics: { apiDurationMs: 1, cacheStatus: "MISS", chromeFallbackEligible: false, queryAttempts: 1,
        fallbackQueryUsed: false, catalogProductsReturned: 1, catalogVariantsReturned: 1, catalogZeroResultAttempts: 0,
        outOfStockProductsExcluded: 0, identityProductsExcluded: 0, irrelevantProductsExcluded: 0,
        conditionProductsExcluded: 0, priceProductsExcluded: 0, trustedMerchantProductsReturned: 1,
        unverifiedMerchantProductsReturned: 0, unverifiedMerchantProductsExcluded: 0, riskyMerchantProductsExcluded: 0,
        merchantTrustRegistryVersion: "fixture", merchantsFailed: 0, coveragePercent: 100, failedMerchantIds: [],
        timedOutMerchantIds: [], registryVersion: "fixture", searchTimeoutMs: 100,
        selectionPolicy: "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE" }, questions: [], products: catalogProducts ?? [sourceProduct] };
  }) };
  const official = createOfficialShopifySearchPort({ fetchDocument: async url => ({ finalUrl: url,
    response: url === `${sourcePageUrl}.js` ? Response.json({ id: 1, currency: "USD", vendor: "DÔEN",
      title: sourceProduct.title, handle: "cornella-dress-black", type: "dress", description: sourceProduct.description ?? "Black Cornella Dress",
      options: [{ name: "Color", position: 1, values: ["Black"] }, { name: "Size", position: 2, values: ["S"] }],
      variants: [{ id: 472002, title: "Black / S", available: true, price: 59800, options: ["Black", "S"] }] })
      : new Response("not found", { status: 404 }) }), clock: { now: () => new Date(now) } });
  return { calls, queries, awin, shopify, officialShopify: { search: async (input: OfficialShopifySearchInput) => {
    calls.push(input); return official.search(input);
  } } };
}

describe("T2 known official URL through public product search", () => {
  it("locks source-proven dimensions of an explicitly selected URL variant, even when absent from its title", async () => {
    const other: ShopifyProduct = { ...product, title: "Classic Dress", merchantId: "reviewed-retailer", merchant: "Reviewed Retailer",
      sourceHost: "reviewed.example", handle: "other", variantDimensions: { Color: "Red", Size: "L" },
      merchantTrust: { level: "ESTABLISHED_RETAILER", verification: "INDEPENDENT", evidence: ["reviewed fixture"] },
      merchantUrl: "https://reviewed.example/products/classic-dress?variant=1", itemPrice: { amountCents: 1000, currency: "USD" } };
    const dependencies = ports({ title: "Classic Dress", description: "A classic dress." }, [other]);
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: `${sourcePageUrl}?variant=472002`, productType: "dress",
      brand: "DÔEN", comparisonMode: "SAME_PRODUCT", compareMerchants: true }), dependencies);
    expect(result.candidates.some(candidate => candidate.shopifyProduct?.sourceHost === "reviewed.example")).toBe(false);
    expect(result.candidates).toHaveLength(1);
    expect(result.resolvedRequest).toMatchObject({ requiredFeatures: expect.arrayContaining(["Black", "S"]), requiredSize: "S" });
  });

  it("does not turn a representative size into a hard requirement without a URL selector", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: sourcePageUrl, productType: "dress",
      brand: "DÔEN", comparisonMode: "SAME_PRODUCT" }), ports());
    expect(result.resolvedRequest?.requiredFeatures ?? []).not.toContain("S");
    expect(result.resolvedRequest?.requiredSize).toBeUndefined();
  });

  it("accepts a reviewed Shopify trailing-slash PDP alias", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: `${sourcePageUrl}/`, productType: "dress",
      brand: "DÔEN", comparisonMode: "SAME_PRODUCT" }), ports());
    expect(result.candidates.some(candidate => candidate.shopifyProduct?.merchantUrl === product.merchantUrl)).toBe(true);
  });

  it("preserves URL syntax at schema intake while normalizing ordinary text punctuation", () => {
    expect(SearchProductsInputSchema.parse({ query: sourcePageUrl }).query).toBe(sourcePageUrl);
    expect(SearchProductsInputSchema.parse({ query: "black / dress" }).query).toBe("black dress");
  });

  it("hydrates the exact URL before compiling source-owned identity and retains Cornella Black", async () => {
    const dependencies = ports();
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: sourcePageUrl, productType: "dress",
      brand: "DÔEN", brandMode: "REQUIRED", requiredFeatures: ["black"], comparisonMode: "SAME_PRODUCT",
      selectionMode: "MERCHANT_DIVERSE", allowAlternatives: false, contextMode: "NEW_PRODUCT", responseLocale: "zh-CN", limit: 8
    }), dependencies);
    expect(result.candidates.some(candidate => candidate.shopifyProduct?.merchantUrl === product.merchantUrl)).toBe(true);
    expect(dependencies.calls[0]?.sourcePageUrl).toBe(sourcePageUrl);
    expect(dependencies.queries.every(query => !/https|shopdoen|\.com|products\//u.test(query))).toBe(true);
    expect(result.candidates.some(candidate => candidate.shopifyProduct?.title.includes("Cornella"))).toBe(true);
  });

  it("does not use a known URL to override a conflicting explicit color", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: sourcePageUrl, productType: "dress",
      brand: "DÔEN", brandMode: "REQUIRED", requiredFeatures: ["red"], comparisonMode: "SAME_PRODUCT", allowAlternatives: false
    }), ports());
    expect(result.candidates).toHaveLength(0);
  });
});
