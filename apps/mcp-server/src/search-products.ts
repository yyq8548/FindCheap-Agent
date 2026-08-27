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
import type { EbayBrowsePort, EbayProduct, EbaySearchResult } from "./ebay-client.js";
import {
  VerifiedDealsSchema,
  type DealPort,
  type VerifiedDeal
} from "./deal-client.js";
import {
  merchantRecommendationRank,
  merchantRecommendationTier
} from "./merchant-trust.js";
import type { MerchantRecommendationTier } from "./merchant-trust.js";
import { evaluateFeature } from "./product-constraint-matcher.js";

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
  productType: z.string().trim().min(1).max(100).optional(),
  requiredFeatures: z.array(z.string().trim().min(1).max(80)).max(10)
    .refine((values) => new Set(values.map(normalize)).size === values.length, "required features must be unique")
    .default([]),
  preferences: z.array(z.string().trim().min(1).max(80)).max(10)
    .refine((values) => new Set(values.map(normalize)).size === values.length, "preferences must be unique")
    .default([]),
  // Backward-compatible input for clients installed before v0.9.5.
  features: z.array(z.string().trim().min(1).max(80)).max(10)
    .refine((values) => new Set(values.map(normalize)).size === values.length, "features must be unique")
    .default([]),
  featureMode: z.enum(["PREFERRED", "REQUIRED"]).default("PREFERRED")
}).strict();

export type SearchProductsInput = z.infer<typeof SearchProductsInputSchema>;

type CandidateBase = {
  affiliateState: "APPROVED" | "NONE";
  recommendationTier: MerchantRecommendationTier;
  featureEvidence: string[];
  preferenceEvidence: string[];
  requiredFeatureLimitations: string[];
  verifiedCoupons: VerifiedDeal[];
};

export type UnifiedCandidate = CandidateBase & (
  | { source: "AWIN_PRODUCT_FEED"; awinProduct: AwinProduct; shopifyProduct?: undefined; ebayProduct?: undefined }
  | { source: "SHOPIFY_GLOBAL_CATALOG"; awinProduct?: undefined; shopifyProduct: ShopifyProduct; ebayProduct?: undefined }
  | { source: "EBAY_BROWSE"; awinProduct?: undefined; shopifyProduct?: undefined; ebayProduct: EbayProduct }
);

export type UnifiedSearchExecution = {
  candidates: UnifiedCandidate[];
  awinResult?: AwinSearchResult;
  shopifyResult?: ShopifySearchResult;
  ebayResult?: EbaySearchResult;
  sourceStatus: {
    awin: "SKIPPED" | "COMPLETE" | "UNAVAILABLE";
    shopify: "SKIPPED" | "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
    ebay: "SKIPPED" | "COMPLETE" | "UNAVAILABLE";
  };
  sourceErrors?: {
    awin?: "DATA_SOURCE_UNAVAILABLE";
    shopify?: "CATALOG_SCHEMA_CHANGED" | "DATA_SOURCE_UNAVAILABLE";
    ebay?: "DATA_SOURCE_UNAVAILABLE";
  };
  searchPasses: 1 | 2;
  featureProductsExcluded: number;
  chromeFallbackEligible: boolean;
};

export function shouldQueryAwin(query: string): boolean {
  return query.normalize("NFKC").trim().length >= 2;
}

export async function searchProducts(
  rawInput: SearchProductsInput,
  ports: { awin: AwinProductPort; shopify: ShopifyPort; ebay?: EbayBrowsePort; deals?: DealPort }
): Promise<UnifiedSearchExecution> {
  const input = {
    ...rawInput,
    conditionPreference: explicitConditionPreference(rawInput.query, rawInput.conditionPreference),
    requiredFeatures: unique([
      ...rawInput.requiredFeatures,
      ...(rawInput.featureMode === "REQUIRED" ? rawInput.features : [])
    ]),
    preferences: unique([
      ...rawInput.preferences,
      ...(rawInput.featureMode === "PREFERRED" ? rawInput.features : [])
    ])
  };
  const sourceQuery = buildSourceQuery(input);
  const affiliateEligible = shouldQueryAwin(sourceQuery);
  let awinResult: AwinSearchResult | undefined;
  let shopifyResult: ShopifySearchResult | undefined;
  let ebayResult: EbaySearchResult | undefined;
  let awinStatus: UnifiedSearchExecution["sourceStatus"]["awin"] = affiliateEligible
    ? "UNAVAILABLE"
    : "SKIPPED";
  let shopifyStatus: UnifiedSearchExecution["sourceStatus"]["shopify"] = "UNAVAILABLE";
  let ebayStatus: UnifiedSearchExecution["sourceStatus"]["ebay"] = ports.ebay === undefined
    ? "SKIPPED"
    : "UNAVAILABLE";
  let awinError: "DATA_SOURCE_UNAVAILABLE" | undefined;
  let shopifyError: "CATALOG_SCHEMA_CHANGED" | "DATA_SOURCE_UNAVAILABLE" | undefined;
  let ebayError: "DATA_SOURCE_UNAVAILABLE" | undefined;
  let affiliateCandidates: UnifiedCandidate[] = [];
  let shopifyCandidates: UnifiedCandidate[] = [];
  let ebayCandidates: UnifiedCandidate[] = [];
  const featureExcludedKeys = new Set<string>();

  const queryAwin = async (query: string, limit: number, merge: boolean): Promise<void> => {
    if (!affiliateEligible) return;
    try {
      const result = await ports.awin.search({
        query,
        limit,
        ...(input.maxItemPriceCents === undefined ? {} : { maxItemPriceCents: input.maxItemPriceCents })
      });
      awinResult = result;
      awinStatus = "COMPLETE";
      const incoming = result.products
        .map((product) => awinCandidate(product, input, featureExcludedKeys))
        .filter((candidate): candidate is UnifiedCandidate => candidate !== undefined);
      affiliateCandidates = merge ? mergeCandidates(affiliateCandidates, incoming) : incoming;
    } catch {
      if (awinResult === undefined) {
        awinStatus = "UNAVAILABLE";
        awinError = "DATA_SOURCE_UNAVAILABLE";
      }
    }
  };
  const queryShopify = async (query: string, limit: number, merge: boolean): Promise<void> => {
    try {
      const result = await ports.shopify.search({
        query,
        limit,
        comparisonMode: input.comparisonMode,
        selectionMode: input.selectionMode,
        ...(input.maxItemPriceCents === undefined ? {} : { maxItemPriceCents: input.maxItemPriceCents }),
        ...(input.zipCode === undefined ? {} : { zipCode: input.zipCode }),
        membershipIds: input.membershipIds ?? []
      });
      shopifyResult = result;
      shopifyStatus = result.coverage;
      const incoming = result.products
        .map((product) => shopifyCandidate(product, input, featureExcludedKeys))
        .filter((candidate): candidate is UnifiedCandidate => candidate !== undefined);
      shopifyCandidates = merge ? mergeCandidates(shopifyCandidates, incoming) : incoming;
    } catch (error) {
      shopifyStatus = shopifyResult === undefined ? "UNAVAILABLE" : "PARTIAL";
      shopifyError ??= productSourceError(error);
    }
  };
  const queryEbay = async (query: string, limit: number, merge: boolean): Promise<void> => {
    if (ports.ebay === undefined || ebayStatus === "SKIPPED") return;
    try {
      const result = await ports.ebay.search({
        query,
        limit,
        ...(input.maxItemPriceCents === undefined ? {} : { maxItemPriceCents: input.maxItemPriceCents }),
        ...(input.zipCode === undefined ? {} : { zipCode: input.zipCode })
      });
      ebayResult = result;
      ebayStatus = "COMPLETE";
      const incoming = result.products
        .map((product) => ebayCandidate(product, input, featureExcludedKeys))
        .filter((candidate): candidate is UnifiedCandidate => candidate !== undefined);
      ebayCandidates = merge ? mergeCandidates(ebayCandidates, incoming) : incoming;
    } catch (error) {
      if (error instanceof Error && error.message === "SOURCE_NOT_CONFIGURED") {
        if (ebayResult === undefined) ebayStatus = "SKIPPED";
      } else if (ebayResult === undefined) {
        ebayStatus = "UNAVAILABLE";
        ebayError = "DATA_SOURCE_UNAVAILABLE";
      }
    }
  };

  await Promise.all([
    queryAwin(sourceQuery, 12, false),
    queryShopify(sourceQuery, input.limit, false),
    queryEbay(sourceQuery, input.selectionMode === "MERCHANT_DIVERSE" ? 1 : 12, false)
  ]);

  let searchPasses: 1 | 2 = 1;
  const expandedQuery = buildExpandedQuery(input);
  if (affiliateCandidates.length + ebayCandidates.length + shopifyCandidates.length < input.limit) {
    searchPasses = 2;
    await Promise.all([
      queryAwin(expandedQuery, 24, true),
      shopifyError === "CATALOG_SCHEMA_CHANGED"
        ? Promise.resolve()
        : queryShopify(expandedQuery, 12, true),
      queryEbay(expandedQuery, 12, true)
    ]);
  }

  const enrichedCandidates = await addVerifiedCoupons(
    [...affiliateCandidates, ...shopifyCandidates, ...ebayCandidates],
    ports.deals,
    input.membershipIds ?? []
  );
  const candidates = enrichedCandidates
    .sort(input.selectionMode === "LOWEST_PRICE" ? compareLowestPrice : compareRankedCandidates)
    .slice(0, input.limit);
  const queriedSourcesComplete =
    awinStatus !== "UNAVAILABLE" &&
    ebayStatus !== "UNAVAILABLE" &&
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
    ...(ebayResult === undefined ? {} : { ebayResult }),
    sourceStatus: { awin: awinStatus, shopify: shopifyStatus, ebay: ebayStatus },
    ...(awinError === undefined && shopifyError === undefined && ebayError === undefined
      ? {}
      : {
          sourceErrors: {
            ...(awinError === undefined ? {} : { awin: awinError }),
            ...(shopifyError === undefined ? {} : { shopify: shopifyError }),
            ...(ebayError === undefined ? {} : { ebay: ebayError })
          }
        }),
    searchPasses,
    featureProductsExcluded: featureExcludedKeys.size,
    chromeFallbackEligible
  };
}

function productSourceError(error: unknown): "CATALOG_SCHEMA_CHANGED" | "DATA_SOURCE_UNAVAILABLE" {
  return error instanceof Error && error.message === "CATALOG_SCHEMA_CHANGED"
    ? "CATALOG_SCHEMA_CHANGED"
    : "DATA_SOURCE_UNAVAILABLE";
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
  const evidence = evaluateConstraints(`${product.title} ${product.category}`, input);
  if (evidence.contradicted.length > 0) {
    featureExcludedKeys.add(`AWIN:${product.merchantId}:${product.merchantProductId}`);
    return undefined;
  }
  return {
    source: "AWIN_PRODUCT_FEED",
    affiliateState: "APPROVED",
    recommendationTier: "TRUSTED_OR_AFFILIATE",
    featureEvidence: evidence.matched,
    preferenceEvidence: evidence.preferences,
    requiredFeatureLimitations: evidence.unknown,
    verifiedCoupons: [],
    awinProduct: evidence.unknown.length === 0 ? product : {
      ...product,
      matchStatus: "DISCOVERY_MATCH",
      matchEvidence: [...product.matchEvidence, `required features not verified: ${evidence.unknown.join(", ")}`]
    }
  };
}

function shopifyCandidate(
  product: ShopifyProduct,
  input: SearchProductsInput,
  featureExcludedKeys: Set<string>
): UnifiedCandidate | undefined {
  if (product.merchantTrust.level === "RISKY") return undefined;
  if (!conditionMatches(product.condition, input.conditionPreference)) return undefined;
  const evidence = evaluateConstraints(shopifyEvidenceText(product), input);
  if (evidence.contradicted.length > 0) {
    featureExcludedKeys.add(`SHOPIFY:${product.merchantId}:${product.handle}`);
    return undefined;
  }
  return {
    source: "SHOPIFY_GLOBAL_CATALOG",
    affiliateState: "NONE",
    recommendationTier: merchantRecommendationTier(product.merchantTrust, product.productRating),
    featureEvidence: evidence.matched,
    preferenceEvidence: evidence.preferences,
    requiredFeatureLimitations: evidence.unknown,
    verifiedCoupons: [],
    shopifyProduct: evidence.unknown.length === 0 ? product : {
      ...product,
      matchStatus: "DISCOVERY_MATCH",
      matchEvidence: [...product.matchEvidence, `required features not verified: ${evidence.unknown.join(", ")}`]
    }
  };
}

function ebayCandidate(
  product: EbayProduct,
  input: SearchProductsInput,
  featureExcludedKeys: Set<string>
): UnifiedCandidate | undefined {
  if (!conditionMatches(product.condition, input.conditionPreference)) return undefined;
  const evidence = evaluateConstraints(
    [product.title, product.category, ...product.attributes].join(" "),
    input
  );
  if (evidence.contradicted.length > 0) {
    featureExcludedKeys.add(`EBAY:${product.itemId}`);
    return undefined;
  }
  return {
    source: "EBAY_BROWSE",
    affiliateState: product.affiliateUrl === undefined ? "NONE" : "APPROVED",
    recommendationTier: "GENERAL_UNVERIFIED",
    featureEvidence: evidence.matched,
    preferenceEvidence: evidence.preferences,
    requiredFeatureLimitations: evidence.unknown,
    verifiedCoupons: [],
    ebayProduct: evidence.unknown.length === 0 ? product : {
      ...product,
      matchEvidence: [...product.matchEvidence, `required features not verified: ${evidence.unknown.join(", ")}`]
    }
  };
}

function conditionMatches(
  actual: ShopifyCondition,
  expected: SearchProductsInput["conditionPreference"]
): boolean {
  return expected === "ANY" || actual === expected;
}

function buildExpandedQuery(input: SearchProductsInput): string {
  const requiredFeatures = unique([
    ...input.requiredFeatures,
    ...(input.featureMode === "REQUIRED" ? input.features : [])
  ]);
  const preferences = unique([
    ...input.preferences,
    ...(input.featureMode === "PREFERRED" ? input.features : [])
  ]);
  const parts = [buildSourceQuery(input), ...requiredFeatures, ...preferences]
    .map((part) => part.normalize("NFKC").trim())
    .filter((part, index, values) => part !== "" && values.indexOf(part) === index);
  return parts.join(" ").slice(0, 300).trim();
}

function buildSourceQuery(input: Pick<SearchProductsInput, "query" | "productType">): string {
  return unique([input.query, input.productType ?? ""]).join(" ").slice(0, 300).trim();
}

function mergeCandidates(
  current: UnifiedCandidate[],
  incoming: UnifiedCandidate[]
): UnifiedCandidate[] {
  const merged = new Map<string, UnifiedCandidate>();
  for (const candidate of [...current, ...incoming]) {
    const key = candidate.source === "AWIN_PRODUCT_FEED"
      ? `${candidate.source}:${candidate.awinProduct.merchantId}:${candidate.awinProduct.merchantProductId}`
      : candidate.source === "SHOPIFY_GLOBAL_CATALOG"
        ? `${candidate.source}:${candidate.shopifyProduct.merchantId}:${candidate.shopifyProduct.handle}`
        : `${candidate.source}:${candidate.ebayProduct.itemId}`;
    const existing = merged.get(key);
    if (existing === undefined || compareRankedCandidates(candidate, existing) < 0) merged.set(key, candidate);
  }
  return [...merged.values()].sort(compareRankedCandidates);
}

async function addVerifiedCoupons(
  candidates: UnifiedCandidate[],
  deals: DealPort | undefined,
  membershipIds: string[]
): Promise<UnifiedCandidate[]> {
  if (deals === undefined || candidates.length === 0) return candidates;
  const merchants = new Map<string, string>();
  for (const candidate of [...candidates].sort(compareRankedCandidates)) {
    const merchant = candidateMerchant(candidate);
    const key = normalize(merchant);
    if (!merchants.has(key)) merchants.set(key, merchant);
    if (merchants.size === 12) break;
  }
  const results: Array<readonly [string, VerifiedDeal[]]> = await Promise.all([...merchants].map(async ([key, merchant]) => {
    try {
      const verified = VerifiedDealsSchema.parse(await deals.search({
        merchant,
        membershipIds,
        channel: "ONLINE"
      })).filter(isCoupon);
      return [key, verified] as const;
    } catch {
      return [key, [] as VerifiedDeal[]] as const;
    }
  }));
  const byMerchant = new Map(results);
  return candidates.map((candidate) => ({
    ...candidate,
    verifiedCoupons: byMerchant.get(normalize(candidateMerchant(candidate))) ?? []
  }));
}

function isCoupon(deal: VerifiedDeal): boolean {
  return deal.kind === "COUPON" || deal.kind === "PROMO_CODE" || deal.kind === "BRAND_PROMOTION";
}

function candidateMerchant(candidate: UnifiedCandidate): string {
  if (candidate.source === "AWIN_PRODUCT_FEED") return candidate.awinProduct.merchant;
  if (candidate.source === "EBAY_BROWSE") return "eBay";
  return candidate.shopifyProduct.merchant;
}

function compareRankedCandidates(
  left: UnifiedCandidate,
  right: UnifiedCandidate
): number {
  const limitationDifference = left.requiredFeatureLimitations.length - right.requiredFeatureLimitations.length;
  if (limitationDifference !== 0) return limitationDifference;
  const featureDifference = right.featureEvidence.length - left.featureEvidence.length;
  if (featureDifference !== 0) return featureDifference;
  const matchDifference = matchRank(right) - matchRank(left);
  if (matchDifference !== 0) return matchDifference;
  const tierDifference = merchantRecommendationRank(left.recommendationTier) -
    merchantRecommendationRank(right.recommendationTier);
  if (tierDifference !== 0) return tierDifference;
  const preferenceDifference = right.preferenceEvidence.length - left.preferenceEvidence.length;
  if (preferenceDifference !== 0) return preferenceDifference;
  const couponDifference = Number(right.verifiedCoupons.length > 0) - Number(left.verifiedCoupons.length > 0);
  if (couponDifference !== 0) return couponDifference;
  const priceDifference = price(left) - price(right);
  if (priceDifference !== 0) return priceDifference;
  const ratingDifference = productRating(right) - productRating(left);
  if (ratingDifference !== 0) return ratingDifference;
  return title(left).localeCompare(title(right));
}

function productRating(candidate: UnifiedCandidate): number {
  return candidate.source === "SHOPIFY_GLOBAL_CATALOG" ? candidate.shopifyProduct.productRating?.value ?? 0 : 0;
}

function compareLowestPrice(left: UnifiedCandidate, right: UnifiedCandidate): number {
  return price(left) - price(right) ||
    Number(right.verifiedCoupons.length > 0) - Number(left.verifiedCoupons.length > 0) ||
    compareRankedCandidates(left, right);
}

function matchRank(candidate: UnifiedCandidate): number {
  const status = candidate.source === "AWIN_PRODUCT_FEED"
    ? candidate.awinProduct.matchStatus
    : candidate.source === "SHOPIFY_GLOBAL_CATALOG"
      ? candidate.shopifyProduct.matchStatus
      : candidate.ebayProduct.matchStatus;
  return status === "EXACT" ? 3 : status === "DISCOVERY_MATCH" ? 2 : 1;
}

function price(candidate: UnifiedCandidate): number {
  if (candidate.source === "AWIN_PRODUCT_FEED") return candidate.awinProduct.itemPrice.amountCents;
  if (candidate.source === "EBAY_BROWSE") return candidate.ebayProduct.itemPrice.amountCents;
  return candidate.shopifyProduct.itemPrice?.amountCents ?? Number.MAX_SAFE_INTEGER;
}

function title(candidate: UnifiedCandidate): string {
  if (candidate.source === "AWIN_PRODUCT_FEED") return candidate.awinProduct.title;
  if (candidate.source === "EBAY_BROWSE") return candidate.ebayProduct.title;
  return candidate.shopifyProduct.title;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

function evaluateConstraints(
  searchable: string,
  input: Pick<SearchProductsInput, "requiredFeatures" | "preferences" | "features" | "featureMode">
): { matched: string[]; contradicted: string[]; unknown: string[]; preferences: string[] } {
  const required = unique([
    ...input.requiredFeatures,
    ...(input.featureMode === "REQUIRED" ? input.features : [])
  ]);
  const preferences = unique([
    ...input.preferences,
    ...(input.featureMode === "PREFERRED" ? input.features : [])
  ]);
  const matched: string[] = [];
  const contradicted: string[] = [];
  const unknown: string[] = [];
  for (const feature of required) {
    const status = evaluateFeature(searchable, feature);
    if (status === "MATCHED") matched.push(feature);
    else if (status === "CONTRADICTED") contradicted.push(feature);
    else unknown.push(feature);
  }
  return {
    matched,
    contradicted,
    unknown,
    preferences: preferences.filter((feature) => evaluateFeature(searchable, feature) === "MATCHED")
  };
}

function shopifyEvidenceText(product: ShopifyProduct): string {
  return [
    product.title,
    product.productType ?? "",
    product.description ?? "",
    product.brand ?? "",
    product.sku ?? "",
    ...Object.entries(product.variantDimensions).flat()
  ].join(" ");
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalize(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
