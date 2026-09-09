import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AwinProductPort } from "../../../packages/awin-feed/src/index.js";
import { WooProductSchema, WooSearchResultSchema, type WooProduct, type WooSearchResult } from "../../../packages/contracts/src/woocommerce.js";
import { candidateKey } from "../src/product-candidate-ranking.js";
import { SearchProductsInputSchema, searchProducts, type SearchProductsInput } from "../src/search-products.js";
import type { ShopifyPort, ShopifyProduct, ShopifySearchResult } from "../src/shopify-client.js";
import type { WooCommerceCatalogPort } from "../src/woocommerce-client.js";

// Approved fixed denominator: 18 category + 10 known identity + 8 variant/package + 4 negative.
// Observations are synthetic, except the independently recorded La Marzocco and Offerman facts.
// These assertions exercise the public search seam; they do not certify live merchants or native host UX.
const observedAt = "2026-09-08T15:34:17.000Z";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-08T15:35:00.000Z"));
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("DETERMINISTIC_ACCEPTANCE_FORBIDS_NETWORK"); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function product(overrides: Partial<WooProduct> = {}): WooProduct {
  return WooProductSchema.parse({
    sourceKind: "WOOCOMMERCE_STORE_API", merchantId: "fixture-shop", merchantName: "Fixture Shop",
    sourceHost: "fixture-shop.example", productId: 1001, title: "Keratin hair mask", category: "hair mask",
    productType: "simple", condition: "NEW", attributes: [], variantDimensions: {}, selectedAttributes: {},
    merchantUrl: "https://fixture-shop.example/product/1001", images: [],
    itemPrice: { amountCents: 2200, currency: "USD" },
    priceEvidence: { amountMinor: "2200", currency: "USD", currencyMinorUnit: 2, scope: "PRODUCT", taxBasis: "UNKNOWN" },
    availability: "IN_STOCK", availabilityScope: "PRODUCT",
    rating: { value: 4.7, reviewCount: 25, scale: 5, productId: overrides.productId ?? 1001 }, checkedAt: observedAt,
    ...overrides
  });
}

function priced(amountCents: number): Pick<WooProduct, "itemPrice" | "priceEvidence"> {
  return { itemPrice: { amountCents, currency: "USD" }, priceEvidence: {
    amountMinor: String(amountCents), currency: "USD", currencyMinorUnit: 2, scope: "PRODUCT", taxBasis: "UNKNOWN"
  } };
}

function variant(overrides: Partial<WooProduct> = {}): WooProduct {
  const selectedAttributes = overrides.selectedAttributes ?? { Color: "Black", Size: "US 7" };
  const defaultUrl = new URL("https://fixture-shop.example/product/ballet-flats");
  defaultUrl.searchParams.set("variation_id", String(overrides.variationId ?? 2001));
  for (const [key, value] of Object.entries(selectedAttributes)) defaultUrl.searchParams.set(`attribute_${key.toLowerCase()}`, value);
  return product({ productId: 2000, parentProductId: 2000, variationId: 2001, productType: "variation",
    title: "Fixture ballet flats", category: "ballet flats", selectedAttributes,
    variantDimensions: { Color: ["Black", "Red"], Size: ["US 7", "US 8"] },
    merchantUrl: defaultUrl.href,
    priceEvidence: { amountMinor: "2200", currency: "USD", currencyMinorUnit: 2, scope: "VARIANT", taxBasis: "UNKNOWN" },
    availabilityScope: "VARIANT", ...overrides });
}

function wooResult(products: WooProduct[], status: WooSearchResult["status"] = "COMPLETE"): WooSearchResult {
  const failed = status === "PARTIAL" || status === "UNAVAILABLE";
  const succeeded = status === "UNAVAILABLE" ? 0 : 1;
  return WooSearchResultSchema.parse({ source: "WOOCOMMERCE_STORE_API", schemaVersion: 1,
    registryVersion: "business-cases-v1", requestId: "business-case", snapshotAt: observedAt, status, products,
    stores: [...(succeeded ? [{ merchantId: "fixture-shop", status: "COMPLETE", requests: 1, returned: products.length }] : []),
      ...(failed ? [{ merchantId: "timed-out-shop", status: "UNAVAILABLE", reason: "TIMEOUT", requests: 1, returned: 0 }] : [])],
    diagnostics: { eligibleStores: succeeded + Number(failed), plannedStores: succeeded + Number(failed),
      attemptedStores: succeeded + Number(failed), succeededStores: succeeded, failedStores: Number(failed), skippedStores: 0,
      physicalRequests: succeeded + Number(failed), responseBytes: 400, cacheHits: 0, elapsedMs: 5,
      truncated: false, registryCoverageComplete: !failed } });
}

function shopifyResult(products: ShopifyProduct[] = []): ShopifySearchResult {
  return { source: "SHOPIFY_GLOBAL_CATALOG", coverage: "COMPLETE", merchantsQueried: products.length,
    merchantsSucceeded: products.length, comparison: { status: "DISCOVERY_ONLY", evidence: [], merchantCount: products.length, offerCount: products.length },
    diagnostics: { apiDurationMs: 1, cacheStatus: "MISS", chromeFallbackEligible: false, queryAttempts: 1,
      fallbackQueryUsed: false, catalogProductsReturned: products.length, catalogVariantsReturned: products.length,
      catalogZeroResultAttempts: products.length === 0 ? 1 : 0, outOfStockProductsExcluded: 0, identityProductsExcluded: 0,
      irrelevantProductsExcluded: 0, conditionProductsExcluded: 0, priceProductsExcluded: 0,
      trustedMerchantProductsReturned: 0, unverifiedMerchantProductsReturned: products.length,
      unverifiedMerchantProductsExcluded: 0, riskyMerchantProductsExcluded: 0, merchantTrustRegistryVersion: "fixture",
      merchantsFailed: 0, coveragePercent: 100, failedMerchantIds: [], timedOutMerchantIds: [], registryVersion: "fixture",
      searchTimeoutMs: 100, selectionPolicy: "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE" },
    questions: [], products };
}

function sameScalarShopifyProduct(): ShopifyProduct {
  return { merchantId: "fixture-shop", merchant: "Fixture Shop", sourceHost: "fixture-shop.example", handle: "1001",
    merchantTrust: { level: "UNKNOWN", verification: "UNVERIFIED", evidence: ["synthetic unverified merchant"] },
    title: "Keratin hair mask", productType: "hair mask", gtins: [], variantDimensions: {},
    matchStatus: "DISCOVERY_MATCH", matchEvidence: ["synthetic public catalog observation"], condition: "NEW",
    itemPrice: { amountCents: 2400, currency: "USD" }, availability: "IN_STOCK",
    merchantUrl: "https://fixture-shop.example/products/1001", checkedAt: observedAt,
    productRating: { value: 4.8, count: 25, scaleMax: 5 } };
}

function ports(products: WooProduct[], options: { status?: WooSearchResult["status"]; gate?: Promise<void>; successfulPeers?: boolean } = {}) {
  const started: string[] = [];
  const awinSearch = vi.fn<AwinProductPort["search"]>(async () => {
    started.push("AWIN"); await options.gate;
    return { source: "AWIN_PRODUCT_FEED", coverage: "COMPLETE", snapshotAt: observedAt,
      diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 }, products: [] };
  });
  const shopifySearch = vi.fn<ShopifyPort["search"]>(async () => {
    started.push("SHOPIFY"); await options.gate; return shopifyResult(options.successfulPeers ? [sameScalarShopifyProduct()] : []);
  });
  const wooSearch = vi.fn<WooCommerceCatalogPort["search"]>(async () => {
    started.push("WOOCOMMERCE"); await options.gate; return wooResult(products, options.status);
  });
  return { awin: { search: awinSearch }, shopify: { search: shopifySearch }, woocommerce: { search: wooSearch }, started };
}

const categories = [
  ["C01", "hair mask", "Keratin hair mask", 2200, "parallel"],
  ["C02", "shampoo", "Gentle shampoo", 1300, "partial"],
  ["C03", "conditioner", "Moisturizing conditioner", 1500, "merchant-ids"],
  ["C04", "face moisturizer", "Daily face moisturizer", 2400, "ordinary"],
  ["C05", "sunscreen", "Daily sunscreen", 1800, "ordinary"],
  ["C06", "facial cleanser", "Gentle facial cleanser", 1600, "ordinary"],
  ["C07", "serum", "Hydrating facial serum", 4800, "ordinary"],
  ["C08", "water bottle", "Wide mouth water bottle", 1899, "ordinary"],
  ["C09", "travel mug", "Insulated travel mug", 2600, "ordinary"],
  ["C10", "coffee grinder", "Electric burr coffee grinder", 9900, "ordinary"],
  ["C11", "coffee filter", "Reusable coffee filter", 1200, "ordinary"],
  ["C12", "mechanical keyboard", "Mechanical keyboard", 7900, "ordinary"],
  ["C13", "wireless mouse", "Ergonomic wireless mouse", 2900, "ordinary"],
  ["C14", "ballet flats", "Black ballet flats", 6900, "ordinary"],
  ["C15", "running shoes", "Road running shoes", 8900, "ordinary"],
  ["C16", "t-shirt", "Cotton t-shirt", 2500, "ordinary"],
  ["C17", "book", "Paperback book", 2000, "ordinary"],
  ["C18", "trivet", "Walnut kitchen trivet", 7500, "ordinary"]
] as const;

describe("WooCommerce business acceptance: 18 category cases", () => {
  it.each(categories)("%s: unbranded %s reaches the independent source", async (_id, category, title, cents, mode) => {
    const first = product({ title, category, ...priced(cents) });
    const observations = mode === "merchant-ids" ? [first, product({ ...first, merchantId: "second-shop",
      merchantName: "Second Shop", sourceHost: "second-shop.example", merchantUrl: "https://second-shop.example/product/1001" })] : [first];
    let release = () => {};
    const gate = { promise: new Promise<void>(resolve => { release = resolve; }), resolve: () => release() };
    const source = ports(observations, { ...(mode === "partial" ? { status: "PARTIAL" } : {}),
      ...(mode === "parallel" ? { gate: gate.promise, successfulPeers: true } : {}) });
    const task = searchProducts(SearchProductsInputSchema.parse({ query: category, productType: category, limit: 3 }), source);
    if (mode === "parallel") {
      try { await vi.waitFor(() => expect(new Set(source.started)).toEqual(new Set(["AWIN", "SHOPIFY", "WOOCOMMERCE"]))); }
      finally { gate.resolve(); }
    }
    const result = await task;
    expect(result.searchIntent).toBe("CATEGORY_DISCOVERY");
    const found = result.candidates.filter(candidate => candidate.source === "WOOCOMMERCE_STORE_API");
    expect(found).toHaveLength(mode === "merchant-ids" ? 2 : 1);
    expect(found[0]?.woocommerceProduct).toMatchObject({ sourceKind: "WOOCOMMERCE_STORE_API", title,
      itemPrice: { amountCents: cents, currency: "USD" }, checkedAt: observedAt });
    expect(found.every(candidate => candidate.shopifyProduct === undefined)).toBe(true);
    expect(found.every(candidate => candidate.recommendationTier === "HIGH_RATED_UNVERIFIED")).toBe(true);
    expect(source.woocommerce.search.mock.calls[0]?.[0]).toMatchObject({ market: "US", currency: "USD" });
    expect(source.woocommerce.search.mock.calls[0]?.[0].brand).toBeUndefined();
    expect(source.woocommerce.search.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(result.sourcePassDiagnostics[0]?.sourceQueries?.woocommerce).toBeTruthy();
    expect(result.sourceStatus.woocommerce).toBe(mode === "partial" ? "PARTIAL" : "COMPLETE");
    if (mode === "partial") expect(result.sourceFailures).toContainEqual(expect.objectContaining({ source: "WOOCOMMERCE", kind: "TIMEOUT", retryable: true }));
    if (mode === "parallel") {
      expect(result.candidates.some(candidate => candidate.source === "SHOPIFY_GLOBAL_CATALOG")).toBe(true);
      expect(new Set(result.candidates.map(candidateKey)).size).toBe(result.candidates.length);
      expect(result.sourcePassDiagnostics[0]?.rawProducts).toMatchObject({ shopify: 1, woocommerce: 1 });
    }
    if (mode === "merchant-ids") expect(new Set(found.map(candidateKey)).size).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  });
});

type IdentityCase = { id: string; description: string; input: Partial<SearchProductsInput> & { query: string };
  observations: () => WooProduct[]; expectedIds: number[]; expectedMerchants?: number };
const identities: IdentityCase[] = [
  { id: "I01", description: "GTIN exact match excludes another barcode", input: { query: "4006381333931" },
    observations: () => [product({ gtin: "4006381333931" }), product({ productId: 1002, gtin: "5901234123457" })], expectedIds: [1001] },
  { id: "I02", description: "missing GTIN does not establish barcode identity", input: { query: "4006381333931" },
    observations: () => [product()], expectedIds: [] },
  { id: "I03", description: "previous headphone generation is excluded", input: { query: "Sony WH-1000XM5", brand: "Sony", productType: "headphones" },
    observations: () => [product({ title: "Sony WH-1000XM4 headphones", category: "headphones", brand: "Sony", mpn: "WH-1000XM4" })], expectedIds: [] },
  { id: "I04", description: "headphones exclude their carrying case", input: { query: "Sony WH-1000XM5 headphones", brand: "Sony", productType: "headphones" },
    observations: () => [product({ title: "Sony WH-1000XM5 headphones", category: "headphones", brand: "Sony", mpn: "WH-1000XM5" }),
      product({ productId: 1002, title: "Carrying case for Sony WH-1000XM5 headphones", category: "headphone carrying case", brand: "Sony" })], expectedIds: [1001] },
  { id: "I05", description: "requested brand cannot be supplied by another brand", input: { query: "Sony WH-1000XM5 headphones", brand: "Sony", productType: "headphones" },
    observations: () => [product({ title: "WH-1000XM5 headphones", category: "headphones", brand: "Other Brand" })], expectedIds: [] },
  { id: "I06", description: "vacuum model exact match excludes V8", input: { query: "Dyson V15 Detect vacuum", brand: "Dyson", productType: "vacuum" },
    observations: () => [product({ title: "Dyson V15 Detect vacuum", category: "vacuum", brand: "Dyson", mpn: "V15" }),
      product({ productId: 1002, title: "Dyson V8 vacuum", category: "vacuum", brand: "Dyson", mpn: "V8" })], expectedIds: [1001] },
  { id: "I07", description: "manufacturer model number anchors the blender", input: { query: "Fixture NB-PRO900 blender", brand: "Fixture", productType: "blender" },
    observations: () => [product({ title: "Fixture NB-PRO900 blender", brand: "Fixture", category: "blender", mpn: "NB-PRO900" })], expectedIds: [1001] },
  { id: "I08", description: "a selected Woo product URL survives source retrieval", input: { query: "https://fixture-shop.example/product/fixture-serum", productType: "serum" },
    observations: () => [product({ title: "Fixture serum", category: "serum", merchantUrl: "https://fixture-shop.example/product/fixture-serum" })], expectedIds: [1001] },
  { id: "I09", description: "named edition does not accept a different edition", input: { query: "Apple AirPods Pro 2 earbuds", brand: "Apple", productType: "earbuds" },
    observations: () => [product({ title: "Apple AirPods 3 earbuds", brand: "Apple", category: "earbuds", mpn: "AIRPODS3" })], expectedIds: [] },
  { id: "I10", description: "same GTIN from two merchants keeps both source identities", input: { query: "4006381333931", compareMerchants: true },
    observations: () => [product({ gtin: "4006381333931" }), product({ gtin: "4006381333931", merchantId: "second-shop",
      merchantName: "Second Shop", sourceHost: "second-shop.example", merchantUrl: "https://second-shop.example/product/1001" })], expectedIds: [1001, 1001], expectedMerchants: 2 }
];

describe("WooCommerce business acceptance: 10 known identity cases", () => {
  it.each(identities)("$id: $description", async row => {
    const source = ports(row.observations());
    const result = await searchProducts(SearchProductsInputSchema.parse({ comparisonMode: "SAME_PRODUCT", allowAlternatives: false, limit: 3, ...row.input }), source);
    expect(result.candidates.map(candidate => candidate.woocommerceProduct?.productId).sort()).toEqual([...row.expectedIds].sort());
    expect(result.candidates.every(candidate => candidate.source === "WOOCOMMERCE_STORE_API" && candidate.resultGroup === "REQUESTED_PRODUCT")).toBe(true);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
    if (row.expectedMerchants) expect(new Set(result.candidates.map(candidateKey)).size).toBe(row.expectedMerchants);
    if (row.id === "I08") expect(source.woocommerce.search.mock.calls[0]?.[0].productUrl).toBe(row.input.query);
    expect(fetch).not.toHaveBeenCalled();
  });
});

type VariantCase = { id: string; description: string; input: Partial<SearchProductsInput> & { query: string };
  observations: () => WooProduct[]; expectedPrices: number[]; expectedVariationIds?: number[] };
const variants: VariantCase[] = [
  { id: "V01", description: "parent price range cannot become selected variant price", input: { query: "portafilter", productType: "portafilter", requiredFeatures: ["Walnut"] },
    observations: () => [product({ title: "Convertible Portafilter", category: "portafilter", productType: "variable", itemPrice: undefined,
      priceEvidence: { amountMinor: "25000", currency: "USD", currencyMinorUnit: 2, scope: "PARENT_RANGE", taxBasis: "UNKNOWN" }, availabilityScope: "PARENT" })], expectedPrices: [] },
  { id: "V02", description: "Walnut portafilter retains independently observed 28500 cents", input: { query: "portafilter", productType: "portafilter", requiredFeatures: ["Walnut"] },
    observations: () => [variant({ productId: 355289, parentProductId: 355289, variationId: 355292, title: "Convertible Portafilter", category: "portafilter",
      merchantUrl: "https://fixture-shop.example/product/convertible-portafilter?attribute_option=Walnut", selectedAttributes: { Option: "Walnut" },
      variantDimensions: { Option: ["Standard", "Walnut", "Maple"] }, itemPrice: { amountCents: 28500, currency: "USD" },
      priceEvidence: { amountMinor: "28500", currency: "USD", currencyMinorUnit: 2, scope: "VARIANT", taxBasis: "UNKNOWN" } })], expectedPrices: [28500], expectedVariationIds: [355292] },
  { id: "V03", description: "red selected variant cannot borrow black from shared description", input: { query: "ballet flats", productType: "ballet flats", requiredFeatures: ["black"] },
    observations: () => [variant({ selectedAttributes: { Color: "Red", Size: "US 7" }, description: "These ballet flats are offered in Black and Red." })], expectedPrices: [] },
  { id: "V04", description: "US 7 selected variant cannot satisfy mandatory US 8", input: { query: "ballet flats", productType: "ballet flats", requiredSize: "US 8" },
    observations: () => [variant()], expectedPrices: [] },
  { id: "V05", description: "out of stock child cannot inherit parent availability", input: { query: "trivet", productType: "trivet" },
    observations: () => [variant({ productId: 43848, parentProductId: 43848, variationId: 43860, title: "Dovetail and Amorphous Kitchen Trivets", category: "trivet",
      merchantUrl: "https://fixture-shop.example/product/kitchen-trivets?variation_id=43860&attribute_type=Amorphous+Trivet&attribute_species=Eucalyptus",
      selectedAttributes: { Type: "Amorphous Trivet", Species: "Eucalyptus" }, availability: "OUT_OF_STOCK" })], expectedPrices: [] },
  { id: "V06", description: "four count cannot satisfy six count requirement", input: { query: "sponge", productType: "sponge", requiredFeatures: ["6 count"] },
    observations: () => [product({ title: "Scrub Daddy Original sponge 4 count", category: "sponge", ...priced(1499) })], expectedPrices: [] },
  { id: "V07", description: "six count price remains the full pack price", input: { query: "sponge", productType: "sponge", requiredFeatures: ["6 count"] },
    observations: () => [product({ title: "Scrub Daddy Original sponge 6 count", category: "sponge", ...priced(1999) })], expectedPrices: [1999] },
  { id: "V08", description: "different child IDs retain independent observations", input: { query: "ballet flats", productType: "ballet flats" },
    observations: () => [variant(), variant({ variationId: 2002, selectedAttributes: { Color: "Red", Size: "US 8" },
      merchantUrl: "https://fixture-shop.example/product/ballet-flats?attribute_color=red&attribute_size=us-8",
      itemPrice: { amountCents: 2500, currency: "USD" }, priceEvidence: { amountMinor: "2500", currency: "USD", currencyMinorUnit: 2, scope: "VARIANT", taxBasis: "UNKNOWN" } })],
    expectedPrices: [2200, 2500], expectedVariationIds: [2001, 2002] }
];

describe("WooCommerce business acceptance: 8 variant and package cases", () => {
  it.each(variants)("$id: $description", async row => {
    const source = ports(row.observations());
    const result = await searchProducts(SearchProductsInputSchema.parse({ limit: 3, ...row.input }), source);
    expect(result.candidates.map(candidate => candidate.woocommerceProduct?.itemPrice?.amountCents).sort()).toEqual([...row.expectedPrices].sort());
    if (row.expectedVariationIds) {
      expect(result.candidates.map(candidate => candidate.woocommerceProduct?.variationId).sort()).toEqual([...row.expectedVariationIds].sort());
      expect(new Set(result.candidates.map(candidateKey)).size).toBe(row.expectedVariationIds.length);
    }
    if (row.id === "V04") expect(source.woocommerce.search.mock.calls[0]?.[0].requirements?.size).toBe("US 8");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("WooCommerce business acceptance: 4 negative cases", () => {
  it("N01: over-budget price cannot enter the result", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "hair mask", productType: "hair mask", maxItemPriceCents: 2000 }), ports([product()]));
    expect(result.candidates).toHaveLength(0);
    expect(result.sourceStatus.woocommerce).toBe("COMPLETE");
  });
  it("N02: original EUR evidence cannot become a USD item price", async () => {
    const observation = product({ itemPrice: undefined, priceEvidence: { amountMinor: "2200", currency: "EUR", currencyMinorUnit: 2, scope: "PRODUCT", taxBasis: "UNKNOWN" } });
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "hair mask", productType: "hair mask" }), ports([observation]));
    expect(result.candidates).toHaveLength(0);
    expect(result.woocommerceResult?.products[0]?.priceEvidence.currency).toBe("EUR");
  });
  it("N03: mismatched price evidence fails the source contract, never silently returns zero", async () => {
    const invalid = { ...product(), itemPrice: { amountCents: 1, currency: "USD" } };
    expect(WooProductSchema.safeParse(invalid).success).toBe(false);
    const source = ports([]);
    source.woocommerce.search.mockImplementation(async () => {
      const observation = WooProductSchema.parse(invalid); return wooResult([observation]);
    });
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "hair mask", productType: "hair mask" }), source);
    expect(result.candidates).toHaveLength(0);
    expect(result.sourceStatus.woocommerce).toBe("UNAVAILABLE");
    expect(result.sourceErrors?.woocommerce).toBe("DATA_SOURCE_UNAVAILABLE");
  });
  it("N04: merchant timeout preserves unavailable status and diagnostic denominator", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "hair mask", productType: "hair mask" }), ports([], { status: "UNAVAILABLE" }));
    expect(result.candidates).toHaveLength(0);
    expect(result.sourceStatus.woocommerce).toBe("UNAVAILABLE");
    expect(result.sourceFailures).toContainEqual(expect.objectContaining({ source: "WOOCOMMERCE", kind: "TIMEOUT", retryable: true }));
    expect(result.woocommerceResult?.diagnostics).toMatchObject({ plannedStores: 1, attemptedStores: 1, failedStores: 1, succeededStores: 0, registryCoverageComplete: false });
  });
});
