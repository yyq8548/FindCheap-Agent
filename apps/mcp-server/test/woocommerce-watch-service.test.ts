import { describe, expect, it, vi } from "vitest";
import type { WooLookupResult, WooProduct } from "../../../packages/contracts/src/woocommerce.js";
import type { DealPort } from "../src/deal-client.js";
import type { ShopifyPort } from "../src/shopify-client.js";
import type { WooCommerceProductPort } from "../src/woocommerce-client.js";
import { evaluateWatch, observeWooProduct } from "../src/watch-service.js";
import { createMemoryWatchStore, type WatchSpec } from "../src/watch-store.js";

const checkedAt = "2026-09-08T12:00:00.000Z";
const now = new Date(checkedAt);
const product: WooProduct = {
  sourceKind: "WOOCOMMERCE_STORE_API", merchantId: "reviewed-woo", merchantName: "Reviewed Woo",
  sourceHost: "reviewed-woo.example", productId: 123, parentProductId: 123, variationId: 456,
  productType: "variation", title: "Exact Keyboard Black ANSI", category: "Keyboards", condition: "NEW",
  attributes: [], variantDimensions: { Color: ["Black", "White"], Layout: ["ANSI", "ISO"] },
  selectedAttributes: { Color: "Black", Layout: "ANSI" },
  merchantUrl: "https://reviewed-woo.example/product/exact-keyboard/?attribute_color=black&attribute_layout=ansi",
  images: [], itemPrice: { amountCents: 4999, currency: "USD" },
  priceEvidence: { amountMinor: "4999", currency: "USD", currencyMinorUnit: 2, scope: "VARIANT", taxBasis: "UNKNOWN" },
  availability: "OUT_OF_STOCK", availabilityScope: "VARIANT", checkedAt
};
const selectedProduct = {
  sourceKind: "WOOCOMMERCE_STORE_API" as const, merchantId: product.merchantId, merchant: product.merchantName,
  sourceHost: product.sourceHost, productId: product.productId, parentProductId: product.parentProductId!,
  variationId: product.variationId!, productType: "variation" as const, title: product.title,
  merchantUrl: product.merchantUrl, condition: product.condition,
  variantDimensions: product.selectedAttributes, selectedAt: checkedAt
};
const spec: WatchSpec = { query: "Exact Keyboard", condition: "RESTOCKED", conditionPreference: "NEW",
  membershipIds: [], intervalMinutes: 60, selectedProduct };
const shopify: ShopifyPort = { search: vi.fn(async () => { throw new Error("SHOPIFY_MUST_NOT_HANDLE_WOO_WATCH"); }) };
const deals: DealPort = { search: vi.fn(async () => { throw new Error("NO_DEALS_FOR_PRODUCT_WATCH"); }) };
function source(observe: () => WooProduct | undefined): WooCommerceProductPort {
  return { lookup: vi.fn(async (): Promise<WooLookupResult> => {
    const observed = observe();
    return { source: "WOOCOMMERCE_STORE_API", registryVersion: "fixture-v1", status: observed ? "FOUND" : "NOT_FOUND",
      ...(observed ? { product: observed } : {}), checkedAt };
  }), inspect: vi.fn(async () => { throw new Error("WATCH_MUST_NOT_RESELECT_VARIATIONS"); }) };
}

describe("Woo Watch observations", () => {
  it("uses only the selected merchant/parent/variation lookup and triggers once after a reliable restock", async () => {
    const store = createMemoryWatchStore();
    const created = await store.create(spec, checkedAt);
    const watch = await store.save({ ...created, automationId: "woo-restock-test", schedulingState: "BOUND" });
    let observed = product;
    const woo = source(() => observed);
    const baseline = await evaluateWatch(watch, store, shopify, deals, undefined, now, woo);
    expect(baseline.status).toBe("NOT_TRIGGERED");
    expect(woo.lookup).toHaveBeenCalledWith({ merchantId: "reviewed-woo", productId: 123, parentProductId: 123, variationId: 456 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }));
    observed = { ...product, availability: "IN_STOCK", checkedAt: "2026-09-08T13:00:00.000Z" };
    const triggered = await evaluateWatch(baseline.watch, store, shopify, deals, undefined, new Date(observed.checkedAt), woo);
    expect(triggered.status).toBe("TRIGGERED");
    expect(triggered.watch).toMatchObject({ status: "COMPLETED", completionEventId: expect.any(String),
      stopIntent: { automationId: "woo-restock-test", reason: "RESTOCKED", status: "STOP_REQUIRED" } });
    expect(triggered.observation).toMatchObject({ sourceKind: "WOOCOMMERCE_STORE_API", productId: 123, variationId: 456,
      variantDimensions: { Color: "Black", Layout: "ANSI" }, availability: "IN_STOCK" });
    expect((await evaluateWatch(triggered.watch, store, shopify, deals, undefined, new Date(observed.checkedAt), woo)).status).toBe("COMPLETED");
    expect(woo.lookup).toHaveBeenCalledTimes(2);
    expect(woo.inspect).not.toHaveBeenCalled();
    expect(shopify.search).not.toHaveBeenCalled();
    expect(deals.search).not.toHaveBeenCalled();
  });

  it("does not invent a restock transition when the first reliable observation is in stock", async () => {
    const store = createMemoryWatchStore();
    const watch = await store.create(spec, checkedAt);
    const result = await evaluateWatch(watch, store, shopify, deals, undefined, now,
      source(() => ({ ...product, availability: "IN_STOCK" })));
    expect(result.status).toBe("NOT_TRIGGERED");
    expect(result.watch.status).toBe("ACTIVE");
  });

  it.each([
    [4999, "TRIGGERED"], [5000, "NOT_TRIGGERED"], [5001, "NOT_TRIGGERED"]
  ])("compares the exact variant price %i against an exclusive 5000-cent threshold", async (amountCents, status) => {
    const store = createMemoryWatchStore();
    const watch = await store.create({ ...spec, condition: "PRICE_BELOW", priceBasis: "ITEM_PRICE", threshold: 5000 }, checkedAt);
    const result = await evaluateWatch(watch, store, shopify, deals, undefined, now, source(() => ({ ...product,
      itemPrice: { amountCents, currency: "USD" }, priceEvidence: { ...product.priceEvidence, amountMinor: String(amountCents) } })));
    expect(result.status).toBe(status);
    expect(result.observation).toMatchObject({ itemPrice: { amountCents, currency: "USD" }, priceBasis: "ITEM_PRICE" });
  });

  it.each([
    ["merchant ID", { merchantId: "other-woo" }], ["parent ID", { productId: 789, parentProductId: 789 }],
    ["variation ID", { variationId: 789 }], ["host", { sourceHost: "other-woo.example", merchantUrl: "https://other-woo.example/product/exact-keyboard/" }],
    ["selected color", { selectedAttributes: { Color: "White", Layout: "ANSI" } }], ["condition", { condition: "USED" }],
    ["parent inventory", { availabilityScope: "PARENT" }], ["unknown inventory", { availability: "UNKNOWN" }],
    ["backorder", { availability: "BACKORDER" }], ["future observation", { checkedAt: "2026-09-08T13:01:00.000Z" }],
    ["stale observation", { checkedAt }]
  ] satisfies Array<[string, Partial<WooProduct>]>)("preserves the baseline and emits no alert for %s", async (_name, change) => {
    const store = createMemoryWatchStore();
    const created = await store.create(spec, checkedAt);
    const baseline = await evaluateWatch(created, store, shopify, deals, undefined, now, source(() => product));
    const later = new Date("2026-09-08T13:00:00.000Z");
    const result = await evaluateWatch(baseline.watch, store, shopify, deals, undefined, later, source(() => ({
      ...product, availability: "IN_STOCK", checkedAt: later.toISOString(), ...change
    })));
    expect(result.status).toBe("DATA_SOURCE_UNAVAILABLE");
    expect(await store.get(created.watchId)).toEqual(baseline.watch);
  });

  it.each(["disabled", "not found", "failure", "unsupported"])("does not query Shopify or invent a stock baseline when Woo is %s", async mode => {
    const store = createMemoryWatchStore();
    const watch = await store.create(spec, checkedAt);
    const woo = mode === "disabled" ? undefined : source(() => mode === "not found" ? undefined : product);
    if (mode === "failure") vi.mocked(woo!.lookup).mockRejectedValue(new Error("SOURCE_UNAVAILABLE"));
    if (mode === "unsupported") vi.mocked(woo!.lookup).mockResolvedValue({ source: "WOOCOMMERCE_STORE_API",
      registryVersion: "fixture-v1", status: "UNSUPPORTED", checkedAt });
    const result = await evaluateWatch(watch, store, shopify, deals, undefined, now, woo);
    expect(result.status).toBe("DATA_SOURCE_UNAVAILABLE");
    expect(await store.get(watch.watchId)).toEqual(watch);
    expect(shopify.search).not.toHaveBeenCalled();
  });

  it.each(["missing price", "parent price", "non-USD", "wrong units"])("does not turn %s into a price notification", async mode => {
    const store = createMemoryWatchStore();
    const watch = await store.create({ ...spec, condition: "PRICE_BELOW", priceBasis: "ITEM_PRICE", threshold: 5000 }, checkedAt);
    const observed = structuredClone(product);
    if (mode === "missing price") delete observed.itemPrice;
    if (mode === "parent price") observed.priceEvidence.scope = "PARENT_RANGE";
    if (mode === "non-USD") observed.priceEvidence.currency = "EUR";
    if (mode === "wrong units") observed.priceEvidence.currencyMinorUnit = 0;
    const result = await evaluateWatch(watch, store, shopify, deals, undefined, now, source(() => observed));
    expect(result.status).toBe("DATA_SOURCE_UNAVAILABLE");
    expect(await store.get(watch.watchId)).toEqual(watch);
  });

  it("does not replace a newer price with an older response when inventory is unknown", async () => {
    const store = createMemoryWatchStore();
    const watch = await store.create({ ...spec, condition: "PRICE_BELOW", priceBasis: "ITEM_PRICE", threshold: 5000 }, checkedAt);
    const baseline = await evaluateWatch(watch, store, shopify, deals, undefined, new Date("2026-09-08T12:05:00.000Z"),
      source(() => ({ ...product, availability: "UNKNOWN", checkedAt: "2026-09-08T12:05:00.000Z",
        itemPrice: { amountCents: 6000, currency: "USD" }, priceEvidence: { ...product.priceEvidence, amountMinor: "6000" } })));
    expect(baseline.status).toBe("NOT_TRIGGERED");
    const result = await evaluateWatch(baseline.watch, store, shopify, deals, undefined, new Date("2026-09-08T12:06:00.000Z"),
      source(() => ({ ...product, availability: "UNKNOWN", checkedAt: "2026-09-08T12:04:00.000Z" })));
    expect(result.status).toBe("DATA_SOURCE_UNAVAILABLE");
    expect(await store.get(watch.watchId)).toEqual(baseline.watch);
  });

  it("accepts source time recorded during the lookup while preserving observation order", async () => {
    const store = createMemoryWatchStore();
    const watch = await store.create({ ...spec, condition: "PRICE_BELOW", priceBasis: "ITEM_PRICE", threshold: 1000 }, checkedAt);
    let elapsed = 100;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    try {
      const fresh = await evaluateWatch(watch, store, shopify, deals, undefined, now, source(() => {
        elapsed = 350;
        return { ...product, availability: "UNKNOWN", checkedAt: "2026-09-08T12:00:00.200Z" };
      }));
      expect(fresh.status).toBe("NOT_TRIGGERED");
      expect(fresh.observation?.checkedAt).toBe("2026-09-08T12:00:00.200Z");
      const older = await evaluateWatch(fresh.watch, store, shopify, deals, undefined, new Date("2026-09-08T12:00:00.500Z"),
        source(() => ({ ...product, availability: "UNKNOWN", checkedAt: "2026-09-08T12:00:00.100Z" })));
      expect(older.status).toBe("DATA_SOURCE_UNAVAILABLE");
      expect(await store.get(watch.watchId)).toEqual(fresh.watch);
    } finally { clock.mockRestore(); }
  });

  it("returns authoritative creation evidence without creating a rule or a notification", async () => {
    const observed = await observeWooProduct({ spec }, source(() => product), now);
    expect(observed.satisfied).toBe(false);
    expect(observed.data).toMatchObject({ sourceKind: "WOOCOMMERCE_STORE_API", merchantId: "reviewed-woo",
      productId: 123, parentProductId: 123, variationId: 456, availability: "OUT_OF_STOCK", checkedAt });
    await expect(observeWooProduct({ spec }, source(() => ({ ...product, availability: "UNKNOWN" })), now))
      .rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
  });
});
