import { assessProductRecommendation, choosePrimaryRecommendation } from "./product-recommendation.js";
import { comparableSameProduct, costAdvantage, type ValueEvidence, type ValueProduct } from "./product-value-evidence.js";
import { hasEquivalentFitEvidence } from "./ranking-assessment.js";
import { resolveMerchantTrust } from "./merchant-trust.js";

type Product = Parameters<typeof choosePrimaryRecommendation>[0][number] & {
  merchantUrl: string; merchantId: string; sellerName?: string | undefined; valueEvidence?: ValueEvidence | undefined;
};

/** A final safety projection, not a new ranking pass. Never reorder offers or
 * move their prices/IDs. Every derived snapshot shares the recommendation gate. */
export function finalizeSnapshotProducts<T extends Product>(products: T[], requestedBrand: boolean, evaluatedAtMs: number):
  Array<Omit<T, "presentationGroup" | "valueEvidence"> & Pick<Product, "presentationGroup" | "valueEvidence">> {
  const assessments = products.map(product => assessProductRecommendation(product, evaluatedAtMs));
  return products.map((product, index) => {
    const assessment = assessments[index]!;
    let group = product.presentationGroup;
    let valueEvidence: ValueEvidence | undefined;
    if (!assessment.primaryEligible) group = "RESEARCH_ONLY";
    else {
      let official = false;
      try {
        const trust = resolveMerchantTrust(new URL(product.merchantUrl).hostname);
        official = requestedBrand && product.merchantTrust.level === "OFFICIAL" &&
          trust.level === "OFFICIAL" && trust.verification === "INDEPENDENT";
      } catch { /* Invalid merchant URLs never establish official status. */ }
      if (group === "BEST_VALUE" || product.valueEvidence !== undefined) {
        const couponSaving = assessment.couponRank === 2 && assessment.effectivePriceCents < assessment.itemPriceCents;
        valueEvidence = products.map((peer, peerIndex) => {
          const other = assessments[peerIndex]!;
          const rating = assessment.qualityEvidence.rating;
          const peerRating = other.qualityEvidence.rating;
          if (index === peerIndex || !other.primaryEligible || !hasEquivalentFitEvidence(assessment, other) ||
            (peerRating && (!rating || rating.value < peerRating.value || rating.count < peerRating.count))) return undefined;
          return costAdvantage({ ...product, itemPrice: { amountCents: assessment.effectivePriceCents, currency: "USD" } },
            { ...peer, itemPrice: { amountCents: other.effectivePriceCents, currency: "USD" } });
        }).find(value => value !== undefined);
        if (valueEvidence === undefined && couponSaving) valueEvidence = { reason: "CONFIRMED_COUPON_SAVINGS",
          amountCents: assessment.itemPriceCents - assessment.effectivePriceCents, currency: "USD", basis: "ITEM_PRICE" };
        if (valueEvidence === undefined && group === "BEST_VALUE") group = "TRUSTED_MATCH";
      }
      if (official) group = "OFFICIAL_STORE";
      else if (group === undefined || group === "OFFICIAL_STORE") group = "TRUSTED_MATCH";
    }
    const finalized = { ...product, presentationGroup: group };
    if (valueEvidence === undefined) delete finalized.valueEvidence;
    else finalized.valueEvidence = valueEvidence;
    return finalized;
  });
}

export function resultMerchantKey(product: Pick<Product, "merchantUrl" | "merchantId" | "sellerName">): string {
  try {
    return JSON.stringify([new URL(product.merchantUrl).hostname.toLowerCase().replace(/^www\./u, ""),
      product.sellerName?.normalize("NFKC").trim().toLowerCase() ?? ""]);
  } catch { return JSON.stringify(["unresolved", product.merchantId]); }
}

/** Callers supply only recommendation-eligible offers. A second source domain
 * alone does not prove a second merchant selling the same variant. */
export function countComparableOfferMerchants(products: Array<ValueProduct & Pick<Product, "merchantUrl" | "merchantId" | "sellerName">>): number {
  const groups: typeof products[] = [];
  for (const product of products) {
    const group = groups.find(group => group.every(peer => comparableSameProduct(product, peer)));
    if (group) group.push(product);
    else groups.push([product]);
  }
  return Math.max(0, ...groups.map(group => new Set(group.map(resultMerchantKey)).size));
}

/** Final cards, not the provider's pre-filter pool, own public result semantics. */
export function summarizeSearchProducts(products: Product[], evaluatedAtMs = Date.now()) {
  const merchantCount = new Set(products.map(resultMerchantKey)).size;
  const recommendation = choosePrimaryRecommendation(products, evaluatedAtMs);
  const sameProduct = products.length > 1 && merchantCount > 1 &&
    products.every(product => product.requestIdentityStatus !== "NEEDS_VERIFICATION") &&
    products.every((product, index) => products.slice(index + 1).every(peer => comparableSameProduct(product, peer)));
  return { productCount: products.length, merchantCount, recommendation,
    identityUnverified: products.filter(product => product.requestIdentityStatus === "NEEDS_VERIFICATION").length,
    comparison: {
      status: sameProduct ? "SAME_PRODUCT" as const : "DISCOVERY_ONLY" as const,
      evidence: [sameProduct ? "final offers share stable identity, selected configuration and condition"
        : "final cards do not establish multiple merchants offering the same verified product and variant"],
      merchantCount, offerCount: products.length
    }
  };
}

/** Preserve useful provider evidence only when it agrees with the actual offers. */
export function reconcileComparison<T extends { status: string; merchantCount: number; offerCount: number; evidence: string[] }>(
  previous: T, computed: ReturnType<typeof summarizeSearchProducts>["comparison"]
): T | typeof computed {
  if (computed.offerCount === 0 && ["NEEDS_CLARIFICATION", "UNAVAILABLE"].includes(previous.status)) return previous;
  return previous.status === computed.status && previous.merchantCount === computed.merchantCount && previous.offerCount === computed.offerCount
    ? previous : computed;
}

export function searchFallbackExplanation(summary: ReturnType<typeof summarizeSearchProducts>, compareMerchants: boolean,
  locale: "en-US" | "zh-CN"): string {
  const chinese = locale === "zh-CN";
  if (summary.productCount > 0) {
    if (compareMerchants) return chinese
      ? "已保留找到的商品；跨商家比价尚未完成。可授权一次受限的全网补搜。"
      : "Found products are retained; cross-merchant comparison is incomplete. One bounded whole-web recovery may be authorized.";
    return chinese ? "已保留候选，但尚无可推荐的已核实匹配。可授权一次受限的全网补搜，扩大搜索范围。"
      : "Candidates are retained, but no verified match is eligible for recommendation. One bounded whole-web recovery may be authorized.";
  }
  return chinese ? "当前未返回符合要求的商品。可授权一次受限的全网补搜；本次有限检索不能证明商品不存在。"
    : "No qualifying product returned. One bounded whole-web recovery may be authorized; this bounded search does not prove absence.";
}
