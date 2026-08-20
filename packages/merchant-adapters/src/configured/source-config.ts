import { z } from "zod";

import {
  AffiliateOriginSchema,
  MerchantCandidateSchema,
  MerchantHostSchema,
  selectForBuild,
  type MerchantCandidate
} from "../../../../config/merchants/schema.js";
import { FieldMappingSchema, FieldPathSchema } from "./feed-reader.js";

const MerchantIdSchema = z.string().regex(/^[a-z0-9-]{1,80}$/);
const ResourcePathSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine(
    (path) => path.startsWith("/") && !path.startsWith("//") && !path.includes("\\"),
    "resourcePath must be a bounded absolute path without a host"
  )
  .refine((path) => !/[{}#]/u.test(path), "resourcePath must not contain placeholders or fragments")
  .refine((path) => !hasInlineCredentialQuery(path), "resourcePath must not contain inline credentials");
const EndpointPathSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine(
    (path) => path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") && !path.includes("#"),
    "endpoint resourcePath must be a bounded absolute path without a host or fragment"
  )
  .refine((path) => !hasInlineCredentialQuery(path), "endpoint resourcePath must not contain inline credentials");
const TtlSchema = z.number().int().min(30).max(604_800);

const QuoteMappingSchema = z
  .object({
    itemPriceCents: FieldPathSchema,
    shippingCents: FieldPathSchema,
    taxCents: FieldPathSchema,
    mandatoryFeeCents: FieldPathSchema,
    status: FieldPathSchema,
    conditions: FieldPathSchema
  })
  .strict();

const CouponMappingSchema = z
  .object({
    couponId: FieldPathSchema,
    code: FieldPathSchema.optional(),
    amountCents: FieldPathSchema,
    verificationStatus: FieldPathSchema,
    eligibility: FieldPathSchema,
    validFrom: FieldPathSchema,
    validTo: FieldPathSchema
  })
  .strict();

const EndpointBaseSchema = z.object({
  audited: z.literal(true),
  host: MerchantHostSchema,
  resourcePath: EndpointPathSchema,
  recordsPath: FieldPathSchema,
  fields: FieldMappingSchema
});

const QuoteEndpointSchema = EndpointBaseSchema.extend({ quote: QuoteMappingSchema })
  .strict()
  .superRefine((endpoint, context) => {
    validateEndpointPlaceholders(endpoint.resourcePath, new Set(["merchantProductId", "zipCode", "memberships"]), context);
    for (const required of ["{merchantProductId}", "{zipCode}"]) {
      if (!endpoint.resourcePath.includes(required)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["resourcePath"], message: `quote endpoint requires ${required}` });
      }
    }
  });

const CouponEndpointSchema = EndpointBaseSchema.extend({
  couponsPath: FieldPathSchema,
  coupon: CouponMappingSchema
})
  .strict()
  .superRefine((endpoint, context) => {
    validateEndpointPlaceholders(endpoint.resourcePath, new Set(["merchantProductId", "memberships"]), context);
    if (!endpoint.resourcePath.includes("{merchantProductId}")) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["resourcePath"], message: "coupon endpoint requires {merchantProductId}" });
    }
  });

const AffiliateConfigSchema = z
  .object({
    template: z.string().min(1).max(2_048),
    affiliateHosts: z.array(MerchantHostSchema).min(1).max(20),
    affiliateOrigins: z.array(AffiliateOriginSchema).min(1).max(20)
  })
  .strict();

const MappedSourceSchema = z
  .object({
    type: z.enum(["feed", "jsonld", "http"]),
    host: MerchantHostSchema,
    resourcePath: ResourcePathSchema,
    recordsPath: FieldPathSchema.optional(),
    fields: FieldMappingSchema.optional()
  })
  .strict();

const ShopifyStorefrontSourceSchema = z
  .object({
    type: z.literal("api"),
    provider: z.literal("shopify-storefront"),
    host: MerchantHostSchema,
    apiVersion: z.literal("2026-07")
  })
  .strict();

export const MerchantSourceConfigSchema = z
  .object({
    merchantId: MerchantIdSchema,
    allowedHosts: z.array(MerchantHostSchema).min(1).max(50),
    source: z.union([
      MappedSourceSchema,
      ShopifyStorefrontSourceSchema
    ]),
    quoteEndpoint: QuoteEndpointSchema.optional(),
    couponEndpoint: CouponEndpointSchema.optional(),
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
    if (
      config.source.type !== "api" &&
      ((config.source.recordsPath === undefined) !== (config.source.fields === undefined))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source"],
        message: "source recordsPath and fields must be configured together"
      });
    }
    if (config.source.type === "jsonld" && config.source.recordsPath !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source"],
        message: "JSON-LD source does not accept mapped JSON fields"
      });
    }
    for (const [name, endpoint] of [
      ["quoteEndpoint", config.quoteEndpoint],
      ["couponEndpoint", config.couponEndpoint]
    ] as const) {
      if (endpoint !== undefined && !config.allowedHosts.includes(endpoint.host)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name, "host"],
          message: "endpoint host must be present in allowedHosts"
        });
      }
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

function validateEndpointPlaceholders(
  path: string,
  allowed: ReadonlySet<string>,
  context: z.RefinementCtx
): void {
  for (const match of path.matchAll(/\{([^{}]+)\}/gu)) {
    if (!allowed.has(match[1] ?? "")) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["resourcePath"], message: "endpoint contains an unsupported placeholder" });
    }
  }
  if (/[{}]/u.test(path.replace(/\{[^{}]+\}/gu, ""))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resourcePath"], message: "endpoint placeholder syntax is invalid" });
  }
}

function hasInlineCredentialQuery(path: string): boolean {
  const credentialName = /^(?:api[-_]?key|access[-_]?key|authorization|password|secret|token)$/iu;
  try {
    return [...new URL(path, "https://placeholder.invalid").searchParams.keys()]
      .some((key) => credentialName.test(key));
  } catch {
    return true;
  }
}

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
