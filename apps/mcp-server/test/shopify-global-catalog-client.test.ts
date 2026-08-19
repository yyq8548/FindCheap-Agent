import { describe, expect, it, vi } from "vitest";

import {
  SHOPIFY_GLOBAL_CATALOG_ENDPOINT,
  createShopifyGlobalCatalogPort
} from "../src/shopify-global-catalog-client.js";

const profileUrl = "https://raw.githubusercontent.com/yyq8548/FindCheap-Agent/main/plugins/shopping-agent/ucp-agent-profile.json";
const now = "2026-08-18T12:00:00.000Z";

describe("Shopify Global Catalog client", () => {
  it("searches all eligible Shopify merchants through one official Catalog request", async () => {
    const fetch = vi.fn(async (_input: string, _init: RequestInit) => catalogResponse([
      product({ shopId: "11236098", merchant: "GRAMOPHONE", host: "skybygramophone.com", price: 24_800 }),
      product({ shopId: "17260467", merchant: "Teds Electronics", host: "www.thetedstore.com", price: 28_199 })
    ]));
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      { fetch, clock: { now: () => new Date(now) }, monotonicNow: () => 10 }
    );

    const result = await port.search({
      query: "Sony WH-1000XM5",
      limit: 3,
      maxItemPriceCents: 30_000,
      comparisonMode: "DISCOVERY",
      selectionMode: "LOWEST_PRICE",
      zipCode: "10001"
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(SHOPIFY_GLOBAL_CATALOG_ENDPOINT, expect.objectContaining({
      method: "POST",
      redirect: "error"
    }));
    const request = JSON.parse(String(fetch.mock.calls[0]![1]!.body));
    expect(request).toMatchObject({
      method: "tools/call",
      params: {
        name: "search_catalog",
        arguments: {
          meta: { "ucp-agent": { profile: profileUrl } },
          catalog: {
            query: "Sony WH-1000XM5",
            filters: {
              ships_to: { country: "US" },
              available: true,
              price: { max: 30_000 }
            },
            context: { address_country: "US" }
          }
        }
      }
    });
    expect(result).toMatchObject({
      source: "SHOPIFY_GLOBAL_CATALOG",
      coverage: "COMPLETE",
      merchantsQueried: 2,
      merchantsSucceeded: 2,
      diagnostics: {
        cacheStatus: "MISS",
        chromeFallbackEligible: false,
        coveragePercent: 100,
        registryVersion: "shopify-global-2026-04-08"
      }
    });
    expect(result.products.map((entry) => [entry.merchant, entry.itemPrice?.amountCents])).toEqual([
      ["GRAMOPHONE", 24_800],
      ["Teds Electronics", 28_199]
    ]);
    expect(result.products[0]).toMatchObject({
      merchantId: "shopify-11236098",
      sourceHost: "skybygramophone.com",
      handle: "42797821853913",
      condition: "UNKNOWN",
      availability: "IN_STOCK",
      merchantUrl: "https://skybygramophone.com/products/sony-wh-1000xm5?variant=42797821853913",
      checkedAt: now
    });
  });

  it("does not cache Global Catalog results", async () => {
    const fetch = vi.fn(async () => catalogResponse([]));
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      { fetch, clock: { now: () => new Date(now) } }
    );

    await port.search({ query: "coffee", limit: 3 });
    await port.search({ query: "coffee", limit: 3 });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses one Shopify Universal Product ID as exact cross-merchant identity", async () => {
    const first = product({ shopId: "10", merchant: "Merchant A", host: "a.example", price: 20_000 });
    const second = product({ shopId: "20", merchant: "Merchant B", host: "b.example", price: 19_000 });
    first.variants.push(...second.variants);
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      { fetch: vi.fn(async () => catalogResponse([first])), clock: { now: () => new Date(now) } }
    );

    const result = await port.search({
      query: "Sony WH-1000XM5",
      limit: 3,
      comparisonMode: "SAME_PRODUCT",
      selectionMode: "LOWEST_PRICE"
    });

    expect(result.comparison).toEqual({
      status: "SAME_PRODUCT",
      identityType: "UPID",
      evidence: ["Shopify Universal Product ID exact"],
      merchantCount: 2,
      offerCount: 2
    });
    expect(result.products.map((entry) => entry.merchant)).toEqual(["Merchant B", "Merchant A"]);
  });

  it("returns complete zero-result coverage so authorized Chrome can be used", async () => {
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      { fetch: vi.fn(async () => catalogResponse([])), clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "product that does not exist", limit: 3 });

    expect(result.products).toEqual([]);
    expect(result.diagnostics.chromeFallbackEligible).toBe(true);
  });

  it("filters unsafe, non-USD, damaged, unavailable, and over-budget variants", async () => {
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      {
        fetch: vi.fn(async () => catalogResponse([
          product({ shopId: "1", merchant: "Unsafe", host: "safe.example", url: "https://evil.example/products/item", price: 100 }),
          product({ shopId: "2", merchant: "CAD", host: "cad.example", price: 100, currency: "CAD" }),
          product({ shopId: "3", merchant: "Damaged", host: "damaged.example", price: 100, condition: ["defective"] }),
          product({ shopId: "4", merchant: "Unavailable", host: "unavailable.example", price: 100, available: false }),
          product({ shopId: "5", merchant: "Expensive", host: "expensive.example", price: 20_000 }),
          product({ shopId: "6", merchant: "Safe", host: "safe-shop.example", price: 9_999 })
        ])),
        clock: { now: () => new Date(now) }
      }
    );

    const result = await port.search({ query: "Sony WH-1000XM5", limit: 3, maxItemPriceCents: 10_000 });

    expect(result.products.map((entry) => entry.merchant)).toEqual(["Safe"]);
    expect(result.diagnostics.priceProductsExcluded).toBe(1);
    expect(result.diagnostics.conditionProductsExcluded).toBe(1);
  });

  it("fails closed on malformed envelopes, oversized bodies, and missing profile configuration", async () => {
    expect(() => createShopifyGlobalCatalogPort({})).toThrow("SHOPIFY_AGENT_PROFILE_URL is required");
    expect(() => createShopifyGlobalCatalogPort({ SHOPIFY_AGENT_PROFILE_URL: "http://agent.example/profile.json" }))
      .toThrow("SHOPIFY_AGENT_PROFILE_URL is invalid");

    const malformed = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      { fetch: vi.fn(async () => new Response("{}", { status: 200 })) }
    );
    await expect(malformed.search({ query: "coffee", limit: 3 })).rejects.toThrow("DATA_SOURCE_UNAVAILABLE");

    const oversized = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      { fetch: vi.fn(async () => new Response("x", { status: 200, headers: { "content-length": "5000000" } })) }
    );
    await expect(oversized.search({ query: "coffee", limit: 3 })).rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
  });
});

function catalogResponse(products: unknown[]): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: {
      structuredContent: {
        ucp: { version: "2026-04-08", status: "success" },
        products,
        messages: [],
        pagination: { has_next_page: false, total_count: products.length }
      }
    }
  });
}

function product(input: {
  shopId: string;
  merchant: string;
  host: string;
  price: number;
  url?: string;
  currency?: string;
  condition?: string[];
  available?: boolean;
}) {
  const variantId = input.shopId === "11236098" ? "42797821853913" : `${input.shopId}42797821853913`;
  return {
    id: `gid://shopify/p/${input.shopId}`,
    title: "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
    media: [{ type: "image", url: "https://cdn.shopify.com/s/files/sony.png" }],
    variants: [{
      id: `gid://shopify/ProductVariant/${variantId}`,
      title: "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
      url: input.url ?? `https://${input.host}/products/sony-wh-1000xm5?variant=${variantId}`,
      price: { amount: input.price, currency: input.currency ?? "USD" },
      availability: { available: input.available ?? true },
      options: input.condition === undefined
        ? [{ name: "Color", label: "Black" }]
        : [{ name: "Condition", label: input.condition[0] ?? "Unknown" }],
      media: [{ type: "image", url: "https://cdn.shopify.com/s/files/sony.png" }],
      seller: {
        id: `gid://shopify/Shop/${input.shopId}`,
        name: input.merchant,
        url: `https://${input.host}`,
        domain: `${input.shopId}.myshopify.com`
      },
      condition: input.condition ?? ["new"]
    }]
  };
}
