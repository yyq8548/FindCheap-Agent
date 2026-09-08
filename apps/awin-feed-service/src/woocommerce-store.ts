import { z } from "zod";
import { WooProductSchema, type WooProduct, type WooVariantRequirements, type WooStoreResult } from "../../../packages/contracts/src/woocommerce.js";
import { createPinnedRequest, safeFetchWithProvenance, type FetchPolicy } from "../../../packages/network-safety/src/safe-fetch.js";
import { wooProductUrl, type WooMerchant } from "./woocommerce-registry.js";

const Id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const RawAttribute = z.object({ name: z.string().max(80), value: z.string().max(300).optional(), terms: z.array(z.object({ name: z.string().max(300) }).passthrough()).max(100).optional() }).passthrough();
const RawProduct = z.object({
  id: Id, parent: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(), name: z.string().min(1).max(500), type: z.string().max(80), permalink: z.string().max(4_096),
  sku: z.string().max(300).optional(), description: z.string().max(200_000).optional(), is_password_protected: z.boolean().optional(),
  prices: z.object({ price: z.string().max(32).optional(), currency_code: z.string().regex(/^[A-Z]{3}$/u), currency_minor_unit: z.number().int().min(0).max(6) }).passthrough(),
  is_in_stock: z.boolean().optional(), is_on_backorder: z.boolean().optional(), stock_status: z.string().max(40).optional(),
  average_rating: z.string().max(20).optional(), review_count: z.number().int().nonnegative().max(100_000_000).optional(),
  images: z.array(z.object({ id: z.number().int().nonnegative(), src: z.string().max(4_096) }).passthrough()).max(100).optional(),
  attributes: z.array(RawAttribute).max(24).optional(), categories: z.array(z.object({ name: z.string().max(300) }).passthrough()).max(100).optional(),
  brands: z.array(z.object({ name: z.string().max(300) }).passthrough()).max(20).optional(),
  variations: z.array(z.object({ id: Id, attributes: z.array(RawAttribute).max(24) }).passthrough()).max(500).optional(),
  _links: z.object({ up: z.array(z.object({ href: z.string().max(4_096) }).passthrough()).max(2).optional() }).passthrough().optional()
}).passthrough();
export type WooRawProduct = z.infer<typeof RawProduct>;
export type WooFailureReason = NonNullable<WooStoreResult["reason"]>;
export class WooReadError extends Error {
  constructor(readonly reason: WooFailureReason, readonly retryAfterMs?: number) { super(reason); }
}
export type WooReadBudget = {
  signal: AbortSignal; requests: number; bytes: number; maxRequests: number; maxBytes: number;
  onRequest?: () => void;
};
export type WooStoreReader = ReturnType<typeof createWooStoreReader>;

export function createWooStoreReader(dependencies: Pick<FetchPolicy, "resolve" | "request"> & { acquire?: (merchantId: string, signal: AbortSignal) => Promise<() => void> } = {}) {
  const request = dependencies.request ?? createPinnedRequest();
  async function get(store: WooMerchant, path: string, params: URLSearchParams, budget: WooReadBudget): Promise<{ value: unknown; totalPages: number }> {
    const url = new URL(`${store.apiPath}/products${path}`, store.origin);
    url.search = params.toString();
    const signal = AbortSignal.any([budget.signal, AbortSignal.timeout(3_000)]);
    let release: (() => void) | undefined;
    try {
      release = await dependencies.acquire?.(store.merchantId, signal);
      const result = await safeFetchWithProvenance({ url: url.href }, {
        ...dependencies, allowedHosts: [new URL(store.origin).hostname], signal, maxResponseBytes: 1024 * 1024,
        request: async (target, init, addresses) => {
          if (target.href !== url.href) throw new Error("request blocked: Woo API redirects are not allowed");
          const response = await request(target, init, addresses);
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            await response.body?.cancel();
            throw new Error("request blocked: Woo API redirects are not allowed");
          }
          return response;
        },
        onRead(delta) {
          if (delta.requests !== undefined) {
            if (budget.requests + delta.requests > budget.maxRequests) throw new WooReadError("BUDGET_EXHAUSTED");
            budget.requests += delta.requests;
            budget.onRequest?.();
          }
          if (delta.bytes !== undefined) {
            if (budget.bytes + delta.bytes > budget.maxBytes) throw new WooReadError("BUDGET_EXHAUSTED");
            budget.bytes += delta.bytes;
          }
        }
      });
      if (!new URL(result.finalUrl).pathname.startsWith(`${store.apiPath}/products`)) throw new WooReadError("SECURITY_REJECTED");
      const response = result.response;
      if (response.status === 404) throw new WooReadError("NOT_FOUND");
      if (response.status === 401 || response.status === 403) throw new WooReadError("ACCESS_DENIED");
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        const seconds = retryAfter === null ? NaN : Number(retryAfter);
        const delay = Number.isFinite(seconds) ? seconds * 1000 : retryAfter === null ? NaN : Date.parse(retryAfter) - Date.now();
        throw new WooReadError("RATE_LIMITED", Number.isFinite(delay) ? Math.max(0, delay) : 300_000);
      }
      if (!response.ok) throw new WooReadError("UPSTREAM_UNAVAILABLE");
      if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new WooReadError("INVALID_RESPONSE");
      const value: unknown = await response.json();
      assertBoundedJson(value);
      const pages = Number(response.headers.get("x-wp-totalpages") ?? "1");
      return { value, totalPages: Number.isSafeInteger(pages) && pages >= 0 ? pages : 1 };
    } catch (error) {
      if (error instanceof WooReadError) throw error;
      if (budget.signal.aborted) throw new WooReadError(budget.signal.reason?.name === "TimeoutError" ? "TIMEOUT" : "CANCELLED");
      if (signal.aborted) throw new WooReadError("TIMEOUT");
      if (error instanceof SyntaxError || error instanceof z.ZodError) throw new WooReadError("INVALID_RESPONSE");
      if (error instanceof Error && /blocked|forbidden|too large|allowed host/iu.test(error.message)) throw new WooReadError("SECURITY_REJECTED");
      throw new WooReadError("UPSTREAM_UNAVAILABLE");
    } finally {
      release?.();
    }
  }
  return {
    async list(store: WooMerchant, params: URLSearchParams, budget: WooReadBudget) {
      const result = await get(store, "", params, budget);
      const parsed = z.array(RawProduct).max(100).safeParse(result.value);
      if (!parsed.success) throw new WooReadError("INVALID_RESPONSE");
      return { products: parsed.data, totalPages: result.totalPages };
    },
    async product(store: WooMerchant, id: number, budget: WooReadBudget) {
      const result = await get(store, `/${Id.parse(id)}`, new URLSearchParams(), budget);
      const parsed = RawProduct.safeParse(result.value);
      if (!parsed.success) throw new WooReadError("INVALID_RESPONSE");
      if (parsed.data.id !== id) throw new WooReadError("SECURITY_REJECTED");
      return parsed.data;
    }
  };
}

export function normalizeWooProduct(raw: WooRawProduct, store: WooMerchant, checkedAt: string, parent?: WooRawProduct): WooProduct | undefined {
  if (!["simple", "variable", "variation"].includes(raw.type) || raw.is_password_protected === true) return undefined;
  const isVariation = raw.type === "variation";
  if (isVariation && (parent === undefined || !variationBelongsToParent(raw, parent, store))) return undefined;
  const merchantUrl = wooProductUrl(store, raw.permalink);
  if (merchantUrl === undefined) return undefined;
  const selectedAttributes: Record<string, string> = {};
  const variantDimensions: Record<string, string[]> = {};
  for (const attribute of raw.attributes ?? []) {
    const name = dimensionKey(attribute.name);
    const values = attribute.value === undefined ? (attribute.terms ?? []).map((term) => cleanText(term.name)) : [cleanText(attribute.value)];
    if (values.length > 0) variantDimensions[name] = values;
    if (isVariation && values.length === 1) selectedAttributes[name] = values[0]!;
  }
  if (isVariation) {
    for (const attribute of parent?.variations?.find((item) => item.id === raw.id)?.attributes ?? []) {
      if (attribute.value === undefined || attribute.value.trim() === "") continue;
      const name = dimensionKey(attribute.name);
      if (selectedAttributes[name] !== undefined && normalized(selectedAttributes[name]!) !== normalized(cleanText(attribute.value))) return undefined;
      selectedAttributes[name] = cleanText(attribute.value);
      variantDimensions[name] = [cleanText(attribute.value)];
    }
  }
  const amountMinor = raw.prices.price !== undefined && /^\d{1,16}$/u.test(raw.prices.price) ? raw.prices.price : undefined;
  const amountCents = amountMinor === undefined ? NaN : Number(amountMinor) * 10 ** (2 - raw.prices.currency_minor_unit);
  const canPrice = raw.type !== "variable" && raw.prices.currency_code === "USD" && Number.isSafeInteger(amountCents) && amountCents >= 0 && amountCents <= 100_000_000;
  const images = (raw.images ?? []).flatMap((image) => {
    try {
      const url = new URL(image.src, store.origin);
      if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" ||
        ![new URL(store.origin).hostname, ...store.imageHosts].includes(url.hostname) || !/\.(?:avif|gif|jpe?g|png|webp)$/iu.test(url.pathname) ||
        [...url.searchParams.keys()].some((key) => !["v", "ver", "w", "h", "width", "height", "fit", "crop", "auto", "fm", "q", "quality"].includes(key))) return [];
      return [{ id: String(image.id), url: url.href }];
    } catch { return []; }
  }).slice(0, 12);
  const ratingValue = Number(raw.average_rating);
  const rating = raw.average_rating !== undefined && Number.isFinite(ratingValue) && ratingValue >= 0 && ratingValue <= 5 && raw.review_count !== undefined
    ? { value: ratingValue, reviewCount: raw.review_count, scale: 5 as const, productId: raw.id } : undefined;
  const brand = raw.brands?.[0]?.name;
  const parsed = WooProductSchema.safeParse({
    sourceKind: "WOOCOMMERCE_STORE_API", merchantId: store.merchantId, merchantName: store.name, sourceHost: new URL(merchantUrl).hostname,
    productId: isVariation ? parent!.id : raw.id,
    ...(isVariation ? { parentProductId: parent!.id, variationId: raw.id } : {}),
    title: cleanText(raw.name), ...(raw.description === undefined ? {} : { description: cleanText(raw.description).slice(0, 4_000) }),
    ...(raw.sku === undefined || raw.sku === "" ? {} : { sku: raw.sku }), ...(brand === undefined ? {} : { brand: cleanText(brand) }),
    productType: raw.type, condition: "UNKNOWN", category: cleanText(raw.categories?.[0]?.name ?? ""),
    attributes: Object.entries(variantDimensions).flatMap(([key, values]) => values.map((value) => `${key}: ${value}`)).slice(0, 100),
    variantDimensions, selectedAttributes, merchantUrl, images, ...(images[0] === undefined ? {} : { imageUrl: images[0].url }),
    ...(canPrice ? { itemPrice: { amountCents, currency: "USD" } } : {}),
    priceEvidence: { ...(amountMinor === undefined ? {} : { amountMinor }), currency: raw.prices.currency_code,
      currencyMinorUnit: raw.prices.currency_minor_unit, scope: raw.type === "variable" ? "PARENT_RANGE" : isVariation ? "VARIANT" : "PRODUCT", taxBasis: "UNKNOWN" },
    availability: stockAvailability(raw),
    availabilityScope: isVariation ? "VARIANT" : raw.type === "variable" ? "PARENT" : "PRODUCT", ...(rating === undefined ? {} : { rating }), checkedAt
  });
  return parsed.success ? parsed.data : undefined;
}

export function variationBelongsToParent(raw: WooRawProduct, parent: WooRawProduct, store: WooMerchant): boolean {
  if (raw.type !== "variation" || parent.type !== "variable" || raw.id === parent.id) return false;
  if (raw.parent !== undefined) return raw.parent === parent.id;
  const up = raw._links?.up?.[0]?.href;
  if (up !== undefined) {
    try { const url = new URL(up); return url.origin === new URL(store.origin).origin && url.pathname === `${store.apiPath}/products/${parent.id}`; } catch { return false; }
  }
  return parent.variations?.some((item) => item.id === raw.id) === true;
}
export function wooMatchesRequirements(product: WooProduct, requirements: WooVariantRequirements): boolean {
  const expected = { ...requirements.attributes, ...(requirements.color === undefined ? {} : { color: requirements.color }), ...(requirements.size === undefined ? {} : { size: requirements.size }) };
  return Object.entries(expected).every(([key, value]) => {
    const values = product.selectedAttributes[dimensionKey(key)] === undefined ? product.variantDimensions[dimensionKey(key)] ?? [] : [product.selectedAttributes[dimensionKey(key)]!];
    return values.length === 1 && normalized(values[0]!) === normalized(value);
  });
}
function dimensionKey(value: string): string {
  const key = value.toLowerCase().replace(/^(?:attribute_|pa_)/u, "").trim();
  return key === "colour" ? "color" : key;
}
function normalized(value: string): string { return value.normalize("NFKC").toLowerCase().trim(); }
function stockAvailability(raw: WooRawProduct): WooProduct["availability"] {
  if (raw.stock_status === "outofstock" && (raw.is_in_stock === true || raw.is_on_backorder === true)) return "UNKNOWN";
  if (raw.stock_status === "instock" && (raw.is_in_stock === false || raw.is_on_backorder === true)) return "UNKNOWN";
  if (raw.is_on_backorder === true || raw.stock_status === "onbackorder") return "BACKORDER";
  if (raw.stock_status === "outofstock" || raw.is_in_stock === false) return "OUT_OF_STOCK";
  if (raw.stock_status === "instock" || raw.is_in_stock === true) return "IN_STOCK";
  return "UNKNOWN";
}
function cleanText(value: string): string {
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, " ").replace(/<[^>]*>/gu, " ")
    .replace(/&#(\d{1,7});/gu, (original, code: string) => { const point = Number(code); return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : original; })
    .replace(/&amp;/gu, "&").replace(/&#39;|&apos;/gu, "'").replace(/&quot;/gu, '"').replace(/&nbsp;/gu, " ").replace(/\s+/gu, " ").trim();
}
function assertBoundedJson(value: unknown, depth = 0): void {
  if (depth > 16) throw new WooReadError("INVALID_RESPONSE");
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new WooReadError("INVALID_RESPONSE");
    for (const item of value) assertBoundedJson(item, depth + 1);
  } else if (value !== null && typeof value === "object") {
    if (Object.keys(value).length > 200) throw new WooReadError("INVALID_RESPONSE");
    for (const item of Object.values(value)) assertBoundedJson(item, depth + 1);
  }
}
