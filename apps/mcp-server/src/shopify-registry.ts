import { z } from "zod";

import { SHOPIFY_MERCHANT_REGISTRY } from "../../../config/shopify/registry.js";

const HostSchema = z.string().trim().toLowerCase().regex(
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u
);

const MerchantSchema = z.object({
  merchantId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(80),
  merchant: z.string().trim().min(1).max(120),
  apiHost: HostSchema,
  allowedHosts: z.array(HostSchema).min(1).max(2).refine(
    (hosts) => new Set(hosts).size === hosts.length,
    "Shopify registry allowedHosts must be unique"
  ),
  apiVersion: z.literal("2026-07"),
  probeQuery: z.string().trim().min(2).max(100).regex(/^[\p{L}\p{N}\s._+'-]+$/u),
  searchEnabled: z.boolean()
}).strict();

const RegistrySchema = z.object({
  version: z.string().regex(/^v\d+$/u),
  merchants: z.array(MerchantSchema).min(1).max(50)
}).strict();

export type ShopifyPilot = z.infer<typeof MerchantSchema>;
export type ShopifyRegistry = z.infer<typeof RegistrySchema>;

export function parseShopifyRegistry(input: unknown): ShopifyRegistry {
  const registry = RegistrySchema.parse(input);
  requireUnique(registry.merchants.map((merchant) => merchant.merchantId), "merchantId");
  requireUnique(registry.merchants.map((merchant) => merchant.apiHost), "apiHost");
  for (const merchant of registry.merchants) {
    const bareHost = withoutWww(merchant.apiHost);
    if (
      !merchant.allowedHosts.includes(merchant.apiHost) ||
      merchant.allowedHosts.some((host) => withoutWww(host) !== bareHost)
    ) {
      throw new Error("Shopify registry allowedHosts must stay on the merchant host");
    }
  }
  if (!registry.merchants.some((merchant) => merchant.searchEnabled)) {
    throw new Error("Shopify registry has no search-enabled merchants");
  }
  return registry;
}

export const SHOPIFY_REGISTRY = parseShopifyRegistry(SHOPIFY_MERCHANT_REGISTRY);

function requireUnique(values: readonly string[], field: "merchantId" | "apiHost"): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Shopify registry ${field} must be unique`);
  }
}

function withoutWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}
