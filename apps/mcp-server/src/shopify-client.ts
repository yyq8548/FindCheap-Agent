import {
  createShopifyStorefrontReader
} from "../../../packages/merchant-adapters/src/configured/shopify-storefront-reader.js";
import type { ReaderDependencies } from "../../../packages/merchant-adapters/src/configured/feed-reader.js";
import {
  classifyShopifyCandidate,
  type ShopifyMatchStatus
} from "./shopify-match.js";
import {
  SHOPIFY_REGISTRY,
  type ShopifyPilot,
  type ShopifyRegistry
} from "./shopify-registry.js";
import { selectSameProductGroup } from "./shopify-identity.js";
import { createShopifyGlobalCatalogPort } from "./shopify-global-catalog-client.js";

export type { ShopifyPilot } from "./shopify-registry.js";
export const SHOPIFY_PILOTS = SHOPIFY_REGISTRY.merchants.filter((merchant) => merchant.searchEnabled);

export type ShopifySearchInput = {
  query?: string | undefined;
  handle?: string | undefined;
  limit: number;
  maxItemPriceCents?: number | undefined;
  comparisonMode?: "DISCOVERY" | "SAME_PRODUCT" | undefined;
  selectionMode?: ShopifySelectionMode | undefined;
  zipCode?: string | undefined;
  membershipIds?: string[] | undefined;
};

export type ShopifySelectionMode = "LOWEST_PRICE" | "MERCHANT_DIVERSE";
export type ShopifyCondition = "NEW" | "USED" | "REFURBISHED" | "OPEN_BOX" | "UNKNOWN";

export type ShopifyProduct = {
  merchantId: string;
  merchant: string;
  sourceHost: string;
  handle: string;
  title: string;
  brand?: string;
  sku?: string;
  gtins: string[];
  variantDimensions: Record<string, string>;
  matchStatus: Exclude<ShopifyMatchStatus, "IRRELEVANT">;
  matchEvidence: string[];
  condition: ShopifyCondition;
  imageUrl?: string;
  itemPrice?: { amountCents: number; currency: "USD" };
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  merchantUrl: string;
  checkedAt: string;
};

type ShopifyCandidate = Omit<ShopifyProduct, "matchStatus" | "matchEvidence"> & {
  productType?: string;
  tags: string[];
};

type RankedShopifyCandidate = ShopifyCandidate & {
  matchStatus: Exclude<ShopifyMatchStatus, "IRRELEVANT">;
  matchEvidence: string[];
};

export type ShopifySearchResult = {
  source?: "SHOPIFY_GLOBAL_CATALOG" | "SHOPIFY_STOREFRONT_API";
  coverage: "COMPLETE" | "PARTIAL";
  merchantsQueried: number;
  merchantsSucceeded: number;
  maxItemPriceCents?: number;
  comparison: {
    status: "SAME_PRODUCT" | "DISCOVERY_ONLY";
    identityType?: "GTIN" | "BRAND_MPN" | "UPID";
    evidence: string[];
    merchantCount: number;
    offerCount: number;
  };
  diagnostics: {
    apiDurationMs: number;
    cacheStatus: "MISS" | "HIT" | "COALESCED";
    chromeFallbackEligible: boolean;
    irrelevantProductsExcluded: number;
    conditionProductsExcluded: number;
    priceProductsExcluded: number;
    merchantsFailed: number;
    coveragePercent: number;
    failedMerchantIds: string[];
    timedOutMerchantIds: string[];
    registryVersion: string;
    searchTimeoutMs: number;
    selectionPolicy:
      | "EXACT_THEN_SIMILAR_THEN_PRICE"
      | "EXACT_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE";
  };
  questions: string[];
  products: ShopifyProduct[];
};

export interface ShopifyPort {
  search(input: ShopifySearchInput): Promise<ShopifySearchResult>;
}

type ShopifySearchCore = Omit<ShopifySearchResult, "diagnostics"> & {
  irrelevantProductsExcluded: number;
  conditionProductsExcluded: number;
  priceProductsExcluded: number;
  selectionMode: ShopifySelectionMode;
  failedMerchantIds: string[];
  timedOutMerchantIds: string[];
  registryVersion: string;
  searchTimeoutMs: number;
};

type ShopifyClientDependencies = ReaderDependencies & {
  monotonicNow?: () => number;
  registry?: ShopifyRegistry;
};

export function createShopifyPortFromEnvironment(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
  dependencies: ShopifyClientDependencies = {}
): ShopifyPort {
  if (environment.SHOPIFY_CATALOG_MODE === "global") {
    return createShopifyGlobalCatalogPort(environment, dependencies);
  }
  if (environment.SHOPIFY_STOREFRONT_MODE !== "audited-registry") return unavailablePort();

  const registry = dependencies.registry ?? SHOPIFY_REGISTRY;
  const enabledMerchants = registry.merchants.filter((merchant) => merchant.searchEnabled);
  if (enabledMerchants.length === 0) return unavailablePort();
  const searchTimeoutMs = parseSearchTimeout(environment.SHOPIFY_SEARCH_TIMEOUT_MS);
  const sources = enabledMerchants.map((store) => ({
    store,
    reader: createShopifyStorefrontReader([...store.allowedHosts], {
      host: store.apiHost,
      apiVersion: store.apiVersion
    }, dependencies)
  }));
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  let cache: {
    key: string;
    expiresAt: number;
    result: ShopifySearchCore;
  } | undefined;
  let inFlight: {
    key: string;
    promise: Promise<ShopifySearchCore>;
  } | undefined;

  return {
    async search(input) {
      const startedAt = monotonicNow();
      const selectionMode = input.selectionMode ?? "MERCHANT_DIVERSE";
      const cacheKey = JSON.stringify({ ...input, selectionMode });
      if (cache?.key === cacheKey && cache.expiresAt >= startedAt) {
        return withDiagnostics(cache.result, 0, "HIT");
      }
      if (inFlight?.key === cacheKey) {
        const result = await inFlight.promise;
        return withDiagnostics(result, Math.max(0, Math.round(monotonicNow() - startedAt)), "COALESCED");
      }
      const promise = (async () => {
        const captures = await Promise.allSettled(sources.map(async ({ store, reader }) => {
          const capture = input.handle === undefined
            ? reader.capture({ operation: "search", query: input.query ?? "", limit: input.limit })
            : reader.capture({ operation: "get", merchantProductId: input.handle });
          const snapshot = await withMerchantTimeout(capture, searchTimeoutMs, store.merchantId);
          const products = snapshot.records.map((record): ShopifyCandidate => {
            if (record.rawOffer?.url === undefined) throw new Error("Shopify product URL is missing");
            return {
              merchantId: store.merchantId,
              merchant: store.merchant,
              sourceHost: store.apiHost,
              handle: record.merchantProductId,
              title: record.title,
              ...(record.brand === undefined ? {} : { brand: record.brand }),
              ...(record.mpn === undefined ? {} : { sku: record.mpn }),
              gtins: record.gtins,
              variantDimensions: record.variantDimensions ?? {},
              ...(record.imageUrl === undefined ? {} : { imageUrl: record.imageUrl }),
              ...(record.rawOffer.price === undefined
                ? {}
                : { itemPrice: { amountCents: decimalToCents(record.rawOffer.price), currency: "USD" as const } }),
              availability: toAvailability(record.rawOffer.availability),
              merchantUrl: record.rawOffer.url,
              checkedAt: snapshot.checkedAt,
              ...(record.productType === undefined ? {} : { productType: record.productType }),
              tags: record.tags ?? [],
              condition: detectCondition([
                record.title,
                record.merchantProductId,
                record.mpn,
                record.productType,
                ...(record.tags ?? []),
                ...Object.values(record.variantDimensions ?? {})
              ])
            };
          });
          return { store, products };
        }));

        const successful = captures.filter((capture): capture is PromiseFulfilledResult<{
          store: ShopifyPilot;
          products: ShopifyCandidate[];
        }> =>
          capture.status === "fulfilled");
        const failed = captures.flatMap((capture, index) => capture.status === "rejected"
          ? [{
              merchantId: sources[index]?.store.merchantId ?? "unknown",
              timedOut: capture.reason instanceof MerchantSearchTimeoutError
            }]
          : []);
        const products = successful.flatMap((capture) => capture.value.products);
        if (products.length === 0 && successful.length !== sources.length) {
          throw new Error("DATA_SOURCE_UNAVAILABLE");
        }
        const maxItemPriceCents = input.maxItemPriceCents;
        const priceEligible = maxItemPriceCents === undefined
          ? products
          : products.filter((product) =>
              product.itemPrice !== undefined && product.itemPrice.amountCents <= maxItemPriceCents
            );
        const classified = input.query === undefined
          ? priceEligible.map((product): RankedShopifyCandidate => ({
              ...product,
              matchStatus: "EXACT",
              matchEvidence: ["product handle exact"]
            }))
          : priceEligible.flatMap((product): RankedShopifyCandidate[] => {
              const match = classifyShopifyCandidate(input.query ?? "", product);
              return match.status === "IRRELEVANT" ? [] : [{
                ...product,
                matchStatus: match.status,
                matchEvidence: match.evidence
              }];
            });
        const conditionIntent = requestedCondition(input.query);
        const conditionEligible = classified.filter((product) =>
          conditionMatches(product.condition, conditionIntent)
        );
        const ranked = rankAndDeduplicate(conditionEligible);
        const sameProductGroup = selectSameProductGroup(
          ranked.filter((product) => product.matchStatus === "EXACT")
        );
        const selectionPool = sameProductGroup?.offers ?? ranked;
        const selected = selectionMode === "LOWEST_PRICE"
          ? selectionPool.slice(0, input.limit)
          : selectDiverseThenFill(selectionPool, input.limit);
        return {
          coverage: successful.length === sources.length ? "COMPLETE" : "PARTIAL",
          merchantsQueried: sources.length,
          merchantsSucceeded: successful.length,
          ...(maxItemPriceCents === undefined ? {} : { maxItemPriceCents }),
          comparison: sameProductGroup === undefined
            ? {
                status: "DISCOVERY_ONLY",
                evidence: ["no independently verified cross-merchant identity"],
                merchantCount: new Set(selected.map((product) => product.merchantId)).size,
                offerCount: selected.length
              }
            : {
                status: "SAME_PRODUCT",
                identityType: sameProductGroup.identityType,
                evidence: sameProductGroup.evidence,
                merchantCount: sameProductGroup.offers.length,
                offerCount: sameProductGroup.offers.length
              },
          questions: selected.length > 0 && selected.every((product) => product.matchStatus === "SIMILAR")
            ? ["Only similar products were found. Provide an exact model, SKU, GTIN, color, size, or capacity."]
            : [],
          irrelevantProductsExcluded: priceEligible.length - classified.length,
          conditionProductsExcluded: classified.length - conditionEligible.length,
          priceProductsExcluded: products.length - priceEligible.length,
          selectionMode,
          failedMerchantIds: failed.map((entry) => entry.merchantId),
          timedOutMerchantIds: failed.filter((entry) => entry.timedOut).map((entry) => entry.merchantId),
          registryVersion: registry.version,
          searchTimeoutMs,
          products: selected.map(toPublicProduct)
        } satisfies ShopifySearchCore;
      })();
      inFlight = { key: cacheKey, promise };
      try {
        const result = await promise;
        const finishedAt = monotonicNow();
        cache = { key: cacheKey, expiresAt: finishedAt + 30_000, result };
        return withDiagnostics(result, Math.max(0, Math.round(finishedAt - startedAt)), "MISS");
      } finally {
        if (inFlight?.promise === promise) inFlight = undefined;
      }
    }
  };
}

export function createUnavailableShopifyPort(): ShopifyPort {
  return unavailablePort();
}

function unavailablePort(): ShopifyPort {
  return { async search() { throw new Error("DATA_SOURCE_UNAVAILABLE"); } };
}

function toAvailability(value: string | undefined): ShopifyProduct["availability"] {
  if (value === "IN_STOCK" || value === "OUT_OF_STOCK") return value;
  return "UNKNOWN";
}

function detectCondition(values: readonly (string | undefined)[]): ShopifyCondition {
  const text = values.filter((value): value is string => value !== undefined)
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replaceAll("_", " ");
  if (/\bopen[\s_-]*box\b/u.test(text)) return "OPEN_BOX";
  if (/\b(?:refurbished|renewed|reconditioned)\b/u.test(text)) return "REFURBISHED";
  if (/\b(?:used|pre[\s_-]*owned|resale|second[\s_-]*hand|outerworn)\b/u.test(text)) return "USED";
  if (/\bcondition[\s:_-]*new\b/u.test(text)) return "NEW";
  return "UNKNOWN";
}

function requestedCondition(query: string | undefined): ShopifyCondition | "DEFAULT" {
  const text = (query ?? "").normalize("NFKC").toLocaleLowerCase("en-US");
  if (/\bopen[\s_-]*box\b/u.test(text)) return "OPEN_BOX";
  if (/\b(?:refurbished|renewed|reconditioned)\b/u.test(text)) return "REFURBISHED";
  if (/\b(?:used|pre[\s_-]*owned|resale|second[\s_-]*hand)\b/u.test(text)) return "USED";
  return "DEFAULT";
}

function conditionMatches(condition: ShopifyCondition, requested: ShopifyCondition | "DEFAULT"): boolean {
  return requested === "DEFAULT"
    ? condition === "NEW" || condition === "UNKNOWN"
    : condition === requested;
}

function rankAndDeduplicate(products: RankedShopifyCandidate[]): RankedShopifyCandidate[] {
  const unique = new Map<string, RankedShopifyCandidate>();
  for (const product of products) if (!unique.has(product.merchantUrl)) unique.set(product.merchantUrl, product);
  return [...unique.values()].sort((left, right) =>
    matchRank(left.matchStatus) - matchRank(right.matchStatus)
    || availabilityRank(left.availability) - availabilityRank(right.availability)
    || (left.itemPrice?.amountCents ?? Number.MAX_SAFE_INTEGER) - (right.itemPrice?.amountCents ?? Number.MAX_SAFE_INTEGER)
    || compareText(left.merchant, right.merchant)
    || compareText(left.merchantUrl, right.merchantUrl));
}

function selectDiverseThenFill(products: RankedShopifyCandidate[], limit: number): RankedShopifyCandidate[] {
  const selected: RankedShopifyCandidate[] = [];
  const selectedUrls = new Set<string>();
  const merchants = new Set<string>();
  for (const product of products) {
    if (merchants.has(product.merchantId)) continue;
    selected.push(product);
    selectedUrls.add(product.merchantUrl);
    merchants.add(product.merchantId);
    if (selected.length === limit) return selected;
  }
  for (const product of products) {
    if (selectedUrls.has(product.merchantUrl)) continue;
    selected.push(product);
    if (selected.length === limit) break;
  }
  return selected;
}

function withDiagnostics(
  result: ShopifySearchCore,
  apiDurationMs: number,
  cacheStatus: "MISS" | "HIT" | "COALESCED"
): ShopifySearchResult {
  const {
    irrelevantProductsExcluded,
    conditionProductsExcluded,
    priceProductsExcluded,
    selectionMode,
    failedMerchantIds,
    timedOutMerchantIds,
    registryVersion,
    searchTimeoutMs,
    ...publicResult
  } = result;
  const merchantsFailed = result.merchantsQueried - result.merchantsSucceeded;
  return {
    ...publicResult,
    diagnostics: {
      apiDurationMs,
      cacheStatus,
      chromeFallbackEligible: result.coverage === "COMPLETE" && result.products.length === 0,
      irrelevantProductsExcluded,
      conditionProductsExcluded,
      priceProductsExcluded,
      merchantsFailed,
      coveragePercent: Math.round((result.merchantsSucceeded / result.merchantsQueried) * 100),
      failedMerchantIds,
      timedOutMerchantIds,
      registryVersion,
      searchTimeoutMs,
      selectionPolicy: selectionMode === "LOWEST_PRICE"
        ? "EXACT_THEN_SIMILAR_THEN_PRICE"
        : "EXACT_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE"
    }
  };
}

class MerchantSearchTimeoutError extends Error {}

async function withMerchantTimeout<T>(operation: Promise<T>, timeoutMs: number, merchantId: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new MerchantSearchTimeoutError(`Shopify merchant search timed out: ${merchantId}`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function parseSearchTimeout(value: string | undefined): number {
  if (value === undefined) return 3_000;
  if (!/^(?:[1-9]\d{2,3}|10000)$/u.test(value)) throw new Error("SHOPIFY_SEARCH_TIMEOUT_MS is invalid");
  const timeout = Number(value);
  if (timeout < 100 || timeout > 10_000) throw new Error("SHOPIFY_SEARCH_TIMEOUT_MS is invalid");
  return timeout;
}

function toPublicProduct(candidate: RankedShopifyCandidate): ShopifyProduct {
  const { productType, tags, ...product } = candidate;
  void productType;
  void tags;
  return product;
}

function availabilityRank(value: ShopifyProduct["availability"]): number {
  return value === "IN_STOCK" ? 0 : value === "UNKNOWN" ? 1 : 2;
}

function matchRank(value: ShopifyProduct["matchStatus"]): number {
  return value === "EXACT" ? 0 : 1;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function decimalToCents(value: string | number): number {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/u.test(text)) throw new Error("Shopify price is invalid");
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("Shopify price is outside supported range");
  return cents;
}
