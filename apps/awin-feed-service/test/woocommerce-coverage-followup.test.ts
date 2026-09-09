import { describe, expect, it, vi } from "vitest";
import { WooSearchInputSchema } from "../../../packages/contracts/src/woocommerce.js";
import { createWooCommerceController } from "../src/woocommerce.js";
import { DEFAULT_WOO_REGISTRY, wooMerchantForUrl } from "../src/woocommerce-registry.js";
import { planWooMerchants } from "../src/woocommerce-routing.js";
import { createWooStoreReader, normalizeWooProduct, type WooRawProduct } from "../src/woocommerce-store.js";

const gr = DEFAULT_WOO_REGISTRY.stores.find(store => store.merchantId === "gr-research")!;
const orleans = DEFAULT_WOO_REGISTRY.stores.find(store => store.merchantId === "orleans-coffee")!;
const now = "2026-09-09T20:05:00.000Z";

describe("evidenced existing merchant coverage preserves access and product boundaries", () => {
  it("routes generic headphones to the existing GR retailer without adding stores", () => {
    const plan = planWooMerchants(DEFAULT_WOO_REGISTRY.stores, WooSearchInputSchema.parse({ query: "headphones" }));
    expect(plan.stores.slice(0, plan.routing.relevantPlanned).map(store => store.merchantId)).toContain("gr-research");
    expect(plan.stores.length).toBeLessThanOrEqual(6);
    expect(DEFAULT_WOO_REGISTRY.stores).toHaveLength(1003);
  });

  it.each(["Verum", "Meze"])("routes the publicly observed %s brand but never assigns it to a product", brand => {
    const plan = planWooMerchants(DEFAULT_WOO_REGISTRY.stores, WooSearchInputSchema.parse({ query: `${brand} headphones`, brand }));
    expect(plan.stores[0]?.merchantId).toBe("gr-research");
    const observed = normalizeWooProduct({ id: 1, name: "Headphones", type: "simple", permalink: "https://gr-research.com/product/unknown-brand/",
      prices: { price: "42500", currency_code: "USD", currency_minor_unit: 2 }, is_in_stock: true }, gr, now)!;
    expect(observed.brand).toBeUndefined();
    expect(observed).not.toHaveProperty("merchantTrust");
    expect(gr).not.toHaveProperty("trust");
  });

  it("uses the already reviewed Orleans canonical host while preserving both historical URL owners", () => {
    expect(orleans.origin).toBe("https://orleanscoffee.com");
    expect([new URL(orleans.origin).hostname, ...orleans.aliases].sort()).toEqual(["orleanscoffee.com", "www.orleanscoffee.com"]);
    for (const host of ["orleanscoffee.com", "www.orleanscoffee.com"]) {
      expect(wooMerchantForUrl(DEFAULT_WOO_REGISTRY, `https://${host}/product/creole-coffee-chicory/`)?.merchantId).toBe("orleans-coffee");
    }
    expect(wooMerchantForUrl(DEFAULT_WOO_REGISTRY, "https://shop.orleanscoffee.com/product/creole-coffee-chicory/")).toBeUndefined();
  });

  it.each(["orleanscoffee.com", "www.orleanscoffee.com"])("preserves %s product URLs while sending API reads directly to canonical", async historicalHost => {
    const raw: WooRawProduct = { id: 65480, name: "Coffee", type: "simple", permalink: `https://${historicalHost}/product/coffee/`,
      prices: { price: "1425", currency_code: "USD", currency_minor_unit: 2 }, is_in_stock: true };
    const request = vi.fn(async (url: URL) => {
      expect(url.hostname).toBe("orleanscoffee.com");
      return Response.json([raw]);
    });
    const controller = createWooCommerceController({ version: "canonical-fixture", stores: [orleans] }, {
      now: () => Date.parse(now), resolve: async () => [{ address: "8.8.8.8", family: 4 }], request
    });
    const result = await controller.search(WooSearchInputSchema.parse({ query: "coffee" }));
    expect(result.status).toBe("COMPLETE");
    expect(result.products).toMatchObject([{ merchantId: "orleans-coffee", productId: 65480, merchantUrl: raw.permalink,
      itemPrice: { amountCents: 1425, currency: "USD" } }]);
    expect(request).toHaveBeenCalledOnce();
  });

  it.each(["https://www.orleanscoffee.com/wp-json/wc/store/v1/products", "https://orleanscoffee.com/other-path", "https://evil.example/products"])(
    "still rejects an API redirect to %s without a follow-up request", async target => {
      const request = vi.fn(async () => new Response(null, { status: 301, headers: { location: target } }));
      const reader = createWooStoreReader({ resolve: async () => [{ address: "8.8.8.8", family: 4 }], request });
      await expect(reader.list(orleans, new URLSearchParams({ search: "coffee" }), {
        signal: new AbortController().signal, requests: 0, bytes: 0, maxRequests: 12, maxBytes: 1024 * 1024
      })).rejects.toMatchObject({ reason: "SECURITY_REJECTED" });
      expect(request).toHaveBeenCalledOnce();
    });

  it("keeps complete-registry two-pass retrieval within six stores per pass and twelve requests", async () => {
    const request = vi.fn(async () => Response.json([]));
    const controller = createWooCommerceController(DEFAULT_WOO_REGISTRY, {
      resolve: async () => [{ address: "8.8.8.8", family: 4 }], request, now: () => Date.parse(now)
    });
    const input = WooSearchInputSchema.parse({ query: "headphones", productType: "headphones", maxItemPriceCents: 35000 });
    const first = await controller.search(input);
    const second = await controller.search({ ...input, continuation: first.continuation! });
    expect(first.stores.map(store => store.merchantId)).toContain("gr-research");
    expect(first.diagnostics.plannedStores).toBeLessThanOrEqual(6);
    expect(second.diagnostics.plannedStores).toBeLessThanOrEqual(6);
    expect(request.mock.calls.length).toBeLessThanOrEqual(12);
    expect(first.diagnostics.registryCoverageComplete).toBe(false);
    expect(second.diagnostics.registryCoverageComplete).toBe(false);
  });
});
