import { describe, expect, it } from "vitest";
import { evaluateFeature } from "../src/product-constraint-matcher.js";
import { evaluateProductRequirements, RequirementAssessmentSchema } from "../src/product-requirements.js";
import { functionalQueryFeatures, requiredPrimaryUseFeatures } from "../src/functional-requirements.js";

const assess = (description: string, requiredFeatures: string[], title = "Gentle shampoo") =>
  evaluateProductRequirements({ title, productType: "shampoo", description, evidenceSource: "FEED" },
    { requiredFeatures, excludedFeatures: [], preferences: [] });

describe("explicit intent and merchant claim boundaries", () => {
  it.each([
    ["Shampoo with moisturizing hyaluronic acid.", "INGREDIENT"],
    ["Contains hydrating aloe vera.", "INGREDIENT"],
    ["Contains hydrating unfamiliarbotanical.", "INGREDIENT"],
    ["Aloe vera hydrates hair.", "INGREDIENT"],
    ["Shampoo containing moisturizing hyaluronic acid.", "INGREDIENT"],
    ["Another shampoo hydrates dry strands.", "OTHER_PRODUCT"],
    ["Another moisturizing shampoo is available.", "OTHER_PRODUCT"],
    ["For hydration, try AnotherBrand shampoo.", "OTHER_PRODUCT"],
    ["For hydration, use AnotherBrand shampoo.", "OTHER_PRODUCT"]
  ])("does not promote ingredient or another-product claims: %s", (description, scope) => {
    const result = assess(description, ["moisturizing"], "Ghost Shampoo");
    expect(result.assessment).toMatchObject({ status: "NEEDS_VERIFICATION", entries: [{ status: "UNKNOWN", evidence: [
      expect.objectContaining({ scope, status: "UNKNOWN" })
    ] }] });
  });

  it("retains the explicit Ghost product subject after an infused-ingredient adjective", () => {
    const description = "A lightweight, moringa oil-infused shampoo that cleanses, hydrates, and smooths frizz for fine to medium hair.";
    expect(assess(description, ["moisturizing", "anti-frizz", "fine hair"], "Ghost Shampoo").assessment.status).toBe("SATISFIED");
  });

  it.each(["改善干燥", "缓解干燥", "reduce hair dryness", "dryness relief"])("recognizes an explicit dryness-improvement request: %s", requirement => {
    expect(assess("This shampoo hydrates hair.", [requirement]).assessment.status).toBe("SATISFIED");
  });

  it.each([
    "This shampoo helps reduce hair dryness.",
    "This shampoo addresses dryness.",
    "这款洗发水改善干燥。"
  ])("recognizes bounded direct dryness claims: %s", description => {
    expect(assess(description, ["moisturizing"]).assessment.status).toBe("SATISFIED");
  });

  it.each([
    ["This shampoo hydrates hair.", "for dry hair", "UNKNOWN"],
    ["This shampoo is suitable for dry hair.", "moisturizing", "UNKNOWN"],
    ["This shampoo is not suitable for dry hair.", "for dry hair", "CONTRADICTED"],
    ["This shampoo does not address dryness.", "改善干燥", "CONTRADICTED"],
    ["Our dry hair guide discusses styles.", "for dry hair", "UNKNOWN"],
    ["Read our guide for dry hair.", "for dry hair", "UNKNOWN"],
    ["Coconut oil addresses dryness.", "改善干燥", "UNKNOWN"],
    ["Use with our conditioner to reduce dryness.", "改善干燥", "UNKNOWN"],
    ["Our conditioner is for dry hair. This shampoo only cleanses.", "for dry hair", "UNKNOWN"]
  ])("does not replace audience with efficacy or borrow unrelated claims: %s", (description, requirement, status) => {
    expect(assess(description, [requirement]).assessment.entries[0]?.status).toBe(status);
  });

  it.each(["Shampoo suitable for dry hair.", "Dry hair shampoo.", "本洗发水适合干性发质。"])("keeps explicit audience claims separately verifiable: %s", description => {
    const result = assess(description, ["for dry hair"]);
    expect(result.assessment.entries[0]).toMatchObject({ status: "MATCHED", evidence: [expect.objectContaining({
      attribute: "dry hair", kind: "MERCHANT_CLAIM", scope: "PRODUCT"
    })] });
    expect(() => RequirementAssessmentSchema.parse(result.assessment)).not.toThrow();
  });

  it("splits only the bounded original Chinese functional request", () => {
    const text = "A lightweight shampoo that hydrates and smooths frizz for fine to medium hair.";
    expect(assess(text, ["改善干燥毛躁", "细软"]).assessment.status).toBe("SATISFIED");
    expect(assess("Shampoo hydrates hair.", ["改善干燥毛躁"]).assessment.status).toBe("NEEDS_VERIFICATION");
    expect(functionalQueryFeatures(["改善干燥毛躁", "细软"])).toEqual(["moisturizing"]);
    expect(evaluateFeature("Shampoo for dry hair.", "改善干燥毛躁")).toBe("UNKNOWN");
  });

  it.each([
    ["Shampoo cleanses hair.", "NEEDS_VERIFICATION"],
    ["Shampoo hydrates hair.", "NEEDS_VERIFICATION"],
    ["Shampoo hydrates and smooths frizz.", "SATISFIED"],
    ["Shampoo hydrates but does not smooth frizz.", "CONFLICT"],
    ["Shampoo is suitable for dry hair.", "NEEDS_VERIFICATION"]
  ])("keeps an explicit functional primaryUse necessary: %s", (description, status) => {
    const result = evaluateProductRequirements({ title: "Ghost Shampoo", productType: "shampoo", description }, {
      primaryUse: "改善干燥毛躁", requiredFeatures: [], excludedFeatures: [], preferences: []
    });
    expect(result.assessment.status).toBe(status);
    expect(result.assessment.entries.map(entry => entry.requirement)).toEqual(["moisturizing", "anti-frizz"]);
  });

  it("normalizes only reviewed functional uses without inventing dry-hair suitability", () => {
    expect(requiredPrimaryUseFeatures("改善干燥毛躁")).toEqual(["moisturizing", "anti-frizz"]);
    expect(requiredPrimaryUseFeatures("保湿")).toEqual(["moisturizing"]);
    expect(requiredPrimaryUseFeatures("for dry hair")).toEqual(["dry hair"]);
    expect(requiredPrimaryUseFeatures("gaming")).toEqual([]);
    expect(requiredPrimaryUseFeatures("not moisturizing")).toEqual([]);
  });
});

describe("explicit cosplay use is a required merchant claim", () => {
  const use = (title: string, description = "", primaryUse = "cosplay") => evaluateProductRequirements({
    title, description, productType: "wig", itemPrice: { amountCents: 3600, currency: "USD" }
  }, { query: "wig", productType: "wig", primaryUse, requiredFeatures: [], excludedFeatures: [], preferences: [], maxItemPriceCents: 10000 });

  it.each([
    ["Daily human hair wig", "", "UNKNOWN"],
    ["Cosplay wig", "", "MATCHED"],
    ["Human hair wig", "This wig is suitable for cosplay.", "MATCHED"],
    ["角色扮演假发", "", "MATCHED"],
    ["王者荣耀 李白 原皮 假发", "", "MATCHED"],
    ["Daily human hair wig", "Cosplay styling guide available separately.", "UNKNOWN"],
    ["Daily human hair wig", "Suitable for cosplay only when paired with a separate costume wig.", "UNKNOWN"],
    ["Daily human hair wig", "This wig is not suitable for cosplay.", "CONTRADICTED"],
    ["Daily human hair wig", "Our other cosplay wig is available separately.", "UNKNOWN"],
    ["Honor of Kings wig", "Li Bai character guide.", "UNKNOWN"]
  ])("checks product-specific use without inferring it from price or style: %s / %s", (title, description, status) => {
    const result = use(title, description);
    expect(result.assessment.entries.find(entry => entry.requirement === "cosplay")?.status).toBe(status);
    expect(result.assessment.status).toBe(status === "MATCHED" ? "SATISFIED" : status === "CONTRADICTED" ? "CONFLICT" : "NEEDS_VERIFICATION");
    expect(() => RequirementAssessmentSchema.parse(result.assessment)).not.toThrow();
  });

  it("does not turn arbitrary free-text use into a new hard claim", () => {
    expect(use("Daily human hair wig", "", "a gift for a friend").assessment.entries).toHaveLength(1);
    expect(use("Daily human hair wig", "", "not for cosplay").assessment.entries).toHaveLength(1);
  });

  it.each(["角色扮演", "用于角色扮演", "for cosplay", "role-playing"])("keeps explicitly stated use necessary: %s", primaryUse => {
    expect(use("Daily human hair wig", "", primaryUse).assessment.entries.find(entry => entry.requirement === "cosplay")?.status).toBe("UNKNOWN");
  });

  it("does not treat a rejected character identity as positive use evidence", () => {
    expect(use("Honor of Kings wig, not Li Bai").assessment.entries.find(entry => entry.requirement === "cosplay")?.status).toBe("CONTRADICTED");
  });
});
