import { z } from "zod";
import { REVIEWED_WOO_ADDITIONS } from "./woocommerce-merchants.js";
import { isReadOnlyWooProductUrl } from "../../../packages/contracts/src/woocommerce-product-url.js";

const Host = z.string().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u).max(253);
const Prefix = z.string().regex(/^\/[a-zA-Z0-9/_-]*$/u).max(200);
export const WooMerchantSchema = z.object({
  merchantId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/u), name: z.string().min(1).max(300),
  origin: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" && url.port === "" && url.pathname === "/" && url.search === "" && url.hash === "" && Host.safeParse(url.hostname).success;
  }),
  apiPath: Prefix.default("/wp-json/wc/store/v1"), productPathPrefixes: z.array(Prefix).min(1).max(10),
  imageHosts: z.array(Host).max(20).default([]), aliases: z.array(Host).max(10).default([]),
  brands: z.array(z.string().min(1).max(100)).max(50).default([]), categories: z.array(z.string().min(1).max(100)).max(50).default([]),
  currency: z.string().regex(/^[A-Z]{3}$/u), marketEvidence: z.string().url().optional(),
  requiresOptionSelection: z.boolean().optional(),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), evidenceUrl: z.string().url(),
  enabled: z.boolean(), capabilities: z.object({ search: z.boolean(), variations: z.boolean() }).strict()
}).strict();
export const WooRegistrySchema = z.object({
  version: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/u), stores: z.array(WooMerchantSchema).max(2_000)
}).strict().superRefine((registry, context) => {
  const ids = new Set<string>();
  const hosts = new Set<string>();
  registry.stores.forEach((store, index) => {
    if (ids.has(store.merchantId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["stores", index], message: "duplicate merchant ID" });
    ids.add(store.merchantId);
    for (const host of [new URL(store.origin).hostname, ...store.aliases]) {
      if (hosts.has(host)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["stores", index], message: "duplicate merchant host" });
      hosts.add(host);
    }
  });
});
export type WooMerchant = z.infer<typeof WooMerchantSchema>;
export type WooRegistry = z.infer<typeof WooRegistrySchema>;

// Access registry only. No entry grants merchant trust, shipping, or affiliate approval.
export const DEFAULT_WOO_REGISTRY: WooRegistry = WooRegistrySchema.parse({ version: "2026-09-09-priority-1002", stores: [
  { merchantId: "offerman-woodshop", name: "Offerman Woodshop", origin: "https://offermanwoodshop.com", productPathPrefixes: ["/store/"], categories: ["trivet", "wood", "kitchen", "home"], brands: ["Offerman"],
    currency: "USD", marketEvidence: "https://offermanwoodshop.com/faq/", evidenceUrl: "https://offermanwoodshop.com/wp-json/wc/store/v1/products/43848", reviewedAt: "2026-09-08", enabled: true, capabilities: { search: true, variations: true } },
  { merchantId: "root-science", name: "Root Science", origin: "https://www.shoprootscience.com", productPathPrefixes: ["/shop/"], categories: ["skin", "serum", "firm"], brands: ["Root Science"],
    currency: "USD", marketEvidence: "https://www.shoprootscience.com/shipping", evidenceUrl: "https://www.shoprootscience.com/wp-json/wc/store/v1/products/69439", reviewedAt: "2026-09-08", enabled: true, capabilities: { search: true, variations: false } },
  { merchantId: "lamarzocco-home-usa", name: "La Marzocco Home USA", origin: "https://home.lamarzoccousa.com", productPathPrefixes: ["/product/"], categories: ["coffee", "espresso", "portafilter"], brands: ["La Marzocco"],
    currency: "USD", marketEvidence: "https://home.lamarzoccousa.com/faq/", evidenceUrl: "https://home.lamarzoccousa.com/wp-json/wc/store/v1/products/355289", reviewedAt: "2026-09-08", enabled: true, capabilities: { search: true, variations: true } },
  { merchantId: "burrow-press", name: "Burrow Press", origin: "https://burrowpress.com", productPathPrefixes: ["/"], categories: ["book", "poetry", "fiction", "mother"], brands: ["Burrow Press"],
    currency: "USD", marketEvidence: "https://burrowpress.com/books/", evidenceUrl: "https://burrowpress.com/wp-json/wc/store/v1/products/23939", reviewedAt: "2026-09-08", enabled: true, capabilities: { search: true, variations: false } },
  { merchantId: "scrub-daddy", name: "Scrub Daddy", origin: "https://scrubdaddy.com", productPathPrefixes: ["/product/"], categories: ["sponge", "scrubber", "cleaning", "original"], brands: ["Scrub Daddy"],
    currency: "USD", marketEvidence: "https://support.scrubdaddy.com/support/solutions/articles/156000158436-how-do-orders-ship-", evidenceUrl: "https://scrubdaddy.com/wp-json/wc/store/v1/products/769455", reviewedAt: "2026-09-08", enabled: true, capabilities: { search: true, variations: false } },
  ...REVIEWED_WOO_ADDITIONS,
  {"merchantId":"recool-hair","name":"Recool Hair","origin":"https://www.recoolhair.com","apiPath":"/wp-json/wc/store/v1","productPathPrefixes":["/product/"],"imageHosts":[],"aliases":[],"brands":["Recool Hair"],"categories":["wig","human hair wig","hair extension","lace wig"],"currency":"USD","marketEvidence":"https://www.recoolhair.com/product/ombre-brown-yaki-straight-pre-layered-cut-glueless-wig.html","requiresOptionSelection":true,"reviewedAt":"2026-09-09","evidenceUrl":"https://www.recoolhair.com/wp-json/wc/store/v1/products/407531","enabled":true,"capabilities":{"search":true,"variations":false}},
  {"merchantId":"silent-sound-system","name":"Silent Sound System","origin":"https://silentsoundsystem.com","apiPath":"/wp-json/wc/store/v1","productPathPrefixes":["/product/"],"imageHosts":[],"aliases":[],"brands":["Silent Sound System"],"categories":["headphone","headphones","wireless headphone","silent disco","audio"],"currency":"USD","marketEvidence":"https://silentsoundsystem.com/","requiresOptionSelection":true,"reviewedAt":"2026-09-09","evidenceUrl":"https://silentsoundsystem.com/wp-json/wc/store/v1/products/61500","enabled":true,"capabilities":{"search":true,"variations":false}}
] });

export function wooRegistryFromEnvironment(input: Readonly<Record<string, string | undefined>>): WooRegistry | undefined {
  const enabled = input.WOOCOMMERCE_SOURCE_ENABLED?.trim().toLowerCase() ?? "false";
  if (enabled !== "true" && enabled !== "false") throw new Error("WOOCOMMERCE_SOURCE_ENABLED must be true or false");
  if (enabled === "false") return undefined;
  const raw = input.WOOCOMMERCE_REGISTRY_JSON;
  if (raw !== undefined && Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error("Woo registry too large");
  return WooRegistrySchema.parse(raw === undefined ? DEFAULT_WOO_REGISTRY : JSON.parse(raw));
}

export function wooMerchantForUrl(registry: WooRegistry, value: string): WooMerchant | undefined {
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return undefined;
  return registry.stores.find((store) => store.enabled && [new URL(store.origin).hostname, ...store.aliases].includes(url.hostname) &&
    store.productPathPrefixes.some((prefix) => url.pathname.startsWith(prefix)));
}

export function wooProductUrl(store: WooMerchant, value: string): string | undefined {
  let url: URL;
  if (/[\s\\]/u.test(value)) return undefined;
  try { url = new URL(value, store.origin); } catch { return undefined; }
  if (wooMerchantForUrl({ version: "validation", stores: [store] }, url.href) === undefined) return undefined;
  url.hash = "";
  return isReadOnlyWooProductUrl(url.href) ? url.href : undefined;
}
