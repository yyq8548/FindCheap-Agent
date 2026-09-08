import { describe, expect, it, vi } from "vitest";
import type { ProductCardContent } from "../src/server.js";
import { PRODUCT_SELECTION_SNAPSHOT_TTL_MS } from "../src/server.js";
import type { ShopifyProduct } from "../src/shopify-client.js";
import { connectReplay, product, REPLAY_NOW, searchResult } from "./fixtures/conversation-replay-support.js";

type Replay = Awaited<ReturnType<typeof connectReplay>>;
type Snapshot = ProductCardContent & { renderId: string; goalId: string };
const products = () => [
  product({ handle: "1001", title: "Short human hair wig A", itemPrice: { amountCents: 1000, currency: "USD" },
    merchantUrl: "https://ishowbeauty.com/products/wig-a" }),
  product({ handle: "2001", title: "Short human hair wig B", itemPrice: { amountCents: 2000, currency: "USD" },
    merchantId: "hairsofly", merchant: "HAIRSOFLY SHOP", sourceHost: "hairsoflyshop.com",
    merchantUrl: "https://hairsoflyshop.com/products/wig-b" })
];
const inspectProduct = (selected: ShopifyProduct) => ({ productTitle: selected.title,
  canonicalProductUrl: selected.merchantUrl,
  variants: [{ ...selected, itemPrice: { amountCents: selected.itemPrice!.amountCents + 200, currency: "USD" as const },
    variantDimensions: { Material: "human hair" } }] });
async function find(replay: Replay) {
  const result = await replay.client.callTool({ name: "search_products", arguments: {
    query: "wig", productType: "wig", responseLocale: "zh-CN", limit: 8
  } });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  return result.structuredContent as Snapshot;
}
async function sync(replay: Replay, snapshot: Snapshot, selectionIds: string[], revision = 1) {
  const result = await replay.client.callTool({ name: "sync_product_card_selection", arguments: {
    renderId: snapshot.renderId, selectionIds, revision
  } });
  expect(result.isError).not.toBe(true);
  return result;
}
async function inspect(replay: Replay, snapshot: Snapshot, selectionId?: string) {
  const result = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
    renderId: snapshot.renderId, ...(selectionId === undefined ? {} : { selectionId })
  } });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  expect(result._meta?.["findcheap/inspectionSelection"]).toMatchObject({ renderId: snapshot.renderId,
    selectionId: selectionId ?? expect.any(String), selectionSource: selectionId === undefined ? "UI" : "EXPLICIT",
    ...(selectionId === undefined ? { selectionRevision: expect.any(Number) } : {}) });
  return (result.structuredContent as { updatedSnapshot: Snapshot }).updatedSnapshot;
}
const prices = (snapshot: Snapshot) => snapshot.products.map(card => card.itemPrice?.amountCents);

describe("single selected inspection and explicit continuation", () => {
  it("inspects exactly one UI-synced choice using only its original renderId", async () => {
    const source = products();
    source[1]!.handle = source[0]!.handle;
    const inspectSource = vi.fn(async (selected: ShopifyProduct) => inspectProduct(selected));
    const search = vi.fn(async () => searchResult(source));
    const replay = await connectReplay(search, { selectedProducts: { inspect: inspectSource } });
    try {
      const first = await find(replay);
      const chosen = first.products.find(card => card.merchantId === "hairsofly")!;
      await sync(replay, first, [chosen.selectionId!]);
      const searchCalls = search.mock.calls.length;
      const next = await inspect(replay, first);
      expect(inspectSource).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        merchantId: "hairsofly", handle: "1001", merchantUrl: "https://hairsoflyshop.com/products/wig-b"
      }), {});
      expect(search.mock.calls.length).toBe(searchCalls);
      expect(next.goalId).toBe(first.goalId);
      expect(next.products.find(card => card.merchantId === "hairsofly")?.itemPrice?.amountCents).toBe(2200);
    } finally { await replay.close(); }
  });

  it.each([
    [undefined, "INSPECTION_SELECTION_NOT_SYNCED", "尚未收到"],
    [0, "INSPECTION_SELECTION_EMPTY", "还没有选中"],
    [2, "INSPECTION_MULTIPLE_SELECTIONS", "选中了多件"]
  ] as const)("distinguishes a %s-choice receipt without reading any product", async (count, code, text) => {
    const inspectSource = vi.fn(async (selected: ShopifyProduct) => inspectProduct(selected));
    const replay = await connectReplay(async () => searchResult(products()), { selectedProducts: { inspect: inspectSource } });
    try {
      const first = await find(replay);
      if (count !== undefined) await sync(replay, first, first.products.slice(0, count).map(card => card.selectionId!));
      const result = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: { renderId: first.renderId } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain(code);
      expect(JSON.stringify(result.content)).toContain(text);
      expect(JSON.stringify(result.content)).not.toContain("INVALID_ARGUMENTS");
      expect(inspectSource).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("honors the current response language for a selection failure", async () => {
    const replay = await connectReplay(async () => searchResult(products()), {
      selectedProducts: { inspect: async selected => inspectProduct(selected) }
    });
    try {
      const first = await find(replay);
      const result = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
        renderId: first.renderId, responseLocale: "en-US"
      } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("INSPECTION_SELECTION_NOT_SYNCED");
      expect(JSON.stringify(result.content)).toContain("selection");
      expect(JSON.stringify(result.content)).not.toMatch(/[\u4e00-\u9fff]/u);
    } finally { await replay.close(); }
  });

  it.each([true, false])("uses the current language after inspection without changing old cards (matching variant: %s)", async found => {
    const replay = await connectReplay(async () => searchResult(products()), {
      selectedProducts: { inspect: async selected => ({ ...inspectProduct(selected),
        variants: found ? inspectProduct(selected).variants : [] }) }
    });
    try {
      const original = await find(replay);
      const chosen = original.products[0]!.selectionId!;
      await sync(replay, original, [chosen], 4);
      const result = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
        renderId: original.renderId, responseLocale: "en-US"
      } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ status: found ? "OK" : "NO_MATCHING_VARIANT" });
      expect(JSON.stringify(result.content)).not.toMatch(/[\u4e00-\u9fff]/u);
      expect(result._meta?.["findcheap/inspectionSelection"]).toEqual({ renderId: original.renderId,
        selectionId: chosen, selectionSource: "UI", selectionRevision: 4 });
      if (found) expect(result.structuredContent).toMatchObject({ updatedSnapshot: { locale: "en-US" } });
      const old = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: original.renderId } });
      expect(old.structuredContent).toMatchObject({ locale: "zh-CN", products: original.products });
    } finally { await replay.close(); }
  });

  it.each(["selection and position", "position and variant", "all three"])("still rejects conflicting explicit selectors: %s", async combination => {
    const inspectSource = vi.fn(async (selected: ShopifyProduct) => inspectProduct(selected));
    const replay = await connectReplay(async () => searchResult(products()), { selectedProducts: { inspect: inspectSource } });
    try {
      const original = await find(replay);
      await sync(replay, original, [original.products[1]!.selectionId!]);
      const result = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
        renderId: original.renderId, position: 1,
        ...(combination === "position and variant" ? {} : { selectionId: original.products[0]!.selectionId }),
        ...(combination === "selection and position" ? {} : { variantId: original.products[0]!.handle })
      } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("INVALID_ARGUMENTS");
      expect(inspectSource).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("keeps the requested snapshot and newer receipt when other searches and late syncs arrive", async () => {
    const inspectSource = vi.fn(async (selected: ShopifyProduct) => inspectProduct(selected));
    const replay = await connectReplay(async () => searchResult(products()), { selectedProducts: { inspect: inspectSource } });
    try {
      const original = await find(replay);
      await sync(replay, original, [original.products[1]!.selectionId!], 2);
      const other = await find(replay);
      await sync(replay, other, [other.products[0]!.selectionId!]);
      expect((await sync(replay, original, [original.products[0]!.selectionId!], 1)).structuredContent).toMatchObject({ status: "IGNORED" });
      await inspect(replay, original);
      expect(inspectSource).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ merchantId: "hairsofly" }), {});
    } finally { await replay.close(); }
  });

  it("does not replace explicit or foreign IDs with the current UI choice", async () => {
    const inspectSource = vi.fn(async (selected: ShopifyProduct) => inspectProduct(selected));
    const replay = await connectReplay(async () => searchResult(products()), { selectedProducts: { inspect: inspectSource } });
    try {
      const original = await find(replay);
      await sync(replay, original, [original.products[1]!.selectionId!]);
      await inspect(replay, original, original.products[0]!.selectionId!);
      expect(inspectSource).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ merchantId: "ishow" }), {});
      const other = await find(replay);
      inspectSource.mockClear();
      const result = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
        renderId: original.renderId, selectionId: other.products[0]!.selectionId
      } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("INSPECTION_REFERENCE_UNAVAILABLE");
      expect(inspectSource).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("reports an expired original snapshot before treating its choice as absent", async () => {
    let current = REPLAY_NOW;
    const inspectSource = vi.fn(async (selected: ShopifyProduct) => inspectProduct(selected));
    const replay = await connectReplay(async () => searchResult(products()), {
      now: () => current, selectedProducts: { inspect: inspectSource }
    });
    try {
      const original = await find(replay);
      await sync(replay, original, [original.products[0]!.selectionId!]);
      current = new Date(current.getTime() + PRODUCT_SELECTION_SNAPSHOT_TTL_MS + 1);
      const other = await find(replay);
      await sync(replay, other, [other.products[0]!.selectionId!]);
      const result = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: { renderId: original.renderId } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("INSPECTION_REFERENCE_EXPIRED");
      expect(JSON.stringify(result.content)).not.toContain("INSPECTION_SELECTION_NOT_SYNCED");
      expect(inspectSource).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("keeps parallel inspection branches separate and continues only the explicitly chosen branch", async () => {
    let source = products();
    const replay = await connectReplay(async () => searchResult(source), {
      selectedProducts: { inspect: async selected => inspectProduct(selected) }
    });
    try {
      const original = await find(replay);
      const branches = await Promise.all(original.products.map(card => inspect(replay, original, card.selectionId!)));
      expect(prices(branches[0]!)).toEqual([1200, 2000]);
      expect(prices(branches[1]!)).toEqual([1000, 2200]);
      expect(new Set(branches.map(branch => branch.renderId)).size).toBe(2);
      expect(branches.every(branch => branch.goalId === original.goalId)).toBe(true);
      const old = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: original.renderId } });
      expect((old.structuredContent as Snapshot).products).toEqual(original.products);
      source = [];
      const continued = await replay.client.callTool({ name: "search_products", arguments: {
        query: "wig", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: branches[0]!.renderId, responseLocale: "zh-CN"
      } });
      expect(continued.isError).not.toBe(true);
      expect(prices(continued.structuredContent as Snapshot)).toEqual([1200, 2000]);
    } finally { await replay.close(); }
  });

  it("accumulates sequential inspections and preserves both observations through continuation and comparison", async () => {
    let source = products();
    const replay = await connectReplay(async () => searchResult(source), {
      selectedProducts: { inspect: async selected => inspectProduct(selected) }
    });
    try {
      const original = await find(replay);
      const first = await inspect(replay, original, original.products[0]!.selectionId!);
      const secondTarget = first.products.find(card => card.merchantId === "hairsofly" && card.handle === "2001")!;
      const second = await inspect(replay, first, secondTarget.selectionId!);
      expect(prices(second)).toEqual([1200, 2200]);
      expect(second.goalRevision).toBe(3);
      expect(second.products.every(card => !original.products.some(old => old.selectionId === card.selectionId))).toBe(true);
      source = [];
      const continued = await replay.client.callTool({ name: "search_products", arguments: {
        query: "wig", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: second.renderId,
        maxItemPriceCents: 3000, responseLocale: "zh-CN"
      } });
      expect(continued.isError).not.toBe(true);
      const next = continued.structuredContent as Snapshot;
      expect(next.goalId).toBe(original.goalId);
      expect(prices(next)).toEqual([1200, 2200]);
      expect(next.requirementsSummary?.maxItemPriceCents).toBe(3000);
      const compared = await replay.client.callTool({ name: "compare_selected_products", arguments: {
        renderId: next.renderId, selectionIds: next.products.map(card => card.selectionId), responseLocale: "zh-CN"
      } });
      expect(compared.structuredContent).toMatchObject({ status: "OK", entries: [
        { itemPrice: { amountCents: 1200 } }, { itemPrice: { amountCents: 2200 } }
      ] });
      const old = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: original.renderId } });
      expect((old.structuredContent as Snapshot).products).toEqual(original.products);
    } finally { await replay.close(); }
  });
});
