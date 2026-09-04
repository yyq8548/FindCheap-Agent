import { z } from "zod";
import type { VerifiedDeal } from "./deal-client.js";

export const DealAssessmentReasonSchema = z.enum([
  "PRODUCT_ID_CONFIRMED", "PRODUCT_ID_MISMATCH", "PRODUCT_SCOPE_MISMATCH",
  "MINIMUM_SPEND_NOT_MET", "MINIMUM_SPEND_UNCONFIRMED", "WHOLESALE_ONLY",
  "CUSTOMER_ELIGIBILITY_UNCONFIRMED", "TERMS_CONFLICT", "SCOPE_UNVERIFIED",
  "MERCHANT_ELIGIBILITY_UNCONFIRMED"
]);
export const DealAssessmentSchema = z.object({
  status: z.enum(["CONFIRMED", "CONDITIONAL", "UNKNOWN", "INELIGIBLE"]),
  reasonCodes: z.array(DealAssessmentReasonSchema).min(1).max(4),
  recommendationEligible: z.boolean()
}).strict();
export type DealAssessment = z.infer<typeof DealAssessmentSchema>;
export type AssessedDeal = VerifiedDeal & { assessment: DealAssessment };
export type DealAssessmentProduct = {
  merchantProductId: string;
  productType?: string;
  title?: string;
  itemPrice?: { amountCents: number; currency: "USD" };
};
export const DealSummarySchema = z.object({
  status: z.enum(["CONFIRMED_DEAL", "MERCHANT_CANDIDATE", "NO_ELIGIBLE_DEAL", "UNAVAILABLE"]),
  recommendedDealId: z.string().max(160).optional(),
  reasonCodes: z.array(DealAssessmentReasonSchema).max(4)
}).strict();
export type DealSummary = z.infer<typeof DealSummarySchema>;

const PRODUCT_FAMILIES = [
  ["wig", /\bwigs?\b|假发/iu],
  ["hair-bundle", /\b(?:hair\s+)?bundles?\b|\bextensions?\b/iu],
  ["shampoo", /\bshampoo\b|洗发/iu],
  ["lashes", /\b(?:eye)?lashes\b|睫毛/iu],
  ["adhesive", /\b(?:tape|adhesive|glue)\b|胶水/iu]
] as const;

// These patterns can disqualify a candidate, never prove checkout eligibility.
export function assessSelectedProductDeal(deal: VerifiedDeal, product: DealAssessmentProduct): DealAssessment {
  if (deal.productApplicability === "PRODUCT_CONFIRMED" && !deal.applicableProductIds?.includes(product.merchantProductId)) {
    return assessment("INELIGIBLE", "PRODUCT_ID_MISMATCH");
  }
  const terms = [deal.description, ...deal.eligibility].join(" ");
  const text = `${deal.title} ${terms}`;
  if (benefitsConflict(deal.title, terms)) return assessment("UNKNOWN", "TERMS_CONFLICT");
  const minimum = minimumSpend([deal.title, deal.description, ...deal.eligibility]);
  if (minimum !== undefined && product.itemPrice !== undefined && product.itemPrice.amountCents < minimum) {
    return assessment("INELIGIBLE", "MINIMUM_SPEND_NOT_MET");
  }
  if (/\b(?:wholesale|bulk\s+orders?|resellers?)\b|批发/iu.test(text)) {
    return assessment("CONDITIONAL", "WHOLESALE_ONLY");
  }
  const requestedFamilies = families(product.productType ?? product.title ?? "");
  const scopedDescriptions = [deal.description, ...deal.eligibility].filter((value) =>
    /\b(?:only|exclusively|selected|valid\s+(?:on|for))\b/iu.test(value) &&
    !/\b(?:exclud\w*|except|not\s+(?:valid|applicable))\b/iu.test(value)
  );
  const offeredFamilies = families([deal.title, ...scopedDescriptions].join(" "));
  if (requestedFamilies.length === 1 && offeredFamilies.length > 0 && !offeredFamilies.includes(requestedFamilies[0]!)) {
    return assessment("INELIGIBLE", "PRODUCT_SCOPE_MISMATCH");
  }
  if (/\b(?:new\s+(?:customers?|users?)|first\s+(?:orders?|purchase)|members?\s+only|membership|subscri(?:be|ption))\b|新客|会员/iu.test(text)) {
    return assessment("CONDITIONAL", "CUSTOMER_ELIGIBILITY_UNCONFIRMED");
  }
  if (minimum !== undefined) return assessment("CONDITIONAL", "MINIMUM_SPEND_UNCONFIRMED");
  if (hasUnresolvedMonetaryOrderRestriction(text)) return assessment("UNKNOWN", "MINIMUM_SPEND_UNCONFIRMED");
  // Explicit stable identity satisfies "this item only", not an independent
  // customer, category or order restriction buried in the description.
  const restrictionText = deal.productApplicability === "PRODUCT_CONFIRMED"
    ? text.replace(/\b(?:this|the\s+selected)\s+(?:item|product)\s+only\b/giu, "")
    : text;
  if (deal.eligibility.length > 0 || /\b(?:selected|exclud\w*|exclusiv\w*|only|minimum|qualifying|eligible|specific|valid\s+(?:on|for))\b/iu.test(restrictionText)) {
    return assessment("UNKNOWN", "SCOPE_UNVERIFIED");
  }
  if (deal.productApplicability === "PRODUCT_CONFIRMED") return assessment("CONFIRMED", "PRODUCT_ID_CONFIRMED", true);
  if (deal.productApplicability === "MERCHANT_WIDE" && /\b(?:sitewide|site-wide|all\s+(?:orders?|products?|items?)|storewide)\b|全场/iu.test(text)) {
    return assessment("CONDITIONAL", "MERCHANT_ELIGIBILITY_UNCONFIRMED", true);
  }
  return assessment("UNKNOWN", "SCOPE_UNVERIFIED");
}

export function rankAssessedDeals<T extends AssessedDeal>(deals: readonly T[]): T[] {
  const statusRank = { CONFIRMED: 0, CONDITIONAL: 1, UNKNOWN: 2, INELIGIBLE: 3 };
  return [...deals].sort((left, right) =>
    Number(right.assessment.recommendationEligible) - Number(left.assessment.recommendationEligible) ||
    statusRank[left.assessment.status] - statusRank[right.assessment.status] ||
    percentBenefit(right) - percentBenefit(left) ||
    left.dealId.localeCompare(right.dealId, "en-US")
  );
}

function assessment(status: DealAssessment["status"], reason: DealAssessment["reasonCodes"][number], recommendationEligible = false): DealAssessment {
  return { status, reasonCodes: [reason], recommendationEligible };
}

function families(text: string): string[] {
  return PRODUCT_FAMILIES.filter(([, pattern]) => pattern.test(text)).map(([family]) => family);
}

function minimumSpend(fields: readonly string[]): number | undefined {
  const text = fields.join(" ");
  const amount = String.raw`(?:US\s*\$|USD\s*|\$)\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)`;
  const beforeAmount = new RegExp(String.raw`(?:orders?\s+(?:over|above|of|from)|spend(?:ing)?|minimum(?:\s+(?:spend|purchase|order))?(?:\s+of)?|purchases?\s+(?:over|above))\s*${amount}`, "giu");
  const afterAmount = new RegExp(String.raw`(?:orders?|purchases?)(?:\s+of)?\s*${amount}\s*(?:\+|(?:or|and)\s+(?:more|above|over|higher))`, "giu");
  const standalone = new RegExp(String.raw`^\s*${amount}\s*\+\s*$`, "iu");
  const matches = [...text.matchAll(beforeAmount), ...text.matchAll(afterAmount), ...fields.flatMap((field) => {
    const match = field.match(standalone);
    return match === null ? [] : [match];
  })];
  const amounts = matches.map((match) => Math.round(Number(match[1]!.replaceAll(",", "")) * 100)).filter(Number.isSafeInteger);
  return amounts.length === 0 ? undefined : Math.max(...amounts);
}

function hasUnresolvedMonetaryOrderRestriction(text: string): boolean {
  // Order amounts whose syntax is unknown remain conditions, not a confirmed
  // discount. Remove explicit fixed benefits so "all orders, $5 off" stays valid.
  const withoutBenefits = text.replace(/(?:USD\s*|US\s*\$|\$)\s*\d+(?:\.\d{1,2})?\s*(?:off|cashback|rebate|reward|savings)\b/giu, "");
  return /\b(?:orders?|purchases?|spend(?:ing)?|subtotal)\b[^.;\n]{0,80}(?:USD\s*|US\s*\$|[$€£¥])\s*\d/iu.test(withoutBenefits) ||
    /(?:USD\s*|US\s*\$|[$€£¥])\s*\d[^.;\n]{0,80}\b(?:orders?|purchases?|spend(?:ing)?|subtotal)\b/iu.test(withoutBenefits) ||
    /(?:USD\s*|US\s*\$|[$€£¥])\s*\d+(?:\.\d{1,2})?\s*\+/iu.test(withoutBenefits);
}

function percentBenefit(deal: VerifiedDeal): number {
  const stated = Number(deal.title.match(/\b(\d+(?:\.\d+)?)\s*%\s*off\b/iu)?.[1] ?? 0);
  return deal.discountPercent ?? (stated <= 100 ? stated : 0);
}

function benefitsConflict(title: string, terms: string): boolean {
  for (const pattern of [/\b(\d+(?:\.\d+)?)\s*%\s*off\b/giu, /\$\s*(\d+(?:\.\d{1,2})?)\s*off\b/giu]) {
    const headline = [...title.matchAll(pattern)].map((match) => Number(match[1]));
    const details = [...terms.matchAll(pattern)].map((match) => Number(match[1]));
    if (headline.length === 1 && details.length > 0 && details.every((amount) => amount !== headline[0])) return true;
  }
  return false;
}
