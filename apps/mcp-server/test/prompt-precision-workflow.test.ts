import { describe, expect, it, vi } from "vitest";
import { parseAwinSearchInput, type AwinProductPort } from "../../../packages/awin-feed/src/index.js";
import type { ProductCardContent } from "../src/server.js";
import { evaluateRecoveredProducts, SearchProductsInputSchema } from "../src/search-products.js";
import { evaluateProductRequirements } from "../src/product-requirements.js";
import { connectReplay, product, REPLAY_NOW, searchResult } from "./fixtures/conversation-replay-support.js";

// Real MCP workflow with synthetic source facts, not a claim about live stock.
const emptyAwin: AwinProductPort = { search: async () => ({ source: "AWIN_PRODUCT_FEED", coverage: "COMPLETE",
  snapshotAt: REPLAY_NOW.toISOString(), products: [],
  diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 } }) };

describe("original prompt precision workflows (network forbidden)", () => {
  it("does not treat a quotation fee as the complete item price in reassessment or web recovery", () => {
    const fee = product({ sourceKind: "WEB_PRODUCT_PAGE", title: "Custom cosplay wig", itemPrice: { amountCents: 100, currency: "USD" },
      description: "The listed price is a quote request fee, applied toward your final order total." });
    const request = SearchProductsInputSchema.parse({ query: "wig", productType: "wig", primaryUse: "cosplay", maxItemPriceCents: 10000 });
    const assessment = evaluateProductRequirements(fee, request).assessment;
    expect(assessment.entries.find(entry => entry.requirement.startsWith("maximum item price"))?.status).toBe("UNKNOWN");
    expect(evaluateProductRequirements(fee, { ...request, maxItemPriceCents: undefined }).assessment.status).toBe("NEEDS_VERIFICATION");
    expect(evaluateRecoveredProducts(request, [fee], false).candidates).toHaveLength(0);
  });

  it("keeps the same use and compatibility gates on recovered web products", () => {
    const dailyWig = product({ sourceKind: "WEB_PRODUCT_PAGE", title: "Daily human hair wig", description: "Natural everyday style." });
    const cosplay = evaluateRecoveredProducts(SearchProductsInputSchema.parse({ query: "wig", productType: "wig", primaryUse: "cosplay" }), [dailyWig], false);
    expect(cosplay.candidates).toHaveLength(1);
    expect(cosplay.candidates[0]?.requirementAssessment?.status).toBe("NEEDS_VERIFICATION");
    const charger = product({ sourceKind: "WEB_PRODUCT_PAGE", title: "Tesla Wall Connector EV charging station", productType: "EV charging station",
      brand: "Tesla", description: "Complete NACS charger for the United States." });
    const recovered = evaluateRecoveredProducts(SearchProductsInputSchema.parse({ query: "EV charging station", productType: "EV charging station", brand: "Tesla" }), [charger], false);
    expect(recovered.candidates).toHaveLength(1);
    expect(recovered.candidates[0]?.requirementAssessment?.entries.filter(entry => entry.source === "MISSING")).toHaveLength(3);
    expect(recovered.candidates[0]?.presentationGroup).toBe("RESEARCH_ONLY");
  });

  it.each([
    ["Daily human hair wig", "Natural everyday style.", "cosplay"],
    ["Custom cosplay wig", "This listing is a deposit only for a cosplay wig.", "complete item price"]
  ])("cannot bypass necessary evidence when an inspected variant becomes %s", async (title, description, missing) => {
    const initial = product({ title: "Cosplay wig", handle: "1001", checkoutPlatform: "SHOPIFY", description: "This wig is for cosplay." });
    const replay = await connectReplay(async () => searchResult([initial]), { awin: emptyAwin,
      selectedProducts: { inspect: async () => ({ productTitle: "Wig", canonicalProductUrl: initial.merchantUrl,
        variants: [{ ...initial, handle: "1002", title, description, variantDimensions: { Color: "Brown" } }] }) } });
    try {
      const first = (await replay.client.callTool({ name: "search_products", arguments: {
        query: "wig", productType: "wig", primaryUse: "cosplay", responseLocale: "zh-CN"
      } })).structuredContent as ProductCardContent;
      expect(first.recommendation?.state).toBe("READY");
      const result = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
        renderId: first.renderId, selectionId: first.products[0]!.selectionId, variantDimensions: { Color: "Brown" }
      } });
      expect(result.isError).not.toBe(true);
      const updated = (result.structuredContent as { updatedSnapshot: ProductCardContent }).updatedSnapshot;
      expect(updated.requirementsSummary?.primaryUse).toBe("cosplay");
      expect(updated.recommendation?.state).not.toBe("READY");
      expect(updated.products[0]?.requirementAssessment?.entries.find(entry => entry.requirement === missing)?.status).toBe("UNKNOWN");
    } finally { await replay.close(); }
  });

  it("clarifies an EV goal once, searches later, and never recommends without user compatibility", async () => {
    const charger = product({ title: "Tesla Wall Connector EV charging station", productType: "EV charging station", brand: "Tesla",
      handle: "fixture-charger", description: "Complete charger for the United States with NACS connector.",
      itemPrice: { amountCents: 42000, currency: "USD" } });
    const search = vi.fn(async () => searchResult([charger]));
    const replay = await connectReplay(search, { awin: emptyAwin });
    try {
      const call = async (arguments_: Record<string, unknown>) => {
        const response = await replay.client.callTool({ name: "search_products", arguments: { responseLocale: "zh-CN", ...arguments_ } });
        expect(response.isError, JSON.stringify(response)).not.toBe(true);
        return response.structuredContent as ProductCardContent;
      };
      const first = await call({ query: "EV charging station", productType: "EV charging station" });
      expect(first.status).toBe("NEEDS_CLARIFICATION"); expect(search).not.toHaveBeenCalled();
      const second = await call({ query: "Tesla charging station", brand: "Tesla", brandMode: "REQUIRED",
        productType: "EV charging station", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: first.renderId });
      expect(second.status).toBe("OK"); expect(search).toHaveBeenCalled();
      expect(second.products.length).toBeGreaterThan(0);
      expect(second.recommendation?.state).toBe("RESEARCH_ONLY");
      expect(second.products[0]?.requirementAssessment?.entries.filter(entry => entry.source === "MISSING")).toHaveLength(3);
      const third = await call({ query: "EV charging station", maxItemPriceCents: 50000,
        contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: second.renderId });
      expect(third.status).toBe("OK"); expect(third.recommendation?.state).not.toBe("READY");
      expect(third.goalId).toBe(first.goalId);
      const ready = await call({ query: "EV charging station", requiredFeatures: ["United States", "NACS", "complete charger"],
        contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: third.renderId });
      expect(ready.recommendation?.state).toBe("READY");
      expect(ready.requirementsSummary).toMatchObject({ brand: "Tesla", maxItemPriceCents: 50000 });
      expect(second.requirementsSummary?.requiredFeatures).toEqual([]);
      // A fresh goal must not inherit the old goal's server-owned clarification flag.
      const fresh = await call({ query: "EV charging station", productType: "EV charging station", contextMode: "NEW_PRODUCT" });
      expect(fresh.status).toBe("NEEDS_CLARIFICATION"); expect(fresh.goalId).not.toBe(first.goalId);
    } finally { await replay.close(); }
  });

  it("evaluates the user's dry/frizzy symptom and fine hair without inventing a dry-hair audience", async () => {
    const shampoo = product({ title: "Example Shampoo", productType: "shampoo", brand: "Example", handle: "fixture-shampoo",
      description: "This shampoo helps reduce dryness and smooths frizz for fine hair.", itemPrice: { amountCents: 2200, currency: "USD" } });
    const replay = await connectReplay(async () => searchResult([shampoo]), { awin: emptyAwin });
    try {
      let previous = (await replay.client.callTool({ name: "search_products", arguments: { query: "shampoo", productType: "shampoo", responseLocale: "zh-CN" } })).structuredContent as ProductCardContent;
      for (const requiredFeatures of [["改善干燥毛躁"], ["for fine hair"]]) {
        const result = await replay.client.callTool({ name: "search_products", arguments: { query: "shampoo", requiredFeatures,
          responseLocale: "zh-CN", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: previous.renderId } });
        expect(result.isError).not.toBe(true);
        previous = result.structuredContent as ProductCardContent;
        expect(previous.products.map(item => item.handle)).toContain("fixture-shampoo");
        expect(previous.recommendation?.state).toBe("READY");
      }
      expect(previous.requirementsSummary?.requiredFeatures).toEqual(["改善干燥毛躁", "for fine hair"]);
      const strictAudience = await replay.client.callTool({ name: "search_products", arguments: {
        query: "shampoo", productType: "shampoo", requiredFeatures: ["for dry hair"], responseLocale: "zh-CN"
      } });
      expect((strictAudience.structuredContent as ProductCardContent).recommendation?.state).not.toBe("READY");
    } finally { await replay.close(); }
  });

  it.each([false, true])("updates the continuation query without discarding the USD100 limit (query-only appearance: %s)", async queryOnlyAppearance => {
    const ordinary = product();
    const named = product({ title: "王者荣耀 李白 原皮 假发", description: "角色扮演假发，李白原皮款。", handle: "fixture-libai",
      brand: "Example", itemPrice: { amountCents: 4900, currency: "USD" }, merchantUrl: "https://ishowbeauty.com/products/fixture-libai" });
    const shopify = vi.fn(async () => searchResult([ordinary, named]));
    const awin = vi.fn<AwinProductPort["search"]>(async ({ signal: _signal, ...input }) => {
      parseAwinSearchInput(input); return emptyAwin.search(input);
    });
    const replay = await connectReplay(shopify, { awin: { search: awin } });
    try {
      const first = (await replay.client.callTool({ name: "search_products", arguments: { query: "wig", productType: "wig", responseLocale: "zh-CN" } })).structuredContent as ProductCardContent;
      const second = (await replay.client.callTool({ name: "search_products", arguments: { query: "wig", primaryUse: "cosplay", maxItemPriceCents: 10000,
        responseLocale: "zh-CN", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: first.renderId } })).structuredContent as ProductCardContent;
      expect(second.requirementLedger?.find(entry => entry.field === "primaryUse")?.strength).toBe("REQUIRED");
      const primary = second.products.find(item => item.selectionId === second.recommendation?.primarySelectionId);
      expect(primary?.handle).not.toBe(ordinary.handle);
      awin.mockClear();
      const thirdResult = await replay.client.callTool({ name: "search_products", arguments: { query: "Honor of Kings Li Bai wig",
        requiredFeatures: ["Honor of Kings Li Bai character"], responseLocale: "zh-CN",
        contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: second.renderId } });
      expect(thirdResult.isError).not.toBe(true);
      const third = thirdResult.structuredContent as ProductCardContent;
      expect(awin.mock.calls.some(([input]) => input.query.includes("Li Bai"))).toBe(true);
      expect(third.products.map(item => item.handle)).toEqual(["fixture-libai"]);
      awin.mockClear();
      const finalResult = await replay.client.callTool({ name: "search_products", arguments: { query: "Honor of Kings Li Bai default appearance wig",
        ...(queryOnlyAppearance ? {} : { requiredFeatures: ["default appearance"] }), responseLocale: "zh-CN",
        contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: third.renderId } });
      expect(finalResult.isError).not.toBe(true);
      const final = finalResult.structuredContent as ProductCardContent;
      expect(final.goalId).toBe(first.goalId);
      expect(final.requirementsSummary).toMatchObject({ maxItemPriceCents: 10000, primaryUse: "cosplay",
        requiredFeatures: ["Honor of Kings Li Bai character", ...(queryOnlyAppearance ? [] : ["default appearance"])] });
      expect(final.products.map(item => item.handle)).toEqual(["fixture-libai"]);
      expect(final.products[0]?.requirementAssessment?.status).toBe("SATISFIED");
      expect(awin.mock.calls.some(([input]) => /Li Bai default|李白 原皮/u.test(input.query))).toBe(true);
      expect(awin.mock.calls.every(([input]) => input.maxItemPriceCents === 10000)).toBe(true);
    } finally { await replay.close(); }
  });
});
