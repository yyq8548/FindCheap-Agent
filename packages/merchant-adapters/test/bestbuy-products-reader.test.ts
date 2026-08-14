import { describe, expect, it, vi } from "vitest";

import { createBestBuyProductsReader } from "../src/configured/bestbuy-products-reader.js";

const API_KEY = "testKey_123456789";
const product = {
  sku: 6568600,
  name: "Sony - WH-1000XM5 Wireless Headphones - Black",
  manufacturer: "Sony",
  modelNumber: "WH1000XM5/B",
  upc: "027242923232",
  image: "https://pisces.bbystatic.com/image2/BestBuy_US/images/products/6568/6568600.jpg",
  salePrice: 349.99,
  regularPrice: 399.99,
  onlineAvailability: true,
  url: "https://api.bestbuy.com/click/example/6568600/pdp"
};

function response(body: unknown, finalUrl: string) {
  return {
    response: new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" }
    }),
    finalUrl
  };
}

describe("Best Buy Products API reader", () => {
  it("searches official API and maps declared product identity, price, and availability", async () => {
    const seen: string[] = [];
    const reader = createBestBuyProductsReader(["api.bestbuy.com"], {
      apiKey: API_KEY,
      clock: { now: () => new Date("2026-08-14T02:00:00.000Z") },
      safeFetch: async (input) => {
        seen.push(input.url);
        return response({
          canonicalUrl: `/v1/products(search=sony)?apiKey=${API_KEY}`,
          products: [product]
        }, input.url);
      }
    });

    const snapshot = await reader.capture({
      operation: "search",
      query: "Sony WH-1000XM5",
      limit: 10
    });

    const requested = new URL(seen[0]!);
    expect(requested.origin).toBe("https://api.bestbuy.com");
    expect(requested.pathname).toContain("products(search=Sony&search=WH-1000XM5)");
    expect(requested.searchParams.get("apiKey")).toBe(API_KEY);
    expect(requested.searchParams.get("pageSize")).toBe("10");
    expect(snapshot).toMatchObject({
      checkedAt: "2026-08-14T02:00:00.000Z",
      records: [{
        merchantProductId: "6568600",
        title: product.name,
        brand: "Sony",
        mpn: "WH1000XM5/B",
        gtins: ["027242923232"],
        rawOffer: {
          price: 349.99,
          priceCurrency: "USD",
          availability: "IN_STOCK",
          url: product.url
        }
      }]
    });
    expect(snapshot.sourceUrl).not.toContain("apiKey");
    expect(snapshot.rawBody).not.toContain(API_KEY);
    expect(snapshot.rawBody).toContain("[REDACTED]");
  });

  it("loads a product by numeric SKU without permitting path/query injection", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => response(product, input.url));
    const reader = createBestBuyProductsReader(["api.bestbuy.com"], { apiKey: API_KEY, safeFetch });

    await expect(reader.capture({ operation: "get", merchantProductId: "6568600" }))
      .resolves.toMatchObject({ records: [{ merchantProductId: "6568600" }] });
    expect(new URL(safeFetch.mock.calls[0]![0].url).pathname).toBe("/v1/products/6568600.json");
    await expect(reader.capture({ operation: "get", merchantProductId: "6568600?apiKey=evil" }))
      .rejects.toThrow(/SKU is invalid/u);
    await expect(reader.capture({ operation: "search", query: "sony)|sku=*", limit: 10 }))
      .rejects.toThrow(/query is invalid/u);
    expect(safeFetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed for unsupported delivered-price operations and invalid credentials", async () => {
    expect(() => createBestBuyProductsReader(["api.bestbuy.com"], { apiKey: "short" }))
      .toThrow();
    expect(() => createBestBuyProductsReader(["other.example"], { apiKey: API_KEY }))
      .toThrow(/host is not audited/u);

    const reader = createBestBuyProductsReader(["api.bestbuy.com"], {
      apiKey: API_KEY,
      safeFetch: async (input) => response({ products: [product] }, input.url)
    });
    await expect(reader.capture({
      operation: "quote",
      merchantProductId: "6568600",
      zipCode: "10001",
      memberships: []
    })).rejects.toThrow(/does not provide this operation/u);
  });

  it("rejects malformed product responses instead of coercing them", async () => {
    const reader = createBestBuyProductsReader(["api.bestbuy.com"], {
      apiKey: API_KEY,
      safeFetch: async (input) => response({ products: [{ ...product, sku: "not-a-sku" }] }, input.url)
    });
    await expect(reader.capture({ operation: "search", query: "Sony", limit: 10 }))
      .rejects.toThrow(/invalid Best Buy product/u);

    const escaped = createBestBuyProductsReader(["api.bestbuy.com"], {
      apiKey: API_KEY,
      safeFetch: async (input) => response({
        products: [{ ...product, url: "https://evil.example/steal" }]
      }, input.url)
    });
    await expect(escaped.capture({ operation: "search", query: "Sony", limit: 10 }))
      .rejects.toThrow(/outside audited hosts/u);
  });

  it("keeps products whose optional identity and price fields are empty", async () => {
    const reader = createBestBuyProductsReader(["api.bestbuy.com"], {
      apiKey: API_KEY,
      safeFetch: async (input) => response({
        products: [{
          ...product,
          manufacturer: null,
          modelNumber: "",
          upc: "",
          image: null,
          salePrice: null,
          regularPrice: null,
          onlineAvailability: null
        }]
      }, input.url)
    });
    await expect(reader.capture({ operation: "search", query: "Sony", limit: 10 }))
      .resolves.toMatchObject({
        records: [{
          merchantProductId: "6568600",
          gtins: [],
          rawOffer: { availability: "UNKNOWN", url: product.url }
        }]
      });
  });
});
