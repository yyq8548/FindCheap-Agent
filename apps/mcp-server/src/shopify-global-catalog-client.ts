import { z } from "zod";

import { classifyShopifyCandidate } from "./shopify-match.js";
import type {
  ShopifyCondition,
  ShopifyPort,
  ShopifyProduct,
  ShopifySearchInput,
  ShopifySearchResult
} from "./shopify-client.js";

export const SHOPIFY_GLOBAL_CATALOG_ENDPOINT = "https://catalog.shopify.com/api/ucp/mcp";
const CATALOG_VERSION = "2026-04-08";
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const HttpsUrlSchema = z.string().url().max(4_096).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.username === "" && url.password === "" && url.port === "";
});
const MediaSchema = z.object({
  type: z.string().max(40),
  url: HttpsUrlSchema
}).passthrough();
const VariantSchema = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/u).max(200),
  title: z.string().trim().min(1).max(1_000),
  url: HttpsUrlSchema,
  price: z.object({
    amount: z.number().int().nonnegative().max(100_000_000),
    currency: z.string().length(3)
  }).strict(),
  availability: z.object({ available: z.boolean() }).passthrough(),
  options: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(300)
  }).strict()).max(30).optional(),
  media: z.array(MediaSchema).max(20).optional(),
  seller: z.object({
    id: z.string().regex(/^gid:\/\/shopify\/Shop\/\d+$/u).max(200),
    name: z.string().trim().min(1).max(300),
    url: HttpsUrlSchema,
    domain: z.string().trim().min(1).max(253)
  }).passthrough(),
  condition: z.array(z.string().trim().min(1).max(80)).max(10).optional()
}).passthrough();
const ProductSchema = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/p\/[A-Za-z0-9]+$/u).max(200),
  title: z.string().trim().min(1).max(1_000),
  options: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    values: z.array(z.object({ label: z.string().trim().min(1).max(300) }).passthrough()).max(100)
  }).passthrough()).max(30).optional(),
  media: z.array(MediaSchema).max(20).optional(),
  variants: z.array(VariantSchema).max(100)
}).passthrough();
const CatalogEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: z.object({
    structuredContent: z.object({
      ucp: z.object({
        version: z.literal(CATALOG_VERSION),
        status: z.literal("success")
      }).passthrough(),
      products: z.array(ProductSchema).max(50),
      messages: z.array(z.unknown()).max(100).optional()
    }).passthrough()
  }).passthrough()
}).strict();

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
type Dependencies = {
  fetch?: Fetch;
  clock?: { now(): Date };
  monotonicNow?: () => number;
};
type GlobalCandidate = ShopifyProduct & { catalogProductId: string };

export function createShopifyGlobalCatalogPort(
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: Dependencies = {}
): ShopifyPort {
  const profileUrl = parseProfileUrl(environment.SHOPIFY_AGENT_PROFILE_URL);
  const timeoutMs = parseTimeout(environment.SHOPIFY_GLOBAL_CATALOG_TIMEOUT_MS);
  const fetchRequest = dependencies.fetch ?? ((input, init) => fetch(input, init));
  const clock = dependencies.clock ?? { now: () => new Date() };
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());

  return {
    async search(input) {
      const startedAt = monotonicNow();
      try {
        const response = await fetchRequest(SHOPIFY_GLOBAL_CATALOG_ENDPOINT, {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(searchRequest(input, profileUrl)),
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!response.ok) throw new Error("catalog request failed");
        const parsed = CatalogEnvelopeSchema.parse(JSON.parse(await readLimitedText(response)));
        return buildResult(parsed.result.structuredContent.products, input, {
          checkedAt: clock.now().toISOString(),
          durationMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
          timeoutMs
        });
      } catch (error) {
        throw new Error("DATA_SOURCE_UNAVAILABLE", { cause: error });
      }
    }
  };
}

function searchRequest(input: ShopifySearchInput, profileUrl: string) {
  const query = normalizeCatalogQuery(input.query ?? input.handle?.replaceAll("-", " ") ?? "");
  return {
    jsonrpc: "2.0",
    method: "tools/call",
    id: 1,
    params: {
      name: "search_catalog",
      arguments: {
        meta: { "ucp-agent": { profile: profileUrl } },
        catalog: {
          query,
          filters: {
            ships_to: { country: "US" },
            available: true,
            ...(input.maxItemPriceCents === undefined
              ? {}
              : { price: { max: input.maxItemPriceCents } })
          },
          context: { address_country: "US" }
        }
      }
    }
  };
}

function normalizeCatalogQuery(value: string): string {
  return value.normalize("NFKC").trim().replace(/\bdresses\b/giu, "dress");
}

function buildResult(
  products: z.infer<typeof ProductSchema>[],
  input: ShopifySearchInput,
  context: { checkedAt: string; durationMs: number; timeoutMs: number }
): ShopifySearchResult {
  const unsupportedConditions = products.reduce((count, product) => count + product.variants.filter((variant) =>
    detectCondition([
      product.title,
      variant.title,
      ...(product.options ?? []).flatMap((option) => [option.name, ...option.values.map((value) => value.label)]),
      ...(variant.options ?? []).flatMap((option) => [option.name, option.label])
    ]) === "UNSUPPORTED"
  ).length, 0);
  const raw = products.flatMap((product) => product.variants.flatMap((variant) => {
    const candidate = toCandidate(product, variant, context.checkedAt);
    return candidate === undefined ? [] : [candidate];
  }));
  const available = raw.filter((candidate) => candidate.availability === "IN_STOCK");
  const priceEligible = input.maxItemPriceCents === undefined
    ? available
    : available.filter((candidate) =>
        candidate.itemPrice !== undefined && candidate.itemPrice.amountCents <= input.maxItemPriceCents!
      );
  const classified = input.query === undefined
    ? priceEligible.map((candidate) => ({
        ...candidate,
        matchStatus: "EXACT" as const,
        matchEvidence: ["Shopify catalog identifier exact"]
      }))
    : priceEligible.flatMap((candidate) => {
        const match = classifyShopifyCandidate(input.query ?? "", candidate);
        return match.status === "IRRELEVANT" ? [] : [{
          ...candidate,
          matchStatus: match.status,
          matchEvidence: match.evidence
        }];
      });
  const requested = requestedCondition(input.query);
  const conditionEligible = classified.filter((candidate) => conditionMatches(candidate.condition, requested));
  const ranked = rankAndDeduplicate(conditionEligible);
  const sameProduct = input.comparisonMode === "SAME_PRODUCT" ? selectUpidGroup(ranked) : undefined;
  const pool = sameProduct ?? ranked;
  const selectionMode = input.selectionMode ?? "MERCHANT_DIVERSE";
  const selected = selectionMode === "LOWEST_PRICE"
    ? pool.slice(0, input.limit)
    : selectDiverseThenFill(pool, input.limit);
  const merchantCount = new Set(raw.map((candidate) => candidate.merchantId)).size;

  return {
    source: "SHOPIFY_GLOBAL_CATALOG",
    coverage: "COMPLETE",
    merchantsQueried: merchantCount,
    merchantsSucceeded: merchantCount,
    ...(input.maxItemPriceCents === undefined ? {} : { maxItemPriceCents: input.maxItemPriceCents }),
    comparison: sameProduct === undefined
      ? {
          status: "DISCOVERY_ONLY",
          evidence: ["no multi-merchant Shopify Universal Product ID group returned"],
          merchantCount: new Set(selected.map((candidate) => candidate.merchantId)).size,
          offerCount: selected.length
        }
      : {
          status: "SAME_PRODUCT",
          identityType: "UPID",
          evidence: ["Shopify Universal Product ID exact"],
          merchantCount: new Set(sameProduct.map((candidate) => candidate.merchantId)).size,
          offerCount: sameProduct.length
        },
    diagnostics: {
      apiDurationMs: context.durationMs,
      cacheStatus: "MISS",
      chromeFallbackEligible: selected.length === 0,
      irrelevantProductsExcluded: priceEligible.length - classified.length + (raw.length - available.length),
      conditionProductsExcluded: unsupportedConditions + classified.length - conditionEligible.length,
      priceProductsExcluded: available.length - priceEligible.length,
      merchantsFailed: 0,
      coveragePercent: 100,
      failedMerchantIds: [],
      timedOutMerchantIds: [],
      registryVersion: `shopify-global-${CATALOG_VERSION}`,
      searchTimeoutMs: context.timeoutMs,
      selectionPolicy: selectionMode === "LOWEST_PRICE"
        ? "EXACT_THEN_SIMILAR_THEN_PRICE"
        : "EXACT_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE"
    },
    questions: selected.length > 0 && selected.every((candidate) => candidate.matchStatus === "SIMILAR")
      ? ["Only similar products were found. Provide an exact model, SKU, GTIN, color, size, or capacity."]
      : [],
    products: selected.map(({ catalogProductId: _catalogProductId, ...candidate }) => candidate)
  };
}

function toCandidate(
  product: z.infer<typeof ProductSchema>,
  variant: z.infer<typeof VariantSchema>,
  checkedAt: string
): GlobalCandidate | undefined {
  if (variant.price.currency !== "USD") return undefined;
  const productUrl = canonicalProductUrl(variant.url, variant.seller.url);
  if (productUrl === undefined) return undefined;
  const shopId = variant.seller.id.slice("gid://shopify/Shop/".length);
  const variantId = variant.id.slice("gid://shopify/ProductVariant/".length);
  const condition = detectCondition([
    product.title,
    variant.title,
    ...(product.options ?? []).flatMap((option) => [option.name, ...option.values.map((value) => value.label)]),
    ...(variant.options ?? []).flatMap((option) => [option.name, option.label])
  ]);
  if (condition === "UNSUPPORTED") return undefined;
  const imageUrl = [...(variant.media ?? []), ...(product.media ?? [])]
    .map((entry) => entry.url)
    .find(isAllowedImageUrl);
  return {
    catalogProductId: product.id,
    merchantId: `shopify-${shopId}`,
    merchant: variant.seller.name,
    sourceHost: new URL(productUrl).hostname,
    handle: variantId,
    title: variant.title,
    gtins: [],
    variantDimensions: Object.fromEntries((variant.options ?? []).map((option) => [option.name, option.label])),
    matchStatus: "SIMILAR",
    matchEvidence: [],
    condition,
    ...(imageUrl === undefined ? {} : { imageUrl }),
    itemPrice: { amountCents: variant.price.amount, currency: "USD" },
    availability: variant.availability.available ? "IN_STOCK" : "OUT_OF_STOCK",
    merchantUrl: productUrl,
    checkedAt
  };
}

function canonicalProductUrl(value: string, sellerValue: string): string | undefined {
  const url = new URL(value);
  const seller = new URL(sellerValue);
  if (url.hostname !== seller.hostname || !url.pathname.startsWith("/products/")) return undefined;
  url.hash = "";
  return url.href;
}

function isAllowedImageUrl(value: string): boolean {
  const url = new URL(value);
  return url.hostname === "cdn.shopify.com";
}

function detectCondition(values: readonly string[]): ShopifyCondition | "UNSUPPORTED" {
  const text = values.join(" ").normalize("NFKC").toLocaleLowerCase("en-US").replaceAll("_", " ");
  if (/\b(?:defective|damaged|for parts|parts only)\b/u.test(text)) return "UNSUPPORTED";
  if (/\bopen[\s-]*box\b/u.test(text)) return "OPEN_BOX";
  if (/\b(?:refurbished|renewed|reconditioned)\b/u.test(text)) return "REFURBISHED";
  if (/\b(?:used|pre[\s-]*owned|resale|second[\s-]*hand)\b/u.test(text)) return "USED";
  if (/\bnew\b/u.test(text)) return "NEW";
  return "UNKNOWN";
}

function requestedCondition(query: string | undefined): ShopifyCondition | "DEFAULT" {
  const text = (query ?? "").normalize("NFKC").toLocaleLowerCase("en-US");
  if (/\bopen[\s-]*box\b/u.test(text)) return "OPEN_BOX";
  if (/\b(?:refurbished|renewed|reconditioned)\b/u.test(text)) return "REFURBISHED";
  if (/\b(?:used|pre[\s-]*owned|resale|second[\s-]*hand)\b/u.test(text)) return "USED";
  return "DEFAULT";
}

function conditionMatches(condition: ShopifyCondition, requested: ShopifyCondition | "DEFAULT"): boolean {
  return requested === "DEFAULT"
    ? condition === "NEW" || condition === "UNKNOWN"
    : condition === requested;
}

function rankAndDeduplicate(products: GlobalCandidate[]): GlobalCandidate[] {
  const unique = new Map<string, GlobalCandidate>();
  for (const product of products) if (!unique.has(product.merchantUrl)) unique.set(product.merchantUrl, product);
  return [...unique.values()].sort((left, right) =>
    matchRank(left.matchStatus) - matchRank(right.matchStatus)
    || availabilityRank(left.availability) - availabilityRank(right.availability)
    || (left.itemPrice?.amountCents ?? Number.MAX_SAFE_INTEGER) - (right.itemPrice?.amountCents ?? Number.MAX_SAFE_INTEGER)
    || compareText(left.merchant, right.merchant)
    || compareText(left.merchantUrl, right.merchantUrl));
}

function selectUpidGroup(products: GlobalCandidate[]): GlobalCandidate[] | undefined {
  const groups = new Map<string, GlobalCandidate[]>();
  for (const product of products.filter((candidate) => candidate.matchStatus === "EXACT")) {
    const group = groups.get(product.catalogProductId) ?? [];
    if (!group.some((candidate) => candidate.merchantId === product.merchantId)) group.push(product);
    groups.set(product.catalogProductId, group);
  }
  return [...groups.values()]
    .filter((group) => group.length >= 2)
    .sort((left, right) => right.length - left.length || lowestPrice(left) - lowestPrice(right))[0];
}

function selectDiverseThenFill(products: GlobalCandidate[], limit: number): GlobalCandidate[] {
  const selected: GlobalCandidate[] = [];
  const urls = new Set<string>();
  const merchants = new Set<string>();
  for (const product of products) {
    if (merchants.has(product.merchantId)) continue;
    selected.push(product);
    urls.add(product.merchantUrl);
    merchants.add(product.merchantId);
    if (selected.length === limit) return selected;
  }
  for (const product of products) {
    if (urls.has(product.merchantUrl)) continue;
    selected.push(product);
    if (selected.length === limit) break;
  }
  return selected;
}

async function readLimitedText(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    throw new Error("catalog response is too large");
  }
  if (response.body === null) throw new Error("catalog response body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("catalog response is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function parseProfileUrl(value: string | undefined): string {
  if (value === undefined) throw new Error("SHOPIFY_AGENT_PROFILE_URL is required");
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
      url.port !== "" || url.search !== "" || url.hash !== ""
    ) throw new Error();
    return url.href;
  } catch {
    throw new Error("SHOPIFY_AGENT_PROFILE_URL is invalid");
  }
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) return 10_000;
  if (!/^\d+$/u.test(value)) throw new Error("SHOPIFY_GLOBAL_CATALOG_TIMEOUT_MS is invalid");
  const timeout = Number(value);
  if (timeout < 500 || timeout > 20_000) throw new Error("SHOPIFY_GLOBAL_CATALOG_TIMEOUT_MS is invalid");
  return timeout;
}

function matchRank(value: ShopifyProduct["matchStatus"]): number {
  return value === "EXACT" ? 0 : 1;
}

function availabilityRank(value: ShopifyProduct["availability"]): number {
  return value === "IN_STOCK" ? 0 : value === "UNKNOWN" ? 1 : 2;
}

function lowestPrice(products: GlobalCandidate[]): number {
  return Math.min(...products.map((product) => product.itemPrice?.amountCents ?? Number.MAX_SAFE_INTEGER));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
