import { describe, expect, it, vi } from "vitest";
import type { ProductCardContent } from "../src/server.js";
import { PRODUCT_SELECTION_SNAPSHOT_TTL_MS } from "../src/server.js";
import { connectReplay, product, REPLAY_NOW, searchResult } from "./fixtures/conversation-replay-support.js";

type Replay = Awaited<ReturnType<typeof connectReplay>>;
type Snapshot = ProductCardContent & { renderId: string };
const products = () => [
  product({ handle: "same-variant", title: "Short human hair wig A", itemPrice: { amountCents: 1000, currency: "USD" },
    merchantUrl: "https://ishowbeauty.com/products/wig-a" }),
  product({ handle: "same-variant", title: "Short human hair wig B", itemPrice: { amountCents: 2000, currency: "USD" },
    merchantId: "hairsofly", merchant: "HAIRSOFLY SHOP", sourceHost: "hairsoflyshop.com",
    merchantUrl: "https://hairsoflyshop.com/products/wig-b" })
];
async function find(replay: Replay) {
  const result = await replay.client.callTool({ name: "search_shopify_products", arguments: {
    query: "wig", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE"
  } });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  const snapshot = result.structuredContent as Snapshot;
  expect(snapshot.products).toHaveLength(2);
  return snapshot;
}
async function sync(replay: Replay, snapshot: Snapshot, selectionIds: string[], revision = 1) {
  const result = await replay.client.callTool({ name: "sync_product_card_selection", arguments: {
    renderId: snapshot.renderId, selectionIds, revision
  } });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  return result;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}
function modelContext(result: Awaited<ReturnType<Replay["client"]["callTool"]>>) {
  const blocks = result.content as Array<{ type: string; text?: string }>;
  const block = blocks.find(entry => entry.type === "text" && entry.text?.includes('"findcheapContext"'));
  expect(block).toBeDefined();
  return JSON.parse(block!.text!.split("\n")[1]!).findcheapContext as Record<string, unknown>;
}

describe("selected deal UI reference contract", () => {
  it("researches the second UI-selected card with only its renderId despite colliding merchant handles", async () => {
    const lookup = vi.fn(async () => []);
    const replay = await connectReplay(async () => searchResult(products()), { deals: { search: lookup } });
    try {
      const snapshot = await find(replay);
      const second = snapshot.products[1]!;
      expect(second.merchantId).toBe("hairsofly");
      await sync(replay, snapshot, [second.selectionId!], 4);
      lookup.mockClear();
      const result = await replay.client.callTool({ name: "research_selected_product_deal", arguments: {
        renderId: snapshot.renderId, responseLocale: "zh-CN"
      } });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ status: "OK", renderId: snapshot.renderId,
        selectionId: second.selectionId, selectionSource: "UI", selectionRevision: 4,
        selectedProduct: { merchantId: "hairsofly", title: "Short human hair wig B" },
        currentPrice: { basis: "ITEM_PRICE", amount: { amountCents: 2000 } }, quoteStatus: "NOT_REQUESTED" });
      expect(lookup).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ merchant: "HAIRSOFLY SHOP" }));
    } finally { await replay.close(); }
  });

  it.each([
    [undefined, "DEAL_SELECTION_NOT_SYNCED", "尚未收到"],
    [0, "DEAL_SELECTION_EMPTY", "还没有选中"],
    [2, "DEAL_MULTIPLE_SELECTIONS", "选中了多件"]
  ] as const)("distinguishes a %s-choice receipt without looking up another card", async (count, code, message) => {
    const lookup = vi.fn(async () => []);
    const replay = await connectReplay(async () => searchResult(products()), { deals: { search: lookup } });
    try {
      const snapshot = await find(replay);
      if (count !== undefined) await sync(replay, snapshot, snapshot.products.slice(0, count).map(card => card.selectionId!));
      lookup.mockClear();
      const result = await replay.client.callTool({ name: "research_selected_product_deal", arguments: {
        renderId: snapshot.renderId, responseLocale: "zh-CN"
      } });
      expect(result.structuredContent).toMatchObject({ status: "SELECTION_UNAVAILABLE", reasonCode: code, deals: [], quoteStatus: "NOT_REQUESTED" });
      expect(JSON.stringify(result.content)).toContain(message);
      expect(JSON.stringify(result.content)).not.toContain("INVALID_ARGUMENTS");
      expect(result.structuredContent).not.toHaveProperty("selectionId");
      expect(result._meta?.["findcheap/dealSelection"]).toBeUndefined();
      expect(lookup).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it.each(["zh-CN", "en-US"])("distinguishes unavailable and expired references in %s without source calls", async responseLocale => {
    let current = REPLAY_NOW;
    const lookup = vi.fn(async () => []);
    const replay = await connectReplay(async () => searchResult(products()), { now: () => current, deals: { search: lookup } });
    try {
      const original = await find(replay);
      await sync(replay, original, [original.products[1]!.selectionId!]);
      const other = await find(replay);
      lookup.mockClear();
      const foreign = await replay.client.callTool({ name: "research_selected_product_deal", arguments: {
        renderId: original.renderId, selectionId: other.products[0]!.selectionId, responseLocale
      } });
      expect(foreign.structuredContent).toMatchObject({ status: "SELECTION_UNAVAILABLE", reasonCode: "DEAL_REFERENCE_UNAVAILABLE", locale: responseLocale, deals: [] });
      expect(foreign.structuredContent).not.toHaveProperty("selectionId");
      expect(modelContext(foreign)).not.toHaveProperty("selectionId");
      expect(modelContext(foreign)).not.toHaveProperty("selectionSource");
      current = new Date(REPLAY_NOW.getTime() + PRODUCT_SELECTION_SNAPSHOT_TTL_MS + 1);
      const expired = await replay.client.callTool({ name: "research_selected_product_deal", arguments: { renderId: original.renderId, responseLocale } });
      expect(expired.structuredContent).toMatchObject({ status: "SELECTION_UNAVAILABLE", reasonCode: "DEAL_REFERENCE_EXPIRED", deals: [] });
      expect(expired.structuredContent).toMatchObject({ message: expect.stringContaining(responseLocale === "zh-CN" ? "过期" : "expired") });
      expect(expired.structuredContent).not.toHaveProperty("selectionId");
      const unavailable = await replay.client.callTool({ name: "research_selected_product_deal", arguments: { renderId: original.renderId, responseLocale } });
      expect(unavailable.structuredContent).toMatchObject({ status: "SELECTION_UNAVAILABLE", reasonCode: "DEAL_REFERENCE_UNAVAILABLE", deals: [] });
      expect(lookup).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("preserves explicit selectors without replacing them with the current UI choice", async () => {
    const lookup = vi.fn(async () => []);
    const replay = await connectReplay(async () => searchResult(products()), { deals: { search: lookup } });
    try {
      const snapshot = await find(replay);
      await sync(replay, snapshot, [snapshot.products[0]!.selectionId!], 3);
      for (const selector of [{ selectionId: snapshot.products[1]!.selectionId }, { position: 2 }]) {
        const result = await replay.client.callTool({ name: "research_selected_product_deal", arguments: {
          renderId: snapshot.renderId, ...selector, responseLocale: "en-US"
        } });
        expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
        expect(result.structuredContent).toMatchObject({ selectionId: snapshot.products[1]!.selectionId,
          selectionSource: "EXPLICIT", selectedProduct: { merchantId: "hairsofly" }, locale: "en-US" });
        expect(result.structuredContent).not.toHaveProperty("selectionRevision");
      }
      lookup.mockClear();
      const conflict = await replay.client.callTool({ name: "research_selected_product_deal", arguments: {
        renderId: snapshot.renderId, selectionId: snapshot.products[0]!.selectionId, position: 2
      } });
      expect(conflict.isError).toBe(true);
      expect(JSON.stringify(conflict.content)).toContain("INVALID_ARGUMENTS");
      expect(lookup).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("keeps UI revisions monotonic and selections isolated from another search", async () => {
    const lookup = vi.fn(async () => []);
    const replay = await connectReplay(async () => searchResult(products()), { deals: { search: lookup } });
    try {
      const original = await find(replay);
      await sync(replay, original, [original.products[1]!.selectionId!], 4);
      expect((await sync(replay, original, [original.products[0]!.selectionId!], 3)).structuredContent)
        .toMatchObject({ status: "IGNORED", selectedCount: 1 });
      const other = await find(replay);
      lookup.mockClear();
      const unsynced = await replay.client.callTool({ name: "research_selected_product_deal", arguments: { renderId: other.renderId } });
      expect(unsynced.structuredContent).toMatchObject({ reasonCode: "DEAL_SELECTION_NOT_SYNCED" });
      expect(lookup).not.toHaveBeenCalled();
      const originalResult = await replay.client.callTool({ name: "research_selected_product_deal", arguments: { renderId: original.renderId } });
      expect(originalResult.structuredContent).toMatchObject({ selectionId: original.products[1]!.selectionId,
        selectionSource: "UI", selectionRevision: 4, selectedProduct: { merchantId: "hairsofly" } });
    } finally { await replay.close(); }
  });

  it.each(["CURRENT_DEALS", "CHEAPEST_PATH"])("locks %s to its request-start choice when UI changes during the lookup", async objective => {
    const started = deferred();
    const finish = deferred();
    const lookup = vi.fn(async () => []);
    const quote = vi.fn(async () => { throw new Error("UNEXPECTED_CART_WRITE"); });
    const search = vi.fn(async () => searchResult(products()));
    const replay = await connectReplay(search, { deals: { search: lookup }, cartQuotes: { quote } });
    try {
      const snapshot = await find(replay);
      await sync(replay, snapshot, [snapshot.products[1]!.selectionId!], 5);
      lookup.mockClear();
      search.mockClear();
      lookup.mockImplementationOnce(async () => { started.resolve(); await finish.promise; return []; });
      const pending = replay.client.callTool({ name: "research_selected_product_deal", arguments: {
        renderId: snapshot.renderId, objective, zipCode: "10001"
      } });
      await started.promise;
      await sync(replay, snapshot, [snapshot.products[0]!.selectionId!], 6);
      finish.resolve();
      const result = await pending;
      expect(result.structuredContent).toMatchObject({ status: "OK", selectionId: snapshot.products[1]!.selectionId,
        selectionSource: "UI", selectionRevision: 5, selectedProduct: { merchantId: "hairsofly" },
        currentPrice: { basis: "ITEM_PRICE", amount: { amountCents: 2000 } }, quoteStatus: "NOT_REQUESTED" });
      expect(result._meta?.["findcheap/dealSelection"]).toMatchObject({ renderId: snapshot.renderId,
        selectionId: snapshot.products[1]!.selectionId, selectionSource: "UI", selectionRevision: 5 });
      expect(lookup).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ merchant: "HAIRSOFLY SHOP" }));
      expect(search).not.toHaveBeenCalled();
      expect(quote).not.toHaveBeenCalled();
      const next = await replay.client.callTool({ name: "research_selected_product_deal", arguments: { renderId: snapshot.renderId } });
      expect(next.structuredContent).toMatchObject({ selectionId: snapshot.products[0]!.selectionId,
        selectionRevision: 6, selectedProduct: { merchantId: "ishow" }, currentPrice: { amount: { amountCents: 1000 } } });
    } finally { finish.resolve(); await replay.close(); }
  });

  it("gives text-only consumers the same UI and explicit selection provenance as structured results", async () => {
    const replay = await connectReplay(async () => searchResult(products()));
    try {
      const snapshot = await find(replay);
      await sync(replay, snapshot, [snapshot.products[1]!.selectionId!], 7);
      for (const explicit of [false, true]) {
        const result = await replay.client.callTool({ name: "research_selected_product_deal", arguments: {
          renderId: snapshot.renderId, ...(explicit ? { selectionId: snapshot.products[0]!.selectionId } : {})
        } });
        const expected = { renderId: snapshot.renderId,
          selectionId: snapshot.products[explicit ? 0 : 1]!.selectionId,
          selectionSource: explicit ? "EXPLICIT" : "UI", ...(explicit ? {} : { selectionRevision: 7 }) };
        expect(result.structuredContent).toMatchObject(expected);
        expect(result._meta?.["findcheap/dealSelection"]).toEqual(expected);
        expect(modelContext(result)).toMatchObject({ tool: "research_selected_product_deal", ...expected });
        if (explicit) expect(modelContext(result)).not.toHaveProperty("selectionRevision");
      }
    } finally { await replay.close(); }
  });
});
