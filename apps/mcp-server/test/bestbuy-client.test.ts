import { describe, expect, it, vi } from "vitest";

import { createBestBuyPortFromEnvironment } from "../src/bestbuy-client.js";

const API_KEY = "testKey_123456789";

describe("Best Buy MCP client", () => {
  it("uses the official reader and returns public item-price data", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => ({
      response: new Response(JSON.stringify({
        products: [{
          sku: 6568600,
          name: "Sony WH-1000XM5 Headphones",
          manufacturer: "Sony",
          modelNumber: "WH1000XM5/B",
          upc: "027242923232",
          image: "https://pisces.bbystatic.com/image.jpg",
          salePrice: 349.99,
          regularPrice: 399.99,
          onlineAvailability: true,
          url: "https://api.bestbuy.com/click/example/6568600/pdp"
        }]
      }), { headers: { "content-type": "application/json" } }),
      finalUrl: input.url
    }));
    const port = createBestBuyPortFromEnvironment(
      { BEST_BUY_API_KEY: API_KEY },
      {
        safeFetch,
        clock: { now: () => new Date("2026-08-14T12:00:00.000Z") }
      }
    );

    const result = await port.search({ query: "Sony WH-1000XM5", limit: 5 });

    expect(result).toEqual({
      products: [{
        sku: "6568600",
        title: "Sony WH-1000XM5 Headphones",
        brand: "Sony",
        modelNumber: "WH1000XM5/B",
        gtins: ["027242923232"],
        imageUrl: "https://pisces.bbystatic.com/image.jpg",
        itemPrice: { amountCents: 34_999, currency: "USD" },
        availability: "IN_STOCK",
        merchantUrl: "https://api.bestbuy.com/click/example/6568600/pdp",
        checkedAt: "2026-08-14T12:00:00.000Z"
      }]
    });
    const requested = new URL(safeFetch.mock.calls[0]![0].url);
    expect(requested.hostname).toBe("api.bestbuy.com");
    expect(requested.searchParams.get("apiKey")).toBe(API_KEY);
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });

  it("fails closed when the API key is absent", async () => {
    const port = createBestBuyPortFromEnvironment({});

    await expect(port.search({ query: "Sony headphones", limit: 5 }))
      .rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
  });

  it("keeps the plugin available when the configured API key is malformed", async () => {
    const port = createBestBuyPortFromEnvironment({ BEST_BUY_API_KEY: "short" });

    await expect(port.search({ query: "Sony headphones", limit: 5 }))
      .rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
  });
});
