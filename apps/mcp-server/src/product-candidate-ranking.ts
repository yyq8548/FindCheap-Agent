import { resolveMerchantTrust } from "./merchant-trust.js";
import { productReferenceKey } from "./product-reference.js";
import { assessRanking, compareRankingAssessments } from "./ranking-assessment.js";
import { assessSelectedProductDeal } from "./deal-assessment.js";
import {
  dealApplicabilityRank,
  estimatedItemPriceAfterCoupon
} from "./deal-client.js";
import type {
  SearchProductsInput,
  UnifiedCandidate
} from "./search-products.js";
import { visualColorwayTerms, type VisualProductInput } from "./visual-product-discovery.js";

export const OFFICIAL_PRODUCT_CARD_LIMIT = 2;
export const TRUSTED_PRODUCT_CARD_LIMIT = 3;
export const BEST_VALUE_PRODUCT_CARD_LIMIT = 3;
export const MAX_PRODUCT_CARDS =
  OFFICIAL_PRODUCT_CARD_LIMIT + TRUSTED_PRODUCT_CARD_LIMIT + BEST_VALUE_PRODUCT_CARD_LIMIT;

export function candidateMerchant(candidate: UnifiedCandidate): string {
  if (candidate.source === "AWIN_PRODUCT_FEED") return candidate.awinProduct.merchant;
  if (candidate.source === "EBAY_BROWSE") return "eBay";
  return candidate.shopifyProduct.merchant;
}

export function compareRankedCandidates(left: UnifiedCandidate, right: UnifiedCandidate): number {
  if (left.visualReviewAssessment !== undefined || right.visualReviewAssessment !== undefined) {
    return compareRankingAssessments(candidateRanking(left), candidateRanking(right));
  }
  const visualDifference = (right.visualMatchScore ?? 0) - (left.visualMatchScore ?? 0);
  if (visualDifference !== 0) return visualDifference;
  const groupDifference = resultGroupRank(left.resultGroup) - resultGroupRank(right.resultGroup);
  if (groupDifference !== 0) return groupDifference;
  return compareRankingAssessments(candidateRanking(left), candidateRanking(right));
}

function candidateRanking(candidate: UnifiedCandidate) {
  const source = candidate.awinProduct ?? candidate.shopifyProduct ?? candidate.ebayProduct;
  const registered = resolveMerchantTrust(new URL(source.merchantUrl).hostname, candidateMerchant(candidate));
  const trust = candidate.shopifyProduct?.merchantTrust ?? (candidate.source === "AWIN_PRODUCT_FEED" &&
    registered.level !== "RISKY" && registered.verification !== "INDEPENDENT"
    ? { level: "ESTABLISHED_RETAILER" as const, verification: "INDEPENDENT" as const }
    : registered);
  return assessRanking({
    title: candidateTitle(candidate), matchStatus: candidate.identityStatus,
    recommendationTier: candidate.recommendationTier, merchantTrust: trust,
    availability: source.availability, requiredFeatureLimitations: candidate.requiredFeatureLimitations,
    featureEvidence: candidate.featureEvidence, preferenceEvidence: candidate.preferenceEvidence,
    visualReviewAssessment: candidate.visualReviewAssessment,
    itemPriceCents: candidatePrice(candidate), confirmedCouponPriceCents: candidateEffectivePrice(candidate),
    couponRank: candidateCouponRank(candidate)
  });
}

export function selectPresentationCandidates(
  candidates: UnifiedCandidate[],
  selectionMode: SearchProductsInput["selectionMode"],
  allowAlternatives: boolean,
  visualDiscovery: boolean
): UnifiedCandidate[] {
  const official = candidates
    .filter(isOfficialCandidate)
    .filter((candidate) => passesVisualDisplayGate(candidate, allowAlternatives))
    .slice(0, OFFICIAL_PRODUCT_CARD_LIMIT)
    .map((candidate) => ({ ...candidate, presentationGroup: "OFFICIAL_STORE" as const }));
  const trustedPool = candidates
    .filter((candidate) => !isOfficialCandidate(candidate))
    .filter((candidate) => passesVisualDisplayGate(candidate, allowAlternatives))
    .filter((candidate) =>
      candidate.recommendationTier === "TRUSTED_OR_AFFILIATE" ||
      candidate.recommendationTier === "HIGH_RATED_UNVERIFIED"
    );
  const rankedTrusted = trustedPool.sort(
    selectionMode === "LOWEST_PRICE" ? compareLowestPrice : compareRankedCandidates
  );
  const trusted = (selectionMode === "MERCHANT_DIVERSE"
    ? selectMerchantDiverse(rankedTrusted, TRUSTED_PRODUCT_CARD_LIMIT)
    : rankedTrusted.slice(0, TRUSTED_PRODUCT_CARD_LIMIT))
    .map((candidate) => ({ ...candidate, presentationGroup: "TRUSTED_MATCH" as const }));
  const selectedKeys = new Set([...official, ...trusted].map(candidateKey));
  const rankedBestValue = candidates
    .filter((candidate) => !selectedKeys.has(candidateKey(candidate)))
    .filter((candidate) => !isOfficialCandidate(candidate))
    .filter((candidate) => passesVisualDisplayGate(candidate, allowAlternatives))
    .sort(selectionMode === "LOWEST_PRICE" ? compareLowestPrice : compareRankedCandidates);
  const usedMerchantKeys = new Set([...official, ...trusted].map(candidateMerchantKey));
  const bestValue = (selectionMode === "MERCHANT_DIVERSE"
    ? selectMerchantDiverse(rankedBestValue, BEST_VALUE_PRODUCT_CARD_LIMIT, usedMerchantKeys)
    : rankedBestValue.slice(0, BEST_VALUE_PRODUCT_CARD_LIMIT))
    .map((candidate) => ({ ...candidate, presentationGroup: "BEST_VALUE" as const }));
  const grouped = [...official, ...trusted, ...bestValue];
  if (grouped.length > 0) return grouped.slice(0, MAX_PRODUCT_CARDS);
  if (visualDiscovery) return [];
  return candidates.slice(0, MAX_PRODUCT_CARDS);
}

export function selectVisualReviewCandidates(
  candidates: UnifiedCandidate[],
  limit: number,
  visual?: VisualProductInput
): UnifiedCandidate[] {
  // Metadata-only SAME_STYLE is not a final verdict. Product-family conflicts
  // were already removed before candidate images reached this review queue.
  const eligible = candidates;
  const official = eligible.filter(isOfficialCandidate);
  const trusted = eligible.filter((candidate) =>
    !isOfficialCandidate(candidate) &&
    (candidate.recommendationTier === "TRUSTED_OR_AFFILIATE" ||
      candidate.recommendationTier === "HIGH_RATED_UNVERIFIED")
  );
  const general = eligible.filter((candidate) =>
    !isOfficialCandidate(candidate) && candidate.recommendationTier === "GENERAL_UNVERIFIED"
  );
  const colorway = visual === undefined ? { colors: [], patterns: [] } : visualColorwayTerms(visual);
  const colorwayScore = (candidate: UnifiedCandidate): number => {
    const product = candidate.awinProduct ?? candidate.shopifyProduct ?? candidate.ebayProduct;
    const text = [product.title, "description" in product ? product.description : undefined,
      ...(candidate.shopifyProduct === undefined ? [] : Object.values(candidate.shopifyProduct.variantDimensions))]
      .filter((entry): entry is string => typeof entry === "string").join(" ").normalize("NFKC")
      .toLocaleLowerCase("en-US").replace(/\bgrey\b/gu, "gray");
    const contains = (term: string): boolean => new RegExp(`\\b${term}\\b`, "u").test(text);
    return colorway.colors.filter(contains).length * 2 + colorway.patterns.filter(contains).length * 3;
  };
  const reviewScore = (candidate: UnifiedCandidate): number => {
    const structure = visualReviewStructureScore(candidate);
    // Weak color/pattern evidence earns review, never a final similarity verdict.
    // Keep it below the structural tier even when several color terms match.
    return (structure > 0 ? 1_000 + structure : 0) + colorwayScore(candidate) * 3;
  };
  const styles = new Map<string, UnifiedCandidate[]>();
  // Review relevance is separate from presentation groups and merchant eligibility.
  // Preserve official/trusted priority only when review relevance is tied.
  const ranked = [...official, ...trusted, ...general].sort((left, right) =>
    reviewScore(right) - reviewScore(left)
  );
  for (const candidate of ranked) {
    const style = `${candidateMerchantKey(candidate)}:${candidateTitle(candidate)
      .split(/\s+(?:\||--|—)\s+/u)[0]!.normalize("NFKC").toLocaleLowerCase("en-US")}`;
    const entries = styles.get(style) ?? [];
    entries.push(candidate);
    styles.set(style, entries);
  }
  const groups = [...styles.values()].map((entries) => entries.sort((left, right) =>
    colorwayScore(right) - colorwayScore(left) || reviewScore(right) - reviewScore(left)
  )).sort((left, right) => reviewScore(right[0]!) - reviewScore(left[0]!));
  const diverse = [...diversifyReviewStyles(groups.map((entries) => entries[0]!), reviewScore), ...groups.flatMap((entries) => entries.slice(1))];
  return diverse.slice(0, limit).map((candidate) => ({
    ...candidate,
    presentationGroup: isOfficialCandidate(candidate)
      ? "OFFICIAL_STORE" as const
      : candidate.recommendationTier === "GENERAL_UNVERIFIED"
        ? "BEST_VALUE" as const
        : "TRUSTED_MATCH" as const
  }));
}

function diversifyReviewStyles(candidates: UnifiedCandidate[], score: (candidate: UnifiedCandidate) => number): UnifiedCandidate[] {
  const remaining = [...candidates];
  const selected: UnifiedCandidate[] = [];
  // At most three same-merchant styles per six-item batch when near-equal peers
  // exist. No unrelated merchant is promoted merely to fill a diversity quota.
  while (remaining.length > 0) {
    const batch = selected.slice(selected.length - selected.length % 6);
    const topScore = score(remaining[0]!);
    const peerIndex = topScore <= 0 ? -1 : remaining.findIndex((candidate) =>
      score(candidate) >= topScore - 5 &&
      batch.filter((entry) => candidateMerchantKey(entry) === candidateMerchantKey(candidate)).length < 3
    );
    selected.push(remaining.splice(peerIndex < 0 ? 0 : peerIndex, 1)[0]!);
  }
  return selected;
}

function visualReviewStructureScore(candidate: UnifiedCandidate): number {
  // Brand, color, and material alone do not establish structural similarity.
  const structuralMatch = candidate.visualMatchEvidence?.some((entry) =>
    /^visual attribute matched: (?:silhouette|length|neckline|sleeve|closure|collar|waist|hem|detail|distinctive detail): /u.test(entry)
  );
  return structuralMatch ? candidate.visualMatchScore ?? 0 : 0;
}

export function countDisplayEligibleCandidates(
  candidates: UnifiedCandidate[],
  allowAlternatives: boolean
): number {
  return candidates.filter((candidate) => passesVisualDisplayGate(candidate, allowAlternatives)).length;
}

export function compareLowestPrice(left: UnifiedCandidate, right: UnifiedCandidate): number {
  if (left.visualReviewAssessment !== undefined || right.visualReviewAssessment !== undefined) {
    return compareRankingAssessments(candidateRanking(left), candidateRanking(right));
  }
  return candidateEffectivePrice(left) - candidateEffectivePrice(right) ||
    candidatePrice(left) - candidatePrice(right) ||
    candidateCouponRank(right) - candidateCouponRank(left) ||
    compareRankedCandidates(left, right);
}

export function candidateTitle(candidate: UnifiedCandidate): string {
  if (candidate.source === "AWIN_PRODUCT_FEED") return candidate.awinProduct.title;
  if (candidate.source === "EBAY_BROWSE") return candidate.ebayProduct.title;
  return candidate.shopifyProduct.title;
}

function isOfficialCandidate(candidate: UnifiedCandidate): boolean {
  if (candidate.source !== "SHOPIFY_GLOBAL_CATALOG") return false;
  try {
    const merchantUrl = new URL(candidate.shopifyProduct.merchantUrl);
    const websiteTrust = resolveMerchantTrust(merchantUrl.hostname, candidate.shopifyProduct.merchant);
    return merchantUrl.protocol === "https:" &&
      candidate.shopifyProduct.merchantTrust.level === "OFFICIAL" &&
      candidate.shopifyProduct.merchantTrust.verification === "INDEPENDENT" &&
      websiteTrust.level === "OFFICIAL" &&
      websiteTrust.verification === "INDEPENDENT";
  } catch {
    return false;
  }
}

function passesVisualDisplayGate(candidate: UnifiedCandidate, allowAlternatives: boolean): boolean {
  return candidate.resultGroup === "REQUESTED_PRODUCT" ||
    candidate.visualMatchGroup === undefined ||
    candidate.visualMatchGroup !== "SAME_STYLE" ||
    allowAlternatives;
}

export function candidateKey(candidate: UnifiedCandidate): string {
  if (candidate.source === "AWIN_PRODUCT_FEED") {
    return `${candidate.source}:${candidate.awinProduct.merchantId}:${candidate.awinProduct.merchantProductId}`;
  }
  if (candidate.source === "EBAY_BROWSE") return `${candidate.source}:${candidate.ebayProduct.itemId}`;
  return productReferenceKey(candidate.shopifyProduct);
}

function candidateMerchantKey(candidate: UnifiedCandidate): string {
  return candidateMerchant(candidate)
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ");
}

function selectMerchantDiverse(
  candidates: UnifiedCandidate[],
  limit: number,
  initialMerchantKeys: Set<string> = new Set()
): UnifiedCandidate[] {
  const selected: UnifiedCandidate[] = [];
  const selectedCandidateKeys = new Set<string>();
  const merchantKeys = new Set(initialMerchantKeys);
  for (const candidate of candidates) {
    const merchantKey = candidateMerchantKey(candidate);
    if (merchantKeys.has(merchantKey)) continue;
    selected.push(candidate);
    selectedCandidateKeys.add(candidateKey(candidate));
    merchantKeys.add(merchantKey);
    if (selected.length === limit) return selected;
  }
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (selectedCandidateKeys.has(key)) continue;
    selected.push(candidate);
    if (selected.length === limit) break;
  }
  return selected;
}

function resultGroupRank(group: UnifiedCandidate["resultGroup"]): number {
  switch (group) {
    case "REQUESTED_PRODUCT": return 0;
    case "DISCOVERY": return 1;
    case "ALTERNATIVE": return 2;
  }
}

function candidatePrice(candidate: UnifiedCandidate): number {
  if (candidate.source === "AWIN_PRODUCT_FEED") return candidate.awinProduct.itemPrice.amountCents;
  if (candidate.source === "EBAY_BROWSE") return candidate.ebayProduct.itemPrice.amountCents;
  return candidate.shopifyProduct.itemPrice?.amountCents ?? Number.MAX_SAFE_INTEGER;
}

function candidateEffectivePrice(candidate: UnifiedCandidate): number {
  const itemPrice = candidatePrice(candidate);
  if (!Number.isSafeInteger(itemPrice)) return itemPrice;
  return estimatedItemPriceAfterCoupon(
    itemPrice,
    candidate.verifiedCoupons.filter((deal) => assessCandidateDeal(candidate, deal).status === "CONFIRMED"),
    candidateProductId(candidate)
  ) ?? itemPrice;
}

function candidateCouponRank(candidate: UnifiedCandidate): number {
  const productId = candidateProductId(candidate);
  return candidate.verifiedCoupons.reduce(
    (rank, deal) => {
      const assessment = assessCandidateDeal(candidate, deal);
      return Math.max(rank, assessment.recommendationEligible ? dealApplicabilityRank(deal, productId) : -1);
    },
    -1
  );
}

function assessCandidateDeal(candidate: UnifiedCandidate, deal: UnifiedCandidate["verifiedCoupons"][number]) {
  const price = candidatePrice(candidate);
  return assessSelectedProductDeal(deal, {
    merchantProductId: candidateProductId(candidate), title: candidateTitle(candidate),
    ...(price === Number.MAX_SAFE_INTEGER ? {} : { itemPrice: { amountCents: price, currency: "USD" as const } })
  });
}

function candidateProductId(candidate: UnifiedCandidate): string {
  if (candidate.source === "AWIN_PRODUCT_FEED") return candidate.awinProduct.merchantProductId;
  if (candidate.source === "EBAY_BROWSE") return candidate.ebayProduct.productRef;
  return candidate.shopifyProduct.handle;
}
