import { describe, expect, it, vi } from "vitest";

import { createShopifyStorefrontReader } from "../src/configured/shopify-storefront-reader.js";

const product = {
  title: "Valhalla Java Single-Serve Pods",
  handle: "valhalla-java-single-serve-pods",
  vendor: "Death Wish Coffee",
  onlineStoreUrl: "https://deathwishcoffee.com/products/valhalla-java-single-serve-pods",
  featuredImage: { url: "https://cdn.shopify.com/product.jpg" },
  selectedOrFirstAvailableVariant: {
    title: "10 count",
    sku: "5094SSC",
    barcode: "810063341254",
    availableForSale: true,
    price: { amount: "14.99", currencyCode: "USD" },
    image: null
  }
};

describe("Shopify Storefront reader", () => {
  it("queries one audited tokenless storefront and maps public product data", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => ({
      response: new Response(JSON.stringify({ data: { products: { nodes: [product] } } }), {
        headers: { "content-type": "application/json" }
      }),
      finalUrl: input.url
    }));
    const reader = createShopifyStorefrontReader(["deathwishcoffee.com"], {
      host: "deathwishcoffee.com",
      apiVersion: "2026-07"
    }, { safeFetch, clock: { now: () => new Date("2026-08-18T01:00:00.000Z") } });

    const result = await reader.capture({ operation: "search", query: "Valhalla Java", limit: 3 });

    expect(result.records).toEqual([{
      merchantProductId: "valhalla-java-single-serve-pods",
      title: "Valhalla Java Single-Serve Pods — 10 count",
      brand: "Death Wish Coffee",
      mpn: "5094SSC",
      gtins: ["810063341254"],
      imageUrl: "https://cdn.shopify.com/product.jpg",
      rawOffer: {
        price: "14.99",
        priceCurrency: "USD",
        availability: "IN_STOCK",
        url: "https://deathwishcoffee.com/products/valhalla-java-single-serve-pods"
      }
    }]);
    expect(result.checkedAt).toBe("2026-08-18T01:00:00.000Z");
    const requested = new URL(safeFetch.mock.calls[0]![0].url);
    expect(requested.origin).toBe("https://deathwishcoffee.com");
    expect(requested.pathname).toBe("/api/2026-07/graphql.json");
    expect(requested.searchParams.get("query")).toContain("products(first: $first");
    expect(JSON.parse(requested.searchParams.get("variables") ?? "{}")).toEqual({
      first: 3,
      query: "Valhalla Java"
    });
  });

  it("gets one product by a bounded handle", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => ({
      response: new Response(JSON.stringify({ data: { product } }), {
        headers: { "content-type": "application/json" }
      }),
      finalUrl: input.url
    }));
    const reader = createShopifyStorefrontReader(["deathwishcoffee.com"], {
      host: "deathwishcoffee.com",
      apiVersion: "2026-07"
    }, { safeFetch });

    const result = await reader.capture({
      operation: "get",
      merchantProductId: "valhalla-java-single-serve-pods"
    });

    expect(result.records).toHaveLength(1);
    expect(JSON.parse(new URL(safeFetch.mock.calls[0]![0].url).searchParams.get("variables") ?? "{}"))
      .toEqual({ handle: "valhalla-java-single-serve-pods" });
  });

  it("fails closed on unaudited hosts, unsafe inputs, GraphQL errors, and external product URLs", async () => {
    expect(() => createShopifyStorefrontReader(["approved.example"], {
      host: "deathwishcoffee.com",
      apiVersion: "2026-07"
    })).toThrow(/audited/u);

    const graphqlError = createShopifyStorefrontReader(["deathwishcoffee.com"], {
      host: "deathwishcoffee.com",
      apiVersion: "2026-07"
    }, {
      safeFetch: async (input) => ({
        response: new Response(JSON.stringify({ errors: [{ message: "denied" }] }), {
          headers: { "content-type": "application/json" }
        }),
        finalUrl: input.url
      })
    });
    await expect(graphqlError.capture({ operation: "search", query: "coffee", limit: 2 }))
      .rejects.toThrow(/GraphQL/u);
    await expect(graphqlError.capture({ operation: "search", query: "x", limit: 2 }))
      .rejects.toThrow(/query/u);
    await expect(graphqlError.capture({ operation: "get", merchantProductId: "../admin" }))
      .rejects.toThrow(/handle/u);

    const externalUrl = createShopifyStorefrontReader(["deathwishcoffee.com"], {
      host: "deathwishcoffee.com",
      apiVersion: "2026-07"
    }, {
      safeFetch: async (input) => ({
        response: new Response(JSON.stringify({
          data: { products: { nodes: [{ ...product, onlineStoreUrl: "https://evil.example/item" }] } }
        }), { headers: { "content-type": "application/json" } }),
        finalUrl: input.url
      })
    });
    await expect(externalUrl.capture({ operation: "search", query: "coffee", limit: 2 }))
      .rejects.toThrow(/response is invalid/u);
  });
});
