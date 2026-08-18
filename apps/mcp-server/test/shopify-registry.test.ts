import { describe, expect, it } from "vitest";

import {
  parseShopifyRegistry,
  SHOPIFY_REGISTRY
} from "../src/shopify-registry.js";

const merchant = {
  merchantId: "merchant-one",
  merchant: "Merchant One",
  apiHost: "shop.example.com",
  allowedHosts: ["shop.example.com"],
  apiVersion: "2026-07",
  probeQuery: "shirt",
  searchEnabled: true
} as const;

describe("audited Shopify merchant registry", () => {
  it("loads the checked-in registry with a bounded unique allowlist", () => {
    expect(SHOPIFY_REGISTRY.version).toMatch(/^v\d+$/u);
    expect(SHOPIFY_REGISTRY.merchants).toHaveLength(10);
    expect(new Set(SHOPIFY_REGISTRY.merchants.map((entry) => entry.merchantId)).size).toBe(10);
    expect(new Set(SHOPIFY_REGISTRY.merchants.map((entry) => entry.apiHost)).size).toBe(10);
  });

  it("rejects duplicate identities, duplicate hosts, and unaudited sibling hosts", () => {
    expect(() => parseShopifyRegistry({ version: "v1", merchants: [merchant, merchant] }))
      .toThrow("Shopify registry merchantId must be unique");
    expect(() => parseShopifyRegistry({
      version: "v1",
      merchants: [merchant, { ...merchant, merchantId: "merchant-two" }]
    })).toThrow("Shopify registry apiHost must be unique");
    expect(() => parseShopifyRegistry({
      version: "v1",
      merchants: [{ ...merchant, allowedHosts: ["shop.example.com", "evil.example.net"] }]
    })).toThrow("Shopify registry allowedHosts must stay on the merchant host");
  });

  it("rejects URLs, wildcards, disabled-only registries, and more than fifty merchants", () => {
    expect(() => parseShopifyRegistry({
      version: "v1",
      merchants: [{ ...merchant, apiHost: "https://shop.example.com" }]
    })).toThrow();
    expect(() => parseShopifyRegistry({
      version: "v1",
      merchants: [{ ...merchant, allowedHosts: ["*.example.com"] }]
    })).toThrow();
    expect(() => parseShopifyRegistry({
      version: "v1",
      merchants: [{ ...merchant, searchEnabled: false }]
    })).toThrow("Shopify registry has no search-enabled merchants");
    expect(() => parseShopifyRegistry({
      version: "v1",
      merchants: Array.from({ length: 51 }, (_, index) => ({
        ...merchant,
        merchantId: `merchant-${index}`,
        apiHost: `shop-${index}.example.com`,
        allowedHosts: [`shop-${index}.example.com`]
      }))
    })).toThrow();
  });
});
