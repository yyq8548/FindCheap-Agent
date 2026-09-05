import { describe, expect, it } from "vitest";
import { researchRecommendationMessage } from "../src/recommendation-message.js";
import { choosePrimaryRecommendation, type RecommendationReasonCode } from "../src/product-recommendation.js";

describe("research recommendation messages", () => {
  it.each(["zh-CN", "en-US"] as const)("explains selected-variant stock without making a store-wide claim in %s", (locale) => {
    const message = researchRecommendationMessage({ productCount: 1, merchantCount: 1, reasonCodes: ["VARIANT_OUT_OF_STOCK"] }, locale);
    expect(message).toContain(locale === "zh-CN" ? "所选变体缺货" : "selected variant is out of stock");
    expect(message).not.toMatch(/商家可信|商家不可信|merchant.*trust|all sizes|所有尺码/u);
  });

  it.each([
    ["UNVERIFIED_MERCHANT", "商家可信证据不足", "merchant verification is insufficient"],
    ["UNFULFILLED_REQUIREMENTS", "必要要求尚未满足或核实", "required features are unmet or unverified"],
    ["MISSING_PRICE", "商品价格尚未核实", "item price is unverified"],
    ["SIMILAR_ONLY", "仅为替代或相似商品", "only alternative or similar products"]
  ] as const)("localizes %s without guessing another blocker", (code, zh, en) => {
    expect(researchRecommendationMessage({ productCount: 2, merchantCount: 1, reasonCodes: [code] }, "zh-CN")).toContain(zh);
    expect(researchRecommendationMessage({ productCount: 2, merchantCount: 1, reasonCodes: [code] }, "en-US")).toContain(en);
  });

  it("does not attribute an empty or positive-only legacy reason list to merchant trust", () => {
    for (const reasonCodes of [[], ["BEST_FIT" as RecommendationReasonCode]]) {
      const message = researchRecommendationMessage({ productCount: 1, merchantCount: 1, reasonCodes }, "zh-CN");
      expect(message).toContain("暂未确定可推荐的首选商品");
      expect(message).not.toContain("商家可信");
    }
    expect(choosePrimaryRecommendation([])).toEqual({ state: "NO_MATCH", reasonCodes: [] });
  });
});
