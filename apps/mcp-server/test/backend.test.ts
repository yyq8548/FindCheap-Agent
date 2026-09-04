import { describe, expect, it } from "vitest";
import { createAffiliateLinkResolver } from "../src/affiliate-links.js";
import { createFindCheapBackend } from "../src/backend.js";
import { createUnavailableDealPort } from "../src/deal-client.js";
import { createUnavailableShopifyPort } from "../src/shopify-client.js";
import { createMemoryWatchStore } from "../src/watch-store.js";
import type { ShopifyCartQuotePort } from "../src/shopify-cart-quote.js";
import type { ShopifySelectedProductInspector } from "../src/shopify-selected-product.js";
import { createUnavailableAwinPort } from "../../../packages/awin-feed/src/index.js";

function backend(verifiedDeals: boolean, productCapabilities = false) {
  return createFindCheapBackend({
    catalog: {
      shopify: createUnavailableShopifyPort(),
      awin: createUnavailableAwinPort()
    },
    product: {
      affiliateLinks: createAffiliateLinkResolver(),
      ...(productCapabilities ? {
        selectedProducts: {} as ShopifySelectedProductInspector,
        cartQuotes: {} as ShopifyCartQuotePort
      } : {})
    },
    deals: createUnavailableDealPort(),
    watches: createMemoryWatchStore(),
    verifiedDeals
  });
}

describe("FindCheap Backend facade", () => {
  it("does not advertise optional capabilities without their ports", () => {
    const value = backend(true);
    expect(value.catalog.shopify.search).toBeTypeOf("function");
    expect(value.catalog.awin.search).toBeTypeOf("function");
    expect(value.product.affiliateLinks.resolve).toBeTypeOf("function");
    expect(value.watches.list).toBeTypeOf("function");
    expect(value.capabilities).toEqual(new Set([
      "CATALOG",
      "WATCHES",
      "VERIFIED_DEALS"
    ]));
  });

  it("advertises inspection and quote only when their ports exist", () => {
    expect(backend(false, true).capabilities).toEqual(new Set([
      "CATALOG",
      "PRODUCT_INSPECTION",
      "PRODUCT_QUOTE",
      "WATCHES"
    ]));
  });

  it("derives optional deal availability from backend configuration", () => {
    expect(backend(false).capabilities.has("VERIFIED_DEALS")).toBe(false);
  });
});
