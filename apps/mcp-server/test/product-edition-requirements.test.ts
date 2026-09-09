import { describe, expect, it } from "vitest";
import { evaluateProductRequirements } from "../src/product-requirements.js";

const query = "medicube Zero Pore Pad 70 pads 155g";
// Public US variant 40542710825008, captured 2026-09-09. This FAQ recommends
// another edition; it does not identify this offer as Mild or prove its weight.
const original = { title: "Zero Pore Pads", brand: "medicube",
  description: "If you have very sensitive skin, start by using them a few times a week. For an even gentler exfoliation experience, we recommend trying the Zero Pore Pad Mild." };
const requirements = { query, requiredFeatures: [], excludedFeatures: [], preferences: [] };

describe("named edition requirement evidence", () => {
  it("keeps excluded Mild unknown when its only mention recommends another product", () => {
    const result = evaluateProductRequirements(original, { ...requirements, excludedFeatures: ["Mild"] });
    expect(result.assessment.status).toBe("NEEDS_VERIFICATION");
    expect(result.contradicted).toEqual([]);
    expect(result.unknown).toEqual(["excluded: Mild"]);
  });

  it("does not satisfy required Mild or award a preference from the same FAQ", () => {
    const result = evaluateProductRequirements(original, { ...requirements, requiredFeatures: ["Mild"], preferences: ["Mild"] });
    expect(result.assessment.status).toBe("NEEDS_VERIFICATION");
    expect(result.unknown).toEqual(["Mild"]);
    expect(result.preferences).toEqual([]);
  });

  it.each([
    { ...original, title: "Zero Pore Pad Mild" },
    { ...original, variantDimensions: { Edition: "Mild" } }
  ])("rejects a current Mild title or selected edition, even with a regular comparison", product => {
    const result = evaluateProductRequirements({ ...product, description: "Compare with Zero Pore Pad Regular." },
      { ...requirements, excludedFeatures: ["Mild"] });
    expect(result.assessment.status).toBe("CONFLICT");
    expect(result.contradicted).toEqual(["excluded: Mild"]);
  });

  it("accepts required Mild and a preference only from current primary evidence", () => {
    const result = evaluateProductRequirements({ ...original, title: "Zero Pore Pad Mild" },
      { ...requirements, requiredFeatures: ["Mild"], preferences: ["Mild"] });
    expect(result.assessment.status).toBe("SATISFIED");
    expect(result.preferences).toEqual(["Mild"]);
  });

  it("can rule out Mild with an explicit Regular edition without inferring Regular from absence", () => {
    const result = evaluateProductRequirements({ ...original, title: "Zero Pore Pad Regular" },
      { ...requirements, excludedFeatures: ["Mild"] });
    expect(result.assessment.status).toBe("SATISFIED");
    expect(evaluateProductRequirements({ title: "Zero Pore Pads" }, { ...requirements, excludedFeatures: ["Mild"] }).assessment.status)
      .toBe("NEEDS_VERIFICATION");
  });

  it("retains generic mild shampoo feature semantics", () => {
    const result = evaluateProductRequirements({ title: "Gentle Shampoo", description: "Mild shampoo for daily cleansing." },
      { ...requirements, query: "mild shampoo", requiredFeatures: ["Mild"] });
    expect(result.assessment.status).toBe("SATISFIED");
  });

  it.each(["mini", "regular"])("retains garment %s semantics for a named garment", edition => {
    const result = evaluateProductRequirements({ title: "Acme Summer Dress", description: `${edition} dress` },
      { ...requirements, query: "Acme Summer Dress", requiredFeatures: [edition] });
    expect(result.assessment.status).toBe("SATISFIED");
  });

  it("does not establish 155g from edition evidence or a 70-pad count", () => {
    const result = evaluateProductRequirements({ ...original, description: `${original.description} Contains 70 pads.` },
      { ...requirements, requiredFeatures: ["70 pads", "155 g"], excludedFeatures: ["Mild"] });
    expect(result.matched).toEqual(["70 pads"]);
    expect(result.unknown).toEqual(["155 g", "excluded: Mild"]);
    expect(result.contradicted).toEqual([]);
  });
});
