import { expect, it, vi } from "vitest";
import type { ProductCardContent, ShopifyPort } from "../src/server.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

// Minimal public field shapes from the two September 7 development cases.
// Synthetic prices/provider responses, not live merchant or native host acceptance.
const mild = product({ merchantId: "medicube", merchant: "medicube", sourceHost: "medicube.us",
  title: "Zero Pore Madecassoside Pads (Mild)", brand: "medicube", productType: "toner pads",
  description: "medicube Zero Pore Pad Mild. Net wt. 155g (70 pads)", handle: "41268489650224",
  merchantUrl: "https://medicube.us/products/zero-pore-pads-mild?variant=41268489650224",
  itemPrice: { amountCents: 2400, currency: "USD" },
  merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT", evidence: ["synthetic official host"] } });
const regular = { ...mild, title: "Zero Pore Pads", description: "Net weight 100ml / 70 pads. For gentler exfoliation, try Zero Pore Pad Mild.",
  handle: "40542710825008", merchantUrl: "https://medicube.us/products/zero-pore-pad-1?variant=40542710825008" };
const { itemPrice: _price, ...noPrice } = mild;
const unreviewed = { ...noPrice, merchantId: "unreviewed", merchant: "Unreviewed shop", sourceHost: "unreviewed.example",
  merchantUrl: "https://unreviewed.example/products/pad", recommendationTier: "GENERAL_UNVERIFIED" as const,
  merchantTrust: { level: "UNKNOWN" as const, verification: "UNVERIFIED" as const, evidence: [] } };
const request = { query: "medicube Zero Pore Pad", brand: "medicube", productType: "toner pads",
  requiredSize: "70 pads, 155g", comparisonMode: "SAME_PRODUCT", compareMerchants: true, responseLocale: "zh-CN" };
type Snapshot = ProductCardContent & { renderId: string; goalId: string };

async function setup(products: ReturnType<typeof product>[] = [mild, unreviewed, regular], hostConsent = true) {
  const read = vi.fn(async () => { throw new Error("UNAUTHORIZED_WEB_READ"); });
  const approve = vi.fn(async () => ({ action: "decline" as const }));
  const search = vi.fn<ShopifyPort["search"]>(async () => searchResult(products));
  const replay = await connectReplay(search, {
    awin: { search: async () => ({ source: "AWIN_PRODUCT_FEED", coverage: "COMPLETE", snapshotAt: "2026-09-04T19:51:00Z",
      diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 }, products: [] }) },
    webProducts: { read }, selectedProducts: { inspect: async () => ({
      productTitle: mild.title, canonicalProductUrl: "https://medicube.us/products/zero-pore-pads-mild", variants: [mild]
    }) }
  }, hostConsent ? approve : undefined);
  return { ...replay, read, approve, search };
}

it("does not return regular pads after inspecting then explicitly confirming Mild", async () => {
  const replay = await setup();
  try {
    const initial = await replay.client.callTool({ name: "search_products", arguments: request });
    expect(initial.isError).not.toBe(true);
    const first = initial.structuredContent as Snapshot;
    const inspected = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
      renderId: first.renderId, selectionId: first.products.find(p => p.handle === mild.handle && p.sourceHost === mild.sourceHost)!.selectionId
    } });
    expect(inspected.isError).not.toBe(true);
    const next = (inspected.structuredContent as { updatedSnapshot: Snapshot }).updatedSnapshot;
    const continued = await replay.client.callTool({ name: "search_products", arguments: {
      query: "medicube Zero Pore Pad Mild", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: next.renderId, responseLocale: "zh-CN"
    } });
    expect(continued.isError).not.toBe(true);
    const result = continued.structuredContent as Snapshot;
    expect(result.goalId).toBe(first.goalId);
    expect(result.products.length).toBeGreaterThan(0);
    expect(result.products.some(p => p.handle === regular.handle)).toBe(false);
    expect(result.products.every(p => /\bmild\b/iu.test(p.title))).toBe(true);
    expect(result.products.every(p => p.requestIdentityStatus === "CONFIRMED")).toBe(true);
    expect(replay.read).not.toHaveBeenCalled();
  } finally { await replay.close(); }
});

it("Sony budget continuation keeps black/new requirements and neither invents a cheap offer nor re-prompts", async () => {
  const sony = product({ merchantId: "sony", merchant: "Sony", sourceHost: "electronics.sony.com", brand: "Sony",
    title: "Sony WH-1000XM6 Wireless Headphones Black", mpn: "WH-1000XM6", productType: "headphones",
    handle: "wh1000xm6", variantDimensions: { Color: "Black" }, itemPrice: { amountCents: 39999, currency: "USD" },
    merchantUrl: "https://electronics.sony.com/audio/headphones/headband/p/wh1000xm6-b",
    merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT", evidence: ["synthetic official offer"] } });
  const used = { ...sony, handle: "used", condition: "USED" as const, itemPrice: { amountCents: 10000, currency: "USD" as const },
    merchantUrl: "https://electronics.sony.com/audio/headphones/headband/p/used" };
  const white = { ...sony, handle: "white", title: "Sony WH-1000XM6 Wireless Headphones White", variantDimensions: { Color: "White" },
    itemPrice: { amountCents: 10000, currency: "USD" as const }, merchantUrl: "https://electronics.sony.com/audio/headphones/headband/p/white" };
  const replay = await setup([sony, used, white]);
  try {
    const first = await replay.client.callTool({ name: "search_products", arguments: { query: "Sony WH-1000XM6", brand: "Sony",
      productType: "headphones", requiredFeatures: ["black"], conditionPreference: "NEW", compareMerchants: true, comparisonMode: "SAME_PRODUCT", responseLocale: "zh-CN" } });
    expect(first.isError).not.toBe(true);
    const original = first.structuredContent as Snapshot;
    expect(original.products).toHaveLength(1);
    await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: original.renderId } });
    const continued = await replay.client.callTool({ name: "search_products", arguments: { query: "Sony WH-1000XM6",
      parentRenderId: original.renderId, contextMode: "CONTINUE_PREVIOUS_PRODUCT", maxItemPriceCents: 30000, responseLocale: "zh-CN" } });
    expect(continued.isError).not.toBe(true);
    const next = continued.structuredContent as Snapshot;
    expect(next.goalId).toBe(original.goalId);
    expect(next.products).toHaveLength(0);
    expect(next.recommendation?.state).toBe("NO_MATCH");
    expect(next.requirementsSummary).toMatchObject({ brand: "Sony", requiredFeatures: ["black"], maxItemPriceCents: 30000 });
    expect(replay.search).toHaveBeenLastCalledWith(expect.objectContaining({ maxItemPriceCents: 30000 }));
    const again = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: next.renderId } });
    expect(again.structuredContent).toMatchObject({ status: "PERMISSION_DENIED", diagnostics: { hostAction: "NOT_REQUESTED" } });
    expect(replay.approve).toHaveBeenCalledTimes(1);
    expect(replay.read).not.toHaveBeenCalled();
    expect(JSON.stringify(continued.content)).not.toMatch(/可授权|may be authorized/u);
  } finally { await replay.close(); }
});

it("missing host form capability remains unavailable on a derived snapshot", async () => {
  const replay = await setup(undefined, false);
  try {
    const initial = await replay.client.callTool({ name: "search_products", arguments: request });
    const first = initial.structuredContent as Snapshot;
    const unavailable = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: first.renderId } });
    expect(unavailable.structuredContent).toMatchObject({ status: "PERMISSION_UNAVAILABLE", diagnostics: { formSupported: false, hostAction: "NOT_REQUESTED" } });
    const inspected = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: { renderId: first.renderId, position: 1 } });
    const next = (inspected.structuredContent as { updatedSnapshot: Snapshot }).updatedSnapshot;
    expect(next.recovery).toMatchObject({ action: "REPORT_INCOMPLETE", reason: "AUTHORIZATION_STOPPED", consentStatus: "PERMISSION_UNAVAILABLE" });
    expect(replay.approve).not.toHaveBeenCalled();
    expect(replay.read).not.toHaveBeenCalled();
  } finally { await replay.close(); }
});

it("inspection cannot promote unresolved identity or an unreviewed unpriced merchant", async () => {
  const replay = await setup();
  try {
    const initial = await replay.client.callTool({ name: "search_products", arguments: request });
    const first = initial.structuredContent as Snapshot;
    expect(first.products).toHaveLength(2);
    expect(first.products.some(p => p.sourceHost === unreviewed.sourceHost)).toBe(false);
    expect(unreviewed).not.toHaveProperty("itemPrice");
    const historical = structuredClone(first);
    const inspected = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
      renderId: first.renderId, position: 1
    } });
    expect(inspected.isError).not.toBe(true);
    const next = (inspected.structuredContent as { updatedSnapshot: Snapshot }).updatedSnapshot;
    expect(next.products).toHaveLength(2);
    expect(next.products.some(p => p.sourceHost === unreviewed.sourceHost)).toBe(false);
    expect(next.products.every(p => p.presentationGroup === "RESEARCH_ONLY")).toBe(true);
    expect(next.recommendation).toMatchObject({ state: "RESEARCH_ONLY" });
    expect(next.recommendation?.primarySelectionId).toBeUndefined();
    expect(next.comparison).toMatchObject({ offerCount: 2, merchantCount: 1, status: "DISCOVERY_ONLY" });
    expect(next.goalId).toBe(first.goalId);
    expect(next.recovery).toMatchObject({ action: "REQUEST_WEB_SEARCH", recommendable: 0 });
    const restored = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: first.renderId } });
    expect((restored.structuredContent as Snapshot).products).toEqual(historical.products);
    const consent = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: next.renderId } });
    expect(consent.isError).not.toBe(true);
    expect(consent.structuredContent).toMatchObject({ status: "PERMISSION_DENIED" });
    expect(replay.read).not.toHaveBeenCalled();
  } finally { await replay.close(); }
});

it("a declined goal does not re-prompt after inspection or a budget continuation", async () => {
  const replay = await setup();
  try {
    const initial = await replay.client.callTool({ name: "search_products", arguments: request });
    const first = initial.structuredContent as Snapshot;
    expect(first.recovery?.action).toBe("REQUEST_WEB_SEARCH");
    const denied = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: first.renderId } });
    expect(denied.structuredContent).toMatchObject({ status: "PERMISSION_DENIED" });
    const inspected = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: { renderId: first.renderId, position: 1 } });
    const next = (inspected.structuredContent as { updatedSnapshot: Snapshot }).updatedSnapshot;
    const continued = await replay.client.callTool({ name: "search_products", arguments: {
      query: "medicube Zero Pore Pad Mild", maxItemPriceCents: 3000, contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: next.renderId
    } });
    expect(continued.isError).not.toBe(true);
    const last = continued.structuredContent as Snapshot;
    const repeated = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: last.renderId } });
    expect(repeated.structuredContent).toMatchObject({ status: "PERMISSION_DENIED", attempt: 1,
      diagnostics: { hostAction: "NOT_REQUESTED" } });
    expect(replay.approve).toHaveBeenCalledTimes(1);
    for (const snapshot of [next, last]) expect(snapshot.recovery).toMatchObject({
      action: "REPORT_INCOMPLETE", reason: "AUTHORIZATION_STOPPED", consentStatus: "PERMISSION_DENIED"
    });
    expect(last.message).not.toMatch(/可授权|may be authorized/u);
    expect(JSON.stringify(continued.content)).not.toMatch(/可授权|may be authorized/u);
    expect(replay.read).not.toHaveBeenCalled();
  } finally { await replay.close(); }
});
