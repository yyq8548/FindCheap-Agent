import { describe, expect, it } from "vitest";
import { WooRegistrySchema, wooMerchantForUrl, wooProductUrl, wooRegistryFromEnvironment } from "../src/woocommerce-registry.js";

export const merchant = {
  merchantId: "store-a", name: "Store A", origin: "https://store.example", productPathPrefixes: ["/product/"],
  currency: "USD", reviewedAt: "2026-09-08", evidenceUrl: "https://store.example/wp-json/wc/store/v1/products",
  enabled: true, capabilities: { search: true, variations: true }
};
describe("Woo independent registry", () => {
  it("is disabled by default and does not assign trust", () => {
    expect(wooRegistryFromEnvironment({})).toBeUndefined();
    const store = WooRegistrySchema.parse({ version: "test", stores: [merchant] }).stores[0]!;
    expect(store).not.toHaveProperty("trust");
    expect(wooProductUrl(store, "/product/chair")).toBe("https://store.example/product/chair");
  });
  it("rejects arbitrary URLs, credentials, ports and overlapping merchants", () => {
    const registry = WooRegistrySchema.parse({ version: "test", stores: [merchant] });
    for (const url of ["https://evil.example/product/chair", "http://store.example/product/chair", "https://a:b@store.example/product/chair", "https://store.example:444/product/chair", "https://store.example/wp-admin/"]) {
      expect(wooMerchantForUrl(registry, url)).toBeUndefined();
    }
    expect(WooRegistrySchema.safeParse({ version: "test", stores: [merchant, merchant] }).success).toBe(false);
    expect(WooRegistrySchema.safeParse({ version: "test", stores: [{ ...merchant, origin: "https://127.0.0.1" }] }).success).toBe(false);
  });
});
