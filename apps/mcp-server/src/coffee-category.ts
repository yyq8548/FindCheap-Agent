export type CoffeeCategory = "COFFEE" | "WHOLE_BEAN" | "GROUND" | "PODS" | "INSTANT";

const CATEGORY_PHRASES: ReadonlyArray<readonly [CoffeeCategory, RegExp]> = [
  ["COFFEE", /^(?:coffee|咖啡)$/u],
  ["WHOLE_BEAN", /^(?:coffee beans?|whole beans?(?: coffee)?|whole coffee beans|咖啡豆|全豆咖啡|整豆咖啡|烘焙咖啡豆)$/u],
  ["GROUND", /^(?:ground coffee|coffee grounds|咖啡粉|研磨咖啡粉?)$/u],
  ["PODS", /^(?:coffee pods?|coffee capsules?|咖啡[胶膠]囊|[胶膠]囊咖啡)$/u],
  ["INSTANT", /^(?:instant coffee|soluble coffee|速溶咖啡|即溶咖啡)$/u]
];
const PRIMARY_FORMS: ReadonlyArray<readonly [Exclude<CoffeeCategory, "COFFEE">, RegExp]> = [
  ["WHOLE_BEAN", /\b(?:whole beans?|coffee beans?)\b|咖啡豆|全豆咖啡|整豆咖啡/u],
  ["GROUND", /\b(?:ground coffee|coffee grounds)\b|咖啡粉|研磨咖啡/u],
  ["PODS", /\b(?:coffee pods?|coffee capsules?|k cups?)\b|咖啡[胶膠]囊|[胶膠]囊咖啡/u],
  ["INSTANT", /\b(?:instant coffee|soluble coffee)\b|速溶咖啡|即溶咖啡/u]
];
const NON_COFFEE_PRODUCT = /\b(?:socks?|sweatshirts?|hoodies?|t shirts?|shirts?|apparel|clothing|mugs?|cups?|tumblers?|grinders?|machines?|makers?|brewers?|kettles?|filters?|drippers?|phone (?:cases?|covers?)|books?|guides?|gift cards?|candles?)\b|袜|襪|卫衣|衛衣|衣服|服装|服裝|咖啡杯|磨豆机|磨豆機|咖啡机|咖啡機|书籍|書籍|滤纸|濾紙|礼品卡|禮品卡/u;
const OTHER_FOOD = /\b(?:honey|syrup|chocolate|cocoa|cacao|tea|candy)\b|蜂蜜|糖浆|糖漿|巧克力|可可/u;
const GREEN_COFFEE = /\b(?:green|unroasted|raw)\s+(?:coffee\s+)?beans?\b|\bgreen coffee\b|未烘焙|生咖啡豆|咖啡生豆/u;
const FORM_DIMENSION = /^(?:grind(?: size| type| option)?|coffee (?:form|type)|form|format|研磨|研磨度|形态|形態)$/u;

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

export function assessCoffeeCategory(category: CoffeeCategory, candidate: {
  title: string;
  productType?: string;
  description?: string;
  variantDimensions?: Readonly<Record<string, string>>;
}): { status: "MATCHED" | "UNKNOWN" | "CONTRADICTED"; evidence: string } {
  // Descriptions can contain compatibility copy and unselected parent options.
  // They cannot establish the primary product or this offer's selected form.
  const title = normalize(candidate.title);
  const productType = normalize(candidate.productType ?? "");
  const primary = `${title} ${productType}`;
  const primaryForms = new Set(PRIMARY_FORMS.filter(([, pattern]) => pattern.test(primary)).map(([form]) => form));
  if (/[-‐‑–—]\s*ground\s*$/iu.test(candidate.title)) primaryForms.add("GROUND");
  // "Ground coffee beans" is ground; an explicit "beans or ground" list is unresolved.
  if (primaryForms.size > 1 && !/\bwhole beans?\b|全豆|整豆/u.test(primary) && !/\b(?:or|and)\b|[/或和与與]/u.test(primary)) {
    primaryForms.delete("WHOLE_BEAN");
  }
  const foodIdentity = primary.replace(/\b(?:honey process(?:ed)?|(?:honey|chocolate|cocoa) flavou?red|(?:notes?|flavou?r) of (?:honey|chocolate|cocoa))\b/gu, "");
  if (NON_COFFEE_PRODUCT.test(primary.replace(/\bk cups?\b/gu, "coffee pods")) ||
    OTHER_FOOD.test(foodIdentity)) {
    return { status: "CONTRADICTED", evidence: "primary product is coffee equipment, merchandise or another food" };
  }
  const selections = Object.entries(candidate.variantDimensions ?? {}).filter(([key]) => FORM_DIMENSION.test(normalize(key)));
  if (GREEN_COFFEE.test(primary) || selections.some(([, value]) => GREEN_COFFEE.test(normalize(value)))) {
    return { status: "CONTRADICTED", evidence: "primary or selected coffee is green or unroasted, not a prepared coffee form" };
  }
  if (!/\bcoffees?\b|咖啡/u.test(primary)) {
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
