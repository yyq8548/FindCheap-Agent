import { describe, expect, it } from "vitest";
import { assessRanking, compareRankingAssessments, hasEquivalentFitEvidence, type RankingInput } from "../src/ranking-assessment.js";

const input: RankingInput = {
  title: "Verified product", matchStatus: "EXACT", availability: "IN_STOCK",
  merchantTrust: { verification: "INDEPENDENT", level: "ESTABLISHED_RETAILER" },
  recommendationTier: "TRUSTED_OR_AFFILIATE", featureEvidence: ["human hair"],
  preferenceEvidence: ["short"], requiredFeatureLimitations: [], itemPriceCents: 1_000
};

describe("shared ranking assessment", () => {
  it("retains fail-closed primary eligibility independently of display layout", () => {
    expect(assessRanking(input).primaryEligible).toBe(true);
    for (const override of [
      { merchantTrust: { verification: "UNVERIFIED", level: "ESTABLISHED_RETAILER" } },
      { merchantTrust: { verification: "INDEPENDENT", level: "RISKY" } },
      { merchantTrust: { verification: "INDEPENDENT", level: "UNKNOWN" } },
      { recommendationTier: "GENERAL_UNVERIFIED" },
      { availability: "OUT_OF_STOCK" }, { matchStatus: "SIMILAR" },
      { requiredFeatureLimitations: ["required use unknown"] }, { requiredFeatureLimitations: [""] }
    ] satisfies Partial<RankingInput>[]) {
      expect(assessRanking({ ...input, ...override }).primaryEligible).toBe(false);
    }
  });

  it("compares unique evidence rather than allowing duplicate count promotion", () => {
    const baseline = assessRanking(input);
    const repeated = assessRanking({ ...input, featureEvidence: [" human hair ", "HUMAN HAIR", "human hair"] });
    expect(compareRankingAssessments(baseline, repeated)).toBe(0);
    expect(hasEquivalentFitEvidence(baseline, repeated)).toBe(true);
    expect(hasEquivalentFitEvidence(baseline, assessRanking({ ...input, featureEvidence: ["synthetic fiber"] }))).toBe(false);
    expect(hasEquivalentFitEvidence(assessRanking({ ...input, featureEvidence: [], preferenceEvidence: [] }),
      assessRanking({ ...input, featureEvidence: [], preferenceEvidence: [] }))).toBe(false);
  });

  it("keeps optional and invalid price evidence from inventing lower costs", () => {
    const baseline = assessRanking(input);
    expect(assessRanking({ ...input, couponRank: 1, confirmedCouponPriceCents: 500 }).effectivePriceCents).toBe(1_000);
    expect(assessRanking({ ...input, couponRank: 2, confirmedCouponPriceCents: 500 }).effectivePriceCents).toBe(500);
    expect(assessRanking({ ...input, couponRank: 2, confirmedCouponPriceCents: 1_500 }).effectivePriceCents).toBe(1_000);
    for (const price of [undefined, NaN, -1, 1.5]) {
      const unknown = assessRanking({ ...input, itemPriceCents: price, couponRank: 2, confirmedCouponPriceCents: 500 });
      expect(unknown.effectivePriceCents).toBe(Number.MAX_SAFE_INTEGER);
      expect(compareRankingAssessments(baseline, unknown)).toBeLessThan(0);
    }
  });
});
