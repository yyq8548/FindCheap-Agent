import type { CanonicalProduct } from "../../contracts/src/index.js";
import { normalizeGtin, normalizeToken } from "./normalize.js";

export type MatchDecision = {
  status: "EXACT" | "NEEDS_CONFIRMATION" | "SIMILAR" | "INSUFFICIENT";
  evidence: string[];
};

export type CandidateProduct = {
  brand: string;
  mpn?: string;
  gtins: string[];
  title: string;
  variantDimensions: Record<string, string>;
  coreSimilarity: number;
};

export function matchProduct(candidate: CandidateProduct, product: CanonicalProduct): MatchDecision {
  const canonicalGtins = new Set(product.gtins.map(normalizeGtin));
  const sameGtin = candidate.gtins.some((gtin) => canonicalGtins.has(normalizeGtin(gtin)));
  const sameMpn = Boolean(
    candidate.mpn &&
      product.manufacturerPartNumber &&
      normalizeToken(candidate.brand) === normalizeToken(product.brand) &&
      normalizeToken(candidate.mpn) === normalizeToken(product.manufacturerPartNumber)
  );

  if (!sameGtin && !sameMpn) {
    return candidate.coreSimilarity >= 0.75
      ? { status: "SIMILAR", evidence: ["core attributes similar; identity absent"] }
      : { status: "INSUFFICIENT", evidence: ["identity absent"] };
  }

  const variantIssues = Object.entries(product.variantDimensions).flatMap(([key, value]) => {
    const candidateValue = candidate.variantDimensions[key];
    if (candidateValue === undefined) return [`variant missing: ${key}`];
    return candidateValue === value ? [] : [`variant conflict: ${key}`];
  });

  return variantIssues.length === 0
    ? { status: "EXACT", evidence: [sameGtin ? "GTIN exact" : "brand and MPN exact"] }
    : { status: "NEEDS_CONFIRMATION", evidence: variantIssues };
}
