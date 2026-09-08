import { describe, expect, it, vi } from "vitest";
import { connectReplay, searchResult } from "./fixtures/conversation-replay-support.js";

describe("coffee requirement clarification over MCP", () => {
  it("keeps the original goal when coffee is narrowed to whole beans with a US budget", async () => {
    const source = vi.fn(async () => searchResult([]));
    const replay = await connectReplay(source);
    try {
      const initial = await replay.client.callTool({ name: "search_products", arguments: {
        query: "coffee", productType: "coffee", responseLocale: "zh-CN", limit: 8,
        contextMode: "NEW_PRODUCT", selectionMode: "MERCHANT_DIVERSE"
      } });
      expect(initial.isError, JSON.stringify(initial.content)).not.toBe(true);
      const original = initial.structuredContent as { renderId: string; goalId: string; goalRevision: number };
      expect(original.renderId).toEqual(expect.any(String));
      source.mockClear();
      const continued = await replay.client.callTool({ name: "search_products", arguments: {
        query: "coffee beans", productType: "whole bean coffee", requiredFeatures: ["Ships to the United States"],
        maxItemPriceCents: 10000, responseLocale: "zh-CN", limit: 8, contextMode: "CONTINUE_PREVIOUS_PRODUCT",
        parentRenderId: original.renderId, selectionMode: "MERCHANT_DIVERSE"
      } });
      expect(continued.isError, JSON.stringify(continued.content)).not.toBe(true);
      expect(continued.structuredContent).toMatchObject({
        goalId: original.goalId, goalRevision: 2,
        requirementsSummary: { productType: "whole bean coffee", maxItemPriceCents: 10000,
          requiredFeatures: ["Ships to the United States"] }
      });
      expect(source).toHaveBeenCalledWith(expect.objectContaining({ query: expect.stringContaining("coffee") }));
      expect(original.goalRevision).toBe(1);
    } finally { await replay.close(); }
  });

  it.each([
    ["coffee", "whole bean coffee"], ["coffee", "ground coffee"], ["coffee", "coffee pods"], ["coffee", "instant coffee"],
    ["咖啡", "咖啡豆"], ["咖啡", "咖啡粉"], ["咖啡", "咖啡胶囊"], ["咖啡", "速溶咖啡"],
    ["whole bean coffee", "咖啡豆"], ["ground coffee", "咖啡粉"]
  ])("refines the category label from %s to %s without changing the identity query", async (before, after) => {
    const source = vi.fn(async () => searchResult([]));
    const replay = await connectReplay(source);
    try {
      const initial = await replay.client.callTool({ name: "search_products", arguments: {
        query: "coffee", productType: before, maxItemPriceCents: 10000,
        requiredFeatures: ["Ships to the United States"], responseLocale: "zh-CN", contextMode: "NEW_PRODUCT"
      } });
      expect(initial.isError, JSON.stringify(initial.content)).not.toBe(true);
      const original = initial.structuredContent as { renderId: string; goalId: string; goalRevision: number };
      const oldSnapshot = JSON.stringify(original);
      source.mockClear();
      const continued = await replay.client.callTool({ name: "search_products", arguments: {
        query: "coffee", productType: after, contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: original.renderId
      } });
      expect(continued.isError, JSON.stringify(continued.content)).not.toBe(true);
      expect(continued.structuredContent).toMatchObject({ goalId: original.goalId, goalRevision: 2,
        requirementsSummary: { productType: after, maxItemPriceCents: 10000, requiredFeatures: ["Ships to the United States"] } });
      expect(source).toHaveBeenCalled();
      expect(JSON.stringify(original)).toBe(oldSnapshot);
    } finally { await replay.close(); }
  });

  it.each([
    { label: "a different named coffee", first: { query: "JBC Coffee Roasters Panama Geisha", productType: "coffee" },
      next: { query: "JBC Coffee Roasters Kenya AB", productType: "coffee" } },
    { label: "a different exact model", first: { query: "Sony WH-1000XM6", brand: "Sony", productType: "over-ear headphones" },
      next: { query: "Sony WH-1000XM5", brand: "Sony", productType: "over-ear headphones" } },
    { label: "an unrelated category", first: { query: "coffee", productType: "coffee" },
      next: { query: "bicycle", productType: "bicycle" } },
    { label: "a conflicting coffee form", first: { query: "coffee beans", productType: "whole bean coffee" },
      next: { query: "ground coffee", productType: "ground coffee" } },
    { label: "a reversed coffee refinement", first: { query: "coffee beans", productType: "whole bean coffee" },
      next: { query: "coffee beans", productType: "coffee" } },
    { label: "a Chinese sibling form", first: { query: "coffee", productType: "咖啡豆" },
      next: { query: "coffee", productType: "咖啡粉" } },
    { label: "coffee equipment disguised as a subtype", first: { query: "coffee", productType: "coffee" },
      next: { query: "coffee", productType: "coffee grinder" } },
    { label: "a named replacement alongside an allowed type refinement", first: { query: "JBC Coffee Roasters Panama Geisha", productType: "coffee" },
      next: { query: "JBC Coffee Roasters Kenya AB", productType: "whole bean coffee" } },
    { label: "an unverified identity-query translation", first: { query: "coffee beans", productType: "whole bean coffee" },
      next: { query: "咖啡豆", productType: "咖啡豆" } }
  ])("rejects $label before any continuation source request", async ({ first, next }) => {
    const source = vi.fn(async () => searchResult([]));
    const replay = await connectReplay(source);
    try {
      const initial = await replay.client.callTool({ name: "search_products", arguments: {
        ...first, maxItemPriceCents: 10000, contextMode: "NEW_PRODUCT"
      } });
      expect(initial.isError, JSON.stringify(initial.content)).not.toBe(true);
      const original = initial.structuredContent as { renderId: string; goalId: string; goalRevision: number };
      source.mockClear();
      const continued = await replay.client.callTool({ name: "search_products", arguments: {
        ...next, contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: original.renderId
      } });
      expect(continued.isError, JSON.stringify(continued.content)).toBe(true);
      expect(JSON.stringify(continued.content)).toContain("PRODUCT_CONTEXT_CONFLICT");
      expect(source).not.toHaveBeenCalled();
      expect(original.goalRevision).toBe(1);
    } finally { await replay.close(); }
  });
});
