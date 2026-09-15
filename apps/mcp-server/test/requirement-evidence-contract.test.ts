import { describe, expect, it } from "vitest";

import { evaluateProductRequirements } from "../src/product-requirements.js";

describe("product requirement evidence contract", () => {
  it("keeps a positive hard feature eligible", () => {
    const result = evaluateProductRequirements(
      { title: "Trail Daypack", productType: "backpack", description: "This backpack is waterproof." },
      { requiredFeatures: ["waterproof"], excludedFeatures: [], preferences: [] },
    );
    expect(result.assessment.status).toBe("SATISFIED");
  });

  it("rejects a directly negated required feature", () => {
    const result = evaluateProductRequirements(
      {
        title: "Trail Daypack",
        productType: "backpack",
        description: "A compact daypack. This backpack is not waterproof.",
      },
      {
        requiredFeatures: ["waterproof"],
        excludedFeatures: [],
        preferences: [],
      },
    );

    expect(result.assessment.status).toBe("CONFLICT");
    expect(result.assessment.entries).toContainEqual(
      expect.objectContaining({
        requirement: "waterproof",
        status: "CONTRADICTED",
      }),
    );
  });

  it("requires every clause in a compound hard requirement", () => {
    const result = evaluateProductRequirements(
      {
        title: "Creator Laptop",
        productType: "laptop",
        description: "Configured with 16 GB RAM and a 256 GB SSD.",
      },
      {
        requiredFeatures: ["16 GB RAM and 512 GB SSD"],
        excludedFeatures: [],
        preferences: [],
      },
    );

    expect(result.assessment.status).toBe("CONFLICT");
    expect(result.assessment.entries).toContainEqual(
      expect.objectContaining({
        requirement: "16 GB RAM and 512 GB SSD",
        status: "CONTRADICTED",
      }),
    );
  });

  it("uses the selected package quantity instead of another advertised option", () => {
    const result = evaluateProductRequirements(
      {
        title: "Daily Toner Pads",
        productType: "toner pads",
        description: "Also available in a 70 pads value jar.",
        variantDimensions: { Quantity: "8 pads" },
      },
      {
        requiredFeatures: ["70 pads"],
        excludedFeatures: [],
        preferences: [],
      },
    );

    expect(result.assessment.status).toBe("CONFLICT");
    expect(result.assessment.entries).toContainEqual(
      expect.objectContaining({
        requirement: "70 pads",
        status: "CONTRADICTED",
        source: "VARIANT",
      }),
    );
  });

  it.each([
    ["not only waterproof but also breathable", "waterproof", "SATISFIED"],
    ["Made without waterproof protection.", "waterproof", "CONFLICT"],
    ["这款背包不防水。", "防水", "CONFLICT"],
    ["This backpack is not waterproof. Another jacket is waterproof.", "waterproof", "CONFLICT"],
    ["Water resistance is not specified.", "waterproof", "NEEDS_VERIFICATION"],
    ["A shell that is water-resistant.", "waterproof or water-resistant", "SATISFIED"],
    ["A shell that is waterproof.", "waterproof and breathable", "NEEDS_VERIFICATION"],
  ])("keeps bounded negation and boolean semantics: %s", (description, requirement, expected) => {
    const result = evaluateProductRequirements(
      { title: "Trail Shell", productType: "jacket", description },
      { requiredFeatures: [requirement], excludedFeatures: [], preferences: [] },
    );
    expect(result.assessment.status).toBe(expected);
  });

  it("checks every measured clause even when a comma joins them", () => {
    const result = evaluateProductRequirements(
      { title: "Creator Laptop", description: "16 GB RAM, 256 GB SSD" },
      { requiredFeatures: ["16 GB RAM, 512 GB SSD"], excludedFeatures: [], preferences: [] },
    );
    expect(result.assessment.status).toBe("CONFLICT");
  });

  it.each([
    [{ Quantity: "70 pads" }, "70片", "SATISFIED"],
    [{ Quantity: "10 packs of 7 pads" }, "70 pads", "CONFLICT"],
    [{ Capacity: "155 ml" }, "155 g", "NEEDS_VERIFICATION"],
  ])("keeps quantity units and selected scope separate: %j", (variantDimensions, requirement, expected) => {
    const result = evaluateProductRequirements(
      { title: "Daily Treatment", variantDimensions },
      { requiredFeatures: [requirement], excludedFeatures: [], preferences: [] },
    );
    expect(result.assessment.status).toBe(expected);
  });

  it("does not treat a bare number as a typed product requirement", () => {
    const result = evaluateProductRequirements(
      { title: "Daily Treatment 70" },
      { requiredFeatures: ["70"], excludedFeatures: [], preferences: [] },
    );
    expect(result.assessment.status).toBe("NEEDS_VERIFICATION");
  });

  it("compares a requested single item with a selected multipack count", () => {
    const result = evaluateProductRequirements(
      { title: "Scrub Daddy Original FlexTexture Sponges (6-Pack)", productType: "cleaning sponge" },
      { requiredFeatures: ["1 sponge"], excludedFeatures: [], preferences: [] },
    );
    expect(result.assessment.status).toBe("CONFLICT");
  });

  it("reuses selected measurement facts for exclusions and preferences", () => {
    const product = {
      title: "Daily Toner Pads",
      description: "Also available in a 70 pads value jar.",
      variantDimensions: { Quantity: "8 pads" },
    };
    const allowed = evaluateProductRequirements(product, {
      requiredFeatures: [],
      excludedFeatures: ["70 pads"],
      preferences: ["70 pads", "8 pads"],
    });
    expect(allowed.assessment.status).toBe("SATISFIED");
    expect(allowed.preferences).toEqual(["8 pads"]);

    const rejected = evaluateProductRequirements(product, {
      requiredFeatures: [],
      excludedFeatures: ["8 pads"],
      preferences: [],
    });
    expect(rejected.assessment.status).toBe("CONFLICT");
  });

  it("does not treat an unselected parent option list as the current quantity", () => {
    const result = evaluateProductRequirements(
      { title: "Daily Toner Pads", description: "Available in 8 pads or 70 pads packages." },
      { requiredFeatures: ["70 pads"], excludedFeatures: [], preferences: [] },
    );
    expect(result.assessment.status).toBe("NEEDS_VERIFICATION");
  });

  it("keeps conflicting selected measurements as a conflict", () => {
    const result = evaluateProductRequirements(
      { title: "Daily Toner Pads", variantDimensions: { Quantity: "70 pads", "Package size": "8 pads" } },
      { requiredFeatures: ["70 pads"], excludedFeatures: [], preferences: [] },
    );
    expect(result.assessment.status).toBe("CONFLICT");
    expect(result.assessment.entries[0]).toMatchObject({ status: "CONFLICT", source: "VARIANT" });
  });
});
