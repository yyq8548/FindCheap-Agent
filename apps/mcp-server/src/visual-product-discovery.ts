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

type CandidateEvidence = {
  title: string;
  productType?: string | undefined;
  brand?: string | undefined;
  modelOrStyleNumber?: string | undefined;
  description?: string | undefined;
  attributes?: string[] | undefined;
};

const ALIAS_GROUPS = [
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
  ["black", "黑", "黑色"],
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
  ["bodycon", "紧身", "包臀"]
] as const;

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
  if (productType !== undefined && !matches(candidateText(candidate, false), productType)) return undefined;

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
  if (productType !== undefined) evidence.unshift(`product type matched: ${productType}`);

  if (modelMatched || (brandMatched && matchedAttributes.length >= 2)) {
    return { group: "POSSIBLE_SAME_ITEM", score: 100 + matchedAttributes.length, evidence };
  }
  if (matchedAttributes.length >= 3 || (brandMatched && matchedAttributes.length >= 1)) {
    return { group: "HIGHLY_SIMILAR", score: 70 + matchedAttributes.length, evidence };
  }
  if (productType !== undefined && (matchedAttributes.length >= 1 || visualAttributeCount(visual) === 0)) {
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
  return unique([visual.productType, visual.styleClues[0]]);
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
    output = output.replaceAll(` ${alias} `, ` ${canonicalValue} `);
  }
  return output.trim();
}

function canonical(value: string): string {
  const normalized = normalizeRaw(value);
  return ALIASES.get(normalized) ?? normalized;
}

function normalizeRaw(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/[’']/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokens(value: string): string[] {
  return value.split(/\s+/u).filter((token) => token.length > 0);
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined).map((value) => value.trim()).filter(Boolean))];
}
