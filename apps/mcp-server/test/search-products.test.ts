import { describe, expect, it, vi } from "vitest";

import type { AwinProductPort } from "../../../packages/awin-feed/src/index.js";
import {
  SearchProductsInputSchema,
  isApprovedAffiliateQuery,
  searchProducts
} from "../src/search-products.js";
import type { ShopifyPort, ShopifySearchResult } from "../src/shopify-client.js";

const now = "2026-08-24T12:00:00.000Z";

function awin(products = [awinProduct("mask-1", 1800)]): AwinProductPort {
  return {
    search: vi.fn(async () => ({
      source: "AWIN_PRODUCT_FEED" as const,
      coverage: "COMPLETE" as const,
      snapshotAt: now,
      diagnostics: {
        feedRows: products.length,
        validRows: products.length,
        rejectedRows: 0,
        queryMatches: products.length,
        priceProductsExcluded: 0
      },
      products
    }))
  };
}

function shopify(products = [shopifyProduct("101", 2500)]): ShopifyPort {
  return { search: vi.fn(async () => shopifyResult(products)) };
}

describe("unified product search", () => {
  it("routes approved hair queries to Awin first and skips Shopify when filled", async () => {
    const awinPort = awin([
      awinProduct("1", 1800),
      awinProduct("2", 1900),
      awinProduct("3", 2000)
    ]);
    const shopifyPort = shopify();

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "keratin hair mask",
      limit: 3
    }), { awin: awinPort, shopify: shopifyPort });

    expect(result.candidates.map((candidate) => candidate.source)).toEqual([
      "AWIN_PRODUCT_FEED",
      "AWIN_PRODUCT_FEED",
      "AWIN_PRODUCT_FEED"
    ]);
    expect(shopifyPort.search).not.toHaveBeenCalled();
  });

  it("fills missing affiliate results with Shopify without commission scoring", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "护发 发膜",
      limit: 3
    }), {
      awin: awin([awinProduct("1", 3000)]),
      shopify: shopify([shopifyProduct("101", 1000), shopifyProduct("102", 1200)])
    });

    expect(result.candidates.map((candidate) => candidate.source)).toEqual([
      "AWIN_PRODUCT_FEED",
      "SHOPIFY_GLOBAL_CATALOG",
      "SHOPIFY_GLOBAL_CATALOG"
    ]);
  });

  it("uses cross-source price order only for explicit LOWEST_PRICE", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "hair mask",
      limit: 2,
      selectionMode: "LOWEST_PRICE"
    }), {
      awin: awin([awinProduct("1", 3000)]),
      shopify: shopify([shopifyProduct("101", 1000)])
    });

    expect(result.candidates.map((candidate) => candidate.source)).toEqual([
      "SHOPIFY_GLOBAL_CATALOG",
      "AWIN_PRODUCT_FEED"
    ]);
  });

  it("rejects UNKNOWN affiliate condition when NEW is required", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "hair mask",
      limit: 1,
      conditionPreference: "NEW"
    }), { awin: awin(), shopify: shopify([shopifyProduct("101", 2500, "NEW")]) });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.source).toBe("SHOPIFY_GLOBAL_CATALOG");
  });

  it("fails closed for Chrome when a queried source is unavailable", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "hair mask",
      limit: 3
    }), {
      awin: { search: vi.fn(async () => { throw new Error("offline"); }) },
      shopify: shopify([])
    });

    expect(result.candidates).toEqual([]);
    expect(result.chromeFallbackEligible).toBe(false);
  });

  it("runs one feature-enriched expansion before Chrome and accepts minimum capacity", async () => {
    const shopifySearch = vi.fn()
      .mockResolvedValueOnce(shopifyResult([]))
      .mockResolvedValueOnce(shopifyResult([
        shopifyProduct("macbook-36", 329_900, "NEW", {
          title: "Apple MacBook Pro M5 Pro 16.2-inch 36GB",
          variantDimensions: { Memory: "36GB", Display: "16.2 inch" }
        })
      ]));

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "Apple MacBook Pro M5 Pro",
      limit: 3,
      conditionPreference: "NEW",
      features: ["at least 32GB", "16 inch", "M5 Pro"],
      featureMode: "REQUIRED"
    }), { awin: awin([]), shopify: { search: shopifySearch } });

    expect(shopifySearch).toHaveBeenCalledTimes(2);
    expect(shopifySearch.mock.calls[1]?.[0]).toMatchObject({
      query: "Apple MacBook Pro M5 Pro at least 32GB 16 inch M5 Pro",
      limit: 12
    });
    expect(result.searchPasses).toBe(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.featureEvidence).toEqual(["at least 32GB", "16 inch", "M5 Pro"]);
    expect(result.chromeFallbackEligible).toBe(false);
  });

  it("uses a broader feature query for paraphrased product needs", async () => {
    const shopifySearch = vi.fn()
      .mockResolvedValueOnce(shopifyResult([]))
      .mockResolvedValueOnce(shopifyResult([
        shopifyProduct("repair-conditioner", 2200, "NEW", {
          title: "Repair Conditioner for Dry Damaged Hair"
        })
      ]));

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "conditioner",
      features: ["repair dry damaged hair"],
      featureMode: "REQUIRED"
    }), { awin: awin([]), shopify: { search: shopifySearch } });

    expect(shopifySearch.mock.calls[1]?.[0].query).toBe("conditioner repair dry damaged hair");
    expect(result.candidates).toHaveLength(1);
  });

  it("orders trusted, qualified high-rated, then general unverified merchants", async () => {
    const highRated = shopifyProduct("high-rated", 1000, "NEW", {
      merchantTrust: {
        level: "UNKNOWN",
        verification: "UNVERIFIED",
        evidence: ["no independent merchant trust evidence"]
      },
      productRating: { value: 3.9, count: 2, scaleMax: 5 }
    });
    const general = shopifyProduct("general", 900, "NEW", {
      merchantTrust: {
        level: "UNKNOWN",
        verification: "UNVERIFIED",
        evidence: ["no independent merchant trust evidence"]
      },
      productRating: { value: 5, count: 1, scaleMax: 5 }
    });
    const trusted = shopifyProduct("trusted", 3000, "NEW");
    const shopifySearch = vi.fn(async () => shopifyResult([general, highRated, trusted]));

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "cat toy",
      limit: 3
    }), { awin: awin([]), shopify: { search: shopifySearch } });

    expect(shopifySearch).toHaveBeenCalledTimes(1);
    expect(result.candidates.map((candidate) => candidate.recommendationTier)).toEqual([
      "TRUSTED_OR_AFFILIATE",
      "HIGH_RATED_UNVERIFIED",
      "GENERAL_UNVERIFIED"
    ]);
    expect(result.chromeFallbackEligible).toBe(false);
  });

  it("does not promote a 3.8 rating or a product with only one review", async () => {
    const unknown = (handle: string, value: number, count: number) => shopifyProduct(handle, 1000, "NEW", {
      merchantTrust: {
        level: "UNKNOWN",
        verification: "UNVERIFIED",
        evidence: ["no independent merchant trust evidence"]
      },
      productRating: { value, count, scaleMax: 5 }
    });
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "cat toy",
      limit: 3
    }), {
      awin: awin([]),
      shopify: shopify([
        unknown("qualified", 3.81, 2),
        unknown("threshold", 3.8, 50),
        unknown("one-review", 5, 1)
      ])
    });

    expect(result.candidates.map((candidate) => candidate.recommendationTier)).toEqual([
      "HIGH_RATED_UNVERIFIED",
      "GENERAL_UNVERIFIED",
      "GENERAL_UNVERIFIED"
    ]);
  });

  it("recognizes only approved affiliate category signals", () => {
    expect(isApprovedAffiliateQuery("角蛋白发膜")).toBe(true);
    expect(isApprovedAffiliateQuery("Sony headphones")).toBe(false);
  });
});

function awinProduct(id: string, amountCents: number) {
  return {
    merchantId: "20282",
    merchant: "Amazonliss (US)",
    merchantProductId: id,
    title: `Keratin hair mask ${id}`,
    category: "Hair care",
    matchStatus: "DISCOVERY_MATCH" as const,
    matchEvidence: ["approved Awin feed"],
    condition: "UNKNOWN" as const,
    itemPrice: { amountCents, currency: "USD" as const },
    availability: "IN_STOCK" as const,
    merchantUrl: `https://www.nutreecosmetics.com/products/${id}`,
    affiliateUrl: `https://www.awin1.com/cread.php?awinmid=20282&awinaffid=3047955&ued=https%3A%2F%2Fwww.nutreecosmetics.com%2Fproducts%2F${id}`,
    checkedAt: now
  };
}

function shopifyProduct(
  handle: string,
  amountCents: number,
  condition: "NEW" | "UNKNOWN" = "UNKNOWN",
  overrides: Record<string, unknown> = {}
) {
  return {
    merchantId: `merchant-${handle}`,
    merchant: `Merchant ${handle}`,
    sourceHost: `merchant-${handle}.example`,
    merchantTrust: {
      level: "ESTABLISHED_RETAILER" as const,
      verification: "INDEPENDENT" as const,
      evidence: ["test"]
    },
    handle,
    title: `Keratin hair mask ${handle}`,
    gtins: [],
    variantDimensions: {},
    matchStatus: "DISCOVERY_MATCH" as const,
    matchEvidence: ["query terms"],
    condition,
    itemPrice: { amountCents, currency: "USD" as const },
    availability: "IN_STOCK" as const,
    merchantUrl: `https://merchant-${handle}.example/products/${handle}`,
    checkedAt: now,
    ...overrides
  };
}

function shopifyResult(products: ReturnType<typeof shopifyProduct>[]): ShopifySearchResult {
  return {
    source: "SHOPIFY_GLOBAL_CATALOG",
    coverage: "COMPLETE",
    merchantsQueried: products.length,
    merchantsSucceeded: products.length,
    comparison: {
      status: "DISCOVERY_ONLY",
      evidence: [],
      merchantCount: products.length,
      offerCount: products.length
    },
    diagnostics: {
      apiDurationMs: 1,
      cacheStatus: "MISS",
      chromeFallbackEligible: products.length === 0,
      queryAttempts: 1,
      fallbackQueryUsed: false,
      catalogProductsReturned: products.length,
      catalogVariantsReturned: products.length,
      catalogZeroResultAttempts: products.length === 0 ? 1 : 0,
      outOfStockProductsExcluded: 0,
      identityProductsExcluded: 0,
      irrelevantProductsExcluded: 0,
      conditionProductsExcluded: 0,
      priceProductsExcluded: 0,
      trustedMerchantProductsReturned: products.length,
      unverifiedMerchantProductsReturned: 0,
      unverifiedMerchantProductsExcluded: 0,
      riskyMerchantProductsExcluded: 0,
      merchantTrustRegistryVersion: "test",
      merchantsFailed: 0,
      coveragePercent: 100,
      failedMerchantIds: [],
      timedOutMerchantIds: [],
      registryVersion: "test",
      searchTimeoutMs: 100,
      selectionPolicy: "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE"
    },
    questions: [],
    products
  };
}
