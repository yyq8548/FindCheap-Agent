import { namedProductIdentity, normalizeNamedProductIdentity } from "./named-product-identity.js";

/** Bounded merchant-claim normalization, never ingredient-to-efficacy inference. */
const functions = [
  { name: "anti-dandruff", request: /^(?:anti[- ]?dandruff(?: shampoo)?|dandruff control|去屑|去头屑|有头屑)$/iu,
    evidence: /\b(?:anti[- ]?dandruff|dandruff control|(?:helps? (?:to )?)?(?:reduce|reduces|control|controls|treat|treats) dandruff)\b|去(?:头)?屑/giu },
  { name: "oily scalp", request: /^(?:(?:suitable |ideal |recommended )?for )?(?:oily scalp|oily hair and scalp)$|^(?:油性头皮|头皮偏油|偏油|适合油性头皮)$/iu,
    evidence: /\b(?:(?:suitable |ideal |recommended )?for )?(?:oily scalp|oily hair and scalp)\b|(?:适合)?油性头皮/giu },
  { name: "moisturizing", request: /^(?:moisturi[sz](?:ing|ation)|hydrat(?:ing|ion)|(?:improve|reduce|relieve|alleviate) (?:hair )?dryness|dryness relief|保湿|补水|补水保湿|(?:改善|缓解|减少)(?:头发)?干燥)$/iu,
    evidence: /\b(?:moisturi[sz](?:e[sd]?|ing|ation)|hydrat(?:e[sd]?|ing|ion)|(?:restore[sd]?|replenish(?:es|ing)?) (?:hair )?moisture|(?:reduc(?:e[sd]?|ing)|address(?:es|ed|ing)?|alleviat(?:e[sd]?|ing)|reliev(?:e[sd]?|ing)) (?:hair )?dryness)\b|补水|保湿|(?:改善|缓解|减少)(?:头发)?干燥/giu },
  { name: "dry hair", request: /^(?:(?:suitable |ideal |recommended |designed )?for )?dry hair$|^(?:适合|适用|适用于)?(?:干性发质|干性头发)$/iu,
    evidence: /\b(?:(?:suitable |ideal |recommended |designed )?for )?dry hair\b|(?:适合|适用|适用于)?(?:干性发质|干性头发)/giu },
  { name: "anti-frizz", request: /^(?:anti[- ]?frizz|frizz (?:control|reduction)|(?:smooth|tame|control)(?:s|ing)? frizz|抗毛躁|抚平毛躁|改善毛躁|顺滑)$/iu,
    evidence: /\b(?:anti[- ]?frizz|frizz (?:control|reduction)|(?:smooth(?:s|ing)?|tam(?:e[sd]?|ing)|reduc(?:e[sd]?|ing)|control(?:s|ling)?|fight(?:s|ing)?) frizz)\b|(?:抚平|改善|减少|抗|去)毛躁/giu },
  { name: "fine hair", request: /^(?:(?:suitable |ideal |recommended )?for )?(?:fine(?: to medium)? hair)$|^(?:适合)?细软(?:发质|头发|发)?$/iu,
    evidence: /\b(?:(?:suitable |ideal |recommended |designed )?for )?fine(?:[- ]to[- ]medium)? hair\b|(?:适合|适用|适用于)?细软(?:发质|头发|发)?/giu },
  { name: "cosplay", request: /^(?:for )?(?:cosplay|role[- ]?play(?:ing)?)(?: use)?$|^(?:用于)?角色扮演$/iu,
    evidence: /\b(?:cosplay|role[- ]?play(?:ing)?)\b|角色扮演/giu }
] as const;

export type FunctionalAttribute = typeof functions[number]["name"];
export type FunctionalClaim = {
  attribute: FunctionalAttribute;
  status: "MATCHED" | "CONTRADICTED" | "UNKNOWN";
  scope: "PRODUCT" | "OTHER_PRODUCT" | "INGREDIENT" | "CONDITIONAL";
  /** Offsets in the original field, not in a model-generated summary. */
  start: number;
  end: number;
  quote: string;
};
type ProductContext = { productTitle?: string | undefined; productType?: string | undefined };

export function functionalRequirement(value: string): FunctionalAttribute | undefined {
  return functions.find(entry => entry.request.test(value.normalize("NFKC").trim()))?.name;
}

/** Only split known functional conjunctions, never an arbitrary identity/model. */
function functionalParts(value: string): FunctionalAttribute[] | undefined {
  const direct = functionalRequirement(value);
  if (direct !== undefined) return [direct];
  if (/^(?:改善|缓解|减少)(?:头发)?干燥(?:和|及|、)?毛躁$/u.test(value.normalize("NFKC").trim())) return ["moisturizing", "anti-frizz"];
  const parts = value.split(/\s+and\s+|\s*&\s*|以及|并且|和|且/iu).map(part => functionalRequirement(part));
  return parts.length > 1 && parts.length <= 4 && parts.every(part => part !== undefined)
    ? [...new Set(parts)] as FunctionalAttribute[] : undefined;
}

export function functionalFeatureEvidence(text: string, feature: string, context: ProductContext = {}) {
  const attributes = functionalParts(feature);
  if (attributes === undefined) return undefined;
  const evidence: FunctionalClaim[] = [];
  const conflictingAttributes: FunctionalAttribute[] = [];
  const statuses = attributes.map(attribute => {
    const entry = functions.find(item => item.name === attribute)!;
    let matched = false;
    let contradicted = false;
    for (const match of claimMatches(text, entry)) {
      const start = match.index!;
      const end = start + match[0].length;
      const before = text.slice(Math.max(0, start - 180), start).split(/[.;!?。；！？\n]|\b(?:but|however)\b/iu).at(-1)!;
      const after = text.slice(end, end + 180).split(/[.;!?。；！？\n]|\b(?:but|however)\b/iu)[0]!;
      const scope = attribute === "cosplay" ? cosplayClaimScope(before, match[0], after, context) : claimScope(before, match[0], after, context);
      const negated = isNegated(attribute === "cosplay" ? before + match[0] : before, after);
      const relevantAudience = (attribute !== "oily scalp" && attribute !== "fine hair" && attribute !== "dry hair") ||
        /\bfor\b|适合|适用/iu.test(match[0]) || /^\s*(?:shampoo|专用|适用)/iu.test(after);
      const status = scope !== "PRODUCT" || !relevantAudience ? "UNKNOWN"
        : negated ? "CONTRADICTED" : "MATCHED";
      matched ||= status === "MATCHED";
      contradicted ||= status === "CONTRADICTED";
      if (!evidence.some(entry => entry.attribute === attribute && entry.status === status && entry.scope === scope)) {
        const quoteStart = Math.max(start - before.length, start - 90);
        const quoteEnd = Math.min(end + after.length, quoteStart + 240);
        evidence.push({ attribute, status, scope, start: quoteStart, end: quoteEnd, quote: text.slice(quoteStart, quoteEnd) });
        const priority = { CONTRADICTED: 0, MATCHED: 1, UNKNOWN: 2 };
        evidence.sort((a, b) => priority[a.status] - priority[b.status]);
        evidence.splice(8);
      }
    }
    if (matched && contradicted) conflictingAttributes.push(attribute);
    return contradicted ? "CONTRADICTED" : matched ? "MATCHED" : "UNKNOWN";
  });
  const status = statuses.includes("CONTRADICTED") ? "CONTRADICTED"
    : statuses.every(status => status === "MATCHED") ? "MATCHED" : "UNKNOWN";
  return { status, evidence, conflictingAttributes } as const;
}

export function functionalFeatureStatus(text: string, feature: string): "MATCHED" | "CONTRADICTED" | "UNKNOWN" | undefined {
  return functionalFeatureEvidence(text, feature)?.status;
}

/** Only explicitly stated, reviewed functional/use claims become necessary conditions. */
export function requiredPrimaryUseFeatures(primaryUse?: string): string[] {
  return primaryUse === undefined ? [] : functionalParts(primaryUse) ?? [];
}

function claimMatches(text: string, entry: typeof functions[number]): Array<{ 0: string; index: number }> {
  const matches: Array<{ 0: string; index: number }> = [...text.matchAll(new RegExp(entry.evidence))];
  if (entry.name === "cosplay") {
    // A complete reviewed character-wig identity supports use, never licensing.
    // Keep all anchors in one source clause; never assemble them across fields.
    for (const match of text.matchAll(/[^.;!?。；！？\n]+/gu)) {
      if (namedProductIdentity(match[0]) !== undefined && /\bwigs?\b/iu.test(normalizeNamedProductIdentity(match[0]))) matches.push(match);
    }
  }
  return matches;
}

function cosplayClaimScope(before: string, claim: string, after: string, context: ProductContext): FunctionalClaim["scope"] {
  const clause = before + claim + after;
  if (/\b(?:guide|tutorial|article|blog|other|another|separately)\b|教程|指南|另一|另售/iu.test(clause)) return "OTHER_PRODUCT";
  const scope = claimScope(before + claim, "", after, context);
  if (scope !== "PRODUCT") return scope;
  if (namedProductIdentity(claim) !== undefined && /\bwigs?\b/iu.test(normalizeNamedProductIdentity(claim))) return "PRODUCT";
  return /\b(?:for|ideal for|suitable for|designed for)\s*$/iu.test(before) || /适合|适用|用于/u.test(before) ||
    /^\s*(?:wigs?|costumes?)\b|^\s*(?:假发|服装)/iu.test(after) ? "PRODUCT" : "OTHER_PRODUCT";
}

function isNegated(before: string, after: string): boolean {
  const scopedBefore = before
    .replace(/\bnot only\b/giu, "")
    .replace(/\b(?:no|without) (?:any )?(?:sulfates?|silicones?|parabens?|fragrances?)(?:\s+(?:or|and)\s+(?:sulfates?|silicones?|parabens?|fragrances?))*/giu, "");
  return /\b(?:not|no|never|without|unsuitable|avoid|isn['’]t|doesn['’]t|can['’]t|cannot)\b|不(?:适合|适用|推荐|具备|具有|含)?|非/iu.test(scopedBefore) ||
    /^\s*(?:(?:is|are|does|do|was|were)\s+)?(?:not|never|unavailable|unsupported)\b|^\s*(?:\w+\s+){0,3}(?:sold separately|not included)\b|^(?:另售|不适用)/iu.test(after);
}

function hairProductKinds(text: string): string[] {
  const translated: Record<string, string> = { 洗发水: "shampoo", 洗发露: "shampoo", 护发素: "conditioner", 发膜: "mask", 精华: "serum" };
  return [...text.matchAll(/\b(?:shampoo|conditioner|mask|serum)\b|洗发水|洗发露|护发素|发膜|精华/giu)]
    .map(match => translated[match[0]] ?? match[0].toLowerCase());
}

function claimScope(before: string, claim: string, after: string, context: ProductContext): FunctionalClaim["scope"] {
  if (/\b(?:guide|tutorial|article|blog)\b|教程|指南/iu.test(before + after)) return "OTHER_PRODUCT";
  if (/\b(?:another|other|different|separate|matching|companion)\s+(?:[\p{L}\p{N}-]+\s+){0,4}(?:shampoo|conditioner|mask|serum)\b|(?:另一|其他|别的|配套的?)(?:款)?(?:洗发水|洗发露|护发素|发膜|精华)/iu.test(before + claim + after) ||
    /\b(?:try|use|choose|switch to|check out)\s+(?:[\p{L}\p{N}-]+\s+){0,4}(?:shampoo|conditioner|mask|serum)\b|(?:试试|选用|选择)(?:[^，。；]{0,20})(?:洗发水|洗发露|护发素|发膜|精华)/iu.test(after)) return "OTHER_PRODUCT";
  if (/\b(?:when (?:used|paired)|use[sd]? (?:it )?(?:together )?with|pair(?:ed)? with|combined with|may|might|could)\b|搭配|配合使用|可能/iu.test(before) ||
    /\b(?:only when|when (?:used|paired)|if used|may|might|could)\b|搭配|配合使用|可能/iu.test(after)) return "CONDITIONAL";
  const productKinds = [...new Set(hairProductKinds(context.productTitle ?? ""))];
  const expectedKinds = productKinds.length > 0 ? productKinds : hairProductKinds(context.productType ?? "");
  const followingKind = /^\s*(?:(?:hair|daily|gentle)\s+){0,2}(shampoo|conditioner|mask|serum)\b/iu.exec(after)?.[1]?.toLowerCase();
  const subject = followingKind ?? hairProductKinds(before).at(-1);
  if (subject !== undefined && expectedKinds.length > 0 &&
    (expectedKinds.length > 1 || !expectedKinds.includes(subject))) return "OTHER_PRODUCT";
  // "Contains hydrating X" attributes the adjective to X, even when X is an
  // unfamiliar ingredient. It does not establish a claim about this product.
  if (/\b(?:contains?|containing|with|infused with|ingredients?\s*:)\s*$/iu.test(before) || /(?:含有?|添加|成分[:：])\s*$/u.test(before)) {
    return followingKind === undefined ? "INGREDIENT" : "OTHER_PRODUCT";
  }
  const lastProduct = [...before.matchAll(/\b(?:shampoo|conditioner|mask|serum)\b|洗发水|洗发露|护发素/giu)].at(-1)?.index ?? -1;
  const lastIngredient = [...before.matchAll(/\b(?:oil|butter|extract|ingredient|glycerin|glycerine|panthenol|hyaluronic acid|aloe vera|ceramides?|niacinamide|squalane)\b|成分|植物油|提取物|透明质酸|芦荟/giu)].at(-1)?.index ?? -1;
  if (lastIngredient > lastProduct ||
    /^\s+(?:(?:(?:coconut|moringa|argan|shea|aloe|olive)\s+)?(?:oil|butter|extract)|hyaluronic acid|aloe vera|ceramides?|niacinamide|squalane)\b/iu.test(after)) return "INGREDIENT";
  if (/\bingredients?\s*:[^.;]*$/iu.test(before) && !/\b(?:shampoo|conditioner)\b/iu.test(claim)) return "INGREDIENT";
  return "PRODUCT";
}

export function functionalQueryFeatures(features: readonly string[]): string[] {
  const attributes = features.flatMap(value => functionalParts(value) ?? []);
  const known = functions.filter(entry => attributes.includes(entry.name));
  // Retrieval is deliberately broader than verification. Do not append unknown
  // requirements or primary-use prose to an already discriminating function.
  if (known.length > 0) return [known[0]!.name];
  const compact = features.map(value => value.normalize("NFKC").trim()
    .replace(/^(?:(?:suitable|safe|ideal|recommended) for )?(?:color[- ]treated hair|color[- ]safe)(?: shampoo)?$|^染发(?:适用|护理)$/iu, "color-safe")
    .replace(/^(?:damaged hair repair|repair (?:for )?damaged hair|hair repair|受损发质修护)$/iu, "repair")
    .replace(/^(?:(?:suitable|ideal|recommended) for|with)\s+/iu, ""))
    .filter(value => value.length > 0 && value.length <= 80 && value.split(/\s+/u).length <= 4);
  let words = 0;
  return [...new Set(compact)].filter(value => {
    words += value.split(/\s+/u).length;
    return words <= 6;
  }).slice(0, 2);
}
