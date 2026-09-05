import { describe, expect, it, vi } from "vitest";
import { parseAwinSearchInput, type AwinProduct, type AwinProductPort } from "../../../packages/awin-feed/src/index.js";
import { connectReplay, product, REPLAY_NOW, searchResult } from "./fixtures/conversation-replay-support.js";
import type { ProductCardContent } from "../src/server.js";

// Actual MCP handlers over InMemoryTransport; all merchant facts are synthetic.
// This verifies the workflow contracts, not live inventory, vision or host consent.
const awinResult = (products: AwinProduct[] = []) => ({ source: "AWIN_PRODUCT_FEED" as const, coverage: "COMPLETE" as const,
  snapshotAt: REPLAY_NOW.toISOString(), products,
  diagnostics: { feedRows: products.length, validRows: products.length, rejectedRows: 0, queryMatches: products.length, priceProductsExcluded: 0 } });
const emptyAwin = { search: async () => awinResult() };

describe("01a070eb / 01a070f2 business MCP replay (network forbidden)", () => {
  it("retains a useful Ghost candidate through five refinements with scoped claim evidence", async () => {
    const ghost = product({ title: "Ghost Shampoo 355 mL", productType: "shampoo", brand: "Verb", handle: "fixture-ghost",
      merchantId: "fixture-stockist", merchant: "Synthetic reviewed stockist", sourceHost: "stockist.example.com",
      merchantUrl: "https://stockist.example.com/products/fixture-ghost", itemPrice: { amountCents: 2200, currency: "USD" },
      description: "A lightweight, moringa oil-infused shampoo that cleanses, hydrates, and smooths frizz for fine to medium hair.",
      productRating: { value: 4.5, count: 20, scaleMax: 5 } });
    const search = vi.fn(async () => searchResult([ghost]));
    const replay = await connectReplay(search, { awin: emptyAwin });
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: {
        query: "shampoo", productType: "shampoo", maxItemPriceCents: 4000, responseLocale: "zh-CN"
      } });
      expect(first.isError).not.toBe(true);
      const initial = first.structuredContent as ProductCardContent;
      let content = initial;
      for (const patch of [
        { primaryUse: "改善干燥毛躁" },
        { requiredFeatures: ["moisturizing", "anti-frizz"] },
        { requiredFeatures: ["suitable for fine hair"] },
        { maxItemPriceCents: 3000 },
        { preferences: ["lightweight"] }
      ]) {
        const next = await replay.client.callTool({ name: "search_products", arguments: {
          query: "shampoo", contextMode: "CONTINUE_PREVIOUS_PRODUCT", goalId: content.goalId,
          goalRevision: content.goalRevision, responseLocale: "zh-CN", ...patch
        } });
        expect(next.isError).not.toBe(true);
        content = next.structuredContent as ProductCardContent;
        expect(content.goalId).toBe(initial.goalId);
        expect(content.products.map(item => item.handle)).toContain("fixture-ghost");
        expect(content.recommendation?.state).toBe("READY");
      }
      expect(content.goalRevision).toBe(6);
      expect(content.requirementsSummary).toMatchObject({ primaryUse: "改善干燥毛躁", maxItemPriceCents: 3000,
        requiredFeatures: ["moisturizing", "anti-frizz", "suitable for fine hair"], preferences: ["lightweight"] });
      const final = content.products.find(item => item.handle === "fixture-ghost")!;
      expect(final.requirementAssessment?.status).toBe("SATISFIED");
      for (const requirement of ["moisturizing", "anti-frizz", "suitable for fine hair"]) {
        expect(final.requirementAssessment?.entries.find(item => item.requirement === requirement)).toMatchObject({
          status: "MATCHED", evidence: [expect.objectContaining({ kind: "MERCHANT_CLAIM", field: "DESCRIPTION", scope: "PRODUCT" })]
        });
      }
      expect(final.checkedAt).toBe(REPLAY_NOW.toISOString());
      expect(final.qualityEvidence?.qualityGuaranteed).toBe(false);
      expect(initial.requirementsSummary).toMatchObject({ maxItemPriceCents: 4000, requiredFeatures: [] });
      expect(replay.network).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("locks Li Bai default appearance while preserving the 100 USD goal and using valid short Awin queries", async () => {
    const wig: AwinProduct = { merchantId: "fixture-merchant", merchant: "Synthetic reviewed cosplay seller", merchantProductId: "fixture-libai",
      title: "王者荣耀 李白 原皮 假发", category: "wig", matchStatus: "DISCOVERY_MATCH", matchEvidence: ["synthetic category claim"],
      condition: "UNKNOWN", itemPrice: { amountCents: 4900, currency: "USD" }, availability: "IN_STOCK",
      merchantUrl: "https://cosplay.example.com/products/fixture-libai", checkedAt: REPLAY_NOW.toISOString(),
      affiliateUrl: "https://www.awin1.com/cread.php?awinmid=100&awinaffid=3047955&ued=https%3A%2F%2Fcosplay.example.com%2Fproducts%2Ffixture-libai" };
    const search = vi.fn<AwinProductPort["search"]>(async ({ signal: _signal, ...input }) => {
      parseAwinSearchInput(input);
      return awinResult([wig]);
    });
    const replay = await connectReplay(async () => searchResult([]), { awin: { search } });
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: {
        query: "wig", productType: "wig", primaryUse: "cosplay", maxItemPriceCents: 10000, responseLocale: "zh-CN"
      } });
      const previous = first.structuredContent as ProductCardContent;
      search.mockClear();
      // A clarified identity uses the explicit correction contract, not NEW_PRODUCT.
      const next = await replay.client.callTool({ name: "search_products", arguments: {
        query: "Honor of Kings Li Bai default costume wig 王者荣耀 李白 原皮 假发", productType: "wig",
        contextMode: "CORRECT_PREVIOUS_PRODUCT", goalId: previous.goalId, goalRevision: previous.goalRevision,
        requiredFeatures: ["Li Bai (李白) from Honor of Kings (王者荣耀), default appearance"], responseLocale: "zh-CN"
      } });
      expect(next.isError).not.toBe(true);
      const content = next.structuredContent as ProductCardContent;
      expect(content.goalId).toBe(previous.goalId);
      expect(content.requirementsSummary).toMatchObject({ maxItemPriceCents: 10000, primaryUse: "cosplay" });
      expect(content.sources?.awin).toBe("COMPLETE");
      expect(content.sourceErrors?.awin).toBeUndefined();
      expect(content.products).toHaveLength(1);
      expect(content.products[0]).toMatchObject({ title: wig.title, requirementAssessment: { status: "SATISFIED" } });
      expect(content.products[0]?.matchStatus).not.toBe("EXACT");
      expect(search.mock.calls.map(([input]) => input.query)).toEqual(["Honor of Kings Li Bai default wig", "王者荣耀 李白 原皮 假发"]);
      expect(search.mock.calls.every(([input]) => input.maxItemPriceCents === 10000)).toBe(true);
      expect(replay.network).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("clarifies EV compatibility before searching and keeps a clarified generic charger in category discovery", async () => {
    const shopify = vi.fn(async () => searchResult([]));
    const awin = vi.fn<AwinProductPort["search"]>(async ({ signal: _signal, ...input }) => { parseAwinSearchInput(input); return awinResult(); });
    const replay = await connectReplay(shopify, { awin: { search: awin } });
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: {
        query: "EV charging station", productType: "EV charging station", responseLocale: "zh-CN"
      } });
      expect(first.isError).not.toBe(true);
      const previous = first.structuredContent as ProductCardContent;
      expect(previous.status).toBe("NEEDS_CLARIFICATION");
      expect(previous.recommendation?.question).toMatch(/国家|地区/u);
      expect(previous.recommendation?.question).toMatch(/接口/u);
      expect(previous.recommendation?.question).toMatch(/整机|套件/u);
      expect(shopify).not.toHaveBeenCalled(); expect(awin).not.toHaveBeenCalled();
      const next = await replay.client.callTool({ name: "search_products", arguments: {
        query: "EV charging station", contextMode: "CONTINUE_PREVIOUS_PRODUCT", goalId: previous.goalId,
        goalRevision: previous.goalRevision, requiredFeatures: ["United States", "NACS", "complete charger"], responseLocale: "zh-CN"
      } });
      expect(next.isError).not.toBe(true);
      const content = next.structuredContent as ProductCardContent;
      expect(content.status).toBe("OK");
      expect(content.searchIntent).toBe("CATEGORY_DISCOVERY");
      expect(content.goalId).toBe(previous.goalId);
      expect(content.requirementsSummary?.requiredFeatures).toEqual(["United States", "NACS", "complete charger"]);
      expect(shopify).toHaveBeenCalled(); expect(awin).toHaveBeenCalled();
      expect(replay.network).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });
});
