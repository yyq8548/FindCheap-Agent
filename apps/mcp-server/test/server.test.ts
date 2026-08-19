import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComparisonResult } from "../../../packages/contracts/src/index.js";
import {
  createShoppingServer,
  createUnavailableComparePort,
  type BestBuyPort,
  type ComparePort,
  type ShopifyPort
} from "../src/server.js";
import type { AffiliateLinkResolver } from "../src/affiliate-links.js";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const bestBuyPort: BestBuyPort = {
  search: async () => ({
    products: [{
      sku: "6568600",
      title: "Sony WH-1000XM5 Headphones",
      brand: "Sony",
      modelNumber: "WH1000XM5/B",
      gtins: ["027242923232"],
      itemPrice: { amountCents: 34_999, currency: "USD" },
      availability: "IN_STOCK",
      merchantUrl: "https://api.bestbuy.com/click/example/6568600/pdp",
      checkedAt: "2026-08-14T12:00:00.000Z"
    }]
  })
};

const shopifyPort: ShopifyPort = {
  search: async () => ({
    coverage: "COMPLETE",
  merchantsQueried: 10,
  merchantsSucceeded: 10,
  comparison: {
    status: "DISCOVERY_ONLY" as const,
    evidence: ["no independently verified cross-merchant identity"],
    merchantCount: 1,
    offerCount: 1
  },
    diagnostics: {
      apiDurationMs: 250,
      cacheStatus: "MISS",
      chromeFallbackEligible: false,
      irrelevantProductsExcluded: 0,
      conditionProductsExcluded: 0,
      priceProductsExcluded: 0,
      merchantsFailed: 0,
      coveragePercent: 100,
      failedMerchantIds: [],
      timedOutMerchantIds: [],
      registryVersion: "v1",
      searchTimeoutMs: 3_000,
      selectionPolicy: "EXACT_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE"
    },
    questions: [],
    products: [{
      merchantId: "death-wish-coffee",
      merchant: "Death Wish Coffee",
      sourceHost: "deathwishcoffee.com",
      handle: "valhalla-java-single-serve-pods",
      title: "Valhalla Java Single-Serve Pods — 10 count",
      brand: "Death Wish Coffee",
      sku: "5094SSC",
      gtins: ["810063341254"],
      variantDimensions: { "Pack Size": "10 count" },
      matchStatus: "EXACT",
      matchEvidence: ["GTIN exact"],
      condition: "UNKNOWN",
      itemPrice: { amountCents: 1_499, currency: "USD" },
      availability: "IN_STOCK",
      merchantUrl: "https://deathwishcoffee.com/products/valhalla-java-single-serve-pods",
      checkedAt: "2026-08-18T01:00:00.000Z"
    }]
  })
};

async function connect(
  port: ComparePort,
  products: BestBuyPort = bestBuyPort,
  shopify: ShopifyPort = shopifyPort,
  affiliateLinks?: AffiliateLinkResolver
) {
  const server = createShoppingServer(port, products, shopify, affiliateLinks);
  const client = new Client({ name: "shopping-agent-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

const quote = (quoteId: string, offerId: string, amountCents: number) => ({
  quoteId,
  offerId,
  status: "VERIFIED" as const,
  deliveredPrice: { amountCents, currency: "USD" as const },
  lineItems: [{
    kind: "ITEM" as const,
    amount: { amountCents, currency: "USD" as const },
    label: "ITEM"
  }],
  eligibilityConditions: [],
  evidenceRefs: ["provider-secret-evidence"],
  checkedAt: "2026-08-13T12:00:00.000Z",
  expiresAt: "2026-08-13T12:15:00.000Z"
});

const comparison: ComparisonResult = {
  productId: "internal-product-id",
  exactOffers: [{
    offerId: "internal-offer-id",
    merchantId: "internal-merchant-id",
    sellerName: "Merchant One",
    matchStatus: "EXACT",
    regularQuote: quote("internal-regular-quote-id", "internal-offer-id", 109_999),
    memberQuote: {
      programId: "internal-program-id",
      programName: "Warehouse Club",
      eligible: true,
      quote: quote("internal-member-quote-id", "internal-offer-id", 99_999)
    },
    rankingQuote: quote("internal-member-quote-id", "internal-offer-id", 99_999),
    merchantUrl: "https://merchant.example/products/tv",
    recommendationReasons: ["Exact manufacturer part number"]
  }],
  similarOffers: [{
    offerId: "internal-similar-offer-id",
    merchantId: "internal-similar-merchant-id",
    sellerName: "Merchant Two",
    matchStatus: "SIMILAR",
    merchantUrl: "https://merchant.example/products/similar-tv",
    recommendationReasons: ["Same family, different size"]
  }],
  questions: []
};

describe("shopping MCP server", () => {
  it("publishes a safe MCP Apps resource bound only to explicit card rendering", async () => {
    const client = await connect({ compare: async () => comparison });

    const tools = await client.listTools();
    const searchTool = tools.tools.find((candidate) => candidate.name === "search_shopify_products");
    const renderTool = tools.tools.find((candidate) => candidate.name === "render_product_cards");
    expect(searchTool?._meta).toBeUndefined();
    expect(renderTool?._meta).toMatchObject({
      ui: { resourceUri: "ui://findcheap/product-cards/v7.html" },
      "openai/outputTemplate": "ui://findcheap/product-cards/v7.html"
    });

    const resources = await client.listResources();
    expect(resources.resources).toEqual([expect.objectContaining({
      name: "findcheap-product-cards",
      uri: "ui://findcheap/product-cards/v7.html",
      mimeType: "text/html;profile=mcp-app"
    })]);

    const resource = await client.readResource({ uri: "ui://findcheap/product-cards/v7.html" });
    const content = resource.contents[0];
    const html = content !== undefined && "text" in content ? content.text : "";
    expect(html).toContain("ui/notifications/tool-result");
    expect(html).toContain("ui/notifications/tool-input");
    expect(html).toContain("tools/call");
    expect(html).toContain("ui/initialize");
    expect(html).toContain("ui/notifications/initialized");
    expect(html).toContain("ui/notifications/size-changed");
    expect(html).toContain("openai:set_globals");
    expect(html).toContain("window.openai?.toolOutput");
    expect(html).toContain("Product-card data did not arrive");
    expect(html).toContain("toolResponseMetadata");
    expect(html).not.toContain("product-cards/v2.html");
    expect(content?._meta).toMatchObject({
      ui: {
        csp: {
          connectDomains: [],
          resourceDomains: ["https://cdn.shopify.com"]
        }
      }
    });
    expect(html).toContain("textContent");
    expect(html).not.toContain("innerHTML");
  });

  it("discovers the read-only comparison and merchant Beta tools", async () => {
    const client = await connect({ compare: async () => comparison });

    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "compare_products",
      "search_bestbuy_products",
      "search_shopify_products",
      "render_product_cards"
    ]);
    expect(Object.keys(tools.tools[0]?.inputSchema.properties ?? {}).sort()).toEqual([
      "membershipIds",
      "query",
      "zipCode"
    ]);
    expect(Object.keys(tools.tools[1]?.inputSchema.properties ?? {}).sort()).toEqual([
      "limit",
      "query",
      "sku"
    ]);
    expect(Object.keys(tools.tools[2]?.inputSchema.properties ?? {}).sort()).toEqual([
      "comparisonMode",
      "handle",
      "limit",
      "maxItemPriceCents",
      "membershipIds",
      "query",
      "selectionMode",
      "zipCode"
    ]);
    expect(tools.tools[2]?.inputSchema.required).toContain("selectionMode");
    expect(tools.tools[2]?.inputSchema.required).toContain("comparisonMode");
    expect(tools.tools[2]?.description).toContain("selectionMode=LOWEST_PRICE");
    expect(tools.tools[2]?.description).toContain("maxItemPriceCents");
    expect(tools.tools[2]?.description).toContain("Do not call this tool more than once per user lookup");
    expect(tools.tools[2]?.inputSchema.properties?.selectionMode).toMatchObject({
      description: expect.stringContaining("MERCHANT_DIVERSE")
    });
    expect(Object.keys(tools.tools[3]?.inputSchema.properties ?? {})).toEqual(["renderId"]);
    expect(tools.tools[0]?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false
    });
    expect(tools.tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/order|checkout|payment/i)
    ]));
  });

  it("returns official Best Buy item prices without claiming delivered price", async () => {
    const client = await connect({ compare: async () => comparison });

    const result = await client.callTool({
      name: "search_bestbuy_products",
      arguments: { query: "Sony WH-1000XM5", limit: 5 }
    });

    expect(result.structuredContent).toMatchObject({
      status: "OK",
      merchant: "Best Buy",
      priceScope: "ITEM_PRICE_ONLY",
      products: [{ sku: "6568600", itemPrice: { amountCents: 34_999 } }]
    });
    expect(JSON.stringify(result)).not.toMatch(/deliveredPrice|apiKey/i);
  });

  it("returns tokenless Shopify Storefront item prices without claiming delivered price", async () => {
    const client = await connect({ compare: async () => comparison });

    const result = await client.callTool({
      name: "search_shopify_products",
      arguments: { query: "Valhalla Java", limit: 3, comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE" }
    });

    expect(result.structuredContent).toMatchObject({
      status: "OK",
      source: "SHOPIFY_STOREFRONT_API",
      priceScope: "ITEM_PRICE_ONLY",
      coverage: "COMPLETE",
      merchantsQueried: 10,
      merchantsSucceeded: 10,
      comparison: {
        status: "DISCOVERY_ONLY" as const,
        evidence: ["no independently verified cross-merchant identity"],
        merchantCount: 1,
        offerCount: 1
      },
      diagnostics: {
        apiDurationMs: 250,
        cacheStatus: "MISS",
        chromeFallbackEligible: false,
        irrelevantProductsExcluded: 0,
        conditionProductsExcluded: 0,
        priceProductsExcluded: 0,
        merchantsFailed: 0,
        coveragePercent: 100,
        failedMerchantIds: [],
        timedOutMerchantIds: [],
        registryVersion: "v1",
        searchTimeoutMs: 3_000,
        selectionPolicy: "EXACT_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE"
      },
      questions: [],
      products: [{
        merchant: "Death Wish Coffee",
        handle: "valhalla-java-single-serve-pods",
        matchStatus: "EXACT",
        condition: "UNKNOWN",
        itemPrice: { amountCents: 1_499 },
        pricing: {
          scope: "ITEM_PRICE_ONLY",
          regularItemPrice: { status: "VERIFIED", amount: { amountCents: 1_499 } },
          memberPrice: { status: "UNAVAILABLE" },
          shipping: { status: "UNAVAILABLE" },
          tax: { status: "UNAVAILABLE" },
          mandatoryFees: { status: "UNAVAILABLE" },
          deliveredPrice: { status: "UNAVAILABLE" }
        },
        freshness: { status: "OBSERVED_AT_QUERY", checkedAt: "2026-08-18T01:00:00.000Z" },
        coupons: { status: "UNAVAILABLE", verified: [] },
        purchaseLink: {
          kind: "CANONICAL",
          url: "https://deathwishcoffee.com/products/valhalla-java-single-serve-pods"
        },
        card: {
          title: "Valhalla Java Single-Serve Pods — 10 count",
          merchant: "Death Wish Coffee",
          primaryPrice: { amountCents: 1_499 },
          priceLabel: "Verified item price",
          matchBadge: "EXACT",
          conditionBadge: "UNKNOWN",
          availability: "IN_STOCK",
          actionLabel: "View at merchant"
        }
      }]
    });
    expect(JSON.stringify(result.content)).toContain("Valhalla Java Single-Serve Pods");
    expect(JSON.stringify(result.content)).toContain("condition: UNKNOWN");
    expect(JSON.stringify(result.content)).toContain("Do not call this tool again for this user lookup");
    expect(JSON.stringify(result)).not.toMatch(/rawEvidence/i);
    expect(JSON.stringify(result)).not.toMatch(/deliveredPrice[^}]*amountCents/i);
    expect(result.structuredContent).toMatchObject({
      quality: {
        status: "PASS_WITH_LIMITATIONS",
        cardsReturned: 1,
        itemPricesVerified: 1,
        couponsVerified: 0,
        affiliateLinksApproved: 0
      }
    });
    const renderId = (result.structuredContent as { renderId?: unknown })?.renderId;
    expect(renderId).toEqual(expect.any(String));

    const rendered = await client.callTool({
      name: "render_product_cards",
      arguments: { renderId }
    });
    expect(rendered.structuredContent).toMatchObject({
      renderId,
      products: [{ card: { title: "Valhalla Java Single-Serve Pods — 10 count" } }]
    });
    expect(rendered.content).toEqual([{
      type: "text",
      text: "Rendered 1 verified product card."
    }]);
  });

  it("uses canonical links when no affiliate relationship is approved", async () => {
    const client = await connect({ compare: async () => comparison });
    const result = await client.callTool({
      name: "search_shopify_products",
      arguments: { query: "Valhalla Java", limit: 3, comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE" }
    });

    const product = (result.structuredContent as { products: Array<{ purchaseLink: unknown; coupons: unknown }> }).products[0];
    expect(product).toMatchObject({
      purchaseLink: {
        kind: "CANONICAL",
        url: "https://deathwishcoffee.com/products/valhalla-java-single-serve-pods"
      },
      coupons: { status: "UNAVAILABLE", verified: [] }
    });
    expect(JSON.stringify(product)).not.toMatch(/utm_|affiliate|couponCode/i);
  });

  it("uses only injected approved affiliate links and exposes disclosure next to the CTA", async () => {
    const resolve = vi.fn(() => ({
      kind: "APPROVED_AFFILIATE" as const,
      url: "https://go.fixture-affiliate.example/click?campaign=approved",
      providerName: "Fixture Network",
      disclosure: "We may earn a commission if you buy through this link. This does not raise your price or affect ranking."
    }));
    const affiliateLinks: AffiliateLinkResolver = {
      resolve
    };
    const client = await connect({ compare: async () => comparison }, bestBuyPort, shopifyPort, affiliateLinks);
    const result = await client.callTool({
      name: "search_shopify_products",
      arguments: { query: "Valhalla Java", limit: 3, comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE" }
    });

    expect(result.structuredContent).toMatchObject({
      quality: { affiliateLinksApproved: 1 },
      products: [{
        purchaseLink: {
          kind: "APPROVED_AFFILIATE",
          providerName: "Fixture Network",
          disclosure: expect.stringContaining("does not raise your price or affect ranking")
        }
      }]
    });
    expect(JSON.stringify(result.content)).toContain("Commission never affects ranking");
    expect(resolve).toHaveBeenCalledWith({
      merchantId: "death-wish-coffee",
      merchantUrl: "https://deathwishcoffee.com/products/valhalla-java-single-serve-pods",
      sourceHost: "deathwishcoffee.com"
    });
  });

  it("accepts ZIP and memberships but never invents contextual prices", async () => {
    const search = vi.fn(shopifyPort.search);
    const client = await connect({ compare: async () => comparison }, bestBuyPort, { search });

    const result = await client.callTool({
      name: "search_shopify_products",
      arguments: {
        query: "Valhalla Java",
        limit: 3,
        comparisonMode: "DISCOVERY",
        selectionMode: "MERCHANT_DIVERSE",
        zipCode: "33433-1234",
        membershipIds: ["shopify-plus"]
      }
    });

    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      zipCode: "33433-1234",
      membershipIds: ["shopify-plus"]
    }));
    expect(result.structuredContent).toMatchObject({
      priceScope: "ITEM_PRICE_ONLY",
      pricingContext: { zipCode: "33433-1234", membershipIds: ["shopify-plus"] },
      products: [{ pricing: { deliveredPrice: { status: "UNAVAILABLE" } } }]
    });
    expect(JSON.stringify(result.content)).toContain("delivered price unavailable");
  });

  it("forwards an exact item-price ceiling and reports it in the response", async () => {
    const search = vi.fn(async () => ({
      ...await shopifyPort.search({ query: "anime shirt", limit: 3 }),
      maxItemPriceCents: 8_000
    }));
    const client = await connect(
      { compare: async () => comparison },
      bestBuyPort,
      { search }
    );

    const result = await client.callTool({
      name: "search_shopify_products",
      arguments: {
        query: "anime shirt",
        limit: 3,
        comparisonMode: "DISCOVERY",
        selectionMode: "MERCHANT_DIVERSE",
        maxItemPriceCents: 8_000
      }
    });

    expect(search).toHaveBeenCalledWith(expect.objectContaining({ maxItemPriceCents: 8_000 }));
    expect(result.structuredContent).toMatchObject({ status: "OK", maxItemPriceCents: 8_000 });
    expect(JSON.stringify(result.content)).toContain("USD 80.00");
  });

  it("reports independently verified same-product comparison evidence", async () => {
    const search = vi.fn(async () => ({
      ...await shopifyPort.search({ query: "Sony WH-1000XM5", limit: 3 }),
      comparison: {
        status: "SAME_PRODUCT" as const,
        identityType: "GTIN" as const,
        evidence: ["GTIN and variant exact"],
        merchantCount: 2,
        offerCount: 2
      }
    }));
    const client = await connect({ compare: async () => comparison }, bestBuyPort, { search });

    const result = await client.callTool({
      name: "search_shopify_products",
      arguments: { query: "Sony WH-1000XM5", limit: 3, comparisonMode: "SAME_PRODUCT", selectionMode: "LOWEST_PRICE" }
    });

    expect(result.structuredContent).toMatchObject({
      comparison: { status: "SAME_PRODUCT", identityType: "GTIN", merchantCount: 2 }
    });
    expect(JSON.stringify(result.content)).toContain("Same-product comparison verified across 2 merchants");
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ comparisonMode: "SAME_PRODUCT" }));
  });

  it("asks for hard identity before a generic same-product comparison without querying merchants", async () => {
    const search = vi.fn(shopifyPort.search);
    const client = await connect({ compare: async () => comparison }, bestBuyPort, { search });

    const result = await client.callTool({
      name: "search_shopify_products",
      arguments: {
        query: "blue jeans",
        limit: 3,
        comparisonMode: "SAME_PRODUCT",
        selectionMode: "MERCHANT_DIVERSE"
      }
    });
    expect(search).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({
      status: "NEEDS_CLARIFICATION",
      coverage: "NOT_QUERIED",
      comparison: { status: "NEEDS_CLARIFICATION" },
      questions: [expect.stringContaining("brand")]
    });
    expect(JSON.stringify(result.content)).toContain("NEEDS_CLARIFICATION");
  });

  it("fails closed when a card render snapshot is absent or expired", async () => {
    const client = await connect({ compare: async () => comparison });

    const result = await client.callTool({
      name: "render_product_cards",
      arguments: { renderId: "00000000-0000-4000-8000-000000000000" }
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{
      type: "text",
      text: "Product-card snapshot is unavailable. Run search_shopify_products once."
    }]);
    expect(result.structuredContent).toBeUndefined();
  });

  it.each([
    {},
    { query: "coffee" },
    { query: "coffee", handle: "coffee", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE" },
    { query: " ", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE" },
    { handle: "../admin", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE" },
    { query: "coffee", limit: 4, comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE" },
    { query: "coffee", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE", maxItemPriceCents: 0 },
    { query: "coffee", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE", maxItemPriceCents: 10.5 },
    { query: "coffee under $80", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE", maxItemPriceCents: 8_000 },
    { query: "coffee", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE", arbitraryUrl: "https://evil.example" },
    { query: "coffee", comparisonMode: "DISCOVERY", selectionMode: "UNSAFE" },
    { query: "coffee", comparisonMode: "UNSAFE", selectionMode: "MERCHANT_DIVERSE" },
    { query: "coffee", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE", zipCode: "3343" },
    { query: "coffee", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE", membershipIds: ["club", "club"] }
  ])("rejects invalid Shopify input %#", async (args) => {
    const search = vi.fn(shopifyPort.search);
    const client = await connect(
      { compare: async () => comparison },
      bestBuyPort,
      { search }
    );

    const result = await client.callTool({ name: "search_shopify_products", arguments: args });

    expect(result.isError).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { query: "Sony", sku: "6568600" },
    { query: " " },
    { sku: "not-a-sku" },
    { query: "Sony", limit: 51 },
    { query: "Sony", arbitraryUrl: "https://evil.example" }
  ])("rejects invalid Best Buy input %#", async (args) => {
    const search = vi.fn(bestBuyPort.search);
    const client = await connect({ compare: async () => comparison }, { search });

    const result = await client.callTool({ name: "search_bestbuy_products", arguments: args });

    expect(result.isError).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });

  it.each([
    { query: "OLED65C4PUA", zipCode: "3343" },
    { query: "OLED65C4PUA", zipCode: "33433-123" },
    { query: "OLED65C4PUA", zipCode: "ABCDE" },
    { query: " ", zipCode: "33433" },
    { query: "OLED65C4PUA", zipCode: "33433", membershipIds: ["costco", "costco"] },
    { query: "OLED65C4PUA", zipCode: "33433", arbitraryUrl: "https://untrusted.example" }
  ])("rejects invalid input %#", async (args) => {
    let compareCalls = 0;
    const client = await connect({
      compare: async () => {
        compareCalls += 1;
        return comparison;
      }
    });

    const result = await client.callTool({ name: "compare_products", arguments: args });

    expect(result.isError).toBe(true);
    expect(compareCalls).toBe(0);
  });

  it("returns an explicit unavailable result without fabricated offers", async () => {
    const client = await connect(createUnavailableComparePort());

    const result = await client.callTool({
      name: "compare_products",
      arguments: { query: "OLED65C4PUA", zipCode: "33433" }
    });

    expect(result.structuredContent).toEqual({
      status: "DATA_SOURCE_UNAVAILABLE",
      message: "Live comparison is unavailable because no approved shopping data source is connected.",
      exactOffers: [],
      similarOffers: [],
      questions: []
    });
    expect(result.content).toEqual([{
      type: "text",
      text: "Live comparison is unavailable because no approved shopping data source is connected."
    }]);
  });

  it("preserves user-facing comparison detail without exposing provider IDs or secrets", async () => {
    const client = await connect({ compare: async () => comparison });

    const result = await client.callTool({
      name: "compare_products",
      arguments: {
        query: "OLED65C4PUA",
        zipCode: "33433-1234",
        membershipIds: ["warehouse-club"]
      }
    });

    expect(result.structuredContent).toMatchObject({
      status: "OK",
      exactOffers: [{
        sellerName: "Merchant One",
        matchStatus: "EXACT",
        regularQuote: { deliveredPrice: { amountCents: 109_999, currency: "USD" } },
        memberQuote: {
          programName: "Warehouse Club",
          eligible: true,
          quote: { deliveredPrice: { amountCents: 99_999, currency: "USD" } }
        }
      }],
      similarOffers: [{ sellerName: "Merchant Two", matchStatus: "SIMILAR" }]
    });
    expect(result.content).toEqual([{
      type: "text",
      text: "Comparison complete: 1 exact and 1 similar result(s)."
    }]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/internal-|provider-secret/);
  });
});
