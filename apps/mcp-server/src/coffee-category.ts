export type CoffeeCategory = "COFFEE" | "WHOLE_BEAN" | "GROUND" | "PODS" | "INSTANT";

const CATEGORY_PHRASES: ReadonlyArray<readonly [CoffeeCategory, RegExp]> = [
  ["COFFEE", /^(?:coffee|咖啡)$/u],
  ["WHOLE_BEAN", /^(?:coffee beans?|whole beans?(?: coffee)?|whole coffee beans|咖啡豆|全豆咖啡|整豆咖啡|烘焙咖啡豆)$/u],
  ["GROUND", /^(?:ground coffee|coffee grounds|咖啡粉|研磨咖啡粉?)$/u],
  ["PODS", /^(?:coffee pods?|coffee capsules?|咖啡[胶膠]囊|[胶膠]囊咖啡)$/u],
  ["INSTANT", /^(?:instant coffee|soluble coffee|速溶咖啡|即溶咖啡)$/u]
];
const PRIMARY_FORMS: ReadonlyArray<readonly [Exclude<CoffeeCategory, "COFFEE">, RegExp]> = [
  ["WHOLE_BEAN", /\b(?:whole\s?beans?|coffee beans?)\b|咖啡豆|全豆咖啡|整豆咖啡/u],
  ["GROUND", /\b(?:ground coffee|coffee grounds)\b|咖啡粉|研磨咖啡/u],
  ["PODS", /\b(?:pods?|capsules?|k cups?|single serve cups?|onecup)\b|咖啡[胶膠]囊|[胶膠]囊咖啡/u],
  ["INSTANT", /\b(?:instant coffee|soluble coffee)\b|速溶咖啡|即溶咖啡/u]
];
const NON_COFFEE_PRODUCT = /\b(?:socks?|sweatshirts?|hoodies?|t shirts?|shirts?|apparel|clothing|mugs?|cups?|tumblers?|grinders?|machines?|makers?|brewers?|kettles?|filters?|drippers?|holders?|organizers?|racks?|storage|cleaning|descalers?|group ?head(?: replacement)? (?:brush(?:es)?|bristles)|phone (?:cases?|covers?)|books?|guides?|gift cards?|candles?)\b|袜|襪|卫衣|衛衣|衣服|服装|服裝|咖啡杯|磨豆机|磨豆機|咖啡机|咖啡機|书籍|書籍|滤纸|濾紙|礼品卡|禮品卡/u;
const OTHER_FOOD = /\b(?:honey|syrup|chocolate|cocoa|cacao|tea|candy)\b|蜂蜜|糖浆|糖漿|巧克力|可可/u;
const GREEN_COFFEE = /\b(?:green|unroasted|raw)\s+(?:coffee\s+)?beans?\b|\bgreen coffee\b|未烘焙|生咖啡豆|咖啡生豆/u;
const FORM_DIMENSION = /^(?:grind(?: size| type| option)?|coffee (?:product form|form|type)|ground or whole bean|form|format|研磨|研磨度|形态|形態)$/u;
const COFFEE_IDENTITY = /\b(?:coffees?|espresso)\b|咖啡/u;
const EMPTY_CAPSULE = /\b(?:empty|refillable|reusable)\b|空[胶膠]囊|可重[复複]使用/u;

export type CoffeeCandidate = {
  title: string;
  productType?: string | undefined;
  description?: string | undefined;
  merchantUrl?: string | undefined;
  variantDimensions?: Readonly<Record<string, string>> | undefined;
};

export const COFFEE_SYSTEMS = ["NESPRESSO_ORIGINAL", "NESPRESSO_VERTUO", "DOLCE_GUSTO", "KEURIG_K_CUP", "ESE_44MM", "ESPRESSOTORIA"] as const;
export type CoffeeSystem = typeof COFFEE_SYSTEMS[number];
export type CoffeeRequest = {
  query: string;
  productType?: string | undefined;
  requiredFeatures?: readonly string[] | undefined;
  features?: readonly string[] | undefined;
  featureMode?: string | undefined;
  primaryUse?: string | undefined;
};
export type CoffeeCompatibilityAssessment = {
  status: "NOT_APPLICABLE" | "MATCHED" | "UNKNOWN" | "CONTRADICTED";
  evidence: string;
  requestedSystem?: CoffeeSystem | undefined;
  observedSystems: CoffeeSystem[];
};
const SYSTEM_PATTERNS: ReadonlyArray<readonly [CoffeeSystem, RegExp]> = [
  ["NESPRESSO_ORIGINAL", /\bnespresso original(?:\s?line)?\b|\boriginal line\b/gu],
  ["NESPRESSO_VERTUO", /\b(?:nespresso )?vertuo(?:\s?line)?\b/gu],
  ["DOLCE_GUSTO", /\bdolce gusto\b/gu],
  ["KEURIG_K_CUP", /\b(?:keurig )?k cups?\b/gu],
  ["ESE_44MM", /\be\.?s\.?e\.?\s*44\s?mm\b|\b44\s?mm\s*e\.?s\.?e\.?\b/gu],
  ["ESPRESSOTORIA", /\bespressotoria\b/gu]
];
const SYSTEM_DIMENSION = /^(?:(?:(?:coffee|capsule|machine|brewing) )?(?:system|compatibility)|compatible (?:machines?|systems?)|machine|brewer)$/u;

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[-‐‑–—]/gu, " ").replace(/\s+/gu, " ").trim();
}

export function parseCoffeeCategory(value: string | undefined): CoffeeCategory | undefined {
  return value === undefined ? undefined : CATEGORY_PHRASES.find(([, pattern]) => pattern.test(normalize(value)))?.[0];
}

export function isCoffeeCategoryRefinement(previous: string, current: string): boolean {
  const from = parseCoffeeCategory(previous);
  const to = parseCoffeeCategory(current);
  return from !== undefined && to !== undefined && (from === to || from === "COFFEE");
}

export function assessCoffeeCategory(category: CoffeeCategory, candidate: CoffeeCandidate): {
  status: "MATCHED" | "UNKNOWN" | "CONTRADICTED"; evidence: string;
} {
  // Descriptions can contain compatibility copy and unselected parent options.
  // They cannot establish the primary product or this offer's selected form.
  const title = normalize(candidate.title);
  const productType = normalize(candidate.productType ?? "");
  // A trailing machine-compatibility label does not make filled capsules a machine.
  const primaryTitle = /\b(?:pods?|capsules?)\b/u.test(title)
    ? title.replace(/\b(?:compatible with|for use with|for (?:nespresso|keurig|dolce gusto))\b.*$/u, "") : title;
  const primary = `${primaryTitle} ${productType}`;
  const primaryForms = new Set(PRIMARY_FORMS.filter(([, pattern]) => pattern.test(primary)).map(([form]) => form));
  if (/[-‐‑–—]\s*ground\s*$/iu.test(candidate.title)) primaryForms.add("GROUND");
  // "Ground coffee beans" is ground; an explicit "beans or ground" list is unresolved.
  if (primaryForms.size > 1 && !/\bwhole beans?\b|全豆|整豆/u.test(primary) && !/\b(?:or|and)\b|[/或和与與]/u.test(primary)) {
    primaryForms.delete("WHOLE_BEAN");
  }
  const foodIdentity = primary.replace(/\b(?:honey process(?:ed)?|(?:honey|chocolate|cocoa) flavou?red|(?:notes?|flavou?r) of (?:honey|chocolate|cocoa))\b/gu, "");
  // Filled cup products may name the roast/brew without repeating "coffee".
  // Neither a cup-form label nor roast/brew alone establishes that identity.
  const roastedCupIdentity = /\b(?:roast|brew)\b/u.test(primaryTitle) &&
    /\b(?:k cups?|single serve cups?|onecup)\b/u.test(primaryTitle);
  const coffeeIdentity = COFFEE_IDENTITY.test(primary) || roastedCupIdentity;
  const productIdentity = coffeeIdentity ? primary.replace(/\b(?:k cups?|single serve cups?|onecup)\b/gu, "coffee pods") : primary;
  if (NON_COFFEE_PRODUCT.test(productIdentity) || OTHER_FOOD.test(foodIdentity) ||
    /^(?:ground )?chicory$/u.test(productType) || /\b(?:100\s*%|pure)\s+(?:ground\s+)?chicory\b/u.test(primary) ||
    (primaryForms.has("PODS") && EMPTY_CAPSULE.test(primary))) {
    return { status: "CONTRADICTED", evidence: "primary product is coffee equipment, merchandise or another food" };
  }
  const selections = Object.entries(candidate.variantDimensions ?? {}).filter(([key]) => FORM_DIMENSION.test(normalize(key)));
  if (GREEN_COFFEE.test(primary) || hasGreenCoffeeCategoryPath(candidate.merchantUrl) ||
    selections.some(([, value]) => GREEN_COFFEE.test(normalize(value)))) {
    return { status: "CONTRADICTED", evidence: "primary or selected coffee is green or unroasted, not a prepared coffee form" };
  }
  if (!coffeeIdentity) {
    return { status: "UNKNOWN", evidence: "primary coffee product identity is unverified" };
  }
  if (category === "COFFEE") return { status: "MATCHED", evidence: "primary product identifies coffee" };

  if (selections.length > 0) {
    const forms = selections.map(([key, value]) => {
      const selected = normalize(value);
      const parsed = parseCoffeeCategory(selected);
      if (parsed !== undefined && parsed !== "COFFEE") return parsed;
      if (/^(?:ground|ground coffee|研磨|已研磨)$/u.test(selected)) return "GROUND" as const;
      if (/^(?:pods?|capsules?)$/u.test(selected)) return "PODS" as const;
      if (/^(?:instant|soluble)$/u.test(selected)) return "INSTANT" as const;
      if (/^grind(?: |$)|^研磨/u.test(normalize(key)) && /^(?:fine|medium|coarse|drip|espresso|french press)(?: grind| ground)?$/u.test(selected)) return "GROUND" as const;
      return undefined;
    });
    if (forms.some(form => form === undefined) || new Set(forms).size !== 1) {
      return { status: "UNKNOWN", evidence: "selected coffee form is missing or ambiguous" };
    }
    return forms[0] === category
      ? { status: "MATCHED", evidence: `selected coffee form matches ${category}` }
      : { status: "CONTRADICTED", evidence: `selected coffee form ${forms[0]} differs from ${category}` };
  }
  if (primaryForms.size !== 1) return { status: "UNKNOWN", evidence: "primary coffee form is unspecified or lists multiple forms" };
  return primaryForms.has(category)
    ? { status: "MATCHED", evidence: `primary coffee form matches ${category}` }
    : { status: "CONTRADICTED", evidence: `primary coffee form differs from ${category}` };
}

function hasGreenCoffeeCategoryPath(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    // Only the current product's explicit category segment supplies counterevidence.
    // Query strings, descriptions and unrelated recommendations supply no form proof.
    const url = new URL(value);
    return url.protocol === "https:" && url.pathname.split("/").slice(0, -1)
      .some(segment => /^(?:green|unroasted|raw)(?:-|_)(?:coffee(?:-|_))?beans?$/u.test(segment.toLowerCase()));
  } catch { return false; }
}

/** Product compatibility never supplies the user's requested machine system. */
export function requestedCoffeeSystem(request: CoffeeRequest): CoffeeSystem | undefined {
  const evidence = systemEvidence([request.query, request.productType, request.primaryUse,
    ...(request.requiredFeatures ?? []), ...(request.featureMode === "REQUIRED" ? request.features ?? [] : [])]
    .filter((value): value is string => value !== undefined));
  const systems = [...evidence.positive].filter(system => !evidence.negative.has(system));
  return systems.length === 1 ? systems[0] : undefined;
}

/** A matched system may satisfy this entire requirement, never adjacent claims. */
export function coffeeCompatibilityRequirement(value: string): CoffeeSystem | undefined {
  const requirement = normalize(value).replaceAll("_", " ")
    .replace(/^(?:compatible with|compatibility with|for use with|works with|for|兼容|适用于)\s*/u, "")
    .replace(/\s+(?:machines?|system|capsules?)$/u, "").trim();
  return SYSTEM_PATTERNS.find(([, pattern]) => new RegExp(`^(?:${pattern.source})$`, "u").test(requirement))?.[0];
}

export function isCoffeeCapsuleRequest(request: CoffeeRequest): boolean {
  const specified = parseCoffeeCategory(request.productType);
  const category = specified === undefined || specified === "COFFEE" ? parseCoffeeCategory(request.query) ?? specified : specified;
  if (category !== undefined) return category === "PODS";
  // Detect compatibility needs in an explicit capsule query without broadening
  // its brand/model identity. Equipment and refillable shells are not capsules.
  const form = assessCoffeeCategory("PODS", { title: request.query });
  return form.status === "MATCHED" || (form.status === "UNKNOWN" && /\b(?:pods?|capsules?)\b/u.test(normalize(request.query)) &&
    requestedCoffeeSystem(request) !== undefined);
}

export function assessCoffeeCompatibility(request: CoffeeRequest, candidate: CoffeeCandidate): CoffeeCompatibilityAssessment {
  const broadCoffeeRequest = (parseCoffeeCategory(request.productType) ?? parseCoffeeCategory(request.query)) === "COFFEE";
  if (!isCoffeeCapsuleRequest(request) && !(broadCoffeeRequest && assessCoffeeCategory("PODS", candidate).status === "MATCHED")) {
    return { status: "NOT_APPLICABLE", evidence: "neither request nor selected product identifies prepared coffee capsules", observedSystems: [] };
  }
  const requestedSystem = requestedCoffeeSystem(request);
  const selected = Object.entries(candidate.variantDimensions ?? {}).filter(([key]) => SYSTEM_DIMENSION.test(normalize(key)));
  const primary = systemEvidence([candidate.title, candidate.productType ?? ""]);
  const observed = selected.length > 0 ? systemEvidence(selected.map(([, value]) => value)) : primary;
  // Selected options narrow positive parent labels, never explicit incompatibility.
  for (const system of primary.negative) observed.negative.add(system);
  const observedSystems = [...observed.positive].filter(system => !observed.negative.has(system));
  const facts = { ...(requestedSystem === undefined ? {} : { requestedSystem }), observedSystems };
  if (requestedSystem === undefined) return { ...facts, status: "UNKNOWN", evidence: "user machine model or capsule system is unverified" };
  if (observed.negative.has(requestedSystem)) return { ...facts, status: "CONTRADICTED", evidence: "selected capsule explicitly excludes the requested machine system" };
  if (observedSystems.length !== 1 || selected.some(([, value]) => systemEvidence([value]).positive.size !== 1)) {
    return { ...facts, status: "UNKNOWN", evidence: "selected capsule system is missing or ambiguous" };
  }
  return observedSystems[0] === requestedSystem
    ? { ...facts, status: "MATCHED", evidence: "selected capsule system matches the explicitly requested system" }
    : { ...facts, status: "CONTRADICTED", evidence: "selected capsule system conflicts with the requested system" };
}

function systemEvidence(values: readonly string[]): { positive: Set<CoffeeSystem>; negative: Set<CoffeeSystem> } {
  const positive = new Set<CoffeeSystem>(), negative = new Set<CoffeeSystem>();
  for (const value of values) {
    const text = normalize(value).replaceAll("_", " ");
    for (const [system, pattern] of SYSTEM_PATTERNS) for (const match of text.matchAll(pattern)) {
      const before = text.slice(0, match.index);
      const after = text.slice(match.index + match[0].length);
      const negated = /(?:\b(?:not|no|except|excluding|incompatible)(?: compatible)?(?: with| for)?|不兼容|不适用)\s*$/u.test(before) ||
        /^\s*(?:is |are )?(?:not supported|incompatible|不兼容)/u.test(after);
      (negated ? negative : positive).add(system);
    }
  }
  return { positive, negative };
}
