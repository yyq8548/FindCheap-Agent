import { describe, expect, it, vi } from "vitest";

import {
  SHOPIFY_GLOBAL_CATALOG_ENDPOINT,
  createShopifyGlobalCatalogPort,
  planCatalogQueries
} from "../src/shopify-global-catalog-client.js";

const profileUrl = "https://cdn.jsdelivr.net/gh/yyq8548/FindCheap-Agent@24267014f0433adefb89181e4123d7b785e30285/plugins/findcheap-agent/ucp-agent-profile.json";
const now = "2026-08-18T12:00:00.000Z";

describe("Shopify Global Catalog client", () => {
  it("translates supported Chinese product terms while preserving identity and variants", () => {
    expect(planCatalogQueries("我要买 Sony WH-1000XM6 黑色 头戴式耳机")).toEqual([
      { kind: "PRIMARY", query: "Sony WH-1000XM6 black over ear headphones" },
      { kind: "RELAXED", query: "Sony WH-1000XM6 black headphones" }
    ]);
    expect(planCatalogQueries("DÔEN 连衣裙 Size S 白色")[0]?.query)
      .toBe("DÔEN dress Size S white");
    expect(planCatalogQueries("Nike 男士跑鞋 黑色 10")[0]?.query)
      .toBe("Nike men running shoes black 10");
    expect(planCatalogQueries("空气炸锅")[0]?.query).toBe("air fryer");
    expect(planCatalogQueries("猫砂")[0]?.query).toBe("cat litter");
  });

  it("runs one bounded relaxed query only after the primary result is empty", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(catalogResponse([]))
      .mockResolvedValueOnce(catalogResponse([
        product({
          shopId: "30",
          merchant: "Cat Shop",
          host: "cats.example",
          price: 799,
          title: "Interactive Cat Toy"
        })
      ]));
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      { fetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "逗猫棒", limit: 3 });

    expect(fetch).toHaveBeenCalledTimes(2);
    const requests = fetch.mock.calls.map((call) => JSON.parse(String(call[1]!.body)));
    expect(requests.map((request) => request.params.arguments.catalog.query)).toEqual([
      "cat wand toy",
      "cat toy"
    ]);
    expect(result.products).toEqual([
      expect.objectContaining({
        title: "Interactive Cat Toy",
        matchStatus: "DISCOVERY_MATCH",
        matchEvidence: expect.arrayContaining(["bounded relaxed Catalog query"])
      })
    ]);
    expect(result.products.every((product) => product.matchStatus !== "EXACT")).toBe(true);
    expect(result.diagnostics).toMatchObject({
      queryAttempts: 2,
      fallbackQueryUsed: true,
      catalogZeroResultAttempts: 1,
      catalogProductsReturned: 1,
      catalogVariantsReturned: 1
    });
  });

  it("does not retry when the first Catalog query returns a usable product", async () => {
    const fetch = vi.fn(async () => catalogResponse([
      product({ shopId: "30", merchant: "Cat Shop", host: "cats.example", price: 799, title: "Cat Wand Toy" })
    ]));
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      { fetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "逗猫棒", limit: 3 });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.diagnostics).toMatchObject({ queryAttempts: 1, fallbackQueryUsed: false });
  });

  it("never labels a relaxed-query result exact even when a model identifier is present", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(catalogResponse([]))
      .mockResolvedValueOnce(catalogResponse([
        product({ shopId: "31", merchant: "Audio Shop", host: "audio.example", price: 24_999 })
      ]));
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      { fetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "Sony WH-1000XM5 latest", limit: 3 });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.products[0]).toMatchObject({
      matchStatus: "DISCOVERY_MATCH",
      matchEvidence: expect.arrayContaining(["exact identity not independently verified"])
    });
  });

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
    expect(result.products.every((entry) => entry.matchStatus === "EXACT")).toBe(true);
    expect(result.products[0]?.matchEvidence).toContain("Shopify Universal Product ID exact");
  });

  it("returns reviewed official merchants before price and does not pad with unknown sellers", async () => {
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      {
        fetch: vi.fn(async () => catalogResponse([
          product({ shopId: "90", merchant: "Tiny Cheap Shop", host: "tiny-cheap.example", price: 9_900, title: "DÔEN Quinn Dress" }),
          product({ shopId: "91", merchant: "DÔEN", host: "www.shopdoen.com", price: 27_800, title: "DÔEN Quinn Dress" })
        ])),
        clock: { now: () => new Date(now) }
      }
    );

    const result = await port.search({
      query: "DÔEN Quinn Dress",
      limit: 3,
      selectionMode: "LOWEST_PRICE"
    });

    expect(result.products).toEqual([
      expect.objectContaining({
        merchant: "DÔEN",
        merchantTrust: expect.objectContaining({
          level: "OFFICIAL",
          verification: "INDEPENDENT"
        })
      })
    ]);
    expect(result.diagnostics).toMatchObject({
      trustedMerchantProductsReturned: 1,
      unverifiedMerchantProductsReturned: 0,
      unverifiedMerchantProductsExcluded: 1,
      riskyMerchantProductsExcluded: 0
    });
  });

  it("keeps unknown merchants as explicitly unverified discovery only when no trusted seller exists", async () => {
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      {
        fetch: vi.fn(async () => catalogResponse([
          product({ shopId: "92", merchant: "Unknown Shop", host: "unknown-shop.example", price: 11_000, title: "DÔEN Quinn Dress" })
        ])),
        clock: { now: () => new Date(now) }
      }
    );

    const result = await port.search({ query: "DÔEN Quinn Dress", limit: 3 });

    expect(result.products[0]).toMatchObject({
      merchant: "Unknown Shop",
      merchantTrust: {
        level: "UNKNOWN",
        verification: "UNVERIFIED",
        evidence: ["no independent merchant trust evidence"]
      }
    });
    expect(result.diagnostics).toMatchObject({
      trustedMerchantProductsReturned: 0,
      unverifiedMerchantProductsReturned: 1,
      unverifiedMerchantProductsExcluded: 0
    });
  });

  it("fails closed on risky numeric and punycode merchant hosts", async () => {
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      {
        fetch: vi.fn(async () => catalogResponse([
          product({ shopId: "93", merchant: "Numeric Host", host: "203.0.113.10", price: 1_000, title: "DÔEN Quinn Dress" }),
          product({ shopId: "94", merchant: "Lookalike", host: "xn--d1acpjx3f.example", price: 1_100, title: "DÔEN Quinn Dress" })
        ])),
        clock: { now: () => new Date(now) }
      }
    );

    const result = await port.search({ query: "DÔEN Quinn Dress", limit: 3 });

    expect(result.products).toEqual([]);
    expect(result.diagnostics).toMatchObject({
      riskyMerchantProductsExcluded: 2,
      trustedMerchantProductsReturned: 0,
      unverifiedMerchantProductsReturned: 0
    });
  });

  it("keeps category keyword results as discovery matches", async () => {
    const fetch = vi.fn(async () => catalogResponse([
      product({ shopId: "11236098", merchant: "GRAMOPHONE", host: "skybygramophone.com", price: 24_800 })
    ]));
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      { fetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "headphones", limit: 3, comparisonMode: "DISCOVERY" });

    expect(result.products[0]?.matchStatus).toBe("DISCOVERY_MATCH");
    expect(result.products[0]?.matchEvidence).not.toContain("Shopify Universal Product ID exact");
  });

  it("does not cache Global Catalog results", async () => {
    const fetch = vi.fn(async (_input: string, _init: RequestInit) => catalogResponse([]));
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      { fetch, clock: { now: () => new Date(now) } }
    );

    await port.search({ query: "coffee", limit: 3 });
    await port.search({ query: "coffee", limit: 3 });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("normalizes known plural category terms before the single Catalog request", async () => {
    const fetch = vi.fn(async (_input: string, _init: RequestInit) => catalogResponse([]));
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      { fetch, clock: { now: () => new Date(now) } }
    );

    await port.search({ query: "DÔEN dresses", limit: 3 });

    expect(fetch).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetch.mock.calls[0]![1]!.body));
    expect(request.params.arguments.catalog.query).toBe("DÔEN dress");
  });

  it("omits the available-only Catalog filter and retains out-of-stock variants for Watch checks", async () => {
    const fetch = vi.fn(async (_input: string, _init: RequestInit) => catalogResponse([
      product({ shopId: "4", merchant: "Unavailable", host: "unavailable.example", price: 100, available: false })
    ]));
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      { fetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({
      query: "Sony WH-1000XM5",
      limit: 3,
      includeOutOfStock: true
    });

    const request = JSON.parse(String(fetch.mock.calls[0]![1]!.body));
    expect(request.params.arguments.catalog.filters).not.toHaveProperty("available");
    expect(result.products).toEqual([
      expect.objectContaining({ merchant: "Unavailable", availability: "OUT_OF_STOCK" })
    ]);
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
    expect(result.diagnostics).toMatchObject({
      chromeFallbackEligible: true,
      catalogZeroResultAttempts: 1,
      queryAttempts: 1,
      fallbackQueryUsed: false
    });
  });

  it("reports separate Catalog, stock, identity, condition, and price filtering counts", async () => {
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      {
        fetch: vi.fn(async () => catalogResponse([
          product({ shopId: "1", merchant: "Wrong", host: "wrong.example", price: 100, title: "Coffee Beans" }),
          product({ shopId: "2", merchant: "Unavailable", host: "unavailable.example", price: 100, available: false }),
          product({ shopId: "3", merchant: "Damaged", host: "damaged.example", price: 100, condition: ["defective"] }),
          product({ shopId: "4", merchant: "Expensive", host: "expensive.example", price: 20_000 }),
          product({ shopId: "5", merchant: "Safe", host: "safe.example", price: 9_999 })
        ])),
        clock: { now: () => new Date(now) }
      }
    );

    const result = await port.search({ query: "Sony WH-1000XM5", limit: 3, maxItemPriceCents: 10_000 });

    expect(result.products.map((product) => product.merchant)).toEqual(["Safe"]);
    expect(result.diagnostics).toMatchObject({
      catalogProductsReturned: 5,
      catalogVariantsReturned: 5,
      catalogZeroResultAttempts: 0,
      outOfStockProductsExcluded: 1,
      identityProductsExcluded: 1,
      conditionProductsExcluded: 1,
      priceProductsExcluded: 1
    });
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
  title?: string;
}) {
  const variantId = input.shopId === "11236098" ? "42797821853913" : `${input.shopId}42797821853913`;
  return {
    id: `gid://shopify/p/${input.shopId}`,
    title: input.title ?? "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
    media: [{ type: "image", url: "https://cdn.shopify.com/s/files/sony.png" }],
    variants: [{
      id: `gid://shopify/ProductVariant/${variantId}`,
      title: input.title ?? "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
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
