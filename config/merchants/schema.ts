import { z } from "zod";

export const MerchantCandidateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    segment: z.enum(["general", "specialist", "promotion-heavy"]),
    auditState: z.enum(["required", "in_review", "approved", "rejected"]),
    legalReview: z.enum(["not_started", "approved", "rejected"]).default("not_started"),
    affiliateStatus: z
      .enum(["not_applied", "pending", "approved", "normal_link_only"])
      .default("not_applied"),
    provenSource: z.enum(["feed", "api", "jsonld", "http", "crawl4ai"]).optional(),
    allowedHosts: z.array(z.string().min(1)).default([]),
    identityCompleteness: z.number().min(0).max(1).default(0),
    weightedScore: z.number().min(0).max(100).default(0),
    enabled: z.boolean().default(false)
  })
  .strict();

export const MerchantCatalogSchema = z
  .object({
    version: z.literal(1),
    candidates: z.array(MerchantCandidateSchema)
  })
  .strict();

export type MerchantCandidate = z.infer<typeof MerchantCandidateSchema>;
export type MerchantCatalog = z.infer<typeof MerchantCatalogSchema>;

type ScoreDimensions = {
  data: number;
  identity: number;
  priceAndZip: number;
  legal: number;
  stability: number;
  coverage: number;
  maintenance: number;
};

export function selectForBuild(catalog: MerchantCatalog): MerchantCandidate[] {
  return catalog.candidates.filter(
    (merchant) =>
      merchant.auditState === "approved" &&
      merchant.legalReview === "approved" &&
      merchant.provenSource !== undefined &&
      merchant.allowedHosts.length > 0 &&
      merchant.identityCompleteness >= 0.9 &&
      merchant.weightedScore >= 70
  );
}

export function weightedScore(score: ScoreDimensions): number {
  return (
    score.data * 25 +
    score.identity * 20 +
    score.priceAndZip * 15 +
    score.legal * 15 +
    score.stability * 10 +
    score.coverage * 10 +
    score.maintenance * 5
  );
}
