import {
  merchantRecommendationRank,
  resolveMerchantTrust
} from "./merchant-trust.js";
import type {
  SearchProductsInput,
  UnifiedCandidate
} from "./search-products.js";

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
  const visualDifference = (right.visualMatchScore ?? 0) - (left.visualMatchScore ?? 0);
  if (visualDifference !== 0) return visualDifference;
  const groupDifference = resultGroupRank(left.resultGroup) - resultGroupRank(right.resultGroup);
  if (groupDifference !== 0) return groupDifference;
  const matchDifference = matchRank(right) - matchRank(left);
  if (matchDifference !== 0) return matchDifference;
  const limitationDifference = left.requiredFeatureLimitations.length - right.requiredFeatureLimitations.length;
  if (limitationDifference !== 0) return limitationDifference;
  const featureDifference = right.featureEvidence.length - left.featureEvidence.length;
  if (featureDifference !== 0) return featureDifference;
  const tierDifference = merchantRecommendationRank(left.recommendationTier) -
    merchantRecommendationRank(right.recommendationTier);
  if (tierDifference !== 0) return tierDifference;
  const availabilityDifference = availabilityRank(left) - availabilityRank(right);
  if (availabilityDifference !== 0) return availabilityDifference;
  const preferenceDifference = right.preferenceEvidence.length - left.preferenceEvidence.length;
  if (preferenceDifference !== 0) return preferenceDifference;
  const couponDifference = Number(right.verifiedCoupons.length > 0) - Number(left.verifiedCoupons.length > 0);
  if (couponDifference !== 0) return couponDifference;
  const priceDifference = candidatePrice(left) - candidatePrice(right);
  if (priceDifference !== 0) return priceDifference;
  const ratingDifference = productRating(right) - productRating(left);
  if (ratingDifference !== 0) return ratingDifference;
  return candidateTitle(left).localeCompare(candidateTitle(right));
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
  const trusted = (selectionMode === "LOWEST_PRICE" ? trustedPool.sort(compareLowestPrice) : trustedPool)
    .slice(0, TRUSTED_PRODUCT_CARD_LIMIT)
    .map((candidate) => ({ ...candidate, presentationGroup: "TRUSTED_MATCH" as const }));
  const selectedKeys = new Set([...official, ...trusted].map(candidateKey));
  const bestValue = candidates
    .filter((candidate) => !selectedKeys.has(candidateKey(candidate)))
    .filter((candidate) => !isOfficialCandidate(candidate))
    .filter((candidate) => passesVisualDisplayGate(candidate, allowAlternatives))
    .filter((candidate) => candidate.recommendationTier === "GENERAL_UNVERIFIED")
    .sort(selectionMode === "LOWEST_PRICE" ? compareLowestPrice : compareBestValue)
    .slice(0, BEST_VALUE_PRODUCT_CARD_LIMIT)
    .map((candidate) => ({ ...candidate, presentationGroup: "BEST_VALUE" as const }));
  const grouped = [...official, ...trusted, ...bestValue];
  if (grouped.length > 0) return grouped.slice(0, MAX_PRODUCT_CARDS);
  if (visualDiscovery) return [];
  return candidates.slice(0, MAX_PRODUCT_CARDS);
}

export function selectVisualReviewCandidates(
  candidates: UnifiedCandidate[],
  limit: number
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
  return [...official, ...trusted, ...general].slice(0, limit).map((candidate) => ({
    ...candidate,
    presentationGroup: isOfficialCandidate(candidate)
      ? "OFFICIAL_STORE" as const
      : candidate.recommendationTier === "GENERAL_UNVERIFIED"
        ? "BEST_VALUE" as const
        : "TRUSTED_MATCH" as const
  }));
}

export function countDisplayEligibleCandidates(
  candidates: UnifiedCandidate[],
  allowAlternatives: boolean
): number {
  return candidates.filter((candidate) => passesVisualDisplayGate(candidate, allowAlternatives)).length;
}

export function compareLowestPrice(left: UnifiedCandidate, right: UnifiedCandidate): number {
  return candidatePrice(left) - candidatePrice(right) ||
    Number(right.verifiedCoupons.length > 0) - Number(left.verifiedCoupons.length > 0) ||
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

function compareBestValue(left: UnifiedCandidate, right: UnifiedCandidate): number {
  return Number(right.verifiedCoupons.length > 0) - Number(left.verifiedCoupons.length > 0) ||
    merchantRecommendationRank(left.recommendationTier) - merchantRecommendationRank(right.recommendationTier) ||
    candidatePrice(left) - candidatePrice(right) ||
    compareRankedCandidates(left, right);
}

export function candidateKey(candidate: UnifiedCandidate): string {
  if (candidate.source === "AWIN_PRODUCT_FEED") {
    return `${candidate.source}:${candidate.awinProduct.merchantId}:${candidate.awinProduct.merchantProductId}`;
  }
  if (candidate.source === "EBAY_BROWSE") return `${candidate.source}:${candidate.ebayProduct.itemId}`;
  return `${candidate.source}:${candidate.shopifyProduct.sourceHost}:${candidate.shopifyProduct.handle}`;
}

function resultGroupRank(group: UnifiedCandidate["resultGroup"]): number {
  switch (group) {
    case "REQUESTED_PRODUCT": return 0;
    case "DISCOVERY": return 1;
    case "ALTERNATIVE": return 2;
  }
}

function availabilityRank(candidate: UnifiedCandidate): number {
  const value = candidate.source === "AWIN_PRODUCT_FEED"
    ? candidate.awinProduct.availability
    : candidate.source === "SHOPIFY_GLOBAL_CATALOG"
      ? candidate.shopifyProduct.availability
      : candidate.ebayProduct.availability;
  return value === "IN_STOCK" ? 0 : value === "UNKNOWN" ? 1 : 2;
}

function productRating(candidate: UnifiedCandidate): number {
  return candidate.source === "SHOPIFY_GLOBAL_CATALOG" ? candidate.shopifyProduct.productRating?.value ?? 0 : 0;
}

function matchRank(candidate: UnifiedCandidate): number {
  const status = candidate.identityStatus;
  return status === "EXACT" ? 3 : status === "DISCOVERY_MATCH" ? 2 : 1;
}

function candidatePrice(candidate: UnifiedCandidate): number {
  if (candidate.source === "AWIN_PRODUCT_FEED") return candidate.awinProduct.itemPrice.amountCents;
  if (candidate.source === "EBAY_BROWSE") return candidate.ebayProduct.itemPrice.amountCents;
  return candidate.shopifyProduct.itemPrice?.amountCents ?? Number.MAX_SAFE_INTEGER;
}
