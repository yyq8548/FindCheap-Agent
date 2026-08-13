import { z } from "zod";

const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export const MerchantHostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .transform((host) => host.toLowerCase())
  .refine((host) => HOST_PATTERN.test(host), "invalid merchant host");

export const AffiliateOriginSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.username === "" && url.password === "" &&
        url.port === "" && url.pathname === "/" && url.search === "" && url.hash === "";
    } catch {
      return false;
    }
  }, "affiliate origin must be credential-free HTTPS on the default port")
  .transform((value) => new URL(value).origin);

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
    allowedHosts: z.array(MerchantHostSchema).max(50).default([]),
    affiliateHosts: z.array(MerchantHostSchema).max(20).default([]),
    affiliateOrigins: z.array(AffiliateOriginSchema).max(20).default([]),
    identityCompleteness: z.number().min(0).max(1).default(0),
    weightedScore: z.number().min(0).max(100).default(0),
    enabled: z.boolean().default(false)
  })
  .strict()
  .superRefine((candidate, context) => {
    const affiliateHosts = new Set(candidate.affiliateHosts);
    candidate.affiliateOrigins.forEach((origin, index) => {
      if (!affiliateHosts.has(new URL(origin).hostname)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["affiliateOrigins", index],
          message: "affiliate origin host must be present in affiliateHosts"
        });
      }
    });
  });

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
