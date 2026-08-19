import { z } from "zod";
import { SHOPIFY_AFFILIATE_REGISTRY } from "../../../config/shopify/affiliate-registry.js";
import { SHOPIFY_REGISTRY } from "./shopify-registry.js";

const EnvironmentNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/u);
const AffiliateOriginSchema = z.string().url().transform((value, context) => {
  const url = new URL(value);
  if (
    url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
    url.port !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== ""
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "affiliate origin must be credential-free HTTPS on the default port" });
    return z.NEVER;
  }
  return url.origin;
});

const RelationshipSchema = z.object({
  merchantId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(80),
  status: z.literal("APPROVED"),
  providerName: z.string().trim().min(1).max(120),
  affiliateOrigin: AffiliateOriginSchema,
  template: z.string().min(1).max(4_096),
  campaignIdEnv: EnvironmentNameSchema
}).strict();

const AffiliateRegistrySchema = z.object({
  version: z.string().regex(/^v\d+$/u),
  relationships: z.array(RelationshipSchema).max(50)
}).strict();

export type AffiliateRegistry = z.infer<typeof AffiliateRegistrySchema>;
export type PurchaseLink = {
  kind: "CANONICAL" | "APPROVED_AFFILIATE";
  url: string;
  providerName?: string;
  disclosure?: string;
};
export interface AffiliateLinkResolver {
  resolve(product: { merchantId: string; merchantUrl: string }): PurchaseLink;
}

export const AFFILIATE_DISCLOSURE =
  "We may earn a commission if you buy through this link. This does not raise your price or affect ranking.";

export function parseAffiliateRegistry(input: unknown): AffiliateRegistry {
  const registry = AffiliateRegistrySchema.parse(input);
  const merchantIds = new Set<string>();
  for (const relationship of registry.relationships) {
    if (merchantIds.has(relationship.merchantId)) {
      throw new Error("affiliate registry merchantId must be unique");
    }
    merchantIds.add(relationship.merchantId);
    if (!SHOPIFY_REGISTRY.merchants.some((merchant) => merchant.merchantId === relationship.merchantId)) {
      throw new Error("affiliate relationship merchant is not in the Shopify registry");
    }
    validateTemplate(relationship);
  }
  return registry;
}

export function createAffiliateLinkResolver(
  input: unknown = SHOPIFY_AFFILIATE_REGISTRY,
  environment: Readonly<Record<string, string | undefined>> = process.env
): AffiliateLinkResolver {
  const registry = parseAffiliateRegistry(input);
  const relationships = new Map(registry.relationships.map((relationship) => [relationship.merchantId, relationship]));
  return {
    resolve(product) {
      const canonicalUrl = requireCanonicalProductUrl(product.merchantId, product.merchantUrl);
      const relationship = relationships.get(product.merchantId);
      if (relationship === undefined) return { kind: "CANONICAL", url: canonicalUrl };
      const campaignId = environment[relationship.campaignIdEnv]?.trim();
      if (campaignId === undefined || campaignId === "" || Buffer.byteLength(campaignId, "utf8") > 256) {
        return { kind: "CANONICAL", url: canonicalUrl };
      }
      const url = renderTemplate(relationship, { campaignId, merchantUrl: canonicalUrl });
      return {
        kind: "APPROVED_AFFILIATE",
        url,
        providerName: relationship.providerName,
        disclosure: AFFILIATE_DISCLOSURE
      };
    }
  };
}

function validateTemplate(relationship: z.infer<typeof RelationshipSchema>): void {
  const authorityEnd = relationship.template.indexOf("/", "https://".length);
  const authority = authorityEnd === -1 ? relationship.template : relationship.template.slice(0, authorityEnd);
  if (!relationship.template.startsWith("https://") || /[{}]/u.test(authority)) {
    throw new Error("affiliate template must have a literal HTTPS origin");
  }
  if (!relationship.template.includes("{campaignId}") || !relationship.template.includes("{merchantUrl}")) {
    throw new Error("affiliate template must bind campaignId and merchantUrl");
  }
  for (const match of relationship.template.matchAll(/\{([^{}]+)\}/gu)) {
    if (match[1] !== "campaignId" && match[1] !== "merchantUrl") {
      throw new Error("affiliate template contains an unknown placeholder");
    }
  }
  if (/[{}]/u.test(relationship.template.replace(/\{(?:campaignId|merchantUrl)\}/gu, ""))) {
    throw new Error("affiliate template syntax is invalid");
  }
  const sample = renderTemplate(relationship, {
    campaignId: "campaign",
    merchantUrl: "https://merchant.example/products/item"
  });
  if (new URL(sample).origin !== relationship.affiliateOrigin) {
    throw new Error("affiliate template origin is not approved");
  }
}

function renderTemplate(
  relationship: z.infer<typeof RelationshipSchema>,
  values: { campaignId: string; merchantUrl: string }
): string {
  const rendered = relationship.template.replace(
    /\{(campaignId|merchantUrl)\}/gu,
    (_match, key: keyof typeof values) => encodeURIComponent(values[key])
  );
  if (Buffer.byteLength(rendered, "utf8") > 4_096) throw new Error("affiliate URL is too long");
  const url = new URL(rendered);
  if (
    url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
    url.port !== "" || url.origin !== relationship.affiliateOrigin
  ) {
    throw new Error("affiliate URL is not approved");
  }
  return url.href;
}

function requireCanonicalProductUrl(merchantId: string, value: string): string {
  const merchant = SHOPIFY_REGISTRY.merchants.find((candidate) => candidate.merchantId === merchantId);
  if (merchant === undefined) throw new Error("product merchant is not in the Shopify registry");
  if (Buffer.byteLength(value, "utf8") > 4_096) throw new Error("merchant URL is too long");
  const url = new URL(value);
  if (
    url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
    url.port !== "" || !merchant.allowedHosts.some((host) => host === url.hostname)
  ) {
    throw new Error("merchant URL is not approved");
  }
  url.hash = "";
  return url.href;
}
