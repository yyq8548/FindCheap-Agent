import { createShopifyGlobalCatalogPort } from "./shopify-global-catalog-client.js";
import type { ShopifyMatchStatus } from "./shopify-match.js";
import type { ShopifyCartEstimate } from "./shopify-cart-quote.js";
import type {
  MerchantRecommendationTier,
  MerchantTrustEvidence,
  ProductRating
} from "./merchant-trust.js";

export type ShopifySearchInput = {
  signal?: AbortSignal;
  query?: string | undefined;
  handle?: string | undefined;
  limit: number;
  maxItemPriceCents?: number | undefined;
  comparisonMode?: "DISCOVERY" | "SAME_PRODUCT" | undefined;
  selectionMode?: ShopifySelectionMode | undefined;
  zipCode?: string | undefined;
  membershipIds?: string[] | undefined;
  includeOutOfStock?: boolean | undefined;
};

export type ShopifySelectionMode = "LOWEST_PRICE" | "MERCHANT_DIVERSE";
export type ShopifyCondition = "NEW" | "USED" | "REFURBISHED" | "OPEN_BOX" | "UNKNOWN";

export type ShopifyProduct = {
  sourceKind?: "WEB_PRODUCT_PAGE";
  merchantId: string;
  merchant: string;
  sourceHost: string;
  merchantTrust: MerchantTrustEvidence;
  recommendationTier?: MerchantRecommendationTier;
  handle: string;
  title: string;
  productType?: string;
  description?: string;
  brand?: string;
  sku?: string;
  gtins: string[];
  variantDimensions: Record<string, string>;
  availableSizes?: string[];
  availabilityScope?: "SELECTED_VARIANT" | "PRODUCT_COLOR";
  matchStatus: Exclude<ShopifyMatchStatus, "IRRELEVANT">;
  matchEvidence: string[];
  condition: ShopifyCondition;
  imageUrl?: string;
  itemPrice?: { amountCents: number; currency: "USD" };
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  merchantUrl: string;
  checkedAt: string;
  productRating?: ProductRating;
  cartQuote?: ShopifyCartEstimate;
  checkoutPlatform?: "SHOPIFY" | "MERCHANT";
};

export type ShopifySearchResult = {
  source: "SHOPIFY_GLOBAL_CATALOG";
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
    queryAttempts: number;
    fallbackQueryUsed: boolean;
    catalogProductsReturned: number;
    catalogVariantsReturned: number;
    catalogZeroResultAttempts: number;
    malformedCatalogProductsExcluded?: number;
    outOfStockProductsExcluded: number;
    identityProductsExcluded: number;
    irrelevantProductsExcluded: number;
    conditionProductsExcluded: number;
    priceProductsExcluded: number;
    featureProductsExcluded?: number;
    trustedMerchantProductsReturned: number;
    unverifiedMerchantProductsReturned: number;
    unverifiedMerchantProductsExcluded: number;
    riskyMerchantProductsExcluded: number;
    merchantTrustRegistryVersion: string;
    merchantsFailed: number;
    coveragePercent: number;
    failedMerchantIds: string[];
    timedOutMerchantIds: string[];
    registryVersion: string;
    searchTimeoutMs: number;
    selectionPolicy:
      | "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_PRICE"
      | "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE";
  };
  questions: string[];
  products: ShopifyProduct[];
};

export interface ShopifyPort {
  search(input: ShopifySearchInput): Promise<ShopifySearchResult>;
}

type ShopifyClientDependencies = {
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  clock?: { now(): Date };
  monotonicNow?: () => number;
};

export function createShopifyPortFromEnvironment(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
  dependencies: ShopifyClientDependencies = {}
): ShopifyPort {
  return environment.SHOPIFY_CATALOG_MODE === "global"
    ? createShopifyGlobalCatalogPort(environment, dependencies)
    : unavailablePort();
}

export function createUnavailableShopifyPort(): ShopifyPort {
  return unavailablePort();
}

function unavailablePort(): ShopifyPort {
  return { async search() { throw new Error("DATA_SOURCE_UNAVAILABLE"); } };
}
