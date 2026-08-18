import { describe, expect, it, vi } from "vitest";

import { createShopifyPortFromEnvironment } from "../src/shopify-client.js";

describe("Shopify Storefront MCP client", () => {
  it("uses the fixed pilot storefront and returns item-price data", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => ({
      response: new Response(JSON.stringify({
        data: {
          products: {
            nodes: [{
              title: "Valhalla Java Single-Serve Pods",
              handle: "valhalla-java-single-serve-pods",
              vendor: "Death Wish Coffee",
              onlineStoreUrl: "https://deathwishcoffee.com/products/valhalla-java-single-serve-pods",
              featuredImage: null,
              selectedOrFirstAvailableVariant: {
                title: "10 count",
                sku: "5094SSC",
                barcode: "810063341254",
                availableForSale: true,
                price: { amount: "14.99", currencyCode: "USD" },
                image: null
              }
            }]
          }
        }
      }), { headers: { "content-type": "application/json" } }),
      finalUrl: input.url
    }));
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_HOST: "deathwishcoffee.com" },
      { safeFetch, clock: { now: () => new Date("2026-08-18T01:00:00.000Z") } }
    );

    const result = await port.search({ query: "Valhalla Java", limit: 5 });

    expect(result).toEqual({
      merchant: "Death Wish Coffee",
      products: [{
        handle: "valhalla-java-single-serve-pods",
        title: "Valhalla Java Single-Serve Pods — 10 count",
        brand: "Death Wish Coffee",
        sku: "5094SSC",
        gtins: ["810063341254"],
        itemPrice: { amountCents: 1_499, currency: "USD" },
        availability: "IN_STOCK",
        merchantUrl: "https://deathwishcoffee.com/products/valhalla-java-single-serve-pods",
        checkedAt: "2026-08-18T01:00:00.000Z"
      }]
    });
    expect(new URL(safeFetch.mock.calls[0]![0].url).hostname).toBe("deathwishcoffee.com");
  });

  it("fails closed for absent or non-pilot storefront configuration", async () => {
    await expect(createShopifyPortFromEnvironment({}).search({ query: "coffee", limit: 5 }))
      .rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
    await expect(createShopifyPortFromEnvironment({
      SHOPIFY_STOREFRONT_HOST: "evil.example"
    }).search({ query: "coffee", limit: 5 })).rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
  });
});
