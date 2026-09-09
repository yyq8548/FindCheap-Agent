import { describe, expect, it, vi } from "vitest";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";
import { consumeQuoteAuthorization, type QuoteAuthorization } from "../src/quote-authorization.js";
import type { ShopifyProduct } from "../src/shopify-client.js";
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
type Snapshot = { renderId: string; products: { selectionId: string; quoteCapability: string }[] };
async function find(replay: Awaited<ReturnType<typeof connectReplay>>, responseLocale = "en-US") {
  const result = await replay.client.callTool({ name: "search_products", arguments: {
    query: "wig", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE", responseLocale, limit: 4
  } });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  return result.structuredContent as Snapshot;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("interactive Cart quote authorization", () => {
  it.each(["single", "batch"])("reports an unreviewed merchant before approval for %s quotes", async mode => {
    const quote = vi.fn(async () => quoteResult());
    const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const replay = await connectReplay(async () => searchResult(targets().map(target => ({ ...target,
      merchantTrust: { level: "UNKNOWN", verification: "UNVERIFIED", evidence: [] }
    }))), { cartQuotes: { quote } }, approve);
    try {
      const snapshot = await find(replay);
      const result = await replay.client.callTool({ name: mode === "single" ? "quote_selected_shopify_product" : "quote_and_compare_selected_products",
        arguments: { renderId: snapshot.renderId, zipCode: "33433", ...(mode === "single" ? { position: 1 }
          : { selectionIds: snapshot.products.map(card => card.selectionId) }) } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("[QUOTE_MERCHANT_UNVERIFIED]");
      expect(JSON.stringify(result.content)).toContain("No quote Cart was created");
      expect(approve).not.toHaveBeenCalled();
      expect(quote).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });
  it("refuses a delivered-total Watch before asking for ZIP or a selected reference", async () => {
    const quote = vi.fn(async () => quoteResult());
    const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const replay = await connectReplay(async () => searchResult(targets()), { cartQuotes: { quote } }, approve);
    try {
      const result = await replay.client.callTool({ name: "create_watch", arguments: {
        query: "假发", condition: "PRICE_BELOW", threshold: 4000, priceBasis: "DELIVERED_TOTAL"
      } });
      expect(result.structuredContent).toMatchObject({ status: "DATA_SOURCE_UNAVAILABLE", questions: [] });
      expect(JSON.stringify(result.content)).toContain("RECURRING_QUOTE_AUTHORIZATION_UNAVAILABLE");
      expect(JSON.stringify(result.content)).toContain("不授权持续监控报价");
      expect(approve).not.toHaveBeenCalled();
      expect(quote).not.toHaveBeenCalled();
      expect((await replay.client.callTool({ name: "list_watches", arguments: {} })).structuredContent).toEqual({ watches: [] });
    } finally { await replay.close(); }
  });
  it("expires pending host consent after 20 seconds and ignores a later acceptance", async () => {
    const started = deferred<void>();
    const finish = deferred<{ action: "accept"; content: { approved: boolean } }>();
    const quote = vi.fn(async () => quoteResult());
    const replay = await connectReplay(async () => searchResult(targets()), { cartQuotes: { quote } }, async () => {
      started.resolve(); return finish.promise;
    });
    try {
      const snapshot = await find(replay);
      vi.useFakeTimers();
      const pending = replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, position: 1, zipCode: "33433"
      } });
      await started.promise;
      await vi.advanceTimersByTimeAsync(20_001);
      const result = await pending;
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("QUOTE_AUTHORIZATION_UNAVAILABLE");
      expect(quote).not.toHaveBeenCalled();
      finish.resolve({ action: "accept", content: { approved: true } });
      await vi.advanceTimersByTimeAsync(1);
      expect(quote).not.toHaveBeenCalled();
    } finally { finish.resolve({ action: "accept", content: { approved: true } }); vi.useRealTimers(); await replay.close(); }
  });
  it.each([2, 4])("binds one simulated approval to exactly %i selected products and the supplied ZIP", async count => {
    const products = Array.from({ length: count }, (_, index) => product({ handle: String(456 + index),
      title: `Human hair wig ${index}`, checkoutPlatform: "SHOPIFY",
      ...(index % 2 === 0 ? {} : { merchantId: "hairsofly", merchant: "Hairsofly", sourceHost: "hairsoflyshop.com",
        merchantUrl: "https://hairsoflyshop.com/products/fixture-wig" }) }));
    const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const quote = vi.fn(async (selected: ShopifyProduct, zip: string, permit?: QuoteAuthorization) => {
      expect(consumeQuoteAuthorization(permit, selected, "10001")).toBeUndefined();
      expect(consumeQuoteAuthorization(permit, selected, zip)).toBeDefined();
      expect(consumeQuoteAuthorization(permit, selected, zip)).toBeUndefined();
      return quoteResult();
    });
    const replay = await connectReplay(async () => searchResult(products), { cartQuotes: { quote } }, approve);
    try {
      // Legacy snapshot fixture deliberately retains four provider cards; current unified search caps presentation at three.
      const found = await replay.client.callTool({ name: "search_shopify_products", arguments: {
        query: "wig", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE", limit: 3
      } });
      expect(found.isError, JSON.stringify(found.content)).not.toBe(true);
      const snapshot = found.structuredContent as Snapshot;
      expect(snapshot.products).toHaveLength(count);
      const result = await replay.client.callTool({ name: "quote_and_compare_selected_products", arguments: {
        renderId: snapshot.renderId, selectionIds: snapshot.products.map(item => item.selectionId), zipCode: "33433"
      } });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect(approve).toHaveBeenCalledOnce();
      expect(quote).toHaveBeenCalledTimes(count);
      expect(new Set(quote.mock.calls.map(call => call[2])).size).toBe(1);
      expect(JSON.stringify(quote.mock.calls[0]![2])).toBe("{}");
    } finally { await replay.close(); }
  });

  it.each([{ action: "decline" as const }, { action: "cancel" as const },
    { action: "accept" as const, content: { approved: false } },
    { action: "accept" as const, content: { approved: true, extra: "unrequested" } }])(
    "does not turn host refusal or malformed acceptance into permission: %j", async answer => {
      const quote = vi.fn(async () => quoteResult());
      const approve = vi.fn(async () => answer);
      const replay = await connectReplay(async () => searchResult(targets()), { cartQuotes: { quote } }, approve);
      try {
        const snapshot = await find(replay, "zh-CN");
        const result = await replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
          renderId: snapshot.renderId, position: 1, zipCode: "33433"
        } });
        expect(result.isError).toBe(true);
        expect(quote).not.toHaveBeenCalled();
        expect(JSON.stringify(approve.mock.calls)).toContain("临时匿名购物车");
        expect(JSON.stringify(result.content)).toContain("现有商品和选择保持不变");
        const rendered = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: snapshot.renderId } });
        expect((rendered.structuredContent as Snapshot).products).toEqual(snapshot.products);
      } finally { await replay.close(); }
    });

  it.each(["selection", "expiry"])("revalidates %s after pending approval before calling a provider", async change => {
    let current = new Date("2026-09-04T19:51:00.000Z");
    const started = deferred<void>();
    const accepted = deferred<{ action: "accept"; content: { approved: boolean } }>();
    const quote = vi.fn(async () => quoteResult());
    const replay = await connectReplay(async () => searchResult(targets()), { now: () => current, cartQuotes: { quote } },
      async () => { started.resolve(); return accepted.promise; });
    try {
      const snapshot = await find(replay);
      const pending = replay.client.callTool({ name: "quote_and_compare_selected_products", arguments: {
        renderId: snapshot.renderId, selectionIds: snapshot.products.map(item => item.selectionId), zipCode: "33433"
      } });
      await started.promise;
      if (change === "expiry") current = new Date(current.getTime() + PRODUCT_SELECTION_SNAPSHOT_TTL_MS + 1);
      else await replay.client.callTool({ name: "sync_product_card_selection", arguments: {
        renderId: snapshot.renderId, selectionIds: [snapshot.products[1]!.selectionId], revision: 1
      } });
      accepted.resolve({ action: "accept", content: { approved: true } });
      const result = await pending;
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("QUOTE_REFERENCE_CHANGED");
      expect(quote).not.toHaveBeenCalled();
    } finally { accepted.resolve({ action: "accept", content: { approved: true } }); await replay.close(); }
  });

  it.each(["consent", "provider"])("cancellation during %s rejects late work without changing cards", async phase => {
    const started = deferred<void>();
    const finish = deferred<void>();
    const quote = vi.fn(async () => { if (phase === "provider") { started.resolve(); await finish.promise; } return quoteResult(); });
    const replay = await connectReplay(async () => searchResult(targets()), { cartQuotes: { quote } }, async () => {
      if (phase === "consent") { started.resolve(); await finish.promise; }
      return { action: "accept", content: { approved: true } };
    });
    try {
      const snapshot = await find(replay);
      const controller = new AbortController();
      const pending = replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, position: 1, zipCode: "33433"
      } }, undefined, { signal: controller.signal });
      const rejected = expect(pending).rejects.toThrow();
      await started.promise;
      controller.abort();
      await rejected;
      finish.resolve();
      await new Promise(resolve => setTimeout(resolve, 10));
      if (phase === "consent") expect(quote).not.toHaveBeenCalled();
      else expect(quote).toHaveBeenCalledOnce();
      const rendered = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: snapshot.renderId } });
      expect((rendered.structuredContent as Snapshot).products).toEqual(snapshot.products);
    } finally { finish.resolve(); await replay.close(); }
  });

  it.each([
    { handle: "not-numeric" },
    { merchantUrl: "https://ishowbeauty.com/checkout/fixture" },
    { merchantUrl: "https://ishowbeauty.com/products/fixture?variant=999" },
    { merchantUrl: "https://ishowbeauty.com/products/fixture?variant=456&variant=456" },
    { merchantTrust: { level: "UNKNOWN" as const, verification: "UNVERIFIED" as const, evidence: [] } }
  ])("rejects an unsafe or ambiguous target before asking for approval: %j", async override => {
    const quote = vi.fn(async () => quoteResult());
    const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const replay = await connectReplay(async () => searchResult([product({ handle: "456", checkoutPlatform: "SHOPIFY", ...override })]),
      { cartQuotes: { quote } }, approve);
    try {
      const snapshot = await find(replay);
      expect(snapshot.products[0]!.quoteCapability).toBe("NOT_CHECKED");
      const result = await replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, position: 1, zipCode: "33433"
      } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("merchantTrust" in override ? "QUOTE_MERCHANT_UNVERIFIED" : "QUOTE_TARGET_UNVERIFIED");
      expect(approve).not.toHaveBeenCalled();
      expect(quote).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it.each(["http://ishowbeauty.com/products/fixture", "https://other.example/products/fixture"])(
    "rejects invalid source URL before a quoteable snapshot exists: %s", async merchantUrl => {
      const quote = vi.fn(async () => quoteResult());
      const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
      const replay = await connectReplay(async () => searchResult([product({ handle: "456", checkoutPlatform: "SHOPIFY", merchantUrl })]),
        { cartQuotes: { quote } }, approve);
      try {
        const result = await replay.client.callTool({ name: "search_products", arguments: { query: "wig" } });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toBeUndefined();
        expect(approve).not.toHaveBeenCalled();
        expect(quote).not.toHaveBeenCalled();
      } finally { await replay.close(); }
    });

  it("does not accept an approval field in public tool arguments", async () => {
    const quote = vi.fn(async () => quoteResult());
    const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const replay = await connectReplay(async () => searchResult(targets()), { cartQuotes: { quote } }, approve);
    try {
      const snapshot = await find(replay);
      const result = await replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, position: 1, zipCode: "33433", approved: true
      } });
      expect(result.isError).toBe(true);
      expect(approve).not.toHaveBeenCalled();
      expect(quote).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });
  it("uses the current English request for consent after a Chinese snapshot", async () => {
    const approve = vi.fn(async () => ({ action: "decline" as const }));
    const quote = vi.fn(async () => quoteResult());
    const replay = await connectReplay(async () => searchResult(targets()), { cartQuotes: { quote } }, approve);
    try {
      const snapshot = await find(replay, "zh-CN");
      const result = await replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, position: 1, zipCode: "33433", responseLocale: "en-US"
      } });
      expect(approve).toHaveBeenCalledOnce();
      expect(JSON.stringify(approve.mock.calls)).toContain("Allow up to 1 temporary anonymous Carts");
      expect(JSON.stringify(result.content)).toContain("QUOTE_AUTHORIZATION_DECLINED");
      expect(JSON.stringify(result.content)).toContain("Existing products and selections are unchanged");
      expect(quote).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it.each(["single", "batch"])("discards a late %s quote when selection changes during the provider call", async mode => {
    const started = deferred<void>();
    const finish = deferred<ReturnType<typeof quoteResult>>();
    const quote = vi.fn(async () => { started.resolve(); return finish.promise; });
    const replay = await connectReplay(async () => searchResult(targets()), { cartQuotes: { quote } },
      async () => ({ action: "accept", content: { approved: true } }));
    try {
      const snapshot = await find(replay);
      const pending = replay.client.callTool({ name: mode === "single" ? "quote_selected_shopify_product" : "quote_and_compare_selected_products",
        arguments: { renderId: snapshot.renderId, zipCode: "33433", ...(mode === "single" ? { position: 1 } :
          { selectionIds: snapshot.products.map(item => item.selectionId) }) } });
      await started.promise;
      const synced = await replay.client.callTool({ name: "sync_product_card_selection", arguments: {
        renderId: snapshot.renderId, selectionIds: [snapshot.products[1]!.selectionId], revision: 1
      } });
      expect(synced.isError).not.toBe(true);
      finish.resolve(quoteResult());
      const result = await pending;
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.stringify(result.content)).toContain("QUOTE_RESULT_DISCARDED");
      if (mode === "single") expect(result._meta).toMatchObject({ "findcheap/quoteOperation": {
        renderId: snapshot.renderId, selectionId: snapshot.products[0]!.selectionId, selectionSource: "EXPLICIT"
      } });
      expect(JSON.stringify(result.content)).not.toContain("No quote Cart was created");
      const rendered = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: snapshot.renderId } });
      expect((rendered.structuredContent as Snapshot).products.map(item => item.quoteCapability))
        .toEqual(snapshot.products.map(item => item.quoteCapability));
    } finally { finish.resolve(quoteResult()); await replay.close(); }
  });
  it("does not call batch quote providers without host form authorization", async () => {
    const quote = vi.fn(async () => { throw new Error("QUOTE_MUST_NOT_RUN"); });
    const replay = await connectReplay(async () => searchResult([
      product({ handle: "456", checkoutPlatform: "SHOPIFY" }),
      product({ handle: "789", title: "Long human hair wig", checkoutPlatform: "SHOPIFY" })
    ]), { cartQuotes: { quote } });
    try {
      const found = await replay.client.callTool({ name: "search_shopify_products", arguments: {
        query: "wig", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE"
      } });
      const snapshot = found.structuredContent as { renderId: string; products: { selectionId: string }[] };
      expect(snapshot.products).toHaveLength(2);
      const result = await replay.client.callTool({ name: "quote_and_compare_selected_products", arguments: {
        renderId: snapshot.renderId, selectionIds: snapshot.products.map((item) => item.selectionId), zipCode: "33433"
      } });
      expect(quote).not.toHaveBeenCalled();
      expect(JSON.stringify(result.content)).toContain("QUOTE_AUTHORIZATION_UNAVAILABLE");
    } finally { await replay.close(); }
  });
  it("does not call an injected quote provider when the MCP host has no form capability", async () => {
    const quote = vi.fn(async () => { throw new Error("QUOTE_MUST_NOT_RUN_WITHOUT_HOST_AUTHORIZATION"); });
    const replay = await connectReplay(async () => searchResult([product({ handle: "456", checkoutPlatform: "SHOPIFY" })]),
      { cartQuotes: { quote } });
    try {
      const found = await replay.client.callTool({ name: "search_shopify_products", arguments: {
        query: "wig", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE"
      } });
      expect(found.isError, JSON.stringify(found.content)).not.toBe(true);
      const snapshot = found.structuredContent as { renderId: string };
      const result = await replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, position: 1, zipCode: "33433"
      } });
      expect(quote).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("QUOTE_AUTHORIZATION_UNAVAILABLE");
    } finally { await replay.close(); }
  });
});
