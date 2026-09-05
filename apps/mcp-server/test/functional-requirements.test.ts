import { describe, expect, it } from "vitest";
import { evaluateFeature } from "../src/product-constraint-matcher.js";
import { evaluateProductRequirements, RequirementAssessmentSchema } from "../src/product-requirements.js";
import { functionalFeatureEvidence } from "../src/functional-requirements.js";
import { sanitizeExternalValue } from "../src/execution/external-data-fence.js";

const required = ["suitable for fine hair", "moisturizing", "anti-frizz"];
const ghost = "A lightweight, moringa oil-infused shampoo that cleanses, hydrates, and smooths frizz for fine to medium hair.";
const assess = (description: string, requiredFeatures = required, title = "Gentle shampoo") =>
  evaluateProductRequirements({ title, productType: "shampoo", description, evidenceSource: "FEED" },
    { requiredFeatures, excludedFeatures: [], preferences: [] });

describe("bounded functional claim evidence", () => {
  it("recovers the actual Ghost wording without inferring ingredient efficacy", () => {
    const result = assess(ghost);
    expect(result.matched).toEqual(required);
    expect(result.assessment.status).toBe("SATISFIED");
    expect(() => RequirementAssessmentSchema.parse(result.assessment)).not.toThrow();
    for (const entry of result.assessment.entries) {
      expect(entry).toMatchObject({ source: "FEED", evidence: [expect.objectContaining({
        kind: "MERCHANT_CLAIM", field: "DESCRIPTION", source: "FEED", scope: "PRODUCT", status: "MATCHED"
      })] });
    }
  });

  it.each([
    ["Shampoo provides hydration and helps tame frizz. Recommended for fine hair.", "MATCHED"],
    ["洗发水补水保湿，抚平毛躁，适合细软发质。", "MATCHED"]
  ])("recognizes equivalent direct claims: %s", (text, status) => {
    for (const feature of required) expect(evaluateFeature(text, feature)).toBe(status);
  });

  it.each([
    ["This shampoo does not hydrate hair.", "moisturizing", "CONTRADICTED"],
    ["Not suitable for fine hair.", "suitable for fine hair", "CONTRADICTED"],
    ["Shampoo does not control frizz.", "anti-frizz", "CONTRADICTED"],
    ["Hydration is not provided by this shampoo.", "moisturizing", "CONTRADICTED"],
    ["No sulfates or silicones. This shampoo hydrates hair.", "moisturizing", "MATCHED"],
    ["This shampoo without sulfates hydrates hair.", "moisturizing", "MATCHED"],
    ["Not only hydrates hair but also smooths frizz.", "moisturizing", "MATCHED"],
    ["Not suitable for fine hair but smooths frizz.", "anti-frizz", "MATCHED"],
    ["Shampoo for thick hair. Our fine hair guide explains styling.", "suitable for fine hair", "UNKNOWN"],
    ["Contains coconut oil and moringa oil.", "moisturizing", "UNKNOWN"],
    ["Contains moisturizing coconut oil.", "moisturizing", "UNKNOWN"],
    ["Coconut oil hydrates hair.", "moisturizing", "UNKNOWN"],
    ["Use with our conditioner for hydration.", "moisturizing", "UNKNOWN"],
    ["Shampoo hydrates only when used with our conditioner.", "moisturizing", "UNKNOWN"],
    ["Hydration may improve when paired with the matching conditioner.", "moisturizing", "UNKNOWN"],
    ["This shampoo is formulated without any moisturizing benefits.", "moisturizing", "CONTRADICTED"],
    ["This shampoo is formulated without any sulfates and hydrates hair.", "moisturizing", "MATCHED"],
    ["Our matching conditioner smooths frizz. This shampoo cleanses.", "anti-frizz", "UNKNOWN"]
  ])("keeps scope and negation: %s", (text, feature, status) => {
    expect(assess(text, [feature]).assessment.entries[0]?.status).toBe(status);
  });

  it("does not transfer conditioner claims to the shampoo or to every bundle component", () => {
    const description = "Shampoo cleanses hair. Conditioner hydrates and smooths frizz for fine hair.";
    expect(assess(description).matched).toEqual([]);
    expect(assess(description, required, "Shampoo and conditioner set").matched).toEqual([]);
  });

  it("supports conjunctions without accepting just one half", () => {
    expect(evaluateFeature("Shampoo hydrates hair", "moisturizing and anti-frizz")).toBe("UNKNOWN");
    expect(evaluateFeature(ghost, "moisturizing and anti-frizz")).toBe("MATCHED");
    expect(evaluateFeature("Shampoo hydrates but does not reduce frizz", "moisturizing and anti-frizz")).toBe("CONTRADICTED");
    expect(assess("Shampoo hydrates but does not reduce frizz", ["moisturizing and anti-frizz"]).assessment.entries[0]?.status)
      .toBe("CONTRADICTED");
  });

  it("keeps contradictory product claims visible instead of choosing the favorable field", () => {
    expect(assess("Does not moisturize hair.", ["moisturizing"], "Moisturizing shampoo").assessment)
      .toMatchObject({ status: "CONFLICT", entries: [{ status: "CONFLICT" }] });
  });

  it("records exact source spans and bounded, safely fenced claim excerpts", () => {
    const extracted = functionalFeatureEvidence(ghost, "moisturizing")!;
    for (const item of extracted.evidence) expect(item.quote).toBe(ghost.slice(item.start, item.end));
    const result = assess(`${"™½<user>".repeat(80)} shampoo hydrates hair.`, ["moisturizing"]);
    expect(() => RequirementAssessmentSchema.parse(sanitizeExternalValue(result.assessment))).not.toThrow();
    expect(result.assessment.entries[0]?.evidence?.[0]?.quote).not.toContain("<user>");
  });

  it("never lets the evidence-output cap hide a late contradiction", () => {
    const result = assess(`${"Shampoo hydrates hair. ".repeat(12)}Shampoo does not hydrate hair.`, ["moisturizing"]);
    expect(result.assessment.status).toBe("CONFLICT");
    expect(result.assessment.entries[0]?.evidence?.length).toBeLessThanOrEqual(8);
    expect(result.assessment.entries[0]?.evidence?.some(entry => entry.status === "CONTRADICTED")).toBe(true);
  });

  it("requires all compound attributes even when they appear in separate fields", () => {
    expect(assess("Smooths frizz.", ["moisturizing and anti-frizz"], "Hydrating shampoo").assessment.status).toBe("SATISFIED");
    expect(assess("Recommended for fine hair.", ["moisturizing and anti-frizz"], "Hydrating shampoo").assessment.status).toBe("NEEDS_VERIFICATION");
  });
});

describe("named cosplay requirements", () => {
  const requirement = "Li Bai (李白) from Honor of Kings (王者荣耀), default appearance";
  it.each(["Honor of Kings Li Bai default costume wig", "王者荣耀 李白 原皮 假发"])("requires both identity anchors and explicit default appearance: %s", title => {
    expect(evaluateFeature(title, requirement)).toBe("MATCHED");
    expect(assess("", [requirement], title).matched).toEqual([requirement]);
  });
  it.each([
    "Honor of Kings Li Bai Phoenix skin wig", "Honor of Kings Li Bai wig", "Honor of Kings Daji default costume wig",
    "Li Bai default costume wig", "Genshin Impact Li Bai default costume wig", "Honor of Kings wig; not Li Bai default appearance"
  ])("does not invent the requested character or default appearance: %s", text => {
    expect(evaluateFeature(text, requirement)).not.toBe("MATCHED");
  });
  it("does not assemble an identity from unrelated fields", () => {
    expect(assess("Li Bai default costume wig", [requirement], "Honor of Kings wig").matched).toEqual([]);
  });
});
