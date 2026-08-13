import { z } from "zod";

const MerchantIdSchema = z.string().regex(/^[a-z0-9-]{1,80}$/);
const HostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
  .transform((host) => host.toLowerCase());
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
    affiliateHosts: z.array(HostSchema).min(1).max(20),
    affiliateOrigins: z.array(z.string().min(1).max(300)).min(1).max(20)
  })
  .strict();

export const MerchantSourceConfigSchema = z
  .object({
    merchantId: MerchantIdSchema,
    enabled: z.boolean(),
    killSwitch: z.boolean(),
    allowedHosts: z.array(HostSchema).min(1).max(50),
    source: z
      .object({
        type: z.enum(["feed", "jsonld", "http"]),
        host: HostSchema,
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
  });

export type MerchantSourceConfigInput = z.input<typeof MerchantSourceConfigSchema>;
export type MerchantSourceConfig = z.output<typeof MerchantSourceConfigSchema>;

export type MerchantCatalogGrant = {
  merchantId: string;
  allowedHosts: readonly string[];
};

export function parseMerchantSourceConfig(
  input: MerchantSourceConfigInput,
  catalog: MerchantCatalogGrant
): MerchantSourceConfig {
  const config = MerchantSourceConfigSchema.parse(input);
  const catalogMerchantId = MerchantIdSchema.parse(catalog.merchantId);
  const catalogHosts = new Set(z.array(HostSchema).min(1).max(50).parse(catalog.allowedHosts));
  if (config.merchantId !== catalogMerchantId) {
    throw new Error("merchant source config is not aligned with the catalog merchant");
  }
  if (config.allowedHosts.some((host) => !catalogHosts.has(host))) {
    throw new Error("merchant source allowedHosts are not aligned with the catalog");
  }
  return config;
}
