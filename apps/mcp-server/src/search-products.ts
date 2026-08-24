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
    shopifyResult?.diagnostics.chromeFallbackEligible === true;

  return {
    candidates,
    ...(awinResult === undefined ? {} : { awinResult }),
    ...(shopifyResult === undefined ? {} : { shopifyResult }),
    sourceStatus: { awin: awinStatus, shopify: shopifyStatus },
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
  const normalized = normalize(searchable);
  return features.filter((feature) => normalized.includes(normalize(feature)));
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
