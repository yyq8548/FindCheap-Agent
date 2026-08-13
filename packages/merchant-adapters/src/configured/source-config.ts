import { z } from "zod";

import {
  AffiliateOriginSchema,
  MerchantCandidateSchema,
  MerchantHostSchema,
  selectForBuild,
  type MerchantCandidate
} from "../../../../config/merchants/schema.js";

const MerchantIdSchema = z.string().regex(/^[a-z0-9-]{1,80}$/);
const ResourcePathSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine(
    (path) => path.startsWith("/") && !path.startsWith("//") && !path.includes("\\"),
    "resourcePath must be a bounded absolute path without a host"
  );
const TtlSchema = z.number().int().min(30).max(604_800);

const AffiliateConfigSchema = z
  .object({
    template: z.string().min(1).max(2_048),
    affiliateHosts: z.array(MerchantHostSchema).min(1).max(20),
    affiliateOrigins: z.array(AffiliateOriginSchema).min(1).max(20)
  })
  .strict();

export const MerchantSourceConfigSchema = z
  .object({
    merchantId: MerchantIdSchema,
    allowedHosts: z.array(MerchantHostSchema).min(1).max(50),
    source: z
      .object({
        type: z.enum(["feed", "jsonld", "http"]),
        host: MerchantHostSchema,
        resourcePath: ResourcePathSchema
      })
      .strict(),
    ttlSeconds: z
      .object({
        product: TtlSchema,
        price: TtlSchema,
        inventory: TtlSchema,
        coupon: TtlSchema
      })
      .strict(),
    seller: z
      .object({
        name: z.string().trim().min(1).max(300),
        condition: z.enum(["NEW", "REFURBISHED", "USED"])
      })
      .strict(),
    affiliate: AffiliateConfigSchema.optional()
  })
  .strict()
  .superRefine((config, context) => {
    if (!config.allowedHosts.includes(config.source.host)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source", "host"],
        message: "source host must be present in allowedHosts"
      });
    }
    if (config.affiliate !== undefined) {
      const affiliateHosts = new Set(config.affiliate.affiliateHosts);
      config.affiliate.affiliateOrigins.forEach((origin, index) => {
        if (!affiliateHosts.has(new URL(origin).hostname)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["affiliate", "affiliateOrigins", index],
            message: "affiliate origin host must be present in affiliateHosts"
          });
        }
      });
    }
  });

export type MerchantSourceConfigInput = z.input<typeof MerchantSourceConfigSchema>;
export type MerchantSourceConfig = z.output<typeof MerchantSourceConfigSchema>;

declare const auditedMerchantGrantBrand: unique symbol;
export type AuditedMerchantGrant = MerchantCandidate & {
  readonly [auditedMerchantGrantBrand]: true;
};

/** Re-runs the catalog quality gate so a host-only object cannot authorize an adapter. */
export function createAuditedMerchantGrant(input: unknown): AuditedMerchantGrant {
  let candidate: MerchantCandidate;
  try {
    candidate = MerchantCandidateSchema.parse(input);
  } catch (error) {
    throw new Error("catalog candidate is not a valid audited merchant", { cause: error });
  }
  if (selectForBuild({ version: 1, candidates: [candidate] }).length !== 1) {
    throw new Error("catalog candidate has not passed the merchant audit gate");
  }
  if (!candidate.enabled) throw new Error("catalog candidate is not enabled");
  return candidate as AuditedMerchantGrant;
}

export function parseMerchantSourceConfig(
  input: MerchantSourceConfigInput,
  catalogCandidate: unknown
): MerchantSourceConfig {
  const config = MerchantSourceConfigSchema.parse(input);
  const grant = createAuditedMerchantGrant(catalogCandidate);
  if (config.merchantId !== grant.id) {
    throw new Error("merchant source config is not aligned with the catalog merchant");
  }
  if (grant.provenSource !== config.source.type) {
    throw new Error("merchant source type does not match the audited provenSource");
  }
  const catalogHosts = new Set(grant.allowedHosts);
  if (config.allowedHosts.some((host) => !catalogHosts.has(host))) {
    throw new Error("merchant source allowedHosts are not aligned with the catalog");
  }
  if (config.affiliate !== undefined) {
    if (grant.affiliateStatus !== "approved") {
      throw new Error("affiliate template requires an approved affiliate audit");
    }
    const affiliateHosts = new Set(grant.affiliateHosts);
    const affiliateOrigins = new Set(grant.affiliateOrigins);
    if (
      config.affiliate.affiliateHosts.some((host) => !affiliateHosts.has(host)) ||
      config.affiliate.affiliateOrigins.some((origin) => !affiliateOrigins.has(origin))
    ) {
      throw new Error("affiliate hosts and origins are not aligned with the audited catalog");
    }
  }
  return config;
}
