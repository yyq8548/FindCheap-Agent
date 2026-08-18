export type ShopifyMatchStatus = "EXACT" | "SIMILAR" | "IRRELEVANT";

export type ShopifyMatchCandidate = {
  title: string;
  brand?: string;
  sku?: string;
  handle?: string;
  gtins?: readonly string[];
  productType?: string;
  tags?: readonly string[];
  variantDimensions?: Readonly<Record<string, string>>;
};

export type ShopifyMatchResult = {
  status: ShopifyMatchStatus;
  evidence: string[];
  missingTerms: string[];
};

const CATEGORY_GROUPS = [
  { terms: ["shirt", "shirts", "tee", "tees", "tshirt", "tshirts"] },
  { terms: ["shoe", "shoes", "sneaker", "sneakers"] },
  { terms: ["headphone", "headphones", "headset", "headsets", "earbud", "earbuds"] },
  { terms: ["sofa", "sofas", "couch", "couches"] },
  { terms: ["tv", "television", "televisions"] },
  { terms: ["fridge", "fridges", "refrigerator", "refrigerators"] },
  { terms: ["phone", "phones", "smartphone", "smartphones"] },
  { terms: ["laptop", "laptops", "notebook", "notebooks"] },
  { terms: ["lipstick", "lipsticks", "lipgloss", "gloss"], productTypeOnly: true },
  { terms: ["coffee", "coffees"], productTypeOnly: true },
  { terms: ["water", "waters"], productTypeOnly: true },
  { terms: ["bracelet", "bracelets", "bangle", "bangles"] },
  { terms: ["sheet", "sheets", "bedding"] }
] as const;

const IGNORED_QUERY_TERMS = new Set([
  "a", "an", "and", "buy", "cheap", "color", "colour", "find", "for", "in",
  "new", "of", "price", "size", "the", "with"
]);
const VARIANT_COLORS = new Set([
  "beige", "black", "blue", "brown", "cream", "gold", "gray", "green", "grey", "midnight",
  "navy", "orange", "pink", "purple", "red", "silver", "tan", "white", "yellow"
]);
const ACCESSORY_TERMS = new Set([
  "accessories", "accessory", "adapter", "cable", "case", "charger", "charm", "charms", "cover",
  "holder", "keychain", "keychains", "keyring", "protector", "replacement", "stand"
]);

export function classifyShopifyCandidate(
  query: string,
  candidate: ShopifyMatchCandidate
): ShopifyMatchResult {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return irrelevant("query has no searchable terms");

  const productTypeTokens = new Set(tokenize(candidate.productType ?? ""));
  const candidateTokens = new Set(tokenize(candidateText(candidate)));
  const candidateCompact = compact(candidateText(candidate));
  const requestedVariantTerms = extractVariantTerms(queryTokens);
  const variantTokens = new Set(tokenize(Object.values(candidate.variantDimensions ?? {}).join(" ")));
  if (
    [...ACCESSORY_TERMS].some((term) => candidateTokens.has(term)) &&
    !queryTokens.some((term) => ACCESSORY_TERMS.has(term))
  ) {
    return irrelevant("accessory does not match requested product");
  }
  const category = CATEGORY_GROUPS.find((group) =>
    queryTokens.some((token) => group.terms.some((term) => term === token))
  );
  if (category !== undefined) {
    const evidenceTokens = "productTypeOnly" in category && category.productTypeOnly
      ? productTypeTokens
      : candidateTokens;
    if (!category.terms.some((term) => evidenceTokens.has(term))) {
      return irrelevant("requested product category does not match");
    }
  }

  const gtinQueries = queryTokens.filter((token) => /^\d{8,14}$/u.test(token));
  if (gtinQueries.length > 0) {
    const gtins = new Set((candidate.gtins ?? []).map(compact));
    return gtinQueries.every((gtin) => gtins.has(gtin))
      ? { status: "EXACT", evidence: ["GTIN exact"], missingTerms: [] }
      : irrelevant("GTIN does not match");
  }

  const categoryTerms = new Set<string>(category?.terms ?? []);
  const required = [...new Set(queryTokens.filter((token) =>
    !IGNORED_QUERY_TERMS.has(token) && !categoryTerms.has(token)
  ))];
  const matched = required.filter((token) => requestedVariantTerms.has(token)
    ? variantTokens.has(token)
    : termMatches(token, candidateTokens, candidateCompact));
  const missingTerms = required.filter((token) => !matched.includes(token));
  const evidence = [
    ...(category === undefined ? [] : ["product category exact"]),
    ...(requestedVariantTerms.size > 0 && [...requestedVariantTerms].every((term) => variantTokens.has(term))
      ? ["requested variant exact"]
      : []),
    ...(matched.length === 0 ? [] : [`matched query terms: ${matched.join(", ")}`])
  ];

  if (missingTerms.length === 0) {
    return {
      status: "EXACT",
      evidence: evidence.length === 0 ? ["query terms exact"] : evidence,
      missingTerms: []
    };
  }
  if (matched.length > 0 || category !== undefined) {
    return {
      status: "SIMILAR",
      evidence: [...evidence, `missing query terms: ${missingTerms.join(", ")}`],
      missingTerms
    };
  }
  return irrelevant("no meaningful query overlap");
}

function candidateText(candidate: ShopifyMatchCandidate): string {
  return [
    candidate.title,
    candidate.brand,
    candidate.sku,
    candidate.handle,
    candidate.productType,
    ...(candidate.tags ?? []),
    ...(candidate.gtins ?? []),
    ...Object.entries(candidate.variantDimensions ?? {}).flatMap(([name, value]) => [name, value])
  ].filter((value): value is string => value !== undefined).join(" ");
}

function termMatches(term: string, candidateTokens: ReadonlySet<string>, candidateCompact: string): boolean {
  if (candidateTokens.has(term)) return true;
  if (/\d/u.test(term)) return candidateCompact.includes(compact(term));
  return term.length <= 3 && [...candidateTokens].some((token) => /\d/u.test(token) && token.startsWith(term));
}

function extractVariantTerms(queryTokens: readonly string[]): Set<string> {
  const terms = new Set<string>();
  for (let index = 0; index < queryTokens.length; index += 1) {
    const token = queryTokens[index]!;
    if (VARIANT_COLORS.has(token) || /^\d+(?:gb|tb|ml|oz|count|pack)$/u.test(token)) terms.add(token);
    if (["capacity", "color", "colour", "size"].includes(token) && queryTokens[index + 1] !== undefined) {
      terms.add(queryTokens[index + 1]!);
    }
  }
  return terms;
}

function irrelevant(reason: string): ShopifyMatchResult {
  return { status: "IRRELEVANT", evidence: [reason], missingTerms: [] };
}

function tokenize(value: string): string[] {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [];
}

function compact(value: string): string {
  return tokenize(value).join("");
}
