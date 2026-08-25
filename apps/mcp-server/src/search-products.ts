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
import {
  merchantRecommendationRank,
  merchantRecommendationTier
} from "./merchant-trust.js";
import type { MerchantRecommendationTier } from "./merchant-trust.js";
import { matchFeatures } from "./product-constraint-matcher.js";

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
  recommendationTier: MerchantRecommendationTier;
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
  featureProductsExcluded: number;
  chromeFallbackEligible: boolean;
};

const AFFILIATE_HAIR_QUERY = /(?:\bhair\b|haircare|hair[\s-]*care|hair[\s-]*mask|keratin|shampoo|conditioner|straighten|smoothing|styling|amazonliss|nutree|护发|头发|发膜|角蛋白|洗发水|护发素|拉直|顺滑|造型)/iu;
const AFFILIATE_TRAIL_CAMERA_QUERY = /(?:gardepro|trail[\s-]*camera|game[\s-]*camera|hunting[\s-]*camera|wildlife[\s-]*camera|狩猎相机|打猎相机|猎场相机|追踪相机|野生动物相机)/iu;

export function isApprovedAffiliateQuery(query: string): boolean {
  const normalized = query.normalize("NFKC");
  return AFFILIATE_HAIR_QUERY.test(normalized) || AFFILIATE_TRAIL_CAMERA_QUERY.test(normalized);
}

export async function searchProducts(
  rawInput: SearchProductsInput,
  ports: { awin: AwinProductPort; shopify: ShopifyPort }
): Promise<UnifiedSearchExecution> {
  const input = {
    ...rawInput,
    conditionPreference: explicitConditionPreference(rawInput.query, rawInput.conditionPreference)
  };
  const affiliateEligible = isApprovedAffiliateQuery(input.query);
  let awinResult: AwinSearchResult | undefined;
  let shopifyResult: ShopifySearchResult | undefined;
  let awinStatus: UnifiedSearchExecution["sourceStatus"]["awin"] = affiliateEligible
    ? "UNAVAILABLE"
    : "SKIPPED";
  let shopifyStatus: UnifiedSearchExecution["sourceStatus"]["shopify"] = "SKIPPED";
  let affiliateCandidates: UnifiedCandidate[] = [];
  const featureExcludedKeys = new Set<string>();

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
        .map((product) => awinCandidate(product, input, featureExcludedKeys))
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
        .map((product) => shopifyCandidate(product, input, featureExcludedKeys))
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
            .map((product) => awinCandidate(product, input, featureExcludedKeys))
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
          .map((product) => shopifyCandidate(product, input, featureExcludedKeys))
          .filter((candidate): candidate is UnifiedCandidate => candidate !== undefined)
      );
    } catch {
      shopifyStatus = shopifyStatus === "COMPLETE" ? "PARTIAL" : "UNAVAILABLE";
    }
  }

  const candidates = [...affiliateCandidates, ...shopifyCandidates]
    .sort(input.selectionMode === "LOWEST_PRICE" ? compareCandidates : compareRecommendationTiers)
    .slice(0, input.limit);
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
    featureProductsExcluded: featureExcludedKeys.size,
    chromeFallbackEligible
  };
}

function explicitConditionPreference(
  query: string,
  requested: SearchProductsInput["conditionPreference"]
): SearchProductsInput["conditionPreference"] {
  if (requested === "ANY") return "ANY";
  const text = query.normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/\bnew\s+(?:balance|era|look)\b/gu, "");
  const patterns: Record<Exclude<SearchProductsInput["conditionPreference"], "ANY">, RegExp> = {
    NEW: /(?:全新|新品|未拆封|原封)|\b(?:new|brand[\s-]*new|factory[\s-]*sealed|unopened)\b/iu,
    USED: /(?:二手|中古)|\b(?:used|pre[\s-]*owned|second[\s-]*hand|resale)\b/iu,
    REFURBISHED: /(?:翻新|官翻)|\b(?:refurbished|renewed|reconditioned)\b/iu,
    OPEN_BOX: /(?:开箱品|拆箱品)|\bopen[\s-]*box\b/iu,
    UNKNOWN: /(?:成色未知|状态未知)|\b(?:unknown|unspecified)\s+condition\b/iu
  };
  return patterns[requested].test(text) ? requested : "ANY";
}

function awinCandidate(
  product: AwinProduct,
  input: SearchProductsInput,
  featureExcludedKeys: Set<string>
): UnifiedCandidate | undefined {
  if (!conditionMatches(product.condition, input.conditionPreference)) return undefined;
  const featureEvidence = matchFeatures(
    `${product.title} ${product.category}`,
    input.features
  );
  if (input.featureMode === "REQUIRED" && featureEvidence.length !== input.features.length) {
    featureExcludedKeys.add(`AWIN:${product.merchantId}:${product.merchantProductId}`);
    return undefined;
  }
  return {
    source: "AWIN_PRODUCT_FEED",
    affiliateState: "APPROVED",
    recommendationTier: "TRUSTED_OR_AFFILIATE",
    featureEvidence,
    awinProduct: product
  };
}

function shopifyCandidate(
  product: ShopifyProduct,
  input: SearchProductsInput,
  featureExcludedKeys: Set<string>
): UnifiedCandidate | undefined {
  if (product.merchantTrust.level === "RISKY") return undefined;
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
    featureExcludedKeys.add(`SHOPIFY:${product.merchantId}:${product.handle}`);
    return undefined;
  }
  return {
    source: "SHOPIFY_GLOBAL_CATALOG",
    affiliateState: "NONE",
    recommendationTier: merchantRecommendationTier(product.merchantTrust, product.productRating),
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
  const tierDifference = merchantRecommendationRank(left.recommendationTier) -
    merchantRecommendationRank(right.recommendationTier);
  if (tierDifference !== 0) return tierDifference;
  const featureDifference = right.featureEvidence.length - left.featureEvidence.length;
  if (featureDifference !== 0) return featureDifference;
  const matchDifference = matchRank(right) - matchRank(left);
  if (matchDifference !== 0) return matchDifference;
  const ratingDifference = productRating(right) - productRating(left);
  if (ratingDifference !== 0) return ratingDifference;
  const priceDifference = price(left) - price(right);
  if (priceDifference !== 0) return priceDifference;
  return title(left).localeCompare(title(right));
}

function compareRecommendationTiers(
  left: UnifiedCandidate,
  right: UnifiedCandidate
): number {
  return merchantRecommendationRank(left.recommendationTier) -
    merchantRecommendationRank(right.recommendationTier);
}

function productRating(candidate: UnifiedCandidate): number {
  return candidate.shopifyProduct?.productRating?.value ?? 0;
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
