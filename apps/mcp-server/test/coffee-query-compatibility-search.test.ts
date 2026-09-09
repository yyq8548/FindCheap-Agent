import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUnavailableAwinPort } from "../../../packages/awin-feed/src/index.js";
import { createAffiliateLinkResolver } from "../src/affiliate-links.js";
import { createFindCheapBackend } from "../src/backend.js";
import { parseCoffeeCompatibilityQuery } from "../src/coffee-category.js";
import { createUnavailableDealPort } from "../src/deal-client.js";
import { requestedCoffeeCategory, resolveSearchIntent } from "../src/search-products.js";
import { createShopifyGlobalCatalogPort } from "../src/shopify-global-catalog-client.js";
import { createShopifySelectedProductInspector } from "../src/shopify-selected-product.js";
import type { ProductCardContent, ShopifyPort } from "../src/server.js";
import { createMemoryWatchStore } from "../src/watch-store.js";
import type { WooCommerceCatalogPort } from "../src/woocommerce-client.js";
import { connectReplay, product, REPLAY_NOW, searchResult } from "./fixtures/conversation-replay-support.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/coffee-category/shopify-capsule-sample.json", import.meta.url), "utf8")) as {
  observedAt: string; response: unknown;
};
const nativeInput = { query: "Nespresso Original compatible coffee capsules", productType: "coffee capsules",
  requiredFeatures: ["Nespresso Original compatible"], excludedFeatures: ["loose ground coffee"], maxItemPriceCents: 4000,
  responseLocale: "zh-CN", contextMode: "NEW_PRODUCT", limit: 8, selectionMode: "MERCHANT_DIVERSE" };

afterEach(() => { vi.unstubAllGlobals(); });

describe("coffee compatibility query keeps machine systems separate from capsule identity", () => {
  it.each(["Nespresso Original compatible coffee capsules", "coffee capsules compatible with Nespresso Original",
    "compatible with Nespresso Original coffee capsules", "coffee capsules for Nespresso Original",
    "Nespresso Original-compatible coffee capsules", "兼容Nespresso Original的咖啡胶囊"])(
    "recognizes only the full category and compatibility relation: %s", query => {
      expect(parseCoffeeCompatibilityQuery(query)).toEqual({ category: "PODS", categoryQuery: "coffee capsules", system: "NESPRESSO_ORIGINAL" });
      expect(resolveSearchIntent({ query, comparisonMode: "DISCOVERY", brandMode: "REQUIRED" })).toBe("CATEGORY_DISCOVERY");
      expect(requestedCoffeeCategory({ query, productType: "coffee" })).toBe("PODS");
      expect(resolveSearchIntent({ query, comparisonMode: "SAME_PRODUCT", brandMode: "REQUIRED" })).toBe("EXACT_PRODUCT");
    });

  it.each(["Nespresso Original coffee capsules", "Lavazza Espresso Maestro Nespresso Original compatible coffee capsules",
    "Nespresso Original compatible coffee capsules Acme", "Acme coffee capsules compatible with Nespresso Original",
    "Nespresso Original compatible coffee capsules SKU ABC123", "Nespresso Original compatible coffee capsules 8000070053570",
    "Nespresso Original compatible and organic coffee capsules", "Nespresso Original compatible or organic coffee capsules",
    "coffee capsules compatible with Nespresso Original or Vertuo", "coffee capsules compatible with Nespresso Original and Vertuo"])(
    "does not strip named products, identifiers or compound requirements: %s", query => {
      expect(parseCoffeeCompatibilityQuery(query)).toBeUndefined();
      expect(resolveSearchIntent({ query, comparisonMode: "DISCOVERY", brandMode: "REQUIRED" })).toBe("EXACT_PRODUCT");
    });

  it.each([
    { query: nativeInput.query, requirement: "Nespresso Original compatible" },
    { query: "coffee capsules compatible with Nespresso Original", requirement: "Compatible with Nespresso Original" }
  ])("retains real saved Catalog research candidates through public MCP for $query", async ({ query, requirement }) => {
    // Saved observations are replay evidence, never current prices or native host acceptance.
    const catalog = createShopifyGlobalCatalogPort({ SHOPIFY_AGENT_PROFILE_URL: "https://example.com/profile.json" }, {
      fetch: async () => Response.json(fixture.response), clock: { now: () => new Date(fixture.observedAt) }
    });
    const shopify = { search: vi.fn<ShopifyPort["search"]>((...args) => catalog.search(...args)) };
    const awin = createUnavailableAwinPort();
    const awinSearch = vi.spyOn(awin, "search");
    const wooSearch = vi.fn<WooCommerceCatalogPort["search"]>(async () => { throw new Error("DATA_SOURCE_UNAVAILABLE"); });
    const backend = createFindCheapBackend({ catalog: { awin, shopify, woocommerce: { search: wooSearch } },
      product: { affiliateLinks: createAffiliateLinkResolver() }, deals: createUnavailableDealPort(), verifiedDeals: false,
      watches: createMemoryWatchStore() });
    const replay = await connectReplay(shopify.search, { backend, now: () => new Date(fixture.observedAt) });
    try {
      const input = { ...nativeInput, query, requiredFeatures: [requirement] };
      const response = await replay.client.callTool({ name: "search_products", arguments: input });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const snapshot = response.structuredContent as ProductCardContent;
      expect.soft(snapshot.searchIntent).toBe("CATEGORY_DISCOVERY");
      expect.soft(snapshot.products.length).toBeGreaterThan(0);
      expect(snapshot.requirementsSummary).toMatchObject({ productType: input.productType, maxItemPriceCents: 4000,
        requiredFeatures: [requirement], excludedFeatures: ["loose ground coffee"] });
      expect(snapshot.recommendation?.primarySelectionId).toBeUndefined();
      expect(snapshot.sources).toMatchObject({ awin: "UNAVAILABLE", woocommerce: "UNAVAILABLE" });
      expect(shopify.search).toHaveBeenCalled();
      expect(awinSearch).toHaveBeenCalled();
      expect(wooSearch).toHaveBeenCalled();
      expect.soft(shopify.search.mock.calls.every(([request]) => /^coffee (?:capsules|pods)$/u.test(request.query ?? ""))).toBe(true);
      expect.soft(awinSearch.mock.calls.every(([request]) => /^coffee (?:capsules|pods)$/u.test(request.query)),
        JSON.stringify(awinSearch.mock.calls.map(([request]) => request.query))).toBe(true);
      expect.soft(wooSearch.mock.calls.every(([request]) => request.query === "coffee" && request.productType === input.productType && request.maxItemPriceCents === 4000),
        JSON.stringify(wooSearch.mock.calls.map(([request]) => request.query))).toBe(true);
      for (const card of snapshot.products) {
        // The saved Midtown description explicitly says L'OR BARISTA only.
        // A OneCUP brand or ordinary description alone remains UNKNOWN.
        expect(card.title).not.toMatch(/Midtown/iu);
        expect(card.itemPrice?.amountCents).toBeLessThanOrEqual(4000);
        expect(card.requirementAssessment?.entries).toContainEqual(expect.objectContaining({ requirement, status: "UNKNOWN" }));
      }
      const followup = await replay.client.callTool({ name: "search_products", arguments: {
        query, maxItemPriceCents: 100, contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: snapshot.renderId
      } });
      expect(followup.isError, JSON.stringify(followup.content)).not.toBe(true);
      expect(followup.structuredContent).toMatchObject({ goalId: snapshot.goalId, products: [],
        requirementsSummary: { maxItemPriceCents: 100, requiredFeatures: [requirement], excludedFeatures: ["loose ground coffee"] } });
      const old = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: snapshot.renderId } });
      expect(old.structuredContent).toMatchObject({ products: snapshot.products, requirementsSummary: snapshot.requirementsSummary });
      const history = await replay.client.callTool({ name: "get_shopping_history", arguments: {} });
      expect(history.structuredContent).toMatchObject({ searches: expect.arrayContaining([
        expect.objectContaining({ renderId: snapshot.renderId, query, requirements: snapshot.requirementsSummary })
      ]) });
    } finally { await replay.close(); }
  });

  it("keeps an explicit capsule brand, budget and selected-system conflicts as hard gates", async () => {
    const base = { merchantId: "coffee-fixture", merchant: "Coffee Fixture", sourceHost: "example.com",
      title: "Acme Coffee Capsules", productType: "coffee capsules", brand: "Acme", handle: "capsules",
      merchantUrl: "https://example.com/products/capsules", variantDimensions: { System: "Nespresso Original" },
      itemPrice: { amountCents: 1200, currency: "USD" as const } };
    const selected = [product(base), product({ ...base, handle: "other-brand", brand: "Other", title: "Other Coffee Capsules",
      merchantUrl: "https://example.com/products/other-brand" }),
    product({ ...base, handle: "vertuo", merchantUrl: "https://example.com/products/vertuo", variantDimensions: { System: "Nespresso Vertuo" } }),
    product({ ...base, handle: "over-budget", merchantUrl: "https://example.com/products/over-budget", itemPrice: { amountCents: 4001, currency: "USD" } })];
    const search = vi.fn<ShopifyPort["search"]>(async () => searchResult(selected));
    const replay = await connectReplay(search);
    try {
      const response = await replay.client.callTool({ name: "search_products", arguments: { ...nativeInput, brand: "Acme", brandMode: "REQUIRED" } });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const snapshot = response.structuredContent as ProductCardContent;
      expect(snapshot.searchIntent).toBe("CATEGORY_DISCOVERY");
      expect(snapshot.products.map(card => card.handle)).toEqual(["capsules"]);
      expect(snapshot.requirementsSummary).toMatchObject({ brand: "Acme", maxItemPriceCents: 4000,
        requiredFeatures: nativeInput.requiredFeatures, excludedFeatures: nativeInput.excludedFeatures });
      expect(search.mock.calls.every(([request]) => request.query === "Acme coffee capsules")).toBe(true);
    } finally { await replay.close(); }
  });

  it.each(["Nespresso Original", "Nespresso Vertuo"])("preserves the original compatibility requirement during real JSON inspection of %s", async system => {
    // Synthetic variants exercise the real merchant JSON inspector without live requests.
    const canonicalUrl = "https://coffee-fixture.example/products/capsules";
    const source = product({ title: "Coffee Capsules", productType: "coffee capsules", brand: "Acme", handle: "1001",
      merchantId: "coffee-fixture", merchant: "Coffee Fixture", sourceHost: "coffee-fixture.example",
      variantDimensions: { System: "Select system" }, merchantUrl: `${canonicalUrl}?variant=1001` });
    const fetchProduct = vi.fn(async (url: string, allowedHost: string) => {
      expect(url).toBe(`${canonicalUrl}.js`);
      expect(allowedHost).toBe("coffee-fixture.example");
      return { finalUrl: url, response: Response.json({ currency: "USD", title: "Coffee Capsules", handle: "capsules", vendor: "Acme",
        options: [{ name: "System", position: 1, values: ["Select system", "Nespresso Original", "Nespresso Vertuo"] }],
        variants: [
          { id: 1001, title: "Select system", available: true, price: 1200, options: ["Select system"] },
          { id: 1002, title: "Nespresso Original", available: true, price: 1300, options: ["Nespresso Original"] },
          { id: 1003, title: "Nespresso Vertuo", available: true, price: 1400, options: ["Nespresso Vertuo"] }
        ] }) };
    });
    const inspector = createShopifySelectedProductInspector({ fetchProduct, clock: { now: () => REPLAY_NOW } });
    const replay = await connectReplay(async () => searchResult([source]), { selectedProducts: inspector });
    try {
      const initial = await replay.client.callTool({ name: "search_products", arguments: nativeInput });
      expect(initial.isError, JSON.stringify(initial.content)).not.toBe(true);
      const snapshot = initial.structuredContent as ProductCardContent;
      expect(snapshot.products).toHaveLength(1);
      expect(snapshot.recommendation?.primarySelectionId).toBeUndefined();
      const inspected = await replay.client.callTool({ name: "inspect_selected_product", arguments: {
        renderId: snapshot.renderId, selectionId: snapshot.products[0]!.selectionId, variantDimensions: { System: system }
      } });
      expect(inspected.isError, JSON.stringify(inspected.content)).not.toBe(true);
      expect(fetchProduct).toHaveBeenCalledOnce();
      if (system === "Nespresso Vertuo") {
        expect(inspected.structuredContent).toMatchObject({ status: "NO_MATCHING_VARIANT", variants: [] });
      } else {
        expect(inspected.structuredContent).toMatchObject({ status: "OK", updatedSnapshot: {
          requirementsSummary: snapshot.requirementsSummary, products: [{ handle: "1002", variantDimensions: { System: system },
            coffeeCompatibility: { status: "MATCHED" }, itemPrice: { amountCents: 1300, currency: "USD" },
            requirementAssessment: { entries: expect.arrayContaining([expect.objectContaining({ requirement: nativeInput.requiredFeatures[0], status: "MATCHED" })]) } }]
        } });
      }
      const old = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: snapshot.renderId } });
      expect((old.structuredContent as ProductCardContent).products).toEqual(snapshot.products);
    } finally { await replay.close(); }
  });
});
