import { describe, expect, it, vi } from "vitest";
import { connectReplay, searchResult } from "./fixtures/conversation-replay-support.js";

describe("Sony family clarification at the MCP boundary", () => {
  it.each(["search_products", "search_shopify_products"])("keeps a query-only Sony family clarification safe through %s", async name => {
    const search = vi.fn(async () => searchResult([]));
    const replay = await connectReplay(search);
    try {
      const first = await replay.client.callTool({ name, arguments: { query: "Sony 1000XM5", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE", maxItemPriceCents: 35000 } });
      expect(first.isError, JSON.stringify(first.content)).not.toBe(true);
      expect(search).not.toHaveBeenCalled();
      const original = first.structuredContent as { renderId: string };
      const next = await replay.client.callTool({ name: "search_products", arguments: { query: "Sony WH-1000XM5",
        productType: "over-ear headphones", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: original.renderId } });
      expect(next.isError, JSON.stringify(next.content)).not.toBe(true);
      expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: "Sony WH-1000XM5", maxItemPriceCents: 35000 }));
    } finally { await replay.close(); }
  });
  it.each(["DISCOVERY", "SAME_PRODUCT"])("clarifies %s before sources and preserves the budget on type-only continuation", async comparisonMode => {
    const search = vi.fn(async () => searchResult([]));
    const replay = await connectReplay(search);
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: {
        query: "Sony 1000XM5", brand: "Sony", productType: "headphones", comparisonMode,
        requiredFeatures: ["black"], maxItemPriceCents: 35000, responseLocale: "zh-CN"
      } });
      expect(first.isError).not.toBe(true);
      expect(search).not.toHaveBeenCalled();
      expect(JSON.stringify(first.structuredContent)).toContain("WH");
      expect(JSON.stringify(first.structuredContent)).toContain("WF");
      const original = first.structuredContent as { renderId: string; goalId: string };
      expect(original.renderId).toBeTruthy();
      const next = await replay.client.callTool({ name: "search_products", arguments: {
        query: "Sony 1000XM5", productType: "over-ear headphones", contextMode: "CONTINUE_PREVIOUS_PRODUCT",
        parentRenderId: original.renderId
      } });
      expect(next.isError, JSON.stringify(next.content)).not.toBe(true);
      expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: "Sony WH-1000XM5", maxItemPriceCents: 35000 }));
      expect(next.structuredContent).toMatchObject({ goalId: original.goalId,
        requirementsSummary: { requiredFeatures: ["black"], maxItemPriceCents: 35000 } });
      expect(first.structuredContent).toMatchObject({ renderId: original.renderId });
    } finally { await replay.close(); }
  });
});
