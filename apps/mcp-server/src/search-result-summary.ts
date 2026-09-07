import { choosePrimaryRecommendation } from "./product-recommendation.js";
import { comparableSameProduct, type ValueProduct } from "./product-value-evidence.js";

type Product = Parameters<typeof choosePrimaryRecommendation>[0][number] & {
  merchantUrl: string; merchantId: string; sellerName?: string | undefined;
};

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
