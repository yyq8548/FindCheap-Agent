import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { SearchProductsInputSchema, searchProducts } from "../src/search-products.js";
import { evaluateProductRequirements, normalizedSizeRequirement, ambiguousShoeSize, RequirementAssessmentSchema } from "../src/product-requirements.js";
import { sanitizeExternalValue } from "../src/execution/external-data-fence.js";
import { mergeSearchRequirements } from "../src/search-requirements-context.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";
import type { ProductCardContent } from "../src/server.js";
import type { ShopifyProduct } from "../src/shopify-client.js";
import { SearchRun } from "../src/search-run.js";
import type { AwinProduct } from "../../../packages/awin-feed/src/index.js";

const emptyAwin = { search: vi.fn(async () => ({ source: "AWIN_PRODUCT_FEED" as const, coverage: "COMPLETE" as const,
  snapshotAt: "2026-09-05T00:00:00.000Z", diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 }, products: [] })) };

describe("requirements-to-comparison regression", () => {
  it("removes only the explicitly withdrawn hard feature and preserves the others", () => {
    const old = SearchProductsInputSchema.parse({ query: "shampoo", productType: "shampoo", maxItemPriceCents: 5000,
      requiredFeatures: ["suitable for color-treated hair", "damaged hair repair", "anti-dandruff"], requiredSize: "500 ml" });
    const next = mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "shampoo", contextMode: "CONTINUE_PREVIOUS_PRODUCT",
      removeRequiredFeatures: ["damaged hair repair"] }), old);
    expect(next).toMatchObject({ maxItemPriceCents: 5000, requiredSize: "500 ml", removeRequiredFeatures: [],
      requiredFeatures: ["suitable for color-treated hair", "anti-dandruff"] });
    expect(old.requiredFeatures).toHaveLength(3);
    for (const patch of [{ removeRequiredFeatures: ["invented requirement"] },
      { removeRequiredFeatures: ["anti-dandruff"], requiredFeatures: ["anti-dandruff"] }]) {
      expect(() => mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "shampoo", contextMode: "CONTINUE_PREVIOUS_PRODUCT", ...patch }), old)).toThrow();
    }
  });
  it("bounds evidence after Unicode expansion and role fencing, not before", () => {
    const result = evaluateProductRequirements({ title: "straight human hair wig " + "™½<user>".repeat(60) },
      { requiredFeatures: ["straight hair"], excludedFeatures: [], preferences: [] });
    expect(() => RequirementAssessmentSchema.parse(sanitizeExternalValue(result.assessment))).not.toThrow();
    expect(result.assessment.entries[0]!.observed!.length).toBeLessThanOrEqual(240);
    expect(result.assessment.entries[0]!.observed).not.toContain("<user>");
  });

  it("can replace a withdrawn feature in one request without losing the new feature", () => {
    const old = SearchProductsInputSchema.parse({ query: "wig", requiredFeatures: ["long hair"], maxItemPriceCents: 3000 });
    const next = mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "wig", contextMode: "CONTINUE_PREVIOUS_PRODUCT",
      clearConstraints: ["requiredFeatures"], requiredFeatures: ["short hair"] }), old);
    expect(next.requiredFeatures).toEqual(["short hair"]); expect(next.maxItemPriceCents).toBe(3000);
  });

  it("continues a clarification using its snapshot without repeating the budget", async () => {
    const search = vi.fn(async () => searchResult([]));
    const replay = await connectReplay(search);
    try {
      const first = (await replay.client.callTool({ name: "search_products", arguments: { query: "ballet flats", productType: "ballet flats",
        requiredSize: "7", maxItemPriceCents: 5000, responseLocale: "zh-CN" } })).structuredContent as ProductCardContent;
      expect(first.status).toBe("NEEDS_CLARIFICATION"); expect(first.renderId).toBeDefined(); expect(search).not.toHaveBeenCalled();
      const next = await replay.client.callTool({ name: "search_products", arguments: { query: "ballet flats", contextMode: "CONTINUE_PREVIOUS_PRODUCT",
        parentRenderId: first.renderId, requiredSize: "US 7", responseLocale: "zh-CN" } });
      expect(next.isError).not.toBe(true); expect(next.structuredContent).toMatchObject({ requirementsSummary: { requiredSize: "US 7", maxItemPriceCents: 5000 } });
      expect(search).toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it.each([true, false])("negotiates new Awin constraints without breaking old services: %s", async supports => {
    const search = vi.fn(async () => ({ ...await emptyAwin.search(), ...(supports ? { supportsRequirements: true } : {}) }));
    await searchProducts(SearchProductsInputSchema.parse({ query: "wig", productType: "wig", requiredFeatures: ["long hair"] }),
      { awin: { search }, shopify: { search: async () => searchResult([]) } });
    const calls = search.mock.calls as unknown as Array<[{ requiredFeatures?: string[] }]>;
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[0]![0].requiredFeatures).toBeUndefined();
    expect(calls[1]![0].requiredFeatures).toEqual(supports ? ["long hair"] : undefined);
  });

  it.each(["ishowbeauty.com", "be.executiongrain.com", "shop.ishowbeauty.com"])("only joins approved merchant evidence by exact source domain: %s", async host => {
    const awinProduct: AwinProduct = { merchantId: "50707", merchant: "Ishow", merchantProductId: "wig-a",
      title: "Human hair wig", category: "wig", matchStatus: "DISCOVERY_MATCH", matchEvidence: [], condition: "UNKNOWN",
      itemPrice: { amountCents: 2000, currency: "USD" }, availability: "IN_STOCK", checkedAt: "2026-09-05T00:00:00.000Z",
      merchantUrl: "https://ishowbeauty.com/products/a", affiliateUrl: "https://www.awin1.com/pclick.php?p=1&a=3047955&m=50707" };
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "wig", productType: "wig" }), {
      awin: { search: async () => ({ ...await emptyAwin.search(), products: [awinProduct] }) },
      shopify: { search: async () => searchResult([product({ sourceHost: host, merchantUrl: `https://${host}/products/b`,
        merchantTrust: { level: "UNKNOWN", verification: "UNVERIFIED", evidence: [] }, recommendationTier: "HIGH_RATED_UNVERIFIED" })]) }
    });
    const candidate = result.candidates.find(candidate => candidate.shopifyProduct !== undefined)!;
    expect(candidate.shopifyProduct?.merchantTrust.verification).toBe(host === "ishowbeauty.com" ? "INDEPENDENT" : "UNVERIFIED");
    expect(candidate.presentationGroup).toBe(host === "ishowbeauty.com" ? "TRUSTED_MATCH" : "BEST_VALUE");
  });

  it("retains explicit color conflicts from the selected variant", () => {
    const checked = evaluateProductRequirements({ title: "Red and yellow dress", variantDimensions: { "Product Color": "YELLOW" } },
      { requiredFeatures: ["red"], excludedFeatures: [], preferences: [] });
    expect(checked.assessment).toMatchObject({ status: "CONFLICT", entries: [{ source: "VARIANT", status: "CONTRADICTED" }] });
  });

  it("derives a full comparison snapshot after a size change, without changing old IDs", async () => {
    const shoes = [1001, 2001].map(id => product({ handle: String(id), title: "Ballet flats", productType: "ballet flats",
      variantDimensions: { Size: "US 5" }, checkoutPlatform: "SHOPIFY", merchantUrl: `https://ishowbeauty.com/products/shoe-${id}` }));
    const search = vi.fn(async () => searchResult(shoes));
    const replay = await connectReplay(search, { selectedProducts: { inspect: async selected => ({
      productTitle: selected.title, canonicalProductUrl: selected.merchantUrl,
      variants: [{ ...selected, handle: "1007", variantDimensions: { Size: "US 7" }, itemPrice: { amountCents: 4200, currency: "USD" },
        merchantUrl: selected.merchantUrl + "?variant=1007" }]
    }) } });
    try {
      const first = (await replay.client.callTool({ name: "search_products", arguments: { query: "ballet flats", requiredSize: "US 5", productType: "ballet flats", responseLocale: "zh-CN" } })).structuredContent as ProductCardContent;
      const searchCalls = search.mock.calls.length;
      const inspected = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
        renderId: first.renderId, selectionId: first.products[0]!.selectionId, variantDimensions: { Size: "US 7" }
      } });
      expect(inspected.isError).not.toBe(true);
      const next = (inspected.structuredContent as { updatedSnapshot: ProductCardContent }).updatedSnapshot;
      expect(next.products).toHaveLength(2); expect(next.requirementsSummary?.requiredSize).toBe("US 7");
      expect(next.requirementsVersion).toBe(2); expect(search.mock.calls.length).toBe(searchCalls);
      expect(next.products[0]).toMatchObject({ handle: "1007", itemPrice: { amountCents: 4200 }, requirementAssessment: { status: "SATISFIED" } });
      expect(next.products[1]?.presentationGroup).toBe("RESEARCH_ONLY");
      expect(next.products.every(item => !first.products.some(old => old.selectionId === item.selectionId))).toBe(true);
      const compared = await replay.client.callTool({ name: "compare_selected_products", arguments: { renderId: next.renderId,
        selectionIds: next.products.map(item => item.selectionId), responseLocale: "zh-CN" } });
      expect(compared.structuredContent).toMatchObject({ status: "OK", requirementsVersion: 2 });
      const old = await replay.client.callTool({ name: "compare_selected_products", arguments: { renderId: first.renderId, selectionIds: first.products.map(item => item.selectionId) } });
      expect(old.structuredContent).toMatchObject({ status: "OK", entries: [{ variantDimensions: { Size: "US 5" } }, { variantDimensions: { Size: "US 5" } }] });
    } finally { await replay.close(); }
  });

  it("keeps explicit fields across the wig conversation and supports explicit withdrawal", () => {
    let current = SearchProductsInputSchema.parse({ query: "wig", productType: "wig" });
    for (const patch of [{ maxItemPriceCents: 10000, requiredFeatures: ["long hair"] },
      { requiredFeatures: ["straight hair"] }, { maxItemPriceCents: 3000 }]) {
      current = mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "wig", contextMode: "CONTINUE_PREVIOUS_PRODUCT", ...patch }), current);
    }
    expect(current).toMatchObject({ maxItemPriceCents: 3000, requiredFeatures: ["long hair", "straight hair"] });
    expect(mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "wig", contextMode: "CONTINUE_PREVIOUS_PRODUCT", clearConstraints: ["requiredFeatures"] }), current).requiredFeatures).toEqual([]);
    expect(mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "ballet flats", contextMode: "NEW_PRODUCT" }), current).requiredFeatures).toEqual([]);
  });

  it.each([
    [{ Size: "US 7" }, "US 7", "SATISFIED"],
    [{ Size: "EU 34" }, "US 7", "CONFLICT"],
    [{ Size: "7" }, "US 7", "NEEDS_VERIFICATION"],
    [{ Size: "M" }, "S", "CONFLICT"]
  ])("uses the selected size only: %j", (dimensions, size, status) => {
    const assessment = evaluateProductRequirements({ title: "Shoes, all sizes US 7 and US 8 available", variantDimensions: dimensions },
      { requiredFeatures: [size], requiredSize: size, excludedFeatures: [], preferences: [] }).assessment;
    expect(assessment.status).toBe(status);
    expect(assessment.entries[0]?.source).toBe("VARIANT");
  });

  it("does not use series advertising to override a bob variant or infer a size system", () => {
    const result = evaluateProductRequirements({ title: "Long Straight Human Hair Wig", variantDimensions: { "Length-inches": "10 BOB" } },
      { requiredFeatures: ["long hair"], excludedFeatures: [], preferences: [] });
    expect(result.assessment.status).toBe("CONFLICT");
    expect(normalizedSizeRequirement("US 7", "ballet flats")).toBe("US 7");
    expect(normalizedSizeRequirement("14 inch", "laptop")).toBe("14 inch display");
    expect(ambiguousShoeSize("7", "ballet flats")).toBe(true);
  });

  it("caps inspection at four products and two concurrent reads; keeps source results immutable", async () => {
    const products = Array.from({ length: 8 }, (_, i) => product({ handle: String(1000 + i), title: "Ballet flats", productType: "ballet flats",
      checkoutPlatform: "SHOPIFY", variantDimensions: { Size: "US 5" }, merchantUrl: `https://ishowbeauty.com/products/shoe-${i}` }));
    let active = 0; let peak = 0;
    const inspect = vi.fn(async (selected: ShopifyProduct) => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 2)); active--;
      return { productTitle: selected.title, canonicalProductUrl: selected.merchantUrl,
        variants: [{ ...selected, handle: selected.handle + "7", variantDimensions: { Size: "US 7" } }] };
    });
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "ballet flats", productType: "ballet flats", requiredSize: "US 7" }),
      { awin: emptyAwin, shopify: { search: async () => searchResult(products) }, selectedProducts: { inspect } });
    expect(inspect).toHaveBeenCalledTimes(4); expect(peak).toBe(2);
    expect(result.searchRun?.diagnostics().variantRequests).toBe(4);
    expect(result.candidates.every(candidate => candidate.shopifyProduct?.variantDimensions.Size === "US 7")).toBe(true);
    expect(products.every(candidate => candidate.variantDimensions.Size === "US 5")).toBe(true);
  });

  it("rejects a verified-size sibling whose price exceeds the ceiling", async () => {
    const shoe = product({ title: "Ballet flats", productType: "ballet flats", checkoutPlatform: "SHOPIFY", variantDimensions: { Size: "US 5" } });
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "ballet flats", productType: "ballet flats", requiredSize: "US 7", maxItemPriceCents: 5000 }), {
      awin: emptyAwin, shopify: { search: async () => searchResult([shoe]) }, selectedProducts: { inspect: async () => ({
        productTitle: shoe.title, canonicalProductUrl: shoe.merchantUrl,
        variants: [{ ...shoe, handle: "7777", variantDimensions: { Size: "US 7" }, itemPrice: { amountCents: 6000, currency: "USD" } }]
      }) }
    });
    expect(result.candidates).toEqual([]);
  });

  it("keeps timeout and missing requirements as research, not a primary match", async () => {
    const result = await searchProducts({ ...SearchProductsInputSchema.parse({ query: "wig", requiredFeatures: ["long hair"] }),
      searchRun: new SearchRun({ readTimeoutMs: 5 }) }, { awin: emptyAwin,
      shopify: { search: async () => searchResult([product({ title: "Human hair wig", checkoutPlatform: "SHOPIFY" })]) },
      selectedProducts: { inspect: async () => new Promise(() => {}) } });
    expect(result.candidates[0]?.presentationGroup).toBe("RESEARCH_ONLY");
    expect(result.searchRun?.diagnostics().readTimeouts).toBeGreaterThan(0);
  });

  it("replays 01a06fc8 requirement additions without re-sending earlier conditions", async () => {
    const products = [product(), product({ handle: "long", title: "Long straight human hair wig", description: "STYLE: Straight LENGTH: 28 inches",
      itemPrice: { amountCents: 2799, currency: "USD" }, merchantUrl: "https://ishowbeauty.com/products/long" })];
    const replay = await connectReplay(async () => searchResult(products));
    try {
      let result = await replay.client.callTool({ name: "search_products", arguments: { query: "wig", productType: "wig", responseLocale: "zh-CN" } });
      let content = result.structuredContent as ProductCardContent;
      for (const patch of [{ maxItemPriceCents: 10000, requiredFeatures: ["long hair"] },
        { requiredFeatures: ["straight hair"] }, { maxItemPriceCents: 3000 }]) {
        result = await replay.client.callTool({ name: "search_products", arguments: { query: "wig", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: content.renderId, responseLocale: "zh-CN", ...patch } });
        expect(result.isError).not.toBe(true); content = result.structuredContent as ProductCardContent;
      }
      expect(content.requirementsSummary).toMatchObject({ maxItemPriceCents: 3000, requiredFeatures: ["long hair", "straight hair"] });
      expect(content.requirementsVersion).toBe(4);
      expect(content.products.map(item => item.handle)).toEqual(["long"]);
      expect(content.products[0]?.requirementAssessment?.status).toBe("SATISFIED");
      const foreign = await replay.client.callTool({ name: "search_products", arguments: { query: "wig", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: randomUUID() } });
      expect(foreign.isError).toBe(true);
    } finally { await replay.close(); }
  });

  it("replays 01a06fca: UI selection compares US 7 variants, retaining old references", async () => {
    const shoes = [1001, 2001].map((id, i) => product({ handle: String(id), merchantId: "shoe" + i,
      title: i === 0 ? "Surfbird ballet flats" : "Rosalind ballet flats", productType: "ballet flats",
      checkoutPlatform: "SHOPIFY", variantDimensions: { Size: "US 5" }, merchantUrl: `https://ishowbeauty.com/products/shoe-${id}` }));
    const replay = await connectReplay(async () => searchResult(shoes), { selectedProducts: { inspect: async selected => ({
      productTitle: selected.title, canonicalProductUrl: selected.merchantUrl,
      variants: [{ ...selected, handle: selected.handle + "7", variantDimensions: { Size: "US 7" }, merchantUrl: selected.merchantUrl + "?variant=" + selected.handle + "7" }]
    }) } });
    try {
      const first = (await replay.client.callTool({ name: "search_products", arguments: { query: "ballet flats", productType: "ballet flats" } })).structuredContent as ProductCardContent;
      const second = (await replay.client.callTool({ name: "search_products", arguments: { query: "ballet flats", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: first.renderId, maxItemPriceCents: 50000, requiredSize: "US 7" } })).structuredContent as ProductCardContent;
      expect(second.products).toHaveLength(2);
      expect(second.products.every(item => item.variantDimensions.Size === "US 7")).toBe(true);
      await replay.client.callTool({ name: "sync_product_card_selection", arguments: { renderId: second.renderId, selectionIds: second.products.map(item => item.selectionId), revision: 1 } });
      const compared = (await replay.client.callTool({ name: "compare_selected_products", arguments: { renderId: second.renderId, responseLocale: "zh-CN" } })).structuredContent;
      expect(compared).toMatchObject({ status: "OK", entries: [
        { variantDimensions: { Size: "US 7" }, requirementAssessment: { status: "SATISFIED" } },
        { variantDimensions: { Size: "US 7" }, requirementAssessment: { status: "SATISFIED" } }
      ] });
      const old = await replay.client.callTool({ name: "compare_selected_products", arguments: { renderId: first.renderId, selectionIds: first.products.map(item => item.selectionId) } });
      expect(old.structuredContent).toMatchObject({ status: "OK" });
      const mixed = await replay.client.callTool({ name: "compare_selected_products", arguments: { renderId: second.renderId,
        selectionIds: [first.products[0]!.selectionId, second.products[1]!.selectionId] } });
      expect(mixed.structuredContent).toMatchObject({ status: "CROSS_SNAPSHOT_UNSUPPORTED" });
    } finally { await replay.close(); }
  });
});
