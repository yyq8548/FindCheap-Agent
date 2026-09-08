import { describe, expect, it } from "vitest";
import { WooSearchInputSchema } from "../../../packages/contracts/src/woocommerce.js";
import { DEFAULT_WOO_REGISTRY } from "../src/woocommerce-registry.js";
import { createWooCommerceController } from "../src/woocommerce.js";

// Explicit opt-in: performs bounded public product GETs only; no cart, cookies or account credentials.
describe.skipIf(process.env.FINDCHEAP_WOO_LIVE !== "1")("Woo real Store API integration", () => {
  it.each([
    { merchantId: "root-science", query: "firm", productId: 69439 },
    { merchantId: "burrow-press", query: "mother", productId: 23939 },
    { merchantId: "scrub-daddy", query: "original", productId: 769455 }
  ])("search and fresh exact lookup: $merchantId", async ({ merchantId, query, productId }) => {
    const store = DEFAULT_WOO_REGISTRY.stores.find((item) => item.merchantId === merchantId)!;
    const controller = createWooCommerceController({ version: DEFAULT_WOO_REGISTRY.version, stores: [store] });
    const search = await controller.search(WooSearchInputSchema.parse({ query, limit: 12 }));
    expect(search.status).toBe("COMPLETE");
    expect(search.products.some((product) => product.productId === productId)).toBe(true);
    expect(search.diagnostics.physicalRequests).toBeGreaterThan(0);
    expect(search.diagnostics.physicalRequests).toBeLessThanOrEqual(18);
    const observation = await controller.lookup({ merchantId, productId });
    expect(observation.status).toBe("FOUND");
    expect(observation.product).toMatchObject({ merchantId, productId, productType: "simple", priceEvidence: { currency: "USD", currencyMinorUnit: 2, scope: "PRODUCT" } });
    expect(observation.product!.itemPrice!.amountCents).toBeGreaterThan(0);
    expect(observation.product!.images.length).toBeGreaterThan(0);
  }, 15_000);
});
