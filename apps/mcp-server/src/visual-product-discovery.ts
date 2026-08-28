import { z } from "zod";

const VisualTextSchema = z.string().trim().min(1).max(100);
const VisualObservationSchema = z.object({
  attribute: VisualTextSchema,
  value: VisualTextSchema,
  confidence: z.number().min(0).max(1),
  evidence: VisualTextSchema.optional()
}).strict();
const HttpsEvidenceUrlSchema = z.string().url().max(4_096).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.username === "" && url.password === "";
}, "visual evidence URL must be credential-free HTTPS");

export const VisualProductInputSchema = z.object({
  imageUrl: HttpsEvidenceUrlSchema.optional(),
  sourcePageUrl: HttpsEvidenceUrlSchema.optional(),
  productType: VisualTextSchema.optional(),
  brand: VisualTextSchema.optional(),
  modelOrStyleNumber: VisualTextSchema.optional(),
  logoText: VisualTextSchema.optional(),
  colors: z.array(VisualTextSchema).max(4).default([]),
  materials: z.array(VisualTextSchema).max(4).default([]),
  patterns: z.array(VisualTextSchema).max(4).default([]),
  silhouette: VisualTextSchema.optional(),
  length: VisualTextSchema.optional(),
  neckline: VisualTextSchema.optional(),
  sleeveType: VisualTextSchema.optional(),
  closure: VisualTextSchema.optional(),
  collar: VisualTextSchema.optional(),
  waist: VisualTextSchema.optional(),
  hem: VisualTextSchema.optional(),
  printDescription: VisualTextSchema.optional(),
  distinctiveDetails: z.array(VisualTextSchema).max(12).optional(),
  visibleText: z.array(VisualTextSchema).max(8).optional(),
  styleNumberCandidates: z.array(VisualTextSchema).max(6).optional(),
  imageQuality: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  occlusions: z.array(VisualTextSchema).max(8).optional(),
  observations: z.array(VisualObservationSchema).max(24).optional(),
  inferences: z.array(VisualObservationSchema).max(12).optional(),
  styleClues: z.array(VisualTextSchema).max(12).default([]),
  hardClues: z.array(VisualTextSchema).max(12).optional(),
  softClues: z.array(VisualTextSchema).max(12).optional(),
  negativeClues: z.array(VisualTextSchema).max(12).optional()
}).strict().refine((value) => Object.entries(value).some(([key, entry]) =>
  key !== "imageUrl" && key !== "sourcePageUrl" && (Array.isArray(entry) ? entry.length > 0 : entry !== undefined)
), "visual input must include at least one observed product attribute");

export type VisualProductInput = z.infer<typeof VisualProductInputSchema>;
export type VisualMatchGroup = "POSSIBLE_SAME_ITEM" | "HIGHLY_SIMILAR" | "SAME_STYLE";

export type VisualMatch = {
  group: VisualMatchGroup;
  score: number;
  evidence: string[];
};

export type VisualOfficialStoreQuery = {
  stage: "FULL" | "CORE" | "SYNONYM" | "CATEGORY";
  query: string;
};

const OCCLUDED_ATTRIBUTE_PATTERNS: Array<readonly [string, RegExp]> = [
  ["SLEEVE", /\b(?:arms?|shoulders?|sleeves?|straps?)\b|肩带|肩部|袖/iu],
  ["NECKLINE", /\b(?:bust|chest|collar|neck|neckline)\b|胸口|胸部|衣领|领口/iu],
  ["WAIST", /\b(?:midsection|torso|waist)\b|腰|躯干/iu],
  ["LENGTH", /\b(?:bottom|hem|knee|leg|lower skirt)\b|下摆|裙摆|膝|腿/iu],
  ["SILHOUETTE", /\b(?:body|silhouette)\b|轮廓|身形/iu]
];

export function isVisualAttributeOccluded(visual: VisualProductInput, attribute: string): boolean {
  const key = visualAttributeKey(attribute);
  if (key === undefined) return false;
  return (visual.occlusions ?? []).some((occlusion) =>
    OCCLUDED_ATTRIBUTE_PATTERNS.some(([candidateKey, pattern]) => candidateKey === key && pattern.test(occlusion))
  );
}

export function relaxVisualProductInput(visual: VisualProductInput): VisualProductInput {
  return VisualProductInputSchema.parse({
    ...(visual.brand === undefined ? {} : { brand: visual.brand }),
    ...(visual.logoText === undefined ? {} : { logoText: visual.logoText }),
    ...(visual.modelOrStyleNumber === undefined ? {} : { modelOrStyleNumber: visual.modelOrStyleNumber }),
    ...(visual.productType === undefined ? {} : { productType: relaxedProductType(visual.productType) })
  });
}

type CandidateEvidence = {
  title: string;
  productType?: string | undefined;
  brand?: string | undefined;
  modelOrStyleNumber?: string | undefined;
  description?: string | undefined;
  attributes?: string[] | undefined;
};

const ALIAS_GROUPS = [
  ["women", "womens", "female", "女士", "女款"],
  ["men", "mens", "male", "男士", "男款"],
  ["dress", "dresses", "裙", "裙子", "连衣裙"],
  ["skirt", "skirts", "半身裙"],
  ["trouser", "trousers", "pants", "pant", "长裤", "裤子", "西裤"],
  ["shorts", "boy short", "boy shorts", "短裤"],
  ["jeans", "denim pants", "牛仔裤"],
  ["t shirt", "tshirt", "tee", "tees", "short sleeve top", "short sleeve shirt", "短袖", "t恤"],
  ["shirt", "shirts", "衬衫"],
  ["top", "tops", "上衣"],
  ["jacket", "jackets", "夹克", "外套"],
  ["coat", "coats", "大衣", "风衣"],
  ["shoe", "shoes", "footwear", "鞋", "鞋子"],
  ["ballet flat", "ballet flats", "flat", "flats", "芭蕾舞鞋", "平底鞋"],
  ["sneaker", "sneakers", "trainer", "trainers", "运动鞋", "球鞋"],
  ["boot", "boots", "靴", "靴子"],
  ["handbag", "handbags", "bag", "bags", "purse", "包", "手提包", "女包"],
  ["backpack", "backpacks", "背包"],
  ["headphone", "headphones", "耳机", "头戴式耳机"],
  ["earbud", "earbuds", "入耳式耳机", "无线耳机"],
  ["watch", "watches", "手表", "腕表"],
  ["leather", "genuine leather", "real leather", "真皮", "皮革", "皮质"],
  ["suede", "麂皮", "绒面革"],
  ["cotton", "棉", "纯棉"],
  ["wool", "羊毛", "毛呢"],
  ["silk", "真丝", "丝绸"],
  ["linen", "亚麻"],
  ["lace", "蕾丝"],
  ["black", "onyx", "黑", "黑色"],
  ["gray", "grey", "heather gray", "heather grey", "灰", "灰色"],
  ["white", "白", "白色"],
  ["blue", "navy", "蓝", "蓝色", "藏青", "海军蓝"],
  ["red", "红", "红色"],
  ["green", "olive", "olive green", "olive brown", "brown olive", "khaki green", "oakmoss", "dusty oakmoss", "绿", "绿色", "橄榄绿"],
  ["brown", "tan", "棕", "棕色", "褐色", "驼色"],
  ["pink", "粉", "粉色"],
  ["solid", "plain", "纯色", "素色"],
  ["ribbed", "rib knit", "vertical rib knit", "fine vertical rib knit", "罗纹", "细罗纹", "坑条"],
  ["striped", "stripe", "条纹"],
  ["plaid", "check", "checked", "格纹", "格子"],
  ["floral", "flower", "花卉", "碎花"],
  ["mini", "短款", "迷你"],
  ["midi", "中长款"],
  ["maxi", "long", "长款"],
  ["slim", "slim fit", "修身"],
  ["relaxed", "loose", "oversized", "宽松", "廓形"],
  ["bodycon", "紧身", "包臀"],
  ["fitted flared", "fit and flare", "a line", "a-line", "收腰a字", "a字", "伞形"],
  ["bateau neckline", "boat neck", "船领"],
  ["crew neck", "crewneck", "round neck", "圆领"],
  ["short sleeve", "short sleeves", "cap sleeve", "cap sleeves", "短袖袖型"],
  ["long sleeve", "long sleeves", "长袖"],
  ["tiered skirt", "layered skirt", "分层裙摆", "层叠裙摆"]
] as const;

const PRODUCT_FAMILIES = new Set([
  "dress", "skirt", "trouser", "shorts", "jeans", "t shirt", "shirt", "top", "jacket", "coat",
  "shoe", "ballet flat", "sneaker", "boot", "handbag", "backpack", "headphone", "earbud", "watch"
]);

const ALIASES = new Map<string, string>();
for (const group of ALIAS_GROUPS) {
  const canonical = normalizeRaw(group[0]);
  for (const alias of group) ALIASES.set(normalizeRaw(alias), canonical);
}

export function classifyVisualProduct(
  visual: VisualProductInput,
  candidate: CandidateEvidence
): VisualMatch | undefined {
  const productType = visual.productType;
  const typeStatus = productType === undefined
    ? "UNKNOWN"
    : productTypeStatus(productType, candidateText(candidate, false));
  if (typeStatus === "CONTRADICTED") return undefined;

  const fullText = candidateText(candidate, true);
  if (
    hasNegativeClueConflict(visual, fullText) ||
    hasExclusiveAttributeConflict(visual, fullText)
  ) return undefined;
  const evidence: string[] = [];
  const matchedHardAttributes: string[] = [];
  const matchedSoftAttributes: string[] = [];
  const brandClue = visual.brand ?? visual.logoText;
  const brandMatched = brandClue !== undefined && matches(fullText, brandClue);
  if (brandMatched) evidence.push(`brand/logo matched: ${brandClue}`);

  const matchedStyleNumber = [visual.modelOrStyleNumber, ...(visual.styleNumberCandidates ?? [])]
    .find((value) => value !== undefined && matches(fullText, value));
  const modelMatched = matchedStyleNumber !== undefined;
  if (matchedStyleNumber !== undefined) evidence.push(`model/style matched: ${matchedStyleNumber}`);

  for (const [label, values] of hardVisualAttributes(visual)) {
    for (const value of values) {
      if (!matches(fullText, value)) continue;
      matchedHardAttributes.push(`${label}: ${value}`);
      break;
    }
  }
  for (const [label, values] of softVisualAttributes(visual)) {
    for (const value of values) {
      if (!matches(fullText, value)) continue;
      matchedSoftAttributes.push(`${label}: ${value}`);
      break;
    }
  }
  const matchedAttributes = [...matchedHardAttributes, ...matchedSoftAttributes];
  evidence.push(...matchedAttributes.map((value) => `visual attribute matched: ${value}`));
  if (productType !== undefined && typeStatus === "MATCHED") evidence.unshift(`product type matched: ${productType}`);
  if (productType !== undefined && typeStatus === "UNKNOWN") evidence.unshift(`product type not independently verified: ${productType}`);

  if (modelMatched) {
    return { group: "POSSIBLE_SAME_ITEM", score: 100 + matchedAttributes.length, evidence };
  }
  if (typeStatus === "UNKNOWN") return undefined;
  if (brandMatched && matchedHardAttributes.length >= 3) {
    return { group: "POSSIBLE_SAME_ITEM", score: 100 + matchedAttributes.length, evidence };
  }
  if (matchedHardAttributes.length >= 2) {
    return { group: "HIGHLY_SIMILAR", score: 70 + matchedAttributes.length, evidence };
  }
  if (
    (typeStatus === "MATCHED" && (matchedAttributes.length >= 1 || visualAttributeCount(visual) === 0)) ||
    brandMatched
  ) {
    return {
      group: "SAME_STYLE",
      score: 40 + matchedAttributes.length,
      evidence: [...evidence, ...(matchedAttributes.length === 0 ? ["visual details beyond product type were not verified"] : [])]
    };
  }
  return undefined;
}

export function visualSearchTerms(visual: VisualProductInput): string[] {
  const details = unique([
    ...(visual.hardClues ?? []).filter((clue) => !isVisualAttributeOccluded(visual, clue)),
    (visual.patterns ?? [])[0],
    visual.printDescription,
    isVisualAttributeOccluded(visual, "SILHOUETTE") ? undefined : visual.silhouette,
    isVisualAttributeOccluded(visual, "LENGTH") ? undefined : visual.length,
    isVisualAttributeOccluded(visual, "NECKLINE") ? undefined : visual.neckline,
    isVisualAttributeOccluded(visual, "SLEEVE") ? undefined : visual.sleeveType,
    isVisualAttributeOccluded(visual, "WAIST") ? undefined : visual.waist,
    (visual.distinctiveDetails ?? [])[0],
    (visual.visibleText ?? [])[0],
    (visual.styleNumberCandidates ?? [])[0],
    (visual.colors ?? [])[0],
    (visual.materials ?? [])[0],
    ...(visual.softClues ?? []),
    (visual.styleClues ?? [])[0]
  ]).slice(0, 4);
  return unique([
    visual.brand,
    visual.modelOrStyleNumber,
    visual.logoText,
    visual.productType,
    ...details
  ]);
}

export function visualBroadSearchTerms(visual: VisualProductInput): string[] {
  return unique([visual.brand ?? visual.logoText, coreProductType(visual.productType)]);
}

export function visualOfficialStoreSearchQueries(visual: VisualProductInput): VisualOfficialStoreQuery[] {
  const normalizedType = searchTerm(visual.productType);
  const category = officialSearchProductType(visual, normalizedType);
  const evidence = unique([
    ...(visual.hardClues ?? []).filter((clue) => !isVisualAttributeOccluded(visual, clue)),
    ...(visual.patterns ?? []),
    visual.printDescription,
    isVisualAttributeOccluded(visual, "SILHOUETTE") ? undefined : visual.silhouette,
    isVisualAttributeOccluded(visual, "LENGTH") ? undefined : visual.length,
    isVisualAttributeOccluded(visual, "NECKLINE") ? undefined : visual.neckline,
    isVisualAttributeOccluded(visual, "SLEEVE") ? undefined : visual.sleeveType,
    isVisualAttributeOccluded(visual, "WAIST") ? undefined : visual.waist,
    ...(visual.materials ?? []),
    ...(visual.distinctiveDetails ?? []),
    ...(visual.softClues ?? []),
    ...(visual.styleClues ?? [])
  ].map(searchTerm));
  const descriptors = officialVisualDescriptors(evidence);
  const primaryDetails = unique([
    searchTerm((visual.colors ?? [])[0]),
    ...descriptors
  ]).slice(0, 6);
  const coreDetails = unique([...descriptors, searchTerm((visual.colors ?? [])[0])]).slice(0, 3);
  const synonymDetails = officialVisualSynonymDetails(coreDetails);
  const queries: VisualOfficialStoreQuery[] = [
    {
      stage: "FULL",
      query: unique([officialFullProductType(normalizedType, category), ...primaryDetails]).join(" ")
    },
    {
      stage: "CORE",
      query: unique([category, ...coreDetails]).join(" ")
    },
    ...(synonymDetails.length === 0 ? [] : [{
      stage: "SYNONYM" as const,
      query: unique([category, ...synonymDetails]).join(" ")
    }]),
    {
      stage: "CATEGORY",
      query: category ?? normalizedType ?? ""
    }
  ];
  const seen = new Set<string>();
  return queries.filter(({ query }) => {
    const key = normalize(query);
    if (key === "" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function officialVisualDescriptors(evidence: string[]): string[] {
  const text = evidence.join(" ");
  const descriptors: Array<[RegExp, string]> = [
    [/\bfloral\b/u, "floral"],
    [/\b(?:smock(?:ed|ing)?|shirred|elasticated waist)\b/u, "smocked"],
    [/\blace\b/u, "lace"],
    [/\brib(?:bed|bing)\b/u, "ribbed"],
    [/\bmini\b/u, "mini"],
    [/\bmidi\b/u, "midi"],
    [/\bmaxi\b|ankle[\s-]*length/u, "maxi"],
    [/\bslip\b/u, "slip"],
    [/spaghetti[\s-]*strap|ultra[\s-]*skinny strap/u, "spaghetti strap"],
    [/\bcap[\s-]*sleeve/u, "cap sleeve"],
    [/\b(?:boat|bateau)[\s-]*(?:neck|neckline)?\b/u, "boat neck"],
    [/\bsquare[\s-]*(?:neck|neckline)\b/u, "square neck"],
    [/\bv[\s-]*(?:neck|neckline)\b/u, "v neck"],
    [/\bscoop[\s-]*(?:neck|neckline)\b/u, "scoop neck"],
    [/\blong[\s-]*sleeve/u, "long sleeve"],
    [/\bshort[\s-]*sleeve/u, "short sleeve"],
    [/\bsleeveless\b/u, "sleeveless"],
    [/\bbodycon\b/u, "bodycon"],
    [/\bcolumn\b/u, "column"],
    [/\ba[\s-]*line\b/u, "a line"],
    [/fit(?:ted)?[\s-]*(?:and|&)?[\s-]*flare|flared skirt/u, "fit flare"],
    [/\bsilk\b|silk satin/u, "silk"],
    [/\bramie\b/u, "ramie"],
    [/\bcotton\b/u, "cotton"]
  ];
  return descriptors.flatMap(([pattern, descriptor]) => pattern.test(text) ? [descriptor] : []);
}

function officialVisualSynonymDetails(details: string[]): string[] {
  if (!details.includes("smocked")) return [];
  return details.map((detail) => detail === "smocked" ? "shirred" : detail);
}

function officialSearchProductType(
  visual: VisualProductInput,
  normalizedType: string | undefined
): string | undefined {
  const category = coreProductType(normalizedType);
  if (category !== "top") return category;
  const details = [...(visual.styleClues ?? []), ...(visual.patterns ?? []), visual.silhouette ?? ""]
    .map((value) => normalize(value));
  return details.some((value) => value.includes("short sleeve") || value.includes("ribbed"))
    ? "t shirt"
    : category;
}

function searchTerm(value: string | undefined): string | undefined {
  return value === undefined ? undefined : normalize(value);
}

function coreProductType(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return productFamilies(value)[0] ?? value;
}

function relaxedProductType(value: string): string {
  const family = coreProductType(value) ?? value;
  if (family !== "dress") return family;
  const normalized = normalize(value);
  const length = ["mini", "midi", "maxi"].find((term) => matches(normalized, term));
  return length === undefined ? family : `${length} ${family}`;
}

function officialFullProductType(
  normalizedType: string | undefined,
  category: string | undefined
): string | undefined {
  return normalizedType !== undefined && /^(?:mini|midi|maxi) dress$/u.test(normalizedType)
    ? normalizedType
    : category ?? normalizedType;
}

function productTypeStatus(
  requested: string,
  candidate: string
): "MATCHED" | "CONTRADICTED" | "UNKNOWN" {
  const requestedFamilies = productFamilies(requested);
  const candidateFamilies = productFamilies(candidate);
  if (requestedFamilies.length === 0) return matches(candidate, requested) ? "MATCHED" : "UNKNOWN";
  if (candidateFamilies.length === 0) return "UNKNOWN";
  return requestedFamilies.some((requestedFamily) => candidateFamilies.some((candidateFamily) =>
    requestedFamily === candidateFamily || compatibleProductFamilies(requestedFamily, candidateFamily)
  )) ? "MATCHED" : "CONTRADICTED";
}

function compatibleProductFamilies(left: string, right: string): boolean {
  const upperBody = new Set(["top", "shirt", "t shirt"]);
  return upperBody.has(left) && upperBody.has(right);
}

const EXCLUSIVE_ATTRIBUTE_GROUPS = [
  ["sleeveless", "short sleeve", "long sleeve"],
  ["boat neck", "crew neck", "mock neck", "v neck", "square neck", "scoop neck", "halter neck", "sweetheart neck"],
  ["mini", "midi", "maxi"]
] as const;

function hasNegativeClueConflict(visual: VisualProductInput, candidate: string): boolean {
  return (visual.negativeClues ?? []).some((clue) =>
    !isVisualAttributeOccluded(visual, clue) && matches(candidate, clue)
  );
}

function hasExclusiveAttributeConflict(visual: VisualProductInput, candidate: string): boolean {
  const requested = [
    visual.productType,
    visual.length,
    isVisualAttributeOccluded(visual, "NECKLINE") ? undefined : visual.neckline,
    isVisualAttributeOccluded(visual, "SLEEVE") ? undefined : visual.sleeveType,
    ...(visual.hardClues ?? []).filter((clue) => !isVisualAttributeOccluded(visual, clue)),
    ...(visual.styleClues ?? [])
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ");
  return EXCLUSIVE_ATTRIBUTE_GROUPS.some((group) => {
    const requestedValues = group.filter((value) => matches(requested, value));
    if (requestedValues.length !== 1) return false;
    const observedValues = group.filter((value) => matches(candidate, value));
    return observedValues.length > 0 && !observedValues.includes(requestedValues[0]!);
  });
}

function productFamilies(value: string): string[] {
  const normalized = normalize(value);
  const padded = ` ${normalized} `;
  return [...PRODUCT_FAMILIES].filter((family) =>
    normalized === family || padded.includes(` ${family} `)
  );
}

function hardVisualAttributes(visual: VisualProductInput): Array<readonly [string, string[]]> {
  return [
    ["color", visual.colors ?? []],
    ["pattern", visual.patterns ?? []],
    ["silhouette", visual.silhouette === undefined || isVisualAttributeOccluded(visual, "SILHOUETTE") ? [] : [visual.silhouette]],
    ["length", visual.length === undefined || isVisualAttributeOccluded(visual, "LENGTH") ? [] : [visual.length]],
    ["neckline", visual.neckline === undefined || isVisualAttributeOccluded(visual, "NECKLINE") ? [] : [visual.neckline]],
    ["sleeve", visual.sleeveType === undefined || isVisualAttributeOccluded(visual, "SLEEVE") ? [] : [visual.sleeveType]],
    ["closure", visual.closure === undefined ? [] : [visual.closure]],
    ["collar", visual.collar === undefined ? [] : [visual.collar]],
    ["waist", visual.waist === undefined || isVisualAttributeOccluded(visual, "WAIST") ? [] : [visual.waist]],
    ["hem", visual.hem === undefined ? [] : [visual.hem]],
    ["print", visual.printDescription === undefined ? [] : [visual.printDescription]],
    ...(visual.distinctiveDetails ?? [])
      .map((detail): readonly [string, string[]] => ["distinctive detail", [detail]]),
    ...(visual.visibleText ?? [])
      .map((text): readonly [string, string[]] => ["visible text", [text]]),
    ...(visual.observations ?? [])
      .filter((observation) => observation.confidence >= 0.8 && !isVisualAttributeOccluded(visual, observation.attribute))
      .map((observation): readonly [string, string[]] => [observation.attribute, [observation.value]]),
    ...(visual.hardClues ?? [])
      .filter((clue) => !isVisualAttributeOccluded(visual, clue))
      .map((clue): readonly [string, string[]] => ["hard clue", [clue]])
  ];
}

function visualAttributeKey(value: string): string | undefined {
  const normalized = normalizeRaw(value);
  for (const [key, pattern] of OCCLUDED_ATTRIBUTE_PATTERNS) {
    if (pattern.test(normalized)) return key;
  }
  if (normalized.includes("length") || normalized.includes("hem")) return "LENGTH";
  if (normalized.includes("waist")) return "WAIST";
  if (normalized.includes("silhouette")) return "SILHOUETTE";
  return undefined;
}

function softVisualAttributes(visual: VisualProductInput): Array<readonly [string, string[]]> {
  return [
    ["material", visual.materials ?? []],
    ["style", visual.styleClues ?? []],
    ["inferred detail", (visual.inferences ?? []).map((inference) => inference.value)],
    ["soft clue", visual.softClues ?? []]
  ];
}

function visualAttributeCount(visual: VisualProductInput): number {
  return [...hardVisualAttributes(visual), ...softVisualAttributes(visual)]
    .reduce((count, [, values]) => count + values.length, 0);
}

function candidateText(candidate: CandidateEvidence, includeDetails: boolean): string {
  return [
    candidate.title,
    candidate.productType,
    ...(includeDetails ? [candidate.brand, candidate.modelOrStyleNumber, candidate.description, ...(candidate.attributes ?? [])] : [])
  ].filter((value): value is string => value !== undefined).join(" ");
}

function matches(candidateTextValue: string, clue: string): boolean {
  const text = normalize(candidateTextValue);
  const normalizedClue = canonical(clue);
  return text.includes(normalizedClue) || tokens(normalizedClue).every((token) => text.includes(token));
}

function normalize(value: string): string {
  let output = ` ${normalizeRaw(value)} `;
  const replacements: string[] = [];
  for (const [alias, canonicalValue] of [...ALIASES].sort((left, right) => right[0].length - left[0].length)) {
    const marker = `\uE000${replacements.length}\uE001`;
    const next = containsCjk(alias)
      ? output.replaceAll(alias, marker)
      : output.replaceAll(` ${alias} `, ` ${marker} `);
    if (next === output) continue;
    replacements.push(canonicalValue);
    output = next;
  }
  replacements.forEach((replacement, index) => {
    output = output.replaceAll(`\uE000${index}\uE001`, ` ${replacement} `);
  });
  return output.replace(/\s+/gu, " ").trim();
}

function canonical(value: string): string {
  const normalized = normalizeRaw(value);
  return ALIASES.get(normalized) ?? normalized;
}

function normalizeRaw(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase("en-US")
    .replace(/[’']/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokens(value: string): string[] {
  return value.split(/\s+/u).filter((token) => token.length > 0);
}

function containsCjk(value: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined).map((value) => value.trim()).filter(Boolean))];
}
