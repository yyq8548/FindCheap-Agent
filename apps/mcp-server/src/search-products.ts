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
  merchantRecommendationTier,
  resolveVerifiedOfficialStorefront,
  resolveMerchantTrust
} from "./merchant-trust.js";
import type { MerchantRecommendationTier } from "./merchant-trust.js";
import { evaluateFeature } from "./product-constraint-matcher.js";
import {
  VisualProductInputSchema,
  classifyVisualProduct,
  isVisualAttributeOccluded,
  visualBroadSearchTerms,
  visualOfficialStoreSearchQueries,
  visualSearchTerms,
  type VisualMatch,
  type VisualMatchGroup,
  type VisualOfficialStoreQuery,
  type VisualProductInput
} from "./visual-product-discovery.js";
import {
  classifyShopifyCandidate,
  hasNamedProductIntent,
  hasStrongProductIdentifier,
  type ShopifyMatchCandidate,
  type ShopifyMatchStatus
} from "./shopify-match.js";
import type {
  OfficialShopifySearchPort,
  OfficialShopifyStoreSeed
} from "./shopify-official-store-search.js";
import type { OfficialStorefrontRegistryPort } from "./official-storefront-registry-client.js";

const QuerySchema = z.string().trim().min(2).max(300)
  .refine((value) => /[\p{L}\p{N}]/u.test(value), "query must contain a letter or number")
  .transform(normalizeQueryPunctuation);

export const SearchProductsInputSchema = z.object({
  query: QuerySchema,
  limit: z.number().int().min(1).max(3).default(3),
  maxItemPriceCents: z.number().int().min(1).max(100_000_000)
    .describe("Inclusive price ceiling, never a spending target")
    .optional(),
  zipCode: z.string().regex(/^\d{5}(?:-\d{4})?$/u).optional(),
  membershipIds: z.array(z.string().trim().min(1).max(80)).max(20)
    .refine((values) => new Set(values).size === values.length, "membership IDs must be unique")
    .optional(),
  comparisonMode: z.enum(["DISCOVERY", "SAME_PRODUCT"]).default("DISCOVERY"),
  allowAlternatives: z.boolean().default(false),
  selectionMode: z.enum(["LOWEST_PRICE", "MERCHANT_DIVERSE"]).default("MERCHANT_DIVERSE"),
  conditionPreference: z.enum(["ANY", "NEW", "USED", "REFURBISHED", "OPEN_BOX", "UNKNOWN"])
    .default("ANY"),
  brand: z.string().trim().min(1).max(100).transform(canonicalBrandName).optional(),
  brandMode: z.enum(["REQUIRED", "PREFERRED", "OBSERVED"]).default("REQUIRED"),
  productType: z.string().trim().min(1).max(100).optional(),
  requiredFeatures: z.array(z.string().trim().min(1).max(80)).max(10)
    .refine((values) => new Set(values.map(normalize)).size === values.length, "required features must be unique")
    .default([]),
  preferences: z.array(z.string().trim().min(1).max(80)).max(10)
    .refine((values) => new Set(values.map(normalize)).size === values.length, "preferences must be unique")
    .default([]),
  contextMode: z.enum([
    "NEW_PRODUCT",
    "CONTINUE_PREVIOUS_PRODUCT",
    "CORRECT_PREVIOUS_PRODUCT",
    "AMBIGUOUS"
  ]).describe("NEW for a different shopping goal; CONTINUE for added budget, use, size, or other constraints; CORRECT only when the user changes prior product identity; AMBIGUOUS when unclear")
    .default("NEW_PRODUCT"),
  visualInput: VisualProductInputSchema.optional(),
  // Backward-compatible input for clients installed before v0.9.5.
  features: z.array(z.string().trim().min(1).max(80)).max(10)
    .refine((values) => new Set(values.map(normalize)).size === values.length, "features must be unique")
    .default([]),
  featureMode: z.enum(["PREFERRED", "REQUIRED"]).default("PREFERRED")
}).strict();

export type SearchProductsInput = z.infer<typeof SearchProductsInputSchema>;

/** Internal execution controls. These are never exposed through the MCP schema. */
export type SearchProductsExecutionInput = SearchProductsInput & {
  deferVisualFiltering?: boolean;
};

type CandidateBase = {
  affiliateState: "APPROVED" | "NONE";
  recommendationTier: MerchantRecommendationTier;
  featureEvidence: string[];
  preferenceEvidence: string[];
  requiredFeatureLimitations: string[];
  verifiedCoupons: VerifiedDeal[];
  identityStatus: Exclude<ShopifyMatchStatus, "IRRELEVANT">;
  identityEvidence: string[];
  resultGroup: "REQUESTED_PRODUCT" | "DISCOVERY" | "ALTERNATIVE";
  visualMatchGroup?: VisualMatchGroup | undefined;
  visualMatchEvidence?: string[] | undefined;
  visualMatchScore?: number | undefined;
  presentationGroup?: ProductPresentationGroup | undefined;
};

export type ProductPresentationGroup = "OFFICIAL_STORE" | "TRUSTED_MATCH" | "BEST_VALUE";

export type ProductSearchIntent = "EXACT_PRODUCT" | "CATEGORY_DISCOVERY" | "VISUAL_DISCOVERY";

export type UnifiedCandidate = CandidateBase & (
  | { source: "AWIN_PRODUCT_FEED"; awinProduct: AwinProduct; shopifyProduct?: undefined; ebayProduct?: undefined }
  | { source: "SHOPIFY_GLOBAL_CATALOG"; awinProduct?: undefined; shopifyProduct: ShopifyProduct; ebayProduct?: undefined }
  | { source: "EBAY_BROWSE"; awinProduct?: undefined; shopifyProduct?: undefined; ebayProduct: EbayProduct }
);

export const VisualEvidenceAttributeSchema = z.enum([
  "PRODUCT_TYPE",
  "SILHOUETTE",
  "NECKLINE",
  "SLEEVE",
  "CLOSURE",
  "COLLAR",
  "WAIST",
  "HEM",
  "LENGTH",
  "PATTERN",
  "PRINT_PLACEMENT",
  "COLOR",
  "MATERIAL",
  "VISIBLE_TEXT",
  "DISTINCTIVE_DETAIL",
  "MODEL_STYLE_NUMBER"
]);

const VisualEvidencePairSchema = z.object({
  attribute: VisualEvidenceAttributeSchema,
  referenceEvidence: z.string().trim().min(1).max(160),
  candidateEvidence: z.string().trim().min(1).max(160)
}).strict();

export const CodexVisualVerdictSchema = z.object({
  classification: z.enum(["POSSIBLE_SAME_ITEM", "HIGHLY_SIMILAR", "SAME_STYLE", "CONFLICT"]),
  matches: z.array(VisualEvidencePairSchema).max(16).default([]),
  conflicts: z.array(VisualEvidencePairSchema).max(16).default([])
}).strict();

export type CodexVisualVerdict = z.infer<typeof CodexVisualVerdictSchema>;

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
  sourcePassDiagnostics: Array<{
    pass: 1 | 2;
    query: string;
    rawProducts: { awin: number; shopify: number; ebay: number };
    acceptedCandidates: { awin: number; shopify: number; ebay: number };
  }>;
  featureProductsExcluded: number;
  brandProductsExcluded: number;
  identityProductsExcluded: number;
  visualProductsExcluded: number;
  officialStoreFallback: {
    status: "NOT_USED" | "COMPLETE" | "UNAVAILABLE";
    productsReturned: number;
    sourceHost?: string;
    diagnostic?: {
      outcome:
        | "ACCEPTED"
        | "OFFICIAL_ZERO_RESULTS"
        | "OFFICIAL_VISUAL_EVIDENCE_INSUFFICIENT"
        | "OFFICIAL_CANDIDATES_REJECTED"
        | "OFFICIAL_UNAVAILABLE";
      attempts: Array<{
        stage: VisualOfficialStoreQuery["stage"];
        query: string;
        productsReturned: number;
        acceptedCandidates: number;
      }>;
    };
  };
  searchIntent: ProductSearchIntent;
  chromeFallbackEligible: boolean;
};

export function finalizeCodexVisualCandidates(
  reviewed: Array<{ candidate: UnifiedCandidate; verdict: CodexVisualVerdict }>,
  allowAlternatives: boolean,
  limit = 3,
  visualInput?: VisualProductInput
): UnifiedCandidate[] {
  const accepted = reviewed.flatMap(({ candidate, verdict }) => {
    const visibleMatches = visualInput === undefined
      ? verdict.matches
      : verdict.matches.filter((entry) => !isVisualAttributeOccluded(visualInput, entry.attribute));
    const visibleConflicts = visualInput === undefined
      ? verdict.conflicts
      : verdict.conflicts.filter((entry) => !isVisualAttributeOccluded(visualInput, entry.attribute));
    const ignoredConflictCount = verdict.conflicts.length - visibleConflicts.length;
    const uniqueMatches = new Map(visibleMatches.map((entry) => [entry.attribute, entry]));
    const matchCount = uniqueMatches.size;
    const structuralMatchCount = [...uniqueMatches.keys()]
      .filter((attribute) => attribute !== "COLOR" && attribute !== "PATTERN").length;
    const colorwayOnlyConflict = visibleConflicts.length > 0 &&
      visibleConflicts.every((entry) => entry.attribute === "COLOR" || entry.attribute === "PATTERN") &&
      structuralMatchCount >= 3;
    const reviewedClassification = verdict.classification === "CONFLICT" &&
      ignoredConflictCount > 0 && visibleConflicts.length === 0
      ? matchCount >= 3
        ? "POSSIBLE_SAME_ITEM" as const
        : matchCount >= 2
          ? "HIGHLY_SIMILAR" as const
          : "SAME_STYLE" as const
      : verdict.classification;
    if (
      (reviewedClassification === "CONFLICT" || visibleConflicts.length > 0) &&
      !colorwayOnlyConflict
    ) return [];
    const classification = colorwayOnlyConflict ? "HIGHLY_SIMILAR" : reviewedClassification;
    const group: VisualMatchGroup = classification === "POSSIBLE_SAME_ITEM" && matchCount >= 3
      ? "POSSIBLE_SAME_ITEM"
      : (classification === "POSSIBLE_SAME_ITEM" || classification === "HIGHLY_SIMILAR") && matchCount >= 2
        ? "HIGHLY_SIMILAR"
        : "SAME_STYLE";
    if (group === "SAME_STYLE" && !allowAlternatives) return [];
    const visualEvidence = [...uniqueMatches.values()].map((entry) =>
      `Codex visual match ${entry.attribute}: ${entry.referenceEvidence} | ${entry.candidateEvidence}`
    );
    const visualDifferences = visibleConflicts.map((entry) =>
      `Codex visual difference ${entry.attribute}: ${entry.referenceEvidence} | ${entry.candidateEvidence}`
    );
    const stableExact = candidate.identityStatus === "EXACT";
    return [{
      ...candidate,
      visualMatchGroup: group,
      visualMatchEvidence: unique([...(candidate.visualMatchEvidence ?? []), ...visualEvidence, ...visualDifferences]),
      visualMatchScore: visualGroupScore(group) + Math.min(matchCount, 16),
      identityEvidence: unique([...candidate.identityEvidence, ...visualEvidence, ...visualDifferences]),
      identityStatus: stableExact ? "EXACT" as const : group === "SAME_STYLE" ? "SIMILAR" as const : "DISCOVERY_MATCH" as const,
      resultGroup: stableExact ? candidate.resultGroup : visualResultGroup(group)
    }];
  }).sort(compareRankedCandidates);
  return selectPresentationCandidates(
    accepted,
    limit,
    "MERCHANT_DIVERSE",
    allowAlternatives,
    true
  ).slice(0, limit);
}

export function shouldQueryAwin(query: string): boolean {
  return query.normalize("NFKC").trim().length >= 2;
}

export async function searchProducts(
  rawInput: SearchProductsExecutionInput,
  ports: {
    awin: AwinProductPort;
    shopify: ShopifyPort;
    ebay?: EbayBrowsePort;
    deals?: DealPort;
    officialShopify?: OfficialShopifySearchPort;
    officialStorefrontRegistry?: OfficialStorefrontRegistryPort;
  }
): Promise<UnifiedSearchExecution> {
  await ports.officialStorefrontRegistry?.refresh();
  const input = {
    ...rawInput,
    visualInput: rawInput.visualInput === undefined
      ? undefined
      : {
          ...rawInput.visualInput,
          ...(rawInput.visualInput.brand === undefined && rawInput.brand !== undefined
            ? { brand: rawInput.brand }
            : {})
        },
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
  const searchIntent = resolveSearchIntent(input);
  const productQuery = productOnlyQuery(input.query, input.maxItemPriceCents !== undefined);
  const identityQuery = searchIntent === "EXACT_PRODUCT"
    ? unique([
        input.brand !== undefined && !containsBrand(productQuery, input.brand) ? input.brand : "",
        productQuery
      ]).join(" ").slice(0, 300).trim()
    : input.deferVisualFiltering === true
      ? productQuery
      : buildSourceQuery({ ...input, query: productQuery });
  const sourceQuery = searchIntent === "EXACT_PRODUCT"
    ? identityQuery
    : input.deferVisualFiltering === true
      ? productQuery
      : buildSourceQuery(input);
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
  let observedShopifyProducts: ShopifyProduct[] = [];
  let officialStoreFallback: UnifiedSearchExecution["officialStoreFallback"] = {
    status: "NOT_USED",
    productsReturned: 0
  };
  const featureExcludedKeys = new Set<string>();
  const brandExcludedKeys = new Set<string>();
  const identityExcludedKeys = new Set<string>();
  const visualExcludedKeys = new Set<string>();

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
        .map((product) => awinCandidate(
          product,
          input,
          searchIntent,
          identityQuery,
          featureExcludedKeys,
          brandExcludedKeys,
          identityExcludedKeys,
          visualExcludedKeys
        ))
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
        comparisonMode: searchIntent === "VISUAL_DISCOVERY" ? "DISCOVERY" : input.comparisonMode,
        selectionMode: input.selectionMode,
        ...(input.maxItemPriceCents === undefined ? {} : { maxItemPriceCents: input.maxItemPriceCents }),
        ...(input.zipCode === undefined ? {} : { zipCode: input.zipCode }),
        membershipIds: input.membershipIds ?? []
      });
      shopifyResult = result;
      observedShopifyProducts = mergeShopifyProducts(observedShopifyProducts, result.products);
      shopifyStatus = result.coverage;
      const incoming = result.products
        .map((product) => shopifyCandidate(
          product,
          input,
          searchIntent,
          identityQuery,
          featureExcludedKeys,
          brandExcludedKeys,
          identityExcludedKeys,
          visualExcludedKeys
        ))
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
        .map((product) => ebayCandidate(
          product,
          input,
          searchIntent,
          identityQuery,
          featureExcludedKeys,
          brandExcludedKeys,
          identityExcludedKeys,
          visualExcludedKeys
        ))
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
    queryShopify(sourceQuery, 12, false),
    queryEbay(sourceQuery, input.selectionMode === "MERCHANT_DIVERSE" ? 1 : 12, false)
  ]);

  const sourcePassDiagnostics: UnifiedSearchExecution["sourcePassDiagnostics"] = [sourcePassDiagnostic(
    1,
    sourceQuery,
    awinResult,
    shopifyResult,
    ebayResult,
    affiliateCandidates,
    shopifyCandidates,
    ebayCandidates
  )];

  let searchPasses: 1 | 2 = 1;
  const expandedQuery = buildExpandedQuery(input, searchIntent, identityQuery);
  if (
    countDisplayEligibleCandidates(
      [...affiliateCandidates, ...ebayCandidates, ...shopifyCandidates],
      input.allowAlternatives
    ) < input.limit
  ) {
    searchPasses = 2;
    await Promise.all([
      queryAwin(expandedQuery, 24, true),
      shopifyError === "CATALOG_SCHEMA_CHANGED"
        ? Promise.resolve()
        : queryShopify(expandedQuery, 12, true),
      queryEbay(expandedQuery, 12, true)
    ]);
    sourcePassDiagnostics.push(sourcePassDiagnostic(
      2,
      expandedQuery,
      awinResult,
      shopifyResult,
      ebayResult,
      affiliateCandidates,
      shopifyCandidates,
      ebayCandidates
    ));
  }

  const officialSeed = officialStoreSeed(observedShopifyProducts, input);
  if (
    ports.officialShopify !== undefined &&
    officialSeed !== undefined &&
    (input.brandMode === "REQUIRED" || lacksStrongMatch([...affiliateCandidates, ...shopifyCandidates, ...ebayCandidates], searchIntent))
  ) {
    const attempts: NonNullable<UnifiedSearchExecution["officialStoreFallback"]["diagnostic"]>["attempts"] = [];
    const officialProducts: ShopifyProduct[] = [];
    const officialCandidates: UnifiedCandidate[] = [];
    const visualExcludedBefore = visualExcludedKeys.size;
    try {
      for (const attempt of buildOfficialStoreQueries(input, searchIntent)) {
        const products = await ports.officialShopify.search({
          seed: officialSeed,
          query: attempt.query,
          limit: 12
        });
        const newProducts = mergeShopifyProducts(officialProducts, products);
        officialProducts.splice(0, officialProducts.length, ...newProducts);
        const incoming = products
          .map((product) => shopifyCandidate(
            product,
            input,
            searchIntent,
            identityQuery,
            featureExcludedKeys,
            brandExcludedKeys,
            identityExcludedKeys,
            visualExcludedKeys
          ))
          .filter((candidate): candidate is UnifiedCandidate => candidate !== undefined);
        const merged = input.deferVisualFiltering === true
          ? mergeCandidatesPreservingOrder(officialCandidates, incoming)
          : mergeCandidates(officialCandidates, incoming);
        officialCandidates.splice(0, officialCandidates.length, ...merged);
        attempts.push({
          stage: attempt.stage,
          query: attempt.query,
          productsReturned: products.length,
          acceptedCandidates: incoming.length
        });
        if (hasSufficientOfficialMatches(officialCandidates, input.limit)) break;
      }
      const outcome = officialCandidates.length > 0
        ? "ACCEPTED" as const
        : officialProducts.length === 0
          ? "OFFICIAL_ZERO_RESULTS" as const
          : visualExcludedKeys.size > visualExcludedBefore
            ? "OFFICIAL_VISUAL_EVIDENCE_INSUFFICIENT" as const
            : "OFFICIAL_CANDIDATES_REJECTED" as const;
      officialStoreFallback = {
        status: "COMPLETE",
        productsReturned: officialProducts.length,
        sourceHost: officialSeed.sourceHost,
        diagnostic: { outcome, attempts }
      };
      shopifyCandidates = input.deferVisualFiltering === true
        ? mergeCandidatesPreservingOrder(officialCandidates, shopifyCandidates)
        : mergeCandidates(shopifyCandidates, officialCandidates);
      if (shopifyResult !== undefined) {
        shopifyResult = {
          ...shopifyResult,
          products: mergeShopifyProducts(shopifyResult.products, officialProducts)
        };
      }
    } catch {
      officialStoreFallback = {
        status: "UNAVAILABLE",
        productsReturned: 0,
        sourceHost: officialSeed.sourceHost,
        diagnostic: { outcome: "OFFICIAL_UNAVAILABLE", attempts }
      };
    }
  }

  const enrichedCandidates = await addVerifiedCoupons(
    [...affiliateCandidates, ...shopifyCandidates, ...ebayCandidates],
    ports.deals,
    input.membershipIds ?? []
  );
  const candidates = input.deferVisualFiltering === true
    ? selectVisualReviewCandidates(enrichedCandidates, input.limit, input.allowAlternatives)
    : selectPresentationCandidates(
        [...enrichedCandidates].sort(
          input.selectionMode === "LOWEST_PRICE" ? compareLowestPrice : compareRankedCandidates
        ),
        input.limit,
        input.selectionMode,
        input.allowAlternatives,
        input.visualInput !== undefined
      );
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
    sourcePassDiagnostics,
    featureProductsExcluded: featureExcludedKeys.size,
    brandProductsExcluded: brandExcludedKeys.size,
    identityProductsExcluded: identityExcludedKeys.size,
    visualProductsExcluded: visualExcludedKeys.size,
    officialStoreFallback,
    searchIntent,
    chromeFallbackEligible
  };
}

function visualGroupScore(group: VisualMatchGroup): number {
  if (group === "POSSIBLE_SAME_ITEM") return 100;
  if (group === "HIGHLY_SIMILAR") return 70;
  return 40;
}

function visualResultGroup(group: VisualMatchGroup): CandidateBase["resultGroup"] {
  if (group === "POSSIBLE_SAME_ITEM") return "REQUESTED_PRODUCT";
  if (group === "HIGHLY_SIMILAR") return "DISCOVERY";
  return "ALTERNATIVE";
}

export function candidateImageUrl(candidate: UnifiedCandidate): string | undefined {
  if (candidate.source === "AWIN_PRODUCT_FEED") return candidate.awinProduct.imageUrl;
  if (candidate.source === "EBAY_BROWSE") return candidate.ebayProduct.imageUrl;
  return candidate.shopifyProduct.imageUrl;
}

export function candidateTitle(candidate: UnifiedCandidate): string {
  return title(candidate);
}

function sourcePassDiagnostic(
  pass: 1 | 2,
  query: string,
  awinResult: AwinSearchResult | undefined,
  shopifyResult: ShopifySearchResult | undefined,
  ebayResult: EbaySearchResult | undefined,
  affiliateCandidates: UnifiedCandidate[],
  shopifyCandidates: UnifiedCandidate[],
  ebayCandidates: UnifiedCandidate[]
): UnifiedSearchExecution["sourcePassDiagnostics"][number] {
  return {
    pass,
    query,
    rawProducts: {
      awin: awinResult?.products.length ?? 0,
      shopify: shopifyResult?.products.length ?? 0,
      ebay: ebayResult?.products.length ?? 0
    },
    acceptedCandidates: {
      awin: affiliateCandidates.length,
      shopify: shopifyCandidates.length,
      ebay: ebayCandidates.length
    }
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
  input: SearchProductsExecutionInput,
  searchIntent: ProductSearchIntent,
  identityQuery: string,
  featureExcludedKeys: Set<string>,
  brandExcludedKeys: Set<string>,
  identityExcludedKeys: Set<string>,
  visualExcludedKeys: Set<string>
): UnifiedCandidate | undefined {
  const key = `AWIN:${product.merchantId}:${product.merchantProductId}`;
  const brand = assessBrand(input, [product.title, product.merchant]);
  if (brand.excluded) {
    brandExcludedKeys.add(key);
    return undefined;
  }
  if (!conditionMatches(product.condition, input.conditionPreference)) return undefined;
  const identity = candidateIdentity(
    searchIntent,
    input.allowAlternatives,
    identityQuery,
    { title: product.title, productType: product.category },
    product.matchStatus,
    key,
    identityExcludedKeys
  );
  if (identity === undefined) return undefined;
  const evidence = evaluateConstraints(`${product.title} ${product.category}`, input);
  if (evidence.contradicted.length > 0) {
    featureExcludedKeys.add(key);
    return undefined;
  }
  const visual = visualIdentity(input, {
    title: product.title,
    productType: product.category
  }, key, visualExcludedKeys);
  if (visual === null) return undefined;
  const merchantUrl = new URL(product.merchantUrl);
  const merchantTrust = resolveMerchantTrust(merchantUrl.hostname, product.merchant);
  return {
    source: "AWIN_PRODUCT_FEED",
    affiliateState: "APPROVED",
    recommendationTier: merchantRecommendationTier(merchantTrust, undefined),
    featureEvidence: unique([...evidence.matched, ...brand.requiredEvidence]),
    preferenceEvidence: unique([...evidence.preferences, ...brand.preferenceEvidence]),
    requiredFeatureLimitations: evidence.unknown,
    verifiedCoupons: [],
    identityStatus: visualIdentityStatus(identity.status, visual),
    identityEvidence: unique([...identity.evidence, ...brand.matchEvidence, ...(visual?.evidence ?? [])]),
    resultGroup: candidateResultGroup(searchIntent, identity.status, visual),
    ...(visual === undefined ? {} : {
      visualMatchGroup: visual.group,
      visualMatchEvidence: visual.evidence,
      visualMatchScore: visual.score
    }),
    awinProduct: evidence.unknown.length === 0 ? {
      ...product,
      matchEvidence: unique([...product.matchEvidence, ...identity.evidence, ...brand.matchEvidence, ...(visual?.evidence ?? [])])
    } : {
      ...product,
      matchStatus: "DISCOVERY_MATCH",
      matchEvidence: unique([
        ...product.matchEvidence,
        ...identity.evidence,
        ...brand.matchEvidence,
        ...(visual?.evidence ?? []),
        `required features not verified: ${evidence.unknown.join(", ")}`
      ])
    }
  };
}

function shopifyCandidate(
  product: ShopifyProduct,
  input: SearchProductsExecutionInput,
  searchIntent: ProductSearchIntent,
  identityQuery: string,
  featureExcludedKeys: Set<string>,
  brandExcludedKeys: Set<string>,
  identityExcludedKeys: Set<string>,
  visualExcludedKeys: Set<string>
): UnifiedCandidate | undefined {
  const key = `SHOPIFY:${product.merchantId}:${product.handle}`;
  if (product.merchantTrust.level === "RISKY") return undefined;
  const brand = assessBrand(input, [
    product.title,
    product.brand,
    ...(product.merchantTrust.level === "OFFICIAL" ? [product.merchant] : [])
  ]);
  if (brand.excluded) {
    brandExcludedKeys.add(key);
    return undefined;
  }
  if (!conditionMatches(product.condition, input.conditionPreference)) return undefined;
  const evidence = evaluateConstraints(shopifyEvidenceText(product), input);
  if (evidence.contradicted.length > 0) {
    featureExcludedKeys.add(key);
    return undefined;
  }
  const identity = candidateIdentity(
    searchIntent,
    input.allowAlternatives,
    identityQuery,
    {
      title: product.title,
      ...(product.brand === undefined ? {} : { brand: product.brand }),
      ...(product.sku === undefined ? {} : { sku: product.sku }),
      handle: product.handle,
      gtins: product.gtins,
      ...(product.productType === undefined ? {} : { productType: product.productType }),
      tags: product.description === undefined ? [] : [product.description],
      variantDimensions: product.variantDimensions
    },
    product.matchStatus,
    key,
    identityExcludedKeys,
    allowsConfigurationDiscovery(input, evidence, product.merchantTrust)
  );
  if (identity === undefined) return undefined;
  const visual = visualIdentity(input, {
    title: product.title,
    productType: product.productType,
    brand: product.brand ?? (product.merchantTrust.level === "OFFICIAL" ? product.merchant : undefined),
    modelOrStyleNumber: product.sku,
    description: product.description,
    attributes: Object.entries(product.variantDimensions).map(([name, value]) => `${name}: ${value}`)
  }, key, visualExcludedKeys);
  if (visual === null) return undefined;
  return {
    source: "SHOPIFY_GLOBAL_CATALOG",
    affiliateState: "NONE",
    recommendationTier: merchantRecommendationTier(product.merchantTrust, product.productRating),
    featureEvidence: unique([...evidence.matched, ...brand.requiredEvidence]),
    preferenceEvidence: unique([...evidence.preferences, ...brand.preferenceEvidence]),
    requiredFeatureLimitations: evidence.unknown,
    verifiedCoupons: [],
    identityStatus: visualIdentityStatus(identity.status, visual),
    identityEvidence: unique([...identity.evidence, ...brand.matchEvidence, ...(visual?.evidence ?? [])]),
    resultGroup: candidateResultGroup(searchIntent, identity.status, visual),
    ...(visual === undefined ? {} : {
      visualMatchGroup: visual.group,
      visualMatchEvidence: visual.evidence,
      visualMatchScore: visual.score
    }),
    shopifyProduct: evidence.unknown.length === 0 ? {
      ...product,
      matchEvidence: unique([...product.matchEvidence, ...identity.evidence, ...brand.matchEvidence, ...(visual?.evidence ?? [])])
    } : {
      ...product,
      matchStatus: "DISCOVERY_MATCH",
      matchEvidence: unique([
        ...product.matchEvidence,
        ...identity.evidence,
        ...brand.matchEvidence,
        ...(visual?.evidence ?? []),
        `required features not verified: ${evidence.unknown.join(", ")}`
      ])
    }
  };
}

export function resolveSearchIntent(
  input: Pick<SearchProductsInput, "query" | "comparisonMode" | "visualInput">
): ProductSearchIntent {
  if (input.comparisonMode === "SAME_PRODUCT" || hasStrongProductIdentifier(input.query)) {
    return "EXACT_PRODUCT";
  }
  if (input.visualInput !== undefined) return "VISUAL_DISCOVERY";
  return hasNamedProductIntent(input.query) ? "EXACT_PRODUCT" : "CATEGORY_DISCOVERY";
}

function candidateIdentity(
  searchIntent: ProductSearchIntent,
  allowAlternatives: boolean,
  query: string,
  candidate: ShopifyMatchCandidate,
  sourceStatus: Exclude<ShopifyMatchStatus, "IRRELEVANT">,
  key: string,
  excluded: Set<string>,
  allowConfigurationDiscovery = false
): { status: Exclude<ShopifyMatchStatus, "IRRELEVANT">; evidence: string[] } | undefined {
  if (searchIntent !== "EXACT_PRODUCT") {
    return { status: sourceStatus, evidence: [] };
  }
  const identity = classifyShopifyCandidate(query, candidate);
  if (
    identity.status === "IRRELEVANT" ||
    (identity.status === "SIMILAR" && !allowAlternatives && !allowConfigurationDiscovery)
  ) {
    excluded.add(key);
    return undefined;
  }
  if (identity.status === "SIMILAR" && allowConfigurationDiscovery) {
    return {
      status: "DISCOVERY_MATCH",
      evidence: unique([
        ...identity.evidence,
        "all required configuration matched; stable product identity unavailable"
      ])
    };
  }
  return { status: identity.status, evidence: identity.evidence };
}

function allowsConfigurationDiscovery(
  input: SearchProductsExecutionInput,
  evidence: ReturnType<typeof evaluateConstraints>,
  merchantTrust: ShopifyProduct["merchantTrust"]
): boolean {
  const required = unique([
    ...input.requiredFeatures,
    ...(input.featureMode === "REQUIRED" ? input.features : [])
  ]);
  const minimumMatched = Math.max(2, Math.ceil(required.length * 2 / 3));
  return input.comparisonMode === "DISCOVERY" &&
    !hasStrongProductIdentifier(input.query) &&
    input.brand !== undefined &&
    input.brandMode === "REQUIRED" &&
    required.length >= 2 &&
    evidence.matched.length >= minimumMatched &&
    evidence.matched.length + evidence.unknown.length === required.length &&
    evidence.contradicted.length === 0 &&
    merchantTrust.level !== "UNKNOWN" &&
    merchantTrust.level !== "RISKY" &&
    merchantTrust.verification === "INDEPENDENT";
}

function candidateResultGroup(
  searchIntent: ProductSearchIntent,
  identityStatus: Exclude<ShopifyMatchStatus, "IRRELEVANT">,
  visual?: VisualMatch
): CandidateBase["resultGroup"] {
  if (searchIntent === "EXACT_PRODUCT" && identityStatus !== "SIMILAR") return "REQUESTED_PRODUCT";
  if (visual !== undefined) {
    if (visual.group === "POSSIBLE_SAME_ITEM") return "REQUESTED_PRODUCT";
    if (visual.group === "HIGHLY_SIMILAR") return "DISCOVERY";
    return "ALTERNATIVE";
  }
  if (identityStatus === "SIMILAR") return "ALTERNATIVE";
  return searchIntent === "EXACT_PRODUCT" ? "REQUESTED_PRODUCT" : "DISCOVERY";
}

function ebayCandidate(
  product: EbayProduct,
  input: SearchProductsExecutionInput,
  searchIntent: ProductSearchIntent,
  identityQuery: string,
  featureExcludedKeys: Set<string>,
  brandExcludedKeys: Set<string>,
  identityExcludedKeys: Set<string>,
  visualExcludedKeys: Set<string>
): UnifiedCandidate | undefined {
  const key = `EBAY:${product.itemId}`;
  const brand = assessBrand(input, [product.title, ...product.attributes]);
  if (brand.excluded) {
    brandExcludedKeys.add(key);
    return undefined;
  }
  if (!conditionMatches(product.condition, input.conditionPreference)) return undefined;
  const identity = candidateIdentity(
    searchIntent,
    input.allowAlternatives,
    identityQuery,
    { title: product.title, productType: product.category, tags: product.attributes },
    product.matchStatus,
    key,
    identityExcludedKeys
  );
  if (identity === undefined) return undefined;
  const evidence = evaluateConstraints(
    [product.title, product.category, ...product.attributes].join(" "),
    input
  );
  if (evidence.contradicted.length > 0) {
    featureExcludedKeys.add(key);
    return undefined;
  }
  const visual = visualIdentity(input, {
    title: product.title,
    productType: product.category,
    attributes: product.attributes
  }, key, visualExcludedKeys);
  if (visual === null) return undefined;
  return {
    source: "EBAY_BROWSE",
    affiliateState: product.affiliateUrl === undefined ? "NONE" : "APPROVED",
    recommendationTier: "GENERAL_UNVERIFIED",
    featureEvidence: unique([...evidence.matched, ...brand.requiredEvidence]),
    preferenceEvidence: unique([...evidence.preferences, ...brand.preferenceEvidence]),
    requiredFeatureLimitations: evidence.unknown,
    verifiedCoupons: [],
    identityStatus: visualIdentityStatus(identity.status, visual),
    identityEvidence: unique([...identity.evidence, ...brand.matchEvidence, ...(visual?.evidence ?? [])]),
    resultGroup: candidateResultGroup(searchIntent, identity.status, visual),
    ...(visual === undefined ? {} : {
      visualMatchGroup: visual.group,
      visualMatchEvidence: visual.evidence,
      visualMatchScore: visual.score
    }),
    ebayProduct: evidence.unknown.length === 0 ? {
      ...product,
      matchEvidence: unique([...product.matchEvidence, ...identity.evidence, ...brand.matchEvidence, ...(visual?.evidence ?? [])])
    } : {
      ...product,
      matchEvidence: unique([
        ...product.matchEvidence,
        ...identity.evidence,
        ...brand.matchEvidence,
        ...(visual?.evidence ?? []),
        `required features not verified: ${evidence.unknown.join(", ")}`
      ])
    }
  };
}

function conditionMatches(
  actual: ShopifyCondition,
  expected: SearchProductsInput["conditionPreference"]
): boolean {
  return expected === "ANY" || actual === expected;
}

function buildExpandedQuery(
  input: SearchProductsInput,
  searchIntent: ProductSearchIntent,
  identityQuery: string
): string {
  if (searchIntent === "EXACT_PRODUCT") {
    return unique([
      identityQuery,
      input.productType ?? "",
      ...input.requiredFeatures
    ]).filter((part) => part !== "").join(" ").slice(0, 300).trim();
  }
  if (input.visualInput !== undefined) {
    return visualBroadSearchTerms(input.visualInput).join(" ").slice(0, 300).trim() || input.query;
  }
  if (input.brand !== undefined && input.brandMode === "REQUIRED") {
    return unique([input.brand, input.productType ?? input.query]).join(" ").slice(0, 300).trim();
  }
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

function buildSourceQuery(input: Pick<SearchProductsInput, "query" | "brand" | "productType" | "visualInput" | "maxItemPriceCents">): string {
  if (input.visualInput !== undefined) {
    return visualSearchTerms(input.visualInput).join(" ").slice(0, 300).trim() || input.query;
  }
  const query = productOnlyQuery(input.query, input.maxItemPriceCents !== undefined);
  return unique([
    input.brand ?? "",
    query,
    input.productType ?? "",
  ]).join(" ").slice(0, 300).trim();
}

function productOnlyQuery(value: string, hasPriceCeiling: boolean): string {
  let query = value.normalize("NFKC");
  if (hasPriceCeiling) {
    query = query
      .replace(/\b(?:under|below|less\s+than|up\s+to|budget(?:\s+of)?|maximum|max)\s*(?:usd\s*)?\$?\s*\d[\d,.]*/giu, " ")
      .replace(/(?:预算|不超过|低于|少于|以内|以下|最高)\s*(?:美元|美金|人民币|USD|\$|￥|¥)?\s*\d[\d,.]*/giu, " ")
      .replace(/\d[\d,.]*\s*(?:美元|美金|人民币|USD|\$|￥|¥)?\s*(?:预算|以内|以下)/giu, " ");
  }
  return query
    .replace(/\b(?:for|suitable\s+for)\s+(?:programming|coding|software\s+development|gaming|video\s+editing|office\s+work|school|college|travel|everyday\s+use|daily\s+use)\b/giu, " ")
    .replace(/(?:适合|用于)?(?:编程|写代码|软件开发|游戏|剪辑|视频编辑|办公|上学|通勤|日常使用)/gu, " ")
    .replace(/\s+/gu, " ")
    .trim() || value;
}

function buildOfficialStoreQueries(
  input: SearchProductsInput,
  searchIntent: ProductSearchIntent
): VisualOfficialStoreQuery[] {
  if (input.visualInput !== undefined && searchIntent !== "EXACT_PRODUCT") {
    return visualOfficialStoreSearchQueries(input.visualInput)
      .map((attempt) => ({ ...attempt, query: attempt.query.slice(0, 300).trim() }));
  }
  const requestedBrandTokens = new Set(brandTokens(input.brand ?? ""));
  const withoutBrand = input.query.split(/\s+/u)
    .filter((token) => !brandTokens(token).some((part) => requestedBrandTokens.has(part)))
    .join(" ")
    .trim();
  const visualCategory = input.visualInput === undefined
    ? undefined
    : visualOfficialStoreSearchQueries(input.visualInput)
      .find((attempt) => attempt.stage === "CATEGORY")?.query;
  const category = input.productType?.trim() || visualCategory;
  const queries: VisualOfficialStoreQuery[] = [
    { stage: "FULL", query: withoutBrand || category || input.query },
    { stage: "CORE", query: unique([category ?? "", ...withoutBrand.split(/\s+/u).slice(0, 3)]).join(" ") },
    { stage: "CATEGORY", query: category ?? withoutBrand ?? input.query }
  ];
  const seen = new Set<string>();
  return queries.map((attempt) => ({ ...attempt, query: attempt.query.slice(0, 300).trim() }))
    .filter((attempt) => {
      const key = normalize(attempt.query);
      if (key === "" || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function hasSufficientOfficialMatches(candidates: UnifiedCandidate[], limit: number): boolean {
  const visualCandidates = candidates.filter((candidate) => candidate.visualMatchGroup !== undefined);
  return visualCandidates.some((candidate) =>
    candidate.visualMatchGroup === "POSSIBLE_SAME_ITEM" &&
    ((candidate.visualMatchScore ?? 0) >= 104 ||
      candidate.visualMatchEvidence?.some((evidence) => evidence.startsWith("model/style matched:")) === true)
  ) ||
    visualCandidates.filter((candidate) => candidate.visualMatchGroup === "HIGHLY_SIMILAR").length >=
      Math.min(limit, 2);
}

function officialStoreSeed(
  products: ShopifyProduct[],
  input: Pick<SearchProductsInput, "brand" | "brandMode">
): OfficialShopifyStoreSeed | undefined {
  if (input.brand === undefined || input.brandMode !== "REQUIRED") return undefined;
  const observed = products.find((product) => {
    const trust = resolveMerchantTrust(product.sourceHost, product.merchant);
    return trust.level === "OFFICIAL" &&
      trust.verification === "INDEPENDENT" &&
      [product.brand, product.merchant, product.title]
        .some((value) => value !== undefined && containsBrand(value, input.brand!));
  });
  if (observed !== undefined) return observed;
  const storefront = resolveVerifiedOfficialStorefront(input.brand);
  if (storefront === undefined) return undefined;
  return {
    merchantId: `official-${storefront.host}`,
    merchant: storefront.brand,
    sourceHost: storefront.host,
    brand: storefront.brand,
    merchantUrl: `https://${storefront.host}/`,
    officialHost: storefront.officialHost,
    platform: storefront.platform,
    productPathPrefixes: storefront.productPathPrefixes,
    ...(storefront.searchPathTemplate === undefined ? {} : { searchPathTemplate: storefront.searchPathTemplate }),
    imageHosts: storefront.imageHosts
  };
}

function lacksStrongMatch(candidates: UnifiedCandidate[], intent: ProductSearchIntent): boolean {
  if (intent === "CATEGORY_DISCOVERY") return false;
  // A visual POSSIBLE_SAME_ITEM label is attribute evidence, not stable product identity.
  // One independently verified official-store search can still recover a catalog miss.
  return intent === "VISUAL_DISCOVERY" ||
    !candidates.some((candidate) => candidate.identityStatus === "EXACT");
}

function assessBrand(
  input: Pick<SearchProductsInput, "brand" | "brandMode">,
  evidenceValues: Array<string | undefined>
): {
  excluded: boolean;
  requiredEvidence: string[];
  preferenceEvidence: string[];
  matchEvidence: string[];
} {
  if (input.brand === undefined) {
    return { excluded: false, requiredEvidence: [], preferenceEvidence: [], matchEvidence: [] };
  }
  const matched = evidenceValues.some((value) => value !== undefined && containsBrandEvidence(value, input.brand!));
  if (!matched && input.brandMode === "REQUIRED") {
    return { excluded: true, requiredEvidence: [], preferenceEvidence: [], matchEvidence: [] };
  }
  if (!matched) return { excluded: false, requiredEvidence: [], preferenceEvidence: [], matchEvidence: [] };
  const evidence = `brand matched: ${input.brand}`;
  return {
    excluded: false,
    requiredEvidence: input.brandMode === "REQUIRED" ? [evidence] : [],
    preferenceEvidence: input.brandMode === "PREFERRED" ? [evidence] : [],
    matchEvidence: [evidence]
  };
}

function containsBrand(value: string, brand: string): boolean {
  const candidateTokens = brandTokens(value);
  const requestedTokens = brandTokens(brand);
  if (requestedTokens.length === 0) return false;
  return requestedTokens.every((token) => candidateTokens.includes(token));
}

function containsBrandEvidence(value: string, brand: string): boolean {
  if (containsBrand(value, brand)) return true;
  const candidateTokens = brandTokens(value);
  const requestedTokens = brandTokens(brand);
  const ownedProductLines = BRAND_OWNED_PRODUCT_LINES[requestedTokens.join(" ")];
  return ownedProductLines?.some((line) => candidateTokens.includes(line)) === true;
}

const BRAND_OWNED_PRODUCT_LINES: Readonly<Record<string, readonly string[]>> = {
  apple: ["airpods", "imac", "ipad", "iphone", "macbook"]
};

function brandTokens(value: string): string[] {
  return value.normalize("NFKD").toLocaleLowerCase("en-US")
    .replace(/\p{M}+/gu, "")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

function canonicalBrandName(value: string): string {
  const key = brandTokens(value).join(" ");
  if (key === "doen") return "DÔEN";
  return value;
}

function normalizeQueryPunctuation(value: string): string {
  return value.normalize("NFKC")
    .replace(/[’]/gu, "'")
    .replace(/[&＆]/gu, " and ")
    .replace(/[\\/|]/gu, " ")
    .replace(/[，。！？、,!?;:()[\]{}"“”]/gu, " ")
    .replace(/[^\p{L}\p{N}\s._+'-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
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

function mergeCandidatesPreservingOrder(
  current: UnifiedCandidate[],
  incoming: UnifiedCandidate[]
): UnifiedCandidate[] {
  const merged = new Map<string, UnifiedCandidate>();
  for (const candidate of [...current, ...incoming]) {
    const key = candidateKey(candidate);
    const existing = merged.get(key);
    if (existing === undefined || compareRankedCandidates(candidate, existing) < 0) merged.set(key, candidate);
  }
  return [...merged.values()];
}

function mergeShopifyProducts(current: ShopifyProduct[], incoming: ShopifyProduct[]): ShopifyProduct[] {
  const products = new Map(current.map((product) => [
    `${product.sourceHost}:${product.handle}`,
    product
  ]));
  for (const product of incoming) products.set(`${product.sourceHost}:${product.handle}`, product);
  return [...products.values()];
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

export function candidateMerchant(candidate: UnifiedCandidate): string {
  if (candidate.source === "AWIN_PRODUCT_FEED") return candidate.awinProduct.merchant;
  if (candidate.source === "EBAY_BROWSE") return "eBay";
  return candidate.shopifyProduct.merchant;
}

function compareRankedCandidates(
  left: UnifiedCandidate,
  right: UnifiedCandidate
): number {
  const visualDifference = (right.visualMatchScore ?? 0) - (left.visualMatchScore ?? 0);
  if (visualDifference !== 0) return visualDifference;
  const groupDifference = resultGroupRank(left.resultGroup) - resultGroupRank(right.resultGroup);
  if (groupDifference !== 0) return groupDifference;
  const matchDifference = matchRank(right) - matchRank(left);
  if (matchDifference !== 0) return matchDifference;
  const limitationDifference = left.requiredFeatureLimitations.length - right.requiredFeatureLimitations.length;
  if (limitationDifference !== 0) return limitationDifference;
  const featureDifference = right.featureEvidence.length - left.featureEvidence.length;
  if (featureDifference !== 0) return featureDifference;
  const tierDifference = merchantRecommendationRank(left.recommendationTier) -
    merchantRecommendationRank(right.recommendationTier);
  if (tierDifference !== 0) return tierDifference;
  const availabilityDifference = availabilityRank(left) - availabilityRank(right);
  if (availabilityDifference !== 0) return availabilityDifference;
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

function visualIdentity(
  input: SearchProductsExecutionInput,
  candidate: Parameters<typeof classifyVisualProduct>[1],
  key: string,
  excluded: Set<string>
): VisualMatch | undefined | null {
  if (input.visualInput === undefined) return undefined;
  const match = classifyVisualProduct(input.visualInput, candidate);
  // During interactive image retrieval, metadata may help rank candidates but
  // may never reject them before Codex has compared the actual images.
  if (input.deferVisualFiltering === true) return match;
  if (match !== undefined) return match;
  excluded.add(key);
  return null;
}

function visualIdentityStatus(
  sourceStatus: Exclude<ShopifyMatchStatus, "IRRELEVANT">,
  visual: VisualMatch | undefined
): Exclude<ShopifyMatchStatus, "IRRELEVANT"> {
  if (visual === undefined) return sourceStatus;
  return visual.group === "SAME_STYLE" ? "SIMILAR" : "DISCOVERY_MATCH";
}

function selectPresentationCandidates(
  candidates: UnifiedCandidate[],
  limit: number,
  selectionMode: SearchProductsInput["selectionMode"],
  allowAlternatives: boolean,
  visualDiscovery: boolean
): UnifiedCandidate[] {
  const official = candidates
    .filter(isOfficialCandidate)
    .filter((candidate) => passesVisualDisplayGate(candidate, allowAlternatives))
    .slice(0, 2)
    .map((candidate) => ({ ...candidate, presentationGroup: "OFFICIAL_STORE" as const }));
  if (selectionMode === "LOWEST_PRICE") {
    const bestValue = candidates
      .filter((candidate) => !isOfficialCandidate(candidate))
      .filter((candidate) => passesVisualDisplayGate(candidate, allowAlternatives))
      .sort(compareLowestPrice)
      .slice(0, limit)
      .map((candidate) => ({ ...candidate, presentationGroup: "BEST_VALUE" as const }));
    return [...official, ...bestValue];
  }
  const trusted = candidates
    .filter((candidate) => !isOfficialCandidate(candidate))
    .filter((candidate) => passesVisualDisplayGate(candidate, allowAlternatives))
    .filter((candidate) =>
      candidate.recommendationTier === "TRUSTED_OR_AFFILIATE" ||
      candidate.recommendationTier === "HIGH_RATED_UNVERIFIED"
    )
    .slice(0, limit)
    .map((candidate) => ({ ...candidate, presentationGroup: "TRUSTED_MATCH" as const }));
  const selectedKeys = new Set([...official, ...trusted].map(candidateKey));
  const bestValue = candidates
    .filter((candidate) => !selectedKeys.has(candidateKey(candidate)))
    .filter((candidate) => !isOfficialCandidate(candidate))
    .filter((candidate) => passesVisualDisplayGate(candidate, allowAlternatives))
    .filter((candidate) => candidate.recommendationTier === "GENERAL_UNVERIFIED")
    .sort(compareBestValue)
    .slice(0, limit)
    .map((candidate) => ({ ...candidate, presentationGroup: "BEST_VALUE" as const }));
  const grouped = [...official, ...trusted, ...bestValue];
  if (grouped.length > 0) return grouped;
  if (visualDiscovery) return [];
  return candidates.slice(0, limit);
}

function selectVisualReviewCandidates(
  candidates: UnifiedCandidate[],
  limit: number,
  allowAlternatives: boolean
): UnifiedCandidate[] {
  const eligible = candidates.filter((candidate) => passesVisualDisplayGate(candidate, allowAlternatives));
  const official = eligible.filter(isOfficialCandidate);
  const trusted = eligible.filter((candidate) =>
    !isOfficialCandidate(candidate) &&
    (candidate.recommendationTier === "TRUSTED_OR_AFFILIATE" ||
      candidate.recommendationTier === "HIGH_RATED_UNVERIFIED")
  );
  const general = eligible.filter((candidate) =>
    !isOfficialCandidate(candidate) && candidate.recommendationTier === "GENERAL_UNVERIFIED"
  );
  return [...official, ...trusted, ...general].slice(0, limit).map((candidate) => ({
    ...candidate,
    presentationGroup: isOfficialCandidate(candidate)
      ? "OFFICIAL_STORE" as const
      : candidate.recommendationTier === "GENERAL_UNVERIFIED"
        ? "BEST_VALUE" as const
        : "TRUSTED_MATCH" as const
  }));
}

function isOfficialCandidate(candidate: UnifiedCandidate): boolean {
  if (candidate.source !== "SHOPIFY_GLOBAL_CATALOG") return false;
  try {
    const merchantUrl = new URL(candidate.shopifyProduct.merchantUrl);
    const websiteTrust = resolveMerchantTrust(merchantUrl.hostname, candidate.shopifyProduct.merchant);
    return merchantUrl.protocol === "https:" &&
      candidate.shopifyProduct.merchantTrust.level === "OFFICIAL" &&
      candidate.shopifyProduct.merchantTrust.verification === "INDEPENDENT" &&
      websiteTrust.level === "OFFICIAL" &&
      websiteTrust.verification === "INDEPENDENT";
  } catch {
    return false;
  }
}

function passesVisualDisplayGate(candidate: UnifiedCandidate, allowAlternatives: boolean): boolean {
  return candidate.resultGroup === "REQUESTED_PRODUCT" ||
    candidate.visualMatchGroup === undefined ||
    candidate.visualMatchGroup !== "SAME_STYLE" ||
    allowAlternatives;
}

function countDisplayEligibleCandidates(
  candidates: UnifiedCandidate[],
  allowAlternatives: boolean
): number {
  return candidates.filter((candidate) => passesVisualDisplayGate(candidate, allowAlternatives)).length;
}

function compareBestValue(left: UnifiedCandidate, right: UnifiedCandidate): number {
  return Number(right.verifiedCoupons.length > 0) - Number(left.verifiedCoupons.length > 0) ||
    merchantRecommendationRank(left.recommendationTier) - merchantRecommendationRank(right.recommendationTier) ||
    price(left) - price(right) ||
    compareRankedCandidates(left, right);
}

function candidateKey(candidate: UnifiedCandidate): string {
  if (candidate.source === "AWIN_PRODUCT_FEED") {
    return `${candidate.source}:${candidate.awinProduct.merchantId}:${candidate.awinProduct.merchantProductId}`;
  }
  if (candidate.source === "EBAY_BROWSE") return `${candidate.source}:${candidate.ebayProduct.itemId}`;
  return `${candidate.source}:${candidate.shopifyProduct.sourceHost}:${candidate.shopifyProduct.handle}`;
}

function resultGroupRank(group: CandidateBase["resultGroup"]): number {
  switch (group) {
    case "REQUESTED_PRODUCT": return 0;
    case "DISCOVERY": return 1;
    case "ALTERNATIVE": return 2;
  }
}

function availabilityRank(candidate: UnifiedCandidate): number {
  const value = candidate.source === "AWIN_PRODUCT_FEED"
    ? candidate.awinProduct.availability
    : candidate.source === "SHOPIFY_GLOBAL_CATALOG"
      ? candidate.shopifyProduct.availability
      : candidate.ebayProduct.availability;
  return value === "IN_STOCK" ? 0 : value === "UNKNOWN" ? 1 : 2;
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
  const status = candidate.identityStatus;
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
