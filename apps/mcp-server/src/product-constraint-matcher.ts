import { hairFeatureStatus } from "../../../packages/contracts/src/hair-requirements.js";
import { functionalFeatureStatus } from "./functional-requirements.js";
import { namedProductIdentity, normalizeNamedProductIdentity } from "./named-product-identity.js";

type Comparator = "EXACT" | "MIN" | "MAX" | "APPROX";
type QuantityKind = "LENGTH" | "MEMORY" | "STORAGE" | "DATA" | "VOLUME" | "MASS" | "COUNT" | "FREQUENCY" | "POWER";
type Quantity = { kind: QuantityKind; value: number; comparator: Comparator; displayContext?: boolean };
export type FeatureMatchStatus = "MATCHED" | "CONTRADICTED" | "UNKNOWN";

const FEATURE_STOP_WORDS = new Set([
  "at", "least", "minimum", "min", "maximum", "max", "with", "for", "and", "or", "of", "the",
  "about", "around", "approximately", "class", "display", "screen"
]);
const COMPOUND_COLORS = [
  "space black", "jet black", "midnight blue", "rose gold", "space gray", "space grey",
  "starlight", "natural titanium", "desert titanium", "blue titanium", "black titanium"
] as const;
const SIMPLE_COLORS = [
  "beige", "black", "blue", "brown", "cream", "gold", "gray", "grey", "green", "midnight",
  "navy", "orange", "pink", "purple", "red", "silver", "tan", "white", "yellow"
] as const;
const RESOLUTIONS: ReadonlyArray<{ name: string; patterns: RegExp[] }> = [
  { name: "8K", patterns: [/\b8k\b/u, /\b7680\s*[x×]\s*4320\b/u, /\b4320p\b/u] },
  { name: "4K", patterns: [/\b4k\b/u, /\buhd\b/u, /\b3840\s*[x×]\s*2160\b/u, /\b2160p\b/u] },
  { name: "QHD", patterns: [/\bqhd\b/u, /\b2560\s*[x×]\s*1440\b/u, /\b1440p\b/u] },
  { name: "FHD", patterns: [/\bfhd\b/u, /\bfull\s*hd\b/u, /\b1920\s*[x×]\s*1080\b/u, /\b1080p\b/u] }
];

export function evaluateFeature(searchable: string, feature: string): FeatureMatchStatus {
  const named = namedIdentityFeatureStatus(searchable, feature);
  if (named !== undefined) return named;
  // Preserve field punctuation and sentence boundaries for scoped claim evidence.
  const functional = functionalFeatureStatus(searchable, feature);
  if (functional !== undefined) return functional;
  const normalizedSearchable = normalize(searchable);
  const normalizedFeature = normalize(feature);

  const alternatives = disjunctiveAlternatives(normalizedFeature);
  if (alternatives.length > 1) {
    const statuses = alternatives.map((alternative) => evaluateFeature(normalizedSearchable, alternative));
    if (statuses.includes("MATCHED")) return "MATCHED";
    return statuses.every((status) => status === "CONTRADICTED") ? "CONTRADICTED" : "UNKNOWN";
  }

  const hair = hairFeatureStatus(normalizedSearchable, normalizedFeature);
  if (hair !== undefined) return hair;

  const requestedResolution = resolution(normalizedFeature);
  if (requestedResolution !== undefined) {
    const observed = resolution(normalizedSearchable);
    return observed === undefined ? "UNKNOWN" : observed === requestedResolution ? "MATCHED" : "CONTRADICTED";
  }

  const requestedColor = requestedColorName(normalizedFeature);
  if (requestedColor !== undefined) {
    const observed = observedColors(normalizedSearchable);
    return observed.has(requestedColor) ? "MATCHED" : observed.size > 0 ? "CONTRADICTED" : "UNKNOWN";
  }

  const requestedSize = apparelSize(normalizedFeature);
  if (requestedSize !== undefined) {
    const observedSizes = apparelSizes(normalizedSearchable);
    const matched = observedSizes.some((observed) =>
      observed.system === requestedSize.system &&
      observed.audience === requestedSize.audience &&
      observed.value === requestedSize.value
    );
    return matched ? "MATCHED" : observedSizes.length > 0 ? "CONTRADICTED" : "UNKNOWN";
  }

  const requestedQuantity = firstQuantity(normalizedFeature, true);
  if (requestedQuantity !== undefined) {
    const observed = quantities(normalizedSearchable, false)
      .filter((entry) => quantityKindsCompatible(requestedQuantity.kind, entry.kind));
    return observed.some((entry) => quantityMatches(requestedQuantity, entry))
      ? "MATCHED"
      : observed.length > 0 ? "CONTRADICTED" : "UNKNOWN";
  }

  const semantic = semanticFeatureStatus(normalizedSearchable, normalizedFeature);
  if (semantic !== undefined) return semantic;

  const requestedModel = compactModel(normalizedFeature);
  if (isModelLike(requestedModel)) {
    return compactModel(normalizedSearchable).includes(requestedModel) ? "MATCHED" : "UNKNOWN";
  }

  if (normalizedSearchable.includes(normalizedFeature)) return "MATCHED";

  const requestedTokens = meaningfulTokens(normalizedFeature);
  if (requestedTokens.length === 0) return "UNKNOWN";
  const observedTokens = new Set(meaningfulTokens(normalizedSearchable));
  return requestedTokens.every((token) => observedTokens.has(token)) ? "MATCHED" : "UNKNOWN";
}

/** Reviewed bilingual identities only; every required anchor must occur in this field. */
export function namedIdentityFeatureStatus(text: string, feature: string): FeatureMatchStatus | undefined {
  if (namedProductIdentity(feature) === undefined) return undefined;
  const normalizedFeature = normalizeNamedProductIdentity(feature).toLowerCase();
  const tokens: string[] = normalizedFeature.match(/[\p{L}\p{N}]+/gu) ?? [];
  // Do not fall through to color/quantity matching and accidentally satisfy
  // only an extra attribute while ignoring the requested character identity.
  if (!tokens.every(token => ["honorofkings", "libai", "default", "wig", "wigs"].includes(token))) return "UNKNOWN";
  let matched = false;
  let precedingIdentity = false;
  for (const clause of text.split(/[.;!?。；！？\n]|\b(?:but|however)\b/iu)) {
    const normalized = normalizeNamedProductIdentity(clause).toLowerCase();
    if (normalized === "") continue;
    const previousIdentity = precedingIdentity;
    precedingIdentity = false;
    // Merchant navigation, other products and conditional claims cannot lend
    // this product a character or appearance, even within the same field.
    if (/\b(?:other|another|separately|guide|tutorial|article|blog|when|if|may|might|could|possible)\b|另售|另一|其他|教程|指南|搭配|如果|可能/u.test(normalized)) continue;
    const completeIdentity = namedProductIdentity(clause) !== undefined;
    precedingIdentity = completeIdentity;
    const implicitDefaultNegation = tokens.includes("default") && previousIdentity &&
      /^(?:this (?:wig|item|product) (?:is )?|it (?:is )?)?(?:not|no|never) (?:the )?default\s*$/u.test(normalized);
    if (!completeIdentity && !implicitDefaultNegation) continue;
    if (/\b(?:not|no|never|without|excluding)\b|不是|不含|并非|非/u.test(normalized)) return "CONTRADICTED";
    if ((!tokens.includes("default") || namedDefaultClaim(normalized)) &&
      (!tokens.some(token => /^wigs?$/u.test(token)) || /\bwigs?\b/u.test(normalized))) matched = true;
  }
  return matched ? "MATCHED" : "UNKNOWN";
}

function namedDefaultClaim(normalized: string): boolean {
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const links = new Set(["honorofkings", "libai", "the", "his", "in", "with", "is", "wig", "wigs", "original", "的", "为", "是"]);
  return words.some((word, character) => word === "libai" && words.some((variant, appearance) =>
    variant === "default" && words.slice(Math.min(character, appearance) + 1, Math.max(character, appearance))
      .every(link => links.has(link))));
}


function disjunctiveAlternatives(feature: string): string[] {
  if (!/\bor\b/u.test(feature)) return [];
  const expression = feature
    .replace(/^(?:contains?|with)\s+/u, "")
    .replace(/\s+as\s+an?\s+active(?:\s+anti[-\s]?dandruff)?\s+ingredient.*$/u, "")
    .replace(/,\s*or\s+/gu, " or ")
    .replace(/,/gu, " or ");
  return expression.split(/\s+or\s+/u).map((value) => value.trim()).filter(Boolean);
}

type SemanticFeature = {
  aliases: readonly string[];
  conflicts?: readonly string[];
};

const SEMANTIC_FEATURES: Readonly<Record<string, SemanticFeature>> = {
  leather: {
    aliases: ["leather", "genuine leather", "real leather", "full grain", "top grain", "cowhide", "calfskin", "suede"],
    conflicts: ["faux leather", "vegan leather", "pu leather", "synthetic leather", "leatherette"]
  },
  "genuine leather": {
    aliases: ["genuine leather", "real leather", "full grain", "top grain", "cowhide", "calfskin"],
    conflicts: ["faux leather", "vegan leather", "pu leather", "synthetic leather", "leatherette"]
  },
  flat: {
    aliases: ["flat", "flat shoe", "flat shoes", "flat sole", "ballet flat", "ballet flats", "loafer", "loafers"],
    conflicts: ["high heel", "high heels", "heeled", "stiletto", "platform heel"]
  },
  "ballet flat": {
    aliases: ["ballet flat", "ballet flats", "ballet shoe", "ballet shoes", "ballerina flat", "ballerina flats"],
    conflicts: ["high heel", "high heels", "stiletto"]
  },
  loafer: { aliases: ["loafer", "loafers", "slip on", "slip-on"] },
  sneaker: { aliases: ["sneaker", "sneakers", "trainer", "trainers", "athletic shoe", "running shoe"] },
  boot: { aliases: ["boot", "boots", "ankle boot", "chelsea boot"] },
  sandal: { aliases: ["sandal", "sandals", "slide", "slides"] },
  casual: { aliases: ["casual", "everyday", "daily wear", "day to day", "versatile"] },
  formal: { aliases: ["formal", "dress shoe", "dress shoes", "office wear", "business"] },
  minimalist: { aliases: ["minimalist", "minimal", "clean design", "simple style"] }
};

function semanticFeatureStatus(searchable: string, feature: string): FeatureMatchStatus | undefined {
  const semanticSearchable = searchable.replace(/[-_/]+/gu, " ");
  const semanticFeature = feature.replace(/[-_/]+/gu, " ");
  const key = Object.keys(SEMANTIC_FEATURES).find((candidate) =>
    phrasePresent(semanticFeature, candidate) || SEMANTIC_FEATURES[candidate]!.aliases.some((alias) => phrasePresent(semanticFeature, alias))
  );
  if (key === undefined) return undefined;
  const definition = SEMANTIC_FEATURES[key]!;
  if ((definition.conflicts ?? []).some((phrase) => phrasePresent(semanticSearchable, phrase))) return "CONTRADICTED";
  return definition.aliases.some((phrase) => phrasePresent(semanticSearchable, phrase)) ? "MATCHED" : "UNKNOWN";
}

function phrasePresent(value: string, phrase: string): boolean {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(phrase).replaceAll("\\ ", "\\s+")}(?:$|[^\\p{L}\\p{N}])`, "u").test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function firstQuantity(value: string, requested: boolean): Quantity | undefined {
  return quantities(value, requested)[0];
}

function quantities(value: string, requested: boolean): Quantity[] {
  const matches: Quantity[] = [];
  const dataMatches: Quantity[] = [];
  const comparator = requested ? requestedComparator(value) : "EXACT";

  for (const match of value.matchAll(/\b(\d+(?:\.\d+)?)\s*[-\s]*(tb|gb|gib|mb)\b/gu)) {
    const numeric = Number(match[1]);
    const unit = match[2]!;
    const kind = dataKind(value, match.index ?? 0, match[0].length, unit);
    dataMatches.push({
      kind,
      value: unit === "tb" ? numeric * 1024 : unit === "mb" ? numeric / 1024 : numeric,
      comparator
    });
  }
  if (dataMatches.length > 1 && dataMatches.some((entry) => entry.kind === "STORAGE")) {
    for (const entry of dataMatches) {
      matches.push(entry.kind === "DATA" ? { ...entry, kind: "MEMORY" } : entry);
    }
  } else {
    matches.push(...dataMatches);
  }

  for (const match of value.matchAll(/\b(\d+(?:\.\d+)?)\s*[-\s]*(cm|mm|inch(?:es)?|in\b|(?:["″”]|′′))/gu)) {
    const numeric = Number(match[1]);
    const unit = match[2]!;
    const context = contextAround(value, match.index ?? 0, match[0].length);
    if (/\b(?:width|height|depth|long|wide|宽|高|深)\b/u.test(context)) continue;
    matches.push({
      kind: "LENGTH",
      value: unit === "cm" ? numeric / 2.54 : unit === "mm" ? numeric / 25.4 : numeric,
      comparator,
      displayContext: /\b(?:display|screen|monitor|tv|television|laptop|notebook|macbook|tablet|ipad|屏幕|显示器)\b/u.test(context)
    });
  }

  for (const match of value.matchAll(/\b(\d+(?:\.\d+)?)\s*(fl\s*oz|ml|milliliters?|l|liters?)\b/gu)) {
    const numeric = Number(match[1]);
    const unit = match[2]!.replace(/\s+/gu, "");
    matches.push({
      kind: "VOLUME",
      value: unit === "floz" ? numeric * 29.5735 : unit === "l" || unit.startsWith("liter") ? numeric * 1000 : numeric,
      comparator
    });
  }
  for (const match of value.matchAll(/\b(\d+(?:\.\d+)?)\s*(kg|g|grams?|lb|lbs|pounds?|oz)\b/gu)) {
    const numeric = Number(match[1]);
    const unit = match[2]!;
    const context = contextAround(value, match.index ?? 0, match[0].length);
    if (unit === "oz" && /\bfl\s*oz\b/u.test(context)) continue;
    matches.push({
      kind: "MASS",
      value: unit === "kg" ? numeric * 1000 : unit === "lb" || unit === "lbs" || unit.startsWith("pound")
        ? numeric * 453.592 : unit === "oz" ? numeric * 28.3495 : numeric,
      comparator
    });
  }
  for (const match of value.matchAll(/\b(\d+)\s*[-\s]*(pack|pk|count|ct|pieces?|pcs?|件|瓶)\b/gu)) {
    matches.push({ kind: "COUNT", value: Number(match[1]), comparator });
  }
  if (/\bpair\b/u.test(value)) matches.push({ kind: "COUNT", value: 2, comparator });
  if (/\bdozen\b/u.test(value)) matches.push({ kind: "COUNT", value: 12, comparator });

  for (const match of value.matchAll(/\b(\d+(?:\.\d+)?)\s*(khz|hz)\b/gu)) {
    const context = contextAround(value, match.index ?? 0, match[0].length);
    if (!requested && /\b(?:motion\s+rate|effective|truemotion|clear\s+motion)\b/u.test(context) && !/\bnative\b/u.test(context)) continue;
    matches.push({
      kind: "FREQUENCY",
      value: match[2] === "khz" ? Number(match[1]) * 1000 : Number(match[1]),
      comparator
    });
  }
  for (const match of value.matchAll(/\b(\d+(?:\.\d+)?)\s*w(?:atts?)?\b/gu)) {
    matches.push({ kind: "POWER", value: Number(match[1]), comparator });
  }
  return matches;
}

function quantityMatches(requested: Quantity, observed: Quantity): boolean {
  if (!quantityKindsCompatible(requested.kind, observed.kind)) return false;
  if (requested.kind === "LENGTH" && requested.displayContext && observed.displayContext === false) return false;
  if (requested.comparator === "MIN") return observed.value >= requested.value;
  if (requested.comparator === "MAX") return observed.value <= requested.value;
  const tolerance = requested.kind === "LENGTH" ? 0.5
    : requested.kind === "COUNT" || requested.kind === "FREQUENCY" || requested.kind === "POWER" ? 0
      : Math.max(requested.value * (requested.comparator === "APPROX" ? 0.05 : 0.025), 0.01);
  return Math.abs(observed.value - requested.value) <= tolerance;
}

function quantityKindsCompatible(requested: QuantityKind, observed: QuantityKind): boolean {
  if (requested === observed) return true;
  if ((requested === "MEMORY" || requested === "STORAGE") && observed === "DATA") return true;
  return requested === "DATA" && (observed === "MEMORY" || observed === "STORAGE");
}

function dataKind(value: string, index: number, length: number, unit: string): QuantityKind {
  const before = value.slice(Math.max(0, index - 24), index);
  const after = value.slice(index + length, Math.min(value.length, index + length + 24));
  if (unit === "tb") return "STORAGE";
  if (/^\s*(?:ram|memory|unified\s+memory|内存)\b/u.test(after)) return "MEMORY";
  if (/^\s*(?:ssd|storage|drive|disk|存储|硬盘|容量)\b/u.test(after)) return "STORAGE";
  if (/(?:ram|memory|内存)\s*$/u.test(before)) return "MEMORY";
  if (/(?:ssd|storage|drive|disk|存储|硬盘)\s*$/u.test(before)) return "STORAGE";
  return "DATA";
}

function requestedComparator(value: string): Comparator {
  if (/\b(?:at\s+least|minimum|min|>=)|至少|不低于/u.test(value)) return "MIN";
  if (/\b(?:under|below|less\s+than|maximum|max|up\s+to|<=)|低于|不超过|至多/u.test(value)) return "MAX";
  if (/\b(?:about|around|approximately|class)|左右|大约|约/u.test(value)) return "APPROX";
  return "EXACT";
}

function resolution(value: string): string | undefined {
  return RESOLUTIONS.find((entry) => entry.patterns.some((pattern) => pattern.test(value)))?.name;
}

/** Only a standalone color requirement, not a phrase such as "red leather shoes". */
export function isColorRequirement(value: string): boolean {
  const normalized = normalize(value).replace(/^(?:colou?r\s*[:=]?\s*)/u, "").trim();
  const alternatives = disjunctiveAlternatives(normalized);
  return (alternatives.length > 0 ? alternatives : [normalized]).every(part =>
    [...COMPOUND_COLORS, ...SIMPLE_COLORS].some(color => part === color));
}

function requestedColorName(value: string): string | undefined {
  return [...observedColors(value)][0];
}

function observedColors(value: string): Set<string> {
  let remaining = value;
  const colors = new Set<string>();
  for (const color of COMPOUND_COLORS) {
    if (remaining.includes(color)) {
      colors.add(canonicalColor(color));
      remaining = remaining.replaceAll(color, " ");
    }
  }
  for (const color of SIMPLE_COLORS) {
    if (new RegExp(`\\b${color}\\b`, "u").test(remaining)) colors.add(canonicalColor(color));
  }
  return colors;
}

function canonicalColor(value: string): string {
  return value.replaceAll("gray", "grey").replace(/\s+/gu, "");
}

type ApparelSize = { system: "US" | "UK" | "EU" | "GENERIC"; audience: "MEN" | "WOMEN" | "KIDS" | "ANY"; value: string };

function apparelSize(value: string): ApparelSize | undefined {
  return apparelSizes(value)[0];
}

function apparelSizes(value: string): ApparelSize[] {
  const audience = /\b(?:women|womens|women's)\b/u.test(value) ? "WOMEN"
    : /\b(?:men|mens|men's)\b/u.test(value) ? "MEN"
      : /\b(?:kid|kids|child|children|youth)\b/u.test(value) ? "KIDS" : "ANY";
  const sizes: ApparelSize[] = [];
  for (const match of value.matchAll(/\b(us|uk|eu)\s*(\d+(?:\.5)?)\b/gu)) {
    sizes.push({ system: match[1]!.toUpperCase() as ApparelSize["system"], audience, value: match[2]! });
  }
  const generic = value.match(/\b(?:size\s*)?(xxs|xs|small|s|medium|m|large|l|xl|xxl|xxxl)\b/u);
  if (generic !== null) sizes.push({ system: "GENERIC", audience, value: canonicalApparelSize(generic[1]!) });
  return sizes;
}

function canonicalApparelSize(value: string): string {
  return ({ small: "S", medium: "M", large: "L" } as Record<string, string>)[value] ?? value.toUpperCase();
}

function meaningfulTokens(value: string): string[] {
  return (value.match(/[\p{L}\p{N}]+/gu) ?? [])
    .map(canonicalToken)
    .filter((token) => token.length > 1 && !FEATURE_STOP_WORDS.has(token));
}

function canonicalToken(value: string): string {
  let token = value;
  if (/^\d+(?:st|nd|rd|th)$/u.test(token)) token = token.replace(/(?:st|nd|rd|th)$/u, "");
  if (token === "generation") token = "gen";
  if (token.length > 5 && token.endsWith("ing")) token = token.slice(0, -3);
  else if (token.length > 4 && token.endsWith("ed")) token = token.slice(0, -2);
  else if (token.length > 4 && token.endsWith("es")) token = token.slice(0, -2);
  else if (token.length > 3 && token.endsWith("s")) token = token.slice(0, -1);
  if (token.length > 4 && token.endsWith("e")) token = token.slice(0, -1);
  return token;
}

function compactModel(value: string): string {
  return meaningfulTokens(value).join("");
}

function isModelLike(value: string): boolean {
  return value.length >= 4 && /\p{L}/u.test(value) && /\d/u.test(value);
}

function contextAround(value: string, index: number, length: number): string {
  return value.slice(Math.max(0, index - 28), Math.min(value.length, index + length + 28));
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US")
    .replaceAll("长直发", " long hair straight hair ")
    .replaceAll("长发", " long hair ").replaceAll("短发", " short hair ")
    .replaceAll("直发", " straight hair ").replaceAll("卷发", " curly hair ")
    .replaceAll("假发", " wig ")
    .replace(/\bonyx\b/gu, " black ")
    .replace(/\bheather\s+gr(?:a|e)y\b/gu, " grey ")
    .replace(/(\d+(?:\.\d+)?)\s*(?:英寸|寸)/gu, "$1 inch")
    .replace(/(\d+(?:\.\d+)?)\s*厘米/gu, "$1 cm")
    .replace(/(\d+(?:\.\d+)?)\s*毫米/gu, "$1 mm")
    .replace(/(\d+(?:\.\d+)?)\s*液体盎司/gu, "$1 fl oz")
    .replace(/(\d+(?:\.\d+)?)\s*毫升/gu, "$1 ml")
    .replace(/(\d+(?:\.\d+)?)\s*升/gu, "$1 l")
    .replace(/(\d+(?:\.\d+)?)\s*(?:公斤|千克)/gu, "$1 kg")
    .replace(/(\d+(?:\.\d+)?)\s*克/gu, "$1 g")
    .replace(/(\d+(?:\.\d+)?)\s*磅/gu, "$1 lb")
    .replace(/(\d+(?:\.\d+)?)\s*盎司/gu, "$1 oz")
    .replace(/(\d+(?:\.\d+)?)\s*赫兹/gu, "$1 hz")
    .replace(/(\d+(?:\.\d+)?)\s*瓦/gu, "$1 w")
    .replace(/(\d+)\s*(?:件|瓶|个)/gu, "$1 count")
    .replace(/(\d+(?:\.\d+)?)\s*g(?=\s*(?:内存|ram|memory))/gu, "$1gb")
    .replace(/(\d+(?:\.\d+)?)\s*t(?=\s*(?:存储|ssd|storage))/gu, "$1tb")
    .replaceAll("深空黑色", " space black ")
    .replaceAll("深空灰色", " space grey ")
    .replaceAll("玫瑰金", " rose gold ")
    .replaceAll("黑色", " black ")
    .replaceAll("灰色", " grey ")
    .replaceAll("蓝色", " blue ")
    .replaceAll("白色", " white ")
    .replaceAll("红色", " red ")
    .replaceAll("绿色", " green ")
    .replaceAll("内存", " memory ")
    .replaceAll("存储", " storage ")
    .replaceAll("屏幕", " display ")
    .replaceAll("显示器", " display ")
    .replaceAll("男款", " men's ")
    .replaceAll("女款", " women's ")
    .replaceAll("儿童", " kids ")
    .replaceAll("小码", " size small ")
    .replaceAll("中码", " size medium ")
    .replaceAll("大码", " size large ")
    .replaceAll("一对", " pair ")
    .replaceAll("一打", " dozen ")
    .replaceAll("适用于", " compatible with ")
    .replaceAll("真皮", " genuine leather ")
    .replaceAll("皮质", " leather ")
    .replaceAll("皮革", " leather ")
    .replaceAll("人造皮", " faux leather ")
    .replaceAll("合成革", " synthetic leather ")
    .replaceAll("平底皮鞋", " leather flat shoes ")
    .replaceAll("芭蕾平底鞋", " ballet flats ")
    .replaceAll("芭蕾舞鞋", " ballet shoes ")
    .replaceAll("平底鞋", " flat shoes ")
    .replaceAll("乐福鞋", " loafers ")
    .replaceAll("运动鞋", " sneakers ")
    .replaceAll("跑鞋", " running shoes ")
    .replaceAll("靴子", " boots ")
    .replaceAll("凉鞋", " sandals ")
    .replaceAll("高跟鞋", " high heels ")
    .replaceAll("日常穿", " daily wear ")
    .replaceAll("通勤", " office wear ")
    .replaceAll("休闲", " casual ")
    .replaceAll("极简", " minimalist ")
    .replace(/\s+/gu, " ")
    .trim();
}
