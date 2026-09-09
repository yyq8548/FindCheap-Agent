import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { WooSearchInputSchema } from "../../../packages/contracts/src/woocommerce.js";
import { createWooCommerceController } from "../src/woocommerce.js";
import { WooMerchantSchema } from "../src/woocommerce-registry.js";
import { normalizeWooProduct, type WooRawProduct } from "../src/woocommerce-store.js";

const saved = JSON.parse(readFileSync(new URL("fixtures/woocommerce-live/jbc-subscription-coffee.json", import.meta.url), "utf8")) as {
  observedAt: string; observations: { url: string; status: number; body: WooRawProduct }[];
};
const parent = saved.observations.find(observation => observation.body.id === 399)!.body;
const children = saved.observations.filter(observation => observation.body.id !== 399).map(observation => observation.body);
const store = WooMerchantSchema.parse({ merchantId: "jbc-coffee-roasters", name: "JBC Coffee Roasters",
  origin: "https://jbccoffeeroasters.com", productPathPrefixes: ["/product/"], categories: ["coffee"],
  currency: "USD", reviewedAt: "2026-09-09", evidenceUrl: saved.observations[0]!.url,
  enabled: true, capabilities: { search: true, variations: true } });
const plain: WooRawProduct = { id: 10, name: "Coffee beans", type: "simple", permalink: "/product/beans/",
  prices: { price: "1099", currency_code: "USD", currency_minor_unit: 2 }, has_options: false, is_purchasable: true, is_in_stock: true };

function fixtureController() {
  const request = vi.fn(async (url: URL, init: RequestInit) => {
    expect(url.origin).toBe(store.origin);
    expect(init.method ?? "GET").toBe("GET");
    expect(url.searchParams.has("add-to-cart")).toBe(false);
    const id = /^\/wp-json\/wc\/store\/v1\/products\/(\d+)$/u.exec(url.pathname)?.[1];
    const body = id === undefined ? url.searchParams.get("type") === "variation" ? children : [parent]
      : saved.observations.find(observation => observation.body.id === Number(id))?.body;
    if (body === undefined) throw new Error("Unrecorded fixture request");
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "x-wp-totalpages": "1" } });
  });
  const controller = createWooCommerceController({ version: "subscription-price-fixture", stores: [store] }, {
    now: () => Date.parse(saved.observedAt), resolve: async () => [{ address: "8.8.8.8", family: 4 }], request
  });
  return { controller, request };
}

describe("Woo subscription billing scope", () => {
  it.each(children)("retains the observed zero and selected $id identity without asserting a complete item price", child => {
    const product = normalizeWooProduct(child, store, saved.observedAt, parent)!;
    expect(child).toMatchObject({ prices: { price: "0" }, has_options: false, is_purchasable: true, is_in_stock: true });
    expect(product).toMatchObject({ productId: 399, parentProductId: 399, variationId: child.id,
      availability: "IN_STOCK", availabilityScope: "VARIANT", priceEvidence: { amountMinor: "0", currency: "USD", scope: "UNKNOWN" } });
    expect(product.itemPrice).toBeUndefined();
    expect(product.merchantUrl).toBe(child.permalink);
  });

  it("applies the same observations through reader-backed search, lookup and inspection", async () => {
    const { controller, request } = fixtureController();
    const found = await controller.search(WooSearchInputSchema.parse({ query: "coffee" }));
    const lookup = await controller.lookup({ merchantId: store.merchantId, productId: 399, variationId: 684 });
    const inspection = await controller.inspect({ merchantId: store.merchantId, productId: 399, variationId: 684 }, {});
    expect(found.status).toBe("COMPLETE");
    expect(found.products).toHaveLength(3);
    expect(lookup.status).toBe("FOUND");
    expect(inspection.status).toBe("COMPLETE");
    expect(inspection.products).toHaveLength(3);
    for (const product of [...found.products, lookup.product!, ...inspection.products]) {
      expect(product.itemPrice).toBeUndefined();
      expect(product.priceEvidence).toMatchObject({ amountMinor: "0", scope: "UNKNOWN" });
      expect(product.availability).toBe("IN_STOCK");
    }
    expect(request).toHaveBeenCalledTimes(7);
  });

  it("does not count an unknown subscription amount as satisfying an item-price budget", async () => {
    const { controller } = fixtureController();
    const result = await controller.search(WooSearchInputSchema.parse({ query: "coffee", maxItemPriceCents: 4000 }));
    expect(result.status).toBe("COMPLETE");
    expect(result.products).toEqual([]);
    expect(result.stores[0]).toMatchObject({ returned: 0, requests: 2 });
  });

  it.each([
    { name: "Coffee subscription", categories: [] },
    { name: "Coffee", categories: [{ name: "Coffee Subscriptions" }] }
  ])("inherits an explicit parent subscription identity even when the child lacks it: $name", identity => {
    const child = { ...children[0]!, name: "Coffee", categories: [], prices: { ...children[0]!.prices, price: "1500" } };
    const product = normalizeWooProduct(child, store, saved.observedAt, { ...parent, ...identity })!;
    expect(product.itemPrice).toBeUndefined();
    expect(product.priceEvidence).toMatchObject({ amountMinor: "1500", scope: "UNKNOWN" });
    expect(product.availability).toBe("IN_STOCK");
  });

  it.each([
    { name: "Monthly Coffee Subscription" },
    { categories: [{ name: "Coffee subscription" }] }
  ])("does not present a simple subscription as a one-time item price: %j", identity => {
    const product = normalizeWooProduct({ ...plain, ...identity }, store, saved.observedAt)!;
    expect(product.itemPrice).toBeUndefined();
    expect(product.priceEvidence).toMatchObject({ amountMinor: "1099", scope: "UNKNOWN" });
    expect(product.availability).toBe("IN_STOCK");
  });

  it("keeps ordinary zero prices and does not infer a subscription from descriptive marketing", () => {
    const description = "Coffee subscriptions also available. Subscribe for offers.";
    const product = normalizeWooProduct({ ...plain, description }, store, saved.observedAt)!;
    expect(product.itemPrice).toEqual({ amountCents: 1099, currency: "USD" });
    const zero = normalizeWooProduct({ ...plain, prices: { ...plain.prices, price: "0" } }, store, saved.observedAt)!;
    expect(zero.itemPrice).toEqual({ amountCents: 0, currency: "USD" });
    expect(zero.priceEvidence.scope).toBe("PRODUCT");
    const ordinaryParent = { ...parent, name: "Coffee", categories: [{ name: "Coffee" }] };
    const child = normalizeWooProduct({ ...children[0]!, name: "Coffee", description }, store, saved.observedAt, ordinaryParent)!;
    expect(child.itemPrice).toEqual({ amountCents: 0, currency: "USD" });
    expect(child.priceEvidence.scope).toBe("VARIANT");
  });

  it.each(["one time purchase", "one-time purchase"])("keeps an explicitly bound %s price despite a generic subscription category", label => {
    const product = normalizeWooProduct({ ...plain, name: `Coffee (${label})`,
      categories: [{ name: "Subscription" }] }, store, saved.observedAt)!;
    expect(product.itemPrice).toEqual({ amountCents: 1099, currency: "USD" });
    expect(product.priceEvidence.scope).toBe("PRODUCT");
  });

  it("does not use one-time marketing or unselected options to override subscription evidence", () => {
    const product = normalizeWooProduct({ ...plain, categories: [{ name: "Subscription" }],
      description: "One-time purchase available", attributes: [{ name: "Delivery Frequency", terms: [{ name: "One-time Purchase" }] }] }, store, saved.observedAt)!;
    expect(product.itemPrice).toBeUndefined();
    expect(product.priceEvidence.scope).toBe("UNKNOWN");
    const direct = normalizeWooProduct({ ...plain, name: "Coffee subscription (one-time purchase)" }, store, saved.observedAt)!;
    expect(direct.itemPrice).toBeUndefined();
    const child = normalizeWooProduct({ ...children[0]!, name: "Coffee (one-time purchase)" }, store, saved.observedAt, parent)!;
    expect(child.itemPrice).toBeUndefined();
  });

  it("preserves exact parent binding and existing unresolved-option restrictions", () => {
    expect(normalizeWooProduct({ ...children[0]!, parent: 999 }, store, saved.observedAt, parent)).toBeUndefined();
    const unresolved = normalizeWooProduct({ ...children[0]!, has_options: true }, store, saved.observedAt, parent)!;
    expect(unresolved.itemPrice).toBeUndefined();
    expect(unresolved.availability).toBe("UNKNOWN");
  });
});
