export type RankingInput = {
  title: string;
  matchStatus: "EXACT" | "DISCOVERY_MATCH" | "SIMILAR";
  recommendationTier?: "TRUSTED_OR_AFFILIATE" | "HIGH_RATED_UNVERIFIED" | "GENERAL_UNVERIFIED" | undefined;
  merchantTrust: {
    verification: "INDEPENDENT" | "UNVERIFIED";
    level?: "OFFICIAL" | "AUTHORIZED_RETAILER" | "ESTABLISHED_RETAILER" | "UNKNOWN" | "RISKY" | undefined;
  };
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  requiredFeatureLimitations?: readonly string[] | undefined;
  featureEvidence?: readonly string[] | undefined;
  preferenceEvidence?: readonly string[] | undefined;
  itemPriceCents?: number | undefined;
  confirmedCouponPriceCents?: number | undefined;
  couponRank?: number | undefined;
};

export type RankingAssessment = {
  primaryEligible: boolean;
  matchRank: number;
  limitationCount: number;
  featureEvidence: string[];
  preferenceEvidence: string[];
  trustRank: number;
  availabilityRank: number;
  effectivePriceCents: number;
  itemPriceCents: number;
  couponRank: number;
  title: string;
};

export function assessRanking(input: RankingInput): RankingAssessment {
  const trusted = input.merchantTrust.verification === "INDEPENDENT" &&
    input.merchantTrust.level !== "RISKY" && input.merchantTrust.level !== "UNKNOWN" &&
    input.recommendationTier !== "GENERAL_UNVERIFIED";
  const limitationCount = input.requiredFeatureLimitations?.length ?? 0;
  const itemPrice = validPrice(input.itemPriceCents) ? input.itemPriceCents : Number.MAX_SAFE_INTEGER;
  const couponRank = Number.isFinite(input.couponRank) ? Math.max(-1, Math.min(2, input.couponRank!)) : -1;
  const effectivePrice = validPrice(input.itemPriceCents) && couponRank === 2 && validPrice(input.confirmedCouponPriceCents)
    ? Math.min(itemPrice, input.confirmedCouponPriceCents) : itemPrice;
  return {
    primaryEligible: trusted && limitationCount === 0 && input.matchStatus !== "SIMILAR" && input.availability !== "OUT_OF_STOCK",
    matchRank: input.matchStatus === "EXACT" ? 0 : input.matchStatus === "DISCOVERY_MATCH" ? 1 : 2,
    limitationCount,
    featureEvidence: evidenceKeys(input.featureEvidence),
    preferenceEvidence: evidenceKeys(input.preferenceEvidence),
    trustRank: trusted ? 0 : 1,
    availabilityRank: input.availability === "IN_STOCK" ? 0 : input.availability === "UNKNOWN" ? 1 : 2,
    effectivePriceCents: effectivePrice,
    itemPriceCents: itemPrice,
    couponRank,
    title: input.title
  };
}

// Presentation group and affiliate economics are deliberately not inputs.
export function compareRankingAssessments(left: RankingAssessment, right: RankingAssessment): number {
  return left.matchRank - right.matchRank ||
    left.limitationCount - right.limitationCount ||
    right.featureEvidence.length - left.featureEvidence.length ||
    right.preferenceEvidence.length - left.preferenceEvidence.length ||
    left.trustRank - right.trustRank ||
    left.availabilityRank - right.availabilityRank ||
    left.effectivePriceCents - right.effectivePriceCents ||
    left.itemPriceCents - right.itemPriceCents ||
    right.couponRank - left.couponRank ||
    left.title.localeCompare(right.title);
}

export function hasEquivalentFitEvidence(left: RankingAssessment, right: RankingAssessment): boolean {
  return left.featureEvidence.length + left.preferenceEvidence.length > 0 &&
    left.matchRank === right.matchRank && left.limitationCount === right.limitationCount &&
    left.trustRank === right.trustRank && left.availabilityRank === right.availabilityRank &&
    sameEvidence(left.featureEvidence, right.featureEvidence) && sameEvidence(left.preferenceEvidence, right.preferenceEvidence);
}

function evidenceKeys(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.normalize("NFKC").trim().toLocaleLowerCase("en-US"))
    .filter((value) => value !== ""))].sort();
}

function sameEvidence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validPrice(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}
