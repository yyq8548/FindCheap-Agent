import { describe, expect, it, vi } from "vitest";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";
import type { ProductCardContent } from "../src/server.js";
import type { ShopifyProduct } from "../src/shopify-client.js";
import { createShopifySelectedProductInspector } from "../src/shopify-selected-product.js";

describe("identity decisions survive selected-product consumers", () => {
  it.each(["changed-path", "invalid-json", "unknown"])("reports safe localized inspection failure without replacement: %s", mode => {
    return (async () => {
      const selected = product({ sourceHost: "medicube.us", merchant: "medicube", title: "medicube Zero Pore Pad Mild",
        productType: "toner pads", brand: "medicube", handle: "123", merchantUrl: "https://medicube.us/products/pads?variant=123" });
      const search = vi.fn(async () => searchResult([selected]));
      const inspector = createShopifySelectedProductInspector({ fetchProduct: async url => {
        if (mode === "unknown") throw new Error("private-provider-token-DO-NOT-LEAK");
        return { finalUrl: mode === "changed-path" ? "https://medicube.us/products/other.js" : url,
          response: new Response("private-provider-token-DO-NOT-LEAK") };
      } });
      const replay = await connectReplay(search, { selectedProducts: inspector });
      try {
        const first = await replay.client.callTool({ name: "search_products", arguments: {
          query: "medicube Zero Pore Pad Mild", brand: "medicube", productType: "toner pads", responseLocale: "zh-CN"
        } });
        const snapshot = first.structuredContent as ProductCardContent;
        const calls = search.mock.calls.length;
        const failure = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: { renderId: snapshot.renderId, position: 1 } });
        expect(failure.isError).toBe(true);
        expect(failure._meta?.["findcheap/inspectionFailure"]).toMatchObject({
          reason: mode === "changed-path" ? "TARGET_CHANGED" : mode === "invalid-json" ? "SCHEMA_INVALID" : "UNKNOWN",
          host: "medicube.us"
        });
        expect(JSON.stringify(failure)).toContain("未搜索替代商品");
        expect(JSON.stringify(failure)).not.toContain("private-provider-token");
        expect(search).toHaveBeenCalledTimes(calls);
      } finally { await replay.close(); }
    })();
  });
  it("retains research identity through selection, comparison, inspection and historical rendering", async () => {
    const mild = product({ merchantId: "catalog", sourceHost: "medicube.us", merchant: "medicube",
      title: "medicube Zero Pore Pad Mild", productType: "toner pads", brand: "medicube",
      handle: "123", merchantUrl: "https://medicube.us/products/pads?variant=123" });
    const duplicate = { ...mild, merchantId: "official-medicube.us" };
    const other = { ...mild, merchantId: "other", sourceHost: "other.example", merchantUrl: "https://other.example/products/pads?variant=123" };
    const inspect = vi.fn(async (selected: ShopifyProduct) => ({ productTitle: selected.title,
      canonicalProductUrl: "https://medicube.us/products/pads", variants: [{ ...selected, matchStatus: "EXACT" as const }] }));
    const quote = vi.fn(async () => { throw new Error("UNAUTHORIZED_CART_WRITE"); });
    const replay = await connectReplay(async () => searchResult([mild, duplicate, other]), { selectedProducts: { inspect }, cartQuotes: { quote } });
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: {
        query: "medicube Zero Pore Pad", brand: "medicube", productType: "toner pads", responseLocale: "zh-CN"
      } });
      expect(first.isError).not.toBe(true);
      const snapshot = first.structuredContent as ProductCardContent;
      expect(snapshot.products).toHaveLength(2);
      const ids = snapshot.products.map(product => product.selectionId!);
      expect((await replay.client.callTool({ name: "sync_product_card_selection", arguments: {
        renderId: snapshot.renderId, selectionIds: ids, revision: 1
      } })).isError).not.toBe(true);
      const comparison = await replay.client.callTool({ name: "compare_selected_products", arguments: {
        renderId: snapshot.renderId, selectionIds: ids, responseLocale: "zh-CN"
      } });
      expect(comparison.isError).not.toBe(true);
      expect(comparison.structuredContent).toMatchObject({ recommendation: { state: "RESEARCH_ONLY" },
        entries: ids.map(selectionId => expect.objectContaining({ selectionId, requestIdentityStatus: "NEEDS_VERIFICATION" })) });
      const official = snapshot.products.find(product => product.merchantId === "official-medicube.us")!;
      const inspected = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, selectionId: official.selectionId
      } });
      expect(inspected.isError).not.toBe(true);
      expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ merchantId: "official-medicube.us", handle: "123" }), {});
      const updated = await replay.client.callTool({ name: "render_product_cards", arguments: {
        renderId: (inspected.structuredContent as { updatedSnapshot: ProductCardContent }).updatedSnapshot.renderId
      } });
      expect(updated.structuredContent).toMatchObject({ recommendation: { state: "RESEARCH_ONLY" } });
      expect((updated.structuredContent as ProductCardContent).products.every(product => product.requestIdentityStatus === "NEEDS_VERIFICATION")).toBe(true);
      expect((updated.structuredContent as ProductCardContent).products.every(product => product.matchStatus === "DISCOVERY_MATCH" && product.card.matchBadge === product.matchStatus)).toBe(true);
      const original = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: snapshot.renderId } });
      expect((original.structuredContent as ProductCardContent).products.map(product => product.selectionId)).toEqual(ids);
      expect(quote).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });
});
