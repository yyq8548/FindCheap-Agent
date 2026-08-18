import {
  createShopifyStorefrontReader,
  type ShopifyStorefrontReaderConfig
} from "../../../packages/merchant-adapters/src/configured/shopify-storefront-reader.js";
import type { ReaderDependencies } from "../../../packages/merchant-adapters/src/configured/feed-reader.js";
import {
  classifyShopifyCandidate,
  type ShopifyMatchStatus
} from "./shopify-match.js";

export type ShopifyPilot = {
  merchantId: string;
  merchant: string;
  apiHost: string;
  allowedHosts: readonly string[];
  apiVersion: ShopifyStorefrontReaderConfig["apiVersion"];
  probeQuery: string;
};

export const SHOPIFY_PILOTS = [
  pilot("death-wish-coffee", "Death Wish Coffee", "deathwishcoffee.com", "coffee"),
  pilot("kith", "Kith", "kith.com", "shirt"),
  pilot("allbirds", "Allbirds", "www.allbirds.com", "shoes"),
  pilot("brooklinen", "Brooklinen", "www.brooklinen.com", "sheets"),
  pilot("fashion-nova", "Fashion Nova", "www.fashionnova.com", "shirt"),
  pilot("tentree", "Tentree", "tentree.com", "shirt"),
  pilot("colourpop", "ColourPop", "colourpop.com", "lipstick"),
  pilot("liquid-death", "Liquid Death", "liquiddeath.com", "water"),
  pilot("pura-vida", "Pura Vida", "www.puravidabracelets.com", "bracelet"),
  pilot("steve-madden", "Steve Madden", "www.stevemadden.com", "shoes")
] as const satisfies readonly ShopifyPilot[];

export type ShopifySearchInput = {
  query?: string | undefined;
  handle?: string | undefined;
  limit: number;
};

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
  coverage: "COMPLETE" | "PARTIAL";
  merchantsQueried: number;
  merchantsSucceeded: number;
  diagnostics: {
    apiDurationMs: number;
    cacheStatus: "MISS" | "HIT" | "COALESCED";
    chromeFallbackEligible: boolean;
    irrelevantProductsExcluded: number;
    selectionPolicy: "EXACT_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE";
  };
  questions: string[];
  products: ShopifyProduct[];
};

export interface ShopifyPort {
  search(input: ShopifySearchInput): Promise<ShopifySearchResult>;
}

type ShopifySearchCore = Omit<ShopifySearchResult, "diagnostics"> & {
  irrelevantProductsExcluded: number;
};

type ShopifyClientDependencies = ReaderDependencies & {
  monotonicNow?: () => number;
};

export function createShopifyPortFromEnvironment(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
  dependencies: ShopifyClientDependencies = {}
): ShopifyPort {
  if (environment.SHOPIFY_STOREFRONT_MODE !== "fixed-ten") return unavailablePort();

  const sources = SHOPIFY_PILOTS.map((store) => ({
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
      const cacheKey = JSON.stringify(input);
      if (cache?.key === cacheKey && cache.expiresAt >= startedAt) {
        return withDiagnostics(cache.result, 0, "HIT");
      }
      if (inFlight?.key === cacheKey) {
        const result = await inFlight.promise;
        return withDiagnostics(result, Math.max(0, Math.round(monotonicNow() - startedAt)), "COALESCED");
      }
      const promise = (async () => {
        const captures = await Promise.allSettled(sources.map(async ({ store, reader }) => {
          const snapshot = input.handle === undefined
            ? await reader.capture({ operation: "search", query: input.query ?? "", limit: input.limit })
            : await reader.capture({ operation: "get", merchantProductId: input.handle });
          return snapshot.records.map((record): ShopifyCandidate => {
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
              tags: record.tags ?? []
            };
          });
        }));

        const successful = captures.filter((capture): capture is PromiseFulfilledResult<ShopifyCandidate[]> =>
          capture.status === "fulfilled");
        const products = successful.flatMap((capture) => capture.value);
        if (products.length === 0 && successful.length !== sources.length) {
          throw new Error("DATA_SOURCE_UNAVAILABLE");
        }
        const classified = input.query === undefined
          ? products.map((product): RankedShopifyCandidate => ({
              ...product,
              matchStatus: "EXACT",
              matchEvidence: ["product handle exact"]
            }))
          : products.flatMap((product): RankedShopifyCandidate[] => {
              const match = classifyShopifyCandidate(input.query ?? "", product);
              return match.status === "IRRELEVANT" ? [] : [{
                ...product,
                matchStatus: match.status,
                matchEvidence: match.evidence
              }];
            });
        const selected = selectDiverseThenFill(rankAndDeduplicate(classified), input.limit);
        return {
          coverage: successful.length === sources.length ? "COMPLETE" : "PARTIAL",
          merchantsQueried: sources.length,
          merchantsSucceeded: successful.length,
          questions: selected.length > 0 && selected.every((product) => product.matchStatus === "SIMILAR")
            ? ["Only similar products were found. Provide an exact model, SKU, GTIN, color, size, or capacity."]
            : [],
          irrelevantProductsExcluded: products.length - classified.length,
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

function pilot(merchantId: string, merchant: string, apiHost: string, probeQuery: string): ShopifyPilot {
  const bareHost = apiHost.startsWith("www.") ? apiHost.slice(4) : apiHost;
  return {
    merchantId,
    merchant,
    apiHost,
    allowedHosts: [bareHost, `www.${bareHost}`],
    apiVersion: "2026-07",
    probeQuery
  };
}

function toAvailability(value: string | undefined): ShopifyProduct["availability"] {
  if (value === "IN_STOCK" || value === "OUT_OF_STOCK") return value;
  return "UNKNOWN";
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
  const { irrelevantProductsExcluded, ...publicResult } = result;
  return {
    ...publicResult,
    diagnostics: {
      apiDurationMs,
      cacheStatus,
      chromeFallbackEligible: result.coverage === "COMPLETE" && result.products.length === 0,
      irrelevantProductsExcluded,
      selectionPolicy: "EXACT_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE"
    }
  };
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
