import {
  createShopifyStorefrontReader,
  type ShopifyStorefrontReaderConfig
} from "../../../packages/merchant-adapters/src/configured/shopify-storefront-reader.js";
import type { ReaderDependencies } from "../../../packages/merchant-adapters/src/configured/feed-reader.js";

type ShopifyPilot = {
  merchantId: string;
  merchant: string;
  apiHost: string;
  allowedHosts: readonly string[];
  apiVersion: ShopifyStorefrontReaderConfig["apiVersion"];
};

export const SHOPIFY_PILOTS = [
  pilot("death-wish-coffee", "Death Wish Coffee", "deathwishcoffee.com"),
  pilot("kith", "Kith", "kith.com"),
  pilot("allbirds", "Allbirds", "www.allbirds.com"),
  pilot("brooklinen", "Brooklinen", "www.brooklinen.com"),
  pilot("fashion-nova", "Fashion Nova", "www.fashionnova.com")
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
  imageUrl?: string;
  itemPrice?: { amountCents: number; currency: "USD" };
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  merchantUrl: string;
  checkedAt: string;
};

export type ShopifySearchResult = {
  coverage: "COMPLETE" | "PARTIAL";
  merchantsQueried: number;
  merchantsSucceeded: number;
  diagnostics: {
    apiDurationMs: number;
    cacheStatus: "MISS" | "HIT" | "COALESCED";
    chromeFallbackEligible: boolean;
    selectionPolicy: "RELEVANCE_THEN_DIVERSE_MERCHANTS_THEN_PRICE";
  };
  products: ShopifyProduct[];
};

export interface ShopifyPort {
  search(input: ShopifySearchInput): Promise<ShopifySearchResult>;
}

type ShopifyClientDependencies = ReaderDependencies & {
  monotonicNow?: () => number;
};

export function createShopifyPortFromEnvironment(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
  dependencies: ShopifyClientDependencies = {}
): ShopifyPort {
  if (environment.SHOPIFY_STOREFRONT_MODE !== "fixed-five") return unavailablePort();

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
    result: Omit<ShopifySearchResult, "diagnostics">;
  } | undefined;
  let inFlight: {
    key: string;
    promise: Promise<Omit<ShopifySearchResult, "diagnostics">>;
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
          return snapshot.records.map((record): ShopifyProduct => {
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
              ...(record.imageUrl === undefined ? {} : { imageUrl: record.imageUrl }),
              ...(record.rawOffer.price === undefined
                ? {}
                : { itemPrice: { amountCents: decimalToCents(record.rawOffer.price), currency: "USD" as const } }),
              availability: toAvailability(record.rawOffer.availability),
              merchantUrl: record.rawOffer.url,
              checkedAt: snapshot.checkedAt
            };
          });
        }));

        const successful = captures.filter((capture): capture is PromiseFulfilledResult<ShopifyProduct[]> =>
          capture.status === "fulfilled");
        const products = successful.flatMap((capture) => capture.value);
        if (products.length === 0 && successful.length !== sources.length) {
          throw new Error("DATA_SOURCE_UNAVAILABLE");
        }
        return {
          coverage: successful.length === sources.length ? "COMPLETE" : "PARTIAL",
          merchantsQueried: sources.length,
          merchantsSucceeded: successful.length,
          products: selectDiverseThenFill(
            rankAndDeduplicate(input.query === undefined ? products : products.filter(
              (product) => isRelevantProduct(product, input.query ?? "")
            )),
            input.limit
          )
        } satisfies Omit<ShopifySearchResult, "diagnostics">;
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

function pilot(merchantId: string, merchant: string, apiHost: string): ShopifyPilot {
  const bareHost = apiHost.startsWith("www.") ? apiHost.slice(4) : apiHost;
  return {
    merchantId,
    merchant,
    apiHost,
    allowedHosts: [bareHost, `www.${bareHost}`],
    apiVersion: "2026-07"
  };
}

function toAvailability(value: string | undefined): ShopifyProduct["availability"] {
  if (value === "IN_STOCK" || value === "OUT_OF_STOCK") return value;
  return "UNKNOWN";
}

function rankAndDeduplicate(products: ShopifyProduct[]): ShopifyProduct[] {
  const unique = new Map<string, ShopifyProduct>();
  for (const product of products) if (!unique.has(product.merchantUrl)) unique.set(product.merchantUrl, product);
  return [...unique.values()].sort((left, right) =>
    availabilityRank(left.availability) - availabilityRank(right.availability)
    || (left.itemPrice?.amountCents ?? Number.MAX_SAFE_INTEGER) - (right.itemPrice?.amountCents ?? Number.MAX_SAFE_INTEGER)
    || compareText(left.merchant, right.merchant)
    || compareText(left.merchantUrl, right.merchantUrl));
}

function selectDiverseThenFill(products: ShopifyProduct[], limit: number): ShopifyProduct[] {
  const selected: ShopifyProduct[] = [];
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
  result: Omit<ShopifySearchResult, "diagnostics">,
  apiDurationMs: number,
  cacheStatus: "MISS" | "HIT" | "COALESCED"
): ShopifySearchResult {
  return {
    ...result,
    diagnostics: {
      apiDurationMs,
      cacheStatus,
      chromeFallbackEligible: result.coverage === "COMPLETE" && result.products.length === 0,
      selectionPolicy: "RELEVANCE_THEN_DIVERSE_MERCHANTS_THEN_PRICE"
    }
  };
}

const QUERY_EQUIVALENTS = [
  ["shirt", "shirts", "tee", "tees", "tshirt", "tshirts"],
  ["shoe", "shoes", "sneaker", "sneakers"],
  ["headphone", "headphones", "headset", "headsets", "earbud", "earbuds"],
  ["sofa", "sofas", "couch", "couches"],
  ["tv", "television", "televisions"],
  ["fridge", "fridges", "refrigerator", "refrigerators"],
  ["phone", "phones", "smartphone", "smartphones"],
  ["laptop", "laptops", "notebook", "notebooks"]
] as const;

function isRelevantProduct(product: ShopifyProduct, query: string): boolean {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return false;
  const productTokens = new Set(tokenize([
    product.title,
    product.brand,
    product.sku,
    product.handle,
    ...product.gtins
  ].filter((value): value is string => value !== undefined).join(" ")));
  const identityTokens = queryTokens.filter((token) => /\d/u.test(token));
  if (identityTokens.some((token) => !productTokens.has(token))) return false;
  for (const group of QUERY_EQUIVALENTS) {
    if (queryTokens.some((token) => group.some((candidate) => candidate === token))) {
      return group.some((token) => productTokens.has(token));
    }
  }
  return queryTokens.some((token) => productTokens.has(token));
}

function tokenize(value: string): string[] {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [];
}

function availabilityRank(value: ShopifyProduct["availability"]): number {
  return value === "IN_STOCK" ? 0 : value === "UNKNOWN" ? 1 : 2;
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
