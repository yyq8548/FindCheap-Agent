import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/woocommerce-hidden-secrets.json" with { type: "json" };
import { WooSearchInputSchema } from "../../../packages/contracts/src/woocommerce.js";
import { createWooCommerceController } from "../src/woocommerce.js";
import { DEFAULT_WOO_REGISTRY, wooMerchantForUrl } from "../src/woocommerce-registry.js";
import { planWooMerchants } from "../src/woocommerce-routing.js";

describe("standard selected-price wig coverage", () => {
  it("admits exactly the evidenced store as search access only", () => {
    const store = DEFAULT_WOO_REGISTRY.stores.find(value => value.merchantId === "hidden-secrets-wigs");
    expect(store).toEqual(fixture.store);
    expect(DEFAULT_WOO_REGISTRY.stores).toHaveLength(1003);
    for (const field of ["trust", "official", "affiliate", "requiresOptionSelection"]) expect(store).not.toHaveProperty(field);
    expect(wooMerchantForUrl(DEFAULT_WOO_REGISTRY, "https://hiddensecretswigs.com/product/fascination/")).toBeUndefined();
    expect(wooMerchantForUrl(DEFAULT_WOO_REGISTRY, "https://cdn.shortpixel.ai/product/fascination/")).toBeUndefined();
  });

  it.each([{ query: "synthetic wig" }, { query: "Fascination", brand: "Raquel Welch" }])("routes the observed category/brand within existing budget: $query", input => {
    const plan = planWooMerchants(DEFAULT_WOO_REGISTRY.stores, WooSearchInputSchema.parse(input));
    expect(plan.stores.slice(0, plan.routing.relevantPlanned).map(value => value.merchantId)).toContain("hidden-secrets-wigs");
    expect(plan.stores.length).toBeLessThanOrEqual(6);
  });

  it("replays all 27 actual variants, including the original false SKU, to the selected color price", async () => {
    expect(fixture.page1).toHaveLength(20);
    expect(fixture.page1.filter(value => value.sku === false)).toHaveLength(1);
    expect(fixture.page2).toHaveLength(7);
    const store = DEFAULT_WOO_REGISTRY.stores.find(value => value.merchantId === "hidden-secrets-wigs")!;
    const request = vi.fn(async (url: URL) => {
      expect(url.hostname).toBe("www.hiddensecretswigs.com");
      if (url.searchParams.get("type") === "variation") {
        expect(url.searchParams.get("parent")).toBe("19030");
        return Response.json(url.searchParams.get("page") === "2" ? fixture.page2 : fixture.page1, { headers: { "x-wp-totalpages": "2" } });
      }
      expect(url.searchParams.get("search")).toBe("Fascination");
      return Response.json([fixture.parent]);
    });
    const controller = createWooCommerceController({ version: "exact-public-wig-fixture", stores: [store] }, {
      now: () => Date.parse(fixture.checkedAt), resolve: async () => [{ address: "8.8.8.8", family: 4 }], request
    });
    const result = await controller.search(WooSearchInputSchema.parse({ query: "Fascination", productType: "wig", requirements: { color: "rl10-12" }, limit: 3 }));
    expect(result.status).toBe("COMPLETE");
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ productId: 19030, variationId: 20910, selectedAttributes: { color: "rl10-12" },
      itemPrice: { amountCents: 23200, currency: "USD" }, availability: "IN_STOCK", priceEvidence: { scope: "VARIANT" }, condition: "UNKNOWN" });
    expect(result.products[0]?.brand).toBeUndefined();
    expect(result.products[0]?.images[0]?.url).toMatch(/^https:\/\/cdn\.shortpixel\.ai\//u);
    expect(request).toHaveBeenCalledTimes(3);
  });
});
