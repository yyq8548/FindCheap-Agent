import { afterEach, describe, expect, it, vi } from "vitest";
import { createUnavailableAwinPort } from "../../../packages/awin-feed/src/index.js";
import { WooProductSchema, WooSearchResultSchema, type WooProduct } from "../../../packages/contracts/src/woocommerce.js";
import { replaceManagedMerchantTrustRecords, replaceManagedOfficialStorefronts, resetManagedMerchantTrustRecords } from "../src/merchant-trust.js";
import { resolveKnownProductUrl } from "../src/known-product-url.js";
import { productIdentityBrand, SearchProductsInputSchema, searchProducts } from "../src/search-products.js";
import { wooProductFacts } from "../src/woocommerce-product.js";
import type { WooCommerceCatalogPort } from "../src/woocommerce-client.js";
import { createOfficialShopifySearchPort } from "../src/shopify-official-store-search.js";
import { createFindCheapBackend } from "../src/backend.js";
import { createAffiliateLinkResolver } from "../src/affiliate-links.js";
import { createUnavailableDealPort } from "../src/deal-client.js";
import { createMemoryWatchStore } from "../src/watch-store.js";
import type { ProductCardContent } from "../src/server.js";
import { connectReplay, searchResult } from "./fixtures/conversation-replay-support.js";

const storefront = { brand: "Maker", aliases: ["Maker Alias"], officialHost: "maker.example", storefrontHost: "www.maker.example",
  platform: "WOOCOMMERCE" as const, productPathPrefixes: ["/product/"], imageHosts: [],
  evidenceUrl: "https://www.maker.example/about/", reviewedAt: "2026-09-08", status: "APPROVED" as const };
afterEach(() => { replaceManagedOfficialStorefronts([]); resetManagedMerchantTrustRecords(); vi.unstubAllGlobals(); });
function observed(overrides: Partial<WooProduct> = {}) {
  return WooProductSchema.parse({ sourceKind: "WOOCOMMERCE_STORE_API", merchantId: "maker", merchantName: "Maker",
    sourceHost: "www.maker.example", productId: 100, productType: "simple", title: "Maker drawing pencil", brand: "Maker",
    category: "pencil", condition: "UNKNOWN", attributes: [], variantDimensions: {}, selectedAttributes: {},
    merchantUrl: "https://www.maker.example/product/drawing-pencil/", images: [], itemPrice: { amountCents: 1000, currency: "USD" },
    priceEvidence: { amountMinor: "1000", currency: "USD", currencyMinorUnit: 2, scope: "PRODUCT", taxBasis: "UNKNOWN" },
    availability: "IN_STOCK", availabilityScope: "PRODUCT", checkedAt: new Date().toISOString(), ...overrides });
}
function ports(products: WooProduct[]) {
  const search = vi.fn<WooCommerceCatalogPort["search"]>(async () => WooSearchResultSchema.parse({
    source: "WOOCOMMERCE_STORE_API", schemaVersion: 1, registryVersion: "reviewed", requestId: "reviewed", snapshotAt: new Date().toISOString(),
    status: "COMPLETE", products, stores: [{ merchantId: "maker", status: "COMPLETE", requests: 1, returned: products.length }],
    diagnostics: { eligibleStores: 200, plannedStores: 6, attemptedStores: 1, succeededStores: 1, failedStores: 0, skippedStores: 0,
      physicalRequests: 1, responseBytes: 1000, cacheHits: 0, elapsedMs: 1, truncated: false, registryCoverageComplete: false } }));
  return { awin: createUnavailableAwinPort(), shopify: { search: async () => searchResult([]) }, woocommerce: { search },
    officialShopify: { search: vi.fn(async () => []) } };
}

describe("reviewed Woo storefront routing and trust", () => {
  it("uses the Woo pass for a reviewed brand without a Shopify official request", async () => {
    replaceManagedOfficialStorefronts([storefront]);
    const source = ports([observed()]);
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "drawing pencil", brand: "Maker", brandMode: "REQUIRED", limit: 1 }), source);
    expect(source.woocommerce.search).toHaveBeenCalledWith(expect.objectContaining({ preferredMerchantHost: "www.maker.example" }), expect.anything());
    expect(source.officialShopify.search).not.toHaveBeenCalled();
    expect(source.woocommerce.search.mock.calls.length).toBeLessThanOrEqual(2);
    expect(result.candidates[0]).toMatchObject({ source: "WOOCOMMERCE_STORE_API", presentationGroup: "OFFICIAL_STORE", recommendationTier: "TRUSTED_OR_AFFILIATE" });
  });
  it("canonicalizes only reviewed hosts while retaining explicit Woo variant attributes", async () => {
    replaceManagedOfficialStorefronts([storefront]);
    const raw = "https://maker.example/product/drawing-pencil/?variation_id=101&attribute_pa_size=M&utm_source=test";
    const canonical = "https://www.maker.example/product/drawing-pencil/?variation_id=101&attribute_pa_size=M";
    expect(resolveKnownProductUrl(raw)?.sourcePageUrl).toBe(canonical);
    const source = ports([observed({ productType: "variation", parentProductId: 100, variationId: 101,
      selectedAttributes: { Size: "M" }, priceEvidence: { amountMinor: "1000", currency: "USD", currencyMinorUnit: 2, scope: "VARIANT", taxBasis: "UNKNOWN" } })]);
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: raw, limit: 1 }), source);
    expect(source.woocommerce.search.mock.calls.every(([input]) => input.productUrl === canonical)).toBe(true);
    expect(source.officialShopify.search).not.toHaveBeenCalled();
    expect(result.candidates[0]?.woocommerceProduct?.variationId).toBe(101);
    expect(resolveKnownProductUrl(raw.replace("variation_id=101", "variation_id=101&variation_id=102"))).toBeUndefined();
  });
  it("preserves an explicit other product brand instead of promoting the store's own brand", async () => {
    replaceManagedOfficialStorefronts([storefront]);
    const product = observed({ brand: "Other Brand", title: "Other Brand drawing pencil" });
    expect(productIdentityBrand(wooProductFacts(product))).toBe("Other Brand");
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "drawing pencil", brand: "Maker", brandMode: "REQUIRED", limit: 1 }), ports([product]));
    expect(result.candidates).toEqual([]);
  });
  it.each(["ESTABLISHED_RETAILER", "SEARCH_ONLY"] as const)("keeps %s separate from brand-official identity", async decision => {
    if (decision === "ESTABLISHED_RETAILER") replaceManagedMerchantTrustRecords([{ host: "maker.example", level: decision,
      evidenceUrl: storefront.evidenceUrl, reviewedAt: storefront.reviewedAt, status: "APPROVED" }]);
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "drawing pencil", limit: 1 }), ports([observed()]));
    if (decision === "ESTABLISHED_RETAILER") expect(result.candidates[0]).toMatchObject({ presentationGroup: "TRUSTED_MATCH", recommendationTier: "TRUSTED_OR_AFFILIATE" });
    else expect(result.candidates.every(candidate => candidate.presentationGroup === "RESEARCH_ONLY")).toBe(true);
    expect(result.candidates.some(candidate => candidate.presentationGroup === "OFFICIAL_STORE")).toBe(false);
  });
  it("shows an explicitly different product brand as a trusted match, not the store's official brand", async () => {
    replaceManagedOfficialStorefronts([storefront]);
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "drawing pencil", brand: "Other Brand", brandMode: "REQUIRED", limit: 1 }),
      ports([observed({ brand: "Other Brand", title: "Other Brand drawing pencil" })]));
    expect(result.candidates[0]).toMatchObject({ presentationGroup: "TRUSTED_MATCH", recommendationTier: "TRUSTED_OR_AFFILIATE" });
  });
  it("rejects accidental Woo dispatch through the native Shopify adapter before fetching", async () => {
    replaceManagedOfficialStorefronts([storefront]);
    const fetchDocument = vi.fn(async () => { throw new Error("unexpected fetch"); });
    await expect(createOfficialShopifySearchPort({ fetchDocument }).search({ seed: { ...storefront, merchantId: "maker",
      merchant: "Maker", sourceHost: storefront.storefrontHost, merchantUrl: "https://www.maker.example/" }, query: "pencil", limit: 1 })).rejects.toThrow("Backend.catalog.woocommerce");
    expect(fetchDocument).not.toHaveBeenCalled();
  });
  it.each(["OFFICIAL", "ESTABLISHED_RETAILER", "SEARCH_ONLY"] as const)("enforces %s primary eligibility through registered MCP snapshot tools", async decision => {
    if (decision === "OFFICIAL") replaceManagedOfficialStorefronts([storefront]);
    if (decision === "ESTABLISHED_RETAILER") replaceManagedMerchantTrustRecords([{ host: "maker.example", level: decision,
      evidenceUrl: storefront.evidenceUrl, reviewedAt: storefront.reviewedAt, status: "APPROVED" }]);
    const product = observed({ rating: { value: 4.7, reviewCount: 50, scale: 5, productId: 100 } });
    const catalog = ports([product]);
    const backend = createFindCheapBackend({ catalog, product: { affiliateLinks: createAffiliateLinkResolver() },
      deals: createUnavailableDealPort(), verifiedDeals: false, watches: createMemoryWatchStore() });
    const replay = await connectReplay(async () => searchResult([]), { backend, now: () => new Date(product.checkedAt) });
    try {
      const response = await replay.client.callTool({ name: "search_products", arguments: { query: product.merchantUrl, limit: 1 } });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const snapshot = response.structuredContent as ProductCardContent;
      expect(snapshot.products).toHaveLength(1);
      expect(snapshot.products[0]).toMatchObject({ sourceKind: "WOOCOMMERCE_STORE_API", itemPrice: { amountCents: 1000 } });
      if (decision === "OFFICIAL") expect(snapshot.products[0]?.presentationGroup).toBe("OFFICIAL_STORE");
      if (decision === "SEARCH_ONLY") expect(snapshot.recommendation).toMatchObject({ state: "MATCHES_AVAILABLE" });
      else expect(snapshot.recommendation).toMatchObject({ state: "READY", primarySelectionId: snapshot.products[0]!.selectionId });
      if (decision === "SEARCH_ONLY") expect(snapshot.recommendation?.primarySelectionId).toBeUndefined();
    } finally { await replay.close(); }
  });
});
