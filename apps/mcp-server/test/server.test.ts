import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComparisonResult } from "../../../packages/contracts/src/index.js";
import {
  createShoppingServer,
  createUnavailableComparePort,
  type BestBuyPort,
  type ComparePort,
  type ShopifyPort,
  type ShoppingServerDependencies
} from "../src/server.js";
import type { AffiliateLinkResolver } from "../src/affiliate-links.js";
import { createMemoryWatchStore } from "../src/watch-store.js";

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
      selectionPolicy: "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE"
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
      checkedAt: "2026-08-18T11:59:00.000Z"
    }]
  })
};

async function connect(
  port: ComparePort,
  products: BestBuyPort = bestBuyPort,
  shopify: ShopifyPort = shopifyPort,
  affiliateLinks?: AffiliateLinkResolver,
  dependencies?: ShoppingServerDependencies
) {
  const server = createShoppingServer(port, products, shopify, affiliateLinks, dependencies);
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
  it("keeps Shopify search data-only and binds product cards to explicit rendering", async () => {
    const client = await connect({ compare: async () => comparison });

    const tools = await client.listTools();
    const searchTool = tools.tools.find((candidate) => candidate.name === "search_shopify_products");
    const renderTool = tools.tools.find((candidate) => candidate.name === "render_product_cards");
    const metricsTool = tools.tools.find((candidate) => candidate.name === "report_product_card_metrics");
    expect(searchTool?._meta).toBeUndefined();
    expect(renderTool?._meta).toMatchObject({
      ui: { resourceUri: "ui://findcheap/product-cards/v13.html" },
      "openai/outputTemplate": "ui://findcheap/product-cards/v13.html"
    });
    expect(metricsTool?._meta).toMatchObject({ ui: { visibility: ["app"] } });

    const resources = await client.listResources();
    expect(resources.resources).toEqual([expect.objectContaining({
      name: "findcheap-product-cards",
      uri: "ui://findcheap/product-cards/v13.html",
      mimeType: "text/html;profile=mcp-app"
    })]);

    const resource = await client.readResource({ uri: "ui://findcheap/product-cards/v13.html" });
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
      "find_coupons",
      "create_watch",
      "bind_watch_automation",
      "check_watch",
      "list_watches",
      "pause_watch",
      "delete_watch",
      "render_product_cards",
      "report_product_card_metrics"
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
    expect(Object.keys(tools.tools.find((tool) => tool.name === "render_product_cards")?.inputSchema.properties ?? {}))
      .toEqual(["renderId"]);
    expect(Object.keys(tools.tools.find((tool) => tool.name === "report_product_card_metrics")?.inputSchema.properties ?? {}).sort())
      .toEqual(["renderId", "stages", "terminalStage", "version"]);
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
        selectionPolicy: "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE"
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
        freshness: { status: "OBSERVED_AT_QUERY", checkedAt: "2026-08-18T11:59:00.000Z" },
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
      text: "Rendered 1 product card with explicit identity labels."
    }]);
  });

  it("accepts bounded app-only card metrics only for a live render snapshot", async () => {
    const record = vi.fn();
    const client = await connect(
      { compare: async () => comparison },
      bestBuyPort,
      shopifyPort,
      undefined,
      { cardTelemetry: { record } }
    );
    const search = await client.callTool({
      name: "search_shopify_products",
      arguments: { query: "Valhalla Java", limit: 3, comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE" }
    });
    const renderId = (search.structuredContent as { renderId: string }).renderId;

    const result = await client.callTool({
      name: "report_product_card_metrics",
      arguments: {
        renderId,
        version: "0.6.4",
        terminalStage: "DOM_RENDERED",
        stages: { IFRAME_LOADED: 0, INITIALIZE_ACK: 12.5, DOM_RENDERED: 14 }
      }
    });

    expect(result.structuredContent).toEqual({ status: "RECORDED" });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      renderId,
      version: "0.6.4",
      terminalStage: "DOM_RENDERED",
      stages: { IFRAME_LOADED: 0, INITIALIZE_ACK: 12.5, DOM_RENDERED: 14 }
    }));
    expect((await client.callTool({
      name: "report_product_card_metrics",
      arguments: {
        renderId,
        version: "0.6.4",
        terminalStage: "DOM_RENDERED",
        stages: { DOM_RENDERED: 14 }
      }
    })).structuredContent).toEqual({ status: "IGNORED" });
    expect(record).toHaveBeenCalledTimes(1);
    const oversized = await client.callTool({
      name: "report_product_card_metrics",
      arguments: {
        renderId,
        version: "0.6.4",
        terminalStage: "DOM_RENDERED",
        stages: { DOM_RENDERED: 300_001 }
      }
    });
    expect(oversized.isError).toBe(true);
    expect(JSON.stringify(oversized.content)).toContain("less than or equal to 300000");
    expect((await client.callTool({
      name: "report_product_card_metrics",
      arguments: {
        renderId: "22222222-2222-4222-8222-222222222222",
        version: "0.6.4",
        terminalStage: "DOM_RENDERED",
        stages: { DOM_RENDERED: 1 }
      }
    })).isError).toBe(true);
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

describe("Coupon and Watch tools", () => {
  const current = new Date("2026-08-18T12:00:00.000Z");
  const verifiedDeal = {
    dealId: "deal-1",
    merchant: "Aritzia",
    kind: "PROMO_CODE" as const,
    title: "30% off selected styles",
    description: "Verified brand promotion",
    code: "SAVE30",
    discountPercent: 30,
    eligibility: ["Selected styles"],
    channels: ["ONLINE" as const],
    sourceUrl: "https://www.aritzia.com/promotion",
    checkedAt: "2026-08-18T11:55:00.000Z",
    validFrom: "2026-08-18T00:00:00.000Z",
    validTo: "2026-08-20T00:00:00.000Z",
    verificationStatus: "VERIFIED" as const
  };

  it("returns only current verified Coupon evidence", async () => {
    const client = await connect({ compare: async () => comparison }, bestBuyPort, shopifyPort, undefined, {
      now: () => current,
      deals: { search: async () => [verifiedDeal, { ...verifiedDeal, dealId: "expired", validTo: "2026-08-18T11:59:00.000Z" }] }
    });

    const result = await client.callTool({ name: "find_coupons", arguments: { merchant: "Aritzia", channel: "ANY" } });
    expect(result.structuredContent).toMatchObject({ status: "OK", deals: [{ dealId: "deal-1", code: "SAVE30", discountPercent: 30 }] });
    expect(JSON.stringify(result.structuredContent)).not.toContain("expired");
  });

  it("rejects stale, wrong-merchant, and wrong-channel deal evidence", async () => {
    const client = await connect({ compare: async () => comparison }, bestBuyPort, shopifyPort, undefined, {
      now: () => current,
      deals: { search: async () => [
        { ...verifiedDeal, dealId: "stale", checkedAt: "2026-08-17T11:59:59.000Z" },
        { ...verifiedDeal, dealId: "wrong-merchant", merchant: "Other" },
        { ...verifiedDeal, dealId: "wrong-channel", channels: ["IN_STORE"] }
      ] }
    });
    const result = await client.callTool({ name: "find_coupons", arguments: { merchant: "Aritzia", channel: "ONLINE" } });
    expect(result.structuredContent).toMatchObject({ status: "NO_VERIFIED_DEALS", deals: [] });
  });

  it("fails closed when no verified Deals API exists", async () => {
    const client = await connect({ compare: async () => comparison }, bestBuyPort, shopifyPort, undefined, { now: () => current });
    const result = await client.callTool({ name: "find_coupons", arguments: { merchant: "Aritzia" } });
    expect(result.structuredContent).toMatchObject({ status: "DATA_SOURCE_UNAVAILABLE", deals: [] });
  });

  it("asks for product identity and condition before creating a broad product watch", async () => {
    const client = await connect({ compare: async () => comparison }, bestBuyPort, shopifyPort, undefined, { now: () => current });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Apple AirPods Pro", condition: "PRICE_BELOW", threshold: 17_000
    } });

    expect(created.structuredContent).toMatchObject({
      status: "NEEDS_CLARIFICATION",
      questions: expect.arrayContaining([
        expect.stringMatching(/generation|model|GTIN/i),
        expect.stringMatching(/condition/i)
      ])
    });
    expect((await client.callTool({ name: "list_watches", arguments: {} })).structuredContent).toEqual({ watches: [] });
  });

  it("requires a merchant for a generation-only product watch", async () => {
    const client = await connect({ compare: async () => comparison }, bestBuyPort, shopifyPort, undefined, { now: () => current });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Rhodia Dress Narcissus Bloom",
      condition: "PRICE_BELOW",
      threshold: 20_000,
      identity: { generation: "Rhodia Dress Narcissus Bloom", variantDimensions: { Size: "XXS" } },
      conditionPreference: "ANY"
    } });

    expect(created.structuredContent).toMatchObject({
      status: "NEEDS_CLARIFICATION",
      questions: [expect.stringMatching(/merchant/i)]
    });
  });

  it("allows a merchant-bound named style only when discovery identity and variants match", async () => {
    const discoveryPort: ShopifyPort = { search: async (input) => {
      const result = await shopifyPort.search(input);
      return {
        ...result,
        products: result.products.map((product) => ({
          ...product,
          matchStatus: "DISCOVERY_MATCH" as const,
          matchEvidence: ["all query terms matched"],
          condition: "UNKNOWN" as const
        }))
      };
    } };
    const client = await connect({ compare: async () => comparison }, bestBuyPort, discoveryPort, undefined, { now: () => current });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods",
      merchant: "Death Wish Coffee",
      condition: "PRICE_BELOW",
      threshold: 1_700,
      identity: { generation: "Valhalla Java", variantDimensions: { "Pack Size": "10 count" } },
      conditionPreference: "ANY"
    } });
    const watchId = (created.structuredContent as { watchId: string }).watchId;
    await client.callTool({ name: "bind_watch_automation", arguments: { watchId, automationId: "watch-named-style" } });

    expect((await client.callTool({ name: "check_watch", arguments: { watchId } })).structuredContent)
      .toMatchObject({ status: "TRIGGERED" });
  });

  it("fails closed before source lookup for a legacy broad product watch", async () => {
    const watches = createMemoryWatchStore();
    const legacy = await watches.create({
      query: "Apple AirPods Pro", condition: "PRICE_BELOW", threshold: 17_000, membershipIds: [], intervalMinutes: 60
    }, current.toISOString());
    const search = vi.fn(shopifyPort.search);
    const client = await connect({ compare: async () => comparison }, bestBuyPort, { search }, undefined, { now: () => current, watches });

    expect((await client.callTool({ name: "check_watch", arguments: { watchId: legacy.watchId } })).structuredContent).toMatchObject({
      status: "NEEDS_CLARIFICATION"
    });
    expect(search).not.toHaveBeenCalled();
  });

  it("binds product watch lookup to identity and explicit condition", async () => {
    const search = vi.fn(shopifyPort.search);
    const client = await connect({ compare: async () => comparison }, bestBuyPort, { search }, undefined, { now: () => current });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods", condition: "PRICE_BELOW", threshold: 1_700,
      identity: { modelNumber: "5094SSC", gtin: "810063341254", variantDimensions: { "Pack Size": "10 count" } },
      conditionPreference: "NEW"
    } });
    const watchId = (created.structuredContent as { watchId: string }).watchId;
    await client.callTool({ name: "bind_watch_automation", arguments: { watchId, automationId: "watch-identity-bound" } });

    expect((await client.callTool({ name: "check_watch", arguments: { watchId } })).structuredContent).toMatchObject({
      status: "DATA_SOURCE_UNAVAILABLE"
    });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      query: "Valhalla Java pods 5094SSC 810063341254 10 count"
    }));
  });

  it("rejects an EXACT source result whose returned identity does not match the watch", async () => {
    const client = await connect({ compare: async () => comparison }, bestBuyPort, shopifyPort, undefined, { now: () => current });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Apple AirPods Pro", condition: "IN_STOCK",
      identity: { modelNumber: "MTJV3AM/A" }, conditionPreference: "ANY"
    } });
    const watchId = (created.structuredContent as { watchId: string }).watchId;
    await client.callTool({ name: "bind_watch_automation", arguments: { watchId, automationId: "watch-identity-reject" } });

    expect((await client.callTool({ name: "check_watch", arguments: { watchId } })).structuredContent).toMatchObject({
      status: "DATA_SOURCE_UNAVAILABLE"
    });
  });

  it("accepts an exact model number embedded in a Global Catalog title when SKU is absent", async () => {
    const globalPort: ShopifyPort = { search: async (input) => {
      const result = await shopifyPort.search(input);
      return {
        ...result,
        products: result.products.map((product) => {
          const { sku: _sku, ...withoutSku } = product;
          return {
            ...withoutSku,
            title: "Sony WH-1000XM5 Wireless Headphones",
            variantDimensions: {},
            condition: "NEW" as const,
            itemPrice: { amountCents: 24_999, currency: "USD" as const }
          };
        })
      };
    } };
    const client = await connect({ compare: async () => comparison }, bestBuyPort, globalPort, undefined, { now: () => current });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Sony WH-1000XM5",
      condition: "PRICE_BELOW",
      threshold: 25_000,
      identity: { modelNumber: "WH-1000XM5" },
      conditionPreference: "NEW"
    } });
    const watchId = (created.structuredContent as { watchId: string }).watchId;
    await client.callTool({ name: "bind_watch_automation", arguments: { watchId, automationId: "watch-global-model" } });

    expect((await client.callTool({ name: "check_watch", arguments: { watchId } })).structuredContent)
      .toMatchObject({ status: "TRIGGERED" });
  });

  it("activates a price watch only after its Codex Automation is bound", async () => {
    const client = await connect({ compare: async () => comparison }, bestBuyPort, shopifyPort, undefined, { now: () => current });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods", condition: "PRICE_BELOW", threshold: 1_700, intervalMinutes: 60,
      identity: { modelNumber: "5094SSC", variantDimensions: { "Pack Size": "10 count" } }, conditionPreference: "ANY"
    } });
    const watchId = (created.structuredContent as { watchId: string }).watchId;
    expect(created.structuredContent).toMatchObject({ status: "READY_TO_SCHEDULE", intervalMinutes: 60 });
    expect((created.structuredContent as { automationPrompt: string }).automationPrompt).toContain(watchId);
    expect((created.structuredContent as { automationPrompt: string }).automationPrompt).toContain("checkedAt");
    expect((await client.callTool({ name: "check_watch", arguments: { watchId } })).structuredContent).toMatchObject({
      status: "NOT_SCHEDULED", watchId
    });

    expect((await client.callTool({ name: "bind_watch_automation", arguments: {
      watchId, automationId: "findcheap-valhalla-price"
    } })).structuredContent).toEqual({
      status: "ACTIVE", watchId, automationId: "findcheap-valhalla-price"
    });

    const first = await client.callTool({ name: "check_watch", arguments: { watchId } });
    const second = await client.callTool({ name: "check_watch", arguments: { watchId } });
    expect(first.structuredContent).toMatchObject({ status: "TRIGGERED", watchId });
    expect(first.structuredContent).toMatchObject({
      observation: {
        merchant: "Death Wish Coffee",
        merchantUrl: "https://deathwishcoffee.com/products/valhalla-java-single-serve-pods",
        itemPrice: { amountCents: 1_499, currency: "USD" },
        checkedAt: "2026-08-18T11:59:00.000Z"
      }
    });
    expect(second.structuredContent).toMatchObject({ status: "NOT_TRIGGERED", watchId });

    expect((await client.callTool({ name: "list_watches", arguments: {} })).structuredContent).toMatchObject({
      watches: [{
        watchId,
        status: "ACTIVE",
        monitoringStatus: "ACTIVE",
        automationId: "findcheap-valhalla-price",
        condition: "PRICE_BELOW"
      }]
    });
    expect((await client.callTool({ name: "pause_watch", arguments: {
      watchId, paused: true, automationId: "wrong-automation"
    } })).structuredContent).toMatchObject({ status: "AUTOMATION_SYNC_REQUIRED" });
    expect((await client.callTool({ name: "pause_watch", arguments: {
      watchId, paused: true, automationId: "findcheap-valhalla-price"
    } })).structuredContent).toMatchObject({ status: "PAUSED" });
    expect((await client.callTool({ name: "delete_watch", arguments: {
      watchId, automationId: "wrong-automation"
    } })).structuredContent).toMatchObject({ status: "AUTOMATION_SYNC_REQUIRED", deleted: false });
    expect((await client.callTool({ name: "delete_watch", arguments: {
      watchId, automationId: "findcheap-valhalla-price"
    } })).structuredContent).toMatchObject({ status: "DELETED", deleted: true });
  });

  it("serializes concurrent checks so one threshold crossing sends one alert", async () => {
    const client = await connect({ compare: async () => comparison }, bestBuyPort, shopifyPort, undefined, { now: () => current });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods", condition: "PRICE_BELOW", threshold: 1_700,
      identity: { modelNumber: "5094SSC" }, conditionPreference: "ANY"
    } });
    const watchId = (created.structuredContent as { watchId: string }).watchId;
    await client.callTool({ name: "bind_watch_automation", arguments: { watchId, automationId: "watch-concurrent" } });
    const results = await Promise.all([
      client.callTool({ name: "check_watch", arguments: { watchId } }),
      client.callTool({ name: "check_watch", arguments: { watchId } })
    ]);
    expect(results.map((result) => (result.structuredContent as { status: string }).status).sort()).toEqual([
      "NOT_TRIGGERED", "TRIGGERED"
    ]);
  });

  it("never binds one Codex Automation to two watches", async () => {
    const client = await connect({ compare: async () => comparison }, bestBuyPort, shopifyPort, undefined, { now: () => current });
    const first = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods", condition: "PRICE_BELOW", threshold: 1_700,
      identity: { modelNumber: "5094SSC" }, conditionPreference: "ANY"
    } });
    const second = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods", condition: "PRICE_BELOW", threshold: 1_600,
      identity: { modelNumber: "5094SSC" }, conditionPreference: "ANY"
    } });
    const firstWatchId = (first.structuredContent as { watchId: string }).watchId;
    const secondWatchId = (second.structuredContent as { watchId: string }).watchId;
    await client.callTool({ name: "bind_watch_automation", arguments: {
      watchId: firstWatchId, automationId: "one-automation"
    } });

    expect((await client.callTool({ name: "bind_watch_automation", arguments: {
      watchId: secondWatchId, automationId: "one-automation"
    } })).structuredContent).toMatchObject({
      status: "AUTOMATION_ALREADY_BOUND",
      watchId: secondWatchId,
      automationId: "one-automation"
    });
  });

  it("does not bind an Automation after the Watch expires", async () => {
    let clock = current;
    const client = await connect({ compare: async () => comparison }, bestBuyPort, shopifyPort, undefined, {
      now: () => clock
    });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods",
      condition: "PRICE_BELOW",
      threshold: 1_700,
      identity: { modelNumber: "5094SSC" },
      conditionPreference: "ANY",
      expiresAt: "2026-08-18T12:01:00.000Z"
    } });
    const watchId = (created.structuredContent as { watchId: string }).watchId;
    clock = new Date("2026-08-18T12:02:00.000Z");

    expect((await client.callTool({ name: "bind_watch_automation", arguments: {
      watchId,
      automationId: "late-automation"
    } })).structuredContent).toMatchObject({ status: "EXPIRED" });
    expect((await client.callTool({ name: "list_watches", arguments: {} })).structuredContent).toMatchObject({
      watches: [{ watchId, monitoringStatus: "EXPIRED" }]
    });
  });

  it("keeps legacy checks runnable but requires reconciliation before lifecycle changes", async () => {
    const watches = createMemoryWatchStore();
    const created = await watches.create({
      query: "Valhalla Java pods",
      condition: "PRICE_BELOW",
      threshold: 1_700,
      membershipIds: [],
      identity: { modelNumber: "5094SSC" },
      conditionPreference: "ANY",
      intervalMinutes: 60
    }, current.toISOString());
    const { schedulingState: _schedulingState, ...legacy } = created;
    await watches.save(legacy);
    const client = await connect({ compare: async () => comparison }, bestBuyPort, shopifyPort, undefined, {
      now: () => current,
      watches
    });

    expect((await client.callTool({ name: "list_watches", arguments: {} })).structuredContent).toMatchObject({
      watches: [{ watchId: created.watchId, monitoringStatus: "LEGACY_UNVERIFIED" }]
    });
    expect((await client.callTool({ name: "check_watch", arguments: { watchId: created.watchId } })).structuredContent)
      .toMatchObject({ status: "TRIGGERED" });
    expect((await client.callTool({ name: "pause_watch", arguments: {
      watchId: created.watchId,
      paused: true
    } })).structuredContent).toMatchObject({ status: "AUTOMATION_SYNC_REQUIRED" });
    expect((await client.callTool({ name: "bind_watch_automation", arguments: {
      watchId: created.watchId,
      automationId: "legacy-existing-automation"
    } })).structuredContent).toMatchObject({ status: "ACTIVE" });
  });

  it("establishes a restock baseline before notifying", async () => {
    let availability: "OUT_OF_STOCK" | "IN_STOCK" = "OUT_OF_STOCK";
    const search = vi.fn(async (input: Parameters<ShopifyPort["search"]>[0]) => {
      const result = await shopifyPort.search(input);
      return { ...result, products: result.products.map((product) => ({ ...product, availability })) };
    });
    const changingPort: ShopifyPort = { search };
    const client = await connect({ compare: async () => comparison }, bestBuyPort, changingPort, undefined, { now: () => current });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods", condition: "RESTOCKED", identity: { gtin: "810063341254" }, conditionPreference: "ANY"
    } });
    const watchId = (created.structuredContent as { watchId: string }).watchId;
    await client.callTool({ name: "bind_watch_automation", arguments: { watchId, automationId: "watch-restock" } });
    expect((await client.callTool({ name: "check_watch", arguments: { watchId } })).structuredContent).toMatchObject({ status: "NOT_TRIGGERED" });
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ includeOutOfStock: true }));
    availability = "IN_STOCK";
    expect((await client.callTool({ name: "check_watch", arguments: { watchId } })).structuredContent).toMatchObject({ status: "TRIGGERED" });
  });

  it("evaluates verified discount watches through the Deals API", async () => {
    const client = await connect({ compare: async () => comparison }, bestBuyPort, shopifyPort, undefined, {
      now: () => current,
      deals: { search: async () => [verifiedDeal] }
    });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Aritzia sale", merchant: "Aritzia", condition: "DISCOUNT_AT_LEAST", threshold: 30
    } });
    const watchId = (created.structuredContent as { watchId: string }).watchId;
    await client.callTool({ name: "bind_watch_automation", arguments: { watchId, automationId: "watch-deal" } });
    expect((await client.callTool({ name: "check_watch", arguments: { watchId } })).structuredContent).toMatchObject({ status: "TRIGGERED" });
  });
});
