import { afterEach, describe, expect, it, vi } from "vitest";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";
import type { ProductCardContent } from "../src/server.js";
import { consumeQuoteAuthorization, type QuoteAuthorization } from "../src/quote-authorization.js";
import type { ShopifyProduct } from "../src/shopify-client.js";

afterEach(() => vi.restoreAllMocks());

const visualRequest = { query: "ivory boat neck mini dress", productType: "dress", responseLocale: "zh-CN",
  visualInput: { productType: "dress", colors: ["ivory"], neckline: "boat neck", length: "mini" } };
const similarVerdict = { classification: "HIGHLY_SIMILAR", matches: [
  { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
  { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "boat neck" }
], conflicts: [] };
const dress = (index: number) => product({ handle: `dress-${index}`, title: `Ivory boat neck mini dress ${index}`,
  productType: "dress", description: "ivory boat neck mini dress", imageUrl: `https://cdn.shopify.com/dress-${index}.jpg`,
  merchantUrl: `https://ishowbeauty.com/products/dress-${index}` });
type VisualSession = { visualSessionId: string; candidates: Array<{ candidateId: string }> };
const emptyAwin = { search: async () => ({ source: "AWIN_PRODUCT_FEED" as const, coverage: "COMPLETE" as const,
  snapshotAt: "2026-09-04T19:51:00.000Z", products: [],
  diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 } }) };

describe("service-flow MCP boundaries", () => {
  it("does not apply an expired search clock to a new independently authorized quote", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const quote = vi.fn(async (selected: ShopifyProduct, zip: string, permit?: QuoteAuthorization) => {
      expect(consumeQuoteAuthorization(permit, selected, zip)).toBeDefined();
      return { status: "ESTIMATED" as const, subtotal: { amountCents: 3641, currency: "USD" as const },
        shipping: { amountCents: 0, currency: "USD" as const, label: "Standard" },
        tax: { status: "SHOPIFY_REPORTED" as const, amount: { amountCents: 100, currency: "USD" as const },
          shopifyEstimated: false, source: "SHOPIFY_CART" as const },
        deliveredPrice: { amountCents: 3741, currency: "USD" as const }, totalEstimated: true,
        checkedAt: "2026-09-04T19:51:00.000Z", expiresAt: "2026-09-04T20:01:00.000Z" };
    });
    const replay = await connectReplay(async () => searchResult([product({ handle: "456", checkoutPlatform: "SHOPIFY" })]), { cartQuotes: { quote } }, approve);
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: { query: "wig", productType: "wig" } });
      const snapshot = first.structuredContent as ProductCardContent;
      clock = 95_000;
      const result = await replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, selectionId: snapshot.products[0]!.selectionId, zipCode: "10001" } });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect(approve).toHaveBeenCalledTimes(1); expect(quote).toHaveBeenCalledTimes(1);
    } finally { await replay.close(); }
  });

  it("cancels recovered page IO and preserves old references after an ignored late provider result", async () => {
    let started!: () => void, finish!: (value: ShopifyProduct) => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    let pageSignal: AbortSignal | undefined;
    const read = vi.fn((_url: string, _request: unknown, signal: AbortSignal) => {
      pageSignal = signal; started(); return new Promise<ShopifyProduct>(resolve => { finish = resolve; });
    });
    const replay = await connectReplay(async () => searchResult([]), { awin: emptyAwin, webProducts: { read } },
      async () => ({ action: "accept", content: { approved: true } }));
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: { query: "short human hair wig", productType: "wig" } });
      const snapshot = first.structuredContent as ProductCardContent;
      const begin = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: snapshot.renderId } });
      const parent = new AbortController();
      const pending = replay.client.callTool({ name: "complete_web_search", arguments: { renderId: snapshot.renderId,
        webSessionId: (begin.structuredContent as { webSessionId: string }).webSessionId,
        urls: ["https://ishowbeauty.com/products/fixture-short-wig"] } }, undefined, { signal: parent.signal });
      const rejected = expect(pending).rejects.toThrow();
      await entered; parent.abort(); await rejected;
      await vi.waitFor(() => expect(pageSignal?.aborted).toBe(true));
      finish(product({ sourceKind: "WEB_PRODUCT_PAGE" }));
      const old = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: snapshot.renderId } });
      expect(old.structuredContent).toEqual(snapshot);
      expect((await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: snapshot.renderId } })).structuredContent)
        .toMatchObject({ status: "PERMISSION_CANCELLED" });
      expect(read).toHaveBeenCalledTimes(1);
    } finally { await replay.close(); }
  });

  it("retains the original 180-second clock through descriptor web recovery and final visual review", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const url = "https://ishowbeauty.com/products/dress-1";
    const read = vi.fn(async () => ({ ...dress(1), sourceKind: "WEB_PRODUCT_PAGE" as const }));
    const load = vi.fn(async () => ({ data: Buffer.from("synthetic recovered dress").toString("base64"), mimeType: "image/jpeg" as const }));
    const replay = await connectReplay(async () => searchResult([]), { awin: emptyAwin, webProducts: { read }, visualCandidateImages: { load } },
      async () => ({ action: "accept", content: { approved: true } }));
    try {
      const first = await replay.client.callTool({ name: "search_visual_candidates", arguments: visualRequest });
      const original = first.structuredContent as ProductCardContent;
      expect(original.recovery?.action).toBe("REQUEST_WEB_SEARCH");
      clock = 100_000;
      const begin = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: original.renderId } });
      clock = 110_000;
      const completed = await replay.client.callTool({ name: "complete_web_search", arguments: { renderId: original.renderId,
        webSessionId: (begin.structuredContent as { webSessionId: string }).webSessionId, urls: [url] } });
      expect(completed.isError, JSON.stringify(completed.content)).not.toBe(true);
      expect(completed._meta?.["findcheap/searchTrace"]).toMatchObject({ traceId: (first._meta?.["findcheap/searchTrace"] as { traceId: string }).traceId,
        serviceBudget: { limitMs: 180_000, activeMs: 110_000, remainingMs: 70_000 } });
      const review = (completed.structuredContent as { visualReview: VisualSession }).visualReview;
      expect(review, JSON.stringify(completed.structuredContent)).toMatchObject({ candidates: [expect.any(Object)] });
      clock = 180_000;
      const finalized = await replay.client.callTool({ name: "finalize_visual_search", arguments: { visualSessionId: review.visualSessionId,
        verdicts: review.candidates.map(({ candidateId }) => ({ candidateId, verdict: similarVerdict })) } });
      expect(finalized.isError).not.toBe(true);
      expect((finalized.structuredContent as ProductCardContent).products).toHaveLength(1);
      expect(finalized._meta?.["findcheap/searchTrace"]).toMatchObject({ serviceBudget: { remainingMs: 0 }, budgetExhausted: true });
      expect(read).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledTimes(1);
    } finally { await replay.close(); }
  });

  it("pauses only the real web consent wait and caps recovery by the original text flow", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const approve = vi.fn(async () => { clock += 20_000; return { action: "accept" as const, content: { approved: true } }; });
    const read = vi.fn(async () => product());
    const replay = await connectReplay(async () => searchResult([]), { awin: emptyAwin, webProducts: { read } }, approve);
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: { query: "short human hair wig", productType: "wig", responseLocale: "zh-CN" } });
      const original = first.structuredContent as ProductCardContent;
      expect(original.recovery?.action).toBe("REQUEST_WEB_SEARCH");
      clock = 80_000;
      const begin = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: original.renderId } });
      expect(begin.structuredContent).toMatchObject({ status: "READY", limits: { durationMs: 10_000 } });
      clock = 110_001;
      const completed = await replay.client.callTool({ name: "complete_web_search", arguments: { renderId: original.renderId,
        webSessionId: (begin.structuredContent as { webSessionId: string }).webSessionId, urls: ["https://ishowbeauty.com/products/fixture-short-wig"] } });
      expect(completed.isError).toBe(true);
      expect(JSON.stringify(completed.content)).toContain("不能据此判断商品不存在");
      expect(completed._meta?.["findcheap/searchTrace"]).toMatchObject({ serviceBudget: { verifiedUserWaitMs: 20_000, remainingMs: 0 } });
      expect(read).not.toHaveBeenCalled();
      const again = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: original.renderId } });
      expect(again.structuredContent).toMatchObject({ status: "EXPIRED" });
      expect(approve).toHaveBeenCalledTimes(1);
      const old = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: original.renderId } });
      expect(old.structuredContent).toEqual(original);
    } finally { await replay.close(); }
  });

  it("keeps web page reads and their snapshot on the original text run", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const url = "https://ishowbeauty.com/products/fixture-short-wig";
    const read = vi.fn(async () => product({ sourceKind: "WEB_PRODUCT_PAGE", merchantUrl: url }));
    const replay = await connectReplay(async () => searchResult([]), { awin: emptyAwin, webProducts: { read } },
      async () => ({ action: "accept", content: { approved: true } }));
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: { query: "short human hair wig", productType: "wig" } });
      const original = first.structuredContent as ProductCardContent;
      clock = 40_000;
      const begin = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: original.renderId } });
      expect(begin.structuredContent).toMatchObject({ status: "READY" });
      clock = 50_000;
      const completed = await replay.client.callTool({ name: "complete_web_search", arguments: { renderId: original.renderId,
        webSessionId: (begin.structuredContent as { webSessionId: string }).webSessionId, urls: [url] } });
      expect(completed.isError).not.toBe(true);
      expect(read).toHaveBeenCalledTimes(1);
      expect(completed._meta?.["findcheap/searchTrace"]).toMatchObject({ traceId: (first._meta?.["findcheap/searchTrace"] as { traceId: string }).traceId,
        serviceBudget: { activeMs: 50_000, remainingMs: 40_000 },
        catalogRequests: (first._meta?.["findcheap/searchTrace"] as { catalogRequests: number }).catalogRequests + 1 });
      expect((completed.structuredContent as ProductCardContent).products).toHaveLength(1);
    } finally { await replay.close(); }
  });

  it("shares 180 seconds across both visual rounds and keeps accepted evidence after expiry without more IO", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const search = vi.fn(async () => searchResult(Array.from({ length: 8 }, (_, index) => dress(index))));
    const load = vi.fn(async (url: string) => ({ data: Buffer.from(url).toString("base64"), mimeType: "image/jpeg" as const }));
    const replay = await connectReplay(search, { visualCandidateImages: { load } });
    try {
      const first = await replay.client.callTool({ name: "search_visual_candidates", arguments: visualRequest });
      expect(first._meta?.["findcheap/searchTrace"]).toMatchObject({ serviceBudget: { limitMs: 180_000 } });
      const initial = first.structuredContent as VisualSession;
      expect(initial.candidates).toHaveLength(6);
      clock = 120_000;
      const second = await replay.client.callTool({ name: "finalize_visual_search", arguments: { visualSessionId: initial.visualSessionId,
        verdicts: initial.candidates.map(({ candidateId }) => ({ candidateId, verdict: similarVerdict })) } });
      expect(second.isError).not.toBe(true);
      const tail = (second.structuredContent as { visualReview: VisualSession }).visualReview;
      expect(tail.candidates).toHaveLength(2);
      expect(second._meta?.["findcheap/searchTrace"]).toMatchObject({ serviceBudget: { activeMs: 120_000, remainingMs: 60_000 } });
      const sourceCount = search.mock.calls.length, imageCount = load.mock.calls.length;
      clock = 180_000;
      const final = await replay.client.callTool({ name: "finalize_visual_search", arguments: { visualSessionId: tail.visualSessionId,
        verdicts: tail.candidates.map(({ candidateId }) => ({ candidateId, verdict: similarVerdict })) } });
      expect(final.isError).not.toBe(true);
      expect((final.structuredContent as ProductCardContent).products.length).toBeGreaterThan(0);
      expect(final._meta?.["findcheap/searchTrace"]).toMatchObject({ budgetExhausted: true,
        serviceBudget: { activeMs: 180_000, remainingMs: 0 } });
      expect(search).toHaveBeenCalledTimes(sourceCount); expect(load).toHaveBeenCalledTimes(imageCount);
      expect(JSON.stringify(final.structuredContent)).toContain("检索尚不完整");
    } finally { await replay.close(); }
  });

  it("propagates initial visual cancellation to the candidate image read", async () => {
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    let imageSignal: AbortSignal | undefined;
    const replay = await connectReplay(async () => searchResult([dress(1)]), {
      visualCandidateImages: { load: async (_url, options) => { imageSignal = options?.signal; started(); return new Promise(() => {}); } }
    });
    try {
      const parent = new AbortController();
      const pending = replay.client.callTool({ name: "search_visual_candidates", arguments: visualRequest }, undefined, { signal: parent.signal });
      const rejected = expect(pending).rejects.toThrow();
      await entered; parent.abort(); await rejected;
      await vi.waitFor(() => expect(imageSignal?.aborted).toBe(true));
    } finally { await replay.close(); }
  });

  it("keeps budget-skipped Awin capability unchecked through hydration, comparison and quote guards", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const resolve = vi.fn(async () => product());
    const quote = vi.fn(async () => { throw new Error("QUOTE_MUST_NOT_RUN"); });
    const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const replay = await connectReplay(async () => searchResult([]), {
      awin: { search: async () => ({ source: "AWIN_PRODUCT_FEED", coverage: "COMPLETE", snapshotAt: "2026-09-04T19:51:00.000Z",
        diagnostics: { feedRows: 2, validRows: 2, rejectedRows: 0, queryMatches: 2, priceProductsExcluded: 0 },
        products: [1, 2].map(index => ({ merchantId: "20282", merchant: "Amazonliss (US)", merchantProductId: String(index),
          title: `Hair mask ${index}`, category: "hair mask", matchStatus: "DISCOVERY_MATCH", matchEvidence: ["product family"],
          condition: "UNKNOWN", itemPrice: { amountCents: 1599 + index, currency: "USD" }, availability: "IN_STOCK",
          merchantUrl: `https://www.nutreecosmetics.com/products/hair-mask-${index}`,
          affiliateUrl: "https://www.awin1.com/pclick.php?p=40969355207&a=3047955&m=20282", checkedAt: "2026-09-04T19:51:00.000Z" })) }) },
      deals: { search: async () => { clock = 90_000; return []; } },
      awinShopifyQuotes: { supports: () => true, resolve }, cartQuotes: { quote }
    }, approve);
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: { query: "hair mask", productType: "hair mask", responseLocale: "zh-CN" } });
      const content = first.structuredContent as ProductCardContent;
      expect(content.products).toHaveLength(2);
      expect(content.products.map(entry => [entry.quoteCapability, entry.card.quoteCapability])).toEqual([
        ["NOT_CHECKED", "NOT_CHECKED"], ["NOT_CHECKED", "NOT_CHECKED"]
      ]);
      expect(content.products[0]!.itemPrice?.amountCents).toBe(1600);
      expect(first._meta?.["findcheap/quotePreflight"]).toMatchObject({ skippedBudget: 2, attempted: 0 });
      expect(first._meta?.["findcheap/searchTrace"]).toMatchObject({ returned: 2 });
      const selected = content.products.map(entry => entry.selectionId);
      const compared = await replay.client.callTool({ name: "compare_selected_products", arguments: {
        renderId: content.renderId, selectionIds: selected, responseLocale: "zh-CN" } });
      expect((compared.structuredContent as { entries: Array<{ deliveredTotalStatus: string }> }).entries.map(entry => entry.deliveredTotalStatus))
        .toEqual(["NOT_CHECKED", "NOT_CHECKED"]);
      for (const args of [
        { name: "quote_selected_shopify_product", arguments: { renderId: content.renderId, selectionId: selected[0], zipCode: "10001", responseLocale: "zh-CN" } },
        { name: "quote_and_compare_selected_products", arguments: { renderId: content.renderId, selectionIds: selected, zipCode: "10001", responseLocale: "zh-CN" } }
      ]) expect((await replay.client.callTool(args)).isError).toBe(true);
      const old = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: content.renderId } });
      expect(old.structuredContent).toEqual(content);
      expect(resolve).not.toHaveBeenCalled(); expect(approve).not.toHaveBeenCalled(); expect(quote).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("cancels the actual text provider and does not turn its late result into a usable snapshot", async () => {
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    let finish!: (value: ReturnType<typeof searchResult>) => void;
    let sourceSignal: AbortSignal | undefined;
    const search = vi.fn((input: { signal?: AbortSignal }) => {
      sourceSignal = input.signal;
      started();
      return new Promise<ReturnType<typeof searchResult>>(resolve => { finish = resolve; });
    });
    const replay = await connectReplay(search);
    try {
      const parent = new AbortController();
      const pending = replay.client.callTool({ name: "search_products", arguments: { query: "wig", productType: "wig" } }, undefined, { signal: parent.signal });
      const rejected = expect(pending).rejects.toThrow();
      await entered; parent.abort(); await rejected;
      await vi.waitFor(() => expect(sourceSignal?.aborted).toBe(true));
      finish(searchResult([product()]));
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(search).toHaveBeenCalledOnce();
    } finally { await replay.close(); }
  });

  it("gives a new explicit continuation its own text flow while retaining original references", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const replay = await connectReplay(async () => searchResult([product()]));
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: { query: "wig", productType: "wig" } });
      const content = first.structuredContent as ProductCardContent;
      clock = 100_000;
      const next = await replay.client.callTool({ name: "search_products", arguments: { query: "wig", productType: "wig",
        contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: content.renderId, maxItemPriceCents: 5_000 } });
      expect(next.isError).not.toBe(true);
      expect(next._meta?.["findcheap/searchTrace"]).toMatchObject({ serviceBudget: { limitMs: 90_000, activeMs: 0, cancelled: false } });
      const old = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: content.renderId } });
      expect(old.structuredContent).toEqual(content);
    } finally { await replay.close(); }
  });
});
