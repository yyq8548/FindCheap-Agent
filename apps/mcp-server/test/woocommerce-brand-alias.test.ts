import { afterEach, describe, expect, it, vi } from "vitest";
import { createUnavailableAwinPort } from "../../../packages/awin-feed/src/index.js";
import { WooProductSchema, WooSearchResultSchema, type WooProduct } from "../../../packages/contracts/src/woocommerce.js";
import { replaceManagedOfficialStorefronts } from "../src/merchant-trust.js";
import { productIdentityBrand, SearchProductsInputSchema, searchProducts } from "../src/search-products.js";
import { wooProductFacts } from "../src/woocommerce-product.js";
import type { WooCommerceCatalogPort } from "../src/woocommerce-client.js";
import { searchResult } from "./fixtures/conversation-replay-support.js";

const storefront = {
  brand: "Asian Garden 2 Table", aliases: ["AG2T"], officialHost: "asiangarden2table.com",
  platform: "WOOCOMMERCE" as const, productPathPrefixes: ["/product/"], imageHosts: [],
  evidenceUrl: "https://asiangarden2table.com/about-us/", reviewedAt: "2026-09-08", status: "APPROVED" as const
};
// Frozen fields from the 2026-09-08 controller observation for product 48799.
// The live source omits brand; explicit brand values below are conflict/alias cases.
function observed(brand?: string): WooProduct {
  return WooProductSchema.parse({
    sourceKind: "WOOCOMMERCE_STORE_API", merchantId: "asian-garden-2-table", merchantName: "Asian Garden 2 Table",
    sourceHost: "asiangarden2table.com", productId: 48799, title: "Eggplant Black Dragon", sku: "I035",
    productType: "simple", category: "Eggplant茄子", condition: "UNKNOWN", attributes: [], variantDimensions: {}, selectedAttributes: {},
    merchantUrl: "https://asiangarden2table.com/product/eggplant-black-dragon/",
    imageUrl: "https://asiangarden2table.com/wp-content/uploads/2026/04/I035-e1777303550347.png",
    images: [{ id: "397b899d22b7e7ad2fbf846469fcedc8813b58458d12d196033356261a191e73",
      url: "https://asiangarden2table.com/wp-content/uploads/2026/04/I035-e1777303550347.png" }],
    itemPrice: { amountCents: 168, currency: "USD" },
    priceEvidence: { amountMinor: "168", currency: "USD", currencyMinorUnit: 2, scope: "PRODUCT", taxBasis: "UNKNOWN" },
    availability: "IN_STOCK", availabilityScope: "PRODUCT", checkedAt: "2026-09-08T18:57:10.772Z",
    ...(brand === undefined ? {} : { brand })
  });
}
function ports(product: WooProduct) {
  const search = vi.fn<WooCommerceCatalogPort["search"]>(async () => WooSearchResultSchema.parse({
    source: "WOOCOMMERCE_STORE_API", schemaVersion: 1, registryVersion: "reviewed", requestId: "reviewed",
    snapshotAt: product.checkedAt, status: "COMPLETE", products: [product],
    stores: [{ merchantId: product.merchantId, status: "COMPLETE", requests: 1, returned: 1 }],
    diagnostics: { eligibleStores: 1, plannedStores: 1, attemptedStores: 1, succeededStores: 1, failedStores: 0,
      skippedStores: 0, physicalRequests: 1, responseBytes: 5997, cacheHits: 0, elapsedMs: 887, truncated: false, registryCoverageComplete: true }
  }));
  return { awin: createUnavailableAwinPort(), shopify: { search: async () => searchResult([]) },
    woocommerce: { search }, officialShopify: { search: vi.fn(async () => []) } };
}
afterEach(() => replaceManagedOfficialStorefronts([]));

describe("reviewed Woo brand aliases", () => {
  it.each([
    [undefined, "Asian Garden 2 Table"], [undefined, "AG2T"],
    ["Asian Garden 2 Table", "Asian Garden 2 Table"], ["Asian Garden 2 Table", "AG2T"],
    ["AG2T", "Asian Garden 2 Table"], ["AG2T", "AG2T"]
  ])("matches source brand %s to reviewed request %s without changing source facts", async (productBrand, requestedBrand) => {
    replaceManagedOfficialStorefronts([storefront]);
    const product = observed(productBrand);
    const source = ports(product);
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "Eggplant Black Dragon",
      brand: requestedBrand, brandMode: "REQUIRED", limit: 1 }), source);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ source: "WOOCOMMERCE_STORE_API", presentationGroup: "OFFICIAL_STORE",
      requestIdentityStatus: "CONFIRMED", woocommerceProduct: { productId: 48799, itemPrice: { amountCents: 168 } } });
    expect(result.candidates[0]?.woocommerceProduct?.brand).toBe(productBrand);
    expect(result.brandProductsExcluded).toBe(0);
    expect(source.woocommerce.search).toHaveBeenCalledWith(expect.objectContaining({ preferredMerchantHost: "asiangarden2table.com" }), expect.anything());
    expect(source.officialShopify.search).not.toHaveBeenCalled();
  });
  it.each(["Asian Garden 2 Table", "AG2T"])("does not give explicit Other Brand the requested %s identity", async brand => {
    replaceManagedOfficialStorefronts([storefront]);
    const product = observed("Other Brand");
    expect(productIdentityBrand(wooProductFacts(product))).toBe("Other Brand");
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "Eggplant Black Dragon", brand,
      brandMode: "REQUIRED", limit: 1 }), ports(product));
    expect(result.candidates).toEqual([]);
    expect(result.brandProductsExcluded).toBeGreaterThan(0);
  });
  it.each([
    ["Asian Garden 2 Table", "AG2T"], ["AG2T", "Asian Garden 2 Table"]
  ])("keeps %s in the query when the required brand uses %s", async (queryBrand, requestedBrand) => {
    replaceManagedOfficialStorefronts([storefront]);
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: `${queryBrand} Eggplant Black Dragon`,
      brand: requestedBrand, brandMode: "REQUIRED", limit: 1 }), ports(observed(queryBrand)));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ requestIdentityStatus: "CONFIRMED", woocommerceProduct: { productId: 48799 } });
  });
  it("does not infer an unreviewed alias from the merchant host", async () => {
    replaceManagedOfficialStorefronts([storefront]);
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "Eggplant Black Dragon", brand: "AG2T Seeds",
      brandMode: "REQUIRED", limit: 1 }), ports(observed("Asian Garden 2 Table")));
    expect(result.candidates).toEqual([]);
  });
  it("keeps the price ceiling when a reviewed alias matches", async () => {
    replaceManagedOfficialStorefronts([storefront]);
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "Eggplant Black Dragon", brand: "AG2T",
      brandMode: "REQUIRED", maxItemPriceCents: 100, limit: 1 }), ports(observed("Asian Garden 2 Table")));
    expect(result.candidates).toEqual([]);
  });
});
