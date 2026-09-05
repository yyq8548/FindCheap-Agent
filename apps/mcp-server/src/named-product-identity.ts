/** Reviewed aliases, not a translation heuristic. Both franchise and character
 * are required; a lone name must never identify a licensed character product. */
export function normalizeNamedProductIdentity(value: string): string {
  return value.normalize("NFKC")
    .replace(/\bHonor\s+of\s+Kings\b|王者荣耀/giu, " honorofkings ")
    .replace(/\bLi\s+Bai\b|李白/giu, " libai ")
    .replace(/\bdefault(?:\s+character)?(?:\s+(?:costume|appearance|skin|look))?\b|原皮|默认(?:造型|皮肤)?/giu, " default ")
    .replace(/假发/gu, " wig ")
    .replace(/\b(?:from|cosplay|costume|character)\b|角色/giu, " ")
    .replace(/[(),]/gu, " ").replace(/\s+/gu, " ").trim();
}

/** A skin/appearance requirement is evidence about the requested character,
 * not any other product mentioned on the same merchant page. */
export function boundNamedIdentityRequirement(feature: string, identityQuery?: string): string {
  const identity = identityQuery === undefined ? undefined : namedProductIdentity(identityQuery);
  return identity !== undefined && normalizeNamedProductIdentity(feature).toLowerCase() === "default"
    ? `${identity.franchise} ${identity.character} default` : feature;
}

export function namedProductIdentity(value: string): { franchise: "honorofkings"; character: "libai" } | undefined {
  const normalized = normalizeNamedProductIdentity(value);
  return /\bhonorofkings\b/iu.test(normalized) && /\blibai\b/iu.test(normalized)
    ? { franchise: "honorofkings", character: "libai" } : undefined;
}

export function namedIdentityRetrievalQuery(value: string, pass: 1 | 2): string | undefined {
  if (namedProductIdentity(value) === undefined) return undefined;
  const normalized = normalizeNamedProductIdentity(value);
  const variant = /\bdefault\b/iu.test(normalized);
  const wig = /\bwigs?\b/iu.test(normalized);
  // Only this reviewed category/identity combination has a bilingual plan.
  if (!wig) return undefined;
  return pass === 1 ? `Honor of Kings Li Bai${variant ? " default" : ""} wig`
    : `王者荣耀 李白${variant ? " 原皮" : ""} 假发`;
}
