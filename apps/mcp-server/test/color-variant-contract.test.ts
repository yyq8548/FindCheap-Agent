import { describe, expect, it } from "vitest";
import { isColorRequirement } from "../src/product-constraint-matcher.js";
import { evaluateProductRequirements } from "../src/product-requirements.js";
import { classifyShopifyCandidate } from "../src/shopify-match.js";

describe("selected color evidence contract", () => {
  it.each(["black", "black color", "black colour", "color: black", "黑色", "black or red"])("recognizes %s", feature => {
    expect(isColorRequirement(feature)).toBe(true);
  });
  it("does not reinterpret a whole product description as a color option", () => {
    expect(isColorRequirement("red leather shoes")).toBe(false);
  });
  it.each(["black color", "black colour", "color: black", "黑色"])("binds %s to the selected variant", feature => {
    for (const [color, status] of [["613", "UNKNOWN"], ["Red", "CONTRADICTED"], ["1B OFF BLACK", "MATCHED"]]) {
      const result = evaluateProductRequirements({ title: "Synthetic wig", description: "Color shown: 1B OFF BLACK",
        variantDimensions: { Color: color! } }, { requiredFeatures: [feature], excludedFeatures: [], preferences: [] });
      expect(result.assessment.entries[0]).toMatchObject({ source: "VARIANT", status });
    }
  });
  it.each(["613", "Red"])("does not call %s an exact black variant using another color's description", color => {
    const result = classifyShopifyCandidate("black wig", { title: "Synthetic wig", productType: "wig",
      description: "Color shown: 1B OFF BLACK", variantDimensions: { Color: color } });
    expect(result.evidence).not.toContain("requested variant exact");
  });
  it("does not use description-only black evidence for an unspecified variant", () => {
    const result = classifyShopifyCandidate("black wig", { title: "Synthetic wig", productType: "wig", description: "Color shown: black" });
    expect(result.evidence).not.toContain("requested variant exact");
    const checked = evaluateProductRequirements({ title: "Synthetic wig", description: "Color shown: black" },
      { requiredFeatures: ["black color"], excludedFeatures: [], preferences: [] });
    expect(checked.assessment.status).toBe("NEEDS_VERIFICATION");
  });
  it("does not use other colors in shared copy for exclusions or preferences", () => {
    const checked = evaluateProductRequirements({ title: "Synthetic wig", description: "Color shown: black", variantDimensions: { Color: "Red" } },
      { requiredFeatures: [], excludedFeatures: ["black color"], preferences: ["black color"] });
    expect(checked.contradicted).toEqual([]);
    expect(checked.preferences).toEqual([]);
  });
  it("retains explicit black variant evidence", () => {
    const result = classifyShopifyCandidate("black wig", { title: "Synthetic wig", productType: "wig",
      variantDimensions: { Color: "1B OFF BLACK" } });
    expect(result.evidence).toContain("requested variant exact");
  });
});
