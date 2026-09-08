import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WOO_REGISTRY } from "../../awin-feed-service/src/woocommerce-registry.js";
import { normalizeWooProduct, type WooRawProduct } from "../../awin-feed-service/src/woocommerce-store.js";
import type { AwinProduct, AwinProductPort } from "../../../packages/awin-feed/src/index.js";
import { WooSearchResultSchema } from "../../../packages/contracts/src/woocommerce.js";
import { SearchProductsInputSchema, searchProducts } from "../src/search-products.js";
import { product as shopifyFixture, searchResult } from "./fixtures/conversation-replay-support.js";

// The Woo observation is the frozen public merchant sample, not an invented full
// product title or brand. Other sources model the irrelevant "firm" matches seen
// in the installed smoke; their product details are synthetic counterexamples.
const observation = JSON.parse(readFileSync(new URL(
  "../../awin-feed-service/test/fixtures/woocommerce-live/root-science-firm-search.json", import.meta.url
), "utf8")) as { observedAt: string; body: WooRawProduct[] };
const productUrl = "https://www.shoprootscience.com/shop/firm-peptide-serum";
const store = DEFAULT_WOO_REGISTRY.stores.find(item => item.merchantId === "root-science")!;
const firm = normalizeWooProduct(observation.body[0]!, store, observation.observedAt)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-08T15:35:00.000Z"));
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("LIVE_FIXTURE_REGRESSION_FORBIDS_NETWORK"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function ports(withPeers: boolean) {
  const awinProducts: AwinProduct[] = withPeers ? [
    { merchantId: "brush-fixture", merchant: "Silver Brush fixture", merchantProductId: "49759954141470",
      title: "Silver Brush firm bristle art brush", category: "paint brush", matchStatus: "DISCOVERY_MATCH",
      matchEvidence: ["keyword firm"], condition: "UNKNOWN", availability: "IN_STOCK",
      itemPrice: { amountCents: 1200, currency: "USD" }, merchantUrl: "https://brush-fixture.example/products/firm-brush",
      affiliateUrl: "https://brush-fixture.example/products/firm-brush", checkedAt: observation.observedAt },
    { merchantId: "mattress-fixture", merchant: "Shenzhen mattress fixture", merchantProductId: "47818136387809",
      title: "Shenzhen extra firm mattress", category: "mattress", matchStatus: "DISCOVERY_MATCH",
      matchEvidence: ["keyword firm"], condition: "UNKNOWN", availability: "IN_STOCK",
      itemPrice: { amountCents: 29900, currency: "USD" }, merchantUrl: "https://mattress-fixture.example/products/firm-mattress",
      affiliateUrl: "https://mattress-fixture.example/products/firm-mattress", checkedAt: observation.observedAt }
  ] : [];
  const awinSearch = vi.fn<AwinProductPort["search"]>(async () => ({ source: "AWIN_PRODUCT_FEED", coverage: "COMPLETE",
    snapshotAt: observation.observedAt, products: awinProducts,
    diagnostics: { feedRows: awinProducts.length, validRows: awinProducts.length, rejectedRows: 0,
      queryMatches: awinProducts.length, priceProductsExcluded: 0 } }));
  const shopifySearch = vi.fn(async () => searchResult(withPeers ? [shopifyFixture({
    merchantId: "three-ships-fixture", merchant: "Three Ships fixture", sourceHost: "three-ships-fixture.example",
    title: "Three Ships firming face serum", productType: "face serum", brand: "Three Ships", handle: "other-firm-serum",
    merchantUrl: "https://three-ships-fixture.example/products/firming-serum", checkedAt: observation.observedAt,
    itemPrice: { amountCents: 4500, currency: "USD" }
  })] : []));
  const wooSearch = vi.fn(async () => WooSearchResultSchema.parse({ source: "WOOCOMMERCE_STORE_API", schemaVersion: 1,
    registryVersion: "frozen-live-regression", requestId: "firm-url", status: "COMPLETE", snapshotAt: observation.observedAt,
    products: [firm], stores: [{ merchantId: "root-science", status: "COMPLETE", requests: 1, returned: 1 }],
    diagnostics: { eligibleStores: 1, plannedStores: 1, attemptedStores: 1, succeededStores: 1, failedStores: 0,
      skippedStores: 0, physicalRequests: 1, responseBytes: 39748, cacheHits: 0, elapsedMs: 921,
      truncated: false, registryCoverageComplete: true } }));
  return { awin: { search: awinSearch }, shopify: { search: shopifySearch }, woocommerce: { search: wooSearch } };
}

describe("WooCommerce frozen live product URL regression", () => {
  it("preserves the actual short title, absent brand, first category, price and rating", () => {
    expect(firm).toMatchObject({ merchantId: "root-science", productId: 69439, title: "Firm", category: "Astaxanthin",
      productType: "simple", condition: "UNKNOWN", availability: "IN_STOCK", merchantUrl: productUrl,
      itemPrice: { amountCents: 4800, currency: "USD" }, rating: { value: 5, reviewCount: 9 } });
    expect(firm.brand).toBeUndefined();
  });

  it("keeps the directly requested live product when no peer source has results", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: productUrl, limit: 3, responseLocale: "zh-CN" }), ports(false));
    expect(result.sourceStatus.woocommerce).toBe("COMPLETE");
    expect(result.featureProductsExcluded).toBe(0);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.woocommerceProduct).toMatchObject({ productId: 69439, merchantUrl: productUrl,
      itemPrice: { amountCents: 4800, currency: "USD" } });
    expect(result.candidates[0]?.recommendationTier).toBe("HIGH_RATED_UNVERIFIED");
  });

  it("never replaces the exact live URL with three trusted but unrelated firm keyword matches", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: productUrl, limit: 3, responseLocale: "zh-CN" }), ports(true));
    expect(result.sourceStatus.woocommerce).toBe("COMPLETE");
    expect(result.sourcePassDiagnostics[0]?.acceptedCandidates.woocommerce).toBe(1);
    expect(result.featureProductsExcluded).toBe(0);
    expect.soft(result.searchIntent).toBe("EXACT_PRODUCT");
    expect.soft(result.candidates.map(candidate => candidate.woocommerceProduct?.merchantUrl
      ?? candidate.shopifyProduct?.merchantUrl ?? candidate.awinProduct?.merchantUrl)).toEqual([productUrl]);
  });

  it("preserves the URL identity when SAME_PRODUCT is already explicit", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: productUrl,
      comparisonMode: "SAME_PRODUCT", allowAlternatives: false, limit: 3 }), ports(true));
    expect(result.searchIntent).toBe("EXACT_PRODUCT");
    expect(result.candidates.map(candidate => candidate.woocommerceProduct?.merchantUrl
      ?? candidate.shopifyProduct?.merchantUrl ?? candidate.awinProduct?.merchantUrl)).toEqual([productUrl]);
  });

  it("does not let a verified product URL bypass the user's item-price budget", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: productUrl,
      maxItemPriceCents: 4799, limit: 3 }), ports(true));
    expect(result.sourceStatus.woocommerce).toBe("COMPLETE");
    expect(result.woocommerceResult?.products[0]?.itemPrice?.amountCents).toBe(4800);
    expect(result.candidates).toEqual([]);
  });
});
