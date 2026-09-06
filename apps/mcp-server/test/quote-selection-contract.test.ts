import { describe, expect, it, vi } from "vitest";
import { connectReplay, product, REPLAY_NOW, searchResult } from "./fixtures/conversation-replay-support.js";
import { consumeQuoteAuthorization, type QuoteAuthorization } from "../src/quote-authorization.js";
import type { ShopifyProduct } from "../src/shopify-client.js";
import { ShopifyCartQuoteError } from "../src/shopify-cart-quote.js";
import { PRODUCT_SELECTION_SNAPSHOT_TTL_MS } from "../src/server.js";

const quoteResult = () => ({ status: "ESTIMATED" as const,
  subtotal: { amountCents: 3641, currency: "USD" as const },
  shipping: { amountCents: 0, currency: "USD" as const, label: "Standard" },
  tax: { status: "SHOPIFY_REPORTED" as const, amount: { amountCents: 100, currency: "USD" as const },
    shopifyEstimated: false, source: "SHOPIFY_CART" as const },
  deliveredPrice: { amountCents: 3741, currency: "USD" as const }, totalEstimated: true,
  checkedAt: "2026-09-04T19:51:00.000Z", expiresAt: "2026-09-04T20:01:00.000Z" });
const targets = () => [product({ handle: "456", checkoutPlatform: "SHOPIFY" }),
  product({ handle: "789", title: "Long human hair wig", checkoutPlatform: "SHOPIFY" })];
type Snapshot = { renderId: string; locale: string; message: string;
  products: { selectionId: string; handle: string; quoteCapability: string; card: { quoteCapability: string } }[] };
async function find(replay: Awaited<ReturnType<typeof connectReplay>>) {
  const result = await replay.client.callTool({ name: "search_products", arguments: {
    query: "wig", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE", responseLocale: "zh-CN", limit: 4
  } });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  return result.structuredContent as Snapshot;
}
async function sync(replay: Awaited<ReturnType<typeof connectReplay>>, snapshot: Snapshot, selectionIds: string[], revision = 1) {
  const result = await replay.client.callTool({ name: "sync_product_card_selection", arguments: {
    renderId: snapshot.renderId, selectionIds, revision
  } });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  return result;
}

describe("selected quote cardinality and failure contract", () => {
  it("routes one explicit batch ID without substituting a different synchronized UI choice", async () => {
    const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const quote = vi.fn(async () => quoteResult());
    const replay = await connectReplay(async () => searchResult(targets()), { cartQuotes: { quote } }, approve);
    try {
      const snapshot = await find(replay);
      const requested = snapshot.products.find(item => item.handle === "456")!;
      const synced = snapshot.products.find(item => item.handle === "789")!;
      await sync(replay, snapshot, [synced.selectionId]);
      const route = await replay.client.callTool({ name: "quote_and_compare_selected_products", arguments: {
        renderId: snapshot.renderId, selectionIds: [requested.selectionId], zipCode: "33433", responseLocale: "zh-CN"
      } });
      expect(route.isError).toBe(true);
      expect(JSON.stringify(route.content)).toContain("QUOTE_SINGLE_SELECTION");
      expect(JSON.stringify(route.content)).toContain(`selectionId=${requested.selectionId}`);
      expect(approve).not.toHaveBeenCalled();
      expect(quote).not.toHaveBeenCalled();
      const result = await replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, selectionId: requested.selectionId, zipCode: "33433", responseLocale: "zh-CN"
      } });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect((result.structuredContent as Snapshot).products.map(item => item.handle)).toEqual(["456"]);
    } finally { await replay.close(); }
  });
  it("rejects a foreign one-item batch ID before issuing single-item routing guidance", async () => {
    const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const quote = vi.fn(async () => quoteResult());
    const replay = await connectReplay(async () => searchResult(targets()), { cartQuotes: { quote } }, approve);
    try {
      const original = await find(replay);
      await sync(replay, original, [original.products[0]!.selectionId]);
      const other = await find(replay);
      const result = await replay.client.callTool({ name: "quote_and_compare_selected_products", arguments: {
        renderId: original.renderId, selectionIds: [other.products[0]!.selectionId], zipCode: "33433", responseLocale: "zh-CN"
      } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("QUOTE_REFERENCE_UNAVAILABLE");
      expect(JSON.stringify(result.content)).not.toContain("QUOTE_SINGLE_SELECTION");
      expect(approve).not.toHaveBeenCalled();
      expect(quote).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });
  it.each(["selection and position", "position and variant", "all three"])("rejects ambiguous single selectors: %s", async combination => {
    const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const quote = vi.fn(async () => quoteResult());
    const replay = await connectReplay(async () => searchResult(targets()), { cartQuotes: { quote } }, approve);
    try {
      const snapshot = await find(replay);
      await sync(replay, snapshot, [snapshot.products[0]!.selectionId]);
      const result = await replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, position: 1, zipCode: "33433",
        ...(combination === "position and variant" ? {} : { selectionId: snapshot.products[0]!.selectionId }),
        ...(combination === "selection and position" ? {} : { variantId: snapshot.products[0]!.handle })
      } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("INVALID_ARGUMENTS");
      expect(approve).not.toHaveBeenCalled();
      expect(quote).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });
  it("retains an original single selection after a new search and ignores an older selection revision", async () => {
    const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const quote = vi.fn(async () => quoteResult());
    const replay = await connectReplay(async () => searchResult(targets()), { cartQuotes: { quote } }, approve);
    try {
      const original = await find(replay);
      const selected = original.products.find(item => item.handle === "789")!;
      const other = original.products.find(item => item.handle === "456")!;
      await sync(replay, original, [selected.selectionId], 2);
      const latest = await find(replay);
      await sync(replay, latest, [latest.products.find(item => item.handle === "456")!.selectionId]);
      const late = await sync(replay, original, [other.selectionId], 1);
      expect(late.structuredContent).toMatchObject({ status: "IGNORED", selectedCount: 1 });
      const result = await replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
        renderId: original.renderId, zipCode: "33433", responseLocale: "zh-CN"
      } });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect((result.structuredContent as Snapshot).products.map(item => item.handle)).toEqual(["789"]);
      expect(quote).toHaveBeenCalledOnce();
    } finally { await replay.close(); }
  });
  it.each(["quote_selected_shopify_product", "quote_and_compare_selected_products"])(
    "%s never treats an expired implicit selection as the newest snapshot or as a sync failure", async tool => {
    let current = REPLAY_NOW;
    const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const quote = vi.fn(async () => quoteResult());
    const replay = await connectReplay(async () => searchResult(targets()), { now: () => current, cartQuotes: { quote } }, approve);
    try {
      const original = await find(replay);
      await sync(replay, original, [original.products[0]!.selectionId]);
      current = new Date(current.getTime() + PRODUCT_SELECTION_SNAPSHOT_TTL_MS + 1);
      const latest = await find(replay);
      await sync(replay, latest, [latest.products[0]!.selectionId]);
      const result = await replay.client.callTool({ name: tool, arguments: {
        renderId: original.renderId, zipCode: "33433", responseLocale: "zh-CN"
      } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("QUOTE_REFERENCE_EXPIRED");
      expect(approve).not.toHaveBeenCalled();
      expect(quote).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });
  it("does not quote after the sole implicit selection is cleared during host approval", async () => {
    let announce!: () => void;
    const started = new Promise<void>(resolve => { announce = resolve; });
    let accept!: (answer: { action: "accept"; content: { approved: boolean } }) => void;
    const answer = new Promise<{ action: "accept"; content: { approved: boolean } }>(resolve => { accept = resolve; });
    const quote = vi.fn(async () => quoteResult());
    const replay = await connectReplay(async () => searchResult(targets()), { cartQuotes: { quote } }, async () => {
      announce(); return answer;
    });
    try {
      const snapshot = await find(replay);
      await sync(replay, snapshot, [snapshot.products[0]!.selectionId]);
      const pending = replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, zipCode: "33433", responseLocale: "zh-CN"
      } });
      await started;
      await sync(replay, snapshot, [], 2);
      accept({ action: "accept", content: { approved: true } });
      const result = await pending;
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("QUOTE_REFERENCE_CHANGED");
      expect(quote).not.toHaveBeenCalled();
    } finally { accept({ action: "accept", content: { approved: true } }); await replay.close(); }
  });
  it("explains an unsupported synced card in the current language without requesting permission", async () => {
    const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const quote = vi.fn(async () => quoteResult());
    const replay = await connectReplay(async () => searchResult([product()]), { cartQuotes: { quote } }, approve);
    try {
      const snapshot = await find(replay);
      await sync(replay, snapshot, [snapshot.products[0]!.selectionId]);
      const result = await replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, zipCode: "33433", responseLocale: "zh-CN"
      } });
      expect(JSON.stringify(result.content)).toContain("[MERCHANT_CHECKOUT_ONLY] 不支持报价");
      expect((result.structuredContent as Snapshot).products).toEqual(snapshot.products);
      expect(approve).not.toHaveBeenCalled();
      expect(quote).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });
  it("localizes a foreign single selection instead of falling back to the synced choice", async () => {
    const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const quote = vi.fn(async () => quoteResult());
    const replay = await connectReplay(async () => searchResult(targets()), { cartQuotes: { quote } }, approve);
    try {
      const snapshot = await find(replay);
      await sync(replay, snapshot, [snapshot.products[0]!.selectionId]);
      const other = await find(replay);
      const result = await replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, selectionId: other.products[0]!.selectionId, zipCode: "33433", responseLocale: "zh-CN"
      } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("[QUOTE_REFERENCE_UNAVAILABLE]");
      expect(JSON.stringify(result.content)).toContain("不属于原搜索快照");
      expect(approve).not.toHaveBeenCalled();
      expect(quote).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });
  it.each(["missing capability", "decline", "false acceptance"])("does not bypass %s for a renderId-only single quote", async mode => {
    const approve = vi.fn(async () => mode === "decline" ? { action: "decline" as const }
      : { action: "accept" as const, content: { approved: false } });
    const quote = vi.fn(async () => quoteResult());
    const replay = await connectReplay(async () => searchResult(targets()), { cartQuotes: { quote } },
      mode === "missing capability" ? undefined : approve);
    try {
      const snapshot = await find(replay);
      await sync(replay, snapshot, [snapshot.products[0]!.selectionId]);
      const result = await replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, zipCode: "33433", responseLocale: "zh-CN"
      } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain(mode === "missing capability" ? "QUOTE_AUTHORIZATION_UNAVAILABLE" : "QUOTE_AUTHORIZATION_DECLINED");
      expect(JSON.stringify(result.content)).toContain("无法确认授权弹窗是否显示");
      expect(JSON.stringify(result.content)).not.toContain("用户拒绝");
      expect(quote).not.toHaveBeenCalled();
      expect(approve).toHaveBeenCalledTimes(mode === "missing capability" ? 0 : 1);
      const rendered = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: snapshot.renderId } });
      expect((rendered.structuredContent as Snapshot).products).toEqual(snapshot.products);
    } finally { await replay.close(); }
  });
  it.each([0, 1])("routes an explicit %i-item batch request without treating it as host refusal", async count => {
    const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const quote = vi.fn(async () => quoteResult());
    const replay = await connectReplay(async () => searchResult(targets()), { cartQuotes: { quote } }, approve);
    try {
      const snapshot = await find(replay);
      const result = await replay.client.callTool({ name: "quote_and_compare_selected_products", arguments: {
        renderId: snapshot.renderId, selectionIds: snapshot.products.slice(0, count).map(item => item.selectionId),
        zipCode: "33433", responseLocale: "zh-CN"
      } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain(count === 0 ? "QUOTE_SELECTION_EMPTY" : "QUOTE_SINGLE_SELECTION");
      expect(approve).not.toHaveBeenCalled();
      expect(quote).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });
  it.each(["single", "batch"])("reports a temporary %s quote failure in the current language without changing capability", async mode => {
    const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const quote = vi.fn(async () => { throw new ShopifyCartQuoteError("QUOTE_TIMEOUT"); });
    const replay = await connectReplay(async () => searchResult(targets()), { cartQuotes: { quote } }, approve);
    try {
      const snapshot = await find(replay);
      const ids = snapshot.products.map(item => item.selectionId);
      await sync(replay, snapshot, mode === "single" ? ids.slice(0, 1) : ids);
      const result = await replay.client.callTool({ name: mode === "single" ? "quote_selected_shopify_product" : "quote_and_compare_selected_products",
        arguments: { renderId: snapshot.renderId, zipCode: "33433", responseLocale: "zh-CN" } });
      expect(JSON.stringify(result.content)).toContain("[QUOTE_TIMEOUT]");
      expect(JSON.stringify(result.content)).toContain("报价超时");
      if (mode === "single") {
        expect((result.structuredContent as Snapshot).products).toEqual(snapshot.products);
      }
      const rendered = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: snapshot.renderId } });
      expect((rendered.structuredContent as Snapshot).products).toEqual(snapshot.products);
      expect(approve).toHaveBeenCalledOnce();
    } finally { await replay.close(); }
  });
  it.each([
    { tool: "quote_selected_shopify_product", count: undefined, code: "QUOTE_SELECTION_NOT_SYNCED" },
    { tool: "quote_selected_shopify_product", count: 0, code: "QUOTE_SELECTION_EMPTY" },
    { tool: "quote_selected_shopify_product", count: 2, code: "QUOTE_MULTIPLE_SELECTIONS" },
    { tool: "quote_and_compare_selected_products", count: undefined, code: "QUOTE_SELECTION_NOT_SYNCED" },
    { tool: "quote_and_compare_selected_products", count: 0, code: "QUOTE_SELECTION_EMPTY" },
    { tool: "quote_and_compare_selected_products", count: 1, code: "QUOTE_SINGLE_SELECTION" }
  ])("explains $tool with $count synchronized choices without requesting permission", async ({ tool, count, code }) => {
    const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const quote = vi.fn(async () => quoteResult());
    const replay = await connectReplay(async () => searchResult(targets()), { cartQuotes: { quote } }, approve);
    try {
      const snapshot = await find(replay);
      if (count !== undefined) await sync(replay, snapshot, snapshot.products.slice(0, count).map(item => item.selectionId));
      const result = await replay.client.callTool({ name: tool, arguments: {
        renderId: snapshot.renderId, zipCode: "33433", responseLocale: "zh-CN"
      } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain(`[${code}]`);
      expect(JSON.stringify(result.content)).toMatch(/[\u4e00-\u9fff]/u);
      if (code === "QUOTE_SINGLE_SELECTION") expect(JSON.stringify(result.content)).toContain("quote_selected_shopify_product");
      if (code === "QUOTE_MULTIPLE_SELECTIONS") expect(JSON.stringify(result.content)).toContain("quote_and_compare_selected_products");
      expect(approve).not.toHaveBeenCalled();
      expect(quote).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });
  it("quotes the only synced ID in the original snapshot after simulated host approval", async () => {
    const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const quote = vi.fn(async (selected: ShopifyProduct, zip: string, permit?: QuoteAuthorization) => {
      expect(selected.handle).toBe("789");
      expect(zip).toBe("33433");
      expect(consumeQuoteAuthorization(permit, selected, zip)).toBeDefined();
      return quoteResult();
    });
    const replay = await connectReplay(async () => searchResult(targets()), { cartQuotes: { quote } }, approve);
    try {
      const snapshot = await find(replay);
      await sync(replay, snapshot, [snapshot.products.find(item => item.handle === "789")!.selectionId]);
      const result = await replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, zipCode: "33433", responseLocale: "zh-CN"
      } });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect((result.structuredContent as Snapshot).products.map(item => item.handle)).toEqual(["789"]);
      expect(approve).toHaveBeenCalledOnce();
      expect(quote).toHaveBeenCalledOnce();
    } finally { await replay.close(); }
  });
});
