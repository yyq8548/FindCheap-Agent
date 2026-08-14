import { z } from "zod";
import type { CanonicalProduct } from "../../contracts/src/index.js";
import { normalizeGtin, normalizeToken } from "./normalize.js";

export type MatchDecision = {
  status: "EXACT" | "NEEDS_CONFIRMATION" | "SIMILAR" | "INSUFFICIENT";
  evidence: string[];
};

const CandidateGtinSchema = z.string().transform((value, context) => {
  const normalized = normalizeGtin(value);
  if (!normalized) {
    context.addIssue({ code: "custom", message: "GTIN must contain 8 to 14 digits with only spaces or hyphens as separators" });
    return z.NEVER;
  }
  return normalized;
});

export const CandidateProductSchema = z
  .object({
    brand: z.string().min(1).optional(),
    mpn: z.string().min(1).optional(),
    gtins: z.array(CandidateGtinSchema),
    title: z.string().min(1),
    variantDimensions: z.record(z.string(), z.string()),
    coreSimilarity: z.number().min(0).max(1)
  })
  .strict();

export type CandidateProduct = z.input<typeof CandidateProductSchema>;

export function matchProduct(candidate: CandidateProduct, product: CanonicalProduct): MatchDecision {
  const parsedCandidate = CandidateProductSchema.parse(candidate);
  const canonicalGtins = new Set(product.gtins.flatMap((gtin) => normalizeGtin(gtin) ?? []));
  const sameGtin = parsedCandidate.gtins.some((gtin) => canonicalGtins.has(gtin));
  const normalizedBrand = parsedCandidate.brand ? normalizeToken(parsedCandidate.brand) : "";
  const normalizedMpn = parsedCandidate.mpn ? normalizeToken(parsedCandidate.mpn) : "";
  const normalizedCanonicalBrand = normalizeToken(product.brand);
  const normalizedCanonicalMpn = product.manufacturerPartNumber
    ? normalizeToken(product.manufacturerPartNumber)
    : "";
  const sameMpn = Boolean(
    normalizedBrand &&
      normalizedMpn &&
      normalizedCanonicalBrand &&
      normalizedCanonicalMpn &&
      normalizedBrand === normalizedCanonicalBrand &&
      normalizedMpn === normalizedCanonicalMpn
  );

  if (!sameGtin && !sameMpn) {
    return parsedCandidate.coreSimilarity >= 0.75
      ? { status: "SIMILAR", evidence: ["core attributes similar; identity absent"] }
      : { status: "INSUFFICIENT", evidence: ["identity absent"] };
  }

  const variantIssues = Object.entries(product.variantDimensions).flatMap(([key, value]) => {
    const candidateValue = parsedCandidate.variantDimensions[key];
    if (candidateValue === undefined) return [`variant missing: ${key}`];
    return candidateValue === value ? [] : [`variant conflict: ${key}`];
  });

  return variantIssues.length === 0
    ? { status: "EXACT", evidence: [sameGtin ? "GTIN exact" : "brand and MPN exact"] }
    : { status: "NEEDS_CONFIRMATION", evidence: variantIssues };
}
