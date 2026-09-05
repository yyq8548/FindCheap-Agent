import { z } from "zod";
import type { OfficialStorefrontRecord } from "../../../packages/contracts/src/index.js";

import { safeFetchWithProvenance } from "../../../packages/network-safety/src/safe-fetch.js";
import { resolveMerchantTrust } from "./merchant-trust.js";
import type { ShopifyProduct } from "./shopify-client.js";
import { ShopifyProductJsonSchema, shopifyVariantDimensions } from "./shopify-product-json.js";
import { createGenericOfficialStoreSearchPort } from "./generic-official-store-search.js";

const PredictiveProductSchema = z.object({
  handle: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,200}$/u),
  url: z.string().min(1).max(4_096)
}).passthrough();

const PredictiveSearchSchema = z.object({
  resources: z.object({
    results: z.object({
      products: z.array(PredictiveProductSchema).max(10)
    }).passthrough()
  }).passthrough()
}).passthrough();

const JsonLdOfferSchema = z.object({
  availability: z.string().max(300),
  price: z.union([z.number().nonnegative(), z.string().regex(/^\d+(?:\.\d{1,2})?$/u)]),
  priceCurrency: z.string().trim().length(3),
  url: z.string().url().max(4_096)
}).passthrough();

const JsonLdVariantSchema = z.object({
  name: z.string().trim().min(1).max(1_000),
  gtin: z.string().trim().max(300).optional(),
  mpn: z.string().trim().max(300).optional(),
  size: z.string().trim().max(300).optional(),
  color: z.string().trim().min(1).max(100).optional(),
  image: z.string().url().max(4_096).optional(),
  offers: JsonLdOfferSchema
}).passthrough();

const JsonLdProductGroupSchema = z.object({
  "@type": z.union([z.literal("ProductGroup"), z.array(z.string()).refine((values) => values.includes("ProductGroup"))]),
  name: z.string().trim().min(1).max(1_000),
  brand: z.union([
    z.string().trim().min(1).max(300),
    z.object({ name: z.string().trim().min(1).max(300) }).passthrough()
  ]).optional(),
  description: z.string().max(100_000).optional(),
  color: z.string().trim().min(1).max(100).optional(),
  image: z.union([z.string().url().max(4_096), z.array(z.string().url().max(4_096)).max(20)]).optional(),
  hasVariant: z.array(JsonLdVariantSchema).min(1).max(100)
}).passthrough();

type StorefrontProductReference = z.infer<typeof PredictiveProductSchema>;

export type OfficialShopifyStoreSeed = Pick<
  ShopifyProduct,
  "merchantId" | "merchant" | "sourceHost" | "merchantUrl" | "brand"
> & Partial<Pick<
  OfficialStorefrontRecord,
  "officialHost" | "platform" | "productPathPrefixes" | "searchPathTemplate" | "imageHosts"
>>;

export type OfficialShopifySearchInput = {
  seed: ShopifyProduct | OfficialShopifyStoreSeed;
  query: string;
  limit: number;
  sourcePageUrl?: string;
  requiredSize?: string;
  /** Explicit user constraint only, never inferred from a reference image. */
  requiredColor?: string;
  signal?: AbortSignal;
  /** Ephemeral identity of one bounded search; never a process-wide cache key. */
  cacheScope?: object;
};

export type OfficialStructuredProduct = {
  title: string;
  brand?: string | undefined;
  description?: string | undefined;
  variants: Array<{
    variantId: string;
    title: string;
    sku?: string | undefined;
    gtin?: string | undefined;
    size?: string | undefined;
    color?: string | undefined;
    imageUrl?: string | undefined;
    amountCents: number;
    available: boolean;
    merchantUrl: string;
  }>;
};

export interface OfficialShopifySearchPort {
  search(input: OfficialShopifySearchInput): Promise<ShopifyProduct[]>;
}

export type OfficialShopifyFetch = (
  url: string,
  allowedHost: string,
  signal?: AbortSignal
) => Promise<{ response: Response; finalUrl: string }>;

type Dependencies = {
  fetchDocument?: OfficialShopifyFetch;
  clock?: { now(): Date };
  imageProxyOrigin?: string;
};

export function createOfficialShopifySearchPort(
  dependencies: Dependencies = {}
): OfficialShopifySearchPort {
  const fetchDocument = dependencies.fetchDocument ?? ((url, allowedHost, signal) =>
    safeFetchWithProvenance({ url }, { allowedHosts: [allowedHost], ...(signal === undefined ? {} : { signal }) }));
  const clock = dependencies.clock ?? { now: () => new Date() };
  const scopes = new WeakMap<object, OfficialReadCache>();

  return {
    async search(input) {
      input.signal?.throwIfAborted();
      const sourceHost = verifiedOfficialHost(input.seed);
      let cache: OfficialReadCache | undefined;
      if (input.cacheScope !== undefined) {
        cache = scopes.get(input.cacheScope);
        if (cache === undefined) { cache = { reads: new Map(), bytes: 0 }; scopes.set(input.cacheScope, cache); }
      }
      const scopedFetch = scopedOfficialFetch(fetchDocument, cache, input.signal);
      if ("platform" in input.seed && input.seed.platform === "GENERIC_JSON_LD") {
        return createGenericOfficialStoreSearchPort({
          fetchDocument: scopedFetch, clock,
          ...(dependencies.imageProxyOrigin === undefined ? {} : { imageProxyOrigin: dependencies.imageProxyOrigin })
        }).search(input);
      }
      const direct = input.sourcePageUrl === undefined ? undefined : directProductReference(sourceHost, input.sourcePageUrl);
      const candidates = direct === undefined ? await findStorefrontProducts(
        scopedFetch,
        sourceHost,
        input.query,
        input.limit
      ) : [direct];
      const hydrated: Array<ShopifyProduct | undefined> = await Promise.all(candidates.map(
        async (candidate): Promise<ShopifyProduct | undefined> => {
          try {
            return await hydrateStorefrontProduct(
              scopedFetch,
              sourceHost,
              candidate,
              input.seed,
              clock.now(),
              direct?.variantId,
              input.requiredSize,
              input.requiredColor
            );
          } catch {
            input.signal?.throwIfAborted();
            if (direct !== undefined) throw new Error("official direct product unavailable");
            return undefined;
          }
      }));
      return hydrated.filter((product): product is ShopifyProduct => product !== undefined);
    }
  };
}

type CachedOfficialDocument = { text: string; status: number; headers: [string, string][]; finalUrl: string };
type OfficialReadCache = { reads: Map<string, Promise<CachedOfficialDocument>>; bytes: number };
const MAX_SCOPE_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_SCOPE_CACHE_ENTRIES = 32;

function scopedOfficialFetch(
  fetchDocument: OfficialShopifyFetch, cache: OfficialReadCache | undefined, signal: AbortSignal | undefined
): OfficialShopifyFetch {
  return async (url, host) => {
    signal?.throwIfAborted();
    // Search responses differ by query; reuse only bounded source documents.
    const cacheable = cache !== undefined && /(?:\.xml|\.js)$|\/products\//u.test(new URL(url).pathname);
    const key = `${host}:${url}`;
    let pending = cacheable ? cache.reads.get(key) : undefined;
    if (pending === undefined) {
      const read = async (): Promise<CachedOfficialDocument> => {
        const fetched = await (signal === undefined ? fetchDocument(url, host) : fetchDocument(url, host, signal));
        signal?.throwIfAborted();
        const reader = fetched.response.body?.getReader();
        const chunks: Uint8Array[] = [];
        const maxBytes = new URL(url).pathname.endsWith(".xml") ? 2 * 1024 * 1024 : 1024 * 1024;
        let size = 0;
        if (reader !== undefined) {
          const cancel = (): void => { void reader.cancel().catch(() => undefined); };
          signal?.addEventListener("abort", cancel, { once: true });
          try {
            for (;;) {
              const chunk = await reader.read();
              signal?.throwIfAborted();
              if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > maxBytes) { await reader.cancel(); throw new Error("official document size limit"); }
              chunks.push(chunk.value);
            }
          } finally { signal?.removeEventListener("abort", cancel); reader.releaseLock(); }
        }
        return { text: Buffer.concat(chunks).toString("utf8"), status: fetched.response.status,
          headers: [...fetched.response.headers], finalUrl: fetched.finalUrl };
      };
      pending = read();
      if (cacheable && cache.reads.size < MAX_SCOPE_CACHE_ENTRIES && cache.bytes < MAX_SCOPE_CACHE_BYTES) {
        cache.reads.set(key, pending);
        void pending.then((document) => {
          const size = Buffer.byteLength(document.text, "utf8");
          if (cache.bytes + size > MAX_SCOPE_CACHE_BYTES) cache.reads.delete(key);
          else cache.bytes += size;
        }, () => { cache.reads.delete(key); });
      }
    }
    const document = await pending;
    signal?.throwIfAborted();
    return { response: new Response(document.text, { status: document.status, headers: document.headers }), finalUrl: document.finalUrl };
  };
}

function directProductReference(host: string, value: string): StorefrontProductReference & { variantId?: string } {
  const url = new URL(value);
  const handle = url.pathname.match(/^\/products\/([A-Za-z0-9][A-Za-z0-9_-]{0,200})\/?$/u)?.[1];
  const variantId = url.searchParams.get("variant");
  if (handle === undefined || !validSameHostUrl(value, host) ||
    [...url.searchParams.keys()].some((key) => key !== "variant") ||
    url.searchParams.getAll("variant").length > 1 || (variantId !== null && !/^\d{1,30}$/u.test(variantId))) {
    throw new Error("official direct product URL invalid");
  }
  return { handle, url: `https://${host}/products/${handle}`, ...(variantId === null ? {} : { variantId }) };
}

async function findStorefrontProducts(
  fetchDocument: OfficialShopifyFetch,
  host: string,
  query: string,
  limit: number
): Promise<StorefrontProductReference[]> {
  let predictiveProducts: StorefrontProductReference[] = [];
  try {
    const predictiveUrl = predictiveSearchUrl(host, query, limit);
    const prediction = await fetchJson(fetchDocument, predictiveUrl, host, "official search");
    const parsed = PredictiveSearchSchema.parse(prediction);
    predictiveProducts = uniqueProducts(parsed.resources.results.products).slice(0, limit);
  } catch {
    // Headless Shopify storefronts often disable the legacy predictive-search endpoint.
  }
  let sitemapMatches: StorefrontProductReference[] = [];
  try {
    sitemapMatches = await sitemapProducts(fetchDocument, host, query, limit);
  } catch {
    if (predictiveProducts.length === 0) throw new Error("official storefront search unavailable");
  }
  return interleaveUniqueProducts(predictiveProducts, sitemapMatches, limit);
}

function interleaveUniqueProducts(
  predictiveProducts: StorefrontProductReference[],
  sitemapMatches: StorefrontProductReference[],
  limit: number
): StorefrontProductReference[] {
  const combined: StorefrontProductReference[] = [];
  const count = Math.max(predictiveProducts.length, sitemapMatches.length);
  for (let index = 0; index < count; index += 1) {
    const predictive = predictiveProducts[index];
    const sitemap = sitemapMatches[index];
    if (predictive !== undefined) combined.push(predictive);
    if (sitemap !== undefined) combined.push(sitemap);
  }
  return uniqueProducts(combined).slice(0, limit);
}

async function sitemapProducts(
  fetchDocument: OfficialShopifyFetch,
  host: string,
  query: string,
  limit: number
): Promise<StorefrontProductReference[]> {
  const rootUrl = `https://${host}/sitemap.xml`;
  const root = await fetchText(fetchDocument, rootUrl, host, "official sitemap");
  const productMaps = xmlLocations(root)
    .filter((url) => validSameHostUrl(url, host) && /sitemap[^/]*product/iu.test(new URL(url).pathname))
    .slice(0, 4);
  const mapUrls = productMaps.length > 0 ? productMaps : [`https://${host}/sitemap-products.xml`];
  const maps = await Promise.all(mapUrls.map(async (url) => {
    try {
      return await fetchText(fetchDocument, url, host, "official product sitemap");
    } catch {
      return "";
    }
  }));
  const queryTokens = searchableTokens(query);
  const ranked = maps.flatMap(productSitemapEntries)
    .map((entry) => ({ ...entry, score: sitemapScore(entry, queryTokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));
  return uniqueProducts(ranked.map((entry) => ({
    handle: entry.handle,
    url: entry.url
  }))).slice(0, limit);
}

async function hydrateStorefrontProduct(
  fetchDocument: OfficialShopifyFetch,
  host: string,
  candidate: StorefrontProductReference,
  seed: ShopifyProduct | OfficialShopifyStoreSeed,
  checkedAt: Date,
  requestedVariantId?: string,
  requiredSize?: string,
  requiredColor?: string
): Promise<ShopifyProduct> {
  const productUrl = exactProductUrl(host, candidate.url, candidate.handle);
  try {
    const productJsonUrl = `${productUrl}.js`;
    const fetched = await fetchDocument(productJsonUrl, host);
    if (canonicalHref(fetched.finalUrl) !== productJsonUrl) throw new Error("official product path changed");
    if (!fetched.response.ok) throw new Error("official product document unavailable");
    const product = ShopifyProductJsonSchema.parse(JSON.parse(await fetched.response.text()));
    if (product.handle !== candidate.handle) throw new Error("official product handle changed");
    const dimension = (entry: (typeof product.variants)[number], kind: "size" | "color") =>
      Object.entries(shopifyVariantDimensions(product.options, entry)).find(([name]) =>
        kind === "size" ? /size|尺码/iu.test(name) : /colou?r|颜色/iu.test(name))?.[1];
    const explicitVariant = product.variants.find((entry) => entry.id === requestedVariantId);
    const color = requiredColor ?? dimension(explicitVariant ?? product.variants[0]!, "color");
    const sameColor = product.variants.filter((entry) => color === undefined || sameDimension(dimension(entry, "color"), color));
    const eligible = sameColor.filter((entry) => requiredSize === undefined || sameDimension(dimension(entry, "size"), requiredSize));
    const variant = requestedVariantId === undefined
      ? eligible.find((entry) => entry.available) ?? eligible[0]
      : eligible.find((entry) => entry.id === requestedVariantId);
    if (variant === undefined) throw new Error("official product has no variant");
    const productType = officialProductType(product.title, product.product_type, product.type);
    return officialProduct(seed, host, checkedAt, {
      handle: variant.id,
      title: product.title,
      ...(productType === undefined ? {} : { productType }),
      description: product.description,
      brand: product.vendor?.trim(),
      sku: variant.sku ?? undefined,
      gtins: variant.barcode === undefined || variant.barcode === null || variant.barcode === ""
        ? []
        : [variant.barcode],
      variantDimensions: shopifyVariantDimensions(product.options, variant),
      availableSizes: [...new Set(sameColor.filter((entry) => entry.available).map((entry) => dimension(entry, "size")).filter((size): size is string => size !== undefined))],
      availabilityScope: requestedVariantId !== undefined || requiredSize !== undefined ? "SELECTED_VARIANT" : "PRODUCT_COLOR",
      imageUrl: product.featured_image ?? undefined,
      amountCents: variant.price,
      available: variant.available,
      merchantUrl: `${productUrl}?variant=${variant.id}`
    });
  } catch {
    const html = await fetchText(fetchDocument, productUrl, host, "official product page");
    const structured = parseOfficialStructuredProduct(html, host, candidate.handle);
    const requested = structured.variants.find((entry) => entry.variantId === requestedVariantId);
    const color = requiredColor ?? (requestedVariantId === undefined ? structured.variants[0]?.color : requested?.color);
    const sameColor = structured.variants.filter((entry) => color === undefined || sameDimension(entry.color, color));
    const eligible = sameColor.filter((entry) => requiredSize === undefined || sameDimension(entry.size, requiredSize));
    const variant = requestedVariantId === undefined
      ? eligible.find((entry) => entry.available) ?? eligible[0]
      : eligible.find((entry) => entry.variantId === requestedVariantId);
    if (variant === undefined) throw new Error("official structured product data was incomplete");
    return officialProduct(seed, host, checkedAt, {
      handle: variant.variantId,
      title: structured.title,
      description: structured.description,
      brand: structured.brand,
      sku: variant.sku,
      gtins: variant.gtin === undefined ? [] : [variant.gtin],
      variantDimensions: { ...(variant.size === undefined ? {} : { Size: variant.size }), ...(variant.color === undefined ? {} : { Color: variant.color }) },
      ...(color === undefined ? {} : { availableSizes: [...new Set(sameColor.filter((entry) => entry.available).flatMap((entry) => entry.size === undefined ? [] : [entry.size]))] }),
      availabilityScope: requestedVariantId !== undefined || requiredSize !== undefined || color === undefined ? "SELECTED_VARIANT" : "PRODUCT_COLOR",
      imageUrl: variant.imageUrl,
      amountCents: variant.amountCents,
      available: variant.available,
      merchantUrl: variant.merchantUrl
    });
  }
}

function officialProductType(
  title: string,
  productType: string | undefined,
  legacyType: string | undefined
): string | undefined {
  const explicit = productType?.trim();
  if (explicit) return explicit;
  const fallback = legacyType?.trim();
  if (fallback && !/^(?:pre-)?(?:spring|summer|fall|autumn|winter|holiday|resort)\s*\d{2,4}$/iu.test(fallback)) {
    return fallback;
  }
  return /\b(?:dress|gown)\b/iu.test(title) ? "Dresses" : undefined;
}

function officialProduct(
  seed: ShopifyProduct | OfficialShopifyStoreSeed,
  host: string,
  checkedAt: Date,
  product: {
    handle: string;
    title: string;
    productType?: string | undefined;
    description?: string | undefined;
    brand?: string | undefined;
    sku?: string | undefined;
    gtins: string[];
    variantDimensions: Record<string, string>;
    availableSizes?: string[];
    availabilityScope: "SELECTED_VARIANT" | "PRODUCT_COLOR";
    imageUrl?: string | null | undefined;
    amountCents: number;
    available: boolean;
    merchantUrl: string;
  }
): ShopifyProduct {
  return {
    merchantId: seed.merchantId,
    merchant: seed.merchant,
    sourceHost: host,
    merchantTrust: resolveMerchantTrust(host, seed.merchant),
    recommendationTier: "TRUSTED_OR_AFFILIATE",
    handle: product.handle,
    title: product.title,
    ...(product.productType === undefined ? {} : { productType: product.productType }),
    ...(product.description === undefined || product.description === ""
      ? {}
      : { description: stripHtml(product.description) }),
    brand: product.brand?.trim() || seed.brand || seed.merchant,
    ...(product.sku === undefined || product.sku === "" ? {} : { sku: product.sku }),
    gtins: product.gtins,
    variantDimensions: product.variantDimensions,
    ...(product.availableSizes === undefined ? {} : { availableSizes: product.availableSizes }),
    availabilityScope: product.availabilityScope,
    matchStatus: "DISCOVERY_MATCH",
    matchEvidence: ["matched the independently verified official Shopify storefront search"],
    condition: "UNKNOWN",
    ...optionalImage(product.imageUrl),
    itemPrice: { amountCents: product.amountCents, currency: "USD" },
    availability: product.available ? "IN_STOCK" : "OUT_OF_STOCK",
    merchantUrl: product.merchantUrl,
    checkedAt: checkedAt.toISOString()
  };
}

function verifiedOfficialHost(seed: ShopifyProduct | OfficialShopifyStoreSeed): string {
  const host = normalizeHost(seed.sourceHost);
  const url = new URL(seed.merchantUrl);
  if (normalizeHost(url.hostname) !== host) throw new Error("official storefront host mismatch");
  const trust = resolveMerchantTrust(host, seed.merchant);
  if (trust.level !== "OFFICIAL" || trust.verification !== "INDEPENDENT") {
    throw new Error("official storefront was not independently verified");
  }
  return host;
}

function predictiveSearchUrl(host: string, query: string, limit: number): string {
  const url = new URL(`https://${host}/search/suggest.json`);
  url.searchParams.set("q", query.normalize("NFKC").trim().slice(0, 300));
  url.searchParams.set("resources[type]", "product");
  url.searchParams.set("resources[limit]", String(Math.max(1, Math.min(10, limit))));
  return url.href;
}

function exactProductUrl(host: string, value: string, expectedHandle: string): string {
  const url = new URL(value, `https://${host}`);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    normalizeHost(url.hostname) !== host ||
    url.pathname !== `/products/${expectedHandle}`
  ) {
    throw new Error("official product path was invalid");
  }
  return `https://${host}${url.pathname}`;
}

async function fetchJson(
  fetchDocument: OfficialShopifyFetch,
  url: string,
  host: string,
  label: string
): Promise<unknown> {
  const fetched = await fetchDocument(url, host);
  if (canonicalHref(fetched.finalUrl) !== url) throw new Error(`${label} path changed`);
  if (!fetched.response.ok) throw new Error(`${label} unavailable`);
  return JSON.parse(await fetched.response.text());
}

async function fetchText(
  fetchDocument: OfficialShopifyFetch,
  url: string,
  host: string,
  label: string
): Promise<string> {
  const fetched = await fetchDocument(url, host);
  if (canonicalHref(fetched.finalUrl) !== canonicalHref(url)) throw new Error(`${label} path changed`);
  if (!fetched.response.ok) throw new Error(`${label} unavailable`);
  return fetched.response.text();
}

function xmlLocations(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/giu)]
    .map((match) => decodeXml(match[1] ?? ""))
    .filter(Boolean);
}

function productSitemapEntries(xml: string): Array<{ handle: string; url: string; title: string }> {
  const entries: Array<{ handle: string; url: string; title: string }> = [];
  for (const match of xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/giu)) {
    const block = match[1] ?? "";
    const location = block.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/iu)?.[1];
    if (location === undefined) continue;
    const url = decodeXml(location);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    const handleMatch = parsed.pathname.match(/^\/products\/([A-Za-z0-9][A-Za-z0-9_-]{0,200})\/?$/u);
    if (handleMatch?.[1] === undefined) continue;
    const imageTitle = block.match(/<(?:image:)?title>\s*([\s\S]*?)\s*<\/(?:image:)?title>/iu)?.[1];
    entries.push({
      handle: handleMatch[1],
      url: parsed.href,
      title: imageTitle === undefined ? handleMatch[1].replace(/[-_]+/gu, " ") : decodeXml(imageTitle)
    });
  }
  return entries;
}

function sitemapScore(
  entry: { handle: string; title: string },
  queryTokens: string[]
): number {
  const candidate = new Set(searchableTokens(`${entry.handle} ${entry.title}`));
  return queryTokens.reduce((score, token) => score + (candidate.has(token) ? 1 : 0), 0);
}

function searchableTokens(value: string): string[] {
  return (value.normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase("en-US")
    .replace(/\b(?:onyx)\b/gu, " black ")
    .replace(/\bgr(?:a|e)y\b/gu, " gray ")
    .match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((token) => token.length > 1 && !["and", "the", "with"].includes(token));
}

function decodeXml(value: string): string {
  return value.trim()
    .replace(/^<!\[CDATA\[|\]\]>$/gu, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function validSameHostUrl(value: string, host: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" &&
      url.port === "" && normalizeHost(url.hostname) === host;
  } catch {
    return false;
  }
}

export function parseOfficialStructuredProduct(
  html: string,
  host: string,
  expectedHandle: string
): OfficialStructuredProduct {
  const group = productGroupFromHtml(html);
  const brand = typeof group.brand === "string" ? group.brand : group.brand?.name;
  const fallbackImage = Array.isArray(group.image) ? group.image[0] : group.image;
  const variants = group.hasVariant.flatMap((variant) => {
    if (variant.offers.priceCurrency.toUpperCase() !== "USD") return [];
    const merchantUrl = exactVariantUrl(host, variant.offers.url, expectedHandle);
    const variantId = new URL(merchantUrl).searchParams.get("variant");
    if (variantId === null || !/^\d{1,30}$/u.test(variantId)) {
      throw new Error("official structured variant id was invalid");
    }
    const price = typeof variant.offers.price === "number" ? variant.offers.price : Number(variant.offers.price);
    const amountCents = Math.round(price * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents < 0 || amountCents > 100_000_000) {
      throw new Error("official structured price was invalid");
    }
    return [{
      variantId,
      title: variant.name,
      ...(variant.mpn === undefined || variant.mpn === "" ? {} : { sku: variant.mpn }),
      ...(variant.gtin === undefined || variant.gtin === "" ? {} : { gtin: variant.gtin }),
      ...(variant.size === undefined || variant.size === "" ? {} : { size: variant.size }),
      ...((variant.color ?? group.color) === undefined ? {} : { color: variant.color ?? group.color }),
      ...((variant.image ?? fallbackImage) === undefined ? {} : { imageUrl: variant.image ?? fallbackImage }),
      amountCents,
      available: isInStock(variant.offers.availability),
      merchantUrl
    }];
  });
  if (variants.length === 0) throw new Error("official structured product data was incomplete");
  return {
    title: group.name,
    ...(brand === undefined ? {} : { brand }),
    ...(group.description === undefined ? {} : { description: group.description }),
    variants
  };
}

function productGroupFromHtml(html: string): z.infer<typeof JsonLdProductGroupSchema> {
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)) {
    try {
      const found = findProductGroup(JSON.parse(match[1] ?? ""));
      if (found !== undefined) return JsonLdProductGroupSchema.parse(found);
    } catch {
      // Ignore unrelated or malformed JSON-LD blocks.
    }
  }
  throw new Error("official product structured data unavailable");
}

function findProductGroup(value: unknown): unknown | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findProductGroup(entry);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (type === "ProductGroup" || (Array.isArray(type) && type.includes("ProductGroup"))) return value;
  return findProductGroup(record["@graph"]);
}

function exactVariantUrl(host: string, value: string, expectedHandle: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    normalizeHost(url.hostname) !== host ||
    url.pathname !== `/products/${expectedHandle}`
  ) {
    throw new Error("official structured variant URL was invalid");
  }
  url.hash = "";
  return url.href;
}

function isInStock(value: string): boolean {
  return /(?:^|\/)InStock$/iu.test(value);
}

function uniqueProducts(
  products: z.infer<typeof PredictiveProductSchema>[]
): z.infer<typeof PredictiveProductSchema>[] {
  const seen = new Set<string>();
  return products.filter((product) => {
    if (seen.has(product.handle)) return false;
    seen.add(product.handle);
    return true;
  });
}

function normalizeHost(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\.$/u, "");
}

function sameDimension(value: string | undefined, required: string): boolean {
  return value !== undefined && value.normalize("NFKC").trim().toLowerCase() === required.normalize("NFKC").trim().toLowerCase();
}

function canonicalHref(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 20_000);
}

function optionalImage(value: string | null | undefined): { imageUrl?: string } {
  if (value === undefined || value === null || value === "") return {};
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return {};
    return { imageUrl: url.href };
  } catch {
    return {};
  }
}
