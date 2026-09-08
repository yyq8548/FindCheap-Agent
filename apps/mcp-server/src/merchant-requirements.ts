export type RequirementDomain = "PRODUCT" | "MERCHANT_TRUST" | "MERCHANT_LOCATION" | "DELIVERY_MARKET" | "MERCHANT_OTHER";

/** Classify the whole requirement, never turn one supported clause of a
 * conjunction/negation into proof of the user's complete requirement. */
export function requirementDomain(requirement: string): RequirementDomain {
  const value = requirement.normalize("NFKC").trim().replace(/\s+/gu, " ");
  // An explicit whole condition describes the item, not the seller's trust.
  // Do not extend this exception to negations or additional merchant clauses.
  if (/^seller[ -]refurbished$/iu.test(value)) return "PRODUCT";
  if (/^(?:(?:from|only|only from) )?(?:(?:independently )?verified|trusted|trustworthy|reputable|reliable) (?:merchant|seller|retailer|store)s?$|^(?:只要|来自)?(?:已验证|已核验|可信|可信任|可靠)(?:的)?(?:商家|卖家|零售商)$/iu.test(value)) return "MERCHANT_TRUST";
  if (/\b(?:ships?|shipping|delivers?|delivery)\s+to\b|配送(?:至|到)|送(?:至|到)/iu.test(value)) return "DELIVERY_MARKET";
  if (/\b(?:merchant|seller|retailer|store)s?\s+(?:(?:is|are)\s+)?(?:based|located|registered|headquartered|in|from)\b|\b(?:US|USA|United States|American)[- ](?:based[- ]|located[- ])?(?:merchant|seller|retailer|store)s?\b|(?:美国|中国|英国|加拿大|本地)(?:的)?(?:商家|卖家)|(?:商家|卖家).*(?:位于|所在地|注册地)/iu.test(value)) return "MERCHANT_LOCATION";
  // Unknown merchant conditions remain explicit verification gaps. Product
  // descriptions and ratings cannot prove them by repeating the same words.
  if (/\b(?:merchant|seller|retailer)s?\b|\b(?:trusted|verified|official|reliable|reputable|trustworthy) stores?\b|商家|卖家|零售商/iu.test(value)) return "MERCHANT_OTHER";
  return "PRODUCT";
}

/** Retrieval/variant inspection consumes product attributes only. The original
 * request remains intact and is evaluated again on the final candidate. */
export function productRequirementFeatures(features: readonly string[]): string[] {
  return features.filter(feature => requirementDomain(feature) === "PRODUCT");
}
