import { z } from "zod";

const VisualTextSchema = z.string().trim().min(1).max(100);
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
  styleClues: z.array(VisualTextSchema).max(6).default([])
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
  stage: "FULL" | "CORE" | "CATEGORY";
  query: string;
};

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
  ["jeans", "denim pants", "牛仔裤"],
  ["shirt", "shirts", "衬衫"],
  ["t shirt", "tshirt", "tee", "tees", "短袖", "t恤"],
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
  ["green", "绿", "绿色"],
  ["brown", "tan", "棕", "棕色", "褐色", "驼色"],
  ["pink", "粉", "粉色"],
  ["solid", "plain", "纯色", "素色"],
  ["striped", "stripe", "条纹"],
  ["plaid", "check", "checked", "格纹", "格子"],
  ["floral", "flower", "花卉", "碎花"],
  ["mini", "short", "短款", "迷你"],
  ["midi", "中长款"],
  ["maxi", "long", "长款"],
  ["slim", "slim fit", "修身"],
  ["relaxed", "loose", "oversized", "宽松", "廓形"],
  ["bodycon", "紧身", "包臀"],
  ["fitted flared", "fit and flare", "a line", "a-line", "收腰a字", "a字", "伞形"],
  ["bateau neckline", "boat neck", "船领"],
  ["tiered skirt", "layered skirt", "分层裙摆", "层叠裙摆"]
] as const;

const PRODUCT_FAMILIES = new Set([
  "dress", "skirt", "trouser", "jeans", "shirt", "t shirt", "top", "jacket", "coat",
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
  const evidence: string[] = [];
  const matchedAttributes: string[] = [];
  const brandClue = visual.brand ?? visual.logoText;
  const brandMatched = brandClue !== undefined && matches(fullText, brandClue);
  if (brandMatched) evidence.push(`brand/logo matched: ${brandClue}`);

  const modelMatched = visual.modelOrStyleNumber !== undefined && matches(fullText, visual.modelOrStyleNumber);
  if (modelMatched) evidence.push(`model/style matched: ${visual.modelOrStyleNumber}`);

  for (const [label, values] of visualAttributes(visual)) {
    for (const value of values) {
      if (!matches(fullText, value)) continue;
      matchedAttributes.push(`${label}: ${value}`);
      break;
    }
  }
  evidence.push(...matchedAttributes.map((value) => `visual attribute matched: ${value}`));
  if (productType !== undefined && typeStatus === "MATCHED") evidence.unshift(`product type matched: ${productType}`);
  if (productType !== undefined && typeStatus === "UNKNOWN") evidence.unshift(`product type not independently verified: ${productType}`);

  if (modelMatched || (brandMatched && matchedAttributes.length >= 2)) {
    return { group: "POSSIBLE_SAME_ITEM", score: 100 + matchedAttributes.length, evidence };
  }
  if (matchedAttributes.length >= 3 || (brandMatched && matchedAttributes.length >= 1)) {
    return { group: "HIGHLY_SIMILAR", score: 70 + matchedAttributes.length, evidence };
  }
  if (
    (typeStatus === "MATCHED" && (matchedAttributes.length >= 1 || visualAttributeCount(visual) === 0)) ||
    (typeStatus === "UNKNOWN" && matchedAttributes.length >= 1) ||
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
    visual.colors[0],
    visual.materials[0],
    visual.patterns[0],
    visual.silhouette,
    visual.length,
    visual.styleClues[0]
  ]).slice(0, 2);
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
  const category = coreProductType(normalizedType);
  const primaryDetails = unique([
    visual.patterns[0],
    visual.colors[0],
    visual.materials[0],
    visual.length,
    visual.styleClues[0]
  ].map(searchTerm));
  const queries: VisualOfficialStoreQuery[] = [
    {
      stage: "FULL",
      query: unique([normalizedType, ...primaryDetails]).join(" ")
    },
    {
      stage: "CORE",
      query: unique([category, ...primaryDetails.slice(0, 2)]).join(" ")
    },
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

function searchTerm(value: string | undefined): string | undefined {
  return value === undefined ? undefined : normalize(value);
}

function coreProductType(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return productFamilies(value)[0] ?? value;
}

function productTypeStatus(
  requested: string,
  candidate: string
): "MATCHED" | "CONTRADICTED" | "UNKNOWN" {
  const requestedFamilies = productFamilies(requested);
  const candidateFamilies = productFamilies(candidate);
  if (requestedFamilies.length === 0) return matches(candidate, requested) ? "MATCHED" : "UNKNOWN";
  if (candidateFamilies.length === 0) return "UNKNOWN";
  return requestedFamilies.some((family) => candidateFamilies.includes(family)) ? "MATCHED" : "CONTRADICTED";
}

function productFamilies(value: string): string[] {
  const normalized = normalize(value);
  return [...PRODUCT_FAMILIES].filter((family) =>
    normalized === family || normalized.split(/\s+/u).includes(family) || normalized.includes(` ${family} `)
  );
}

function visualAttributes(visual: VisualProductInput): Array<readonly [string, string[]]> {
  return [
    ["color", visual.colors],
    ["material", visual.materials],
    ["pattern", visual.patterns],
    ["silhouette", visual.silhouette === undefined ? [] : [visual.silhouette]],
    ["length", visual.length === undefined ? [] : [visual.length]],
    ["style", visual.styleClues]
  ];
}

function visualAttributeCount(visual: VisualProductInput): number {
  return visualAttributes(visual).reduce((count, [, values]) => count + values.length, 0);
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
  for (const [alias, canonicalValue] of [...ALIASES].sort((left, right) => right[0].length - left[0].length)) {
    output = containsCjk(alias)
      ? output.replaceAll(alias, ` ${canonicalValue} `)
      : output.replaceAll(` ${alias} `, ` ${canonicalValue} `);
  }
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
