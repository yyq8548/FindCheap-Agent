import { resolveMerchantTrust, resolveVerifiedOfficialStorefrontByHost, type VerifiedOfficialStorefront } from "./merchant-trust.js";

export type KnownProductUrl = {
  sourcePageUrl: string;
  storefront: VerifiedOfficialStorefront;
  /** A retrieval hint only. Identity and variant facts must come from the PDP. */
  retrievalQuery: string;
};

const TRACKING_PARAMETERS = new Set(["srsltid", "gclid", "fbclid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id"]);

/** Admit only exact reviewed storefront PDP routes, without granting new trust
 * or treating a URL slug as proof of product identity. No network calls here. */
export function resolveKnownProductUrl(query: string): KnownProductUrl | undefined {
  const value = query.trim();
  if (value.length > 4096 || !/^https:\/\//iu.test(value) || /[\\\s]/u.test(value) ||
    /:\d+(?:[/?#]|$)/u.test(value) || /(?:^|\/)\.{1,2}(?:\/|$)/u.test(value)) return undefined;
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || /%/u.test(url.pathname)) return undefined;
  const storefront = resolveVerifiedOfficialStorefrontByHost(url.hostname);
  if (storefront === undefined) return undefined;
  const trust = resolveMerchantTrust(url.hostname);
  if (trust.level !== "OFFICIAL" || trust.verification !== "INDEPENDENT") return undefined;
  url.hostname = storefront.host;
  const path = url.pathname;
  if (!storefront.productPathPrefixes.some(prefix => path.startsWith(prefix) && path.length > prefix.length)) return undefined;
  if (storefront.platform === "SHOPIFY" && !/^\/products\/[A-Za-z0-9][A-Za-z0-9_-]{0,200}\/?$/u.test(path)) return undefined;
  if (storefront.platform === "SHOPIFY") url.pathname = path.replace(/\/$/u, "");
  if (storefront.platform === "SONY_OCC" && !/^\/audio\/(?:[a-z0-9-]+\/){1,4}p\/[a-z0-9][a-z0-9_-]{0,99}$/u.test(path)) return undefined;
  if (!/^\/[A-Za-z0-9_./-]+$/u.test(path)) return undefined;
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETERS.has(key)) { url.searchParams.delete(key); continue; }
    const parameter = url.searchParams.get(key) ?? "";
    if (url.searchParams.getAll(key).length !== 1) return undefined;
    if (storefront.platform === "SHOPIFY" && key === "variant" && /^\d{1,30}$/u.test(parameter)) continue;
    if (storefront.platform === "GENERIC_JSON_LD") {
      if (["color", "size", "variant", "type"].includes(key) && /^[A-Za-z0-9_-]{1,80}$/u.test(parameter)) continue;
      const color = key.match(/^dwvar_([A-Za-z0-9_-]{1,64})_color$/u);
      if (color !== null && path.endsWith(`/${color[1]}.html`) && /^[A-Za-z0-9_-]{1,40}$/u.test(parameter)) continue;
    }
    return undefined;
  }
  const slug = path.replace(/\/$/u, "").split("/").at(-1)!.replace(/\.html?$/iu, "").replace(/[-_]+/gu, " ");
  const retrievalQuery = `${storefront.brand} ${slug}`.replace(/\s+/gu, " ").trim().slice(0, 300);
  return { sourcePageUrl: url.href, storefront, retrievalQuery };
}
