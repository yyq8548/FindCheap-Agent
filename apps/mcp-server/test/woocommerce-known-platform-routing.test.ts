import { afterEach, describe, expect, it, vi } from "vitest";
import { createUnavailableAwinPort } from "../../../packages/awin-feed/src/index.js";
import { WooSearchInputSchema, type WooSearchInput } from "../../../packages/contracts/src/woocommerce.js";
import { createWooCommerceController } from "../../awin-feed-service/src/woocommerce.js";
import { WooReadError } from "../../awin-feed-service/src/woocommerce-store.js";
import { WooRegistrySchema } from "../../awin-feed-service/src/woocommerce-registry.js";
import { resolveKnownProductUrl } from "../src/known-product-url.js";
import { replaceManagedOfficialStorefronts } from "../src/merchant-trust.js";
import { SearchProductsInputSchema, searchProducts, type SearchProductsInput } from "../src/search-products.js";
import { createWooCommercePortFromEnvironment } from "../src/woocommerce-client.js";
import { product, searchResult } from "./fixtures/conversation-replay-support.js";

// Reduced public Glossier URL regression; synthetic source data is not live
// price, merchant coverage or independent product-identity evidence.
const exactUrl = "https://www.glossier.com/products/balm-dotcom?variant=46731565826293";
const knownWooUrl = "https://www.shoprootscience.com/shop/firm-peptide-serum";
const unknownWooUrl = "https://beauty.example/product/lip-balm";
const original = product({ merchantId: "glossier", merchant: "Glossier", sourceHost: "www.glossier.com",
  merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT", evidence: ["offline fixture"] },
  handle: "46731565826293", merchantUrl: exactUrl, brand: "Glossier", title: "Balm Dotcom",
  productType: "lip balm", description: "Espresso lip balm", variantDimensions: { Flavor: "Espresso" },
  itemPrice: { amountCents: 1600, currency: "USD" } });

afterEach(() => { vi.unstubAllGlobals(); replaceManagedOfficialStorefronts([]); });

function offlineSources() {
  const accidentalNetwork = vi.fn(() => { throw new Error("NETWORK_FORBIDDEN_IN_ROUTING_TEST"); });
  vi.stubGlobal("fetch", accidentalNetwork);
  const serviceInputs: WooSearchInput[] = [];
  const failures: Array<{ reason: string; status: number }> = [];
  const merchantReads: URL[] = [];
  const registry = WooRegistrySchema.parse({ version: "offline-routing", stores: [
    { merchantId: "beauty", name: "Fixture Beauty", origin: "https://beauty.example", productPathPrefixes: ["/product/"] },
    { merchantId: "root-science", name: "Root Science fixture", origin: "https://www.shoprootscience.com", productPathPrefixes: ["/shop/"] }
  ].map(store => ({ ...store, currency: "USD", categories: ["lip balm", "beauty"], reviewedAt: "2026-09-09",
    evidenceUrl: store.origin, enabled: true, capabilities: { search: true, variations: true } })) });
  const controller = createWooCommerceController(registry, {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    request: async (url: URL) => {
      merchantReads.push(url);
      return Response.json([], { headers: { "x-wp-totalpages": "1" } });
    }
  });
  const woocommerce = createWooCommercePortFromEnvironment({ WOOCOMMERCE_API_BASE_URL: "https://source.example" }, {
    // In-process HTTP bridge: the real controller decides whether a URL is
    // permitted; only its transport and the production error mapping are stubbed.
    fetch: async (_url, options) => {
      const input = WooSearchInputSchema.parse(JSON.parse(String(options?.body)));
      serviceInputs.push(input);
      try { return Response.json(await controller.search(input)); }
      catch (error) {
        if (!(error instanceof WooReadError)) throw error;
        const status = error.reason === "SECURITY_REJECTED" ? 400 : 503;
        failures.push({ reason: error.reason, status });
        return Response.json({ error: status === 400 ? "INVALID_WOOCOMMERCE_REQUEST" : "WOOCOMMERCE_UPSTREAM_UNAVAILABLE" }, { status });
      }
    }
  })!;
  return { serviceInputs, failures, merchantReads, accidentalNetwork, ports: { woocommerce,
    awin: createUnavailableAwinPort(), shopify: { search: vi.fn(async () => searchResult([original])) },
    officialShopify: { search: vi.fn(async () => [original]) } } };
}

describe("known-platform URLs through public product search", () => {
  it.each([exactUrl, exactUrl.split("?")[0]!])("uses compiled Woo catalog text for known Shopify URL %s", async query => {
    const sources = offlineSources();
    expect(resolveKnownProductUrl(query)?.storefront.platform).toBe("SHOPIFY");
    const result = await searchProducts(SearchProductsInputSchema.parse({ query, brand: "Glossier", brandMode: "REQUIRED",
      productType: "lip balm", requiredFeatures: ["Espresso"], maxItemPriceCents: 2000, limit: 8 }), sources.ports);
    expect(result.sourceStatus.woocommerce).toBe("COMPLETE");
    expect((result.sourceFailures ?? []).filter(failure => failure.source === "WOOCOMMERCE")).toEqual([]);
    expect(sources.serviceInputs.length).toBeGreaterThan(0);
    expect(sources.serviceInputs.every(input => input.productUrl === undefined && input.query.includes("Glossier Balm Dotcom"))).toBe(true);
    expect(sources.merchantReads.length).toBeGreaterThan(0);
    expect(sources.merchantReads.every(url => url.searchParams.has("search") && !url.searchParams.has("slug"))).toBe(true);
    expect(result.resolvedRequest).toMatchObject({ query: "Glossier Balm Dotcom", requiredFeatures: ["Espresso"],
      maxItemPriceCents: 2000, shopifyAnchor: { url: query } });
    expect(result.candidates.map(candidate => candidate.shopifyProduct?.merchantUrl)).toEqual([exactUrl]);
    expect(sources.ports.shopify.search).toHaveBeenCalled();
    expect(sources.accidentalNetwork).not.toHaveBeenCalled();
  });

  it("keeps ordinary text searches participating in Woo without a direct URL", async () => {
    const sources = offlineSources();
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "Glossier Balm Dotcom", brand: "Glossier",
      productType: "lip balm" }), sources.ports);
    expect(result.sourceStatus.woocommerce).toBe("COMPLETE");
    expect(sources.serviceInputs.length).toBeGreaterThan(0);
    expect(sources.serviceInputs.every(input => input.productUrl === undefined)).toBe(true);
    expect(sources.merchantReads.length).toBeGreaterThan(0);
    expect(sources.ports.shopify.search).toHaveBeenCalled();
    expect(sources.accidentalNetwork).not.toHaveBeenCalled();
  });

  it.each([
    ["known Woo", knownWooUrl, "WOOCOMMERCE"], ["unrecognised registered Woo", unknownWooUrl, undefined]
  ] as const)("retains direct-product reads for %s", async (_label, query, platform) => {
    const sources = offlineSources();
    if (platform === "WOOCOMMERCE") replaceManagedOfficialStorefronts([{ brand: "Root Science", aliases: [],
      officialHost: "shoprootscience.com", storefrontHost: "www.shoprootscience.com", platform,
      productPathPrefixes: ["/shop/"], imageHosts: [], evidenceUrl: "https://www.shoprootscience.com/about",
      reviewedAt: "2026-09-08", status: "APPROVED" }]);
    expect(resolveKnownProductUrl(query)?.storefront.platform).toBe(platform);
    const result = await searchProducts(SearchProductsInputSchema.parse({ query }), sources.ports);
    expect(result.sourceStatus.woocommerce).toBe("COMPLETE");
    expect(sources.serviceInputs.length).toBeGreaterThan(0);
    expect(sources.serviceInputs.every(input => input.productUrl === query)).toBe(true);
    expect(sources.merchantReads.length).toBeGreaterThan(0);
    expect(sources.merchantReads.every(url => url.hostname === new URL(query).hostname && url.searchParams.has("slug"))).toBe(true);
    expect(sources.failures).toEqual([]);
    expect(sources.accidentalNetwork).not.toHaveBeenCalled();
  });

  it("keeps a previously source-owned Woo anchor ahead of URL platform detection", async () => {
    const sources = offlineSources();
    const wooAnchor: NonNullable<SearchProductsInput["wooAnchor"]> = { url: unknownWooUrl, merchantId: "beauty",
      sourceHost: "beauty.example", productId: 10, productType: "simple", selectedAttributes: {} };
    const result = await searchProducts({ ...SearchProductsInputSchema.parse({ query: exactUrl }), wooAnchor }, sources.ports);
    expect(result.sourceStatus.woocommerce).toBe("COMPLETE");
    expect(sources.serviceInputs.length).toBeGreaterThan(0);
    expect(sources.serviceInputs.every(input => input.productUrl === unknownWooUrl)).toBe(true);
    expect(sources.merchantReads.every(url => url.hostname === "beauty.example" && url.searchParams.has("slug"))).toBe(true);
    expect(sources.accidentalNetwork).not.toHaveBeenCalled();
  });

  it("still rejects an unrecognised URL absent from the Woo registry before merchant reads", async () => {
    const sources = offlineSources();
    const query = "https://not-registered.example/product/balm";
    expect(resolveKnownProductUrl(query)).toBeUndefined();
    const result = await searchProducts(SearchProductsInputSchema.parse({ query }), sources.ports);
    expect(result.sourceStatus.woocommerce).toBe("UNAVAILABLE");
    expect(result.sourceFailures).toContainEqual({ source: "WOOCOMMERCE", kind: "SOURCE_REJECTED", retryable: false });
    expect(sources.serviceInputs.length).toBeGreaterThan(0);
    expect(sources.serviceInputs.every(input => input.productUrl === query)).toBe(true);
    expect(sources.failures.length).toBeGreaterThan(0);
    expect(sources.failures.every(failure => failure.reason === "SECURITY_REJECTED" && failure.status === 400)).toBe(true);
    expect(sources.merchantReads).toEqual([]);
    expect(sources.accidentalNetwork).not.toHaveBeenCalled();
  });
});
