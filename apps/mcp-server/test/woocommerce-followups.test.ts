import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUnavailableAwinPort } from "../../../packages/awin-feed/src/index.js";
import { WooProductSchema, WooSearchResultSchema, type WooProduct } from "../../../packages/contracts/src/woocommerce.js";
import { createAffiliateLinkResolver } from "../src/affiliate-links.js";
import { createFindCheapBackend } from "../src/backend.js";
import { createUnavailableDealPort } from "../src/deal-client.js";
import { createShoppingServer, PRODUCT_SELECTION_SNAPSHOT_TTL_MS, type ProductCardContent } from "../src/server.js";
import { createMemoryWatchStore } from "../src/watch-store.js";
import type { WooCommerceProductPort } from "../src/woocommerce-client.js";
import { product as shopifyFixture, searchResult } from "./fixtures/conversation-replay-support.js";

// In-memory SDK transport exercises registered MCP tools. Synthetic source fixtures
// are not live merchant evidence, actual Codex host acceptance, or real Automation scheduling.
const checkedAt = "2026-09-08T15:34:17.000Z";
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map(close => close())); vi.unstubAllGlobals(); });
type Snapshot = ProductCardContent & { renderId: string; goalId: string; goalRevision: number };

function woo(merchantId = "woo-one", amountCents = 2200, variationId = 1001): WooProduct {
  return WooProductSchema.parse({ sourceKind: "WOOCOMMERCE_STORE_API", merchantId, merchantName: merchantId,
    sourceHost: `${merchantId}.example`, productId: 1000, parentProductId: 1000, variationId,
    productType: "variation", title: "Black mechanical keyboard", category: "mechanical keyboard", condition: "NEW",
    attributes: ["ANSI layout"], variantDimensions: { Color: ["Black", "White"], Layout: ["ANSI", "ISO"] },
    selectedAttributes: { Color: "Black", Layout: "ANSI" },
    merchantUrl: `https://${merchantId}.example/product/keyboard?attribute_color=black&attribute_layout=ansi`, images: [],
    itemPrice: { amountCents, currency: "USD" }, priceEvidence: { amountMinor: String(amountCents), currency: "USD",
      currencyMinorUnit: 2, scope: "VARIANT", taxBasis: "UNKNOWN" }, availability: "IN_STOCK", availabilityScope: "VARIANT",
    rating: { value: 4.8, reviewCount: 25, scale: 5, productId: 1000 }, checkedAt });
}

async function connect(options: { wooCount?: number; shopifyCount?: number; inspectionAvailable?: boolean } = {}) {
  let current = new Date(checkedAt);
  let observations = Array.from({ length: options.wooCount ?? 1 }, (_, index) => woo(index ? "woo-two" : "woo-one", index ? 2300 : 2200));
  const network = vi.fn(async () => { throw new Error("WOO_FOLLOWUPS_FORBID_NETWORK"); });
  vi.stubGlobal("fetch", network);
  const returnedProducts: WooProduct[] = [];
  const catalogSearch = vi.fn(async () => {
    const result = WooSearchResultSchema.parse({ source: "WOOCOMMERCE_STORE_API", schemaVersion: 1,
    registryVersion: "followups-v1", requestId: "followups", status: "COMPLETE", snapshotAt: current.toISOString(), products: observations,
    stores: observations.map(item => ({ merchantId: item.merchantId, status: "COMPLETE", requests: 1, returned: 1 })),
    diagnostics: { eligibleStores: observations.length, plannedStores: observations.length, attemptedStores: observations.length,
      succeededStores: observations.length, failedStores: 0, skippedStores: 0, physicalRequests: observations.length,
      responseBytes: 1000, cacheHits: 0, elapsedMs: 1, truncated: false, registryCoverageComplete: true } });
    returnedProducts.push(...result.products);
    return result;
  });
  const lookup = vi.fn<WooCommerceProductPort["lookup"]>(async target => {
    const found = observations.find(item => item.merchantId === target.merchantId && item.productId === target.productId && item.variationId === target.variationId);
    return { source: "WOOCOMMERCE_STORE_API", registryVersion: "followups-v1", status: found ? "FOUND" : "NOT_FOUND",
      ...(found ? { product: found } : {}), checkedAt: current.toISOString() };
  });
  const inspect = vi.fn<WooCommerceProductPort["inspect"]>(async target => {
    const selected = observations.find(item => item.merchantId === target.merchantId && item.variationId === target.variationId);
    const changed = selected && WooProductSchema.parse({ ...selected, itemPrice: { amountCents: 2600, currency: "USD" },
      priceEvidence: { ...selected.priceEvidence, amountMinor: "2600" }, checkedAt: current.toISOString() });
    return { source: "WOOCOMMERCE_STORE_API", registryVersion: "followups-v1", status: "COMPLETE",
      products: changed ? [changed] : [], checkedAt: current.toISOString(), truncated: false };
  });
  const shopifySearch = vi.fn(async () => searchResult(Array.from({ length: options.shopifyCount ?? 0 }, (_, index) => shopifyFixture({
    merchantId: `reviewed-peer-${index}`, merchant: `Reviewed fixture peer ${index}`, sourceHost: `reviewed-peer-${index}.example`,
    handle: String(3000 + index), title: "Black mechanical keyboard", productType: "mechanical keyboard", brand: "Fixture", gtins: ["4006381333931"],
    merchantUrl: `https://reviewed-peer-${index}.example/products/keyboard-${index}`, checkedAt,
    itemPrice: { amountCents: 1800 + index * 400, currency: "USD" }, variantDimensions: { Color: "Black", Layout: "ANSI" } }))));
  const watches = createMemoryWatchStore();
  const backend = createFindCheapBackend({ catalog: { awin: createUnavailableAwinPort(), shopify: { search: shopifySearch }, woocommerce: { search: catalogSearch } },
    product: { affiliateLinks: createAffiliateLinkResolver(), ...(options.inspectionAvailable === false ? {} : { woocommerceProducts: { lookup, inspect } }) },
    watches, deals: createUnavailableDealPort(), verifiedDeals: false });
  const server = createShoppingServer(undefined, undefined, { backend, now: () => current });
  const client = new Client({ name: "woo-followups-sdk-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closers.push(async () => { await client.close(); await server.close(); expect(network).not.toHaveBeenCalled(); });
  return { client, lookup, inspect, catalogSearch, shopifySearch, watches, returnedProducts,
    advance: (milliseconds: number) => { current = new Date(current.getTime() + milliseconds); },
    update: (next: WooProduct[]) => { observations = next.map(item => ({ ...item, checkedAt: current.toISOString() })); } };
}
type Harness = Awaited<ReturnType<typeof connect>>;

async function search(harness: Harness): Promise<Snapshot> {
  const result = await harness.client.callTool({ name: "search_products", arguments: {
    query: "mechanical keyboard", productType: "mechanical keyboard", requiredFeatures: ["black"], responseLocale: "zh-CN", limit: 8
  } });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  return result.structuredContent as Snapshot;
}

async function bindSimulatedAutomation(harness: Harness, watchId: string) {
  // This registered tool only persists a local test identifier. No host Automation tool exists here.
  const result = await harness.client.callTool({ name: "bind_watch_automation", arguments: { watchId, automationId: "simulated-woo-followup" } });
  expect(result.structuredContent).toMatchObject({ status: "ACTIVE", watchId, automationId: "simulated-woo-followup" });
}

describe("WooCommerce MCP transport follow-ups", () => {
  it("renders a selectable Woo card with original source, price and merchant-only checkout", async () => {
    const harness = await connect();
    const snapshot = await search(harness);
    expect(snapshot.products).toHaveLength(1);
    expect(snapshot.products[0]).toMatchObject({ sourceKind: "WOOCOMMERCE_STORE_API", merchantId: "woo-one", handle: "1001",
      itemPrice: { amountCents: 2200, currency: "USD" }, checkoutPlatform: "MERCHANT", quoteCapability: "MERCHANT_CHECKOUT_ONLY",
      merchantTrust: { verification: "UNVERIFIED" }, selectionId: expect.any(String),
      quoteReference: { renderId: snapshot.renderId, selectionId: snapshot.products[0]!.selectionId, variantId: "1001" } });
  });

  it.each(["inspect_selected_product", "inspect_selected_shopify_product"])("%s creates a child snapshot and preserves the parent", async tool => {
    const harness = await connect();
    const parent = await search(harness);
    const result = await harness.client.callTool({ name: tool, arguments: { renderId: parent.renderId, selectionId: parent.products[0]!.selectionId } });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    const child = (result.structuredContent as { updatedSnapshot: Snapshot }).updatedSnapshot;
    expect(child.renderId).not.toBe(parent.renderId);
    expect(child.goalId).toBe(parent.goalId);
    expect(child.products[0]?.itemPrice?.amountCents).toBe(2600);
    expect(child.products[0]?.selectionId).not.toBe(parent.products[0]?.selectionId);
    expect(harness.inspect).toHaveBeenCalledExactlyOnceWith({ merchantId: "woo-one", productId: 1000, parentProductId: 1000, variationId: 1001 }, { attributes: {} });
    const original = await harness.client.callTool({ name: "render_product_cards", arguments: { renderId: parent.renderId } });
    expect((original.structuredContent as Snapshot).products).toEqual(parent.products);
    expect(parent.products[0]?.itemPrice?.amountCents).toBe(2200);
    expect(harness.lookup).not.toHaveBeenCalled();
  });

  it("uses the UI selection merchant when two Woo merchants share the same numeric IDs", async () => {
    const harness = await connect({ wooCount: 2 });
    const snapshot = await search(harness);
    expect(snapshot.products).toHaveLength(2);
    const selected = snapshot.products.find(card => card.merchantId === "woo-two")!;
    await harness.client.callTool({ name: "sync_product_card_selection", arguments: { renderId: snapshot.renderId, selectionIds: [selected.selectionId], revision: 3 } });
    const result = await harness.client.callTool({ name: "inspect_selected_product", arguments: { renderId: snapshot.renderId } });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    expect(harness.inspect).toHaveBeenCalledExactlyOnceWith({ merchantId: "woo-two", productId: 1000, parentProductId: 1000, variationId: 1001 }, { attributes: {} });
    expect(result._meta?.["findcheap/inspectionSelection"]).toMatchObject({ renderId: snapshot.renderId, selectionId: selected.selectionId, selectionSource: "UI", selectionRevision: 3 });
    const child = (result.structuredContent as { updatedSnapshot: Snapshot }).updatedSnapshot;
    expect(child.products.find(card => card.merchantId === "woo-one")?.itemPrice?.amountCents).toBe(2200);
    expect(child.products.find(card => card.merchantId === "woo-two")?.itemPrice?.amountCents).toBe(2600);
  });

  it("keeps the original inspection target when provider-owned objects mutate after rendering", async () => {
    const harness = await connect();
    const snapshot = await search(harness);
    expect(harness.returnedProducts.length).toBeGreaterThan(0);
    for (const product of harness.returnedProducts) {
      product.variationId = 9999;
      product.selectedAttributes.Color = "White";
    }
    const result = await harness.client.callTool({ name: "inspect_selected_product", arguments: {
      renderId: snapshot.renderId, selectionId: snapshot.products[0]!.selectionId
    } });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    expect(harness.inspect).toHaveBeenCalledExactlyOnceWith({ merchantId: "woo-one", productId: 1000, parentProductId: 1000, variationId: 1001 }, { attributes: {} });
    const original = await harness.client.callTool({ name: "render_product_cards", arguments: { renderId: snapshot.renderId } });
    expect((original.structuredContent as Snapshot).products).toEqual(snapshot.products);
    expect(snapshot.products[0]).toMatchObject({ handle: "1001", variantDimensions: { Color: "Black", Layout: "ANSI" } });
  });

  it("checks all returned variants before applying the three-card limit", async () => {
    const harness = await connect();
    const snapshot = await search(harness);
    const rejected = ([ [1002, "Red"], [1003, "White"], [1004, "Blue"] ] as const).map(([id, color]) => WooProductSchema.parse({ ...woo("woo-one", 2200, id),
      title: `${color} mechanical keyboard`, selectedAttributes: { Color: color, Layout: "ANSI" },
      variantDimensions: { Color: ["Black", "Red", "White", "Blue"], Layout: ["ANSI"] },
      merchantUrl: `https://woo-one.example/product/keyboard?attribute_color=${color.toLowerCase()}&attribute_layout=ansi` }));
    harness.inspect.mockResolvedValue({ source: "WOOCOMMERCE_STORE_API", registryVersion: "followups-v1", status: "COMPLETE",
      products: [...rejected, woo("woo-one", 2800, 1005)], checkedAt, truncated: false });
    const result = await harness.client.callTool({ name: "inspect_selected_product", arguments: {
      renderId: snapshot.renderId, selectionId: snapshot.products[0]!.selectionId
    } });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ status: "OK", updatedSnapshot: { products: [
      { sourceKind: "WOOCOMMERCE_STORE_API", handle: "1005", itemPrice: { amountCents: 2800 }, variantDimensions: { Color: "Black", Layout: "ANSI" } }
    ] } });
    const child = (result.structuredContent as { updatedSnapshot: Snapshot }).updatedSnapshot;
    expect(child.products).toHaveLength(1);
    expect(snapshot.products[0]?.handle).toBe("1001");
  });

  it.each([2, 3, 4])("compares %i explicit mixed-source selections from one immutable snapshot", async count => {
    const harness = await connect({ wooCount: count === 2 ? 1 : 2, shopifyCount: count === 4 ? 2 : 1 });
    const snapshot = await search(harness);
    expect(snapshot.products).toHaveLength(count);
    expect(snapshot.products.some(card => card.sourceKind === "WOOCOMMERCE_STORE_API")).toBe(true);
    expect(snapshot.products.some(card => card.sourceKind !== "WOOCOMMERCE_STORE_API")).toBe(true);
    const result = await harness.client.callTool({ name: "compare_selected_products", arguments: {
      renderId: snapshot.renderId, selectionIds: snapshot.products.map(card => card.selectionId), responseLocale: "zh-CN"
    } });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    const compared = result.structuredContent as { status: string; entries: Array<{ itemPrice: { amountCents: number } }> };
    expect(compared.status).toBe("OK");
    expect(compared.entries).toHaveLength(count);
    expect(compared.entries.map(entry => entry.itemPrice.amountCents).sort()).toEqual(snapshot.products.map(card => card.itemPrice!.amountCents).sort());
    expect(harness.inspect).not.toHaveBeenCalled();
    expect(harness.lookup).not.toHaveBeenCalled();
  });

  it("persists the selected Woo identity and checks only that exact variant price", async () => {
    const harness = await connect({ wooCount: 2 });
    const snapshot = await search(harness);
    const selected = snapshot.products.find(card => card.merchantId === "woo-two")!;
    const created = await harness.client.callTool({ name: "create_watch", arguments: { query: "mechanical keyboard", condition: "PRICE_BELOW",
      priceBasis: "ITEM_PRICE", threshold: 2000, conditionPreference: "NEW", quoteReference: selected.quoteReference } });
    expect(created.isError, JSON.stringify(created.content)).not.toBe(true);
    expect(created.structuredContent).toMatchObject({ status: "READY_TO_SCHEDULE", watchId: expect.any(String) });
    const watchId = (created.structuredContent as { watchId: string }).watchId;
    expect((await harness.watches.get(watchId))?.spec.selectedProduct).toMatchObject({ sourceKind: "WOOCOMMERCE_STORE_API", merchantId: "woo-two",
      productId: 1000, parentProductId: 1000, variationId: 1001, variantDimensions: { Color: "Black", Layout: "ANSI" } });
    expect((await harness.watches.get(watchId))?.automationId).toBeUndefined();
    const initialLookups = harness.lookup.mock.calls.length;
    expect(initialLookups).toBe(1);
    expect((await harness.client.callTool({ name: "check_watch", arguments: { watchId } })).structuredContent).toMatchObject({ status: "NOT_SCHEDULED" });
    expect(harness.lookup).toHaveBeenCalledTimes(initialLookups);
    await bindSimulatedAutomation(harness, watchId);
    const catalogCalls = harness.catalogSearch.mock.calls.length, shopifyCalls = harness.shopifySearch.mock.calls.length;
    harness.advance(60_000); harness.update([woo("woo-one", 1), woo("woo-two", 1999)]);
    const checked = await harness.client.callTool({ name: "check_watch", arguments: { watchId } });
    expect(checked.structuredContent).toMatchObject({ status: "TRIGGERED", observation: { sourceKind: "WOOCOMMERCE_STORE_API", itemPrice: { amountCents: 1999 }, variationId: 1001 } });
    expect(harness.lookup).toHaveBeenCalledTimes(initialLookups + 1);
    expect(harness.lookup).toHaveBeenLastCalledWith({ merchantId: "woo-two", productId: 1000, parentProductId: 1000, variationId: 1001 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(harness.catalogSearch.mock.calls.length).toBe(catalogCalls);
    expect(harness.shopifySearch.mock.calls.length).toBe(shopifyCalls);
    expect(harness.inspect).not.toHaveBeenCalled();
  });

  it("records a reliable out-of-stock baseline then triggers one exact restock without creating an Automation", async () => {
    const harness = await connect();
    const snapshot = await search(harness);
    const created = await harness.client.callTool({ name: "create_watch", arguments: { query: "mechanical keyboard", condition: "RESTOCKED",
      conditionPreference: "NEW", quoteReference: snapshot.products[0]!.quoteReference } });
    const watchId = (created.structuredContent as { watchId: string }).watchId;
    expect(watchId).toBeTypeOf("string");
    const initialLookups = harness.lookup.mock.calls.length;
    await bindSimulatedAutomation(harness, watchId);
    harness.advance(60_000); harness.update([{ ...woo(), availability: "OUT_OF_STOCK" }]);
    expect((await harness.client.callTool({ name: "check_watch", arguments: { watchId } })).structuredContent).toMatchObject({ status: "NOT_TRIGGERED" });
    harness.advance(60_000); harness.update([woo()]);
    expect((await harness.client.callTool({ name: "check_watch", arguments: { watchId } })).structuredContent).toMatchObject({ status: "TRIGGERED" });
    expect((await harness.watches.get(watchId))?.status).toBe("COMPLETED");
    expect((await harness.client.callTool({ name: "check_watch", arguments: { watchId } })).structuredContent).toMatchObject({ status: "COMPLETED" });
    expect(harness.lookup).toHaveBeenCalledTimes(initialLookups + 2);
    expect((await harness.watches.get(watchId))?.automationId).toBe("simulated-woo-followup");
  });

  it.each(["NOT_FOUND", "UNSUPPORTED"] as const)("a %s Woo lookup produces no price or stock notification", async status => {
    const harness = await connect();
    const snapshot = await search(harness);
    const created = await harness.client.callTool({ name: "create_watch", arguments: { query: "mechanical keyboard", condition: "PRICE_BELOW",
      priceBasis: "ITEM_PRICE", threshold: 2000, conditionPreference: "NEW", quoteReference: snapshot.products[0]!.quoteReference } });
    const watchId = (created.structuredContent as { watchId: string }).watchId;
    await bindSimulatedAutomation(harness, watchId);
    const previous = await harness.watches.get(watchId);
    harness.lookup.mockClear();
    harness.lookup.mockResolvedValue({ source: "WOOCOMMERCE_STORE_API", registryVersion: "followups-v1", status, checkedAt });
    const result = await harness.client.callTool({ name: "check_watch", arguments: { watchId } });
    expect(result.structuredContent).toMatchObject({ status: "DATA_SOURCE_UNAVAILABLE" });
    expect(await harness.watches.get(watchId)).toEqual(previous);
    expect(harness.lookup).toHaveBeenCalledTimes(1);
  });

  it.each(["NOT_FOUND", "UNSUPPORTED"] as const)("does not persist a new Watch when fresh lookup returns %s", async status => {
    const harness = await connect();
    const snapshot = await search(harness);
    harness.lookup.mockResolvedValue({ source: "WOOCOMMERCE_STORE_API", registryVersion: "followups-v1", status, checkedAt });
    const result = await harness.client.callTool({ name: "create_watch", arguments: { query: "mechanical keyboard", condition: "RESTOCKED",
      conditionPreference: "NEW", quoteReference: snapshot.products[0]!.quoteReference } });
    expect(await harness.watches.list()).toHaveLength(0);
    expect(result.isError === true || (result.structuredContent as { status?: string } | undefined)?.status === "DATA_SOURCE_UNAVAILABLE").toBe(true);
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    expect(harness.inspect).not.toHaveBeenCalled();
  });

  it("rejects unknown fresh inventory before persisting a stock Watch", async () => {
    const harness = await connect();
    const snapshot = await search(harness);
    harness.update([{ ...woo(), availability: "UNKNOWN" }]);
    const result = await harness.client.callTool({ name: "create_watch", arguments: { query: "mechanical keyboard", condition: "IN_STOCK",
      conditionPreference: "NEW", quoteReference: snapshot.products[0]!.quoteReference } });
    expect(await harness.watches.list()).toHaveLength(0);
    expect(result.isError === true || (result.structuredContent as { status?: string } | undefined)?.status === "DATA_SOURCE_UNAVAILABLE").toBe(true);
    expect(harness.lookup).toHaveBeenCalledTimes(1);
  });

  it("rejects a fresh lookup observation for another merchant before Watch persistence", async () => {
    const harness = await connect();
    const snapshot = await search(harness);
    harness.lookup.mockResolvedValue({ source: "WOOCOMMERCE_STORE_API", registryVersion: "followups-v1", status: "FOUND", product: woo("other-shop"), checkedAt });
    const result = await harness.client.callTool({ name: "create_watch", arguments: { query: "mechanical keyboard", condition: "PRICE_BELOW",
      priceBasis: "ITEM_PRICE", threshold: 2000, conditionPreference: "NEW", quoteReference: snapshot.products[0]!.quoteReference } });
    expect(await harness.watches.list()).toHaveLength(0);
    expect(result.isError === true || (result.structuredContent as { status?: string } | undefined)?.status === "DATA_SOURCE_UNAVAILABLE").toBe(true);
    expect(harness.lookup).toHaveBeenCalledTimes(1);
  });

  it("seeds a fresh out-of-stock creation baseline so the first in-stock callback detects restock", async () => {
    const harness = await connect();
    const snapshot = await search(harness);
    harness.update([{ ...woo(), availability: "OUT_OF_STOCK" }]);
    const created = await harness.client.callTool({ name: "create_watch", arguments: { query: "mechanical keyboard", condition: "RESTOCKED",
      conditionPreference: "NEW", quoteReference: snapshot.products[0]!.quoteReference } });
    expect(created.isError, JSON.stringify(created.content)).not.toBe(true);
    const watchId = (created.structuredContent as { watchId: string }).watchId;
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    await bindSimulatedAutomation(harness, watchId);
    harness.advance(60_000); harness.update([woo()]);
    const result = await harness.client.callTool({ name: "check_watch", arguments: { watchId } });
    expect(result.structuredContent).toMatchObject({ status: "TRIGGERED", observation: { availability: "IN_STOCK", sourceKind: "WOOCOMMERCE_STORE_API", variationId: 1001 } });
    expect((await harness.watches.get(watchId))?.status).toBe("COMPLETED");
    expect(harness.lookup).toHaveBeenCalledTimes(2);
  });

  it("does not create a Woo watch when its product lookup capability is absent", async () => {
    const harness = await connect({ inspectionAvailable: false });
    const snapshot = await search(harness);
    const result = await harness.client.callTool({ name: "create_watch", arguments: { query: "mechanical keyboard", condition: "IN_STOCK",
      conditionPreference: "NEW", quoteReference: snapshot.products[0]!.quoteReference } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("WATCH_TARGET_UNSUPPORTED");
    expect(await harness.watches.list()).toHaveLength(0);
    expect(harness.lookup).not.toHaveBeenCalled();
  });

  it("rejects a selection from another snapshot before any Woo inspection or Watch lookup", async () => {
    const harness = await connect();
    const first = await search(harness), second = await search(harness);
    const invalid = { renderId: first.renderId, selectionId: second.products[0]!.selectionId };
    const inspected = await harness.client.callTool({ name: "inspect_selected_product", arguments: invalid });
    expect(inspected.isError).toBe(true);
    expect(JSON.stringify(inspected.content)).toContain("INSPECTION_REFERENCE_UNAVAILABLE");
    const watched = await harness.client.callTool({ name: "create_watch", arguments: { query: "mechanical keyboard", condition: "IN_STOCK",
      conditionPreference: "NEW", quoteReference: invalid } });
    expect(watched.isError).toBe(true);
    expect(JSON.stringify(watched.content)).toContain("WATCH_REFERENCE_UNAVAILABLE");
    expect(harness.inspect).not.toHaveBeenCalled(); expect(harness.lookup).not.toHaveBeenCalled();
    expect(await harness.watches.list()).toHaveLength(0);
  });

  it("rejects an expired original reference without substituting a newer product", async () => {
    const harness = await connect();
    const snapshot = await search(harness);
    harness.advance(PRODUCT_SELECTION_SNAPSHOT_TTL_MS + 1);
    const result = await harness.client.callTool({ name: "inspect_selected_product", arguments: {
      renderId: snapshot.renderId, selectionId: snapshot.products[0]!.selectionId
    } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("INSPECTION_REFERENCE_EXPIRED");
    expect(harness.inspect).not.toHaveBeenCalled(); expect(harness.lookup).not.toHaveBeenCalled();
  });
});
