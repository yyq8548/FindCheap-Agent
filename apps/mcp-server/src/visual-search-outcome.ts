import { candidateProductFacts } from "./woocommerce-product.js";
import type { UnifiedCandidate } from "./search-products.js";
import { z } from "zod";

export const VisualSearchOutcomeSchema = z.object({
  sameItemStatus: z.enum(["CONFIRMED", "POSSIBLE", "NOT_CONFIRMED"]),
  outOfStockStatus: z.enum(["CONFIRMED", "POSSIBLE", "NONE"]),
  incomplete: z.boolean(),
  message: z.string()
}).strict();

export function describeVisualOutcome(products: ReadonlyArray<{
  identityStatus: "EXACT" | "DISCOVERY_MATCH" | "SIMILAR";
  visualMatchGroup?: "POSSIBLE_SAME_ITEM" | "HIGHLY_SIMILAR" | "SAME_STYLE" | undefined;
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  availabilityScope?: "SELECTED_VARIANT" | "PRODUCT_COLOR" | undefined;
}>, incomplete: boolean, locale: "zh-CN" | "en-US"): z.infer<typeof VisualSearchOutcomeSchema> {
  const possible = products.filter(hasSameItemEvidence);
  const unavailable = possible.filter(product => product.availability === "OUT_OF_STOCK");
  const sameItemStatus = possible.some(product => product.identityStatus === "EXACT") ? "CONFIRMED" as const
    : possible.length > 0 ? "POSSIBLE" as const : "NOT_CONFIRMED" as const;
  const outOfStockStatus = unavailable.some(product => product.identityStatus === "EXACT") ? "CONFIRMED" as const
    : unavailable.length > 0 ? "POSSIBLE" as const : "NONE" as const;
  const zh = locale === "zh-CN";
  const parts = [products.length === 0 ? (zh ? "未返回符合条件的视觉候选。" : "No eligible visual candidates were returned.")
    : sameItemStatus === "CONFIRMED" ? (zh ? "已确认同款身份。" : "Same-item identity is confirmed.")
    : sameItemStatus === "POSSIBLE" ? (zh ? "找到可能同款候选，但身份尚未确认。" : "Possible same-item candidates were found; identity is not confirmed.")
    : (zh ? "未确认图片同款；当前展示已复核的相似款，相似处与差异见卡片。" : "The image's same item is not confirmed; reviewed similar choices and their differences are shown.")];
  if (outOfStockStatus !== "NONE") {
    const confirmed = outOfStockStatus === "CONFIRMED";
    const colorScope = unavailable.every(product => product.availabilityScope === "PRODUCT_COLOR");
    const selectedScope = unavailable.every(product => product.availabilityScope === "SELECTED_VARIANT");
    const subject = confirmed ? (zh ? "已确认同款" : "The confirmed item") : (zh ? "可能同款候选" : "A possible same-item candidate");
    const stock = colorScope ? (zh ? "的当前配色暂无已确认可售尺码" : " has no confirmed saleable sizes in the current color")
      : selectedScope ? (zh ? "的所选规格缺货" : "'s selected variant is out of stock")
      : (zh ? "缺货，库存范围以对应卡片证据为准" : " is out of stock; see the corresponding card for the verified stock scope");
    parts.push(`${subject}${stock}${confirmed
      ? (zh ? "；可按你的要求建立补货 Watch，尚未自动建立。" : "; an opt-in Watch can be requested, but none was created automatically.")
      : (zh ? "；确认身份后，可按你的要求建立补货 Watch。" : "; confirm its identity before requesting an opt-in Watch.")}`);
  }
  if (incomplete) parts.push(zh ? "检索尚不完整，不能据此判断商品不存在。" : "Retrieval is incomplete, not proof that the product is absent.");
  else parts.push(zh ? "这是本次有界检索结果，不代表已搜索全网。" : "These are bounded search results, not exhaustive web coverage.");
  return { sameItemStatus, outOfStockStatus, incomplete, message: parts.join(" ") };
}

export function needsMoreVisualReview(candidates: readonly UnifiedCandidate[], hasUnreviewedPool: boolean): boolean {
  const possible = candidates.filter(hasSameItemEvidence);
  const available = possible.some(candidate =>
    candidateProductFacts(candidate).availability === "IN_STOCK");
  const unavailable = possible.some(candidate =>
    candidateProductFacts(candidate).availability === "OUT_OF_STOCK");
  return candidates.length === 0 || (!available && (hasUnreviewedPool || unavailable));
}

/** Preserve useful unavailable identity evidence; this never makes it purchasable. */
export function selectVisualResults(candidates: readonly UnifiedCandidate[], limit: number): UnifiedCandidate[] {
  if (limit <= 0) return [];
  const selected = candidates.slice(0, limit);
  const anchor = candidates.find(candidate => hasSameItemEvidence(candidate) &&
    candidateProductFacts(candidate).availability === "OUT_OF_STOCK");
  return anchor === undefined || selected.includes(anchor) ? selected : [...selected.slice(0, limit - 1), anchor];
}

function hasSameItemEvidence(product: { identityStatus: string; visualMatchGroup?: string | undefined }): boolean {
  return product.identityStatus === "EXACT" || product.visualMatchGroup === "POSSIBLE_SAME_ITEM";
}
