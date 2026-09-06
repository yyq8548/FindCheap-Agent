import { describe, expect, it } from "vitest";
import { describeVisualOutcome, needsMoreVisualReview, selectVisualResults } from "../src/visual-search-outcome.js";
import type { UnifiedCandidate } from "../src/search-products.js";
import { product } from "./fixtures/conversation-replay-support.js";

describe("bounded visual outcome labels", () => {
  it.each(["zh-CN", "en-US"] as const)("keeps product-color stock distinct from a representative size (%s)", locale => {
    const input = [{ identityStatus: "EXACT" as const, availability: "OUT_OF_STOCK" as const,
      availabilityScope: "PRODUCT_COLOR" as const }];
    const confirmed = describeVisualOutcome(input, false, locale);
    expect(confirmed.message).toContain(locale === "zh-CN" ? "当前配色暂无已确认可售尺码" : "no confirmed saleable sizes in the current color");
    expect(confirmed.message).not.toContain(locale === "zh-CN" ? "所选规格" : "selected variant");
    const possible = describeVisualOutcome([{ ...input[0]!, identityStatus: "DISCOVERY_MATCH",
      visualMatchGroup: "POSSIBLE_SAME_ITEM" }], false, locale);
    expect(possible).toMatchObject({ sameItemStatus: "POSSIBLE", outOfStockStatus: "POSSIBLE" });
    expect(possible.message).toContain(locale === "zh-CN" ? "当前配色暂无已确认可售尺码" : "no confirmed saleable sizes in the current color");
  });

  it.each(["zh-CN", "en-US"] as const)("does not infer selected or whole-color stock when scope is absent or mixed (%s)", locale => {
    const exact = { identityStatus: "EXACT" as const, availability: "OUT_OF_STOCK" as const };
    for (const products of [[exact], [{ ...exact, availabilityScope: "PRODUCT_COLOR" as const }, exact]]) {
      const result = describeVisualOutcome(products, false, locale);
      expect(result.message).not.toContain(locale === "zh-CN" ? "所选规格" : "selected variant");
      expect(result.message).not.toContain(locale === "zh-CN" ? "当前配色暂无" : "no confirmed saleable sizes in the current color");
    }
    const selected = describeVisualOutcome([{ ...exact, availabilityScope: "SELECTED_VARIANT" }], false, locale);
    expect(selected.message).toContain(locale === "zh-CN" ? "所选规格缺货" : "selected variant is out of stock");
  });

  it.each(["zh-CN", "en-US"] as const)("does not describe similar choices when there are no cards (%s)", locale => {
    const result = describeVisualOutcome([], true, locale);
    expect(result.message).toContain(locale === "zh-CN" ? "未返回符合条件的视觉候选" : "No eligible visual candidates were returned");
    expect(result.message).not.toContain(locale === "zh-CN" ? "当前展示" : "choices and their differences are shown");
  });
  it("honors stable exact identity even when the visual review is highly similar", () => {
    const candidate: UnifiedCandidate = { source: "SHOPIFY_GLOBAL_CATALOG", identityStatus: "EXACT", resultGroup: "REQUESTED_PRODUCT",
      visualMatchGroup: "HIGHLY_SIMILAR", featureEvidence: [], requiredFeatureLimitations: [],
      affiliateState: "NONE", recommendationTier: "TRUSTED_OR_AFFILIATE", preferenceEvidence: [], verifiedCoupons: [], identityEvidence: [],
      shopifyProduct: product({ availability: "IN_STOCK" }) };
    expect(needsMoreVisualReview([candidate], true)).toBe(false);
    const unavailable = { ...candidate, shopifyProduct: { ...candidate.shopifyProduct!, availability: "OUT_OF_STOCK" as const } };
    expect(needsMoreVisualReview([unavailable], false)).toBe(true);
    expect(selectVisualResults([candidate, unavailable], 1)).toEqual([unavailable]);
    expect(describeVisualOutcome([{ identityStatus: "EXACT", visualMatchGroup: "HIGHLY_SIMILAR", availability: "OUT_OF_STOCK" }], false, "en-US"))
      .toMatchObject({ sameItemStatus: "CONFIRMED", outOfStockStatus: "CONFIRMED" });
  });
  it.each(["zh-CN", "en-US"] as const)("distinguishes an incomplete similar result from confirmed identity (%s)", locale => {
    const result = describeVisualOutcome([{ identityStatus: "SIMILAR", visualMatchGroup: "SAME_STYLE", availability: "IN_STOCK" }], true, locale);
    expect(result).toMatchObject({ sameItemStatus: "NOT_CONFIRMED", outOfStockStatus: "NONE", incomplete: true });
    expect(result.message).toContain(locale === "zh-CN" ? "相似款" : "similar");
    expect(result.message).toContain(locale === "zh-CN" ? "检索尚不完整" : "incomplete");
  });
  it("keeps possible out-of-stock identity tentative and only suggests an opt-in watch", () => {
    const result = describeVisualOutcome([{ identityStatus: "DISCOVERY_MATCH", visualMatchGroup: "POSSIBLE_SAME_ITEM", availability: "OUT_OF_STOCK" }], false, "zh-CN");
    expect(result).toMatchObject({ sameItemStatus: "POSSIBLE", outOfStockStatus: "POSSIBLE" });
    expect(result.message).toContain("可能同款候选缺货");
    expect(result.message).not.toContain("已建立");
    const confirmed = describeVisualOutcome([{ identityStatus: "EXACT", visualMatchGroup: "POSSIBLE_SAME_ITEM", availability: "OUT_OF_STOCK" }], false, "en-US");
    expect(confirmed).toMatchObject({ sameItemStatus: "CONFIRMED", outOfStockStatus: "CONFIRMED" });
    expect(confirmed.message).toContain("opt-in Watch");
  });
});
