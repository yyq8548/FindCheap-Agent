import { describe, expect, it } from "vitest";
import { assessCoffeeCompatibility, coffeeCompatibilityRequirement, isCoffeeCapsuleRequest, parseCoffeeCategory } from "../src/coffee-category.js";
import { evaluateProductRequirements } from "../src/product-requirements.js";

describe("ordinary coffee compatibility wording retains the same requirement", () => {
  const input = { query: "coffee capsules", productType: "coffee capsules", requiredFeatures: [] as string[],
    excludedFeatures: [] as string[], preferences: [] as string[] };

  it.each(["Compatible with Nespresso Original", "Nespresso Original compatible", "Nespresso Original-compatible",
    "Nespresso Original compatible capsules", "Nespresso Original-compatible machines", "compatible with Nespresso Original machines"])(
    "recognizes a complete single-system requirement: %s", requirement => {
      expect(coffeeCompatibilityRequirement(requirement)).toBe("NESPRESSO_ORIGINAL");
      const product = { title: "Coffee Capsules", variantDimensions: { System: "Nespresso Original" } };
      expect(evaluateProductRequirements(product, { ...input, requiredFeatures: [requirement] }).matched).toContain(requirement);
      expect(evaluateProductRequirements({ ...product, variantDimensions: { System: "Nespresso Vertuo" } },
        { ...input, requiredFeatures: [requirement] }).contradicted).toContain(requirement);
      expect(evaluateProductRequirements({ title: "Coffee Capsules", description: `Parent mentions ${requirement}.` },
        { ...input, requiredFeatures: [requirement] }).unknown).toContain(requirement);
      expect(evaluateProductRequirements(product, { ...input, preferences: [requirement] }).preferences).toContain(requirement);
      expect(evaluateProductRequirements({ ...product, variantDimensions: { System: "Select system" } },
        { ...input, preferences: [requirement] }).preferences).toEqual([]);
      expect(evaluateProductRequirements(product, { ...input, excludedFeatures: [requirement] }).contradicted).toContain(`excluded: ${requirement}`);
    });

  it.each(["Nespresso Original compatible and organic", "Nespresso Original compatible or organic",
    "Compatible with Nespresso Original and organic", "Nespresso Original compatible 50 pack"])(
    "does not satisfy a whole compound requirement from system evidence alone: %s", requirement => {
      expect(coffeeCompatibilityRequirement(requirement)).toBeUndefined();
      expect(evaluateProductRequirements({ title: "Organic Coffee Capsules", variantDimensions: { System: "Nespresso Original" } },
        { ...input, requiredFeatures: [requirement] }).unknown).toContain(requirement);
    });

  it.each(["loose ground coffee", "loose coffee grounds"])("uses selected form for excluded %s", excluded => {
    expect(parseCoffeeCategory(excluded)).toBe("GROUND");
    const constraints = { ...input, excludedFeatures: [excluded] };
    expect(evaluateProductRequirements({ title: "Coffee Capsules", description: `Filled with ${excluded}.` }, constraints).contradicted).toEqual([]);
    expect(evaluateProductRequirements({ title: "Coffee", variantDimensions: { Grind: "auto-drip" } }, constraints).contradicted).toContain(`excluded: ${excluded}`);
    expect(evaluateProductRequirements({ title: "Coffee", variantDimensions: { Grind: "Select grind" } }, constraints).unknown).toContain(`excluded: ${excluded}`);
  });

  it("recognizes an explicit compatibility category query despite an inherited broad coffee type", () => {
    const request = { ...input, query: "Nespresso Original compatible coffee capsules", productType: "coffee" };
    expect(isCoffeeCapsuleRequest(request)).toBe(true);
    expect(assessCoffeeCompatibility(request, { title: "BLEND 10", description: "Coffee capsules compatible with Nespresso Original." }).status).toBe("UNKNOWN");
  });
});
