import { z } from "zod";
import type { ShopifyProduct } from "./shopify-client.js";

/** Private, source-observed identity. Never accepted as a public tool argument. */
export const ShopifyProductAnchorSchema = z.object({
  url: z.string().url().max(4096).refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash &&
      /^\/products\/[A-Za-z0-9][A-Za-z0-9_-]{0,200}$/u.test(url.pathname) &&
      [...url.searchParams].every(([key, value]) => key === "variant" && /^\d{1,30}$/u.test(value)) &&
      url.searchParams.getAll("variant").length <= 1;
  }),
  gtins: z.array(z.string().regex(/^\d{8,14}$/u)).max(16),
  brand: z.string().min(1).max(200).optional(),
  mpn: z.string().min(1).max(200).optional(),
  variantDimensions: z.record(z.string().min(1).max(100), z.string().min(1).max(200))
    .refine(value => Object.keys(value).length <= 20)
}).strict();
export type ShopifyProductAnchor = z.infer<typeof ShopifyProductAnchorSchema>;
type IdentityProduct = { merchantUrl: string; sourceHost?: string | undefined; gtins?: readonly string[] | undefined;
  brand?: string | undefined; mpn?: string | undefined; variantDimensions?: Readonly<Record<string, string>> | undefined };
const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
const host = (value: string) => value.toLowerCase().replace(/^www\./u, "");

export function createShopifyProductAnchor(product: ShopifyProduct, requestedUrl: string): ShopifyProductAnchor {
  const target = new URL(requestedUrl), observed = new URL(product.merchantUrl);
  const variant = target.searchParams.get("variant");
  if (host(target.hostname) !== host(observed.hostname) || target.pathname !== observed.pathname.replace(/\/$/u, "") ||
    (variant !== null && (observed.searchParams.get("variant") !== variant || product.handle !== variant))) {
    throw new Error("Source product does not establish the requested Shopify URL identity");
  }
  return ShopifyProductAnchorSchema.parse({ url: target.href,
    gtins: variant === null ? [] : product.gtins,
    ...(product.brand === undefined ? {} : { brand: product.brand }),
    ...(product.mpn === undefined || variant === null ? {} : { mpn: product.mpn }),
    variantDimensions: variant === null ? {} : Object.fromEntries(Object.entries(product.variantDimensions)
      .filter(([name, value]) => normalize(name) !== "title" || normalize(value) !== "default title"))
  });
}

export function matchesShopifyProductAnchor(product: IdentityProduct, anchor: ShopifyProductAnchor): boolean {
  const target = new URL(anchor.url);
  let observed: URL;
  try { observed = new URL(product.merchantUrl); } catch { return false; }
  if (observed.protocol !== "https:" || observed.username || observed.password || observed.port || observed.hash) return false;
  if (product.sourceHost !== undefined && host(product.sourceHost) !== host(observed.hostname)) return false;
  const dimensions = new Map(Object.entries(product.variantDimensions ?? {}).map(([key, value]) => [normalize(key), normalize(value)]));
  if (!Object.entries(anchor.variantDimensions).every(([key, value]) => dimensions.get(normalize(key)) === normalize(value))) return false;
  if (host(observed.hostname) === host(target.hostname)) {
    return observed.pathname.replace(/\/$/u, "") === target.pathname &&
      (!target.searchParams.has("variant") || observed.searchParams.getAll("variant").length === 1 &&
        observed.searchParams.get("variant") === target.searchParams.get("variant"));
  }
  // Cross-merchant IDs/SKUs are local. Require the existing global identity path.
  if (anchor.mpn !== undefined && product.mpn !== undefined && normalize(anchor.mpn) !== normalize(product.mpn)) return false;
  const globalId = anchor.gtins.some(id => product.gtins?.some(value => value.padStart(14, "0") === id.padStart(14, "0")));
  const manufacturerId = anchor.brand !== undefined && anchor.mpn !== undefined && product.brand !== undefined && product.mpn !== undefined &&
    normalize(anchor.brand) === normalize(product.brand) && normalize(anchor.mpn) === normalize(product.mpn);
  return globalId || manufacturerId;
}

/** Only Shopify's own variant ID is comparable to its merchant URL selection.
 * Callers must not apply this to affiliate/Woo handles or recovered page IDs. */
export function hasConflictingShopifyVariantId(product: { merchantUrl: string; handle: string }, anchor: ShopifyProductAnchor): boolean {
  const observed = new URL(product.merchantUrl);
  return host(observed.hostname) === host(new URL(anchor.url).hostname) && observed.searchParams.has("variant") &&
    (observed.searchParams.getAll("variant").length !== 1 || observed.searchParams.get("variant") !== product.handle);
}

/** Provider inspection stays bound to the actual selected merchant product. */
export function matchesSelectedShopifyInspection(selected: ShopifyProduct, options: Record<string, string>, product: ShopifyProduct): boolean {
  const target = new URL(selected.merchantUrl), observed = new URL(product.merchantUrl);
  if (host(target.hostname) !== host(observed.hostname) || target.pathname !== observed.pathname) return false;
  const selectedAnchor = createShopifyProductAnchor(selected, target.href);
  if (hasConflictingShopifyVariantId(product, selectedAnchor)) return false;
  const requested = Object.entries(options);
  if (requested.length > 0) target.search = "";
  const dimensions = Object.fromEntries(Object.entries(selectedAnchor.variantDimensions)
    .filter(([key]) => !requested.some(([name]) => normalize(name) === normalize(key))));
  return matchesShopifyProductAnchor(product, { ...selectedAnchor, url: target.href, variantDimensions: dimensions }) &&
    requested.every(([name, value]) => Object.entries(product.variantDimensions)
      .some(([key, observed]) => normalize(key) === normalize(name) && normalize(observed) === normalize(value)));
}

/** Explicit option changes on a globally confirmed selected offer can revise
 * the target. Inspecting an alternative never silently changes its identity. */
export function inspectedShopifyProductAnchor(anchor: ShopifyProductAnchor, selected: ShopifyProduct, options: Record<string, string>,
  variants: ShopifyProduct[]): ShopifyProductAnchor {
  const requested = Object.entries(options);
  if (requested.length === 0 || variants.length !== 1 || !matchesShopifyProductAnchor(selected, anchor)) return anchor;
  const product = variants[0]!;
  if (!matchesSelectedShopifyInspection(selected, options, product)) return anchor;
  const observed = new URL(product.merchantUrl);
  for (const key of [...observed.searchParams.keys()]) if (key !== "variant") observed.searchParams.delete(key);
  return createShopifyProductAnchor(product, observed.href);
}
