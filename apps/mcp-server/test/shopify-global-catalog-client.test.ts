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
      condition: "NEW",
      availability: "IN_STOCK",
      merchantUrl: "https://skybygramophone.com/products/sony-wh-1000xm5?variant=42797821853913",
      checkedAt: now
    });
    expect(result.products.every((entry) => entry.matchStatus === "EXACT")).toBe(true);
    expect(result.products[0]?.matchEvidence).toContain("Shopify Universal Product ID exact");
  });

  it("returns reviewed merchants before unknown sellers without discarding relevant products", async () => {
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
      }),
      expect.objectContaining({
        merchant: "Tiny Cheap Shop",
        merchantTrust: expect.objectContaining({
          level: "UNKNOWN",
          verification: "UNVERIFIED"
        }),
        recommendationTier: "GENERAL_UNVERIFIED"
      })
    ]);
    expect(result.diagnostics).toMatchObject({
      trustedMerchantProductsReturned: 1,
      unverifiedMerchantProductsReturned: 1,
      unverifiedMerchantProductsExcluded: 0,
      riskyMerchantProductsExcluded: 0
    });
  });

  it("requires rating above 3.8 and at least two reviews for the high-rated tier", async () => {
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      {
        fetch: vi.fn(async () => catalogResponse([
          product({ shopId: "95", merchant: "One Review", host: "one-review.example", price: 8_000, title: "DÔEN Quinn Dress", rating: { value: 5, count: 1 } }),
          product({ shopId: "96", merchant: "At Threshold", host: "threshold.example", price: 7_000, title: "DÔEN Quinn Dress", rating: { value: 3.8, count: 100 } }),
          product({ shopId: "97", merchant: "Qualified Rating", host: "qualified.example", price: 9_000, title: "DÔEN Quinn Dress", rating: { value: 3.9, count: 2 } })
        ])),
        clock: { now: () => new Date(now) }
      }
    );

    const result = await port.search({ query: "DÔEN Quinn Dress", limit: 3 });

    expect(result.products.map((entry) => [entry.merchant, entry.recommendationTier])).toEqual([
      ["Qualified Rating", "HIGH_RATED_UNVERIFIED"],
      ["One Review", "GENERAL_UNVERIFIED"],
      ["At Threshold", "GENERAL_UNVERIFIED"]
    ]);
    expect(result.products[0]?.productRating).toEqual({ value: 3.9, count: 2, scaleMax: 5 });
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

  it("accepts Shopify plain-text description objects and finds ballet flats", async () => {
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      {
        fetch: vi.fn(async () => catalogResponse([product({
          shopId: "77",
          merchant: "Flat Store",
          host: "flats.example",
          price: 8_900,
          title: "Mangrove Leather Ballet Flats",
          productType: "Ballet flats",
          description: { plain: "Soft leather ballet flats designed for all-day everyday wear." },
          variantDescription: { plain: "Black flat sole with an adjustable cross strap." }
        })])),
        clock: { now: () => new Date(now) }
      }
    );

    const result = await port.search({ query: "everyday ballet flats", limit: 3 });

    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.description).toContain("all-day everyday wear");
    expect(result.products[0]?.description).toContain("adjustable cross strap");
    expect(result.diagnostics.catalogProductsReturned).toBe(1);
    expect(result.diagnostics.catalogVariantsReturned).toBe(1);
  });

  it("normalizes bounded Catalog field variants without weakening the internal product model", async () => {
    const raw = product({
      shopId: "88",
      merchant: "Flexible Store",
      host: "flexible.example",
      price: 1,
      title: "Everyday Leather Ballet Flats"
    }) as Record<string, unknown>;
    raw.description = { html: "<p>Soft <strong>leather</strong> everyday flat.</p>" };
    raw.product_type = { name: "Ballet flats", taxonomyId: "shoes-1" };
    raw.media = ["https://cdn.shopify.com/s/files/flexible.png"];
    raw.options = [{ name: "Size", values: ["8", { value: "9" }] }];
    raw.rating = { value: "4.4", scale_min: "1", scale_max: "5", count: "12" };
    const variant = (raw.variants as Array<Record<string, unknown>>)[0]!;
    variant.description = { markdown: "Black flat sole" };
    variant.price = { amount: "89.00", currencyCode: "USD" };
    variant.availability = "IN_STOCK";
    variant.options = [{ name: "Size", value: "8" }];
    variant.condition = { value: "new" };
    variant.media = [{ image: { url: "https://cdn.shopify.com/s/files/flexible.png" } }];
    (variant.seller as Record<string, unknown>).domain = null;
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      {
        fetch: vi.fn(async () => catalogResponse([raw], "2026-08-25")),
        clock: { now: () => new Date(now) }
      }
    );

    const result = await port.search({ query: "everyday ballet flats", limit: 3 });

    expect(result.diagnostics.registryVersion).toBe("shopify-global-2026-08-25");
    expect(result.products[0]).toMatchObject({
      productType: "Ballet flats",
      description: expect.stringContaining("Soft leather everyday flat"),
      itemPrice: { amountCents: 8_900, currency: "USD" },
      availability: "IN_STOCK",
      condition: "NEW",
      variantDimensions: { Size: "8" },
      productRating: { value: 4.4, count: 12, scaleMax: 5 }
    });
  });

  it("rejects ambiguous Catalog money strings instead of guessing cents or dollars", async () => {
    const raw = product({
      shopId: "99",
      merchant: "Ambiguous Store",
      host: "ambiguous.example",
      price: 1
    }) as Record<string, unknown>;
    const variant = (raw.variants as Array<Record<string, unknown>>)[0]!;
    variant.price = { amount: "8999", currency: "USD" };
    const port = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      { fetch: vi.fn(async () => catalogResponse([raw])) }
    );

    await expect(port.search({ query: "headphones", limit: 3 })).rejects.toThrow("CATALOG_SCHEMA_CHANGED");
  });

  it("fails closed on malformed envelopes, oversized bodies, and missing profile configuration", async () => {
    expect(() => createShopifyGlobalCatalogPort({})).toThrow("SHOPIFY_AGENT_PROFILE_URL is required");
    expect(() => createShopifyGlobalCatalogPort({ SHOPIFY_AGENT_PROFILE_URL: "http://agent.example/profile.json" }))
      .toThrow("SHOPIFY_AGENT_PROFILE_URL is invalid");

    const malformed = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      { fetch: vi.fn(async () => new Response("{}", { status: 200 })) }
    );
    await expect(malformed.search({ query: "coffee", limit: 3 })).rejects.toThrow("CATALOG_SCHEMA_CHANGED");

    const oversized = createShopifyGlobalCatalogPort(
      { SHOPIFY_AGENT_PROFILE_URL: profileUrl },
      { fetch: vi.fn(async () => new Response("x", { status: 200, headers: { "content-length": "5000000" } })) }
    );
    await expect(oversized.search({ query: "coffee", limit: 3 })).rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
  });
});

function catalogResponse(products: unknown[], version = "2026-04-08"): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: {
      structuredContent: {
        ucp: { version, status: "success" },
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
  productType?: string;
  rating?: { value: number; count: number };
  description?: string | { plain: string };
  variantDescription?: string | { plain: string };
}) {
  const variantId = input.shopId === "11236098" ? "42797821853913" : `${input.shopId}42797821853913`;
  return {
    id: `gid://shopify/p/${input.shopId}`,
    title: input.title ?? "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
    ...(input.productType === undefined ? {} : { product_type: input.productType }),
    ...(input.description === undefined ? {} : { description: input.description }),
    media: [{ type: "image", url: "https://cdn.shopify.com/s/files/sony.png" }],
    variants: [{
      id: `gid://shopify/ProductVariant/${variantId}`,
      title: input.title ?? "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
      ...(input.variantDescription === undefined ? {} : { description: input.variantDescription }),
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
      condition: input.condition ?? ["new"],
      rating: input.rating === undefined
        ? undefined
        : { value: input.rating.value, scale_min: 1, scale_max: 5, count: input.rating.count }
    }]
  };
}
