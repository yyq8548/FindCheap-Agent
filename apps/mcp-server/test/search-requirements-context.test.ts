import { describe, expect, it, vi } from "vitest";
import { SearchProductsInputSchema } from "../src/search-products.js";
import { mergeSearchRequirements, shoppingRequirementLedger } from "../src/search-requirements-context.js";
import { connectReplay, searchResult } from "./fixtures/conversation-replay-support.js";

describe("requirement continuity contract", () => {
  it("preserves one MCP goal through Sony clarification and a budget update", async () => {
    const replay = await connectReplay(async () => searchResult([]));
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: { query: "Sony 1000XM6", brand: "Sony",
        brandMode: "REQUIRED", productType: "headphones", requiredFeatures: ["black"], responseLocale: "zh-CN" } });
      expect(first.isError).not.toBe(true);
      const original = first.structuredContent as { renderId: string; goalId: string; goalRevision: number };
      const next = await replay.client.callTool({ name: "search_products", arguments: { query: "Sony WH-1000XM6", brand: "Sony",
        productType: "over-ear headphones", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: original.renderId } });
      expect(next.isError, JSON.stringify(next.content)).not.toBe(true);
      expect(next.structuredContent).toMatchObject({ goalId: original.goalId, goalRevision: 2,
        requirementsSummary: { productType: "over-ear headphones", requiredFeatures: ["black"] } });
      const narrowed = next.structuredContent as { renderId: string };
      const budget = await replay.client.callTool({ name: "search_products", arguments: { query: "Sony WH-1000XM6",
        contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: narrowed.renderId, maxItemPriceCents: 35000 } });
      expect(budget.isError).not.toBe(true);
      expect(budget.structuredContent).toMatchObject({ goalId: original.goalId, goalRevision: 3,
        requirementsSummary: { brand: "Sony", productType: "over-ear headphones", maxItemPriceCents: 35000, requiredFeatures: ["black"] } });
      expect(original.goalRevision).toBe(1);
    } finally { await replay.close(); }
  });
  it.each(["Sony WH-1000XM6", "Sony WH1000XM6"])("keeps the Sony goal requirements when clarifying the over-ear model: %s", query => {
    const previous = SearchProductsInputSchema.parse({ query: "Sony 1000XM6", brand: "Sony", brandMode: "REQUIRED",
      productType: "headphones", maxItemPriceCents: 35000, requiredFeatures: ["black"], excludedFeatures: ["refurbished"] });
    const result = mergeSearchRequirements(SearchProductsInputSchema.parse({ query, brand: "Sony",
      productType: "over-ear headphones", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: "11111111-1111-4111-8111-111111111111" }), previous);
    expect(result).toMatchObject({ query, productType: "over-ear headphones", maxItemPriceCents: 35000,
      requiredFeatures: ["black"], excludedFeatures: ["refurbished"], parentRenderId: "11111111-1111-4111-8111-111111111111", contextMode: "CONTINUE_PREVIOUS_PRODUCT" });
    expect(previous).toMatchObject({ query: "Sony 1000XM6", productType: "headphones" });
  });
  it("allows category-only headphone narrowing without changing the named model", () => {
    const previous = SearchProductsInputSchema.parse({ query: "Sony 1000XM6", brand: "Sony", productType: "headphones" });
    expect(mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "Sony 1000XM6", productType: "over-ear headphones",
      contextMode: "CONTINUE_PREVIOUS_PRODUCT" }), previous).productType).toBe("over-ear headphones");
  });
  it("does not assign an explicit WH model to the in-ear subtype", () => {
    expect(() => mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "Sony WH-1000XM6", productType: "in-ear headphones",
      contextMode: "CONTINUE_PREVIOUS_PRODUCT" }), SearchProductsInputSchema.parse({ query: "Sony WH-1000XM6", brand: "Sony",
      productType: "headphones" }))).toThrow("PRODUCT_CONTEXT_CONFLICT");
  });
  it.each([
    ["Sony WH-1000XM6", "Sony", "headphones", "in-ear headphones"],
    ["Sony WF-1000XM6", "Sony", "headphones", "over-ear headphones"],
    ["Sony WH-1000XM6", undefined, "Sony WH-1000XM6", "in-ear headphones"],
    ["Sony WF1000XM6", undefined, "Sony WF1000XM6", "over-ear headphones"]
  ])("rejects a conflicting final subtype through short references or query-only branding: %s / %s / %s / %s", (originalQuery, brand, query, productType) => {
    const previous = SearchProductsInputSchema.parse({ query: originalQuery, ...(brand === undefined ? {} : { brand }),
      productType: "headphones", maxItemPriceCents: 35000, requiredFeatures: ["black"] });
    expect(() => mergeSearchRequirements(SearchProductsInputSchema.parse({ query, productType,
      contextMode: "CONTINUE_PREVIOUS_PRODUCT" }), previous)).toThrow("PRODUCT_CONTEXT_CONFLICT");
    expect(previous).toMatchObject({ query: originalQuery, productType: "headphones", maxItemPriceCents: 35000, requiredFeatures: ["black"] });
  });
  it("rejects conflicting MCP category-only clarification before source reads while preserving the original goal", async () => {
    const search = vi.fn(async () => searchResult([]));
    const replay = await connectReplay(search);
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: {
        query: "Sony WH-1000XM6", productType: "headphones", requiredFeatures: ["black"], maxItemPriceCents: 35000
      } });
      expect(first.isError).not.toBe(true);
      const original = first.structuredContent as { renderId: string; goalId: string; goalRevision: number };
      search.mockClear();
      const invalid = await replay.client.callTool({ name: "search_products", arguments: {
        query: "headphones", productType: "in-ear headphones", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: original.renderId
      } });
      expect(invalid.isError, JSON.stringify(invalid.content)).toBe(true);
      expect(JSON.stringify(invalid.content)).toContain("PRODUCT_CONTEXT_CONFLICT");
      expect(search).not.toHaveBeenCalled();
      const valid = await replay.client.callTool({ name: "search_products", arguments: {
        query: "headphones", productType: "over-ear headphones", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: original.renderId
      } });
      expect(valid.isError, JSON.stringify(valid.content)).not.toBe(true);
      expect(valid.structuredContent).toMatchObject({ goalId: original.goalId, goalRevision: 2,
        requirementsSummary: { productType: "over-ear headphones", requiredFeatures: ["black"], maxItemPriceCents: 35000 } });
      expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: expect.stringMatching(/WH[-\s]?1000XM6/iu) }));
      expect(original.goalRevision).toBe(1);
    } finally { await replay.close(); }
  });
  it.each([
    ["Sony WH-1000XM5", "over-ear headphones"],
    ["Sony WF-1000XM6", "over-ear headphones"],
    ["Sony WH-1000XM6 WH-1000XM5", "over-ear headphones"],
    ["Sony WH-1000XM6", "laptop"],
    ["Sony WH-1000XM6", "headphones"]
  ])("rejects changed or unconfirmed headphone identity: %s / %s", (query, productType) => {
    expect(() => mergeSearchRequirements(SearchProductsInputSchema.parse({ query, productType, contextMode: "CONTINUE_PREVIOUS_PRODUCT" }),
      SearchProductsInputSchema.parse({ query: "Sony 1000XM6", brand: "Sony", productType: "headphones" })))
      .toThrow("PRODUCT_CONTEXT_CONFLICT");
  });
  it.each(["in-ear headphones", "headphones", "over-ear gaming headphones"])("does not replace or broaden a confirmed headphone subtype: %s", productType => {
    expect(() => mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "Sony WH-1000XM6", productType,
      contextMode: "CONTINUE_PREVIOUS_PRODUCT" }), SearchProductsInputSchema.parse({ query: "Sony WH-1000XM6", brand: "Sony",
      productType: "over-ear headphones" }))).toThrow("PRODUCT_CONTEXT_CONFLICT");
  });
  it("does not turn ambiguous Chinese counts into pads or truncate full requirement lists", () => {
    for (const input of [SearchProductsInputSchema.parse({ query: "tablets", requiredSize: "70片" }),
      SearchProductsInputSchema.parse({ query: "toner pads", requiredSize: "70 pads, 155g",
        requiredFeatures: Array.from({ length: 10 }, (_, i) => `requirement ${i}`) })]) {
      const result = mergeSearchRequirements(input, input);
      expect(result.requiredSize).toBe(input.requiredSize);
      expect(result.requiredFeatures).toEqual(input.requiredFeatures);
    }
  });
  it("requires original candidate evidence for a longer edition spelling and retains identity boundaries", () => {
    const previous = SearchProductsInputSchema.parse({ query: "medicube Zero Pore Pad", brand: "medicube", productType: "toner pads" });
    const current = SearchProductsInputSchema.parse({ query: "medicube Zero Pore Madecassoside Pads (Mild)", contextMode: "CONTINUE_PREVIOUS_PRODUCT" });
    expect(() => mergeSearchRequirements(current, previous)).toThrow("PRODUCT_CONTEXT_CONFLICT");
    const candidates = [{ brand: "medicube", title: "Zero Pore Madecassoside Pads (Mild)" }];
    expect(mergeSearchRequirements(current, previous, candidates).query).toBe(current.query);
    const wrong = SearchProductsInputSchema.parse({ query: "medicube Other Pad Mild", contextMode: "CONTINUE_PREVIOUS_PRODUCT" });
    expect(() => mergeSearchRequirements(wrong, previous, [{ brand: "medicube", title: "Other Pad Mild" }])).toThrow("PRODUCT_CONTEXT_CONFLICT");
  });
  it("narrows a cosmetic edition without dropping package or budget constraints", () => {
    const previous = SearchProductsInputSchema.parse({ query: "medicube Zero Pore Pad", productType: "toner pads",
      brand: "medicube", requiredSize: "70 pads, 155g", maxItemPriceCents: 5000, compareMerchants: true });
    expect(mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "medicube Zero Pore Pad Mild",
      contextMode: "CONTINUE_PREVIOUS_PRODUCT" }), previous)).toMatchObject({ query: "medicube Zero Pore Pad Mild",
      requiredFeatures: ["70 pads", "155 g"], maxItemPriceCents: 5000, compareMerchants: true });
  });
  it.each(["medicube Zero Pore Pad Mild Regular", "medicube Zero Pore Pad Mild another product", "medicube Zero Pore Pad Regular"])(
    "does not replace an established edition: %s", query => {
      expect(() => mergeSearchRequirements(SearchProductsInputSchema.parse({ query, contextMode: "CONTINUE_PREVIOUS_PRODUCT" }),
        SearchProductsInputSchema.parse({ query: "medicube Zero Pore Pad Mild", productType: "toner pads" }))).toThrow("PRODUCT_CONTEXT_CONFLICT");
    });
  it.each(["70 pads, 155g", "70片、155克"])("keeps package requirements in canonical fields: %s", requiredSize => {
    const input = SearchProductsInputSchema.parse({ query: "toner pads", requiredSize });
    const result = mergeSearchRequirements(input, input);
    expect(result.requiredSize).toBeUndefined();
    expect(result.requiredFeatures).toEqual(["70 pads", "155 g"]);
    expect(input.requiredSize).toBe(requiredSize);
  });
  it.each(["US 7", "14 inch", "M", "70 pads, size M", "155"])("does not reinterpret physical or ambiguous sizes: %s", requiredSize => {
    const input = SearchProductsInputSchema.parse({ query: "product", requiredSize });
    expect(mergeSearchRequirements(input, input).requiredSize).toBe(requiredSize);
  });
  const previous = SearchProductsInputSchema.parse({ query: "Brand A wig", brand: "Brand A", productType: "wig",
    requiredFeatures: ["short hair"], excludedFeatures: ["glue"], preferences: ["easy to maintain"],
    primaryUse: "cosplay", maxItemPriceCents: 5000, requiredSize: "M", conditionPreference: "NEW" });

  it("corrects identity without silently deleting unrelated requirements", () => {
    const result = mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "Brand B wig", brand: "Brand B",
      contextMode: "CORRECT_PREVIOUS_PRODUCT" }), previous);
    expect(result).toMatchObject({ query: "Brand B wig", brand: "Brand B", requiredFeatures: ["short hair"],
      excludedFeatures: ["glue"], preferences: ["easy to maintain"], primaryUse: "cosplay",
      maxItemPriceCents: 5000, requiredSize: "M", conditionPreference: "NEW" });
    expect(previous.brand).toBe("Brand A");
  });

  it("honors explicit withdrawal when correcting identity", () => {
    const result = mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "long wig",
      contextMode: "CORRECT_PREVIOUS_PRODUCT", clearConstraints: ["requiredFeatures", "requiredSize", "brand"] }), previous);
    expect(result.requiredFeatures).toEqual([]);
    expect(result.requiredSize).toBeUndefined();
    expect(result.brand).toBeUndefined();
    expect(result.maxItemPriceCents).toBe(5000);
  });

  it("marks supported necessary uses without promoting arbitrary preferences", () => {
    const ledger = shoppingRequirementLedger(previous);
    expect(ledger.find(entry => entry.field === "primaryUse")).toMatchObject({ strength: "REQUIRED", origin: "REQUEST_FIELD" });
    expect(shoppingRequirementLedger({ ...previous, primaryUse: "office work" }).find(entry => entry.field === "primaryUse"))
      .toMatchObject({ strength: "PREFERRED" });
    expect(ledger.find(entry => entry.field === "preferences")).toMatchObject({ strength: "PREFERRED" });
    expect(ledger.find(entry => entry.field === "requiredFeatures")).toMatchObject({ strength: "REQUIRED" });
    expect(ledger.find(entry => entry.field === "excludedFeatures")).toMatchObject({ strength: "EXCLUDED" });
  });

  it("uses the actual CONTINUE role refinements without losing the original budget or mutating snapshots", () => {
    const first = SearchProductsInputSchema.parse({ query: "wig", productType: "wig" });
    const cosplay = mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "wig", primaryUse: "cosplay",
      maxItemPriceCents: 10000, contextMode: "CONTINUE_PREVIOUS_PRODUCT" }), first);
    const role = mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "Honor of Kings Li Bai wig",
      requiredFeatures: ["Honor of Kings Li Bai character"], contextMode: "CONTINUE_PREVIOUS_PRODUCT" }), cosplay);
    expect(role.query).toBe("Honor of Kings Li Bai wig");
    const appearance = mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "Honor of Kings Li Bai default appearance wig",
      requiredFeatures: ["default appearance"], contextMode: "CONTINUE_PREVIOUS_PRODUCT" }), role);
    expect(appearance).toMatchObject({ query: "Honor of Kings Li Bai default appearance wig", maxItemPriceCents: 10000,
      primaryUse: "cosplay", requiredFeatures: ["Honor of Kings Li Bai character", "default appearance"] });
    expect(cosplay.query).toBe("wig");
    expect(role.requiredFeatures).toEqual(["Honor of Kings Li Bai character"]);
    expect(first.maxItemPriceCents).toBeUndefined();
  });

  it("keeps a refined identity when a later continuation uses only its category", () => {
    const previous = SearchProductsInputSchema.parse({ query: "Honor of Kings Li Bai default wig", productType: "wig" });
    const result = mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "wig", maxItemPriceCents: 10000,
      contextMode: "CONTINUE_PREVIOUS_PRODUCT" }), previous);
    expect(result.query).toBe(previous.query);
  });

  it.each([
    ["Naruto Sasuke wig", "Naruto Sakura wig", "wig"],
    ["Sony WH1000XM5 headphones", "Sony WH1000XM6 headphones", "headphones"],
    ["wig", "shampoo", "wig"],
    ["wig", "wig laptop", "wig"],
    ["Honor of Kings Li Bai wig", "Honor of Kings Li Bai Han Xin wig", "wig"]
  ])("rejects silent identity replacement or category mixing: %s / %s", (oldQuery, query, productType) => {
    expect(() => mergeSearchRequirements(SearchProductsInputSchema.parse({ query, contextMode: "CONTINUE_PREVIOUS_PRODUCT" }),
      SearchProductsInputSchema.parse({ query: oldQuery, productType }))).toThrow("PRODUCT_CONTEXT_CONFLICT");
  });

  it("accepts generic-to-named refinement beyond the reviewed bilingual role example", () => {
    const result = mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "Naruto Sasuke wig",
      requiredFeatures: ["Naruto Sasuke character"], contextMode: "CONTINUE_PREVIOUS_PRODUCT" }),
    SearchProductsInputSchema.parse({ query: "wig", productType: "wig", maxItemPriceCents: 8000 }));
    expect(result).toMatchObject({ query: "Naruto Sasuke wig", maxItemPriceCents: 8000 });
  });

  it.each([
    ["Sony WH1000XM5 headphones", "Sony WH1000XM5 WH1000XM6 headphones", "WH1000XM6", "headphones"],
    ["Naruto Sasuke wig", "Naruto Sasuke Sakura wig", "Naruto Sakura character", "wig"]
  ])("does not authorize a second model or character through a newly added feature", (oldQuery, query, feature, productType) => {
    expect(() => mergeSearchRequirements(SearchProductsInputSchema.parse({ query, requiredFeatures: [feature],
      contextMode: "CONTINUE_PREVIOUS_PRODUCT" }), SearchProductsInputSchema.parse({ query: oldQuery, productType })))
      .toThrow("PRODUCT_CONTEXT_CONFLICT");
  });

  it("accepts reviewed bilingual identity refinement and retains all prior constraints", () => {
    const result = mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "王者荣耀 李白 原皮 假发",
      requiredFeatures: ["默认造型"], contextMode: "CONTINUE_PREVIOUS_PRODUCT" }),
    SearchProductsInputSchema.parse({ query: "Honor of Kings Li Bai wig", productType: "wig", maxItemPriceCents: 8000 }));
    expect(result).toMatchObject({ query: "王者荣耀 李白 原皮 假发", maxItemPriceCents: 8000 });
  });

  it("accepts the original Tesla shorthand only within the existing EV category", () => {
    const previous = SearchProductsInputSchema.parse({ query: "EV charging station", productType: "EV charging station" });
    const result = mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "Tesla charging station", brand: "Tesla",
      productType: "EV charging station", contextMode: "CONTINUE_PREVIOUS_PRODUCT" }), previous);
    expect(result).toMatchObject({ query: "Tesla charging station", brand: "Tesla", productType: "EV charging station" });
    expect(result.requiredFeatures).toEqual([]);
    expect(() => mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "Tesla laptop charging station", brand: "Tesla",
      productType: "EV charging station", contextMode: "CONTINUE_PREVIOUS_PRODUCT" }), previous)).toThrow("PRODUCT_CONTEXT_CONFLICT");
  });

  it("does not authorize an arbitrary second character through an unlabelled feature", () => {
    expect(() => mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "Honor of Kings Li Bai wig Han Xin",
      requiredFeatures: ["Han Xin"], contextMode: "CONTINUE_PREVIOUS_PRODUCT" }),
    SearchProductsInputSchema.parse({ query: "Honor of Kings Li Bai wig", productType: "wig" }))).toThrow("PRODUCT_CONTEXT_CONFLICT");
  });

  it("preserves ordinary required attributes without making them new identity anchors", () => {
    const previous = SearchProductsInputSchema.parse({ query: "Honor of Kings Li Bai wig", productType: "wig" });
    expect(mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "Honor of Kings Li Bai wig",
      requiredFeatures: ["heat resistant"], contextMode: "CONTINUE_PREVIOUS_PRODUCT" }), previous).requiredFeatures).toEqual(["heat resistant"]);
    expect(mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "Honor of Kings Li Bai black wig",
      requiredFeatures: ["black"], contextMode: "CONTINUE_PREVIOUS_PRODUCT" }), previous).query).toBe("Honor of Kings Li Bai black wig");
  });

  it.each(["Honor of Kings Li Bai default appearance wig", "王者荣耀 李白 默认造型 假发", "Honor of Kings Li Bai black wig"])(
    "accepts a controlled query-only refinement without duplicate requiredFeatures: %s", query => {
      const previous = SearchProductsInputSchema.parse({ query: "Honor of Kings Li Bai wig", productType: "wig",
        primaryUse: "cosplay", maxItemPriceCents: 10000 });
      const result = mergeSearchRequirements(SearchProductsInputSchema.parse({ query,
        contextMode: "CONTINUE_PREVIOUS_PRODUCT" }), previous);
      expect(result).toMatchObject({ query, primaryUse: "cosplay", maxItemPriceCents: 10000, requiredFeatures: [] });
      expect(previous.query).toBe("Honor of Kings Li Bai wig");
    });

  it.each(["Honor of Kings Li Bai default Han Xin wig", "Honor of Kings Li Bai black Sakura wig"])(
    "does not hide a second identity behind a controlled query attribute: %s", query => {
      expect(() => mergeSearchRequirements(SearchProductsInputSchema.parse({ query, contextMode: "CONTINUE_PREVIOUS_PRODUCT" }),
        SearchProductsInputSchema.parse({ query: "Honor of Kings Li Bai wig", productType: "wig" })))
        .toThrow("PRODUCT_CONTEXT_CONFLICT");
    });
});
