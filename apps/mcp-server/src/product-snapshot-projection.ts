import type { ProductCardContent } from "./server.js";
import type { SearchProductsInput } from "./search-products.js";
import { coffeeCompatibilityClarification } from "./product-recommendation.js";
import {
  finalizeSnapshotProducts,
  reconcileComparison,
  snapshotCardSummary,
  snapshotResponseFacts,
  summarizeSearchProducts,
} from "./search-result-summary.js";
import { hasConflictingShopifyVariantId, matchesShopifyProductAnchor } from "./shopify-product-anchor.js";

/** Pure final projection shared by every new product snapshot. It owns card
 * eligibility, counts, recommendation state and retained-research semantics;
 * the server owns IDs, task history, consent and persistence. */
export function projectProductSnapshot(
  initial: ProductCardContent,
  request: SearchProductsInput | undefined,
  evaluatedAtMs: number,
): { content: ProductCardContent; primaryProductIndex?: number } {
  let content = initial;
  const anchoredProducts = request?.shopifyAnchor === undefined ? content.products
    : content.products.flatMap(product => product.sourceKind === "SHOPIFY_GLOBAL_CATALOG" && hasConflictingShopifyVariantId(product, request.shopifyAnchor!) ? []
      : matchesShopifyProductAnchor(product, request.shopifyAnchor!) ? [product]
      : request.allowAlternatives ? [{ ...product, matchStatus: "SIMILAR" as const, resultGroup: "ALTERNATIVE" as const,
        requestIdentityStatus: "NEEDS_VERIFICATION" as const, card: { ...product.card, matchBadge: "SIMILAR" as const },
        matchEvidence: [...new Set([...product.matchEvidence, "Different product or unverified identity relative to the source URL; explicitly requested alternative only"])] }] : []);
  const finalizedProducts = finalizeSnapshotProducts(anchoredProducts, request?.brand !== undefined, evaluatedAtMs);
  const summary = summarizeSearchProducts(finalizedProducts, evaluatedAtMs);
  const previousSummary = summarizeSearchProducts(content.products, evaluatedAtMs);
  if (finalizedProducts.length !== content.products.length || content.comparison.offerCount !== summary.productCount ||
    summary.qualifiedMatchCount !== previousSummary.qualifiedMatchCount ||
    summary.recommendation.state !== previousSummary.recommendation.state) {
    content = { ...content, message: snapshotCardSummary(summary, content.locale ?? "en-US") +
      (content.coverage === "PARTIAL" ? content.locale === "zh-CN" ? " 检索覆盖尚不完整。" : " Search coverage remains incomplete." : "") };
  }
  const decision = content.recommendation?.state === "NEEDS_CLARIFICATION" ? undefined : summary.recommendation;
  content = {
    ...content,
    products: finalizedProducts,
    comparison: reconcileComparison(content.comparison, summary.comparison),
    ...(content.recovery === undefined ? {} : { recovery: {
      ...content.recovery,
      qualified: summary.recoveryCounts.qualified,
      qualifiedMatches: summary.recoveryCounts.qualifiedMatches,
      recommendable: summary.recoveryCounts.recommendable,
      awaitingVerification: summary.recoveryCounts.awaitingVerification,
      ...(content.recovery.comparableMerchants === undefined ? {} : { comparableMerchants: summary.recoveryCounts.comparableMerchants }),
      ...(summary.productCount === 0 && content.recovery.reason === "MATCH_FOUND" ? { reason: "NO_QUALIFIED_MATCH" as const } : {}),
    } }),
    quality: {
      ...content.quality,
      cardsReturned: finalizedProducts.length,
      itemPricesVerified: finalizedProducts.length,
      affiliateLinksApproved: finalizedProducts.filter(product => product.purchaseLink.kind === "APPROVED_AFFILIATE").length,
      couponsVerified: new Set(finalizedProducts.flatMap(product => product.coupons.verified.map(deal =>
        JSON.stringify([product.sourceHost.toLowerCase(), product.merchantId, deal.dealId])))).size,
    },
    responseFacts: snapshotResponseFacts(finalizedProducts),
    ...(decision === undefined ? {} : { recommendation: { state: decision.state, reasonCodes: decision.reasonCodes } }),
  };
  const compatibilityQuestion = request !== undefined && content.products.some(product => product.coffeeCompatibility?.status === "UNKNOWN")
    ? coffeeCompatibilityClarification({ ...request, responseLocale: content.locale ?? request.responseLocale }, true) : undefined;
  if (compatibilityQuestion !== undefined && content.recommendation !== undefined && content.recommendation.state !== "READY") {
    content = { ...content, recommendation: { ...content.recommendation, question: compatibilityQuestion.question } };
  }
  return {
    content,
    ...(decision?.primaryProductIndex === undefined ? {} : { primaryProductIndex: decision.primaryProductIndex }),
  };
}
