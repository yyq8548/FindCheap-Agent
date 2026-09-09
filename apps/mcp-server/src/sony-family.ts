// Candidate titles cannot choose a family on the buyer's behalf.
const BARE_FAMILY = /(?<![\p{L}\p{N}])1000xm\d{1,2}\b/iu;
const QUALIFIED_FAMILY = /\bw[fh][\s-]?1000xm\d{1,2}\b/iu;

export function hasAmbiguousSonyFamily(query: string): boolean {
  return BARE_FAMILY.test(query.replace(new RegExp(QUALIFIED_FAMILY.source, "giu"), ""));
}

/** Only an explicit request category supplies the missing model prefix. */
export function resolveSonyFamilyQuery(query: string, productType: string | undefined): string {
  if (!hasAmbiguousSonyFamily(query) || QUALIFIED_FAMILY.test(query)) return query;
  const type = productType?.normalize("NFKC").toLowerCase().replace(/-/gu, " ").trim();
  const prefix = /^(?:over ear(?: headphones?)?|头戴式(?:耳机)?)$/u.test(type ?? "") ? "WH"
    : /^(?:in ear(?: headphones?)?|earbuds?|入耳式(?:耳机)?)$/u.test(type ?? "") ? "WF" : undefined;
  return prefix === undefined ? query : query.replace(BARE_FAMILY, model => `${prefix}-${model.toUpperCase()}`);
}
