import { createHash } from "node:crypto";
import { z } from "zod";

import { safeFetchWithProvenance } from "../../../packages/network-safety/src/safe-fetch.js";
import { merchantRecommendationTier, resolveMerchantTrust } from "./merchant-trust.js";
import type { ShopifyProduct } from "./shopify-client.js";
import type {
  OfficialShopifyFetch,
  OfficialShopifySearchPort,
  OfficialShopifyStoreSeed
} from "./shopify-official-store-search.js";

const MAX_DISCOVERY_BYTES = 2 * 1024 * 1024;
const MAX_PRODUCT_BYTES = 1024 * 1024;
const MAX_SITEMAPS = 4;
const MAX_PRODUCT_PAGES = 6;

const JsonLdOfferSchema = z.object({
  price: z.union([z.number().nonnegative(), z.string().regex(/^\d+(?:\.\d{1,2})?$/u)]),
  priceCurrency: z.string().trim().length(3),
  availability: z.string().trim().max(300).optional(),
  url: z.string().trim().min(1).max(4_096).optional(),
  sku: z.string().trim().max(300).optional(),
  size: z.string().trim().max(100).optional(),
  color: z.string().trim().max(100).optional()
}).passthrough();

const JsonLdProductSchema = z.object({
  "@type": z.union([
    z.literal("Product"),
    z.array(z.string()).refine((types) => types.includes("Product"))
  ]),
  name: z.string().trim().min(1).max(1_000),
  description: z.string().max(100_000).optional(),
  color: z.string().trim().min(1).max(100).optional(),
  brand: z.union([
    z.string().trim().min(1).max(300),
    z.object({ name: z.string().trim().min(1).max(300) }).passthrough()
  ]).optional(),
  sku: z.string().trim().max(300).optional(),
  mpn: z.string().trim().max(300).optional(),
  gtin: z.string().trim().max(300).optional(),
  gtin8: z.string().trim().max(300).optional(),
  gtin12: z.string().trim().max(300).optional(),
  gtin13: z.string().trim().max(300).optional(),
  gtin14: z.string().trim().max(300).optional(),
  image: z.union([
    z.string().url().max(4_096),
    z.array(z.string().url().max(4_096)).max(50)
  ]).optional(),
  offers: z.union([JsonLdOfferSchema, z.array(JsonLdOfferSchema).min(1).max(100)])
}).passthrough();

type CandidateReference = { url: string; title: string; score: number };

type Dependencies = {
  fetchDocument?: OfficialShopifyFetch;
  clock?: { now(): Date };
  imageProxyOrigin?: string;
};

export function createGenericOfficialStoreSearchPort(
  dependencies: Dependencies = {}
): OfficialShopifySearchPort {
  const fetchDocument = dependencies.fetchDocument ?? ((url, allowedHost, signal) =>
    safeFetchWithProvenance({ url }, { allowedHosts: [allowedHost], ...(signal === undefined ? {} : { signal }) }));
  const clock = dependencies.clock ?? { now: () => new Date() };
  const imageProxyOrigin = validProxyOrigin(dependencies.imageProxyOrigin);
  return {
    async search(input) {
      input.signal?.throwIfAborted();
      if (!("platform" in input.seed) || input.seed.platform !== "GENERIC_JSON_LD") return [];
      const seed = input.seed as OfficialShopifyStoreSeed;
      const host = verifiedHost(seed);
      const scopedFetch: OfficialShopifyFetch = async (url, allowedHost) => {
        input.signal?.throwIfAborted();
        return input.signal === undefined ? fetchDocument(url, allowedHost) : fetchDocument(url, allowedHost, input.signal);
      };
      let directUrl: string | undefined;
      if (input.sourcePageUrl !== undefined) {
        directUrl = approvedProductUrl(input.sourcePageUrl, host, seed.productPathPrefixes ?? ["/products/"]);
        const source = new URL(input.sourcePageUrl);
        source.hash = "";
        if (directUrl === undefined || directUrl !== source.href) throw new Error("official direct product URL invalid");
      }
      const candidates = directUrl === undefined
        ? await discoverProducts(scopedFetch, input.query, input.limit, seed, host)
        : [{ url: directUrl, title: "", score: 1 }];
      const products = await Promise.all(candidates.slice(0, Math.min(input.limit, MAX_PRODUCT_PAGES)).map(async (candidate) => {
        try {
          const product = await hydrateProduct(scopedFetch, seed, host, candidate.url, clock.now(), imageProxyOrigin, input.requiredSize, input.requiredColor);
          if (directUrl !== undefined && [...new URL(directUrl).searchParams].some(([key, value]) =>
            new URL(product.merchantUrl).searchParams.get(key) !== value)) throw new Error("official selected variant was not verified");
          return product;
        } catch {
          input.signal?.throwIfAborted();
          if (directUrl !== undefined) throw new Error("official direct product unavailable");
          return undefined;
        }
      }));
      return products.filter((product): product is ShopifyProduct => product !== undefined);
    }
  };
}

async function discoverProducts(
  fetchDocument: OfficialShopifyFetch,
  query: string,
  limit: number,
  seed: OfficialShopifyStoreSeed,
  host: string
): Promise<CandidateReference[]> {
  const discovered: CandidateReference[] = [];
  const template = seed.searchPathTemplate ?? "/search/?q={query}";
  try {
    const searchUrl = new URL(template.replace("{query}", encodeURIComponent(query)), `https://${host}`);
    const html = await fetchText(fetchDocument, searchUrl.href, host, MAX_DISCOVERY_BYTES, "official search page");
    // A site's ranked result list is stronger discovery evidence than tokens in
    // style names or swatch links. It is not identity or visual-match evidence.
    const prefixes = seed.productPathPrefixes ?? ["/products/"];
    const ranked = structuredSearchLinks(html, host, prefixes);
    const next = nextSearchPage(html, searchUrl);
    if (next !== undefined && ranked.length < Math.min(limit, MAX_PRODUCT_PAGES)) {
      try {
        const nextHtml = await fetchText(fetchDocument, next, host, MAX_DISCOVERY_BYTES, "official next search page");
        ranked.push(...structuredSearchLinks(nextHtml, host, prefixes));
        discovered.push(...htmlProductLinks(nextHtml, host, prefixes, query));
      } catch { /* Keep page-one results when the one bounded continuation fails. */ }
    }
    if (ranked.length > 0) return [...new Map(ranked.map(entry => [entry.url, entry])).values()]
      .slice(0, Math.min(limit, MAX_PRODUCT_PAGES));
    discovered.push(...htmlProductLinks(html, host, seed.productPathPrefixes ?? ["/products/"], query));
  } catch {
    // Some official sites expose only Sitemap discovery.
  }
  if (discovered.length < limit) {
    try {
      discovered.push(...await sitemapProductLinks(
        fetchDocument,
        host,
        seed.productPathPrefixes ?? ["/products/"],
        query
      ));
    } catch {
      // Search-page candidates remain usable when Sitemap access is unavailable.
    }
  }
  const unique = new Map<string, CandidateReference>();
  for (const candidate of discovered.sort(compareReferences)) {
    if (!unique.has(candidate.url)) unique.set(candidate.url, candidate);
  }
  return [...unique.values()].slice(0, Math.max(limit, MAX_PRODUCT_PAGES));
}

async function sitemapProductLinks(
  fetchDocument: OfficialShopifyFetch,
  host: string,
  prefixes: readonly string[],
  query: string
): Promise<CandidateReference[]> {
  const root = await fetchText(fetchDocument, `https://${host}/sitemap.xml`, host, MAX_DISCOVERY_BYTES, "official sitemap");
  const rootProducts = xmlProductLinks(root, host, prefixes, query);
  if (rootProducts.length > 0) return rootProducts;
  const sitemapUrls = xmlLocations(root)
    .filter((url) => validSameHostUrl(url, host))
    .sort((left, right) => sitemapPriority(right) - sitemapPriority(left) || left.localeCompare(right))
    .slice(0, MAX_SITEMAPS);
  const maps = await Promise.all(sitemapUrls.map(async (url) => {
    try {
      return await fetchText(fetchDocument, url, host, MAX_DISCOVERY_BYTES, "official product sitemap");
    } catch {
      return "";
    }
  }));
  return maps.flatMap((xml) => xmlProductLinks(xml, host, prefixes, query));
}

function htmlProductLinks(
  html: string,
  host: string,
  prefixes: readonly string[],
  query: string
): CandidateReference[] {
  const entries: CandidateReference[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)) {
    const href = (match[1] ?? "").match(/\bhref\s*=\s*["']([^"']+)["']/iu)?.[1];
    if (href === undefined) continue;
    const url = approvedProductUrl(href, host, prefixes);
    if (url === undefined) continue;
    const title = stripHtml(match[2] ?? "");
    const score = referenceScore(`${url} ${title}`, query);
    if (score > 0) entries.push({ url, title, score });
  }
  return entries;
}

function structuredSearchLinks(html: string, host: string, prefixes: readonly string[]): CandidateReference[] {
  const ranked: Array<{ url: string; position: number }> = [];
  let visited = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++visited > 200 || depth > 4 || ranked.length >= 100) return;
    if (Array.isArray(value)) { value.slice(0, 100).forEach(entry => visit(entry, depth + 1)); return; }
    if (typeof value !== "object" || value === null) return;
    const node = value as Record<string, unknown>;
    const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    if (types.includes("ItemList") && Array.isArray(node.itemListElement)) {
      node.itemListElement.slice(0, 100).forEach((entry: unknown, index: number) => {
        if (ranked.length >= 100) return;
        const record = typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : undefined;
        const item = record?.item;
        const nested = typeof item === "object" && item !== null ? item as Record<string, unknown> : undefined;
        const raw = typeof entry === "string" ? entry : record?.url ?? nested?.url ?? nested?.["@id"] ?? item;
        const position = record?.position ?? index + 1;
        if (typeof raw !== "string" || raw.length > 4_096 || typeof position !== "number" ||
          !Number.isInteger(position) || position < 1 || position > 100_000) return;
        const url = approvedProductUrl(raw, host, prefixes);
        if (url !== undefined) ranked.push({ url, position });
      });
    }
    visit(node["@graph"], depth + 1);
    visit(node.mainEntity, depth + 1);
  };
  let scripts = 0;
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)) {
    if (++scripts > 32 || visited > 200 || ranked.length >= 100) break;
    try {
      visit(JSON.parse(match[1] ?? ""), 0);
    } catch { /* Malformed structured data may use the bounded HTML fallback. */ }
  }
  return [...new Map(ranked.sort((a, b) => a.position - b.position).map(entry => [entry.url,
    { url: entry.url, title: "", score: 0 }])).values()];
}

function nextSearchPage(html: string, current: URL): string | undefined {
  for (const match of html.matchAll(/<(?:a|link)\b([^>]*)>/giu)) {
    const attributes = match[1] ?? "";
    if (!/\brel\s*=\s*["'][^"']*\bnext\b[^"']*["']/iu.test(attributes)) continue;
    const href = attributes.match(/\bhref\s*=\s*["']([^"']+)["']/iu)?.[1];
    if (href === undefined || href.length > 4_096) continue;
    try {
      const next = new URL(decodeXml(href), current);
      if (!validSameHostUrl(next.href, current.hostname) || next.pathname !== current.pathname || next.href === current.href) continue;
      const cursorKeys = new Set(["page", "start", "cursor"]);
      if ([...current.searchParams.keys()].some(key => !cursorKeys.has(key) &&
        JSON.stringify(current.searchParams.getAll(key)) !== JSON.stringify(next.searchParams.getAll(key)))) continue;
      if ([...next.searchParams.keys()].some(key => !current.searchParams.has(key) && !cursorKeys.has(key))) continue;
      if (![...cursorKeys].some(key => next.searchParams.has(key) && next.searchParams.get(key) !== current.searchParams.get(key))) continue;
      next.hash = "";
      return next.href;
    } catch { /* Untrusted continuation links never expand host or query scope. */ }
  }
  return undefined;
}

function xmlProductLinks(
  xml: string,
  host: string,
  prefixes: readonly string[],
  query: string
): CandidateReference[] {
  return xmlLocations(xml).flatMap((value) => {
    const url = approvedProductUrl(value, host, prefixes);
    if (url === undefined) return [];
    const title = new URL(url).pathname.replace(/[-_/]+/gu, " ");
    const score = referenceScore(`${url} ${title}`, query);
    return score > 0 ? [{ url, title, score }] : [];
  });
}

async function hydrateProduct(
  fetchDocument: OfficialShopifyFetch,
  seed: OfficialShopifyStoreSeed,
  host: string,
  productUrl: string,
  checkedAt: Date,
  imageProxyOrigin: string | undefined,
  requiredSize?: string,
  requiredColor?: string
): Promise<ShopifyProduct> {
  const html = await fetchText(fetchDocument, productUrl, host, MAX_PRODUCT_BYTES, "official product page", true);
  const product = productFromHtml(html);
  const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
  const source = new URL(productUrl);
  const explicitSize = requiredSize ?? source.searchParams.get("size") ?? undefined;
  const exact = offers.find((entry) => entry.url !== undefined &&
    approvedProductUrl(entry.url, host, seed.productPathPrefixes ?? ["/products/"]) === source.href);
  const offerUrlColor = (entry: z.infer<typeof JsonLdOfferSchema>): string | undefined => {
    const url = approvedProductUrl(entry.url ?? productUrl, host, seed.productPathPrefixes ?? ["/products/"]);
    return url === undefined ? undefined : new URL(url).searchParams.get("color") ?? undefined;
  };
  const offerColor = (entry: z.infer<typeof JsonLdOfferSchema>): string | undefined => entry.color ?? offerUrlColor(entry);
  const explicitColor = requiredColor ?? source.searchParams.get("color") ??
    (exact === undefined ? undefined : offerColor(exact)) ?? product.color ?? offerColor(offers[0]!);
  if (product.color !== undefined && explicitColor !== undefined && !sameValue(product.color, explicitColor)) {
    throw new Error("official product color was not verified");
  }
  const colorSelector = [...source.searchParams].find(([key]) => /^dwvar_[A-Za-z0-9_-]{1,64}_color$/u.test(key));
  const sameColor = offers.filter((entry) => {
    const url = approvedProductUrl(entry.url ?? productUrl, host, seed.productPathPrefixes ?? ["/products/"]);
    if (url === undefined) return false;
    const offerPath = new URL(url).pathname;
    if (offerPath !== source.pathname) {
      const sku = product.sku ?? product.mpn;
      const sourceId = source.pathname.split("/").at(-1)?.replace(/\.html$/u, "");
      const offerId = offerPath.split("/").at(-1)?.replace(/\.html$/u, "");
      if (sku === undefined || sourceId !== sku || offerId === undefined ||
        !offerPath.startsWith(source.pathname.slice(0, source.pathname.lastIndexOf("/") + 1)) ||
        !sameOfferIdentifier(sku, offerId, entry)) return false;
    }
    const urlColor = offerUrlColor(entry);
    if (entry.color !== undefined && urlColor !== undefined && !sameValue(entry.color, urlColor)) return false;
    if (explicitColor !== undefined && !sameValue(offerColor(entry) ?? product.color, explicitColor)) return false;
    if (colorSelector !== undefined) {
      const id = colorSelector[0].slice(6, -6);
      const sku = product.sku ?? product.mpn;
      const offerId = new URL(url).pathname.split("/").at(-1)?.replace(/\.html$/u, "");
      if (sku !== id || !id.toUpperCase().endsWith(colorSelector[1].toUpperCase()) ||
        offerId === undefined || !sameOfferIdentifier(id, offerId, entry)) return false;
    }
    return true;
  });
  const eligible = sameColor.filter((entry) => (explicitSize === undefined || sameValue(entry.size, explicitSize)) &&
    [...source.searchParams].filter(([key]) => key === "variant" || key === "type").every(([key, value]) =>
      entry.url !== undefined && new URL(entry.url, `https://${host}`).searchParams.get(key) === value));
  // Shared bare PDP URLs are not size selection. Pin only a proven URL variant;
  // requiredSize already narrows eligible without depending on offer order.
  const urlSelectsVariant = source.searchParams.has("variant") || source.searchParams.has("size") ||
    (exact?.sku !== undefined && exact.sku !== product.sku && exact.sku !== product.mpn &&
      source.pathname.split("/").at(-1)?.replace(/\.html$/u, "") === exact.sku);
  const offer = urlSelectsVariant && exact !== undefined ? eligible.find((entry) => entry === exact)
    : eligible.find((entry) => isInStock(entry.availability)) ?? eligible[0];
  if (offer === undefined || offer.priceCurrency.toUpperCase() !== "USD") throw new Error("official product price was unavailable");
  const price = typeof offer.price === "number" ? offer.price : Number(offer.price);
  const amountCents = Math.round(price * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 100_000_000) {
    throw new Error("official product price was invalid");
  }
  const selectedVariant = explicitSize !== undefined || urlSelectsVariant;
  const knownColor = explicitColor !== undefined || colorSelector !== undefined;
  const canonicalUrl = colorSelector !== undefined && !selectedVariant ? source.href
    : approvedProductUrl(offer.url ?? productUrl, host, seed.productPathPrefixes ?? ["/products/"]);
  if (canonicalUrl === undefined) throw new Error("official product URL was invalid");
  const trust = resolveMerchantTrust(host, seed.merchant);
  if (trust.level !== "OFFICIAL" || trust.verification !== "INDEPENDENT") {
    throw new Error("official storefront was not independently verified");
  }
  const brand = typeof product.brand === "string" ? product.brand : product.brand?.name;
  const image = Array.isArray(product.image) ? product.image[0] : product.image;
  const imageUrl = approvedImageUrl(image, host, seed.imageHosts ?? [], imageProxyOrigin);
  const gtins = [product.gtin, product.gtin8, product.gtin12, product.gtin13, product.gtin14]
    .filter((value): value is string => value !== undefined && value !== "");
  const stableKey = offer.sku ?? product.sku ?? product.mpn ?? gtins[0] ?? canonicalUrl;
  const sku = product.sku ?? product.mpn;
  const selectedColor = offerColor(offer) ?? product.color;
  return {
    merchantId: `official-${seed.officialHost ?? host}`,
    merchant: seed.merchant,
    sourceHost: host,
    merchantTrust: trust,
    recommendationTier: merchantRecommendationTier(trust, undefined),
    handle: `official-${createHash("sha256").update(`${host}\n${stableKey}\n${canonicalUrl}`).digest("hex").slice(0, 32)}`,
    title: product.name,
    ...(product.description === undefined ? {} : { description: stripHtml(product.description).slice(0, 20_000) }),
    ...(brand === undefined ? {} : { brand }),
    ...(sku === undefined ? {} : { sku }),
    gtins,
    variantDimensions: { ...(selectedColor === undefined ? {} : { Color: selectedColor }), ...(offer.size === undefined ? {} : { Size: offer.size }) },
    ...(knownColor ? { availableSizes: [...new Set(sameColor.filter((entry) => isInStock(entry.availability)).flatMap((entry) => entry.size === undefined ? [] : [entry.size]))] } : {}),
    availabilityScope: selectedVariant || !knownColor ? "SELECTED_VARIANT" : "PRODUCT_COLOR",
    matchStatus: "DISCOVERY_MATCH",
    matchEvidence: ["matched independently verified official Product JSON-LD"],
    condition: "UNKNOWN",
    ...(imageUrl === undefined ? {} : { imageUrl }),
    itemPrice: { amountCents, currency: "USD" },
    availability: offer.availability === undefined ? "UNKNOWN" : isInStock(offer.availability) ? "IN_STOCK" : "OUT_OF_STOCK",
    merchantUrl: canonicalUrl,
    checkedAt: checkedAt.toISOString(),
    checkoutPlatform: "MERCHANT"
  };
}

function productFromHtml(html: string): z.infer<typeof JsonLdProductSchema> {
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)) {
    try {
      const found = findProduct(JSON.parse(match[1] ?? ""));
      if (found !== undefined) return JsonLdProductSchema.parse(found);
    } catch {
      // Ignore malformed and unrelated JSON-LD blocks.
    }
  }
  throw new Error("official Product JSON-LD was unavailable");
}

function sameOfferIdentifier(base: string, offerId: string, offer: z.infer<typeof JsonLdOfferSchema>): boolean {
  if (!offerId.startsWith(base)) return false;
  const suffix = offerId.slice(base.length);
  if (/^\d*$/u.test(suffix)) return true;
  // Letter size suffixes require agreement between URL, explicit offer SKU and
  // size. Do not accept arbitrary siblings merely sharing a product prefix.
  return /^[A-Za-z0-9]{1,8}$/u.test(suffix) && offer.sku === offerId && offer.size === suffix;
}

function findProduct(value: unknown): unknown | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findProduct(entry);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return value;
  return findProduct(record["@graph"]);
}

async function fetchText(
  fetchDocument: OfficialShopifyFetch,
  url: string,
  host: string,
  maximumBytes: number,
  label: string,
  requireExact = false
): Promise<string> {
  const fetched = await fetchDocument(url, host);
  const finalUrl = new URL(fetched.finalUrl);
  if (!fetched.response.ok || !sameHost(finalUrl, host)) throw new Error(`${label} unavailable`);
  if (requireExact && finalUrl.href !== new URL(url).href) throw new Error(`${label} identity changed`);
  const contentType = fetched.response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== undefined && contentType !== "text/html" && contentType !== "application/xml" && contentType !== "text/xml") {
    throw new Error(`${label} content type was unsupported`);
  }
  const length = fetched.response.headers.get("content-length");
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maximumBytes)) throw new Error(`${label} was too large`);
  const bytes = new Uint8Array(await fetched.response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) throw new Error(`${label} was too large`);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function approvedProductUrl(value: string, host: string, prefixes: readonly string[]): string | undefined {
  try {
    const url = new URL(value, `https://${host}`);
    if (!sameHost(url, host) || !prefixes.some((prefix) => url.pathname.startsWith(prefix))) return undefined;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const colorSelector = key.match(/^dwvar_([A-Za-z0-9_-]{1,64})_color$/u);
      if (colorSelector !== null && url.pathname.endsWith(`/${colorSelector[1]}.html`) &&
        /^[A-Za-z0-9_-]{1,40}$/u.test(url.searchParams.get(key) ?? "") && url.searchParams.getAll(key).length === 1) continue;
      if (!["color", "size", "variant", "type"].includes(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function approvedImageUrl(
  value: string | undefined,
  host: string,
  imageHosts: readonly string[],
  proxyOrigin: string | undefined
): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    const allowed = new Set([host, ...imageHosts.map((entry) => entry.toLocaleLowerCase("en-US"))]);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" || url.hash !== "" || !allowed.has(url.hostname.toLocaleLowerCase("en-US"))) {
      return undefined;
    }
    if (proxyOrigin === undefined || url.origin === proxyOrigin) return url.href;
    const proxy = new URL("/v1/official-images", proxyOrigin);
    proxy.searchParams.set("url", url.href);
    return proxy.href;
  } catch {
    return undefined;
  }
}

function verifiedHost(seed: OfficialShopifyStoreSeed): string {
  const host = seed.sourceHost.toLocaleLowerCase("en-US").replace(/\.$/u, "");
  const merchant = new URL(seed.merchantUrl);
  if (!sameHost(merchant, host)) throw new Error("official storefront host mismatch");
  const trust = resolveMerchantTrust(host, seed.merchant);
  if (trust.level !== "OFFICIAL" || trust.verification !== "INDEPENDENT") {
    throw new Error("official storefront was not independently verified");
  }
  return host;
}

function sameHost(url: URL, host: string): boolean {
  return url.protocol === "https:" && url.username === "" && url.password === "" && url.port === "" &&
    url.hostname.toLocaleLowerCase("en-US").replace(/\.$/u, "") === host;
}

function xmlLocations(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/giu)]
    .map((match) => decodeXml(match[1] ?? ""))
    .filter(Boolean);
}

function validSameHostUrl(value: string, host: string): boolean {
  try {
    return sameHost(new URL(value), host);
  } catch {
    return false;
  }
}

function sitemapPriority(value: string): number {
  return /product|shop|item|pdp/iu.test(new URL(value).pathname) ? 1 : 0;
}

function referenceScore(value: string, query: string): number {
  const candidate = new Set(tokens(value));
  return tokens(query).reduce((score, token) => score + (candidate.has(token) ? 1 : 0), 0);
}

function tokens(value: string): string[] {
  return (value.normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase("en-US").match(/[a-z0-9]+/gu) ?? [])
    .filter((token) => token.length > 1 && !["and", "the", "with", "women", "womens"].includes(token));
}

function compareReferences(left: CandidateReference, right: CandidateReference): number {
  return right.score - left.score || left.url.localeCompare(right.url);
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/gu, " ").replace(/&amp;/gu, "&").replace(/&quot;/gu, "\"")
    .replace(/&#39;|&apos;/gu, "'").replace(/\s+/gu, " ").trim();
}

function decodeXml(value: string): string {
  return value.trim().replace(/^<!\[CDATA\[|\]\]>$/gu, "").replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, "\"").replace(/&apos;/gu, "'").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">");
}

function isInStock(value: string | undefined): boolean {
  return value !== undefined && /(?:^|\/)InStock$/iu.test(value);
}

function sameValue(value: string | undefined, expected: string): boolean {
  return value !== undefined && value.normalize("NFKC").trim().toLowerCase() === expected.normalize("NFKC").trim().toLowerCase();
}

function validProxyOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" && url.port === "" && url.pathname === "/" && url.search === "" && url.hash === ""
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}
