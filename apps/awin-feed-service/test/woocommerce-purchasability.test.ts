import { describe, expect, it } from "vitest";
import { WooRegistrySchema } from "../src/woocommerce-registry.js";
import { createWooStoreReader, normalizeWooProduct, type WooRawProduct } from "../src/woocommerce-store.js";

const store = WooRegistrySchema.parse({ version: "purchase-test", stores: [{ merchantId: "a", name: "A", origin: "https://shop.example",
  productPathPrefixes: ["/product/"], currency: "USD", reviewedAt: "2026-09-08", evidenceUrl: "https://shop.example/",
  enabled: true, capabilities: { search: true, variations: true } }] }).stores[0]!;
const at = "2026-09-08T12:00:00.000Z";
const raw: WooRawProduct = { id: 10, name: "Coffee", type: "simple", permalink: "/product/coffee/",
  prices: { price: "1099", currency_code: "USD", currency_minor_unit: 2 }, is_in_stock: true };

describe("Woo explicit non-purchasability is independent from stock", () => {
  it("preserves simple identity without a price or availability assertion when purchase is explicitly unavailable", () => {
    const product = normalizeWooProduct({ ...raw, is_purchasable: false }, store, at)!;
    expect(product.productId).toBe(10);
    expect(product.itemPrice).toBeUndefined();
    expect(product.priceEvidence).toMatchObject({ amountMinor: "1099", scope: "UNKNOWN" });
    expect(product.availability).toBe("UNKNOWN");
  });
  it("also withholds the child price when all its selected dimensions are bound", () => {
    const parent = { ...raw, type: "variable", variations: [{ id: 11, attributes: [{ name: "Grind", value: "Whole Bean" }] }] };
    const product = normalizeWooProduct({ ...raw, id: 11, parent: 10, type: "variation", is_purchasable: false }, store, at, parent)!;
    expect(product).toMatchObject({ productId: 10, variationId: 11, selectedAttributes: { grind: "Whole Bean" }, availability: "UNKNOWN" });
    expect(product.itemPrice).toBeUndefined();
    expect(product.priceEvidence.scope).toBe("UNKNOWN");
  });
  it.each([true, undefined])("does not invent a denial when is_purchasable is %s", value => {
    expect(normalizeWooProduct({ ...raw, ...(value === undefined ? {} : { is_purchasable: value }) }, store, at))
      .toMatchObject({ itemPrice: { amountCents: 1099, currency: "USD" }, availability: "IN_STOCK", priceEvidence: { scope: "PRODUCT" } });
  });
  it.each(["false", 0, null])("does not coerce malformed is_purchasable=%j", async value => {
    const reader = createWooStoreReader({ resolve: async () => [{ address: "8.8.8.8", family: 4 }],
      request: async () => Response.json({ ...raw, is_purchasable: value }) });
    await expect(reader.product(store, 10, { signal: new AbortController().signal, requests: 0, bytes: 0, maxRequests: 1, maxBytes: 1024 * 1024 }))
      .rejects.toMatchObject({ reason: "INVALID_RESPONSE" });
  });
});
