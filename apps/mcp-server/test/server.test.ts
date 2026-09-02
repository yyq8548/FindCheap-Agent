import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PRODUCT_SELECTION_SNAPSHOTS,
  MAX_VISUAL_CANDIDATES,
  MAX_VISUAL_SEARCH_SNAPSHOTS,
  PRODUCT_SELECTION_SNAPSHOT_TTL_MS,
  VISUAL_SEARCH_SNAPSHOT_TTL_MS,
  createShoppingServer,
  type ShopifyPort,
  type ShoppingServerDependencies
} from "../src/server.js";
import type { AffiliateLinkResolver } from "../src/affiliate-links.js";
import { ShopifyCartQuoteError } from "../src/shopify-cart-quote.js";
import { createMemoryWatchStore } from "../src/watch-store.js";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const shopifyPort: ShopifyPort = {
  search: async () => ({
    source: "SHOPIFY_GLOBAL_CATALOG",
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
      queryAttempts: 1,
      fallbackQueryUsed: false,
      catalogProductsReturned: 1,
      catalogVariantsReturned: 1,
      catalogZeroResultAttempts: 0,
      outOfStockProductsExcluded: 0,
      identityProductsExcluded: 0,
      irrelevantProductsExcluded: 0,
      conditionProductsExcluded: 0,
      priceProductsExcluded: 0,
      trustedMerchantProductsReturned: 1,
      unverifiedMerchantProductsReturned: 0,
      unverifiedMerchantProductsExcluded: 0,
      riskyMerchantProductsExcluded: 0,
      merchantTrustRegistryVersion: "merchant-trust-2026-08-24",
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
      merchantTrust: {
        level: "OFFICIAL",
        verification: "INDEPENDENT",
        evidence: ["independently reviewed official domain: https://www.deathwishcoffee.com/"],
        reviewedAt: "2026-08-20"
      },
      handle: "42797821853913",
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
  shopify: ShopifyPort = shopifyPort,
  affiliateLinks?: AffiliateLinkResolver,
  dependencies?: ShoppingServerDependencies
) {
  const server = createShoppingServer(shopify, affiliateLinks, dependencies);
  const client = new Client({ name: "shopping-agent-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

describe("shopping MCP server", () => {
  it("keeps stable product selections for two hours within a bounded snapshot cache", () => {
    expect(PRODUCT_SELECTION_SNAPSHOT_TTL_MS).toBe(2 * 60 * 60_000);
    expect(MAX_PRODUCT_SELECTION_SNAPSHOTS).toBe(128);
  });
  it("bounds interactive visual sessions", () => {
    expect(VISUAL_SEARCH_SNAPSHOT_TTL_MS).toBe(10 * 60_000);
    expect(MAX_VISUAL_CANDIDATES).toBe(6);
    expect(MAX_VISUAL_SEARCH_SNAPSHOTS).toBe(32);
  });
  it("binds product cards directly to Shopify search and hides legacy rendering from the model", async () => {
    const client = await connect();

    const tools = await client.listTools();
    const searchTool = tools.tools.find((candidate) => candidate.name === "search_products");
    const legacyShopifyTool = tools.tools.find((candidate) => candidate.name === "search_shopify_products");
    const createWatchTool = tools.tools.find((candidate) => candidate.name === "create_watch");
    const renderTool = tools.tools.find((candidate) => candidate.name === "render_product_cards");
    const metricsTool = tools.tools.find((candidate) => candidate.name === "report_product_card_metrics");
    expect(searchTool?._meta).toMatchObject({
      ui: { resourceUri: "ui://findcheap/product-cards/v30.html" },
      "openai/outputTemplate": "ui://findcheap/product-cards/v30.html"
    });
    expect(renderTool?._meta).toMatchObject({
      ui: {
        resourceUri: "ui://findcheap/product-cards/v30.html",
        visibility: ["app"]
      }
    });
    expect(metricsTool?._meta).toMatchObject({ ui: { visibility: ["app"] } });
    expect(legacyShopifyTool?._meta).toMatchObject({ ui: { visibility: ["app"] } });
    expect(createWatchTool?.inputSchema).toMatchObject({
      properties: {
        threshold: {
          description: expect.stringContaining("for 'below $40', send 4000 so $39.99 triggers")
        }
      }
    });

    const resources = await client.listResources();
    expect(resources.resources).toEqual([expect.objectContaining({
      name: "findcheap-product-cards",
      uri: "ui://findcheap/product-cards/v30.html",
      mimeType: "text/html;profile=mcp-app"
    })]);

    const resource = await client.readResource({ uri: "ui://findcheap/product-cards/v30.html" });
    const content = resource.contents[0];
    const html = content !== undefined && "text" in content ? content.text : "";
    expect(html).toContain("ui/notifications/tool-result");
    expect(html).toContain("ui/notifications/tool-input");
    expect(html).toContain("tools/call");
    expect(html).toContain("ui/initialize");
    expect(html).toContain("ui/notifications/initialized");
    expect(html).toContain("ui/notifications/size-changed");
    expect(html).toContain("openai:set_globals");
    expect(html).toContain("const bridge = window.openai");
    expect(html).toContain("COMPAT_OUTPUT_RECEIVED");
    expect(html).toContain("Product-card data did not arrive");
    expect(html).toContain("toolResponseMetadata");
    expect(html).not.toContain("product-cards/v2.html");
    expect(content?._meta).toMatchObject({
      ui: {
        prefersBorder: false,
        csp: {
          connectDomains: [],
          resourceDomains: ["https://cdn.shopify.com", "https://i.ebayimg.com"]
        }
      }
    });
    expect(html).toContain("textContent");
    expect(html).not.toContain("innerHTML");
  });

  it("discovers the read-only shopping and merchant Beta tools", async () => {
    const client = await connect();

    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "search_products",
      "search_visual_candidates",
      "finalize_visual_search",
      "search_shopify_products",
      "search_awin_products",
      "inspect_selected_shopify_product",
      "quote_selected_shopify_product",
      "research_selected_product_deal",
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
      "allowAlternatives",
      "brand",
      "brandMode",
      "comparisonMode",
      "conditionPreference",
      "contextMode",
      "excludedFeatures",
      "featureMode",
      "features",
      "limit",
      "maxItemPriceCents",
      "membershipIds",
      "preferences",
      "productType",
      "query",
      "requiredFeatures",
      "responseLocale",
      "selectionMode",
      "visualInput",
      "zipCode"
    ]);
    const unifiedTool = tools.tools.find((tool) => tool.name === "search_products");
    expect(unifiedTool?.title).toBe("FindCheap");
    expect(unifiedTool?._meta).toMatchObject({
      "openai/toolInvocation/invoking": "FindCheap",
      "openai/toolInvocation/invoked": "FindCheap"
    });
    expect(unifiedTool?.inputSchema.required).toEqual(["query"]);
    expect(unifiedTool?.description).toContain("selectionMode=LOWEST_PRICE");
    expect(unifiedTool?.description).toContain("Commercial relationships never affect relevance or ranking");
    expect(unifiedTool?.description).toContain("maxItemPriceCents");
    expect(unifiedTool?.description).toContain("objective must-have attributes in requiredFeatures");
    expect(unifiedTool?.description).toContain("brandMode=REQUIRED");
    expect(unifiedTool?.description).toContain("Never put a brand in productType or requiredFeatures");
    expect(unifiedTool?.description).toContain("Text-only product-search entrypoint");
    expect(unifiedTool?.description).toContain("English progress must be exactly");
    expect(unifiedTool?.description).toContain("Chinese progress exactly");
    expect(unifiedTool?.description).toContain("Searching for suitable products.");
    expect(unifiedTool?.description).toContain("正在搜索合适商品。");
    expect(unifiedTool?.description).toContain("Never output a plan or read Memory, Skill files, repository files");
    expect(unifiedTool?.description).toContain("Missing soft evidence remains a limitation-labeled DISCOVERY_MATCH");
    expect(unifiedTool?.description).toContain("CONTINUE_PREVIOUS_PRODUCT when the user adds budget");
    expect(unifiedTool?.description).toContain("maxItemPriceCents is a ceiling, never a spending target");
    expect(unifiedTool?.description).toContain("If every merchant is unverified");
    expect(unifiedTool?.description).toContain("Never recommend a product absent from returned cards");
    expect(unifiedTool?.inputSchema.properties?.contextMode).toMatchObject({
      description: expect.stringContaining("CONTINUE for added budget")
    });
    expect(unifiedTool?.description).not.toContain("call render_product_cards");
    const visualCandidateTool = tools.tools.find((tool) => tool.name === "search_visual_candidates");
    expect(visualCandidateTool?.description).toContain("at most six labeled candidate images");
    expect(visualCandidateTool?.description).toContain("Do not use this tool for text-only, Watch, or batch searches");
    const visualFinalizeTool = tools.tools.find((tool) => tool.name === "finalize_visual_search");
      expect(visualFinalizeTool?.description).toContain("cannot create EXACT identity");
      expect(visualFinalizeTool?.description).toContain("single-use");
      expect(visualFinalizeTool?.description).toContain("never retry more than once");
      expect(visualFinalizeTool?.description).toContain("Color or pattern difference alone");
    const awinTool = tools.tools.find((tool) => tool.name === "search_awin_products");
    expect(awinTool?._meta).toMatchObject({ ui: { visibility: ["app"] } });
    const inspectTool = tools.tools.find((tool) => tool.name === "inspect_selected_shopify_product");
    expect(Object.keys(inspectTool?.inputSchema.properties ?? {}).sort()).toEqual([
      "renderId",
      "selectionId",
      "variantDimensions",
      "variantId"
    ]);
    expect(inspectTool?.description).toContain("never scan task history");
    const quoteTool = tools.tools.find((tool) => tool.name === "quote_selected_shopify_product");
    expect(quoteTool?.description).toContain("For MERCHANT_CHECKOUT_ONLY, do not ask for ZIP");
    expect(unifiedTool?.inputSchema.properties?.selectionMode).toMatchObject({
      default: "MERCHANT_DIVERSE"
    });
    expect(Object.keys(tools.tools.find((tool) => tool.name === "render_product_cards")?.inputSchema.properties ?? {}))
      .toEqual(["renderId"]);
    expect(Object.keys(tools.tools.find((tool) => tool.name === "report_product_card_metrics")?.inputSchema.properties ?? {}).sort())
      .toEqual(["renderId", "stages", "terminalStage", "version"]);
    expect(tools.tools[0]?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false
    });
    expect(tools.tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/order|checkout|payment/i)
    ]));
  });

  it("returns Shopify Global Catalog item prices without claiming delivered price", async () => {
    const client = await connect();

    const result = await client.callTool({
      name: "search_shopify_products",
      arguments: { query: "Valhalla Java", limit: 3, comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE" }
    });

    expect(result.structuredContent).toMatchObject({
      status: "OK",
      source: "SHOPIFY_GLOBAL_CATALOG",
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
        queryAttempts: 1,
        fallbackQueryUsed: false,
        catalogProductsReturned: 1,
        catalogVariantsReturned: 1,
        catalogZeroResultAttempts: 0,
        outOfStockProductsExcluded: 0,
        identityProductsExcluded: 0,
        irrelevantProductsExcluded: 0,
        conditionProductsExcluded: 0,
        priceProductsExcluded: 0,
        trustedMerchantProductsReturned: 1,
        unverifiedMerchantProductsReturned: 0,
        unverifiedMerchantProductsExcluded: 0,
        riskyMerchantProductsExcluded: 0,
        merchantTrustRegistryVersion: "merchant-trust-2026-08-24",
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
        handle: "42797821853913",
        quoteReference: {
          renderId: expect.any(String),
          variantId: "42797821853913"
        },
        matchStatus: "EXACT",
        merchantTrust: {
          level: "OFFICIAL",
          verification: "INDEPENDENT"
        },
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
          merchantTrustBadge: "OFFICIAL",
          conditionBadge: "UNKNOWN",
          availability: "IN_STOCK",
          actionLabel: "View at merchant"
        }
      }]
    });
    expect(JSON.stringify(result.content)).toContain("Valhalla Java Single-Serve Pods");
    expect(JSON.stringify(result.content)).toContain("condition: UNKNOWN");
    expect(JSON.stringify(result.content)).toContain("merchant trust: OFFICIAL (INDEPENDENT)");
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
        version: "0.16.3",
        terminalStage: "DOM_RENDERED",
        stages: { IFRAME_LOADED: 0, INITIALIZE_ACK: 12.5, DOM_RENDERED: 14 }
      }
    });

    expect(result.structuredContent).toEqual({ status: "RECORDED" });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      renderId,
      version: "0.16.3",
      terminalStage: "DOM_RENDERED",
      stages: { IFRAME_LOADED: 0, INITIALIZE_ACK: 12.5, DOM_RENDERED: 14 }
    }));
    expect((await client.callTool({
      name: "report_product_card_metrics",
      arguments: {
        renderId,
        version: "0.16.3",
        terminalStage: "DOM_RENDERED",
        stages: { DOM_RENDERED: 14 }
      }
    })).structuredContent).toEqual({ status: "IGNORED" });
    expect(record).toHaveBeenCalledTimes(1);
    const oversized = await client.callTool({
      name: "report_product_card_metrics",
      arguments: {
        renderId,
        version: "0.16.3",
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
        version: "0.16.3",
        terminalStage: "DOM_RENDERED",
        stages: { DOM_RENDERED: 1 }
      }
    })).isError).toBe(true);
  });

  it("uses canonical links when no affiliate relationship is approved", async () => {
    const client = await connect();
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
    expect(JSON.stringify(product)).not.toMatch(/utm_|couponCode/i);
  });

  it("uses only injected approved affiliate links without foregrounding the commercial relationship", async () => {
    const resolve = vi.fn(() => ({
      kind: "APPROVED_AFFILIATE" as const,
      url: "https://go.fixture-affiliate.example/click?campaign=approved",
      providerName: "Fixture Network",
      disclosure: "We may earn a commission if you buy through this link. This does not raise your price or affect ranking."
    }));
    const affiliateLinks: AffiliateLinkResolver = {
      resolve
    };
    const client = await connect( shopifyPort, affiliateLinks);
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
    expect(JSON.stringify(result.content)).toContain("Commercial relationships never affect relevance or ranking");
    expect(JSON.stringify(result.content)).not.toContain("Fixture Network");
    expect(JSON.stringify(result.content)).not.toContain("commission");
    expect(resolve).toHaveBeenCalledWith({
      merchantId: "death-wish-coffee",
      merchantUrl: "https://deathwishcoffee.com/products/valhalla-java-single-serve-pods",
      sourceHost: "deathwishcoffee.com"
    });
  });

  it("accepts ZIP and memberships but never invents contextual prices", async () => {
    const search = vi.fn(shopifyPort.search);
    const client = await connect( { search });

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
      cartQuoteCoverage: { attempted: 0, succeeded: 0 },
      pricingContext: { zipCode: "33433-1234", membershipIds: ["shopify-plus"] },
      products: [{ pricing: { deliveredPrice: { status: "UNAVAILABLE" } } }]
    });
    expect(JSON.stringify(result.content)).toContain("delivered price unavailable");
  });

  it("hides unconfigured commercial tools without hiding the working shopping flow", async () => {
    const client = await connect( shopifyPort, undefined, {
      toolAvailability: { verifiedDeals: false }
    });

    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).not.toContain("compare_products");
    expect(names).not.toContain("find_coupons");
    expect(names).toEqual(expect.arrayContaining([
      "search_shopify_products",
      "search_awin_products",
      "create_watch",
      "render_product_cards"
    ]));
  });

  it("enriches returned variants with ZIP-specific Shopify Cart estimates", async () => {
    const quoteCart = vi.fn(async () => ({
      status: "ESTIMATED" as const,
      subtotal: { amountCents: 1_499, currency: "USD" as const },
      shipping: { amountCents: 500, currency: "USD" as const, label: "Standard" },
      tax: {
        status: "ZIP_ESTIMATED" as const,
        amount: { amountCents: 105, currency: "USD" as const },
        jurisdiction: "FL",
        rateBasisPoints: 698,
        source: "TAX_FOUNDATION_STATE_AVERAGE_2026" as const
      },
      deliveredPrice: { amountCents: 2_104, currency: "USD" as const },
      totalEstimated: true,
      checkedAt: "2026-08-20T12:00:00.000Z",
      expiresAt: "2026-08-20T12:10:00.000Z"
    }));
    const client = await connect(

      shopifyPort,
      undefined,
      { cartQuotes: { quote: quoteCart } }
    );

    const result = await client.callTool({
      name: "search_shopify_products",
      arguments: {
        query: "Valhalla Java",
        limit: 3,
        comparisonMode: "DISCOVERY",
        selectionMode: "LOWEST_PRICE",
        zipCode: "33433"
      }
    });

    expect(quoteCart).toHaveBeenCalledWith(expect.objectContaining({ merchant: "Death Wish Coffee" }), "33433");
    expect(result.structuredContent).toMatchObject({
      priceScope: "SHOPIFY_CART_ESTIMATE",
      cartQuoteCoverage: { attempted: 1, succeeded: 1 },
      products: [{
        pricing: {
          scope: "SHOPIFY_CART_ESTIMATE",
          shipping: { status: "ESTIMATED", amount: { amountCents: 500 }, label: "Standard" },
          tax: {
            status: "ESTIMATED",
            amount: { amountCents: 105 },
            source: "ZIP_STATE_AVERAGE_2026",
            jurisdiction: "FL"
          },
          mandatoryFees: { status: "UNAVAILABLE" },
          deliveredPrice: {
            status: "ESTIMATED",
            amount: { amountCents: 2_104 },
            expiresAt: "2026-08-20T12:10:00.000Z"
          }
        },
        card: {
          primaryPrice: { amountCents: 2_104 },
          itemPrice: { amountCents: 1_499 },
          priceLabel: "Estimated total",
          shippingLabel: "Standard shipping $5.00",
          taxPrice: { amountCents: 105 },
          taxLabel: "Estimated tax (FL ZIP state average 6.98%)",
          estimatedTotal: { amountCents: 2_104 }
        }
      }]
    });
    expect(JSON.stringify(result.content)).toContain("estimated total: USD 21.04");
    expect(JSON.stringify(result.content)).toContain("ZIP state-average estimate");
    expect(JSON.stringify(result.content)).toContain("full address or checkout");
  });

  it("quotes a previously returned variant from its stable reference without searching by title", async () => {
    const search = vi.fn(shopifyPort.search);
    const quoteCart = vi.fn(async (_product: { handle: string; title: string }, _zipCode: string) => ({
      status: "ESTIMATED" as const,
      subtotal: { amountCents: 1_499, currency: "USD" as const },
      shipping: { amountCents: 500, currency: "USD" as const, label: "Standard" },
      tax: {
        status: "ZIP_ESTIMATED" as const,
        amount: { amountCents: 105, currency: "USD" as const },
        jurisdiction: "FL",
        rateBasisPoints: 698,
        source: "TAX_FOUNDATION_STATE_AVERAGE_2026" as const
      },
      deliveredPrice: { amountCents: 2_104, currency: "USD" as const },
      totalEstimated: true,
      checkedAt: "2026-08-20T12:00:00.000Z",
      expiresAt: "2026-08-20T12:10:00.000Z"
    }));
    const client = await connect(

      { search },
      undefined,
      { cartQuotes: { quote: quoteCart } }
    );

    const first = await client.callTool({
      name: "search_shopify_products",
      arguments: {
        query: "Valhalla Java",
        limit: 3,
        comparisonMode: "DISCOVERY",
        selectionMode: "MERCHANT_DIVERSE"
      }
    });
    const product = (first.structuredContent as {
      products: Array<{ quoteReference: { selectionId: string; renderId: string; variantId: string } }>;
    }).products[0]!;

    const quoted = await client.callTool({
      name: "quote_selected_shopify_product",
      arguments: { selectionId: product.quoteReference.selectionId, zipCode: "33433" }
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(quoteCart).toHaveBeenCalledWith(expect.objectContaining({
      handle: "42797821853913",
      title: "Valhalla Java Single-Serve Pods — 10 count"
    }), "33433");
    expect(quoted.structuredContent).toMatchObject({
      status: "OK",
      priceScope: "SHOPIFY_CART_ESTIMATE",
      cartQuoteCoverage: { attempted: 1, succeeded: 1 },
      pricingContext: { zipCode: "33433" },
      products: [{
        handle: "42797821853913",
        title: "Valhalla Java Single-Serve Pods — 10 count",
        pricing: { deliveredPrice: { amount: { amountCents: 2_104 } } },
        quoteReference: { variantId: "42797821853913" }
      }]
    });
    expect(JSON.stringify(quoted.content)).toContain("Estimated delivered total");
  });

  it("returns safe actionable quote failure codes while retaining existing cards and rejecting address collection", async () => {
    const search = vi.fn(shopifyPort.search);
    const quoteCart = vi.fn();
    const client = await connect(

      { search },
      undefined,
      { cartQuotes: { quote: quoteCart } }
    );
    const first = await client.callTool({
      name: "search_shopify_products",
      arguments: {
        query: "Valhalla Java",
        limit: 3,
        comparisonMode: "DISCOVERY",
        selectionMode: "MERCHANT_DIVERSE"
      }
    });
    const reference = (first.structuredContent as {
      products: Array<{ quoteReference: { selectionId: string; renderId: string; variantId: string } }>;
    }).products[0]!.quoteReference;
    const cases = [
      ["FULL_ADDRESS_REQUIRED", "Do not ask for or send a street address"],
      ["NO_DELIVERY_OPTIONS", "no shipping method"],
      ["MERCHANT_CART_UNAVAILABLE", "does not prove the product is out of stock"],
      ["VARIANT_REJECTED", "rejected this exact Shopify variant"],
      ["QUOTE_TIMEOUT", "before the deadline"]
    ] as const;

    for (const [code, message] of cases) {
      quoteCart.mockRejectedValueOnce(new ShopifyCartQuoteError(code));
      const result = await client.callTool({
        name: "quote_selected_shopify_product",
        arguments: { ...reference, zipCode: "33433" }
      });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result.content)).toContain(`[${code}]`);
      expect(JSON.stringify(result.content)).toContain(message);
      expect(result.structuredContent).toMatchObject({ products: [{ handle: "42797821853913" }] });
    }
    expect(quoteCart).toHaveBeenCalledTimes(cases.length);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a quote reference variant was not returned by that search", async () => {
    const search = vi.fn(shopifyPort.search);
    const quoteCart = vi.fn();
    const client = await connect(

      { search },
      undefined,
      { cartQuotes: { quote: quoteCart } }
    );
    const first = await client.callTool({
      name: "search_shopify_products",
      arguments: {
        query: "Valhalla Java",
        limit: 3,
        comparisonMode: "DISCOVERY",
        selectionMode: "MERCHANT_DIVERSE"
      }
    });
    const renderId = (first.structuredContent as { renderId: string }).renderId;

    const result = await client.callTool({
      name: "quote_selected_shopify_product",
      arguments: { renderId, variantId: "99999999999999", zipCode: "33433" }
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("does not belong to that search result");
    expect(search).toHaveBeenCalledTimes(1);
    expect(quoteCart).not.toHaveBeenCalled();

    const titleRetry = await client.callTool({
      name: "quote_selected_shopify_product",
      arguments: {
        renderId,
        variantId: "42797821853913",
        zipCode: "33433",
        query: "Valhalla Java Single-Serve Pods"
      }
    });
    expect(titleRetry.isError).toBe(true);
    expect(search).toHaveBeenCalledTimes(1);
    expect(quoteCart).not.toHaveBeenCalled();
  });

  it("inspects a requested size from the exact prior product without another catalog search", async () => {
    const search = vi.fn(shopifyPort.search);
    const quoteCart = vi.fn(async () => ({
      status: "ESTIMATED" as const,
      subtotal: { amountCents: 1_499, currency: "USD" as const },
      shipping: { amountCents: 0, currency: "USD" as const, label: "Free" },
      tax: {
        status: "ZIP_ESTIMATED" as const,
        amount: { amountCents: 105, currency: "USD" as const },
        jurisdiction: "FL",
        rateBasisPoints: 698,
        source: "TAX_FOUNDATION_STATE_AVERAGE_2026" as const
      },
      deliveredPrice: { amountCents: 1_604, currency: "USD" as const },
      totalEstimated: true,
      checkedAt: "2026-08-21T00:00:00.000Z",
      expiresAt: "2026-08-21T00:10:00.000Z"
    }));
    const inspect = vi.fn(async (product: { handle: string }) => ({
      productTitle: product.handle === "42797821853913"
        ? "Valhalla Java Single-Serve Pods — 10 count"
        : "unexpected",
      canonicalProductUrl: "https://deathwishcoffee.com/products/valhalla-java-single-serve-pods",
      variants: [{
        ...(await shopifyPort.search({ query: "fixture", limit: 1 })).products[0]!,
        handle: "42797821853914",
        sku: "5094SSC-S",
        variantDimensions: { Size: "S" },
        merchantUrl: "https://deathwishcoffee.com/products/valhalla-java-single-serve-pods?variant=42797821853914"
      }]
    }));
    const client = await connect(

      { search },
      undefined,
      { selectedProducts: { inspect }, cartQuotes: { quote: quoteCart } }
    );
    const first = await client.callTool({
      name: "search_shopify_products",
      arguments: {
        query: "Valhalla Java",
        limit: 3,
        comparisonMode: "DISCOVERY",
        selectionMode: "MERCHANT_DIVERSE"
      }
    });
    const reference = (first.structuredContent as {
      products: Array<{ quoteReference: { selectionId: string; renderId: string; variantId: string } }>;
    }).products[0]!.quoteReference;

    const inspected = await client.callTool({
      name: "inspect_selected_shopify_product",
      arguments: { selectionId: reference.selectionId, variantDimensions: { Size: "S" } }
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({
      handle: "42797821853913",
      merchantUrl: "https://deathwishcoffee.com/products/valhalla-java-single-serve-pods"
    }), { Size: "S" });
    expect(inspected.structuredContent).toMatchObject({
      status: "OK",
      sourceVariantId: "42797821853913",
      variants: [{
        variantId: "42797821853914",
        variantDimensions: { Size: "S" },
        availability: "IN_STOCK",
        quoteReference: {
          renderId: expect.any(String),
          variantId: "42797821853914"
        }
      }]
    });
    expect(JSON.stringify(inspected.content)).toContain("no title or catalog search was used");

    const siblingReference = (inspected.structuredContent as {
      variants: Array<{ quoteReference: { selectionId: string; renderId: string; variantId: string } }>;
    }).variants[0]!.quoteReference;
    await client.callTool({
      name: "quote_selected_shopify_product",
      arguments: { selectionId: siblingReference.selectionId, zipCode: "33433" }
    });
    expect(quoteCart).toHaveBeenCalledWith(expect.objectContaining({
      handle: "42797821853914",
      variantDimensions: { Size: "S" }
    }), "33433");
    expect(search).toHaveBeenCalledTimes(1);

    const titleRetry = await client.callTool({
      name: "inspect_selected_shopify_product",
      arguments: { ...reference, variantDimensions: { Size: "S" }, query: "Valhalla Java size S" }
    });
    expect(titleRetry.isError).toBe(true);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("keeps item-price output when one merchant Cart quote fails", async () => {
    const second = {
      ...(await shopifyPort.search({ query: "coffee", limit: 3 })).products[0]!,
      merchantId: "shopify-456",
      merchant: "Other Shop",
      sourceHost: "other.example",
      merchantUrl: "https://other.example/products/coffee",
      handle: "456"
    };
    const search = vi.fn(async () => ({
      ...await shopifyPort.search({ query: "coffee", limit: 3 }),
      products: [...(await shopifyPort.search({ query: "coffee", limit: 3 })).products, second]
    }));
    const quoteCart = vi.fn(async (product: { merchantId: string }) => {
      if (product.merchantId === "shopify-456") throw new Error("quote unavailable");
      return {
        status: "ESTIMATED" as const,
        subtotal: { amountCents: 1_499, currency: "USD" as const },
        shipping: { amountCents: 500, currency: "USD" as const, label: "Standard" },
        tax: {
          status: "ZIP_ESTIMATED" as const,
          amount: { amountCents: 105, currency: "USD" as const },
          jurisdiction: "FL",
          rateBasisPoints: 698,
          source: "TAX_FOUNDATION_STATE_AVERAGE_2026" as const
        },
        deliveredPrice: { amountCents: 2_104, currency: "USD" as const },
        totalEstimated: true,
        checkedAt: "2026-08-20T12:00:00.000Z",
        expiresAt: "2026-08-20T12:10:00.000Z"
      };
    });
    const client = await connect(
       { search }, undefined,
      { cartQuotes: { quote: quoteCart } }
    );

    const result = await client.callTool({
      name: "search_shopify_products",
      arguments: {
        query: "coffee", limit: 3, comparisonMode: "DISCOVERY",
        selectionMode: "LOWEST_PRICE", zipCode: "33433"
      }
    });

    expect(result.structuredContent).toMatchObject({
      priceScope: "MIXED",
      cartQuoteCoverage: { attempted: 2, succeeded: 1 },
      products: [
        { pricing: { deliveredPrice: { status: "ESTIMATED" } } },
        { pricing: { deliveredPrice: { status: "UNAVAILABLE" } } }
      ]
    });
  });

  it("forwards an exact item-price ceiling and reports it in the response", async () => {
    const search = vi.fn(async () => ({
      ...await shopifyPort.search({ query: "anime shirt", limit: 3 }),
      maxItemPriceCents: 8_000
    }));
    const client = await connect(

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

  it("offers authorized Chrome only after bounded Shopify queries return no usable product", async () => {
    const emptyShopify: ShopifyPort = {
      search: async () => ({
        ...await shopifyPort.search({ query: "missing product", limit: 3 }),
        merchantsQueried: 0,
        merchantsSucceeded: 0,
        products: [],
        diagnostics: {
          ...(await shopifyPort.search({ query: "missing product", limit: 3 })).diagnostics,
          chromeFallbackEligible: true,
          queryAttempts: 2,
          fallbackQueryUsed: true,
          catalogProductsReturned: 0,
          catalogVariantsReturned: 0,
          catalogZeroResultAttempts: 2
        }
      })
    };
    const client = await connect( emptyShopify);

    const result = await client.callTool({
      name: "search_shopify_products",
      arguments: {
        query: "missing product",
        limit: 3,
        comparisonMode: "DISCOVERY",
        selectionMode: "MERCHANT_DIVERSE"
      }
    });

    expect(result.structuredContent).toMatchObject({
      status: "OK",
      diagnostics: { chromeFallbackEligible: true, queryAttempts: 2 },
      products: []
    });
    expect(JSON.stringify(result.content)).toContain("authorize one bounded Chrome whole-web fallback");
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
    const client = await connect( { search });

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
    const client = await connect( { search });

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
    const client = await connect();

    const result = await client.callTool({
      name: "render_product_cards",
      arguments: { renderId: "00000000-0000-4000-8000-000000000000" }
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{
      type: "text",
      text: "Product-card snapshot is unavailable. Run search_products once."
    }]);
    expect(result.structuredContent).toBeUndefined();
  });

  it.each([
    {},
    { query: "coffee" },
    { query: "coffee", handle: "coffee", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE" },
    { query: " ", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE" },
    { handle: "42797821853913", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE" },
    { query: "coffee", limit: 9, comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE" },
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

      { search }
    );

    const result = await client.callTool({ name: "search_shopify_products", arguments: args });

    expect(result.isError).toBe(true);
    expect(search).not.toHaveBeenCalled();
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

  it("researches the stable selected product without a title search or automatic Watch", async () => {
    const search = vi.fn(shopifyPort.search);
    const watches = createMemoryWatchStore();
    const client = await connect( { search }, undefined, {
      now: () => current,
      watches,
      deals: { search: async () => [{ ...verifiedDeal, merchant: "Death Wish Coffee" }] }
    });
    const found = await client.callTool({
      name: "search_shopify_products",
      arguments: { query: "Valhalla Java", limit: 1, comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE" }
    });
    const selectionId = (found.structuredContent as { products: Array<{ selectionId: string }> }).products[0]!.selectionId;

    const result = await client.callTool({
      name: "research_selected_product_deal",
      arguments: { selectionId, objective: "CURRENT_DEALS" }
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(result.structuredContent).toMatchObject({
      status: "OK",
      selectionId,
      selectedProduct: { merchantProductId: "42797821853913", merchant: "Death Wish Coffee" },
      currentPrice: { basis: "ITEM_PRICE", amount: { amountCents: 1_499 } },
      dealStatus: "CURRENT_DEAL_FOUND",
      deals: [{ dealId: "deal-1", applicability: "REQUIRES_MERCHANT_CONFIRMATION" }]
    });
    const content = result.content as Array<{ text: string }>;
    expect(content).toEqual([expect.objectContaining({
      text: expect.stringContaining("Selected product: Valhalla Java Single-Serve Pods — 10 count")
    })]);
    expect(content[0]?.text).toContain("Current item price: USD 14.99");
    expect(content[0]?.text).toContain("code SAVE30");
    expect(content[0]?.text).toContain("source https://www.aritzia.com/promotion");
    expect(JSON.stringify(result.structuredContent)).not.toMatch(/history|cadence|BUY_NOW|WAIT/u);
    expect((await client.callTool({ name: "list_watches", arguments: {} })).structuredContent)
      .toEqual({ watches: [] });
  });

  it("uses one immutable visual session to review candidate images before rendering cards", async () => {
    const visualShopify: ShopifyPort = {
      search: async (input) => {
        const result = await shopifyPort.search(input);
        return {
          ...result,
          products: result.products.map((product) => ({
            ...product,
            imageUrl: "https://cdn.shopify.com/product.jpg",
            productType: "coffee pods",
            description: "single serve coffee pods"
          }))
        };
      }
    };
    const load = vi.fn(async () => ({
      data: Buffer.from("candidate-image").toString("base64"),
      mimeType: "image/jpeg" as const
    }));
    const client = await connect(

      visualShopify,
      undefined,
      { visualCandidateImages: { load } }
    );
    const first = await client.callTool({
      name: "search_visual_candidates",
      arguments: {
        query: "Valhalla Java single serve pods",
        productType: "coffee pods",
        visualInput: {
          productType: "coffee pods",
          colors: ["black"],
          hardClues: ["single serve pods"]
        }
      }
    });
    expect(first.isError).not.toBe(true);
    expect(first.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image", mimeType: "image/jpeg" })
    ]));
    const structured = first.structuredContent as {
      visualSessionId: string;
      candidates: Array<{ candidateId: string }>;
    };
    expect(structured.candidates).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(1);

    const invalid = await client.callTool({
      name: "finalize_visual_search",
      arguments: {
        visualSessionId: structured.visualSessionId,
        verdicts: [{
          candidateId: "11111111-1111-4111-8111-111111111111",
          verdict: { classification: "HIGHLY_SIMILAR", matches: [], conflicts: [] }
        }]
      }
    });
    expect(invalid.isError).toBe(true);

    const finalized = await client.callTool({
      name: "finalize_visual_search",
      arguments: {
        visualSessionId: structured.visualSessionId,
        verdicts: [{
          candidateId: structured.candidates[0]!.candidateId,
          verdict: {
            classification: "HIGHLY_SIMILAR",
            matches: [
              { attribute: "PRODUCT_TYPE", referenceEvidence: "coffee pods", candidateEvidence: "coffee pods" },
              { attribute: "DISTINCTIVE_DETAIL", referenceEvidence: "single serve", candidateEvidence: "single serve" }
            ],
            conflicts: []
          }
        }]
      }
    });
    expect(finalized.isError).not.toBe(true);
    expect(finalized.structuredContent).toMatchObject({
      status: "OK",
      products: [{ visualMatchGroup: "HIGHLY_SIMILAR", selectionId: expect.any(String) }]
    });

    const reused = await client.callTool({
      name: "finalize_visual_search",
      arguments: {
        visualSessionId: structured.visualSessionId,
        verdicts: [{
          candidateId: structured.candidates[0]!.candidateId,
          verdict: { classification: "SAME_STYLE", matches: [], conflicts: [] }
        }]
      }
    });
    expect(reused.isError).toBe(true);
  });

  it("returns a stable visual failure code when candidate images cannot be loaded", async () => {
    const visualShopify: ShopifyPort = {
      search: async (input) => {
        const result = await shopifyPort.search(input);
        return {
          ...result,
          products: result.products.map((product) => ({
            ...product,
            imageUrl: "https://cdn.shopify.com/unavailable.jpg",
            productType: "dress"
          }))
        };
      }
    };
    const client = await connect(

      visualShopify,
      undefined,
      {
        visualCandidateImages: {
          load: async () => {
            throw new Error("IMAGE_UNAVAILABLE");
          }
        }
      }
    );

    const result = await client.callTool({
      name: "search_visual_candidates",
      arguments: {
        query: "floral dress",
        productType: "dress",
        visualInput: { productType: "dress", patterns: ["floral"] }
      }
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: "NO_IMAGE_CANDIDATES",
      candidates: [],
      visualSearchFailure: {
        code: "NO_LOADABLE_IMAGES",
        message: expect.stringContaining("no candidate image")
      }
    });
  });

  it("softens uncertain visual text and retries once after every first-pass candidate conflicts", async () => {
    const baseline = await shopifyPort.search({
      query: "placeholder",
      limit: 1,
      comparisonMode: "DISCOVERY",
      selectionMode: "MERCHANT_DIVERSE",
      membershipIds: []
    });
    let sourceCall = 0;
    const search = vi.fn<ShopifyPort["search"]>(async () => {
      sourceCall += 1;
      const relaxed = sourceCall > 2;
      return {
        ...baseline,
        products: [{
          ...baseline.products[0]!,
          handle: relaxed ? "broader-ivory-dress" : "wrong-black-dress",
          title: relaxed ? "Broader Ivory Mini Dress" : "Wrong Black Maxi Dress",
          productType: "dress",
          description: relaxed ? "ivory mini dress" : "black maxi dress",
          imageUrl: relaxed
            ? "https://cdn.shopify.com/broader.jpg"
            : "https://cdn.shopify.com/wrong.jpg",
          merchantUrl: relaxed
            ? "https://deathwishcoffee.com/products/broader-ivory-dress"
            : "https://deathwishcoffee.com/products/wrong-black-dress"
        }]
      };
    });
    const load = vi.fn(async () => ({
      data: Buffer.from("candidate-image").toString("base64"),
      mimeType: "image/jpeg" as const
    }));
    const client = await connect(

      { search },
      undefined,
      { visualCandidateImages: { load } }
    );
    const first = await client.callTool({
      name: "search_visual_candidates",
      arguments: {
        query: "ivory puff sleeve square neckline lace babydoll mini dress",
        productType: "dress",
        requiredFeatures: ["square neckline with lace inset", "small center bow"],
        featureMode: "REQUIRED",
        visualInput: {
          productType: "dress",
          colors: ["ivory"],
          patterns: ["solid"],
          neckline: "square neckline with lace inset",
          sleeveType: "short puff sleeves",
          hardClues: ["small center bow"]
        }
      }
    });
    const firstStructured = first.structuredContent as {
      visualSessionId: string;
      candidates: Array<{ candidateId: string }>;
    };
    expect(firstStructured.candidates).toHaveLength(1);
    expect(search.mock.calls[0]?.[0].query).toContain("ivory");
    expect(search.mock.calls[0]?.[0].query).not.toContain("square neckline");

    const retry = await client.callTool({
      name: "finalize_visual_search",
      arguments: {
        visualSessionId: firstStructured.visualSessionId,
        verdicts: [{
          candidateId: firstStructured.candidates[0]!.candidateId,
          verdict: {
            classification: "CONFLICT",
            matches: [{
              attribute: "PRODUCT_TYPE",
              referenceEvidence: "dress",
              candidateEvidence: "dress"
            }],
            conflicts: [{
              attribute: "COLOR",
              referenceEvidence: "ivory",
              candidateEvidence: "black"
            }]
          }
        }]
      }
    });
    const retryStructured = retry.structuredContent as {
      products: unknown[];
      visualReview: {
        stage: string;
        visualSessionId: string;
        candidates: Array<{ candidateId: string; title: string }>;
      };
    };
    expect(retryStructured.products).toEqual([]);
    expect(retryStructured.visualReview).toMatchObject({
      stage: "RELAXED_REVIEW",
      candidates: [{ title: "Broader Ivory Mini Dress" }]
    });
    expect(search.mock.calls[2]?.[0].query).toBe("dress");
    expect(retry.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image", mimeType: "image/jpeg" })
    ]));

    const finalized = await client.callTool({
      name: "finalize_visual_search",
      arguments: {
        visualSessionId: retryStructured.visualReview.visualSessionId,
        verdicts: [{
          candidateId: retryStructured.visualReview.candidates[0]!.candidateId,
          verdict: {
            classification: "HIGHLY_SIMILAR",
            matches: [
              { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
              { attribute: "COLOR", referenceEvidence: "ivory", candidateEvidence: "ivory" }
            ],
            conflicts: []
          }
        }]
      }
    });
    expect(finalized.structuredContent).toMatchObject({
      status: "OK",
      products: [{ visualMatchGroup: "HIGHLY_SIMILAR", selectionId: expect.any(String) }]
    });
    expect(search).toHaveBeenCalledTimes(4);
  });

  it("renders an official-store fallback card when the catalog source is unavailable", async () => {
    const base = (await shopifyPort.search({
      query: "placeholder",
      limit: 1,
      comparisonMode: "DISCOVERY",
      selectionMode: "MERCHANT_DIVERSE",
      membershipIds: []
    })).products[0]!;
    const officialProduct = {
      ...base,
      merchantId: "official-skims.com",
      merchant: "SKIMS",
      sourceHost: "skims.com",
      merchantTrust: {
        level: "OFFICIAL" as const,
        verification: "INDEPENDENT" as const,
        evidence: ["official merchant domain"]
      },
      handle: "soft-lounge-long-slip-dress",
      title: "SKIMS Soft Lounge Long Slip Dress",
      brand: "SKIMS",
      productType: "Dresses",
      merchantUrl: "https://skims.com/products/soft-lounge-long-slip-dress"
    };
    const client = await connect(

      { search: async () => { throw new Error("offline"); } },
      undefined,
      { officialShopify: { search: async () => [officialProduct] } }
    );

    const found = await client.callTool({ name: "search_products", arguments: {
      query: "SKIMS Soft Lounge Long Slip Dress",
      brand: "SKIMS",
      brandMode: "REQUIRED",
      productType: "long slip dress",
      comparisonMode: "SAME_PRODUCT"
    } });

    expect(found.structuredContent).toMatchObject({
      products: [{
        title: "SKIMS Soft Lounge Long Slip Dress",
        sourceHost: "skims.com",
        presentationGroup: "OFFICIAL_STORE"
      }]
    });
  });

  it("asks for product context before searching an ambiguous new image reference", async () => {
    const search = vi.fn(shopifyPort.search);
    const client = await connect( { search });

    const found = await client.callTool({ name: "search_products", arguments: {
      query: "this dress",
      contextMode: "AMBIGUOUS",
      productType: "dress"
    } });

    expect(search).not.toHaveBeenCalled();
    expect(found.structuredContent).toMatchObject({
      status: "NEEDS_CLARIFICATION",
      questions: ["Is this a new product, or a follow-up about the previous product?"]
    });
  });

  it("returns only current verified Coupon evidence", async () => {
    const client = await connect( shopifyPort, undefined, {
      now: () => current,
      deals: { search: async () => [verifiedDeal, { ...verifiedDeal, dealId: "expired", validTo: "2026-08-18T11:59:00.000Z" }] }
    });

    const result = await client.callTool({ name: "find_coupons", arguments: { merchant: "Aritzia", channel: "ANY" } });
    expect(result.structuredContent).toMatchObject({ status: "OK", deals: [{ dealId: "deal-1", code: "SAVE30", discountPercent: 30 }] });
    expect(JSON.stringify(result.structuredContent)).not.toContain("expired");
  });

  it("rejects stale, wrong-merchant, and wrong-channel deal evidence", async () => {
    const client = await connect( shopifyPort, undefined, {
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
    const client = await connect( shopifyPort, undefined, { now: () => current });
    const result = await client.callTool({ name: "find_coupons", arguments: { merchant: "Aritzia" } });
    expect(result.structuredContent).toMatchObject({ status: "DATA_SOURCE_UNAVAILABLE", deals: [] });
  });

  it("does not persist a Deals-backed Watch when no Deals provider is configured", async () => {
    const watches = createMemoryWatchStore();
    const client = await connect( shopifyPort, undefined, {
      now: () => current,
      watches,
      toolAvailability: { verifiedDeals: false }
    });
    const result = await client.callTool({ name: "create_watch", arguments: {
      query: "Aritzia",
      merchant: "Aritzia",
      condition: "COUPON_AVAILABLE",
      identity: { generation: "Aritzia" },
      conditionPreference: "ANY"
    } });

    expect(result.structuredContent).toMatchObject({ status: "DATA_SOURCE_UNAVAILABLE" });
    expect(await watches.list()).toEqual([]);
  });

  it("asks for product identity and condition before creating a broad product watch", async () => {
    const client = await connect( shopifyPort, undefined, { now: () => current });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Apple AirPods Pro", condition: "PRICE_BELOW", priceBasis: "ITEM_PRICE", threshold: 17_000
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

  it("requires an explicit price basis for price watches", async () => {
    const client = await connect( shopifyPort, undefined, { now: () => current });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods",
      condition: "PRICE_BELOW",
      threshold: 2_000,
      identity: { modelNumber: "5094SSC" },
      conditionPreference: "ANY"
    } });

    expect(created.structuredContent).toMatchObject({
      status: "NEEDS_CLARIFICATION",
      questions: [expect.stringMatching(/ITEM_PRICE|DELIVERED_TOTAL/i)]
    });
  });

  it("monitors delivered total for the exact prior Shopify variant without another title search", async () => {
    const search = vi.fn(shopifyPort.search);
    let deliveredCents = 2_104;
    const quoteCart = vi.fn(async () => ({
      status: "ESTIMATED" as const,
      subtotal: { amountCents: deliveredCents - 605, currency: "USD" as const },
      shipping: { amountCents: 500, currency: "USD" as const, label: "Standard" },
      tax: {
        status: "ZIP_ESTIMATED" as const,
        amount: { amountCents: 105, currency: "USD" as const },
        jurisdiction: "FL",
        rateBasisPoints: 698,
        source: "TAX_FOUNDATION_STATE_AVERAGE_2026" as const
      },
      deliveredPrice: { amountCents: deliveredCents, currency: "USD" as const },
      totalEstimated: true,
      checkedAt: "2026-08-20T12:00:00.000Z",
      expiresAt: "2026-08-20T12:10:00.000Z"
    }));
    const client = await connect(

      { search },
      undefined,
      { now: () => current, cartQuotes: { quote: quoteCart } }
    );
    const found = await client.callTool({ name: "search_products", arguments: {
      query: "Valhalla Java pods", limit: 3
    } });
    const reference = (found.structuredContent as {
      products: Array<{ quoteReference: { selectionId: string; renderId: string; variantId: string } }>;
    }).products[0]!.quoteReference;

    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods",
      condition: "PRICE_BELOW",
      priceBasis: "DELIVERED_TOTAL",
      threshold: 2_000,
      zipCode: "33433",
      quoteReference: reference,
      conditionPreference: "ANY"
    } });
    const watchId = (created.structuredContent as { watchId: string }).watchId;
    expect(created.structuredContent).toMatchObject({ status: "READY_TO_SCHEDULE" });
    await client.callTool({ name: "bind_watch_automation", arguments: {
      watchId, automationId: "watch-delivered-total"
    } });

    expect((await client.callTool({ name: "check_watch", arguments: { watchId } })).structuredContent)
      .toMatchObject({ status: "NOT_TRIGGERED", observation: {
        variantId: "42797821853913",
        priceBasis: "DELIVERED_TOTAL",
        deliveredPrice: { amountCents: 2_104, currency: "USD" }
      } });
    deliveredCents = 1_900;
    expect((await client.callTool({ name: "check_watch", arguments: { watchId } })).structuredContent)
      .toMatchObject({ status: "TRIGGERED", observation: {
        variantId: "42797821853913",
        priceBasis: "DELIVERED_TOTAL",
        deliveredPrice: { amountCents: 1_900, currency: "USD" }
      } });
    expect(search).toHaveBeenCalledTimes(2);
    expect(quoteCart).toHaveBeenCalledTimes(3);
    expect((await client.callTool({ name: "list_watches", arguments: {} })).structuredContent)
      .toMatchObject({ watches: [{ watchId, priceBasis: "DELIVERED_TOTAL" }] });
  });

  it("does not schedule a delivered-total watch when the merchant requires a full address", async () => {
    const client = await connect(

      shopifyPort,
      undefined,
      { now: () => current, cartQuotes: {
        quote: async () => { throw new ShopifyCartQuoteError("FULL_ADDRESS_REQUIRED"); }
      } }
    );
    const found = await client.callTool({ name: "search_products", arguments: {
      query: "Valhalla Java pods", limit: 3
    } });
    const quoteReference = (found.structuredContent as {
      products: Array<{ quoteReference: { renderId: string; variantId: string } }>;
    }).products[0]!.quoteReference;
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods",
      condition: "PRICE_BELOW",
      priceBasis: "DELIVERED_TOTAL",
      threshold: 2_000,
      zipCode: "33433",
      quoteReference,
      conditionPreference: "ANY"
    } });

    expect(created.structuredContent).toMatchObject({
      status: "DATA_SOURCE_UNAVAILABLE",
      message: expect.stringMatching(/FULL_ADDRESS_REQUIRED.*ZIP only/i)
    });
    expect((await client.callTool({ name: "list_watches", arguments: {} })).structuredContent)
      .toEqual({ watches: [] });
  });

  it("requires a merchant for a generation-only product watch", async () => {
    const client = await connect( shopifyPort, undefined, { now: () => current });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Rhodia Dress Narcissus Bloom",
      condition: "PRICE_BELOW",
      priceBasis: "ITEM_PRICE",
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
    const client = await connect( discoveryPort, undefined, { now: () => current });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods",
      merchant: "Death Wish Coffee",
      condition: "PRICE_BELOW",
      priceBasis: "ITEM_PRICE",
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
      query: "Apple AirPods Pro", condition: "PRICE_BELOW", priceBasis: "ITEM_PRICE", threshold: 17_000, membershipIds: [], intervalMinutes: 60
    }, current.toISOString());
    const search = vi.fn(shopifyPort.search);
    const client = await connect( { search }, undefined, { now: () => current, watches });

    expect((await client.callTool({ name: "check_watch", arguments: { watchId: legacy.watchId } })).structuredContent).toMatchObject({
      status: "NEEDS_CLARIFICATION"
    });
    expect(search).not.toHaveBeenCalled();
  });

  it("binds product watch lookup to identity and explicit condition", async () => {
    const search = vi.fn(shopifyPort.search);
    const client = await connect( { search }, undefined, { now: () => current });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods", condition: "PRICE_BELOW", priceBasis: "ITEM_PRICE", threshold: 1_700,
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
    const client = await connect( shopifyPort, undefined, { now: () => current });
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
    const client = await connect( globalPort, undefined, { now: () => current });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Sony WH-1000XM5",
      condition: "PRICE_BELOW",
      priceBasis: "ITEM_PRICE",
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
    const client = await connect( shopifyPort, undefined, { now: () => current });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods", condition: "PRICE_BELOW", priceBasis: "ITEM_PRICE", threshold: 1_700, intervalMinutes: 60,
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
    const client = await connect( shopifyPort, undefined, { now: () => current });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods", condition: "PRICE_BELOW", priceBasis: "ITEM_PRICE", threshold: 1_700,
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

  it("renders approved Awin products through the unified card contract", async () => {
    const client = await connect( shopifyPort, undefined, {
      awin: {
        search: async () => ({
          source: "AWIN_PRODUCT_FEED",
          coverage: "COMPLETE",
          snapshotAt: "2026-08-21T23:32:40.000Z",
          diagnostics: {
            feedRows: 38,
            validRows: 38,
            rejectedRows: 0,
            queryMatches: 1,
            priceProductsExcluded: 0
          },
          products: [{
            merchantId: "20282",
            merchant: "Amazonliss (US)",
            merchantProductId: "sku-1",
            title: "Amazonliss Keratin Mask",
            category: "Hair Care",
            matchStatus: "DISCOVERY_MATCH",
            matchEvidence: ["GTIN, MPN, brand, and condition unavailable"],
            condition: "UNKNOWN",
            itemPrice: { amountCents: 1_999, currency: "USD" },
            availability: "IN_STOCK",
            merchantUrl: "https://www.nutreecosmetics.com/products/keratin-mask",
            affiliateUrl: "https://www.awin1.com/pclick.php?p=1&a=3047955&m=20282",
            checkedAt: "2026-08-21T23:32:40.000Z"
          }]
        })
      }
    });
    const result = await client.callTool({
      name: "search_products",
      arguments: { query: "keratin hair mask", responseLocale: "zh-CN", limit: 3 }
    });

    expect(result.structuredContent).toMatchObject({
      locale: "zh-CN",
      status: "OK",
      source: "UNIFIED_PRODUCT_SEARCH",
      sources: { awin: "COMPLETE", shopify: "COMPLETE", ebay: "SKIPPED" },
      comparison: { status: "DISCOVERY_ONLY" },
      diagnostics: { featureProductsExcluded: 0 }
    });
    const awinCard = (result.structuredContent as { products: Array<Record<string, unknown>> }).products
      .find((product) => product.sourceKind === "AWIN_PRODUCT_FEED");
    expect(awinCard).toMatchObject({
        matchStatus: "DISCOVERY_MATCH",
        condition: "UNKNOWN",
        sourceKind: "AWIN_PRODUCT_FEED",
        affiliateState: "APPROVED",
        purchaseLink: { kind: "APPROVED_AFFILIATE", providerName: "Awin" },
        recommendationTier: "TRUSTED_OR_AFFILIATE",
        presentationGroup: "TRUSTED_MATCH",
        card: { priceLabel: "Verified item price", merchantTrustBadge: "TRUSTED_MERCHANT" },
        pricing: { scope: "ITEM_PRICE_ONLY", deliveredPrice: { status: "UNAVAILABLE" } },
        quoteReference: { renderId: expect.any(String), variantId: "sku-1" }
    });
    expect(result.content).toEqual([expect.objectContaining({
      text: expect.not.stringMatching(/affiliate|Awin/iu)
    })]);
    const modelText = (result.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "";
    expect(modelText.length).toBeLessThanOrEqual(700);
    expect(modelText).toContain("排序后的商品");
    expect(modelText).toContain("来自 2 家商家");
    expect(modelText).toContain("不得称商家为授权零售商");
    expect(modelText).toContain("MERCHANT_CHECKOUT_ONLY 需在结账页确认，不询问 ZIP");
    expect(modelText).toContain("Reuse selectionId; never search titles");
    expect(modelText).not.toMatch(/coverage|diagnostic|feedRows|registry/iu);
  });

  it("attaches verified Coupon evidence to ranked product cards", async () => {
    const client = await connect( shopifyPort, undefined, {
      now: () => current,
      deals: { search: async ({ merchant }) => merchant === "Death Wish Coffee"
        ? [{ ...verifiedDeal, merchant: "Death Wish Coffee" }]
        : [] }
    });

    const result = await client.callTool({
      name: "search_products",
      arguments: { query: "coffee pods", limit: 1 }
    });

    expect(result.structuredContent).toMatchObject({
      quality: { couponsVerified: 1 },
      products: [{
        coupons: { status: "VERIFIED", verified: [{ code: "SAVE30", discountPercent: 30 }] },
        card: { couponLabel: "Coupon: SAVE30" }
      }]
    });
  });

  it("renders eBay as an unverified marketplace seller with checkout-only pricing", async () => {
    const client = await connect( {
      search: async (input) => {
        const result = await shopifyPort.search(input);
        return {
          ...result,
          merchantsSucceeded: 0,
          comparison: {
            status: "DISCOVERY_ONLY" as const,
            evidence: ["no independently verified cross-merchant identity"],
            merchantCount: 0,
            offerCount: 0
          },
          products: []
        };
      }
    }, undefined, {
      awin: { search: async () => { throw new Error("unavailable"); } },
      ebay: { search: async () => ({
        source: "EBAY_BROWSE",
        environment: "PRODUCTION",
        coverage: "COMPLETE",
        snapshotAt: "2026-08-26T12:00:00.000Z",
        diagnostics: { queryMatches: 1, itemsReturned: 1, validItems: 1, rejectedItems: 0 },
        products: [{
          environment: "PRODUCTION",
          itemId: "v1|123|0",
          productRef: "ebay-0123456789abcdef0123456789abcdef",
          title: "Sony WH-1000XM5 Headphones",
          category: "Headphones",
          attributes: ["Color: Black"],
          sellerName: "audio_store",
          sellerFeedbackPercentage: 99.8,
          sellerFeedbackScore: 4200,
          matchStatus: "DISCOVERY_MATCH",
          matchEvidence: ["live eBay fixed-price listing returned by Browse API"],
          condition: "REFURBISHED",
          imageUrl: "https://i.ebayimg.com/images/g/test/s-l1600.jpg",
          itemPrice: { amountCents: 29_999, currency: "USD" },
          availability: "UNKNOWN",
          merchantUrl: "https://www.ebay.com/itm/123",
          affiliateUrl: "https://www.ebay.com/itm/123?campid=5339000012",
          checkedAt: "2026-08-26T12:00:00.000Z"
        }]
      }) }
    });

    const result = await client.callTool({
      name: "search_products",
      arguments: {
        query: "Sony headphones",
        limit: 3,
        maxItemPriceCents: 40_000,
        preferences: ["everyday work"]
      }
    });
    const products = (result.structuredContent as { products: Array<Record<string, unknown>> }).products;
    const product = products.find((candidate) => candidate.sourceKind === "EBAY_BROWSE");

    expect(product).toMatchObject({
      merchant: "eBay",
      sourceEnvironment: "PRODUCTION",
      sellerName: "audio_store",
      recommendationTier: "GENERAL_UNVERIFIED",
      merchantTrust: { level: "UNKNOWN", verification: "UNVERIFIED" },
      quoteCapability: "MERCHANT_CHECKOUT_ONLY",
      purchaseLink: {
        kind: "APPROVED_AFFILIATE",
        providerName: "eBay Partner Network",
        disclosure: "As an eBay Partner, FindCheap may be compensated if you make a purchase."
      },
      card: { merchant: "eBay", sellerName: "audio_store", merchantTrustBadge: "MERCHANT_UNVERIFIED" }
    });
    expect(JSON.stringify(result.content)).toContain("research lead only");
    expect(JSON.stringify(result.content)).toContain("ceiling, not a spending target");
    expect(JSON.stringify(result.content)).toContain("Do not claim one is the best fit");
  });

  it("reports an incompatible Shopify Catalog response without claiming zero results", async () => {
    const client = await connect(

      { search: async () => { throw new Error("CATALOG_SCHEMA_CHANGED"); } }
    );

    const result = await client.callTool({
      name: "search_products",
      arguments: { query: "everyday ballet flats", limit: 3 }
    });

    expect(result.structuredContent).toMatchObject({
      status: "DATA_SOURCE_UNAVAILABLE",
      sources: { awin: "UNAVAILABLE", shopify: "UNAVAILABLE", ebay: "SKIPPED" },
      sourceErrors: { shopify: "CATALOG_SCHEMA_CHANGED" },
      products: []
    });
    expect(result.content).toEqual([expect.objectContaining({
      text: expect.stringContaining("No zero-result conclusion was made")
    })]);
  });

  it("quotes an Awin card through its stable merchant product reference and Shopify cart", async () => {
    const client = await connect( shopifyPort, undefined, {
      awin: {
        search: async () => ({
          source: "AWIN_PRODUCT_FEED",
          coverage: "COMPLETE",
          snapshotAt: "2026-08-21T23:32:40.000Z",
          diagnostics: { feedRows: 1, validRows: 1, rejectedRows: 0, queryMatches: 1, priceProductsExcluded: 0 },
          products: [{
            merchantId: "20282",
            merchant: "Amazonliss (US)",
            merchantProductId: "141003",
            title: "B24 Molecular Peptides pH Maintenance Shampoo 5.07 Fl Oz",
            category: "Hair Care",
            matchStatus: "DISCOVERY_MATCH",
            matchEvidence: ["stable merchant product ID"],
            condition: "UNKNOWN",
            itemPrice: { amountCents: 1_599, currency: "USD" },
            availability: "IN_STOCK",
            merchantUrl: "https://www.nutreecosmetics.com/products/b24-shampoo",
            affiliateUrl: "https://www.awin1.com/pclick.php?p=40969355207&a=3047955&m=20282",
            checkedAt: "2026-08-21T23:32:40.000Z"
          }]
        })
      },
      awinShopifyQuotes: {
        supports: () => true,
        resolve: async () => ({
          ...(await shopifyPort.search({ query: "B24 shampoo", limit: 1 })).products[0]!,
          merchantId: "20282",
          merchant: "Amazonliss (US)",
          sourceHost: "bondoxhair.com",
          handle: "44128515064053",
          title: "B24 Molecular Peptides pH Maintenance Shampoo 5.07 Fl Oz",
          itemPrice: { amountCents: 1_599, currency: "USD" },
          merchantUrl: "https://bondoxhair.com/products/b24-shampoo?variant=44128515064053"
        })
      },
      cartQuotes: {
        quote: async (product, zipCode) => {
          expect(product.handle).toBe("44128515064053");
          expect(zipCode).toBe("33065");
          return {
            status: "ESTIMATED",
            subtotal: { amountCents: 1_599, currency: "USD" },
            shipping: { amountCents: 0, currency: "USD", label: "Standard" },
            tax: {
              status: "ZIP_ESTIMATED",
              amount: { amountCents: 112, currency: "USD" },
              jurisdiction: "Florida",
              rateBasisPoints: 702,
              source: "TAX_FOUNDATION_STATE_AVERAGE_2026"
            },
            deliveredPrice: { amountCents: 1_711, currency: "USD" },
            totalEstimated: true,
            checkedAt: "2026-08-24T23:45:00.000Z",
            expiresAt: "2026-08-24T23:55:00.000Z"
          };
        }
      }
    });
    const found = await client.callTool({ name: "search_products", arguments: { query: "B24 shampoo", limit: 2 } });
    const awinProduct = (found.structuredContent as {
      products: Array<{ sourceKind?: string; quoteReference: { selectionId: string; renderId: string; variantId: string } }>;
    }).products.find((product) => product.sourceKind === "AWIN_PRODUCT_FEED");
    expect(awinProduct).toMatchObject({
      sourceKind: "AWIN_PRODUCT_FEED",
      merchantTrust: {
        level: "UNKNOWN",
        verification: "UNVERIFIED"
      },
      quoteCapability: "ZIP_ESTIMATE_ONLY",
      card: {
        merchantTrustBadge: "TRUSTED_MERCHANT",
        quoteCapability: "ZIP_ESTIMATE_ONLY"
      },
      quoteReference: { selectionId: expect.any(String) }
    });
    const reference = awinProduct!.quoteReference;

    const quoted = await client.callTool({
      name: "quote_selected_shopify_product",
      arguments: { selectionId: reference.selectionId, zipCode: "33065" }
    });

    expect(quoted.structuredContent).toMatchObject({
      priceScope: "SHOPIFY_CART_ESTIMATE",
      pricingContext: { zipCode: "33065" },
      products: [{
        sourceKind: "AWIN_PRODUCT_FEED",
        purchaseLink: { kind: "APPROVED_AFFILIATE" },
        pricing: {
          scope: "SHOPIFY_CART_ESTIMATE",
          shipping: { amount: { amountCents: 0 } },
          tax: { status: "ESTIMATED", amount: { amountCents: 112 } },
          deliveredPrice: { status: "ESTIMATED", amount: { amountCents: 1_711 } }
        },
        card: {
          priceLabel: "Estimated total",
          primaryPrice: { amountCents: 1_711 },
          shippingLabel: "免费配送 $0.00"
        }
      }]
    });
  });

  it("treats a PRICE_BELOW threshold as an exclusive ceiling without subtracting one cent", async () => {
    let observedCents = 3_999;
    const boundaryShopifyPort: ShopifyPort = {
      search: async (input) => {
        const result = await shopifyPort.search(input);
        return {
          ...result,
          products: result.products.map((product) => ({
            ...product,
            itemPrice: { amountCents: observedCents, currency: "USD" as const }
          }))
        };
      }
    };
    const client = await connect( boundaryShopifyPort, undefined, { now: () => current });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods", condition: "PRICE_BELOW", priceBasis: "ITEM_PRICE", threshold: 4_000,
      identity: { modelNumber: "5094SSC" }, conditionPreference: "ANY"
    } });
    const watchId = (created.structuredContent as { watchId: string }).watchId;
    await client.callTool({ name: "bind_watch_automation", arguments: { watchId, automationId: "watch-price-boundary" } });

    expect((await client.callTool({ name: "check_watch", arguments: { watchId } })).structuredContent)
      .toMatchObject({ status: "TRIGGERED" });
    observedCents = 4_000;
    expect((await client.callTool({ name: "check_watch", arguments: { watchId } })).structuredContent)
      .toMatchObject({ status: "NOT_TRIGGERED" });
  });

  it("never binds one Codex Automation to two watches", async () => {
    const client = await connect( shopifyPort, undefined, { now: () => current });
    const first = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods", condition: "PRICE_BELOW", priceBasis: "ITEM_PRICE", threshold: 1_700,
      identity: { modelNumber: "5094SSC" }, conditionPreference: "ANY"
    } });
    const second = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods", condition: "PRICE_BELOW", priceBasis: "ITEM_PRICE", threshold: 1_600,
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
    const client = await connect( shopifyPort, undefined, {
      now: () => clock
    });
    const created = await client.callTool({ name: "create_watch", arguments: {
      query: "Valhalla Java pods",
      condition: "PRICE_BELOW",
      priceBasis: "ITEM_PRICE",
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
      priceBasis: "ITEM_PRICE",
      threshold: 1_700,
      membershipIds: [],
      identity: { modelNumber: "5094SSC" },
      conditionPreference: "ANY",
      intervalMinutes: 60
    }, current.toISOString());
    const { schedulingState: _schedulingState, ...legacy } = created;
    await watches.save(legacy);
    const client = await connect( shopifyPort, undefined, {
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
    const client = await connect( changingPort, undefined, { now: () => current });
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
    const client = await connect( shopifyPort, undefined, {
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
