import { z } from "zod";

import { safeFetchWithProvenance } from "../../../packages/network-safety/src/safe-fetch.js";
import { resolveMerchantTrust } from "./merchant-trust.js";
import type { ShopifyProduct } from "./shopify-client.js";
import { ShopifyProductJsonSchema, shopifyVariantDimensions } from "./shopify-product-json.js";

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
  image: z.union([z.string().url().max(4_096), z.array(z.string().url().max(4_096)).max(20)]).optional(),
  hasVariant: z.array(JsonLdVariantSchema).min(1).max(100)
}).passthrough();

type StorefrontProductReference = z.infer<typeof PredictiveProductSchema>;

export type OfficialShopifyStoreSeed = Pick<
  ShopifyProduct,
  "merchantId" | "merchant" | "sourceHost" | "merchantUrl" | "brand"
>;

export type OfficialShopifySearchInput = {
  seed: ShopifyProduct | OfficialShopifyStoreSeed;
  query: string;
  limit: number;
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
  allowedHost: string
) => Promise<{ response: Response; finalUrl: string }>;

type Dependencies = {
  fetchDocument?: OfficialShopifyFetch;
  clock?: { now(): Date };
};

export function createOfficialShopifySearchPort(
  dependencies: Dependencies = {}
): OfficialShopifySearchPort {
  const fetchDocument = dependencies.fetchDocument ?? ((url, allowedHost) =>
    safeFetchWithProvenance({ url }, { allowedHosts: [allowedHost] }));
  const clock = dependencies.clock ?? { now: () => new Date() };

  return {
    async search(input) {
      const sourceHost = verifiedOfficialHost(input.seed);
      const candidates = await findStorefrontProducts(
        fetchDocument,
        sourceHost,
        input.query,
        input.limit
      );
      const hydrated: Array<ShopifyProduct | undefined> = await Promise.all(candidates.map(
        async (candidate): Promise<ShopifyProduct | undefined> => {
          try {
            return await hydrateStorefrontProduct(
              fetchDocument,
              sourceHost,
              candidate,
              input.seed,
              clock.now()
            );
          } catch {
            return undefined;
          }
      }));
      return hydrated.filter((product): product is ShopifyProduct => product !== undefined);
    }
  };
}

async function findStorefrontProducts(
  fetchDocument: OfficialShopifyFetch,
  host: string,
  query: string,
  limit: number
): Promise<StorefrontProductReference[]> {
  try {
    const predictiveUrl = predictiveSearchUrl(host, query, limit);
    const prediction = await fetchJson(fetchDocument, predictiveUrl, host, "official search");
    const parsed = PredictiveSearchSchema.parse(prediction);
    const products = uniqueProducts(parsed.resources.results.products).slice(0, limit);
    if (products.length > 0) return products;
  } catch {
    // Headless Shopify storefronts often disable the legacy predictive-search endpoint.
  }
  return sitemapProducts(fetchDocument, host, query, limit);
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
  checkedAt: Date
): Promise<ShopifyProduct> {
  const productUrl = exactProductUrl(host, candidate.url, candidate.handle);
  try {
    const productJsonUrl = `${productUrl}.js`;
    const fetched = await fetchDocument(productJsonUrl, host);
    if (canonicalHref(fetched.finalUrl) !== productJsonUrl) throw new Error("official product path changed");
    if (!fetched.response.ok) throw new Error("official product document unavailable");
    const product = ShopifyProductJsonSchema.parse(JSON.parse(await fetched.response.text()));
    if (product.handle !== candidate.handle) throw new Error("official product handle changed");
    const variant = product.variants.find((entry) => entry.available) ?? product.variants[0];
    if (variant === undefined) throw new Error("official product has no variant");
    const productType = product.product_type?.trim() || product.type?.trim();
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
      imageUrl: product.featured_image ?? undefined,
      amountCents: variant.price,
      available: variant.available,
      merchantUrl: `${productUrl}?variant=${variant.id}`
    });
  } catch {
    const html = await fetchText(fetchDocument, productUrl, host, "official product page");
    const structured = parseOfficialStructuredProduct(html, host, candidate.handle);
    const variant = structured.variants.find((entry) => entry.available) ?? structured.variants[0];
    if (variant === undefined) throw new Error("official structured product data was incomplete");
    return officialProduct(seed, host, checkedAt, {
      handle: variant.variantId,
      title: structured.title,
      description: structured.description,
      brand: structured.brand,
      sku: variant.sku,
      gtins: variant.gtin === undefined ? [] : [variant.gtin],
      variantDimensions: variant.size === undefined ? {} : { Size: variant.size },
      imageUrl: variant.imageUrl,
      amountCents: variant.amountCents,
      available: variant.available,
      merchantUrl: variant.merchantUrl
    });
  }
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
