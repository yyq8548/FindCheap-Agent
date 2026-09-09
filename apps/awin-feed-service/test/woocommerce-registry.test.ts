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
  it("loads a 1,000-store override with complete merchant evidence within a bounded payload", () => {
    const stores = Array.from({ length: 1_000 }, (_, index) => ({ ...merchant,
      merchantId: `merchant-${index}`, name: `Example Consumer Store ${index}`, origin: `https://merchant-${index}.example`,
      evidenceUrl: `https://merchant-${index}.example/wp-json/wc/store/v1/products/123456`,
      marketEvidence: `https://merchant-${index}.example/shipping-and-returns/`, apiPath: "/wp-json/wc/store/v1",
      imageHosts: [`images.merchant-${index}.example`], aliases: [`www.merchant-${index}.example`],
      categories: ["beauty", "skincare", "serum", "cleanser"], brands: ["Example Consumer Brand"]
    }));
    const raw = JSON.stringify({ version: "test-1000", stores });
    expect(Buffer.byteLength(raw)).toBeGreaterThan(512 * 1024);
    const registry = wooRegistryFromEnvironment({ WOOCOMMERCE_SOURCE_ENABLED: "true", WOOCOMMERCE_REGISTRY_JSON: raw });
    expect(registry?.stores).toHaveLength(1_000);
    expect(registry?.stores[999]?.marketEvidence).toBe("https://merchant-999.example/shipping-and-returns/");
  });
  it("rejects oversized override text before parsing", () => {
    expect(() => wooRegistryFromEnvironment({ WOOCOMMERCE_SOURCE_ENABLED: "true", WOOCOMMERCE_REGISTRY_JSON: " ".repeat(2 * 1024 * 1024 + 1) })).toThrow("Woo registry too large");
  });
});
