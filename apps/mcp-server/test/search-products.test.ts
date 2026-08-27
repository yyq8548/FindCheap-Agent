import { describe, expect, it, vi } from "vitest";

import type { AwinProductPort } from "../../../packages/awin-feed/src/index.js";
import {
  SearchProductsInputSchema,
  shouldQueryAwin,
  searchProducts
} from "../src/search-products.js";
import type { ShopifyPort, ShopifySearchResult } from "../src/shopify-client.js";
import type { EbayBrowsePort } from "../src/ebay-client.js";

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

function ebay(products = [ebayProduct("1", 2100)]): EbayBrowsePort {
  return { search: vi.fn(async () => ({
    source: "EBAY_BROWSE" as const,
    environment: "PRODUCTION" as const,
    coverage: "COMPLETE" as const,
    snapshotAt: now,
    diagnostics: { queryMatches: products.length, itemsReturned: products.length, validItems: products.length, rejectedItems: 0 },
    products
  })) };
}

describe("unified product search", () => {
  it("queries Shopify in parallel even when Awin fills the result", async () => {
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
    expect(shopifyPort.search).toHaveBeenCalledTimes(1);
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
      "SHOPIFY_GLOBAL_CATALOG",
      "SHOPIFY_GLOBAL_CATALOG",
      "AWIN_PRODUCT_FEED"
    ]);
  });

  it("starts Awin, Shopify, and eBay together before any source completes", async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = searchProducts(SearchProductsInputSchema.parse({ query: "headphones", limit: 3 }), {
      awin: { search: vi.fn(async () => { started.push("awin"); await gate; return await awin([]).search({ query: "headphones", limit: 3 }); }) },
      shopify: { search: vi.fn(async () => { started.push("shopify"); await gate; return shopifyResult([]); }) },
      ebay: { search: vi.fn(async () => { started.push("ebay"); await gate; return await ebay([]).search({ query: "headphones", limit: 3 }); }) }
    });

    await vi.waitFor(() => expect(started.sort()).toEqual(["awin", "ebay", "shopify"]));
    release();
    await pending;
  });

  it("prioritizes a verified Coupon before a lower raw price at equal match and trust", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "hair mask", limit: 2 }), {
      awin: awin([]),
      shopify: shopify([shopifyProduct("lower", 1000), shopifyProduct("coupon", 1200)]),
      deals: { search: vi.fn(async ({ merchant }) => merchant === "Merchant coupon" ? [verifiedCoupon(merchant)] : []) }
    });

    expect(result.candidates.map((candidate) => candidate.shopifyProduct?.handle)).toEqual(["coupon", "lower"]);
    expect(result.candidates[0]?.verifiedCoupons).toHaveLength(1);
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

  it("does not infer NEW when the query has no explicit condition", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "Apple MacBook Pro",
      limit: 1,
      conditionPreference: "NEW"
    }), { awin: awin([]), shopify: shopify([shopifyProduct("macbook", 199_900)]) });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.shopifyProduct?.condition).toBe("UNKNOWN");
  });

  it("rejects UNKNOWN affiliate condition when NEW is explicitly required", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "全新 hair mask",
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

  it("preserves a catalog schema-change error and does not retry the incompatible response", async () => {
    const search = vi.fn(async () => {
      throw new Error("CATALOG_SCHEMA_CHANGED");
    });

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "everyday ballet flats",
      limit: 3
    }), { awin: awin([]), shopify: { search } });

    expect(result.candidates).toEqual([]);
    expect(result.sourceStatus.shopify).toBe("UNAVAILABLE");
    expect(result.sourceErrors).toEqual({ shopify: "CATALOG_SCHEMA_CHANGED" });
    expect(result.chromeFallbackEligible).toBe(false);
    expect(search).toHaveBeenCalledTimes(1);
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

  it("normalizes inch notation in titles and variant dimensions", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "MacBook Pro",
      limit: 3,
      features: ["14-inch display"],
      featureMode: "REQUIRED"
    }), {
      awin: awin([]),
      shopify: shopify([
        shopifyProduct("hyphen", 199_900, "UNKNOWN", { title: "MacBook Pro 14-inch M4" }),
        shopifyProduct("quote", 209_900, "UNKNOWN", { title: "MacBook Pro 14\" M4 Pro" }),
        shopifyProduct("variant", 219_900, "UNKNOWN", {
          title: "MacBook Pro M4 Pro",
          variantDimensions: { Size: "14 inch" }
        })
      ])
    });

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.every((candidate) =>
      candidate.featureEvidence.includes("14-inch display")
    )).toBe(true);
    expect(result.featureProductsExcluded).toBe(0);
  });

  it("counts unique products excluded by required features across both passes", async () => {
    const rejected = shopifyProduct("thirteen-inch", 149_900, "UNKNOWN", {
      title: "MacBook Pro 13-inch"
    });
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "MacBook Pro",
      limit: 3,
      features: ["14-inch display"],
      featureMode: "REQUIRED"
    }), {
      awin: awin([]),
      shopify: shopify([rejected])
    });

    expect(result.candidates).toEqual([]);
    expect(result.searchPasses).toBe(2);
    expect(result.featureProductsExcluded).toBe(1);
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

  it("keeps missing hard-feature evidence as a limited DISCOVERY_MATCH", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "women shoes",
      productType: "ballet flats",
      requiredFeatures: ["leather"],
      preferences: ["日常穿"]
    }), {
      awin: awin([]),
      shopify: shopify([shopifyProduct("flat-unknown", 7900, "UNKNOWN", {
        title: "Classic ballet flat",
        productType: "Women's flats",
        description: "Simple slip-on design"
      })])
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.shopifyProduct?.matchStatus).toBe("DISCOVERY_MATCH");
    expect(result.candidates[0]?.requiredFeatureLimitations).toEqual(["leather"]);
    expect(result.featureProductsExcluded).toBe(0);
  });

  it("uses title, category, description, and structured attributes as feature evidence", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "women shoes",
      productType: "flat shoes",
      requiredFeatures: ["皮质", "平底鞋"]
    }), {
      awin: awin([]),
      shopify: shopify([shopifyProduct("leather-flat", 9900, "UNKNOWN", {
        title: "Women's everyday shoe",
        productType: "Ballet flats",
        description: "Genuine leather upper",
        variantDimensions: { Construction: "flat sole" }
      })])
    });

    expect(result.candidates[0]?.featureEvidence).toEqual(["皮质", "平底鞋"]);
    expect(result.candidates[0]?.requiredFeatureLimitations).toEqual([]);
  });

  it("excludes explicit conflicts but never filters on a subjective preference", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "women shoes",
      productType: "flat shoes",
      requiredFeatures: ["flat sole"],
      preferences: ["日常穿"]
    }), {
      awin: awin([]),
      shopify: shopify([
        shopifyProduct("heels", 6000, "UNKNOWN", { title: "Women's high heel pump" }),
        shopifyProduct("plain-flat", 6500, "UNKNOWN", { title: "Women's ballet flat" }),
        shopifyProduct("daily-flat", 7000, "UNKNOWN", { title: "Women's everyday casual ballet flat" })
      ])
    });

    expect(result.candidates.map((candidate) => candidate.shopifyProduct?.handle)).toEqual([
      "daily-flat",
      "plain-flat"
    ]);
    expect(result.candidates[0]?.preferenceEvidence).toEqual(["日常穿"]);
    expect(result.featureProductsExcluded).toBe(1);
  });

  it("adds productType to the initial source query", async () => {
    const shopifySearch = vi.fn(async () => shopifyResult([shopifyProduct("flat", 5000)]));
    await searchProducts(SearchProductsInputSchema.parse({
      query: "women black",
      productType: "ballet flats"
    }), { awin: awin([]), shopify: { search: shopifySearch } });

    expect(shopifySearch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      query: "women black ballet flats"
    }));
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

  it("queries Awin for every valid product category", () => {
    expect(shouldQueryAwin("角蛋白发膜")).toBe(true);
    expect(shouldQueryAwin("GardePro trail camera")).toBe(true);
    expect(shouldQueryAwin("野生动物相机")).toBe(true);
    expect(shouldQueryAwin("Watches Of USA 手表")).toBe(true);
    expect(shouldQueryAwin("SNFLEX macerating toilet")).toBe(true);
    expect(shouldQueryAwin("36 inch bathroom vanity")).toBe(true);
    expect(shouldQueryAwin("淋浴门")).toBe(true);
    expect(shouldQueryAwin("Sony headphones")).toBe(true);
    expect(shouldQueryAwin("digital camera")).toBe(true);
    expect(shouldQueryAwin(" ")).toBe(false);
  });

  it("includes eBay by price without treating EPN as seller trust", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "headphones",
      limit: 3,
      selectionMode: "LOWEST_PRICE"
    }), {
      awin: awin([awinProduct("1", 3000)]),
      ebay: ebay([ebayProduct("1", 900)]),
      shopify: shopify([shopifyProduct("101", 1200)])
    });

    expect(result.candidates.map((candidate) => candidate.source)).toEqual([
      "EBAY_BROWSE",
      "SHOPIFY_GLOBAL_CATALOG",
      "AWIN_PRODUCT_FEED"
    ]);
    expect(result.candidates[0]).toMatchObject({
      affiliateState: "APPROVED",
      recommendationTier: "GENERAL_UNVERIFIED",
      ebayProduct: { sellerName: "seller-1" }
    });
    expect(result.sourceStatus.ebay).toBe("COMPLETE");
  });

  it("fails closed for Chrome when configured eBay is unavailable", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "headphones", limit: 3 }), {
      awin: awin([]),
      ebay: { search: vi.fn(async () => { throw new Error("offline"); }) },
      shopify: shopify([])
    });

    expect(result.sourceErrors).toMatchObject({ ebay: "DATA_SOURCE_UNAVAILABLE" });
    expect(result.chromeFallbackEligible).toBe(false);
  });

  it("skips eBay without degrading coverage when the gateway is not configured", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "headphones", limit: 3 }), {
      awin: awin([]),
      ebay: { search: vi.fn(async () => { throw new Error("SOURCE_NOT_CONFIGURED"); }) },
      shopify: shopify([])
    });

    expect(result.sourceStatus.ebay).toBe("SKIPPED");
    expect(result.sourceErrors).toBeUndefined();
    expect(result.chromeFallbackEligible).toBe(true);
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

function ebayProduct(id: string, amountCents: number) {
  return {
    environment: "PRODUCTION" as const,
    itemId: `v1|${id}|0`,
    productRef: `ebay-${id.padStart(32, "0")}`,
    title: `eBay headphones ${id}`,
    category: "Headphones",
    attributes: [],
    sellerName: `seller-${id}`,
    matchStatus: "DISCOVERY_MATCH" as const,
    matchEvidence: ["live eBay fixed-price listing returned by Browse API"],
    condition: "NEW" as const,
    itemPrice: { amountCents, currency: "USD" as const },
    availability: "UNKNOWN" as const,
    merchantUrl: `https://www.ebay.com/itm/${id}`,
    affiliateUrl: `https://www.ebay.com/itm/${id}?campid=5339000012`,
    checkedAt: now
  };
}

function verifiedCoupon(merchant: string) {
  return {
    dealId: `coupon:${merchant}`,
    merchant,
    kind: "PROMO_CODE" as const,
    title: "20% off",
    description: "Verified merchant promotion",
    code: "SAVE20",
    discountPercent: 20,
    eligibility: ["Online only"],
    channels: ["ONLINE" as const],
    sourceUrl: "https://www.awin1.com/promotion",
    checkedAt: "2026-08-24T12:00:00.000Z",
    validFrom: "2026-08-24T00:00:00.000Z",
    validTo: "2026-08-30T00:00:00.000Z",
    verificationStatus: "VERIFIED" as const
  };
}
