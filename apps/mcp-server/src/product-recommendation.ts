import type { SearchProductsInput } from "./search-products.js";
import { PRIMARY_BLOCK_REASON_CODES, assessRanking, compareRankingAssessments, hasEquivalentFitEvidence } from "./ranking-assessment.js";
import type { VisualReviewAssessment } from "./visual-review-policy.js";

export const RECOMMENDATION_REASON_CODES = [
  "EXACT_MATCH",
  "BEST_FIT",
  "TRUSTED_MERCHANT",
  "LOWER_PRICE",
  "VERIFIED_COUPON",
  ...PRIMARY_BLOCK_REASON_CODES
] as const;

export type RecommendationReasonCode = typeof RECOMMENDATION_REASON_CODES[number];
export type RecommendationState = "READY" | "NEEDS_CLARIFICATION" | "RESEARCH_ONLY" | "NO_MATCH";

export type RecommendationDecision = {
  state: RecommendationState;
  reasonCodes: RecommendationReasonCode[];
  primaryProductIndex?: number;
  question?: string;
};

type RecommendationProduct = {
  title: string;
  matchStatus: "EXACT" | "DISCOVERY_MATCH" | "SIMILAR";
  visualReviewAssessment?: VisualReviewAssessment | undefined;
  presentationGroup?: "OFFICIAL_STORE" | "TRUSTED_MATCH" | "BEST_VALUE" | "RESEARCH_ONLY" | undefined;
  recommendationTier?: "TRUSTED_OR_AFFILIATE" | "HIGH_RATED_UNVERIFIED" | "GENERAL_UNVERIFIED" | undefined;
  merchantTrust: {
    verification: "INDEPENDENT" | "UNVERIFIED";
    level?: "OFFICIAL" | "AUTHORIZED_RETAILER" | "ESTABLISHED_RETAILER" | "UNKNOWN" | "RISKY" | undefined;
  };
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  featureEvidence?: string[] | undefined;
  preferenceEvidence?: string[] | undefined;
  requiredFeatureLimitations?: string[] | undefined;
  requirementAssessment?: { status: "SATISFIED" | "NEEDS_VERIFICATION" | "CONFLICT" } | undefined;
  matchEvidence: string[];
  itemPrice?: { amountCents: number; currency: "USD" } | undefined;
  coupons: {
    verified: Array<{
      title?: string;
      productApplicability?: "PRODUCT_CONFIRMED" | "MERCHANT_WIDE" | "UNKNOWN";
    }>;
    estimatedItemPriceAfterCoupon?: { amountCents: number } | undefined;
  };
};

type HighVarianceRule = {
  terms: RegExp;
  requiresSize: boolean;
  label: string;
};

const HIGH_VARIANCE_RULES: HighVarianceRule[] = [
  { terms: /\b(?:laptop|notebook|macbook)\b|(?:笔记本(?:电脑)?|手提电脑)/iu, requiresSize: true, label: "laptop" },
  { terms: /\b(?:desktop|workstation|gaming\s+pc|imac|mac\s+mini)\b|(?:台式机|台式电脑|工作站|游戏电脑)/iu, requiresSize: false, label: "computer" },
  { terms: /\b(?:smartphone|mobile\s+phone|iphone|android\s+phone)\b|(?:智能手机|手机)/iu, requiresSize: false, label: "phone" },
  { terms: /\b(?:tablet|ipad)\b|(?:平板(?:电脑)?)/iu, requiresSize: false, label: "tablet" },
  { terms: /\b(?:camera|mirrorless|dslr)\b|(?:相机|微单|单反)/iu, requiresSize: false, label: "camera" },
  { terms: /\b(?:television|monitor|display)\b|(?:电视|显示器)/iu, requiresSize: true, label: "display" }
];

const SIZE_PATTERN = /(?:\b\d{1,3}(?:\.\d+)?\s*(?:inch|inches)\b|\d{1,3}(?:\.\d+)?\s*(?:英寸|寸))/iu;

export function highVarianceClarification(input: SearchProductsInput): {
  question: string;
  evidence: string;
} | undefined {
  if (input.comparisonMode !== "DISCOVERY" || input.visualInput !== undefined) return undefined;
  const searchable = [
    input.query,
    input.productType,
    input.requiredSize,
    input.preferredSize,
    ...input.requiredFeatures,
    ...input.preferences
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ");
  const rule = HIGH_VARIANCE_RULES.find((candidate) => candidate.terms.test(searchable));
  if (rule === undefined) return undefined;

  const missing: Array<"budget" | "use" | "size"> = [];
  if (input.maxItemPriceCents === undefined && !input.budgetFlexible) missing.push("budget");
  if (input.primaryUse === undefined) missing.push("use");
  if (
    rule.requiresSize &&
    input.requiredSize === undefined &&
    input.preferredSize === undefined &&
    !SIZE_PATTERN.test(searchable)
  ) missing.push("size");
  if (missing.length === 0) return undefined;

  const chinese = input.responseLocale === "zh-CN" ||
    (input.responseLocale === undefined && /\p{Script=Han}/u.test(input.query));
  const englishLabels = { budget: "maximum budget", use: "main use", size: "preferred screen size" } as const;
  const chineseLabels = { budget: "预算上限", use: "主要用途", size: "偏好的屏幕尺寸" } as const;
  const labels = missing.map((field) => chinese ? chineseLabels[field] : englishLabels[field]);
  return {
    question: chinese
      ? `请告诉我${labels.length > 1 ? `${labels.slice(0, -1).join("、")}和${labels.at(-1)}` : labels[0]}，再决定首选商品。`
      : `Please share your ${joinEnglish(labels)} before I choose a first recommendation.`,
    evidence: `high-variance ${rule.label} discovery lacks ${missing.join(", ")}`
  };
}

export function choosePrimaryRecommendation(products: RecommendationProduct[]): RecommendationDecision {
  if (products.length === 0) return { state: "NO_MATCH", reasonCodes: [] };
  const assessed = products
    .map((product, index) => ({ product, index, assessment: assessRanking({
      ...product,
      itemPriceCents: product.itemPrice?.amountCents,
      confirmedCouponPriceCents: product.coupons.estimatedItemPriceAfterCoupon?.amountCents,
      couponRank: couponRank(product)
    }) }));
  const eligible = assessed.filter(({ assessment }) => assessment.primaryEligible);
  if (eligible.length === 0) {
    const blockers = new Set(assessed.flatMap(({ assessment }) => assessment.primaryBlockReasons));
    return { state: "RESEARCH_ONLY", reasonCodes: PRIMARY_BLOCK_REASON_CODES.filter((code) => blockers.has(code)).slice(0, 3) };
  }

  eligible.sort((left, right) => compareRankingAssessments(left.assessment, right.assessment));
  const selected = eligible[0]!;
  const reasonCodes: RecommendationReasonCode[] = [
    selected.product.matchStatus === "EXACT" ? "EXACT_MATCH" : "BEST_FIT"
  ];
  if (selected.product.merchantTrust.verification === "INDEPENDENT") reasonCodes.push("TRUSTED_MERCHANT");
  const peers = eligible.filter(({ assessment }) => hasEquivalentFitEvidence(assessment, selected.assessment));
  const peerPrices = peers.map(({ assessment }) => assessment.effectivePriceCents);
  const selectedPrice = selected.assessment.effectivePriceCents;
  if (
    peers.length > 1 &&
    peerPrices.every((value) => value !== Number.MAX_SAFE_INTEGER) &&
    selectedPrice === Math.min(...peerPrices) &&
    peerPrices.some((value) => value > selectedPrice)
  ) {
    reasonCodes.push("LOWER_PRICE");
  } else if (couponRank(selected.product) > 1) {
    reasonCodes.push("VERIFIED_COUPON");
  }
  return {
    state: "READY",
    reasonCodes: reasonCodes.slice(0, 3),
    primaryProductIndex: selected.index
  };
}

function couponRank(product: RecommendationProduct): number {
  return product.coupons.verified.reduce((rank, coupon) => Math.max(
    rank,
    coupon.productApplicability === "PRODUCT_CONFIRMED"
      ? 2
      : coupon.productApplicability === "MERCHANT_WIDE" ? 1 : 0
  ), -1);
}

function joinEnglish(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "information";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}
