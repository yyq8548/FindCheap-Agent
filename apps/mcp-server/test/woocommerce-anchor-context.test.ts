import { afterEach, describe, expect, it, vi } from "vitest";
import { createUnavailableAwinPort } from "../../../packages/awin-feed/src/index.js";
import { WooProductSchema, WooSearchResultSchema, type WooProduct } from "../../../packages/contracts/src/woocommerce.js";
import { createAffiliateLinkResolver } from "../src/affiliate-links.js";
import { createFindCheapBackend } from "../src/backend.js";
import { createUnavailableDealPort } from "../src/deal-client.js";
import { parseStoredSearchRequest, SearchProductsInputSchema, type SearchProductsInput } from "../src/search-products.js";
import { mergeSearchRequirements } from "../src/search-requirements-context.js";
import type { ProductCardContent } from "../src/server.js";
import { createMemoryWatchStore } from "../src/watch-store.js";
import { createWooProductAnchor } from "../src/woo-product-identity.js";
import type { WooCommerceCatalogPort, WooCommerceProductPort } from "../src/woocommerce-client.js";
import { connectReplay, searchResult } from "./fixtures/conversation-replay-support.js";

// In-memory source evidence verifies server context and read routing, not live merchants.
const checkedAt = new Date().toISOString();
const parentUrl = "https://anchor-shop.example/product/firm";
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map(close => close())); });

function product(variationId?: number, overrides: Partial<WooProduct> = {}): WooProduct {
  return WooProductSchema.parse({ sourceKind: "WOOCOMMERCE_STORE_API", merchantId: "anchor-shop", merchantName: "Anchor Shop",
    sourceHost: "anchor-shop.example", productId: 1000, productType: variationId === undefined ? "simple" : "variation",
    ...(variationId === undefined ? {} : { parentProductId: 1000, variationId }), title: "Firm", category: "serum", condition: "NEW",
    attributes: [], variantDimensions: variationId === undefined ? {} : { Size: ["S", "M"] },
    selectedAttributes: variationId === undefined ? {} : { Size: variationId === 1001 ? "S" : "M" },
    merchantUrl: parentUrl, images: [], itemPrice: { amountCents: 4800, currency: "USD" },
    priceEvidence: { amountMinor: "4800", currency: "USD", currencyMinorUnit: 2,
      scope: variationId === undefined ? "PRODUCT" : "VARIANT", taxBasis: "UNKNOWN" }, availability: "IN_STOCK",
    availabilityScope: variationId === undefined ? "PRODUCT" : "VARIANT", checkedAt, ...overrides });
}
function stored(variationId?: number): SearchProductsInput {
  return parseStoredSearchRequest({ query: "Firm", wooAnchor: createWooProductAnchor(product(variationId),
    variationId === undefined ? parentUrl : `${parentUrl}?variation_id=${variationId}`) });
}

async function connect(variations = false) {
  const originals = variations ? [product(1001), product(1002)] : [product()];
  const other = product(undefined, { productId: 2000, title: "Calm", merchantUrl: "https://anchor-shop.example/product/calm" });
  const search = vi.fn<WooCommerceCatalogPort["search"]>(async input => {
    const target = input.productUrl === undefined ? undefined : new URL(input.productUrl);
    const products = (target?.pathname.endsWith("/calm") ? [other] : originals).filter(item =>
      target?.searchParams.has("variation_id") !== true || String(item.variationId) === target.searchParams.get("variation_id"));
    return WooSearchResultSchema.parse({ source: "WOOCOMMERCE_STORE_API", schemaVersion: 1, registryVersion: "anchor-fixture",
      requestId: "anchor-context", status: "COMPLETE", snapshotAt: checkedAt, products,
      stores: [{ merchantId: "anchor-shop", status: "COMPLETE", requests: 1, returned: products.length }], diagnostics: {
        eligibleStores: 1, plannedStores: 1, attemptedStores: 1, succeededStores: 1, failedStores: 0, skippedStores: 0,
        physicalRequests: 1, responseBytes: 1000, cacheHits: 0, elapsedMs: 1, truncated: false, registryCoverageComplete: true } });
  });
  const inspect = vi.fn<WooCommerceProductPort["inspect"]>(async () => ({ source: "WOOCOMMERCE_STORE_API",
    registryVersion: "anchor-fixture", status: "COMPLETE", products: [originals.at(-1)!], checkedAt, truncated: false }));
  const lookup = vi.fn<WooCommerceProductPort["lookup"]>(async () => { throw new Error("Catalog continuation must not create a watch or quote"); });
  const backend = createFindCheapBackend({ catalog: { shopify: { search: async () => searchResult([]) },
    awin: createUnavailableAwinPort(), woocommerce: { search } }, product: { affiliateLinks: createAffiliateLinkResolver(),
    woocommerceProducts: { inspect, lookup } }, deals: createUnavailableDealPort(), verifiedDeals: false, watches: createMemoryWatchStore() });
  const replay = await connectReplay(async () => searchResult([]), { backend, now: () => new Date(checkedAt) });
  closers.push(async () => { await replay.close(); expect(lookup).not.toHaveBeenCalled(); });
  const initialUrl = variations ? `${parentUrl}?variation_id=1001` : parentUrl;
  const begin = async () => {
    const result = await replay.client.callTool({ name: "search_products", arguments: { query: initialUrl } });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    const snapshot = result.structuredContent as ProductCardContent;
    expect(snapshot.products).toHaveLength(1);
    expect(snapshot.products[0]).toMatchObject({ sourceKind: "WOOCOMMERCE_STORE_API", handle: variations ? "1001" : "1000" });
    return snapshot;
  };
  return { ...replay, search, inspect, begin, initialUrl, originals };
}

describe("trusted Woo URL requirement context", () => {
  it.each(["Firm", parentUrl])("retains the server anchor when continuing with %s", query => {
    const previous = stored();
    const copy = structuredClone(previous);
    const next = mergeSearchRequirements(SearchProductsInputSchema.parse({ query, contextMode: "CONTINUE_PREVIOUS_PRODUCT",
      maxItemPriceCents: 5000 }), previous);
    expect(next).toMatchObject({ query: "Firm", maxItemPriceCents: 5000, wooAnchor: previous.wooAnchor });
    next.wooAnchor!.selectedAttributes.Size = "injected";
    expect(previous).toEqual(copy);
  });
  it.each(["NEW_PRODUCT", "CORRECT_PREVIOUS_PRODUCT"] as const)("clears the old anchor for %s", contextMode => {
    const previous = stored();
    const current = { ...SearchProductsInputSchema.parse({ query: "Calm", contextMode }), wooAnchor: previous.wooAnchor! };
    expect(mergeSearchRequirements(current, previous).wooAnchor).toBeUndefined();
    expect(previous.wooAnchor).toBeDefined();
  });
  it("never lets submitted internal data replace the trusted previous anchor", () => {
    const previous = stored(1001);
    const current = { ...SearchProductsInputSchema.parse({ query: "Firm", contextMode: "CONTINUE_PREVIOUS_PRODUCT" }),
      wooAnchor: stored(1002).wooAnchor! };
    expect(mergeSearchRequirements(current, previous).wooAnchor).toEqual(previous.wooAnchor);
    expect(SearchProductsInputSchema.safeParse(current).success).toBe(false);
    expect(() => mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "https://other.example/product/firm",
      contextMode: "CONTINUE_PREVIOUS_PRODUCT" }), previous)).toThrow("PRODUCT_CONTEXT_CONFLICT");
  });
});

describe("Woo anchor through registered MCP snapshot tools", () => {
  it.each(["TITLE", "URL"] as const)("keeps URL selection across %s continuation and preserves its old snapshot", async mode => {
    const harness = await connect();
    const original = await harness.begin();
    harness.search.mockClear();
    const continued = await harness.client.callTool({ name: "search_products", arguments: {
      query: mode === "TITLE" ? "Firm" : parentUrl, contextMode: "CONTINUE_PREVIOUS_PRODUCT",
      parentRenderId: original.renderId, maxItemPriceCents: 5000 } });
    expect(continued.isError, JSON.stringify(continued.content)).not.toBe(true);
    const child = continued.structuredContent as ProductCardContent;
    expect(child.products).toHaveLength(1);
    expect(child.products[0]).toMatchObject({ sourceKind: "WOOCOMMERCE_STORE_API", handle: "1000" });
    expect(child.goalId).toBe(original.goalId);
    expect(child.renderId).not.toBe(original.renderId);
    expect(harness.search).toHaveBeenCalled();
    expect(harness.search.mock.calls.every(([input]) => input.productUrl === parentUrl)).toBe(true);
    const oldAgain = await harness.client.callTool({ name: "render_product_cards", arguments: { renderId: original.renderId } });
    expect((oldAgain.structuredContent as ProductCardContent).products).toEqual(original.products);
  });
  it("rejects a client-supplied anchor before any source request", async () => {
    const harness = await connect();
    const result = await harness.client.callTool({ name: "search_products", arguments: { query: "Firm", wooAnchor: stored().wooAnchor } });
    expect(result.isError).toBe(true);
    expect(harness.search).not.toHaveBeenCalled();
  });
  it("clears the anchor for correction to another product and for a new independent search", async () => {
    const harness = await connect();
    const original = await harness.begin();
    harness.search.mockClear();
    const corrected = await harness.client.callTool({ name: "search_products", arguments: {
      query: "https://anchor-shop.example/product/calm", contextMode: "CORRECT_PREVIOUS_PRODUCT", parentRenderId: original.renderId } });
    expect(corrected.isError, JSON.stringify(corrected.content)).not.toBe(true);
    expect((corrected.structuredContent as ProductCardContent).products[0]).toMatchObject({ handle: "2000", title: "Calm" });
    expect(harness.search.mock.calls.every(([input]) => input.productUrl === "https://anchor-shop.example/product/calm")).toBe(true);
    harness.search.mockClear();
    const fresh = await harness.client.callTool({ name: "search_products", arguments: { query: "Firm", contextMode: "NEW_PRODUCT" } });
    expect(fresh.isError).not.toBe(true);
    expect(harness.search).toHaveBeenCalled();
    expect(harness.search.mock.calls.every(([input]) => input.productUrl === undefined)).toBe(true);
  });
  it("pins the inspected child even when the source permalink omits variation_id", async () => {
    const harness = await connect(true);
    const original = await harness.begin();
    const inspected = await harness.client.callTool({ name: "inspect_selected_product", arguments: { renderId: original.renderId,
      selectionId: original.products[0]!.selectionId, variantDimensions: { Size: "M" } } });
    expect(inspected.isError, JSON.stringify(inspected.content)).not.toBe(true);
    const next = (inspected.structuredContent as { updatedSnapshot: ProductCardContent }).updatedSnapshot;
    expect(next.products[0]).toMatchObject({ handle: "1002", variantDimensions: { Size: "M" } });
    harness.search.mockClear();
    const continued = await harness.client.callTool({ name: "search_products", arguments: { query: "Firm",
      contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: next.renderId } });
    expect(continued.isError, JSON.stringify(continued.content)).not.toBe(true);
    expect((continued.structuredContent as ProductCardContent).products.map(item => item.handle)).toEqual(["1002"]);
    expect(harness.search.mock.calls.every(([input]) => input.productUrl === `${parentUrl}?variation_id=1002`)).toBe(true);
    const oldAgain = await harness.client.callTool({ name: "render_product_cards", arguments: { renderId: original.renderId } });
    expect((oldAgain.structuredContent as ProductCardContent).products).toEqual(original.products);
  });
  it("keeps a family anchor when inspection returns several unselected children", async () => {
    const harness = await connect(true);
    harness.inspect.mockResolvedValue({ source: "WOOCOMMERCE_STORE_API", registryVersion: "anchor-fixture", status: "COMPLETE",
      products: harness.originals, checkedAt, truncated: false });
    const original = await harness.begin();
    const inspected = await harness.client.callTool({ name: "inspect_selected_product", arguments: { renderId: original.renderId,
      selectionId: original.products[0]!.selectionId } });
    expect(inspected.isError).not.toBe(true);
    const next = (inspected.structuredContent as { updatedSnapshot: ProductCardContent }).updatedSnapshot;
    expect(next.products).toHaveLength(2);
    harness.search.mockClear();
    const continued = await harness.client.callTool({ name: "search_products", arguments: { query: "Firm",
      contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: next.renderId } });
    expect(continued.isError, JSON.stringify(continued.content)).not.toBe(true);
    expect(harness.search.mock.calls.every(([input]) => input.productUrl === parentUrl)).toBe(true);
  });
  it.each(["merchant", "product"])("rejects a source inspection that switches the %s", async changed => {
    const harness = await connect(true);
    const original = await harness.begin();
    harness.inspect.mockResolvedValue({ source: "WOOCOMMERCE_STORE_API", registryVersion: "anchor-fixture", status: "COMPLETE", checkedAt,
      truncated: false, products: [product(1002, changed === "merchant" ? { merchantId: "foreign-shop" }
        : { productId: 2000, parentProductId: 2000 })] });
    const result = await harness.client.callTool({ name: "inspect_selected_product", arguments: { renderId: original.renderId,
      selectionId: original.products[0]!.selectionId } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("INSPECTION_SOURCE_UNAVAILABLE");
    const oldAgain = await harness.client.callTool({ name: "render_product_cards", arguments: { renderId: original.renderId } });
    expect((oldAgain.structuredContent as ProductCardContent).products).toEqual(original.products);
  });
});
