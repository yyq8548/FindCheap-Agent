import type { SearchProductsInput } from "./search-products.js";

export const RECOMMENDATION_REASON_CODES = [
  "EXACT_MATCH",
  "BEST_FIT",
  "TRUSTED_MERCHANT",
  "LOWER_PRICE",
  "VERIFIED_COUPON"
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
  presentationGroup?: "OFFICIAL_STORE" | "TRUSTED_MATCH" | "BEST_VALUE" | undefined;
  recommendationTier?: "TRUSTED_OR_AFFILIATE" | "HIGH_RATED_UNVERIFIED" | "GENERAL_UNVERIFIED" | undefined;
  merchantTrust: {
    verification: "INDEPENDENT" | "UNVERIFIED";
  };
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  featureEvidence?: string[] | undefined;
  preferenceEvidence?: string[] | undefined;
  requiredFeatureLimitations?: string[] | undefined;
  matchEvidence: string[];
  itemPrice?: { amountCents: number; currency: "USD" } | undefined;
  coupons: { verified: unknown[] };
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
  const eligible = products
    .map((product, index) => ({ product, index }))
    .filter(({ product }) =>
      product.presentationGroup !== "BEST_VALUE" &&
      product.recommendationTier !== "GENERAL_UNVERIFIED" &&
      product.merchantTrust.verification === "INDEPENDENT" &&
      product.availability !== "OUT_OF_STOCK" &&
      product.matchStatus !== "SIMILAR"
    );
  if (eligible.length === 0) return { state: "RESEARCH_ONLY", reasonCodes: [] };

  eligible.sort((left, right) => comparePrimary(left.product, right.product));
  const selected = eligible[0]!;
  const reasonCodes: RecommendationReasonCode[] = [
    selected.product.matchStatus === "EXACT" ? "EXACT_MATCH" : "BEST_FIT"
  ];
  if (selected.product.merchantTrust.verification === "INDEPENDENT") reasonCodes.push("TRUSTED_MERCHANT");
  const peers = eligible.filter(({ product }) => sameFit(product, selected.product));
  const peerPrices = peers.map(({ product }) => product.itemPrice?.amountCents);
  const selectedPrice = selected.product.itemPrice?.amountCents;
  if (
    peers.length > 1 &&
    peerPrices.every((value): value is number => value !== undefined) &&
    selectedPrice !== undefined &&
    selectedPrice === Math.min(...peerPrices) &&
    peerPrices.some((value) => value > selectedPrice)
  ) {
    reasonCodes.push("LOWER_PRICE");
  } else if (selected.product.coupons.verified.length > 0) {
    reasonCodes.push("VERIFIED_COUPON");
  }
  return {
    state: "READY",
    reasonCodes: reasonCodes.slice(0, 3),
    primaryProductIndex: selected.index
  };
}

function comparePrimary(left: RecommendationProduct, right: RecommendationProduct): number {
  return matchRank(left) - matchRank(right) ||
    limitations(left) - limitations(right) ||
    fitEvidence(right) - fitEvidence(left) ||
    preferenceEvidence(right) - preferenceEvidence(left) ||
    trustRank(left) - trustRank(right) ||
    availabilityRank(left) - availabilityRank(right) ||
    price(left) - price(right) ||
    Number(right.coupons.verified.length > 0) - Number(left.coupons.verified.length > 0) ||
    right.matchEvidence.length - left.matchEvidence.length ||
    left.title.localeCompare(right.title);
}

function sameFit(left: RecommendationProduct, right: RecommendationProduct): boolean {
  return matchRank(left) === matchRank(right) &&
    limitations(left) === limitations(right) &&
    fitEvidence(left) === fitEvidence(right) &&
    preferenceEvidence(left) === preferenceEvidence(right) &&
    trustRank(left) === trustRank(right) &&
    availabilityRank(left) === availabilityRank(right);
}

function matchRank(product: RecommendationProduct): number {
  return product.matchStatus === "EXACT" ? 0 : product.matchStatus === "DISCOVERY_MATCH" ? 1 : 2;
}

function limitations(product: RecommendationProduct): number {
  return product.requiredFeatureLimitations?.length ?? 0;
}

function fitEvidence(product: RecommendationProduct): number {
  return (product.featureEvidence?.length ?? 0) + (product.preferenceEvidence?.length ?? 0);
}

function preferenceEvidence(product: RecommendationProduct): number {
  return product.preferenceEvidence?.length ?? 0;
}

function trustRank(product: RecommendationProduct): number {
  return product.merchantTrust.verification === "INDEPENDENT" ? 0 : 1;
}

function availabilityRank(product: RecommendationProduct): number {
  return product.availability === "IN_STOCK" ? 0 : product.availability === "UNKNOWN" ? 1 : 2;
}

function price(product: RecommendationProduct): number {
  return product.itemPrice?.amountCents ?? Number.MAX_SAFE_INTEGER;
}

function joinEnglish(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "information";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}
