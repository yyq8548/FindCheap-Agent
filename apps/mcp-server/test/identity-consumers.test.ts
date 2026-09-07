import { describe, expect, it, vi } from "vitest";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";
import type { ProductCardContent } from "../src/server.js";
import type { ShopifyProduct } from "../src/shopify-client.js";

describe("identity decisions survive selected-product consumers", () => {
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
