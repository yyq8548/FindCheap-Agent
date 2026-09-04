import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Script } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createShoppingServer,
  type ShoppingServerDependencies,
  type ShopifyPort
} from "../src/server.js";
import { PRODUCT_COMPARISON_UI_URI } from "../src/product-comparison-ui.js";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const shopify: ShopifyPort = {
  search: async () => ({
    source: "SHOPIFY_GLOBAL_CATALOG",
    coverage: "COMPLETE",
    merchantsQueried: 2,
    merchantsSucceeded: 2,
    comparison: {
      status: "SAME_PRODUCT",
      identityType: "GTIN",
      evidence: ["shared GTIN 810063341254"],
      merchantCount: 2,
      offerCount: 2
    },
    diagnostics: {
      apiDurationMs: 20,
      cacheStatus: "MISS",
      chromeFallbackEligible: false,
      queryAttempts: 1,
      fallbackQueryUsed: false,
      catalogProductsReturned: 2,
      catalogVariantsReturned: 2,
      catalogZeroResultAttempts: 0,
      outOfStockProductsExcluded: 0,
      identityProductsExcluded: 0,
      irrelevantProductsExcluded: 0,
      conditionProductsExcluded: 0,
      priceProductsExcluded: 0,
      trustedMerchantProductsReturned: 2,
      unverifiedMerchantProductsReturned: 0,
      unverifiedMerchantProductsExcluded: 0,
      riskyMerchantProductsExcluded: 0,
      merchantTrustRegistryVersion: "test",
      merchantsFailed: 0,
      coveragePercent: 100,
      failedMerchantIds: [],
      timedOutMerchantIds: [],
      registryVersion: "test",
      searchTimeoutMs: 3_000,
      selectionPolicy: "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE"
    },
    questions: [],
    products: [
      {
        merchantId: "death-wish-coffee",
        merchant: "Death Wish Coffee",
        sourceHost: "deathwishcoffee.com",
        merchantTrust: {
          level: "OFFICIAL",
          verification: "INDEPENDENT",
          evidence: ["official domain"]
        },
        recommendationTier: "TRUSTED_OR_AFFILIATE",
        handle: "offer-a",
        title: "Valhalla Java Single-Serve Pods — 10 count",
        brand: "Death Wish Coffee",
        sku: "5094SSC",
        gtins: ["810063341254"],
        variantDimensions: { "Pack Size": "10 count" },
        matchStatus: "EXACT",
        matchEvidence: ["GTIN exact"],
        condition: "NEW",
        itemPrice: { amountCents: 1_499, currency: "USD" },
        availability: "IN_STOCK",
        merchantUrl: "https://deathwishcoffee.com/products/valhalla-java-single-serve-pods",
        checkedAt: "2026-09-03T06:00:00.000Z"
      },
      {
        merchantId: "best-buy",
        merchant: "Best Buy",
        sourceHost: "bestbuy.com",
        merchantTrust: {
          level: "ESTABLISHED_RETAILER",
          verification: "INDEPENDENT",
          evidence: ["established retailer"]
        },
        recommendationTier: "TRUSTED_OR_AFFILIATE",
        handle: "offer-b",
        title: "Valhalla Java Single-Serve Pods — 10 count",
        brand: "Death Wish Coffee",
        sku: "5094SSC",
        gtins: ["810063341254"],
        variantDimensions: { "Pack Size": "10 count" },
        matchStatus: "EXACT",
        matchEvidence: ["GTIN exact"],
        condition: "NEW",
        itemPrice: { amountCents: 1_599, currency: "USD" },
        availability: "IN_STOCK",
        merchantUrl: "https://bestbuy.com/product/valhalla-java-pods",
        checkedAt: "2026-09-03T06:00:00.000Z"
      }
    ]
  })
};

async function connect(now?: () => Date, dependencies: ShoppingServerDependencies = {}) {
  const server = createShoppingServer(shopify, undefined, {
    ...dependencies,
    ...(now === undefined ? {} : { now })
  });
  const client = new Client({ name: "comparison-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

describe("product comparison MCP flow", () => {
  it("builds and re-renders one immutable server comparison", async () => {
    const client = await connect();
    const found = await client.callTool({
      name: "search_products",
      arguments: { query: "Valhalla Java pods", limit: 2 }
    });
    const products = (found.structuredContent as { products: Array<{ selectionId: string }> }).products;
    expect(products).toHaveLength(2);

    const compared = await client.callTool({
      name: "compare_selected_products",
      arguments: {
        selectionIds: products.map((product) => product.selectionId),
        mode: "SAME_PRODUCT_OFFERS",
        responseLocale: "zh-CN"
      }
    });
    expect(compared.structuredContent).toMatchObject({
      status: "OK",
      mode: "SAME_PRODUCT_OFFERS",
      locale: "zh-CN",
      priceBasis: "ITEM_PRICE",
      recommendation: {
        state: "READY",
        recommendedSelectionId: products[0]?.selectionId
      },
      entries: [{ selectionId: products[0]?.selectionId }, { selectionId: products[1]?.selectionId }]
    });
    const comparisonId = (compared.structuredContent as { comparisonId: string }).comparisonId;
    const rendered = await client.callTool({
      name: "render_product_comparison",
      arguments: { comparisonId }
    });
    expect(rendered.structuredContent).toEqual(compared.structuredContent);
  });

  it("quotes same-snapshot selections and compares delivered totals server-side", async () => {
    const checkedAt = "2026-09-03T06:05:00.000Z";
    const expiresAt = "2026-09-03T06:15:00.000Z";
    const quote = vi.fn(async (product: { handle: string }) => {
      const amountCents = product.handle === "offer-a" ? 2_000 : 1_800;
      return {
        status: "ESTIMATED" as const,
        subtotal: { amountCents: product.handle === "offer-a" ? 1_499 : 1_599, currency: "USD" as const },
        shipping: { amountCents: 100, currency: "USD" as const, label: "Standard" },
        tax: {
          status: "SHOPIFY_REPORTED" as const,
          amount: { amountCents: amountCents - (product.handle === "offer-a" ? 1_599 : 1_699), currency: "USD" as const },
          shopifyEstimated: true,
          source: "SHOPIFY_CART" as const
        },
        deliveredPrice: { amountCents, currency: "USD" as const },
        totalEstimated: true,
        checkedAt,
        expiresAt
      };
    });
    const client = await connect(
      () => new Date("2026-09-03T06:05:00.000Z"),
      { cartQuotes: { quote } }
    );
    const found = await client.callTool({
      name: "search_products",
      arguments: { query: "Valhalla Java pods", limit: 2 }
    });
    const products = (found.structuredContent as { products: Array<{ selectionId: string }> }).products;

    const compared = await client.callTool({
      name: "quote_and_compare_selected_products",
      arguments: {
        selectionIds: products.map((product) => product.selectionId),
        zipCode: "10001",
        mode: "SAME_PRODUCT_OFFERS",
        responseLocale: "zh-CN"
      }
    });

    expect(quote).toHaveBeenCalledTimes(2);
    expect(compared.structuredContent).toMatchObject({
      status: "OK",
      priceBasis: "DELIVERED_TOTAL",
      focus: ["DELIVERED_TOTAL"],
      priceDelta: {
        basis: "DELIVERED_TOTAL",
        lowestSelectionId: products[1]?.selectionId,
        highestSelectionId: products[0]?.selectionId,
        amountCents: 200
      },
      recommendation: {
        state: "READY",
        recommendedSelectionId: products[1]?.selectionId
      },
      entries: [
        { selectionId: products[0]?.selectionId, deliveredTotal: { amountCents: 2_000 } },
        { selectionId: products[1]?.selectionId, deliveredTotal: { amountCents: 1_800 } }
      ]
    });
  });

  it("rejects cross-snapshot selection mixing", async () => {
    const client = await connect();
    const first = await client.callTool({ name: "search_products", arguments: { query: "Valhalla Java pods", limit: 2 } });
    const second = await client.callTool({ name: "search_products", arguments: { query: "Valhalla Java pods", limit: 2 } });
    const firstId = (first.structuredContent as { products: Array<{ selectionId: string }> }).products[0]!.selectionId;
    const secondId = (second.structuredContent as { products: Array<{ selectionId: string }> }).products[1]!.selectionId;

    const compared = await client.callTool({
      name: "compare_selected_products",
      arguments: { selectionIds: [firstId, secondId] }
    });
    expect(compared.structuredContent).toMatchObject({
      status: "CROSS_SNAPSHOT_UNSUPPORTED",
      entries: []
    });
  });

  it("rejects unknown and expired selections", async () => {
    let current = new Date("2026-09-03T06:00:00.000Z");
    const client = await connect(() => current);
    const unknown = await client.callTool({
      name: "compare_selected_products",
      arguments: {
        selectionIds: [
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222"
        ]
      }
    });
    expect(unknown.structuredContent).toMatchObject({ status: "SELECTION_UNAVAILABLE", entries: [] });

    const found = await client.callTool({
      name: "search_products",
      arguments: { query: "Valhalla Java pods", limit: 2 }
    });
    const selectionIds = (found.structuredContent as { products: Array<{ selectionId: string }> })
      .products.map((product) => product.selectionId);
    current = new Date("2026-09-03T08:00:00.001Z");
    const expired = await client.callTool({
      name: "compare_selected_products",
      arguments: { selectionIds }
    });
    expect(expired.structuredContent).toMatchObject({ status: "SELECTION_UNAVAILABLE", entries: [] });
  });

  it("ships a safe responsive comparison resource", async () => {
    const client = await connect();
    const resource = await client.readResource({ uri: PRODUCT_COMPARISON_UI_URI });
    const content = resource.contents[0];
    const html = content !== undefined && "text" in content ? content.text : "";

    expect(html).toContain('make("table")');
    expect(html).toContain("position: sticky");
    expect(html).toContain("textContent");
    expect(html).not.toContain("innerHTML");
    expect(html).toContain("render_product_comparison");
    const script = html.match(/<script>([\s\S]*)<\/script>/u)?.[1] ?? "";
    expect(script).toBeDefined();
    expect(() => new Script(script)).not.toThrow();
    expect(content?._meta).toMatchObject({
      ui: { csp: { connectDomains: [] } }
    });
  });

  it("assigns a stable execution-layer code to app render errors", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "render_product_comparison",
      arguments: { comparisonId: "11111111-1111-4111-8111-111111111111" }
    });
    expect(result.isError).toBe(true);
    expect(result._meta).toMatchObject({ "findcheap/errorCode": "TOOL_REQUEST_REJECTED" });
  });
});
