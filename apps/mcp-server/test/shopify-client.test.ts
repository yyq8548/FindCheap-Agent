import { describe, expect, it, vi } from "vitest";

import { SHOPIFY_PILOTS, createShopifyPortFromEnvironment } from "../src/shopify-client.js";

const now = "2026-08-18T01:00:00.000Z";

describe("Shopify Storefront MCP client", () => {
  it("searches the fixed forty-five-store registry and ranks relevant item prices", async () => {
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
      { SHOPIFY_STOREFRONT_MODE: "audited-registry" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "shirt", limit: 3 });

    expect(SHOPIFY_PILOTS).toHaveLength(45);
    expect(safeFetch).toHaveBeenCalledTimes(45);
    expect(new Set(safeFetch.mock.calls.map(([input]) => new URL(input.url).hostname))).toEqual(
      new Set(SHOPIFY_PILOTS.map((pilot) => pilot.apiHost))
    );
    expect(result).toMatchObject({
      coverage: "COMPLETE",
      merchantsQueried: 45,
      merchantsSucceeded: 45,
      diagnostics: {
        cacheStatus: "MISS",
        chromeFallbackEligible: false,
        irrelevantProductsExcluded: 0,
        merchantsFailed: 0,
        coveragePercent: 100,
        failedMerchantIds: [],
        timedOutMerchantIds: [],
        registryVersion: "v3",
        searchTimeoutMs: 3_000,
        selectionPolicy: "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE"
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
      { SHOPIFY_STOREFRONT_MODE: "audited-registry" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "shirt", limit: 3 });

    expect(result.products.map((product) => product.merchant)).toEqual([
      "Fashion Nova", "Fashion Nova", "Fashion Nova"
    ]);
  });

  it("returns the literal three lowest prices when LOWEST_PRICE is requested", async () => {
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
      { SHOPIFY_STOREFRONT_MODE: "audited-registry" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "shirt", limit: 3, selectionMode: "LOWEST_PRICE" });

    expect(result.products.map((product) => [product.merchant, product.itemPrice?.amountCents])).toEqual([
      ["Fashion Nova", 999], ["Fashion Nova", 1_099], ["Fashion Nova", 1_199]
    ]);
    expect(result.diagnostics.selectionPolicy).toBe("EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_PRICE");
  });

  it("applies an inclusive item-price ceiling before ranking", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => {
      const host = new URL(input.url).hostname;
      if (host === "www.fashionnova.com") {
        return storefrontResponse(input.url, host, ["80.00", "80.01"], ["Anime Shirt", "Anime Tee"]);
      }
      if (host === "deathwishcoffee.com") {
        return storefrontResponse(input.url, host, "79.99", "Anime Shirt Sweatshirt");
      }
      return storefrontResponse(input.url, host);
    });
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "audited-registry" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({
      query: "anime shirt sweatshirt",
      limit: 3,
      selectionMode: "MERCHANT_DIVERSE",
      maxItemPriceCents: 8_000
    });

    expect(result.maxItemPriceCents).toBe(8_000);
    expect(result.products.map((product) => product.itemPrice?.amountCents)).toEqual([7_999, 8_000]);
    expect(result.diagnostics.priceProductsExcluded).toBe(1);
  });

  it("returns only independently verified same-product offers when two merchants share identity", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => {
      const host = new URL(input.url).hostname;
      if (["deathwishcoffee.com", "www.fashionnova.com"].includes(host)) {
        return storefrontResponse(input.url, host, host === "deathwishcoffee.com" ? "24.00" : "25.00", "Anime Shirt", "T-Shirts", [], {
          barcode: "810063341254"
        });
      }
      return host === "kith.com"
        ? storefrontResponse(input.url, host, "9.00", "Anime Shirt", "T-Shirts", [], {
            barcode: "810063341255"
          })
        : storefrontResponse(input.url, host);
    });
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "audited-registry" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "anime shirt", limit: 3, selectionMode: "LOWEST_PRICE" });

    expect(result.comparison).toEqual({
      status: "SAME_PRODUCT",
      identityType: "GTIN",
      evidence: ["GTIN and variant exact"],
      merchantCount: 2,
      offerCount: 2
    });
    expect(result.products.map((product) => product.itemPrice?.amountCents)).toEqual([2_400, 2_500]);
    expect(new Set(result.products.map((product) => product.gtins[0]))).toEqual(new Set(["810063341254"]));
  });

  it("does not group matching GTINs when variants conflict", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => {
      const host = new URL(input.url).hostname;
      if (!["deathwishcoffee.com", "www.fashionnova.com"].includes(host)) {
        return storefrontResponse(input.url, host);
      }
      const selectedOptions = host === "deathwishcoffee.com"
        ? [{ name: "Color", value: "Black" }]
        : [{ name: "Color", value: "White" }];
      return storefrontResponse(input.url, host, "25.00", "Anime Shirt", "T-Shirts", selectedOptions, {
        barcode: "810063341254"
      });
    });
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "audited-registry" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "anime shirt", limit: 3, selectionMode: "MERCHANT_DIVERSE" });

    expect(result.comparison.status).toBe("DISCOVERY_ONLY");
  });

  it("rejects unrelated low-price products before merchant diversity and price ranking", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => {
      const host = new URL(input.url).hostname;
      if (host === "www.fashionnova.com") {
        return storefrontResponse(input.url, host, ["9.99", "10.99"], ["Floral Bloom Tee", "Oversized Shirt"]);
      }
      if (host === "deathwishcoffee.com") {
        return storefrontResponse(input.url, host, "15.00", "Signature Shadow Tee");
      }
      if (host === "www.brooklinen.com") {
        return storefrontResponse(input.url, host, "5.00", "Classic Percale Pillowcase Set");
      }
      return storefrontResponse(input.url, host);
    });
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "audited-registry" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "shirt", limit: 3 });

    expect(result.products.map((product) => [product.merchant, product.title])).toEqual([
      ["Fashion Nova", "Floral Bloom Tee"],
      ["Death Wish Coffee", "Signature Shadow Tee"],
      ["Fashion Nova", "Oversized Shirt"]
    ]);
  });

  it("uses Shopify product type as relevance evidence when the title omits the category", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => {
      const host = new URL(input.url).hostname;
      return host === "www.stevemadden.com"
        ? storefrontResponse(input.url, host, "79.99", "SELMA RED PATENT", "Shoes")
        : storefrontResponse(input.url, host);
    });
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "audited-registry" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "shoes", limit: 3 });

    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ merchant: "Steve Madden", title: "SELMA RED PATENT" });
    expect(result.products[0]).not.toHaveProperty("productType");
    expect(result.products[0]).not.toHaveProperty("tags");
  });

  it("does not confuse a color or print name with the requested product type", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => {
      const host = new URL(input.url).hostname;
      if (host === "colourpop.com") {
        return storefrontResponse(input.url, host, "10.00", "Honey Bunny", "Glossy Lipstick");
      }
      if (host === "www.fashionnova.com") {
        return storefrontResponse(input.url, host, "5.00", "Lipstick Print Jeans", "Jeans");
      }
      return storefrontResponse(input.url, host);
    });
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "audited-registry" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "lipstick", limit: 3 });

    expect(result.products.map((product) => product.merchant)).toEqual(["ColourPop"]);
  });

  it("ranks exact identity before cheaper similar products and excludes irrelevant products", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => {
      const host = new URL(input.url).hostname;
      if (host === "kith.com") {
        return storefrontResponse(input.url, host, "299.00", "Sony WH-1000XM5 Headphones", "Headphones", [], {
          vendor: "Sony", sku: "WH1000XM5"
        });
      }
      if (host === "www.fashionnova.com") {
        return storefrontResponse(input.url, host, "99.00", "Sony WH-1000XM4 Headphones", "Headphones", [], {
          vendor: "Sony", sku: "WH1000XM4"
        });
      }
      if (host === "www.brooklinen.com") {
        return storefrontResponse(input.url, host, "1.00", "Classic Pillowcase", "Bedding");
      }
      return storefrontResponse(input.url, host);
    });
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "audited-registry" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "Sony WH-1000XM5", limit: 3 });

    expect(result.products.map((product) => [product.title, product.matchStatus])).toEqual([
      ["Sony WH-1000XM5 Headphones", "EXACT"],
      ["Sony WH-1000XM4 Headphones", "SIMILAR"]
    ]);
    expect(result.questions).toEqual([]);
    expect(result.diagnostics.irrelevantProductsExcluded).toBe(1);
  });

  it("excludes explicit used inventory by default but keeps unlabeled inventory", async () => {
    const registry = {
      version: "v-condition",
      merchants: SHOPIFY_PILOTS.filter((merchant) => ["outerknown", "steve-madden"].includes(merchant.merchantId))
    };
    const safeFetch = vi.fn(async (input: { url: string }) => {
      const host = new URL(input.url).hostname;
      return host === "www.outerknown.com"
        ? storefrontResponse(input.url, host, "114.00", "Ambassador Blue Jeans", "Jeans", [], {
            handle: "ambassador-blue-jeans-resale",
            sku: "AMB-BLUE_used",
            tags: ["Resale"]
          })
        : storefrontResponse(input.url, host, "119.00", "Imperial Blue Jeans", "Jeans");
    });
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "audited-registry" },
      { safeFetch, clock: { now: () => new Date(now) }, registry }
    );

    const result = await port.search({ query: "blue jeans", limit: 3 });

    expect(result.products).toEqual([expect.objectContaining({
      title: "Imperial Blue Jeans",
      condition: "UNKNOWN"
    })]);
    expect(result.diagnostics.conditionProductsExcluded).toBe(1);
  });

  it("returns explicit used inventory only when used condition is requested", async () => {
    const registry = {
      version: "v-condition",
      merchants: SHOPIFY_PILOTS.filter((merchant) => ["outerknown", "steve-madden"].includes(merchant.merchantId))
    };
    const safeFetch = vi.fn(async (input: { url: string }) => {
      const host = new URL(input.url).hostname;
      return host === "www.outerknown.com"
        ? storefrontResponse(input.url, host, "114.00", "Ambassador Blue Jeans", "Jeans", [], {
            handle: "ambassador-blue-jeans-resale",
            sku: "AMB-BLUE_used",
            tags: ["Resale"]
          })
        : storefrontResponse(input.url, host, "119.00", "Imperial Blue Jeans", "Jeans");
    });
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "audited-registry" },
      { safeFetch, clock: { now: () => new Date(now) }, registry }
    );

    const result = await port.search({ query: "used blue jeans", limit: 3 });

    expect(result.products).toEqual([expect.objectContaining({
      title: "Ambassador Blue Jeans",
      condition: "USED"
    })]);
    expect(result.diagnostics.conditionProductsExcluded).toBe(1);
  });

  it.each([
    ["refurbished blue jeans", "Certified Refurbished Blue Jeans", [], "REFURBISHED"],
    ["open box blue jeans", "Open Box Blue Jeans", [], "OPEN_BOX"],
    ["new blue jeans", "Blue Jeans", ["condition:new"], "NEW"]
  ] as const)("recognizes an explicitly requested condition: %s", async (query, title, tags, condition) => {
    const registry = {
      version: "v-condition",
      merchants: SHOPIFY_PILOTS.filter((merchant) => merchant.merchantId === "steve-madden")
    };
    const safeFetch = vi.fn(async (input: { url: string }) => storefrontResponse(
      input.url,
      new URL(input.url).hostname,
      "119.00",
      title,
      "Jeans",
      [],
      { tags: [...tags] }
    ));
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "audited-registry" },
      { safeFetch, clock: { now: () => new Date(now) }, registry }
    );

    const result = await port.search({ query, limit: 3 });

    expect(result.products).toEqual([expect.objectContaining({ condition })]);
  });

  it("marks a missing requested variant similar and asks for exact variant details", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => {
      const host = new URL(input.url).hostname;
      return host === "www.allbirds.com"
        ? storefrontResponse(input.url, host, "89.00", "Tree Runner", "Shoes", [{ name: "Color", value: "Red" }])
        : storefrontResponse(input.url, host);
    });
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "audited-registry" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "Tree Runner blue", limit: 3 });

    expect(result.products).toEqual([expect.objectContaining({
      merchant: "Allbirds",
      matchStatus: "SIMILAR",
      variantDimensions: { Color: "Red" },
      matchEvidence: expect.arrayContaining(["missing query terms: blue"])
    })]);
    expect(result.questions).toEqual([
      "Only similar products were found. Provide an exact model, SKU, GTIN, color, size, or capacity."
    ]);
  });

  it("coalesces concurrent duplicates and caches an identical repeated lookup", async () => {
    let elapsedMs = 0;
    const safeFetch = vi.fn(async (input: { url: string }) => {
      elapsedMs += 10;
      return storefrontResponse(input.url, new URL(input.url).hostname, "20.00");
    });
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "audited-registry" },
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

    expect(safeFetch).toHaveBeenCalledTimes(45);
    expect(first.diagnostics).toMatchObject({ cacheStatus: "MISS", apiDurationMs: 450 });
    expect(second.diagnostics).toMatchObject({ cacheStatus: "COALESCED", apiDurationMs: 0 });
    expect(third.diagnostics).toMatchObject({ cacheStatus: "HIT", apiDurationMs: 0 });
    expect(second.products).toEqual(first.products);
    expect(third.products).toEqual(first.products);
  });

  it("isolates a failed store when another store returns products", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => {
      const host = new URL(input.url).hostname;
      if (host === "kith.com") throw new Error("upstream failed");
      return storefrontResponse(
        input.url,
        host,
        host === "www.allbirds.com" ? "20.00" : undefined,
        "Sample Shoes"
      );
    });
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "audited-registry" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );

    const result = await port.search({ query: "shoes", limit: 3 });

    expect(result.coverage).toBe("PARTIAL");
    expect(result.merchantsSucceeded).toBe(44);
    expect(result.diagnostics).toMatchObject({
      merchantsFailed: 1,
      coveragePercent: 98,
      failedMerchantIds: ["kith"],
      timedOutMerchantIds: []
    });
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.merchant).toBe("Allbirds");
  });

  it("uses the configured registry and isolates a merchant that exceeds the search deadline", async () => {
    vi.useFakeTimers();
    try {
      const registry = { version: "v-test", merchants: SHOPIFY_PILOTS.slice(0, 2) };
      const safeFetch = vi.fn(async (input: { url: string }) => {
        const host = new URL(input.url).hostname;
        if (host === "kith.com") return new Promise<never>(() => undefined);
        return storefrontResponse(input.url, host, "19.99", "Coffee Shirt", "Shirt");
      });
      const port = createShopifyPortFromEnvironment(
        { SHOPIFY_STOREFRONT_MODE: "audited-registry", SHOPIFY_SEARCH_TIMEOUT_MS: "100" },
        { safeFetch, clock: { now: () => new Date(now) }, registry }
      );

      const pending = port.search({ query: "shirt", limit: 3 });
      await vi.advanceTimersByTimeAsync(100);
      const result = await pending;

      expect(safeFetch).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({
        coverage: "PARTIAL",
        merchantsQueried: 2,
        merchantsSucceeded: 1,
        diagnostics: {
          merchantsFailed: 1,
          coveragePercent: 50,
          failedMerchantIds: ["kith"],
          timedOutMerchantIds: ["kith"],
          registryVersion: "v-test",
          searchTimeoutMs: 100
        }
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns complete empty only when all forty-five stores succeed", async () => {
    const safeFetch = vi.fn(async (input: { url: string }) => storefrontResponse(input.url, new URL(input.url).hostname));
    const port = createShopifyPortFromEnvironment(
      { SHOPIFY_STOREFRONT_MODE: "audited-registry" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );
    await expect(port.search({ query: "no-match", limit: 3 })).resolves.toMatchObject({
      coverage: "COMPLETE",
      merchantsQueried: 45,
      merchantsSucceeded: 45,
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
      { SHOPIFY_STOREFRONT_MODE: "audited-registry" },
      { safeFetch, clock: { now: () => new Date(now) } }
    );
    await expect(port.search({ query: "no-match", limit: 3 })).rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
  });

  it("fails closed unless the audited registry mode is configured", async () => {
    await expect(createShopifyPortFromEnvironment({}).search({ query: "coffee", limit: 5 }))
      .rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
    await expect(createShopifyPortFromEnvironment({ SHOPIFY_STOREFRONT_MODE: "fixed-five" })
      .search({ query: "coffee", limit: 5 })).rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
    await expect(createShopifyPortFromEnvironment({ SHOPIFY_STOREFRONT_MODE: "evil.example" })
      .search({ query: "coffee", limit: 5 })).rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
    expect(() => createShopifyPortFromEnvironment({
      SHOPIFY_STOREFRONT_MODE: "audited-registry",
      SHOPIFY_SEARCH_TIMEOUT_MS: "99"
    })).toThrow("SHOPIFY_SEARCH_TIMEOUT_MS is invalid");
    expect(() => createShopifyPortFromEnvironment({
      SHOPIFY_STOREFRONT_MODE: "audited-registry",
      SHOPIFY_SEARCH_TIMEOUT_MS: "10001"
    })).toThrow("SHOPIFY_SEARCH_TIMEOUT_MS is invalid");
  });
});

function storefrontResponse(
  url: string,
  host: string,
  price?: string | string[],
  title?: string | string[],
  productType?: string | string[],
  selectedOptions: Array<{ name: string; value: string }> = [],
  metadata: { handle?: string; sku?: string; tags?: string[]; barcode?: string; vendor?: string } = {}
) {
  const prices = price === undefined ? [] : Array.isArray(price) ? price : [price];
  const titles = title === undefined ? [] : Array.isArray(title) ? title : [title];
  const productTypes = productType === undefined ? [] : Array.isArray(productType) ? productType : [productType];
  const nodes = prices.map((amount, index) => ({
    title: titles[index] ?? `Sample Shirt ${index + 1}`, handle: metadata.handle ?? `sample-${index + 1}`, vendor: metadata.vendor ?? host,
    productType: productTypes[index] ?? "", tags: metadata.tags ?? [],
    onlineStoreUrl: `https://${host}/products/${metadata.handle ?? `sample-${index + 1}`}`, featuredImage: null,
    selectedOrFirstAvailableVariant: {
      title: "Default Title", sku: metadata.sku ?? `${host}-sku`, barcode: metadata.barcode ?? null,
      availableForSale: true, price: { amount, currencyCode: "USD" }, image: null,
      selectedOptions
    }
  }));
  return {
    response: new Response(JSON.stringify({ data: { products: { nodes } } }), {
      headers: { "content-type": "application/json" }
    }),
    finalUrl: url
  };
}
