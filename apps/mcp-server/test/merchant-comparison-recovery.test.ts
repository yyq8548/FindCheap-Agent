import { describe, expect, it, vi } from "vitest";
import type { ElicitRequest, ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import type { ProductCardContent } from "../src/server.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

const request = { query: "Sony WH-1000XM6", productType: "headphones", brand: "Sony", comparisonMode: "SAME_PRODUCT",
  compareMerchants: true, requiredFeatures: ["black"], conditionPreference: "NEW", responseLocale: "zh-CN" };
const original = product({ sourceHost: "electronics.sony.com", merchantId: "sony", merchant: "Sony", title: "Sony WH-1000XM6 Black",
  brand: "Sony", productType: "headphones", mpn: "WH-1000XM6", variantDimensions: { Color: "Black" },
  merchantUrl: "https://electronics.sony.com/audio/headphones/headband/p/wh1000xm6-b", itemPrice: { amountCents: 39800, currency: "USD" } });
const recovered = product({ ...original, sourceKind: "WEB_PRODUCT_PAGE", merchantId: "reviewed-retailer", merchant: "Reviewed Retailer",
  sourceHost: "reviewed.example", merchantUrl: "https://reviewed.example/products/wh1000xm6-black",
  itemPrice: { amountCents: 39000, currency: "USD" } });
const awin = { search: async () => ({ source: "AWIN_PRODUCT_FEED" as const, coverage: "COMPLETE" as const,
  snapshotAt: original.checkedAt, products: [], diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 } }) };

describe("explicit merchant comparison preserves qualified earlier offers after bounded recovery", () => {
  it.each(["higher price", "out of stock", "read unavailable"])("handles a fresh observation without reviving stale facts: %s", async state => {
    const search = vi.fn(async () => searchResult([original]));
    const read = vi.fn(async () => {
      if (state === "read unavailable") throw new Error("fixture upstream timeout");
      return { ...original, sourceKind: "WEB_PRODUCT_PAGE" as const, checkedAt: "2026-09-04T19:51:01.000Z",
        availability: state === "out of stock" ? "OUT_OF_STOCK" as const : "IN_STOCK" as const,
        itemPrice: { amountCents: 41000, currency: "USD" as const } };
    });
    const replay = await connectReplay(search, { awin, webProducts: { read } }, async () => ({ action: "accept", content: { approved: true } }));
    try {
      const initial = await replay.client.callTool({ name: "search_products", arguments: request });
      const parent = initial.structuredContent as ProductCardContent;
      const begin = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: parent.renderId } });
      const result = await replay.client.callTool({ name: "complete_web_search", arguments: { renderId: parent.renderId,
        webSessionId: (begin.structuredContent as { webSessionId: string }).webSessionId, urls: [original.merchantUrl] } });
      const content = result.structuredContent as ProductCardContent;
      expect(content.products).toHaveLength(state === "out of stock" ? 0 : 1);
      if (state !== "out of stock") expect(content.products[0]).toMatchObject({
        itemPrice: { amountCents: state === "read unavailable" ? 39800 : 41000 },
        checkedAt: state === "read unavailable" ? original.checkedAt : "2026-09-04T19:51:01.000Z"
      });
      const old = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: parent.renderId } });
      expect((old.structuredContent as ProductCardContent).products[0]?.itemPrice).toEqual(original.itemPrice);
    } finally { await replay.close(); }
  });

  it.each([0, 1])("merges %i new verified merchants without discarding the original Sony offer", async count => {
    const search = vi.fn(async () => searchResult([original]));
    const read = vi.fn(async () => recovered);
    const approve = vi.fn(async (_params: ElicitRequest["params"]): Promise<ElicitResult> => ({ action: "accept", content: { approved: true } }));
    const replay = await connectReplay(search, { awin, webProducts: { read } }, approve);
    try {
      const initial = await replay.client.callTool({ name: "search_products", arguments: request });
      const parent = initial.structuredContent as ProductCardContent;
      const before = structuredClone(parent.products);
      const calls = search.mock.calls.length;
      const begin = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: parent.renderId } });
      const result = await replay.client.callTool({ name: "complete_web_search", arguments: { renderId: parent.renderId,
        webSessionId: (begin.structuredContent as { webSessionId: string }).webSessionId,
        urls: count === 0 ? [] : [recovered.merchantUrl] } });
      const content = result.structuredContent as ProductCardContent;
      expect(content.products).toHaveLength(count + 1);
      expect(content.products.find(item => item.merchantUrl === original.merchantUrl)).toMatchObject({
        checkedAt: original.checkedAt, itemPrice: original.itemPrice
      });
      expect(content.recovery).toMatchObject({ comparableMerchants: count + 1,
        action: count === 0 ? "REPORT_INCOMPLETE" : "NONE", reason: count === 0 ? "COMPARISON_INCOMPLETE" : "MATCH_FOUND" });
      expect(search).toHaveBeenCalledTimes(calls);
      expect(read).toHaveBeenCalledTimes(count);
      expect(approve.mock.calls[0]?.[0]).toMatchObject({ message: expect.not.stringContaining("未找到已核实符合要求的商品") });
      const old = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: parent.renderId } });
      expect((old.structuredContent as ProductCardContent).products).toEqual(before);
    } finally { await replay.close(); }
  });
});
