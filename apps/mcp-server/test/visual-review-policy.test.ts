import { describe, expect, it } from "vitest";
import { CodexVisualVerdictSchema, finalizeCodexVisualCandidates, type CodexVisualVerdict, type UnifiedCandidate } from "../src/search-products.js";
import { assessVisualVerdict, hasAdmissibleVisualConflict, visualReviewScore } from "../src/visual-review-policy.js";
import { VisualProductInputSchema } from "../src/visual-product-discovery.js";

const candidate: UnifiedCandidate = {
  source: "SHOPIFY_GLOBAL_CATALOG", affiliateState: "NONE", recommendationTier: "TRUSTED_OR_AFFILIATE",
  featureEvidence: [], preferenceEvidence: [], requiredFeatureLimitations: [], verifiedCoupons: [],
  identityStatus: "DISCOVERY_MATCH", identityEvidence: [], resultGroup: "DISCOVERY",
  shopifyProduct: {
    merchantId: "test", merchant: "Test", sourceHost: "example.com", handle: "dress", title: "Black dress",
    merchantTrust: { level: "ESTABLISHED_RETAILER", verification: "INDEPENDENT", evidence: ["fixture"] },
    gtins: [], variantDimensions: {}, matchStatus: "DISCOVERY_MATCH", matchEvidence: [],
    condition: "UNKNOWN", availability: "IN_STOCK", itemPrice: { amountCents: 59800, currency: "USD" },
    merchantUrl: "https://example.com/products/dress", checkedAt: "2026-09-04T00:00:00.000Z"
  }
};

function pair(attribute: CodexVisualVerdict["matches"][number]["attribute"]) {
  return { attribute, referenceEvidence: "visible reference detail", candidateEvidence: "matching candidate detail" };
}

const strongMatches = [pair("PRODUCT_TYPE"), pair("NECKLINE"), pair("LENGTH")];
const visual = VisualProductInputSchema.parse({ productType: "dress", colors: ["black"], neckline: "boat neck", length: "mini" });

describe("server visual verdict policy", () => {
  it("keeps explicit visible sleeves through nonspecific hair and bag-strap occlusions", () => {
    const reference = VisualProductInputSchema.parse({ productType: "dress", neckline: "scoop neck", silhouette: "fit and flare",
      colors: ["ivory"], patterns: ["red floral"], sleeveType: "short loose puffed sleeves",
      observations: [{ attribute: "SLEEVE", value: "short loose puffed sleeves", confidence: 0.87, visibility: "VISIBLE" }],
      occlusions: ["Hair covers shoulders; bag strap crosses right side."] });
    const review = assessVisualVerdict({ classification: "HIGHLY_SIMILAR", matches: [pair("NECKLINE"), pair("SLEEVE"), pair("SILHOUETTE")],
      conflicts: [pair("COLOR"), pair("PATTERN")] }, reference, false);
    expect(review).toMatchObject({ group: "HIGHLY_SIMILAR", structuralMatchCount: 3 });
  });

  it.each(["Both sleeves are completely hidden by a jacket", "The sleeves are not visible", "Sleeves are outside the photograph"])(
    "does not let VISIBLE override explicit full occlusion: %s", (occlusion) => {
      const reference = VisualProductInputSchema.parse({ ...visual, occlusions: [occlusion], observations: [
        { attribute: "SLEEVE", value: "puff sleeves", confidence: 0.99, visibility: "VISIBLE" }
      ] });
      const review = assessVisualVerdict({ classification: "HIGHLY_SIMILAR", matches: [...strongMatches, pair("SLEEVE")], conflicts: [] }, reference, false);
      expect(review?.matches.map(entry => entry.attribute)).not.toContain("SLEEVE");
    }
  );

  it("distinguishes both sides being partly covered from the observed side being fully hidden", () => {
    const reference = VisualProductInputSchema.parse({ ...visual, occlusions: ["Both shoulders are partly covered by hair"], observations: [
      { attribute: "SLEEVE", value: "short puff sleeves", confidence: 0.9, visibility: "VISIBLE" }
    ] });
    expect(assessVisualVerdict({ classification: "HIGHLY_SIMILAR", matches: [...strongMatches, pair("SLEEVE")], conflicts: [] }, reference, false)
      ?.matches.map(entry => entry.attribute)).toContain("SLEEVE");
    const hiddenSide = VisualProductInputSchema.parse({ ...visual, occlusions: ["Left sleeve is hidden by a bag"], observations: [
      { attribute: "SLEEVE", value: "short puff sleeve", region: "left sleeve", confidence: 0.99, visibility: "VISIBLE" }
    ] });
    expect(assessVisualVerdict({ classification: "HIGHLY_SIMILAR", matches: [...strongMatches, pair("SLEEVE")], conflicts: [] }, hiddenSide, false)
      ?.matches.map(entry => entry.attribute)).not.toContain("SLEEVE");
  });

  it("does not promote generic plain strapless dress structure to possible identity", () => {
    const reference = VisualProductInputSchema.parse({ productType: "dress", colors: ["brown"], patterns: ["plain solid color"],
      neckline: "straight strapless neckline", sleeveType: "strapless with bare shoulders", length: "floor length maxi",
      silhouette: "fitted bodice and hips with a slightly flared skirt" });
    const review = assessVisualVerdict({ classification: "POSSIBLE_SAME_ITEM", matches: [pair("PRODUCT_TYPE"), pair("COLOR"),
      pair("PATTERN"), pair("NECKLINE"), pair("SLEEVE"), pair("LENGTH"), pair("SILHOUETTE")], conflicts: [] }, reference, false);
    expect(review?.group).toBe("HIGHLY_SIMILAR");
  });

  it("requires a genuinely distinguishing matched feature rather than an arbitrary detail label", () => {
    for (const detail of ["plain brown dress", "fitted long skirt", "matching silhouette"]) {
      const reference = VisualProductInputSchema.parse({ ...visual, distinctiveDetails: [detail] });
      expect(assessVisualVerdict({ classification: "POSSIBLE_SAME_ITEM", matches: [...strongMatches,
        { attribute: "DISTINCTIVE_DETAIL", referenceEvidence: detail, candidateEvidence: detail }], conflicts: [] }, reference, false)?.group)
        .toBe("HIGHLY_SIMILAR");
    }
    const detail = "three horizontal lace inset bands across the bodice";
    const reference = VisualProductInputSchema.parse({ ...visual, distinctiveDetails: [detail] });
    expect(assessVisualVerdict({ classification: "POSSIBLE_SAME_ITEM", matches: [...strongMatches,
      { attribute: "DISTINCTIVE_DETAIL", referenceEvidence: detail, candidateEvidence: detail }], conflicts: [] }, reference, false)?.group)
      .toBe("POSSIBLE_SAME_ITEM");
  });

  it("allows a genuinely new distinctive observation but does not rewrite existing generic detail into one", () => {
    const detail = { attribute: "DISTINCTIVE_DETAIL" as const, referenceEvidence: "three horizontal lace inset bands",
      candidateEvidence: "three horizontal lace inset bands", referenceObservation: { confidence: 0.95, visibility: "VISIBLE" as const } };
    expect(assessVisualVerdict({ classification: "POSSIBLE_SAME_ITEM", matches: [...strongMatches, detail], conflicts: [] }, visual, false)?.group)
      .toBe("POSSIBLE_SAME_ITEM");
    const generic = VisualProductInputSchema.parse({ ...visual, distinctiveDetails: ["plain dark dress"] });
    expect(assessVisualVerdict({ classification: "POSSIBLE_SAME_ITEM", matches: [...strongMatches, detail], conflicts: [] }, generic, false)?.group)
      .toBe("HIGHLY_SIMILAR");
  });

  it("ignores a low-confidence sleeve conflict while retaining reliable structure", () => {
    const reference = VisualProductInputSchema.parse({ ...visual, sleeveType: "cap sleeve", observations: [
      { attribute: "SLEEVE", value: "cap sleeve", confidence: 0.2, visibility: "VISIBLE" }
    ] });
    const result = finalizeCodexVisualCandidates([{ candidate, verdict: {
      classification: "CONFLICT", matches: strongMatches, conflicts: [pair("SLEEVE")]
    } }], false, 3, reference);
    expect(result[0]?.visualMatchGroup).toBe("HIGHLY_SIMILAR");
    expect(result[0]?.visualMatchEvidence?.join(" ")).not.toContain("difference SLEEVE");
    expect(hasAdmissibleVisualConflict({ classification: "CONFLICT", matches: strongMatches, conflicts: [pair("SLEEVE")] }, reference)).toBe(false);
  });

  it("does not let two uncertain matches establish high similarity", () => {
    const reference = VisualProductInputSchema.parse({ productType: "dress", observations: [
      { attribute: "SLEEVE", value: "cap sleeve", confidence: 0.2, visibility: "VISIBLE" },
      { attribute: "NECKLINE", value: "boat neck", confidence: 0.3, visibility: "VISIBLE" }
    ] });
    expect(finalizeCodexVisualCandidates([{ candidate, verdict: {
      classification: "HIGHLY_SIMILAR", matches: [pair("SLEEVE"), pair("NECKLINE")], conflicts: []
    } }], false, 3, reference)).toEqual([]);
  });

  it("requires structure beyond product family and color", () => {
    const result = finalizeCodexVisualCandidates([{ candidate, verdict: {
      classification: "HIGHLY_SIMILAR", matches: [pair("PRODUCT_TYPE"), pair("COLOR")], conflicts: []
    } }], false, 3, visual);
    expect(result).toEqual([]);
  });

  it("requires explicit observation for newly introduced reference attributes", () => {
    const result = finalizeCodexVisualCandidates([{ candidate, verdict: {
      classification: "POSSIBLE_SAME_ITEM", matches: [pair("PRODUCT_TYPE"), pair("WAIST"), pair("SLEEVE")], conflicts: []
    } }], false, 3, visual);
    expect(result).toEqual([]);
  });

  it("accepts explicitly new visible attributes without creating exact identity", () => {
    const verdict = CodexVisualVerdictSchema.parse({ classification: "POSSIBLE_SAME_ITEM", matches: [pair("PRODUCT_TYPE"),
      { ...pair("WAIST"), referenceObservation: { confidence: 0.9, visibility: "VISIBLE" } },
      { ...pair("SLEEVE"), referenceObservation: { confidence: 0.9, visibility: "VISIBLE" } }
    ] });
    expect(finalizeCodexVisualCandidates([{ candidate, verdict }], false, 3, visual)[0]).toMatchObject({
      identityStatus: "DISCOVERY_MATCH", visualReviewAssessment: { group: "HIGHLY_SIMILAR", structuralMatchCount: 2, matchCount: 3 }
    });
  });

  it.each([
    { attribute: "sleeve type", value: "cap sleeve", confidence: 0.2, visibility: "VISIBLE" },
    { attribute: "SLEEVE", value: "cap sleeve", confidence: 0.99, visibility: "PARTIAL" },
    { attribute: "SLEEVE", value: "cap sleeve", confidence: 0.99, visibility: "UNKNOWN" },
    { attribute: "SLEEVE", value: "cap sleeve", confidence: 0.99, visibility: "OCCLUDED" }
  ])("does not replace known uncertainty with a fresh high-confidence claim: $visibility/$confidence", (observation) => {
    const reference = VisualProductInputSchema.parse({ ...visual, observations: [observation] });
    const review = assessVisualVerdict({ classification: "POSSIBLE_SAME_ITEM", conflicts: [], matches: [
      ...strongMatches, { ...pair("SLEEVE"), referenceObservation: { confidence: 1, visibility: "VISIBLE" } }
    ] }, reference, false);
    expect(review?.matchCount).toBe(3);
    expect(review?.matches.map((entry) => entry.attribute)).not.toContain("SLEEVE");
  });

  it("does not let legacy duplicates erase explicit low confidence or inferred material", () => {
    const reference = VisualProductInputSchema.parse({ ...visual, neckline: "boat neck", materials: ["silk"], observations: [
      { attribute: "NECKLINE", value: "bateau neckline", confidence: 0.1 }
    ] });
    expect(assessVisualVerdict({ classification: "POSSIBLE_SAME_ITEM", conflicts: [], matches: [
      pair("NECKLINE"), pair("MATERIAL"), pair("COLOR")
    ] }, reference, false)).toBeUndefined();
  });

  it("uses device details rather than clothing structure for electronics", () => {
    const reference = VisualProductInputSchema.parse({ productType: "phone", colors: ["black"], visibleText: ["Pixel"],
      distinctiveDetails: ["horizontal camera bar"], length: "short" });
    const review = assessVisualVerdict({ classification: "POSSIBLE_SAME_ITEM", conflicts: [], matches: [
      pair("PRODUCT_TYPE"), pair("VISIBLE_TEXT"), pair("DISTINCTIVE_DETAIL")
    ] }, reference, false);
    expect(review).toMatchObject({ group: "POSSIBLE_SAME_ITEM", structuralMatchCount: 2 });
    expect(assessVisualVerdict({ classification: "HIGHLY_SIMILAR", conflicts: [], matches: [
      pair("LENGTH"), pair("COLOR")
    ] }, reference, false)).toBeUndefined();
  });

  it("retains admissible structural conflicts and validates all score components", () => {
    expect(assessVisualVerdict({ classification: "POSSIBLE_SAME_ITEM", matches: [pair("PRODUCT_TYPE"), pair("COLOR")],
      conflicts: [pair("LENGTH")] }, visual, true)).toBeUndefined();
    for (const matchCount of [-1, 17, NaN, 3.5]) {
      expect(visualReviewScore({ group: "POSSIBLE_SAME_ITEM", structuralMatchCount: 2, matchCount })).toBe(0);
    }
    expect(visualReviewScore({ group: "POSSIBLE_SAME_ITEM", structuralMatchCount: 0, matchCount: 3 })).toBe(0);
  });

  it("does not promote ungrounded same-style alternatives or a bare conflict classification", () => {
    expect(assessVisualVerdict({ classification: "SAME_STYLE", matches: [], conflicts: [] }, visual, true)).toBeUndefined();
    expect(assessVisualVerdict({ classification: "CONFLICT", matches: strongMatches, conflicts: [] }, visual, true)).toBeUndefined();
  });

  it("does not reinterpret a normalized product-type observation as structural detail", () => {
    const reference = VisualProductInputSchema.parse({ productType: "dress", observations: [
      { attribute: "PRODUCT_TYPE", value: "dress", confidence: 0.99, visibility: "VISIBLE" }
    ] });
    expect(assessVisualVerdict({ classification: "HIGHLY_SIMILAR", matches: [pair("PRODUCT_TYPE"), pair("DISTINCTIVE_DETAIL")], conflicts: [] },
      reference, false)).toBeUndefined();
  });

  it("honors newly reported uncertainty even for an originally visible attribute", () => {
    expect(assessVisualVerdict({ classification: "HIGHLY_SIMILAR", matches: [pair("PRODUCT_TYPE"),
      { ...pair("NECKLINE"), referenceObservation: { confidence: 0.2, visibility: "VISIBLE" } }
    ], conflicts: [] }, visual, false)).toBeUndefined();
  });
});
