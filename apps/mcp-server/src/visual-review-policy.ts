import type { CodexVisualVerdict } from "./search-products.js";
import { isVisualAttributeOccluded, normalizeVisualEvidence, visualColorwayTerms, type VisualMatchGroup, type VisualProductInput } from "./visual-product-discovery.js";

/** Created only after server validation of reference evidence and a visual verdict. */
export type VisualReviewAssessment = {
  group: VisualMatchGroup;
  structuralMatchCount: number;
  matchCount: number;
};

type EvidencePair = CodexVisualVerdict["matches"][number];

export function assessVisualVerdict(
  verdict: CodexVisualVerdict,
  visual: VisualProductInput | undefined,
  allowAlternatives: boolean
): (VisualReviewAssessment & { matches: EvidencePair[]; conflicts: EvidencePair[]; score: number }) | undefined {
  const matches = [...new Map(verdict.matches.filter((entry) => admissibleReference(entry, visual))
    .map((entry) => [entry.attribute, entry])).values()];
  const conflicts = verdict.conflicts.filter((entry) => admissibleReference(entry, visual));
  const structural = structuralAttributes(visual?.productType);
  const structuralMatchCount = matches.filter((entry) => structural.has(entry.attribute)).length;
  const colorwayOnlyConflict = conflicts.length > 0 && structuralMatchCount >= 3 &&
    conflicts.every((entry) => entry.attribute === "COLOR" || entry.attribute === "PATTERN");
  if (conflicts.length > 0 && !colorwayOnlyConflict) return undefined;
  // An unsupported conflict is uncertainty, not proof that the candidate differs.
  const classification = verdict.classification === "CONFLICT" && verdict.conflicts.length > conflicts.length && conflicts.length === 0
    ? "HIGHLY_SIMILAR" : verdict.classification;
  if (classification === "CONFLICT" && !colorwayOnlyConflict) return undefined;
  const matchCount = matches.length;
  const group: VisualMatchGroup = !colorwayOnlyConflict && classification === "POSSIBLE_SAME_ITEM" &&
    matchCount >= 3 && structuralMatchCount >= 2 && (visual === undefined || hasDiscriminatingMatch(matches, visual))
    ? "POSSIBLE_SAME_ITEM"
    : (colorwayOnlyConflict || classification === "POSSIBLE_SAME_ITEM" || classification === "HIGHLY_SIMILAR") &&
      matchCount >= 2 && structuralMatchCount >= 1
      ? "HIGHLY_SIMILAR" : "SAME_STYLE";
  if (matchCount < 2 || structuralMatchCount < 1 || (group === "SAME_STYLE" && !allowAlternatives)) return undefined;
  return {
    group, matches, conflicts, structuralMatchCount, matchCount,
    score: visualReviewScore({ group, structuralMatchCount, matchCount })
  };
}

function hasDiscriminatingMatch(matches: EvidencePair[], visual: VisualProductInput): boolean {
  const evidence = normalizeVisualEvidence(visual).filter((entry) => entry.visibility === "VISIBLE" && !entry.inferred);
  return matches.some((pair) => {
    const key = canonicalAttribute(pair.attribute);
    if (key === "MODEL_STYLE_NUMBER" || key === "VISIBLE_TEXT") return true;
    if (!["DETAIL", "PATTERN", "PRINT"].includes(key)) return false;
    const original = evidence.filter((entry) => canonicalAttribute(entry.attribute) === key).map((entry) => entry.value);
    // A fresh detail must be explicitly observed. Existing generic reference
    // evidence cannot acquire specificity solely from a model's rewritten text.
    const values = original.length > 0 ? original : pair.referenceObservation === undefined ? [] : [pair.referenceEvidence];
    return values.some((value) => {
      const text = value.normalize("NFKC").toLocaleLowerCase("en-US");
      if (key === "PATTERN") {
        const terms = visualColorwayTerms({ ...visual, colors: [], patterns: [value], observations: [], inferences: [], printDescription: undefined });
        return terms.patterns.length > 0 && (terms.colors.length >= 2 ||
          (terms.colors.length >= 1 && /\b(?:bouquets?|branches|leaves|paisley|polka|windowpane|houndstooth)\b/u.test(text)));
      }
      if (key === "PRINT") return /\b(?:asymmetr\w*|border|center|hem|bodice|chest|shoulder)\b/u.test(text) && text.split(/\s+/u).length >= 4;
      return /\b(?:lace|scallop\w*|cut[ -]?outs?|embroider\w*|pintucks?|piping|pleats?|ruffles?|camera|clasps?|buckles?)\b/u.test(text) &&
        text.split(/\s+/u).length >= 3;
    });
  });
}

export function hasAdmissibleVisualConflict(verdict: CodexVisualVerdict, visual: VisualProductInput): boolean {
  const conflicts = verdict.conflicts.filter((entry) => admissibleReference(entry, visual));
  if (conflicts.length === 0) return false;
  const structural = structuralAttributes(visual.productType);
  const matched = new Set(verdict.matches.filter((entry) => admissibleReference(entry, visual)).map((entry) => entry.attribute));
  return !conflicts.every((entry) => entry.attribute === "COLOR" || entry.attribute === "PATTERN") ||
    [...matched].filter((attribute) => structural.has(attribute)).length < 3;
}

/** Deterministic grade and evidence strength; never a model-provided numeric score. */
export function visualReviewScore(review: VisualReviewAssessment | undefined): number {
  if (review === undefined) return 0;
  const { group, structuralMatchCount, matchCount } = review;
  if (![structuralMatchCount, matchCount].every((value) => Number.isInteger(value) && value >= 0 && value <= 16) ||
    structuralMatchCount > matchCount) return 0;
  if (group === "POSSIBLE_SAME_ITEM" && (matchCount < 3 || structuralMatchCount < 2)) return 0;
  if (group === "HIGHLY_SIMILAR" && (matchCount < 2 || structuralMatchCount < 1)) return 0;
  const grade = group === "POSSIBLE_SAME_ITEM" ? 3 : group === "HIGHLY_SIMILAR" ? 2 : group === "SAME_STYLE" ? 1 : 0;
  return grade === 0 ? 0 : grade * 1_000 + structuralMatchCount * 20 + matchCount;
}

function admissibleReference(pair: EvidencePair, visual: VisualProductInput | undefined): boolean {
  if (pair.referenceObservation !== undefined && (pair.referenceObservation.visibility !== "VISIBLE" ||
    pair.referenceObservation.confidence < 0.8)) return false;
  // Kept for direct legacy library callers; MCP always binds the immutable reference.
  if (visual === undefined) return true;
  const key = canonicalAttribute(pair.attribute);
  if (key === "MATERIAL" || isVisualAttributeOccluded(visual, pair.attribute)) return false;
  // Inspect raw observations too: normalization must not erase uncertainty via aliases.
  const raw = [...(visual.observations ?? []).map((entry) => ({ ...entry, inferred: false })),
    ...(visual.inferences ?? []).map((entry) => ({ ...entry, inferred: true }))]
    .filter((entry) => canonicalAttribute(entry.attribute) === key);
  // Unknown structured attributes normalize to DETAIL for retrieval. Require
  // original attribute ownership before using that fallback in final review.
  const entries = normalizeVisualEvidence(visual).filter((entry) => canonicalAttribute(entry.attribute) === key &&
    ((entry.source !== "OBSERVATION" && entry.source !== "INFERENCE") || raw.some((original) => original.value === entry.value)));
  if (raw.some((entry) => entry.inferred || entry.confidence < 0.8 ||
    (entry.visibility !== undefined && entry.visibility !== "VISIBLE"))) return false;
  if (entries.some((entry) => entry.visibility !== "VISIBLE" || entry.inferred)) return false;
  if (raw.length > 0 || entries.some((entry) => entry.source !== "HINT")) return true;
  if (key === "PRODUCT_TYPE" && visual.productType !== undefined) return true;
  if (key === "MODEL_STYLE_NUMBER" && visual.modelOrStyleNumber !== undefined) return true;
  if (key === "VISIBLE_TEXT" && visual.logoText !== undefined) return true;
  // A second look may add a genuinely new attribute, never overwrite known uncertainty.
  return pair.referenceObservation?.visibility === "VISIBLE" && pair.referenceObservation.confidence >= 0.8;
}

function canonicalAttribute(value: string): string {
  const key = value.normalize("NFKC").trim().toUpperCase().replace(/[\s-]+/gu, "_");
  const aliases: Record<string, string> = {
    DISTINCTIVE_DETAIL: "DETAIL", DISTINCTIVE_DETAILS: "DETAIL", PRINT_PLACEMENT: "PRINT", PRINT_DESCRIPTION: "PRINT",
    SLEEVE_TYPE: "SLEEVE", SLEEVES: "SLEEVE", NECK: "NECKLINE", SHAPE: "SILHOUETTE",
    COLORS: "COLOR", COLOUR: "COLOR", MATERIALS: "MATERIAL", PATTERNS: "PATTERN"
  };
  return aliases[key] ?? key;
}

function structuralAttributes(productType: string | undefined): Set<EvidencePair["attribute"]> {
  const general: EvidencePair["attribute"][] = ["SILHOUETTE", "CLOSURE", "PRINT_PLACEMENT", "DISTINCTIVE_DETAIL"];
  if (productType === undefined || /\b(?:dress|dresses|blouse|shirt|top|skirt|coat|jacket|pants|trousers|jeans|sweater|cardigan|gown|jumpsuit|romper|hoodie)\b|裙|衫|衣|裤/iu.test(productType)) {
    return new Set([...general, "NECKLINE", "SLEEVE", "COLLAR", "WAIST", "HEM", "LENGTH"]);
  }
  if (/\b(?:laptop|notebook|computer|phone|tablet|camera|monitor|television|console|headphones|earbuds|watch)\b|电脑|手机|相机|耳机|手表|电视/iu.test(productType)) {
    return new Set([...general, "VISIBLE_TEXT", "MODEL_STYLE_NUMBER"]);
  }
  return new Set(general);
}
