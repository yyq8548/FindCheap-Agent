import type { CanonicalProduct } from "../../contracts/src/index.js";
import { matchProduct, type CandidateProduct, type MatchDecision } from "./match.js";
import { normalizeGtin, normalizeToken } from "./normalize.js";

export type PromotionCandidate = CandidateProduct & { coreSimilarity: number };

export type ProductPromotionDecision =
  | {
    status: "EXACT";
    canonicalProductId: string;
    method: "GTIN" | "BRAND_MPN";
    fields: { gtin: string } | { brand: string; manufacturerPartNumber: string };
    candidateProductIds: string[];
  }
  | {
    status: "AMBIGUOUS" | "SIMILAR" | "NEEDS_CLARIFICATION" | "NO_MATCH";
    reason: string;
    questions: string[];
    candidateProductIds: string[];
  };

type Evaluated = { product: CanonicalProduct; match: MatchDecision };

/**
 * Pure fail-closed selector. It delegates identity/variant comparison to matchProduct;
 * it never creates a canonical product and never treats semantic similarity as exact.
 */
export function decideProductPromotion(
  candidate: PromotionCandidate,
  products: readonly CanonicalProduct[]
): ProductPromotionDecision {
  const evaluated: Evaluated[] = [...products]
    .sort((left, right) => left.productId.localeCompare(right.productId, "en"))
    .map((product) => ({ product, match: matchProduct(candidate, product) }));
  const exact = evaluated.filter(({ match }) => match.status === "EXACT");

  if (exact.length > 1) {
    return {
      status: "AMBIGUOUS",
      reason: "multiple canonical products satisfy deterministic identity and required variants",
      questions: ["Select the independently verified canonical product."],
      candidateProductIds: exact.map(({ product }) => product.productId)
    };
  }
  if (exact.length === 1) {
    const product = exact[0]!.product;
    const canonicalGtins = new Set(product.gtins.flatMap((value) => normalizeGtin(value) ?? []));
    const gtin = candidate.gtins
      .map(normalizeGtin)
      .find((value): value is string => value !== undefined && canonicalGtins.has(value));
    if (gtin !== undefined) {
      return {
        status: "EXACT",
        canonicalProductId: product.productId,
        method: "GTIN",
        fields: { gtin },
        candidateProductIds: [product.productId]
      };
    }
    if (
      candidate.brand !== undefined && candidate.mpn !== undefined &&
      product.manufacturerPartNumber !== undefined &&
      normalizeToken(candidate.brand) === normalizeToken(product.brand) &&
      normalizeToken(candidate.mpn) === normalizeToken(product.manufacturerPartNumber)
    ) {
      return {
        status: "EXACT",
        canonicalProductId: product.productId,
        method: "BRAND_MPN",
        fields: {
          brand: product.brand,
          manufacturerPartNumber: product.manufacturerPartNumber
        },
        candidateProductIds: [product.productId]
      };
    }
    throw new Error("exact match lacks deterministic identity evidence");
  }

  const needsClarification = evaluated.filter(({ match }) => match.status === "NEEDS_CONFIRMATION");
  if (needsClarification.length > 0) {
    return {
      status: "NEEDS_CLARIFICATION",
      reason: "required variant dimensions are missing or conflict",
      questions: [...new Set(needsClarification.flatMap(({ match }) => match.evidence))],
      candidateProductIds: needsClarification.map(({ product }) => product.productId)
    };
  }
  const similar = evaluated.filter(({ match }) => match.status === "SIMILAR");
  if (similar.length > 0) {
    return {
      status: "SIMILAR",
      reason: "core attributes are similar but deterministic identity is absent",
      questions: ["Provide a GTIN or the exact brand and manufacturer part number."],
      candidateProductIds: similar.map(({ product }) => product.productId)
    };
  }
  return {
    status: "NO_MATCH",
    reason: products.length === 0
      ? "no canonical product candidate has a deterministic identity"
      : "canonical candidates do not establish product identity",
    questions: ["Provide a GTIN or the exact brand and manufacturer part number."],
    candidateProductIds: evaluated.map(({ product }) => product.productId)
  };
}
