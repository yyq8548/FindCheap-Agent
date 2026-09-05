import { describe, expect, it } from "vitest";
import { SearchProductsInputSchema } from "../src/search-products.js";
import { mergeSearchRequirements, shoppingRequirementLedger } from "../src/search-requirements-context.js";

describe("requirement continuity contract", () => {
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
