import { describe, expect, it, vi } from "vitest";
import { createWooCommercePortFromEnvironment } from "../src/woocommerce-client.js";
import { WooProductSchema } from "../../../packages/contracts/src/woocommerce.js";

export const wooFixture = (overrides: Record<string, unknown> = {}) => WooProductSchema.parse({
  sourceKind: "WOOCOMMERCE_STORE_API", merchantId: "test-store", merchantName: "Test Store", sourceHost: "store.example",
  productId: 123, title: "Mechanical Keyboard", productType: "simple", category: "Mechanical keyboards", condition: "NEW",
  attributes: [], selectedAttributes: {}, variantDimensions: {}, merchantUrl: "https://store.example/product/keyboard/", images: [],
  itemPrice: { amountCents: 1099, currency: "USD" }, priceEvidence: { amountMinor: "1099", currency: "USD", currencyMinorUnit: 2, scope: "PRODUCT", taxBasis: "UNKNOWN" },
  availability: "IN_STOCK", availabilityScope: "PRODUCT", checkedAt: "2026-09-08T12:00:00.000Z", ...overrides
});

describe("WooCommerce source contract and client", () => {
  it("accepts exact USD units and rejects range prices, mismatched hosts and malformed child IDs", () => {
    expect(wooFixture().itemPrice?.amountCents).toBe(1099);
    expect(() => wooFixture({ priceEvidence: { amountMinor: "1099", currency: "JPY", currencyMinorUnit: 0, scope: "PRODUCT", taxBasis: "UNKNOWN" } })).toThrow();
    expect(() => wooFixture({ priceEvidence: { amountMinor: "1099", currency: "USD", currencyMinorUnit: 2, scope: "PARENT_RANGE", taxBasis: "UNKNOWN" } })).toThrow();
    expect(() => wooFixture({ sourceHost: "other.example" })).toThrow();
    expect(() => wooFixture({ productType: "variation", variationId: 123 })).toThrow();
  });
  it("is optional and rejects caller-configured credentials or paths", () => {
    expect(createWooCommercePortFromEnvironment({})).toBeUndefined();
    expect(createWooCommercePortFromEnvironment({ WOOCOMMERCE_SOURCE_ENABLED: "false", WOOCOMMERCE_API_BASE_URL: "https://source.example" })).toBeUndefined();
    expect(() => createWooCommercePortFromEnvironment({ WOOCOMMERCE_API_BASE_URL: "https://user:password@source.example" })).toThrow();
    expect(() => createWooCommercePortFromEnvironment({ WOOCOMMERCE_API_BASE_URL: "https://source.example/path" })).toThrow();
  });
  it("uses fixed read endpoints and rejects a response for another selected product", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({ source: "WOOCOMMERCE_STORE_API",
      registryVersion: "test", status: "FOUND", product: wooFixture(), checkedAt: "2026-09-08T12:00:00.000Z" }));
    const port = createWooCommercePortFromEnvironment({ WOOCOMMERCE_API_BASE_URL: "https://source.example" }, { fetch })!;
    await expect(port.lookup({ merchantId: "test-store", productId: 123 })).resolves.toMatchObject({ status: "FOUND" });
    expect(fetch.mock.calls[0]?.[0]).toBe("https://source.example/v1/woocommerce/products/lookup");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", redirect: "error" });
    await expect(port.lookup({ merchantId: "other-store", productId: 123 })).rejects.toThrow("invalid product identity");
  });
  it("preserves cancellation and HTTP rate-limit failure", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("", { status: 429 }));
    const port = createWooCommercePortFromEnvironment({ WOOCOMMERCE_API_BASE_URL: "https://source.example" }, { fetch })!;
    await expect(port.lookup({ merchantId: "test-store", productId: 123 }, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await expect(port.lookup({ merchantId: "test-store", productId: 123 })).rejects.toThrow("HTTP 429");
  });
});
