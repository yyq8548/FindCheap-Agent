import { visualReviewScore, type VisualReviewAssessment } from "./visual-review-policy.js";

export const PRIMARY_BLOCK_REASON_CODES = [
  "VARIANT_OUT_OF_STOCK", "UNVERIFIED_MERCHANT", "UNFULFILLED_REQUIREMENTS", "SIMILAR_ONLY", "MISSING_PRICE"
] as const;
export type PrimaryBlockReasonCode = typeof PRIMARY_BLOCK_REASON_CODES[number];

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
  requirementAssessment?: { status: "SATISFIED" | "NEEDS_VERIFICATION" | "CONFLICT" } | undefined;
  featureEvidence?: readonly string[] | undefined;
  preferenceEvidence?: readonly string[] | undefined;
  itemPriceCents?: number | undefined;
  confirmedCouponPriceCents?: number | undefined;
  couponRank?: number | undefined;
  visualReviewAssessment?: VisualReviewAssessment | undefined;
};

export type RankingAssessment = {
  primaryEligible: boolean;
  primaryBlockReasons: PrimaryBlockReasonCode[];
  matchRank: number;
  visualReviewScore: number;
  limitationCount: number;
  featureEvidence: string[];
  preferenceEvidence: string[];
  trustRank: number;
  qualityRank: number;
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
  const limitationCount = Math.max(input.requiredFeatureLimitations?.length ?? 0,
    input.requirementAssessment !== undefined && input.requirementAssessment.status !== "SATISFIED" ? 1 : 0);
  const itemPrice = validPrice(input.itemPriceCents) ? input.itemPriceCents : Number.MAX_SAFE_INTEGER;
  const couponRank = Number.isFinite(input.couponRank) ? Math.max(-1, Math.min(2, input.couponRank!)) : -1;
  const effectivePrice = validPrice(input.itemPriceCents) && couponRank === 2 && validPrice(input.confirmedCouponPriceCents)
    ? Math.min(itemPrice, input.confirmedCouponPriceCents) : itemPrice;
  const primaryBlockReasons: PrimaryBlockReasonCode[] = [];
  if (input.availability === "OUT_OF_STOCK") primaryBlockReasons.push("VARIANT_OUT_OF_STOCK");
  if (!trusted) primaryBlockReasons.push("UNVERIFIED_MERCHANT");
  if (limitationCount > 0) primaryBlockReasons.push("UNFULFILLED_REQUIREMENTS");
  if (input.matchStatus === "SIMILAR") primaryBlockReasons.push("SIMILAR_ONLY");
  if (!validPrice(input.itemPriceCents)) primaryBlockReasons.push("MISSING_PRICE");
  return {
    primaryEligible: primaryBlockReasons.length === 0,
    primaryBlockReasons,
    matchRank: input.matchStatus === "EXACT" ? 0 : input.matchStatus === "DISCOVERY_MATCH" ? 1 : 2,
    visualReviewScore: visualReviewScore(input.visualReviewAssessment),
    limitationCount,
    featureEvidence: evidenceKeys(input.featureEvidence),
    preferenceEvidence: evidenceKeys(input.preferenceEvidence),
    trustRank: trusted ? 0 : 1,
    qualityRank: input.recommendationTier === "GENERAL_UNVERIFIED" ? 1 : 0,
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
    right.visualReviewScore - left.visualReviewScore ||
    right.featureEvidence.length - left.featureEvidence.length ||
    right.preferenceEvidence.length - left.preferenceEvidence.length ||
    left.trustRank - right.trustRank ||
    left.qualityRank - right.qualityRank ||
    left.availabilityRank - right.availabilityRank ||
    left.effectivePriceCents - right.effectivePriceCents ||
    left.itemPriceCents - right.itemPriceCents ||
    right.couponRank - left.couponRank ||
    left.title.localeCompare(right.title);
}

export function hasEquivalentFitEvidence(left: RankingAssessment, right: RankingAssessment): boolean {
  return left.featureEvidence.length + left.preferenceEvidence.length > 0 &&
    left.matchRank === right.matchRank && left.limitationCount === right.limitationCount &&
    left.visualReviewScore === right.visualReviewScore &&
    left.trustRank === right.trustRank && left.qualityRank === right.qualityRank && left.availabilityRank === right.availabilityRank &&
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
