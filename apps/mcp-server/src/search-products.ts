import { z } from "zod";

import type {
  AwinProduct,
  AwinProductPort,
  AwinSearchResult
} from "../../../packages/awin-feed/src/index.js";
import type {
  ShopifyCondition,
  ShopifyPort,
  ShopifyProduct,
  ShopifySearchResult
} from "./shopify-client.js";
import { isTrustedMerchant } from "./merchant-trust.js";

const QuerySchema = z.string().trim().min(2).max(300)
  .regex(/^[\p{L}\p{N}\s._+'-]+$/u)
  .refine((value) => /[\p{L}\p{N}]/u.test(value), "query must contain a letter or number");

export const SearchProductsInputSchema = z.object({
  query: QuerySchema,
  limit: z.number().int().min(1).max(3).default(3),
  maxItemPriceCents: z.number().int().min(1).max(100_000_000).optional(),
  zipCode: z.string().regex(/^\d{5}(?:-\d{4})?$/u).optional(),
  membershipIds: z.array(z.string().trim().min(1).max(80)).max(20)
    .refine((values) => new Set(values).size === values.length, "membership IDs must be unique")
    .optional(),
  comparisonMode: z.enum(["DISCOVERY", "SAME_PRODUCT"]).default("DISCOVERY"),
  selectionMode: z.enum(["LOWEST_PRICE", "MERCHANT_DIVERSE"]).default("MERCHANT_DIVERSE"),
  conditionPreference: z.enum(["ANY", "NEW", "USED", "REFURBISHED", "OPEN_BOX", "UNKNOWN"])
    .default("ANY"),
  features: z.array(z.string().trim().min(1).max(80)).max(10)
    .refine((values) => new Set(values.map(normalize)).size === values.length, "features must be unique")
    .default([]),
  featureMode: z.enum(["PREFERRED", "REQUIRED"]).default("PREFERRED")
}).strict();

export type SearchProductsInput = z.infer<typeof SearchProductsInputSchema>;

export type UnifiedCandidate = {
  source: "AWIN_PRODUCT_FEED" | "SHOPIFY_GLOBAL_CATALOG";
  affiliateState: "APPROVED" | "NONE";
  featureEvidence: string[];
  awinProduct?: AwinProduct;
  shopifyProduct?: ShopifyProduct;
};

export type UnifiedSearchExecution = {
  candidates: UnifiedCandidate[];
  awinResult?: AwinSearchResult;
  shopifyResult?: ShopifySearchResult;
  sourceStatus: {
    awin: "SKIPPED" | "COMPLETE" | "UNAVAILABLE";
    shopify: "SKIPPED" | "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  };
  searchPasses: 1 | 2;
  chromeFallbackEligible: boolean;
};

const AFFILIATE_HAIR_QUERY = /(?:\bhair\b|haircare|hair[\s-]*care|hair[\s-]*mask|keratin|shampoo|conditioner|straighten|smoothing|styling|amazonliss|nutree|护发|头发|发膜|角蛋白|洗发水|护发素|拉直|顺滑|造型)/iu;

export function isApprovedAffiliateQuery(query: string): boolean {
  return AFFILIATE_HAIR_QUERY.test(query.normalize("NFKC"));
}

export async function searchProducts(
  input: SearchProductsInput,
  ports: { awin: AwinProductPort; shopify: ShopifyPort }
): Promise<UnifiedSearchExecution> {
  const affiliateEligible = isApprovedAffiliateQuery(input.query);
  let awinResult: AwinSearchResult | undefined;
  let shopifyResult: ShopifySearchResult | undefined;
  let awinStatus: UnifiedSearchExecution["sourceStatus"]["awin"] = affiliateEligible
    ? "UNAVAILABLE"
    : "SKIPPED";
  let shopifyStatus: UnifiedSearchExecution["sourceStatus"]["shopify"] = "SKIPPED";
  let affiliateCandidates: UnifiedCandidate[] = [];

  if (affiliateEligible) {
    try {
      awinResult = await ports.awin.search({
        query: input.query,
        limit: 12,
        ...(input.maxItemPriceCents === undefined
          ? {}
          : { maxItemPriceCents: input.maxItemPriceCents })
      });
      awinStatus = "COMPLETE";
      affiliateCandidates = awinResult.products
        .map((product) => awinCandidate(product, input))
        .filter((candidate): candidate is UnifiedCandidate => candidate !== undefined)
        .sort(compareCandidates);
    } catch {
      awinStatus = "UNAVAILABLE";
    }
  }

  const needsShopify =
    input.selectionMode === "LOWEST_PRICE" ||
    affiliateCandidates.length < input.limit;
  let shopifyCandidates: UnifiedCandidate[] = [];
  if (needsShopify) {
    try {
      shopifyResult = await ports.shopify.search({
        query: input.query,
        limit: input.limit,
        comparisonMode: input.comparisonMode,
        selectionMode: input.selectionMode,
        ...(input.maxItemPriceCents === undefined
          ? {}
          : { maxItemPriceCents: input.maxItemPriceCents }),
        ...(input.zipCode === undefined ? {} : { zipCode: input.zipCode }),
        membershipIds: input.membershipIds ?? []
      });
      shopifyStatus = shopifyResult.coverage;
      shopifyCandidates = shopifyResult.products
        .map((product) => shopifyCandidate(product, input))
        .filter((candidate): candidate is UnifiedCandidate => candidate !== undefined)
        .sort(compareCandidates);
    } catch {
      shopifyStatus = "UNAVAILABLE";
    }
  }

  let searchPasses: 1 | 2 = 1;
  const expandedQuery = buildExpandedQuery(input);
  if (affiliateCandidates.length + shopifyCandidates.length < input.limit) {
    searchPasses = 2;
    if (affiliateEligible && expandedQuery !== input.query) {
      try {
        const expandedAwinResult = await ports.awin.search({
          query: expandedQuery,
          limit: 24,
          ...(input.maxItemPriceCents === undefined
            ? {}
            : { maxItemPriceCents: input.maxItemPriceCents })
        });
        awinResult = expandedAwinResult;
        awinStatus = "COMPLETE";
        affiliateCandidates = mergeCandidates(
          affiliateCandidates,
          expandedAwinResult.products
            .map((product) => awinCandidate(product, input))
            .filter((candidate): candidate is UnifiedCandidate => candidate !== undefined)
        );
      } catch {
        if (awinStatus !== "COMPLETE") awinStatus = "UNAVAILABLE";
      }
    }

    try {
      const expandedShopifyResult = await ports.shopify.search({
        query: expandedQuery,
        limit: 12,
        comparisonMode: input.comparisonMode,
        selectionMode: input.selectionMode,
        ...(input.maxItemPriceCents === undefined
          ? {}
          : { maxItemPriceCents: input.maxItemPriceCents }),
        ...(input.zipCode === undefined ? {} : { zipCode: input.zipCode }),
        membershipIds: input.membershipIds ?? []
      });
      shopifyResult = expandedShopifyResult;
      shopifyStatus = expandedShopifyResult.coverage;
      shopifyCandidates = mergeCandidates(
        shopifyCandidates,
        expandedShopifyResult.products
          .map((product) => shopifyCandidate(product, input))
          .filter((candidate): candidate is UnifiedCandidate => candidate !== undefined)
      );
    } catch {
      shopifyStatus = shopifyStatus === "COMPLETE" ? "PARTIAL" : "UNAVAILABLE";
    }
  }

  const candidates = input.selectionMode === "LOWEST_PRICE"
    ? [...affiliateCandidates, ...shopifyCandidates]
        .sort(compareCandidates)
        .slice(0, input.limit)
    : [...affiliateCandidates, ...shopifyCandidates].slice(0, input.limit);
  const queriedSourcesComplete =
    awinStatus !== "UNAVAILABLE" &&
    shopifyStatus !== "UNAVAILABLE" &&
    shopifyStatus !== "PARTIAL";
  const chromeFallbackEligible =
    candidates.length === 0 &&
    queriedSourcesComplete &&
    searchPasses === 2;

  return {
    candidates,
    ...(awinResult === undefined ? {} : { awinResult }),
    ...(shopifyResult === undefined ? {} : { shopifyResult }),
    sourceStatus: { awin: awinStatus, shopify: shopifyStatus },
    searchPasses,
    chromeFallbackEligible
  };
}

function awinCandidate(
  product: AwinProduct,
  input: SearchProductsInput
): UnifiedCandidate | undefined {
  if (!conditionMatches(product.condition, input.conditionPreference)) return undefined;
  const featureEvidence = matchFeatures(
    `${product.title} ${product.category}`,
    input.features
  );
  if (input.featureMode === "REQUIRED" && featureEvidence.length !== input.features.length) {
    return undefined;
  }
  return {
    source: "AWIN_PRODUCT_FEED",
    affiliateState: "APPROVED",
    featureEvidence,
    awinProduct: product
  };
}

function shopifyCandidate(
  product: ShopifyProduct,
  input: SearchProductsInput
): UnifiedCandidate | undefined {
  if (!isTrustedMerchant(product.merchantTrust)) return undefined;
  if (!conditionMatches(product.condition, input.conditionPreference)) return undefined;
  const featureEvidence = matchFeatures(
    [
      product.title,
      product.brand ?? "",
      product.sku ?? "",
      ...Object.entries(product.variantDimensions).flat()
    ].join(" "),
    input.features
  );
  if (input.featureMode === "REQUIRED" && featureEvidence.length !== input.features.length) {
    return undefined;
  }
  return {
    source: "SHOPIFY_GLOBAL_CATALOG",
    affiliateState: "NONE",
    featureEvidence,
    shopifyProduct: product
  };
}

function conditionMatches(
  actual: ShopifyCondition,
  expected: SearchProductsInput["conditionPreference"]
): boolean {
  return expected === "ANY" || actual === expected;
}

function matchFeatures(searchable: string, features: readonly string[]): string[] {
  return features.filter((feature) => featureMatches(searchable, feature));
}

function featureMatches(searchable: string, feature: string): boolean {
  const normalizedSearchable = normalize(searchable);
  const normalizedFeature = normalize(feature);
  if (normalizedSearchable.includes(normalizedFeature)) return true;

  const requestedMeasurement = parseRequestedMeasurement(normalizedFeature);
  if (requestedMeasurement !== undefined) {
    const observed = parseMeasurements(normalizedSearchable)
      .filter((measurement) => measurement.unit === requestedMeasurement.unit);
    return observed.some((measurement) => requestedMeasurement.minimum
      ? measurement.value >= requestedMeasurement.value
      : requestedMeasurement.unit === "IN"
        ? Math.abs(measurement.value - requestedMeasurement.value) <= 0.5
        : measurement.value === requestedMeasurement.value
    );
  }

  const requestedTokens = meaningfulTokens(normalizedFeature);
  if (requestedTokens.length === 0) return false;
  const observedTokens = new Set(meaningfulTokens(normalizedSearchable));
  return requestedTokens.every((token) => observedTokens.has(token));
}

type Measurement = { value: number; unit: "GB" | "IN"; minimum?: boolean };

function parseRequestedMeasurement(value: string): Measurement | undefined {
  const match = value.match(/\b(at least|minimum|min|>=)?\s*(\d+(?:\.\d+)?)\s*(tb|gb|inches|inch|in)\b/u);
  if (match === null) return undefined;
  const numeric = Number(match[2]);
  const unit = match[3];
  return {
    value: unit === "tb" ? numeric * 1024 : numeric,
    unit: unit === "tb" || unit === "gb" ? "GB" : "IN",
    minimum: match[1] !== undefined
  };
}

function parseMeasurements(value: string): Measurement[] {
  return [...value.matchAll(/\b(\d+(?:\.\d+)?)\s*(tb|gb|inches|inch|in)\b/gu)].map((match) => {
    const numeric = Number(match[1]);
    const unit = match[2];
    return {
      value: unit === "tb" ? numeric * 1024 : numeric,
      unit: unit === "tb" || unit === "gb" ? "GB" as const : "IN" as const
    };
  });
}

const FEATURE_STOP_WORDS = new Set(["at", "least", "minimum", "min", "with", "for", "and", "or", "of", "the"]);

function meaningfulTokens(value: string): string[] {
  return (value.match(/[\p{L}\p{N}]+/gu) ?? [])
    .map(canonicalToken)
    .filter((token) => token.length > 1 && !FEATURE_STOP_WORDS.has(token));
}

function canonicalToken(value: string): string {
  let token = value;
  if (token.length > 5 && token.endsWith("ing")) token = token.slice(0, -3);
  else if (token.length > 4 && token.endsWith("ed")) token = token.slice(0, -2);
  else if (token.length > 4 && token.endsWith("es")) token = token.slice(0, -2);
  else if (token.length > 3 && token.endsWith("s")) token = token.slice(0, -1);
  if (token.length > 4 && token.endsWith("e")) token = token.slice(0, -1);
  return token;
}

function buildExpandedQuery(input: SearchProductsInput): string {
  const parts = [input.query, ...input.features]
    .map((part) => part.normalize("NFKC").trim())
    .filter((part, index, values) => part !== "" && values.indexOf(part) === index);
  return parts.join(" ").slice(0, 300).trim();
}

function mergeCandidates(
  current: UnifiedCandidate[],
  incoming: UnifiedCandidate[]
): UnifiedCandidate[] {
  const merged = new Map<string, UnifiedCandidate>();
  for (const candidate of [...current, ...incoming]) {
    const key = candidate.source === "AWIN_PRODUCT_FEED"
      ? `${candidate.source}:${candidate.awinProduct?.merchantId}:${candidate.awinProduct?.merchantProductId}`
      : `${candidate.source}:${candidate.shopifyProduct?.merchantId}:${candidate.shopifyProduct?.handle}`;
    const existing = merged.get(key);
    if (existing === undefined || compareCandidates(candidate, existing) < 0) merged.set(key, candidate);
  }
  return [...merged.values()].sort(compareCandidates);
}

function compareCandidates(
  left: UnifiedCandidate,
  right: UnifiedCandidate
): number {
  const featureDifference = right.featureEvidence.length - left.featureEvidence.length;
  if (featureDifference !== 0) return featureDifference;
  const matchDifference = matchRank(right) - matchRank(left);
  if (matchDifference !== 0) return matchDifference;
  const priceDifference = price(left) - price(right);
  if (priceDifference !== 0) return priceDifference;
  return title(left).localeCompare(title(right));
}

function matchRank(candidate: UnifiedCandidate): number {
  const status = candidate.shopifyProduct?.matchStatus ?? candidate.awinProduct?.matchStatus;
  return status === "EXACT" ? 3 : status === "DISCOVERY_MATCH" ? 2 : 1;
}

function price(candidate: UnifiedCandidate): number {
  return candidate.shopifyProduct?.itemPrice?.amountCents ??
    candidate.awinProduct?.itemPrice.amountCents ??
    Number.MAX_SAFE_INTEGER;
}

function title(candidate: UnifiedCandidate): string {
  return candidate.shopifyProduct?.title ?? candidate.awinProduct?.title ?? "";
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}
