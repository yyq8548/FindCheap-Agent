import {
  evaluateFeature,
  measuredFeatureKinds,
  measuredFeatureValues,
  type FeatureMatchStatus,
  type MeasuredFeatureValue,
  type QuantityKind,
} from "./product-constraint-matcher.js";

type ProductEvidence = {
  title: string;
  description?: string | undefined;
  variantDimensions?: Readonly<Record<string, string>> | undefined;
  evidenceSource?: "PRODUCT" | "FEED";
};

export type MeasuredRequirementEvidence = {
  status: FeatureMatchStatus | "CONFLICT";
  source: "VARIANT" | "PRODUCT" | "FEED" | "MISSING";
  observed: string;
};

/** Select one authoritative fact per measured attribute. A selected variant
 * overrides the title and shared copy for that attribute; otherwise current
 * product title evidence overrides bounded description evidence. */
export function measuredRequirementEvidence(
  product: ProductEvidence,
  requirement: string,
): MeasuredRequirementEvidence | undefined {
  const requestedKinds = measuredFeatureKinds(requirement, true);
  const requestedValues = measuredFeatureValues(requirement, true);
  if (requestedKinds.length === 0) return undefined;

  const dimensions = Object.entries(product.variantDimensions ?? {});
  const currentDescription = currentProductDescription(product.description ?? "");
  const observed: string[] = [];
  let selectedVariantUsed = false;
  let productEvidenceUsed = false;
  let selectedVariantConflict = false;

  for (const kind of requestedKinds) {
    const requestedForKind = requestedValues.filter((candidate) => kindsCompatible(kind, candidate.kind));
    const selected = dimensions.filter(([name, value]) => measuredFeatureValues(`${name} ${value}`)
      .some((candidate) => requestedForKind.some((requested) => measurementApplies(requested, candidate, name, product.title))));
    if (selected.length > 0) {
      observed.push(...selected.map(([name, value]) => selectedEvidence(name, value, requestedForKind, product.title)));
      selectedVariantUsed = true;
      const values = selected.flatMap(([name, value]) => measuredFeatureValues(`${name} ${value}`)
        .filter((candidate) => requestedForKind.some((requested) => measurementApplies(requested, candidate, name, product.title)))
        .map((candidate) => candidate.value));
      if (new Set(values).size > 1) selectedVariantConflict = true;
      continue;
    }
    if (!isUnboundMeasuredOptionList(product.title, kind)
      && measuredFeatureKinds(product.title).some((candidate) => kindsCompatible(kind, candidate))) {
      observed.push(product.title);
      productEvidenceUsed = true;
      continue;
    }
    const descriptionEvidence = descriptionClausesForKind(currentDescription, kind);
    if (descriptionEvidence !== "") {
      observed.push(descriptionEvidence);
      productEvidenceUsed = true;
    }
  }

  const evidence = [...new Set(observed)].join(" ");
  return {
    status: selectedVariantConflict ? "CONFLICT"
      : evidence === "" ? "UNKNOWN" : evaluateFeature(evidence, requirement),
    source: selectedVariantUsed ? "VARIANT"
      : productEvidenceUsed ? product.evidenceSource ?? "PRODUCT" : "MISSING",
    observed: evidence,
  };
}

function currentProductDescription(value: string): string {
  return value.split(/[.;!?。；！？\n]/u)
    .filter((clause) => !/\b(?:also\s+available|available\s+separately|other|another|alternative|compare(?:d)?\s+(?:with|to)|guide|tutorial)\b|另售|另有|其他|另一|对比|教程|指南/iu.test(clause))
    .join(". ");
}

function descriptionClausesForKind(value: string, kind: QuantityKind): string {
  return value.split(/[.;!?。；！？\n]/u)
    .filter((clause) => !isUnboundMeasuredOptionList(clause, kind))
    .filter((clause) => measuredFeatureKinds(clause).some((candidate) => kindsCompatible(kind, candidate)))
    .join(". ");
}

function isUnboundMeasuredOptionList(value: string, kind: QuantityKind): boolean {
  const measuredValues = measuredFeatureValues(value).filter((candidate) => kindsCompatible(kind, candidate.kind));
  return measuredValues.length > 1
    && /\b(?:available|options?|choose|selection)\b|\bor\b|(?:^|\s)\/(?:\s|$)|可选|可提供|另有/iu.test(value);
}

function measurementApplies(
  requested: MeasuredFeatureValue,
  candidate: MeasuredFeatureValue,
  fieldName: string,
  productTitle: string,
): boolean {
  if (!kindsCompatible(requested.kind, candidate.kind)) return false;
  if (requested.kind !== "LENGTH" || requested.displayContext !== true) return true;
  if (candidate.displayContext === true) return true;
  if (/\b(?:width|height|depth|length|dimension|wide|tall)\b|宽|高|深|长/iu.test(fieldName)) return false;
  return /\bsize\b|尺寸/iu.test(fieldName)
    && /\b(?:display|screen|monitor|tv|television|laptop|notebook|macbook|tablet|ipad)\b|屏幕|显示器/iu.test(productTitle);
}

function selectedEvidence(
  name: string,
  value: string,
  requested: readonly MeasuredFeatureValue[],
  productTitle: string,
): string {
  const ambiguousDisplaySize = requested.some((entry) => entry.kind === "LENGTH" && entry.displayContext === true)
    && /\bsize\b|尺寸/iu.test(name);
  return ambiguousDisplaySize ? `${productTitle} ${name} ${value}` : `${name} ${value}`;
}

function kindsCompatible(left: QuantityKind, right: QuantityKind): boolean {
  if (left === right) return true;
  if ((left === "MEMORY" || left === "STORAGE") && right === "DATA") return true;
  return left === "DATA" && (right === "MEMORY" || right === "STORAGE");
}
