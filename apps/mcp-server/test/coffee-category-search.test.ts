import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedMerchantTrustRecordSchema } from "../../../packages/contracts/src/merchant-trust-registry.js";
import { WooProductSchema, WooSearchResultSchema, type WooProduct } from "../../../packages/contracts/src/woocommerce.js";
import { createUnavailableAwinPort } from "../../../packages/awin-feed/src/index.js";
import { createAffiliateLinkResolver } from "../src/affiliate-links.js";
import { createFindCheapBackend } from "../src/backend.js";
import { createUnavailableDealPort } from "../src/deal-client.js";
import { replaceManagedMerchantTrustRecords, resetManagedMerchantTrustRecords } from "../src/merchant-trust.js";
import { parseStoredSearchRequest, woocommerceCandidate } from "../src/search-products.js";
import type { ProductCardContent } from "../src/server.js";
import { createMemoryWatchStore } from "../src/watch-store.js";
import { createWooProductAnchor } from "../src/woo-product-identity.js";
import type { WooCommerceCatalogPort } from "../src/woocommerce-client.js";
import { connectReplay, searchResult } from "./fixtures/conversation-replay-support.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/coffee-category/woo-coffee-sample.json", import.meta.url), "utf8")) as {
  schemaVersion: number;
  response: unknown;
  supplementaryProducts: Array<{ product: unknown }>;
  merchantTrustRecords: unknown[];
};
const observed = WooSearchResultSchema.parse(fixture.response);
const products = [...observed.products, ...fixture.supplementaryProducts.map(row => WooProductSchema.parse(row.product))];
const wholeBean = products.find(product => product.merchantId === "abednego-coffee-roasters" && product.productId === 1101)!;
const trusted = fixture.merchantTrustRecords.map(record => ManagedMerchantTrustRecordSchema.parse(record));
afterEach(() => { resetManagedMerchantTrustRecords(); vi.unstubAllGlobals(); });

async function connectCoffee(selected: WooProduct[] = products, literalQuery = false) {
  replaceManagedMerchantTrustRecords(trusted);
  const search = vi.fn<WooCommerceCatalogPort["search"]>(async input => {
    // The real merchants returned [] for the over-constrained literal phrase.
    // Other cases supply the same saved products to isolate downstream gates.
    const returned = literalQuery && input.query !== "coffee" ? [] : selected;
    const merchantIds = [...new Set(returned.map(product => product.merchantId))];
    return WooSearchResultSchema.parse({ ...observed, products: structuredClone(returned), status: "COMPLETE",
      stores: merchantIds.map(merchantId => ({ merchantId, status: "COMPLETE", requests: 0,
        returned: returned.filter(product => product.merchantId === merchantId).length })),
      diagnostics: { eligibleStores: 200, plannedStores: merchantIds.length, attemptedStores: 0, succeededStores: merchantIds.length,
        failedStores: 0, skippedStores: 200 - merchantIds.length, physicalRequests: 0, responseBytes: 0, cacheHits: 1,
        elapsedMs: 0, truncated: false, registryCoverageComplete: false } });
  });
  const shopify = { search: async () => searchResult([]) };
  const backend = createFindCheapBackend({ catalog: { awin: createUnavailableAwinPort(), shopify, woocommerce: { search } },
    product: { affiliateLinks: createAffiliateLinkResolver() }, deals: createUnavailableDealPort(), verifiedDeals: false,
    watches: createMemoryWatchStore() });
  return { ...await connectReplay(shopify.search, { backend, now: () => new Date(observed.snapshotAt) }), search };
}

const discovery = { query: "coffee beans", productType: "whole bean coffee", maxItemPriceCents: 10000,
  responseLocale: "zh-CN", limit: 8, contextMode: "NEW_PRODUCT", selectionMode: "MERCHANT_DIVERSE" };
function assertWholeBeans(snapshot: ProductCardContent) {
  expect(snapshot.products.some(product => product.merchantUrl === wholeBean.merchantUrl)).toBe(true);
  expect(snapshot.products.every(product => /whole bean/iu.test(product.title))).toBe(true);
  expect(snapshot.products.some(product => /sock|sweatshirt|honey|guide|ground/iu.test(product.title))).toBe(false);
  expect(snapshot.products.every(product => product.itemPrice !== undefined && product.itemPrice.amountCents <= 10000)).toBe(true);
}

describe("real Woo coffee category observations through registered MCP", () => {
  it("uses coffee for Woo retrieval without replacing the required whole-bean product type", async () => {
    const replay = await connectCoffee(products, true);
    try {
      const response = await replay.client.callTool({ name: "search_products", arguments: discovery });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      expect(replay.search.mock.calls.length).toBeGreaterThan(0);
      expect(replay.search.mock.calls.length).toBeLessThanOrEqual(2);
      expect.soft(replay.search.mock.calls.every(([input]) => input.query === "coffee")).toBe(true);
      expect(replay.search.mock.calls.every(([input]) => input.productType === "whole bean coffee" && input.maxItemPriceCents === 10000)).toBe(true);
      assertWholeBeans(response.structuredContent as ProductCardContent);
    } finally { await replay.close(); }
  });

  it("compiles a useful bounded query while preserving the user's narrowed type and budget", async () => {
    const replay = await connectCoffee(products, true);
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: {
        query: "coffee", productType: "coffee", maxItemPriceCents: 10000, responseLocale: "zh-CN", limit: 8,
        contextMode: "NEW_PRODUCT", selectionMode: "MERCHANT_DIVERSE"
      } });
      expect(first.isError, JSON.stringify(first.content)).not.toBe(true);
      const original = first.structuredContent as ProductCardContent;
      replay.search.mockClear();
      const next = await replay.client.callTool({ name: "search_products", arguments: { ...discovery,
        contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: original.renderId,
        requiredFeatures: ["Ships to the United States"] } });
      expect(next.isError, JSON.stringify(next.content)).not.toBe(true);
      const narrowed = next.structuredContent as ProductCardContent;
      expect(narrowed).toMatchObject({ goalId: original.goalId,
        requirementsSummary: { productType: "whole bean coffee", maxItemPriceCents: 10000,
          requiredFeatures: ["Ships to the United States"] } });
      expect(replay.search.mock.calls.length).toBeGreaterThan(0);
      expect(replay.search.mock.calls.length).toBeLessThanOrEqual(2);
      expect.soft(replay.search.mock.calls.every(([input]) => input.query === "coffee")).toBe(true);
      expect(replay.search.mock.calls.every(([input]) => input.productType === "whole bean coffee" && input.maxItemPriceCents === 10000)).toBe(true);
      expect(replay.search.mock.calls.every(([input]) => Object.keys(input.requirements ?? {}).length === 0)).toBe(true);
      assertWholeBeans(narrowed);
      expect(narrowed.recommendation?.primarySelectionId).toBeUndefined();
    } finally { await replay.close(); }
  });

  it("keeps real beans as candidates but does not award a primary when US delivery is unknown", async () => {
    const replay = await connectCoffee([wholeBean]);
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: discovery });
      expect(first.isError, JSON.stringify(first.content)).not.toBe(true);
      const original = first.structuredContent as ProductCardContent;
      expect(original.products.some(product => product.merchantUrl === wholeBean.merchantUrl)).toBe(true);
      expect(original.recommendation?.state).toBe("READY");
      const next = await replay.client.callTool({ name: "search_products", arguments: {
        query: "coffee beans", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: original.renderId,
        requiredFeatures: ["Ships to the United States"] } });
      expect(next.isError, JSON.stringify(next.content)).not.toBe(true);
      const constrained = next.structuredContent as ProductCardContent;
      assertWholeBeans(constrained);
      expect(constrained.requirementsSummary).toMatchObject({ productType: "whole bean coffee", maxItemPriceCents: 10000 });
      expect(constrained.recommendation?.state).not.toBe("READY");
      expect(constrained.recommendation?.primarySelectionId).toBeUndefined();
      for (const product of constrained.products) {
        expect(product.requirementAssessment?.entries).toContainEqual(expect.objectContaining({
          requirement: "Ships to the United States", status: "UNKNOWN", scope: "DELIVERY_MARKET", source: "MISSING" }));
      }
      const cheaper = await replay.client.callTool({ name: "search_products", arguments: {
        query: "coffee beans", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: constrained.renderId,
        maxItemPriceCents: 200 } });
      expect(cheaper.isError, JSON.stringify(cheaper.content)).not.toBe(true);
      expect(cheaper.structuredContent).toMatchObject({ goalId: original.goalId,
        requirementsSummary: { productType: "whole bean coffee", maxItemPriceCents: 200,
          requiredFeatures: ["Ships to the United States"] }, products: [] });
    } finally { await replay.close(); }
  });

  it.each([
    { label: "coffee socks", merchantId: "cafe-du-monde", productId: 231369 },
    { label: "coffee book", merchantId: "barrington-coffee", productId: 200226 },
    { label: "coffee blossom honey", merchantId: "barrington-coffee", productId: 226458 },
    { label: "coffee sweatshirt", merchantId: "cips-coffee-roasters", productId: 2687 },
    { label: "ground coffee", merchantId: "abednego-coffee-roasters", productId: 979 }
  ])("excludes $label without hiding the true whole-bean positive", async ({ merchantId, productId }) => {
    const wrongProduct = products.find(product => product.merchantId === merchantId && product.productId === productId)!;
    expect(wrongProduct).toBeDefined();
    expect(wrongProduct.availability).toBe("IN_STOCK");
    expect(wrongProduct.itemPrice?.amountCents).toBeLessThanOrEqual(10000);
    const replay = await connectCoffee([wholeBean, wrongProduct]);
    try {
      const response = await replay.client.callTool({ name: "search_products", arguments: discovery });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const snapshot = response.structuredContent as ProductCardContent;
      expect(snapshot.products.some(product => product.merchantUrl === wholeBean.merchantUrl)).toBe(true);
      expect(snapshot.products.some(product => product.merchantUrl === wrongProduct.merchantUrl)).toBe(false);
      expect(snapshot.products.find(product => product.merchantUrl === wholeBean.merchantUrl)?.itemPrice).toEqual(wholeBean.itemPrice);
    } finally { await replay.close(); }
  });
});

// Synthetic selected-variant counterexamples derived from the real whole-bean
// DTO. IDs, selection, title/description and option lists below are deliberate
// test mutations, never claims about an actual merchant variant or API response.
function syntheticCoffeeVariant(overrides: Partial<WooProduct>): WooProduct {
  return WooProductSchema.parse({ ...wholeBean, productType: "variation", parentProductId: wholeBean.productId,
    variationId: 9000001, merchantUrl: `${wholeBean.merchantUrl}?variation_id=9000001`,
    availabilityScope: "VARIANT", priceEvidence: { ...wholeBean.priceEvidence, scope: "VARIANT" },
    ...overrides });
}

describe("synthetic selected-form regressions using saved Woo evidence", () => {
  it("rejects selected Ground even when the parent-derived title says Whole Bean", async () => {
    const selected = syntheticCoffeeVariant({ selectedAttributes: { Grind: "Ground" },
      variantDimensions: { Grind: ["Whole Bean", "Ground"] }, attributes: ["Grind: Whole Bean", "Grind: Ground"],
      description: "Synthetic parent offers whole bean and ground; selected child is Ground." });
    expect(selected.title).toBe(wholeBean.title);
    expect(selected.itemPrice).toEqual(wholeBean.itemPrice);
    const replay = await connectCoffee([selected]);
    try {
      const response = await replay.client.callTool({ name: "search_products", arguments: discovery });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      expect(replay.search).toHaveBeenCalled();
      const snapshot = response.structuredContent as ProductCardContent;
      expect(snapshot.products).toEqual([]);
      expect(snapshot.recommendation?.primarySelectionId).toBeUndefined();
    } finally { await replay.close(); }
  });

  it.each<{ label: string; title: string; selectedAttributes: Record<string, string> }>([
    { label: "missing selected grind", title: "House Blend Coffee", selectedAttributes: {} },
    { label: "unrecognized selected grind despite a whole-bean title", title: wholeBean.title,
      selectedAttributes: { Grind: "Select a grind" } }
  ])("keeps $label unverified through MCP and an exact URL anchor", async ({ title, selectedAttributes }) => {
    const selected = syntheticCoffeeVariant({ title, selectedAttributes,
      variantDimensions: { Grind: ["Whole Bean", "Ground"] }, attributes: ["Grind: Whole Bean", "Grind: Ground"],
      description: "Synthetic parent offers whole bean or ground; no recognized child grind evidence." });
    const replay = await connectCoffee([selected]);
    try {
      const response = await replay.client.callTool({ name: "search_products", arguments: discovery });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const snapshot = response.structuredContent as ProductCardContent;
      expect(snapshot.products).toHaveLength(1);
      expect(snapshot.products[0]).toMatchObject({ handle: "9000001", requestIdentityStatus: "NEEDS_VERIFICATION",
        itemPrice: wholeBean.itemPrice });
      expect(snapshot.recommendation?.state).not.toBe("READY");
      expect(snapshot.recommendation?.primarySelectionId).toBeUndefined();

      // A URL proves which offer was read. It cannot prove that offer's grind.
      const input = parseStoredSearchRequest({ ...discovery, wooAnchor: createWooProductAnchor(selected) });
      expect(input.wooAnchor?.variationId).toBe(9000001);
      const anchored = woocommerceCandidate(selected, input, "EXACT_PRODUCT", input.query,
        new Set(), new Set(), new Set(), new Set());
      expect(anchored).toBeDefined();
      expect(anchored?.requestIdentityStatus).toBe("NEEDS_VERIFICATION");
      expect(anchored?.identityEvidence).not.toContain("source-verified requested WooCommerce product URL and identity");
      expect(anchored?.woocommerceProduct).toEqual(selected);
    } finally { await replay.close(); }
  });
});
