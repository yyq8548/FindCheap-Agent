import { PRIMARY_BLOCK_REASON_CODES, type PrimaryBlockReasonCode } from "./ranking-assessment.js";
import type { RecommendationReasonCode } from "./product-recommendation.js";

const LIMITATIONS: Record<"zh-CN" | "en-US", Record<PrimaryBlockReasonCode, string>> = {
  "zh-CN": {
    IDENTITY_UNVERIFIED: "商品名称或版本身份待确认；请确认具体版本或提供商品链接",
    VARIANT_OUT_OF_STOCK: "所选变体缺货；其他规格库存未据此判断",
    UNVERIFIED_MERCHANT: "商家可信证据不足",
    UNFULFILLED_REQUIREMENTS: "必要要求尚未满足或核实",
    SIMILAR_ONLY: "仅为替代或相似商品",
    MISSING_PRICE: "商品价格尚未核实",
    VISUAL_REVIEW_REQUIRED: "所选变体的图片匹配尚未复核",
    COFFEE_SYSTEM_UNVERIFIED: "胶囊系统兼容性尚未核实；请提供咖啡机完整型号或胶囊系统"
  },
  "en-US": {
    IDENTITY_UNVERIFIED: "product name or edition needs confirmation; confirm the edition or provide a product link",
    VARIANT_OUT_OF_STOCK: "the selected variant is out of stock; other variants' availability is not established by this",
    UNVERIFIED_MERCHANT: "merchant verification is insufficient",
    UNFULFILLED_REQUIREMENTS: "required features are unmet or unverified",
    SIMILAR_ONLY: "only alternative or similar products are available",
    MISSING_PRICE: "item price is unverified",
    VISUAL_REVIEW_REQUIRED: "visual matching for the selected variant needs review",
    COFFEE_SYSTEM_UNVERIFIED: "capsule system compatibility is unverified; provide the full coffee machine model or capsule system"
  }
};

/** A summary of actual blocked results, never a claim that every card has every limitation. */
export function researchRecommendationMessage(input: {
  productCount: number;
  merchantCount: number;
  reasonCodes: readonly RecommendationReasonCode[];
}, locale: "zh-CN" | "en-US"): string {
  const reasons = PRIMARY_BLOCK_REASON_CODES.filter((code) => input.reasonCodes.includes(code))
    .map((code) => LIMITATIONS[locale][code]);
  if (locale === "zh-CN") {
    return `找到 ${input.productCount} 张调研卡片，来自 ${input.merchantCount} 家商家，暂未确定可推荐的首选商品。` +
      (reasons.length === 0 ? "" : `这些结果涉及的限制包括：${reasons.join("；")}。`) +
      "不要建议直接购买。";
  }
  return `Found ${input.productCount} research card(s) from ${input.merchantCount} merchant(s), but no eligible primary recommendation. ` +
    (reasons.length === 0 ? "" : `Limitations across these results include: ${reasons.join("; ")}. `) +
    "Do not recommend purchasing one.";
}
