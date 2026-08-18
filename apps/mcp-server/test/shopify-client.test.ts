import { describe, expect, it, vi } from "vitest";

import { SHOPIFY_PILOTS, createShopifyPortFromEnvironment } from "../src/shopify-client.js";

const now = "2026-08-18T01:00:00.000Z";

describe("Shopify Storefront MCP client", () => {
  it("searches the fixed five-store registry and globally ranks item prices", async () => {
    const prices = new Map<string, string | string[]>([
      ["deathwishcoffee.com", "19.99"], ["kith.com", "29.99"],
      ["www.allbirds.com", "14.99"], ["www.brooklinen.com", "24.99"],
      ["www.fashionnova.com", ["9.99", "10.99", "11.99"]]
    ]);
    const safeFetch = vi.fn(async (input: { url: string }) => {
      const host = new URL(input.url).hostname;
      return storefrontResponse(input.url, host, prices.get(host));
    });
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "fixed-five" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "shirt", limit: 3 });

    expect(SHOPIFY_PILOTS).toHaveLength(5);
    expect(safeFetch).toHaveBeenCalledTimes(5);
    expect(new Set(safeFetch.mock.calls.map(([input]) => new URL(input.url).hostname))).toEqual(
      new Set(SHOPIFY_PILOTS.map((pilot) => pilot.apiHost))
    );
    expect(result).toMatchObject({
      coverage: "COMPLETE",
      merchantsQueried: 5,
      merchantsSucceeded: 5,
      diagnostics: {
        cacheStatus: "MISS",
        chromeFallbackEligible: false,
        selectionPolicy: "DIVERSE_MERCHANTS_THEN_PRICE"
      }
    });
    expect(result.products.map((product) => [product.merchant, product.itemPrice?.amountCents])).toEqual([
      ["Fashion Nova", 999], ["Allbirds", 1_499], ["Death Wish Coffee", 1_999]
    ]);
    expect(result.products[0]).toMatchObject({
      merchantId: "fashion-nova",
      sourceHost: "www.fashionnova.com",
      merchantUrl: "https://www.fashionnova.com/products/sample-1"
    });
  });

  it("fills remaining slots from one merchant only when merchant diversity is exhausted", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => {
      const host = new URL(input.url).hostname;
      return storefrontResponse(input.url, host, host === "www.fashionnova.com"
        ? ["9.99", "10.99", "11.99"]
        : undefined);
    });
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "fixed-five" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "shirt", limit: 3 });

    expect(result.products.map((product) => product.merchant)).toEqual([
      "Fashion Nova", "Fashion Nova", "Fashion Nova"
    ]);
  });

  it("coalesces concurrent duplicates and caches an identical repeated lookup", async () => {
    let elapsedMs = 0;
    const safeFetch = vi.fn(async (input: { url: string }) => {
      elapsedMs += 10;
      return storefrontResponse(input.url, new URL(input.url).hostname, "20.00");
    });
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "fixed-five" },
      {
        safeFetch,
        clock: { now: () => new Date(now) },
        monotonicNow: () => elapsedMs
      }
    );

    const [first, second] = await Promise.all([
      port.search({ query: "shirt", limit: 3 }),
      port.search({ query: "shirt", limit: 3 })
    ]);
    const third = await port.search({ query: "shirt", limit: 3 });

    expect(safeFetch).toHaveBeenCalledTimes(5);
    expect(first.diagnostics).toMatchObject({ cacheStatus: "MISS", apiDurationMs: 50 });
    expect(second.diagnostics).toMatchObject({ cacheStatus: "COALESCED", apiDurationMs: 0 });
    expect(third.diagnostics).toMatchObject({ cacheStatus: "HIT", apiDurationMs: 0 });
    expect(second.products).toEqual(first.products);
    expect(third.products).toEqual(first.products);
  });

  it("isolates a failed store when another store returns products", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => {
      const host = new URL(input.url).hostname;
      if (host === "kith.com") throw new Error("upstream failed");
      return storefrontResponse(input.url, host, host === "www.allbirds.com" ? "20.00" : undefined);
    });
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "fixed-five" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "shoes", limit: 3 });

    expect(result.coverage).toBe("PARTIAL");
    expect(result.merchantsSucceeded).toBe(4);
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.merchant).toBe("Allbirds");
  });

  it("returns complete empty only when all five stores succeed", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => storefrontResponse(input.url, new URL(input.url).hostname));
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "fixed-five" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );
    await expect(port.search({ query: "no-match", limit: 3 })).resolves.toMatchObject({
      coverage: "COMPLETE",
      merchantsQueried: 5,
      merchantsSucceeded: 5,
      diagnostics: { chromeFallbackEligible: true },
      products: []
    });
  });

  it("fails closed when failures make an empty result incomplete", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => {
      if (new URL(input.url).hostname === "kith.com") throw new Error("upstream failed");
      return storefrontResponse(input.url, new URL(input.url).hostname);
    });
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "fixed-five" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );
    await expect(port.search({ query: "no-match", limit: 3 })).rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
  });

  it("fails closed unless the exact fixed registry mode is configured", async () => {
    await expect(createShopifyPortFromEnvironment({}).search({ query: "coffee", limit: 5 }))
      .rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
    await expect(createShopifyPortFromEnvironment({ SHOPIFY_STOREFRONT_MODE: "evil.example" })
      .search({ query: "coffee", limit: 5 })).rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
  });
});

function storefrontResponse(url: string, host: string, price?: string | string[]) {
  const prices = price === undefined ? [] : Array.isArray(price) ? price : [price];
  const nodes = prices.map((amount, index) => ({
    title: `Sample Product ${index + 1}`, handle: `sample-${index + 1}`, vendor: host,
    onlineStoreUrl: `https://${host}/products/sample-${index + 1}`, featuredImage: null,
    selectedOrFirstAvailableVariant: {
      title: "Default Title", sku: `${host}-sku`, barcode: null,
      availableForSale: true, price: { amount, currencyCode: "USD" }, image: null
    }
  }));
  return {
    response: new Response(JSON.stringify({ data: { products: { nodes } } }), {
      headers: { "content-type": "application/json" }
    }),
    finalUrl: url
  };
}
