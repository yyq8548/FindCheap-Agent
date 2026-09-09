import { describe, expect, it } from "vitest";
import fixture from "./fixtures/woocommerce-hidden-secrets.json" with { type: "json" };
import { WooMerchantSchema } from "../src/woocommerce-registry.js";
import { createWooStoreReader, normalizeWooProduct, type WooRawProduct } from "../src/woocommerce-store.js";

const store = WooMerchantSchema.parse(fixture.store);
const observed = fixture.page1.find(value => value.id === 20928)!;
const parent = fixture.parent as WooRawProduct;
async function read(raw: unknown) {
  const reader = createWooStoreReader({ resolve: async () => [{ address: "8.8.8.8", family: 4 }], request: async () => Response.json([raw]) });
  return (await reader.list(store, new URLSearchParams(), {
    signal: new AbortController().signal, requests: 0, bytes: 0, maxRequests: 1, maxBytes: 1024 * 1024
  })).products[0]!;
}

describe("optional Woo SKU does not replace variant identity", () => {
  it("keeps the real false-SKU variant without inventing SKU or price", async () => {
    expect(observed.sku).toBe(false);
    const raw = await read(observed);
    expect(raw.sku).toBeUndefined();
    expect(normalizeWooProduct(raw, store, fixture.checkedAt, parent)).toMatchObject({
      productId: 19030, variationId: 20928, selectedAttributes: { color: "rl56-60" },
      itemPrice: { amountCents: 23200, currency: "USD" }, priceEvidence: { scope: "VARIANT" }, availability: "IN_STOCK"
    });
    expect(normalizeWooProduct(raw, store, fixture.checkedAt, parent)?.sku).toBeUndefined();
  });

  it.each([true, null, 17, {}, [], "x".repeat(301)])("rejects other invalid SKU values %#", async sku => {
    await expect(read({ ...observed, sku })).rejects.toMatchObject({ reason: "INVALID_RESPONSE", failureDetail: "PRODUCT_SCHEMA" });
  });

  it("still requires valid IDs, parent binding, owned URL, and USD price", async () => {
    await expect(read({ ...observed, id: 0, sku: "valid" })).rejects.toMatchObject({ reason: "INVALID_RESPONSE" });
    const raw = await read({ ...observed, sku: "valid" });
    expect(normalizeWooProduct({ ...raw, parent: 999 }, store, fixture.checkedAt, parent)).toBeUndefined();
    expect(normalizeWooProduct({ ...raw, permalink: "https://evil.example/product/fascination/" }, store, fixture.checkedAt, parent)).toBeUndefined();
    expect(normalizeWooProduct({ ...raw, prices: { ...raw.prices, currency_code: "EUR" } }, store, fixture.checkedAt, parent)?.itemPrice).toBeUndefined();
  });
});
