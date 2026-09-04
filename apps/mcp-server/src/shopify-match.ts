export type ShopifyMatchStatus = "EXACT" | "DISCOVERY_MATCH" | "SIMILAR" | "IRRELEVANT";

export type ShopifyMatchCandidate = {
  title: string;
  description?: string;
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
  { terms: ["dress", "dresses", "gown", "gowns"] },
  { terms: ["trouser", "trousers", "pant", "pants", "slack", "slacks"] },
  { terms: ["skirt", "skirts"] },
  { terms: ["bodysuit", "bodysuits"] },
  { terms: ["top", "tops", "blouse", "blouses"] },
  { terms: ["sweater", "sweaters", "cardigan", "cardigans", "pullover", "pullovers"] },
  { terms: ["jumpsuit", "jumpsuits", "romper", "rompers"] },
  { terms: ["coat", "coats", "jacket", "jackets", "blazer", "blazers"] },
  { terms: ["jean", "jeans", "denim"] },
  { terms: ["swimsuit", "swimsuits", "swimwear", "bikini", "bikinis"] },
  { terms: ["bra", "bras", "bralette", "bralettes", "lingerie"] },
  {
    terms: [
      "shoe", "shoes", "sneaker", "sneakers", "trainer", "trainers", "flat", "flats",
      "loafer", "loafers", "boot", "boots", "sandal", "sandals", "heel", "heels"
    ]
  },
  { terms: ["headphone", "headphones", "headset", "headsets", "earbud", "earbuds"] },
  { terms: ["charger", "chargers"], candidateEvidenceTerms: ["connector", "connectors"] },
  { terms: ["sofa", "sofas", "couch", "couches"] },
  { terms: ["tv", "television", "televisions"] },
  { terms: ["fridge", "fridges", "refrigerator", "refrigerators"] },
  { terms: ["phone", "phones", "smartphone", "smartphones"] },
  {
    terms: ["laptop", "laptops", "notebook", "notebooks"],
    candidateEvidenceTerms: ["macbook", "macbooks", "chromebook", "chromebooks"]
  },
  { terms: ["lipstick", "lipsticks", "lipgloss", "gloss"], productTypeOnly: true },
  { terms: ["coffee", "coffees"], productTypeOnly: true },
  { terms: ["water", "waters"], productTypeOnly: true },
  { terms: ["bracelet", "bracelets", "bangle", "bangles"] },
  { terms: ["sheet", "sheets", "bedding"] },
  {
    terms: ["dogfood", "catfood", "petfood", "kibble"],
    candidateEvidenceTerms: ["animal", "animals", "dog", "dogs", "cat", "cats", "canine", "feline", "pet", "pets"]
  },
  { terms: ["hairmask", "mask", "masks"], candidateEvidenceTerms: ["haircare", "hair"] }
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
  "accessories", "accessory", "adapter", "bag", "cable", "case", "charger", "charm", "charms",
  "compatible", "cover", "dock", "earpad", "earpads", "film", "holder", "hub", "keychain",
  "keychains", "keyring", "mount", "protector", "replacement", "screenprotector", "skin", "sleeve",
  "strap"
]);
const EXPLICIT_ACCESSORY_TERMS = new Set(["adapter"]);
const CONDITION_TERMS = new Set(["box", "open", "preowned", "reconditioned", "refurbished", "renewed", "resale", "used"]);
const GENERIC_IDENTITY_TERMS = new Set([
  ...IGNORED_QUERY_TERMS,
  ...VARIANT_COLORS,
  ...CATEGORY_GROUPS.flatMap((group) => [...group.terms]),
  "apparel", "anime", "boot", "boots", "clothing", "dress", "dresses", "hoodie", "hoodies",
  "jean", "jeans", "men", "mens", "open", "pants", "refurbished", "renewed", "sweater",
  "sweaters", "sweatshirt", "sweatshirts", "top", "tops", "used", "women", "womens",
  "bodycon", "casual", "classic", "everyday", "flat", "flats", "leather", "maxi", "midi",
  "mini", "regular", "slip", "strap", "strappy", "wear"
]);

export function hasSpecificProductIdentity(query: string, minimumTerms = 2): boolean {
  const tokens = tokenize(query);
  if (hasStrongProductIdentifier(query)) return true;
  const identityTerms = new Set(tokens.filter((token) =>
    token.length >= 2 && !GENERIC_IDENTITY_TERMS.has(token)
  ));
  return identityTerms.size >= minimumTerms;
}

export function hasStrongProductIdentifier(query: string): boolean {
  const tokens = tokenize(query);
  return tokens.some((token) => /^\d{8,14}$/u.test(token)) ||
    tokens.some((token) =>
      token.length >= 4 &&
      /\p{L}/u.test(token) &&
      /\d/u.test(token) &&
      !/^\d+(?:gb|tb|mb|ml|oz|count|pack|inch|in)$/u.test(token)
    );
}

export function hasNamedProductIntent(query: string): boolean {
  if (hasStrongProductIdentifier(query)) return true;
  const identityTerms = new Set(tokenize(query).filter((token) =>
    token.length >= 2 && !GENERIC_IDENTITY_TERMS.has(token) && !CONDITION_TERMS.has(token)
  ));
  return identityTerms.size >= 3;
}

export function classifyShopifyCandidate(
  query: string,
  candidate: ShopifyMatchCandidate
): ShopifyMatchResult {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return irrelevant("query has no searchable terms");

  const productTypeTokens = new Set(tokenize(candidate.productType ?? ""));
  const searchableCandidateText = candidateText(candidate);
  const candidateTokens = new Set(tokenize(searchableCandidateText));
  if (hasPetFoodSpeciesConflict(queryTokens, candidateTokens)) {
    return irrelevant("requested pet-food species does not match");
  }
  const candidateIdentifiers = [candidate.sku, candidate.handle]
    .filter((value): value is string => value !== undefined)
    .map(compact)
    .filter((value) => value !== "");
  const requestedVariantTerms = extractVariantTerms(queryTokens);
  const variantValues = Object.values(candidate.variantDimensions ?? {});
  const variantTokens = new Set([
    ...tokenize(variantValues.join(" ")),
    ...variantValues.map(compact).filter((value) => value !== "")
  ]);
  const variantTermMatches = (term: string): boolean => variantTokens.has(term) ||
    (VARIANT_COLORS.has(term) && candidateTokens.has(term));
  const variantsExact = [...requestedVariantTerms].every(variantTermMatches);
  const primaryIdentityTokens = new Set(tokenize([
    candidate.title,
    candidate.productType,
    candidate.brand,
    candidate.sku,
    candidate.handle
  ].filter((value): value is string => value !== undefined).join(" ")));
  if (
    [...EXPLICIT_ACCESSORY_TERMS].some((term) => primaryIdentityTokens.has(term)) &&
    !queryTokens.some((term) => EXPLICIT_ACCESSORY_TERMS.has(term))
  ) {
    return irrelevant("explicit accessory does not match requested product");
  }
  if (
    [...ACCESSORY_TERMS].some((term) => primaryIdentityTokens.has(term)) &&
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
    const categoryEvidenceTerms = [
      ...category.terms,
      ...("candidateEvidenceTerms" in category ? category.candidateEvidenceTerms : [])
    ];
    if (!categoryEvidenceTerms.some((term) => evidenceTokens.has(term))) {
      return irrelevant("requested product category does not match");
    }
  }

  const gtinQueries = queryTokens.filter((token) => /^\d{8,14}$/u.test(token));
  if (gtinQueries.length > 0) {
    const gtins = new Set((candidate.gtins ?? []).map(compact));
    if (!gtinQueries.every((gtin) => gtins.has(gtin))) return irrelevant("GTIN does not match");
    const missingVariants = [...requestedVariantTerms].filter((term) => !variantTermMatches(term));
    return variantsExact
      ? { status: "EXACT", evidence: ["GTIN exact", ...(requestedVariantTerms.size === 0 ? [] : ["requested variant exact"])], missingTerms: [] }
      : { status: "SIMILAR", evidence: ["GTIN exact", `requested variant differs: ${missingVariants.join(", ")}`], missingTerms: missingVariants };
  }

  const categoryTerms = new Set<string>(category?.terms ?? []);
  const required = [...new Set(queryTokens.filter((token) =>
    !IGNORED_QUERY_TERMS.has(token) && !categoryTerms.has(token)
  ))];
  const matched = required.filter((token) => requestedVariantTerms.has(token)
    ? variantTermMatches(token)
    : termMatches(token, candidateTokens, candidateIdentifiers));
  const missingTerms = required.filter((token) => !matched.includes(token));
  const brandTokens = tokenize(candidate.brand ?? "");
  const brandExact = brandTokens.length > 0 && brandTokens.every((token) => queryTokens.includes(token));
  const modelQueryTokens = required
    .filter((token) => !brandTokens.includes(token) && !requestedVariantTerms.has(token) && !CONDITION_TERMS.has(token));
  const candidateMpn = compact(candidate.sku ?? "");
  const brandMpnExact = brandExact && candidateMpn !== "" && containsContiguousIdentity(modelQueryTokens, candidateMpn);
  const evidence = [
    ...(category === undefined ? [] : ["product category exact"]),
    ...(requestedVariantTerms.size > 0 && variantsExact
      ? ["requested variant exact"]
      : []),
    ...(brandMpnExact && variantsExact
      ? ["brand and MPN exact"]
      : []),
    ...(matched.length === 0 ? [] : [`matched query terms: ${matched.join(", ")}`])
  ];

  if (missingTerms.length === 0) {
    return {
      status: brandMpnExact && variantsExact ? "EXACT" : "DISCOVERY_MATCH",
      evidence: evidence.length === 0 ? ["relevant query terms matched; strong product identity unavailable"] : evidence,
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
    candidate.description,
    candidate.brand,
    candidate.sku,
    candidate.handle,
    candidate.productType,
    ...(candidate.tags ?? []),
    ...(candidate.gtins ?? []),
    ...Object.entries(candidate.variantDimensions ?? {}).flatMap(([name, value]) => [name, value])
  ].filter((value): value is string => value !== undefined).join(" ");
}

function termMatches(
  term: string,
  candidateTokens: ReadonlySet<string>,
  candidateIdentifiers: readonly string[]
): boolean {
  if (candidateTokens.has(term)) return true;
  if (/\d/u.test(term)) {
    const normalized = compact(term);
    return normalized.length >= 4 && (
      [...candidateTokens].some((token) => token.endsWith(normalized)) ||
      candidateIdentifiers.some((identifier) => identifier.endsWith(normalized))
    );
  }
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

function containsContiguousIdentity(tokens: readonly string[], identity: string): boolean {
  for (let start = 0; start < tokens.length; start += 1) {
    let joined = "";
    for (let end = start; end < tokens.length; end += 1) {
      joined += compact(tokens[end]!);
      if (joined === identity) return true;
      if (joined.length >= identity.length) break;
    }
  }
  return false;
}

function tokenize(value: string): string[] {
  return (value.normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase("en-US")
    .replace(/\b(?:dog|canine)\s+food\b/gu, " dogfood ")
    .replace(/\b(?:cat|feline)\s+food\b/gu, " catfood ")
    .replace(/\bpet\s+food\b/gu, " petfood ")
    .match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((token) => /^\d+(?:st|nd|rd|th)$/u.test(token) ? token.replace(/(?:st|nd|rd|th)$/u, "") : token)
    .map((token) => token === "generation" ? "gen" : token)
    .map((token) => token === "gray" ? "grey" : token === "onyx" ? "black" : token);
}

function hasPetFoodSpeciesConflict(
  queryTokens: readonly string[],
  candidateTokens: ReadonlySet<string>
): boolean {
  if (queryTokens.includes("catfood")) {
    return candidateTokens.has("dogfood") && !candidateTokens.has("catfood");
  }
  if (queryTokens.includes("dogfood")) {
    return candidateTokens.has("catfood") && !candidateTokens.has("dogfood");
  }
  return false;
}

function compact(value: string): string {
  return tokenize(value).join("");
}
