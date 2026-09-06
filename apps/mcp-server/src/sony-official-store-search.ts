import { z } from "zod";

import { safeFetchWithProvenance } from "../../../packages/network-safety/src/safe-fetch.js";
import { resolveMerchantTrust, merchantRecommendationTier } from "./merchant-trust.js";
import { evaluateFeature } from "./product-constraint-matcher.js";
import { classifyShopifyCandidate } from "./shopify-match.js";
import type { ShopifyCondition, ShopifyProduct } from "./shopify-client.js";
import type { OfficialShopifyFetch, OfficialShopifySearchPort } from "./shopify-official-store-search.js";

export const SONY_API_HOST = "api.cqiypyix22-sonyelect1-p1-public.model-t.cc.commerce.ondemand.com";
const STORE_HOST = "electronics.sony.com";
const IMAGE_HOST = "d1ncau8tqf99kp.cloudfront.net";
const API_PREFIX = "/occ/v2/sna/products/";
const MAX_BYTES = 512 * 1024;
const Code = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/u);
const Price = z.object({ currencyIso: z.literal("USD"), value: z.number().finite().positive().max(1_000_000) });
const Stock = z.object({ status: z.enum(["instock", "outofstock"]).optional(),
  stockLevelStatus: z.enum(["inStock", "outOfStock"]).optional() }).passthrough().refine(value =>
  (value.status !== undefined || value.stockLevelStatus !== undefined) &&
  (value.status === undefined || value.stockLevelStatus === undefined ||
    (value.status === "instock") === (value.stockLevelStatus === "inStock")));
const Option = z.object({ code: Code, url: z.string().max(4096), priceData: Price, stock: Stock,
  variants: z.array(z.object({ variant: z.string().max(200), value: z.string().max(200) })).max(20) }).passthrough();
const Detail = z.object({ code: Code, name: z.string().min(1).max(1000), summary: z.string().min(1).max(5000),
  description: z.string().max(100_000).default(""), baseProduct: Code, url: z.string().max(4096), canonicalUrl: z.string().max(4096),
  gwModel: z.string().min(1).max(100).optional(), superModelName: z.string().min(1).max(100).optional(),
  price: Price, stock: Stock, purchasable: z.boolean(), notSellable: z.boolean(),
  baseOptions: z.array(z.object({ selected: Option, options: z.array(Option).min(1).max(30),
    variantType: z.literal("SNAProductVariant") })).length(1),
  upc: z.string().regex(/^\d{8,14}$/u).optional(),
  images: z.array(z.object({ imageType: z.string(), format: z.string(), url: z.string().max(4096) })).max(100).optional()
}).passthrough();
type SonyDetail = z.infer<typeof Detail>;

/** Fixed, reviewed public product reads only. A source redirect cannot select a new endpoint. */
export function createSonyOfficialDocumentFetch(fetchPage: typeof safeFetchWithProvenance = safeFetchWithProvenance): OfficialShopifyFetch {
  return async (url, host, signal, onRead) => {
    if (host !== SONY_API_HOST) throw new Error("SONY_SOURCE_REJECTED");
    validateApiUrl(url);
    let requests = 0;
    const result = await fetchPage({ url }, { allowedHosts: [SONY_API_HOST], maxResponseBytes: MAX_BYTES,
      ...(signal === undefined ? {} : { signal }), onRead: delta => {
        requests += delta.requests ?? 0;
        if (requests > 1) throw new Error("SONY_REDIRECT_REJECTED");
        onRead?.(delta);
      } });
    if (result.finalUrl !== url) throw new Error("SONY_REDIRECT_REJECTED");
    return result;
  };
}
export const fetchSonyOfficialDocument = createSonyOfficialDocumentFetch();

export function createSonyOfficialSearchPort(dependencies: { fetchDocument?: OfficialShopifyFetch; clock?: { now(): Date } } = {}): OfficialShopifySearchPort {
  const fetchDocument = dependencies.fetchDocument ?? fetchSonyOfficialDocument;
  return { async search(input) {
    input.signal?.throwIfAborted();
    const trust = resolveMerchantTrust(STORE_HOST);
    const merchantUrl = new URL(input.seed.merchantUrl);
    if (input.seed.sourceHost !== STORE_HOST || merchantUrl.origin !== `https://${STORE_HOST}` ||
      merchantUrl.username || merchantUrl.password || merchantUrl.hash ||
      !("platform" in input.seed) || input.seed.platform !== "SONY_OCC" ||
      trust.level !== "OFFICIAL" || trust.verification !== "INDEPENDENT") throw new Error("SONY_SOURCE_REJECTED");
    let requests = 0;
    let bytes = 0;
    const sourceController = new AbortController();
    const signal = input.signal === undefined ? sourceController.signal : AbortSignal.any([input.signal, sourceController.signal]);
    const accountBytes = (count: number): void => {
      // Count while consuming each chunk, before retaining/processing it. A final
      // delivered network chunk may cross the cap; never read the rest of that body.
      bytes += count;
      if (bytes > 2 * 1024 * 1024) {
        const error = new Error("SONY_READ_BUDGET_EXHAUSTED"); sourceController.abort(error); throw error;
      }
    };
    const read = async (url: string): Promise<unknown> => {
      signal.throwIfAborted();
      validateApiUrl(url);
      if (++requests > 7) throw new Error("SONY_READ_BUDGET_EXHAUSTED");
      let observedBytes = 0; let cached = false;
      const fetched = await fetchDocument(url, SONY_API_HOST, signal, delta => {
        input.onRead?.(delta);
        cached ||= (delta.cacheHits ?? 0) > 0;
        observedBytes += delta.bytes ?? 0;
        accountBytes(delta.bytes ?? 0);
      });
      signal.throwIfAborted();
      if (fetched.finalUrl !== url || !fetched.response.ok ||
        !/^application\/json(?:;|$)/iu.test(fetched.response.headers.get("content-type") ?? "")) throw new Error("SONY_SOURCE_UNAVAILABLE");
      const body = await boundedBody(fetched.response, signal, observedBytes > 0 || cached ? undefined : count => {
        input.onRead?.({ bytes: count }); accountBytes(count);
      });
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
    };
    const readDetail = async (code: string): Promise<SonyDetail> => {
      const product = Detail.parse(await read(apiUrl(Code.parse(code))));
      verifyDetail(product, code);
      return product;
    };
    let codes: string[];
    if (input.sourcePageUrl !== undefined) {
      codes = [productCode(input.sourcePageUrl)];
    } else {
      const url = apiUrl("search");
      const search = new URL(url);
      search.searchParams.set("query", input.query.slice(0, 300));
      search.searchParams.set("pageSize", "6");
      search.searchParams.set("fields", "products(code,name,summary,url),pagination");
      const data = z.object({ products: z.array(z.object({ code: Code, url: z.string().max(4096) })).max(6) }).parse(await read(search.href));
      codes = [...new Set(data.products.map(product => {
        if (productCode(product.url) !== product.code) throw new Error("SONY_PRODUCT_IDENTITY_INVALID");
        return product.code;
      }))].filter(code => matchesRequestedModel(code, input.query)).slice(0, Math.min(3, Math.max(1, input.limit)));
    }
    const products: ShopifyProduct[] = [];
    // Two workers share one bounded request/byte ledger. Failures are never converted to a successful empty search.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(2, codes.length) }, async () => {
      try {
        while (next < codes.length) {
          signal.throwIfAborted();
          const code = codes[next++]!;
          let product = await readDetail(code);
          const selected = product.baseOptions[0]!.selected;
          if (input.requiredColor !== undefined && !matchesColor(colorOf(selected), input.requiredColor)) {
            if (input.sourcePageUrl !== undefined) continue;
            const matches = product.baseOptions[0]!.options.filter(option => matchesColor(colorOf(option), input.requiredColor!));
            if (matches.length !== 1) continue;
            const original = product;
            product = await readDetail(matches[0]!.code);
            if (product.baseProduct !== original.baseProduct || !matchesColor(colorOf(product.baseOptions[0]!.selected), input.requiredColor)) {
              throw new Error("SONY_VARIANT_IDENTITY_INVALID");
            }
          }
          signal.throwIfAborted();
          if (input.requiredSize !== undefined) continue;
          const result = toProduct(product, dependencies.clock?.now() ?? new Date());
          const identity = classifyShopifyCandidate(`${input.seed.brand ?? ""} ${input.query}`, result);
          if (identity.status === "IRRELEVANT") continue;
          if (!products.some(entry => entry.merchantUrl === result.merchantUrl)) products.push({ ...result,
            matchStatus: identity.status, matchEvidence: [...result.matchEvidence, ...identity.evidence] });
        }
      } catch (error) { sourceController.abort(error); throw error; }
    }));
    signal.throwIfAborted();
    return products;
  } };
}

function apiUrl(code: string): string {
  const url = new URL(API_PREFIX + code, `https://${SONY_API_HOST}`);
  url.searchParams.set("fields", "FULL");
  url.searchParams.set("lang", "en");
  url.searchParams.set("curr", "USD");
  return url.href;
}

function validateApiUrl(value: string): void {
  const url = new URL(value);
  if (url.origin !== `https://${SONY_API_HOST}` || url.username || url.password || url.hash ||
    !/^\/occ\/v2\/sna\/products\/[a-z0-9][a-z0-9_-]{0,99}$/u.test(url.pathname) ||
    [...url.searchParams.keys()].some(key => !["query", "pageSize", "fields", "lang", "curr"].includes(key) || url.searchParams.getAll(key).length !== 1)) {
    throw new Error("SONY_SOURCE_REJECTED");
  }
}

function productCode(value: string): string {
  const url = new URL(value, `https://${STORE_HOST}`);
  const match = url.pathname.match(/^\/audio\/(?:[a-z0-9-]+\/){1,4}p\/([a-z0-9][a-z0-9_-]{0,99})$/u);
  if (url.origin !== `https://${STORE_HOST}` || url.username || url.password || url.search || url.hash || match?.[1] === undefined) {
    throw new Error("SONY_PRODUCT_URL_INVALID");
  }
  return match[1];
}

function verifyDetail(product: SonyDetail, code: string): void {
  const selected = product.baseOptions[0]!.selected;
  const options = product.baseOptions[0]!.options;
  const option = options.filter(entry => entry.code === code);
  if ((product.gwModel !== undefined || product.superModelName !== undefined) &&
    (product.gwModel === undefined || product.superModelName === undefined || !product.baseProduct.endsWith("_base") ||
      compact(product.gwModel) !== compact(product.superModelName) ||
      compact(product.gwModel) !== compact(product.baseProduct.slice(0, -5)) ||
      compact(product.gwModel) !== compact(code.replace(/-[a-z]$/u, "")) ||
      options.some(entry => compact(entry.code.replace(/-[a-z]$/u, "")) !== compact(product.gwModel!)))) {
    throw new Error("SONY_MODEL_IDENTITY_INVALID");
  }
  if (product.code !== code || selected.code !== code || productCode(product.url) !== code ||
    productCode(product.canonicalUrl) !== code || productCode(selected.url) !== code ||
    new URL(product.url, `https://${STORE_HOST}`).href !== new URL(product.canonicalUrl, `https://${STORE_HOST}`).href ||
    new URL(selected.url, `https://${STORE_HOST}`).href !== new URL(product.canonicalUrl, `https://${STORE_HOST}`).href ||
    option.length !== 1 || colorOf(option[0]!) !== colorOf(selected) ||
    cents(product.price.value) !== cents(selected.priceData.value) || cents(option[0]!.priceData.value) !== cents(selected.priceData.value) ||
    inStock(product.stock) !== inStock(selected.stock) || inStock(option[0]!.stock) !== inStock(selected.stock) ||
    options.some(entry => productCode(entry.url) !== entry.code) || new Set(options.map(entry => entry.code)).size !== options.length) {
    throw new Error("SONY_VARIANT_IDENTITY_INVALID");
  }
}

function colorOf(option: z.infer<typeof Option>): string {
  const colors = option.variants.filter(entry => entry.variant === "SNAClassification/1.0/VariantType.color");
  const color = colors[0]?.value.split("|")[1]?.trim();
  if (colors.length !== 1 || color === undefined || color === "") throw new Error("SONY_VARIANT_COLOR_INVALID");
  return color;
}

function toProduct(product: SonyDetail, checkedAt: Date): ShopifyProduct {
  const trust = resolveMerchantTrust(STORE_HOST);
  const model = product.gwModel;
  const base = product.baseProduct.replace(/_base$/u, "");
  const mpn = model !== undefined && compact(model) === compact(product.superModelName ?? "") && compact(base) === compact(model) ? model : undefined;
  const image = product.images?.find(entry => entry.imageType === "PRIMARY" && entry.format === "zoom")?.url;
  let imageUrl: string | undefined;
  if (image !== undefined) {
    const url = new URL(image);
    if (url.origin === `https://${IMAGE_HOST}` && !url.username && !url.password && !url.hash) imageUrl = url.href;
  }
  const result = {
    merchantId: `official-${STORE_HOST}`, merchant: "Sony", sourceHost: STORE_HOST, merchantTrust: trust,
    recommendationTier: merchantRecommendationTier(trust, undefined), handle: `sony-${product.code}`,
    title: stripHtml(product.summary), description: stripHtml(product.description).slice(0, 20_000), brand: "Sony",
    sku: product.code, ...(mpn === undefined ? {} : { mpn }), gtins: product.upc === undefined ? [] : [product.upc],
    variantDimensions: { Color: colorOf(product.baseOptions[0]!.selected) }, availabilityScope: "SELECTED_VARIANT" as const,
    matchStatus: "DISCOVERY_MATCH" as const,
    matchEvidence: ["Sony public product API: selected SKU, canonical URL, color, price and stock bound",
      ...(mpn === undefined ? [] : ["Sony source gwModel and superModelName agree with baseProduct"]),
      "Sony condition policy reviewed 2026-09-06: https://electronics.sony.com/terms-conditions; explicit product condition takes precedence"],
    condition: conditionOf(product), ...(imageUrl === undefined ? {} : { imageUrl }),
    itemPrice: { amountCents: cents(product.price.value), currency: "USD" as const },
    availability: !inStock(product.stock) ? "OUT_OF_STOCK" as const
      : product.purchasable && !product.notSellable ? "IN_STOCK" as const : "UNKNOWN" as const,
    merchantUrl: new URL(product.canonicalUrl, `https://${STORE_HOST}`).href, checkedAt: checkedAt.toISOString(), checkoutPlatform: "MERCHANT" as const
  };
  return result;
}

function conditionOf(product: SonyDetail): ShopifyCondition {
  const records: Record<string, unknown>[] = [product, product.baseOptions[0]!.selected,
    product.baseOptions[0]!.options.find(entry => entry.code === product.code)!];
  const conditions = new Set<ShopifyCondition>();
  for (const record of records) if (record.isRefurbished !== undefined) {
    if (record.isRefurbished === true) conditions.add("REFURBISHED");
    else if (record.isRefurbished !== false) conditions.add("UNKNOWN");
  }
  for (const record of records) for (const key of ["condition", "itemCondition"]) {
    if (record[key] === undefined) continue;
    const value = typeof record[key] === "string" ? record[key].replace(/^https?:\/\/schema.org\//u, "").toLowerCase().replace(/[ _-]/gu, "") : "";
    conditions.add(({ new: "NEW", newcondition: "NEW", refurbished: "REFURBISHED", refurbishedcondition: "REFURBISHED",
      used: "USED", usedcondition: "USED", openbox: "OPEN_BOX" } as Record<string, ShopifyCondition>)[value] ?? "UNKNOWN");
  }
  const label = `${product.code} ${product.name} ${stripHtml(product.summary)}`;
  const prose = stripHtml(product.description);
  if (/\b(?:refurbished|renewed|reconditioned)\b/iu.test(`${label} ${prose}`)) conditions.add("REFURBISHED");
  if (/\bopen[ -]?box\b/iu.test(`${label} ${prose}`)) conditions.add("OPEN_BOX");
  if (/\b(?:used|pre[ -]?owned|like[ -]?new)\b/iu.test(label) || /\b(?:condition\s*[:=-]?\s*(?:used|like[ -]?new)|pre[ -]?owned)\b/iu.test(prose)) conditions.add("USED");
  if (/\b(?:damaged|for[ -]?parts)\b/iu.test(label) || /\bcondition\s*[:=-]?\s*(?:damaged|for[ -]?parts)\b/iu.test(prose)) conditions.add("UNKNOWN");
  if (/\bcondition\s*[:=-]?\s*(?:unknown|unspecified)\b/iu.test(`${label} ${prose}`)) conditions.add("UNKNOWN");
  if (conditions.size === 0) return "NEW";
  return conditions.size === 1 ? [...conditions][0]! : "UNKNOWN";
}

async function boundedBody(response: Response, signal?: AbortSignal, onBytes?: (count: number) => void): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("SONY_SOURCE_UNAVAILABLE");
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      onBytes?.(value.byteLength);
      if (length > MAX_BYTES) throw new Error("SONY_RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { signal?.removeEventListener("abort", abort); reader.releaseLock(); }
}

function inStock(stock: z.infer<typeof Stock>): boolean { return stock.status === "instock" || stock.stockLevelStatus === "inStock"; }
function matchesRequestedModel(code: string, query: string): boolean {
  const models = (query.match(/[a-z0-9]+(?:-[a-z0-9]+)*/giu) ?? []).filter(token =>
    /^[a-z][a-z0-9-]{3,}$/iu.test(token) && /\d/u.test(token));
  // Sony's observed color SKU suffix is one letter. This only narrows discovery;
  // model evidence still comes from the subsequently verified FULL document.
  const sourceIds = [compact(code), compact(code.replace(/-[a-z]$/u, ""))];
  return models.length === 0 || models.some(model => sourceIds.includes(compact(model)));
}
function matchesColor(actual: string, required: string): boolean { return compact(actual) === compact(required) || evaluateFeature(actual, required) === "MATCHED"; }
function compact(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/gu, ""); }
function cents(value: number): number { return Math.round(value * 100); }
function stripHtml(value: string): string { return value.replace(/<[^>]*>/gu, " ").replace(/&nbsp;/giu, " ").replace(/&amp;/giu, "&").replace(/\s+/gu, " ").trim(); }
