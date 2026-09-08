import { describe, expect, it, vi } from "vitest";
import { WooRegistrySchema } from "../src/woocommerce-registry.js";
import { createWooStoreReader, normalizeWooProduct, wooMatchesRequirements, type WooRawProduct } from "../src/woocommerce-store.js";

export const store = WooRegistrySchema.parse({ version: "test", stores: [{ merchantId: "a", name: "A", origin: "https://shop.example", productPathPrefixes: ["/product/"], currency: "USD", reviewedAt: "2026-09-08", evidenceUrl: "https://shop.example", enabled: true, capabilities: { search: true, variations: true } }] }).stores[0]!;
export const raw: WooRawProduct = { id: 10, name: "Desk", type: "simple", permalink: "/product/desk", prices: { price: "1099", currency_code: "USD", currency_minor_unit: 2 }, is_in_stock: true };
const at = "2026-09-08T12:00:00.000Z";
describe("Woo source observations", () => {
  it("keeps exact USD minor-unit facts and missing/foreign prices unpriced", () => {
    expect(normalizeWooProduct(raw, store, at)?.itemPrice).toEqual({ amountCents: 1099, currency: "USD" });
    for (const prices of [{ currency_code: "USD", currency_minor_unit: 2 }, { price: "1099", currency_code: "EUR", currency_minor_unit: 2 }, { price: "1.99", currency_code: "USD", currency_minor_unit: 2 }]) {
      expect(normalizeWooProduct({ ...raw, prices }, store, at)?.itemPrice).toBeUndefined();
    }
    expect(normalizeWooProduct({ ...raw, type: "variable" }, store, at)?.itemPrice).toBeUndefined();
  });
  it("binds parent attributes to exact child while preserving child inventory and price", () => {
    const parent = { ...raw, type: "variable", variations: [{ id: 11, attributes: [{ name: "Color", value: "Red" }, { name: "Size", value: "M" }] }] };
    const child = normalizeWooProduct({ ...raw, id: 11, type: "variation", parent: 10, is_in_stock: false, prices: { ...raw.prices, price: "1599" } }, store, at, parent)!;
    expect(child).toMatchObject({ productId: 10, parentProductId: 10, variationId: 11, itemPrice: { amountCents: 1599 }, availability: "OUT_OF_STOCK", selectedAttributes: { color: "Red", size: "M" } });
    expect(wooMatchesRequirements(child, { color: "Red", size: "M" })).toBe(true);
    expect(wooMatchesRequirements(child, { color: "Blue" })).toBe(false);
    expect(normalizeWooProduct({ ...raw, id: 11, type: "variation", parent: 999 }, store, at, parent)).toBeUndefined();
    expect(normalizeWooProduct({ ...raw, id: 11, type: "variation", parent: 10, attributes: [{ name: "Color", value: "Blue" }] }, store, at, parent)).toBeUndefined();
  });
  it("rejects private DNS and cross-host redirects before sending unsafe requests", async () => {
    const request = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    const budget = () => ({ signal: new AbortController().signal, requests: 0, bytes: 0, maxRequests: 18, maxBytes: 8 * 1024 * 1024 });
    await expect(createWooStoreReader({ resolve: async () => [{ address: "127.0.0.1", family: 4 }], request }).product(store, 10, budget())).rejects.toMatchObject({ reason: "SECURITY_REJECTED" });
    expect(request).not.toHaveBeenCalled();
    await expect(createWooStoreReader({ resolve: async () => [{ address: "8.8.8.8", family: 4 }], request }).product(store, 10, budget())).rejects.toMatchObject({ reason: "SECURITY_REJECTED" });
    expect(request).toHaveBeenCalledTimes(1);
    request.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "https://shop.example/?add-to-cart=10" } }));
    await expect(createWooStoreReader({ resolve: async () => [{ address: "8.8.8.8", family: 4 }], request }).product(store, 10, budget())).rejects.toMatchObject({ reason: "SECURITY_REJECTED" });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not turn conflicting stock evidence into a restock", () => {
    expect(normalizeWooProduct({ ...raw, stock_status: "outofstock", is_in_stock: true }, store, at)?.availability).toBe("UNKNOWN");
    expect(normalizeWooProduct({ ...raw, stock_status: "onbackorder" }, store, at)?.availability).toBe("BACKORDER");
    expect(normalizeWooProduct({ ...raw, images: [{ id: 1, src: "https://shop.example/?add-to-cart=10" }] }, store, at)?.images).toEqual([]);
  });
  it("rejects HTML, excessive bytes and mismatched identity from the upstream", async () => {
    const budget = () => ({ signal: new AbortController().signal, requests: 0, bytes: 0, maxRequests: 18, maxBytes: 8 * 1024 * 1024 });
    const resolve = async () => [{ address: "8.8.8.8", family: 4 }];
    await expect(createWooStoreReader({ resolve, request: async () => new Response("<html/>", { headers: { "content-type": "text/html" } }) }).product(store, 10, budget())).rejects.toMatchObject({ reason: "INVALID_RESPONSE" });
    await expect(createWooStoreReader({ resolve, request: async () => new Response("{}", { headers: { "content-type": "application/json", "content-length": String(2 * 1024 * 1024) } }) }).product(store, 10, budget())).rejects.toMatchObject({ reason: "SECURITY_REJECTED" });
    await expect(createWooStoreReader({ resolve, request: async () => new Response(JSON.stringify({ ...raw, id: 999 }), { headers: { "content-type": "application/json" } }) }).product(store, 10, budget())).rejects.toMatchObject({ reason: "SECURITY_REJECTED" });
  });
});
