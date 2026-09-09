import { describe, expect, it } from "vitest";
import { assessCoffeeCategory, assessCoffeeCompatibility } from "../src/coffee-category.js";
import { evaluateProductRequirements } from "../src/product-requirements.js";
import { SearchProductsInputSchema, evaluateSearchProductRequirements } from "../src/search-products.js";

// Merchant strings observed in native task 01a0874b. These controlled assertions
// validate interpretation, not current merchant prices, inventory or host approval.
describe("coffee evidence agrees across category and typed requirements", () => {
  const input = { query: "coffee capsules", productType: "coffee", requiredFeatures: ["coffee capsules", "compatible with Nespresso Original"],
    excludedFeatures: [] as string[], preferences: [] as string[], maxItemPriceCents: 4000 };
  const price = { amountCents: 800, currency: "USD" };

  it.each(["auto-drip", "auto drip", "french", "home-espresso", "home espresso"])("recognizes the selected grind %s", grind => {
    const coffee = { title: "Subscription Coffee", variantDimensions: { grind } };
    expect(assessCoffeeCategory("GROUND", coffee).status).toBe("MATCHED");
    expect(assessCoffeeCategory("PODS", coffee).status).toBe("CONTRADICTED");
    expect(assessCoffeeCategory("WHOLE_BEAN", coffee).status).toBe("CONTRADICTED");
  });

  it("does not treat an unrelated option or a marketing mention as a selected grind", () => {
    expect(assessCoffeeCategory("PODS", { title: "Coffee Capsules", variantDimensions: { Style: "home-espresso" } }).status).toBe("MATCHED");
    expect(assessCoffeeCategory("PODS", { title: "Coffee Capsules", description: "We also sell auto-drip ground coffee." }).status).toBe("MATCHED");
    expect(assessCoffeeCategory("GROUND", { title: "Coffee", variantDimensions: { Grind: "french or whole bean" } }).status).toBe("UNKNOWN");
  });

  it("keeps the actual description-only BLEND10 evidence unknown in both receipts", () => {
    const candidate = { title: "BLEND 10 - INTENSE", description: "Intense dark roast coffee capsules, compatible with Nespresso OriginalLine.", itemPrice: price };
    expect(assessCoffeeCompatibility(input, candidate).status).toBe("UNKNOWN");
    for (const result of [evaluateProductRequirements(candidate, input), evaluateSearchProductRequirements(candidate, SearchProductsInputSchema.parse(input))]) {
      expect(result.unknown).toEqual(expect.arrayContaining(input.requiredFeatures));
      expect(result.matched).not.toContain("compatible with Nespresso Original");
      expect(result.assessment.status).toBe("NEEDS_VERIFICATION");
    }
  });

  it.each(["Nespresso Original", "Nespresso Vertuo"])("uses selected %s in the shared requirement evaluator", system => {
    const candidate = { title: "Coffee Capsules", variantDimensions: { "Capsule System": system },
      description: "Parent advertises Nespresso Original and Nespresso Vertuo options.", itemPrice: price };
    const result = evaluateProductRequirements(candidate, input);
    const status = system === "Nespresso Original" ? "MATCHED" : "CONTRADICTED";
    expect(result.assessment.entries.find(entry => entry.requirement === "compatible with Nespresso Original")?.status).toBe(status);
  });

  it("does not let a whole-bean parent title satisfy a selected ground variant", () => {
    const candidate = { title: "Whole Bean Coffee", variantDimensions: { Grind: "auto-drip" }, itemPrice: price };
    const result = evaluateProductRequirements(candidate, { ...input, query: "whole bean coffee", requiredFeatures: ["whole bean"] });
    expect(result.contradicted).toContain("whole bean");
    expect(result.assessment.status).toBe("CONFLICT");
  });

  it("excludes selected grounds, but not filled capsules whose description mentions grounds", () => {
    const constraints = { ...input, requiredFeatures: ["coffee capsules"], excludedFeatures: ["ground coffee"] };
    const capsules = { title: "Coffee Capsules", description: "Filled with ground coffee.", itemPrice: price };
    expect(evaluateProductRequirements(capsules, constraints).contradicted).not.toContain("excluded: ground coffee");
    const grounds = { title: "Coffee", variantDimensions: { Grind: "home-espresso" }, itemPrice: price };
    expect(evaluateProductRequirements(grounds, constraints).contradicted).toContain("excluded: ground coffee");
  });

  it("retains unrelated hard requirements and does not split combined claims", () => {
    const candidate = { title: "Coffee Capsules", variantDimensions: { "Capsule System": "Nespresso Original" }, itemPrice: price };
    const result = evaluateProductRequirements(candidate, { ...input, requiredFeatures: [...input.requiredFeatures, "organic"] });
    expect(result.unknown).toContain("organic");
    expect(evaluateProductRequirements(candidate, { ...input, requiredFeatures: ["Compatible with Nespresso Original and organic"] }).unknown)
      .toContain("Compatible with Nespresso Original and organic");
  });

  it("does not promote a different system requirement using the overall query's system", () => {
    const candidate = { title: "Coffee Capsules", variantDimensions: { "Capsule System": "Nespresso Original" } };
    const result = evaluateProductRequirements(candidate, { ...input, query: "Coffee capsules not compatible with Nespresso Vertuo",
      requiredFeatures: ["compatible with Nespresso Original", "compatible with Nespresso Vertuo"] });
    expect(result.matched).toContain("compatible with Nespresso Original");
    expect(result.contradicted).toContain("compatible with Nespresso Vertuo");
    expect(result.assessment.status).toBe("CONFLICT");
  });

  it("keeps an excluded form unresolved when the merchant has not bound the grind", () => {
    const candidate = { title: "Whole Bean Coffee", variantDimensions: { Grind: "Choose a grind" },
      description: "We also sell ground coffee." };
    const result = evaluateProductRequirements(candidate, { ...input, query: "coffee", requiredFeatures: ["coffee"], excludedFeatures: ["ground coffee"] });
    expect(result.unknown).toContain("excluded: ground coffee");
    expect(result.assessment.status).toBe("NEEDS_VERIFICATION");
  });

  it("does not let a combined requirement borrow another variant's compatibility", () => {
    const candidate = { title: "Coffee Capsules", variantDimensions: { "Capsule System": "Nespresso Vertuo" },
      description: "Compatible with Nespresso Original and organic" };
    const requirement = "Compatible with Nespresso Original and organic";
    expect(evaluateProductRequirements(candidate, { ...input, requiredFeatures: [requirement] }).unknown).toContain(requirement);
  });

  it("does not exclude a selected Original system using a parent Vertuo mention", () => {
    const candidate = { title: "Coffee Capsules", variantDimensions: { "Capsule System": "Nespresso Original" },
      description: "We also sell Nespresso Vertuo capsules." };
    expect(evaluateProductRequirements(candidate, { ...input, excludedFeatures: ["Nespresso Vertuo"] }).contradicted).not.toContain("excluded: Nespresso Vertuo");
  });

  it("does not award a whole-bean preference to selected ground coffee", () => {
    const candidate = { title: "Whole Bean Coffee", variantDimensions: { Grind: "auto-drip" } };
    expect(evaluateProductRequirements(candidate, { ...input, query: "coffee", requiredFeatures: [], preferences: ["whole bean"] }).preferences).toEqual([]);
  });

  it("does not prove a whole OR requirement false from one incompatible branch", () => {
    const candidate = { title: "Organic Coffee Capsules", variantDimensions: { "Capsule System": "Nespresso Vertuo" } };
    const requirement = "Compatible with Nespresso Original or organic";
    expect(evaluateProductRequirements(candidate, { ...input, requiredFeatures: [requirement] }).unknown).toContain(requirement);
    expect(evaluateProductRequirements(candidate, { ...input, requiredFeatures: [], excludedFeatures: [requirement] }).unknown).toContain(`excluded: ${requirement}`);
  });
});
