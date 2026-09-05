import { z } from "zod";
import { SearchRun } from "./search-run.js";
import { candidateFingerprint, sourceProductFingerprint, visualQueryHash } from "./visual-source-fingerprints.js";
import { assessVisualVerdict, type VisualReviewAssessment } from "./visual-review-policy.js";

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
  searchDealsWithStatus,
  type DealLookupResult,
  type DealPort,
  type VerifiedDeal
} from "./deal-client.js";
import {
  merchantRecommendationTier,
  resolveVerifiedOfficialStorefront,
  resolveVerifiedOfficialStorefrontByHost,
  resolveMerchantTrust
} from "./merchant-trust.js";
import type { MerchantRecommendationTier } from "./merchant-trust.js";
import { evaluateProductRequirements, normalizedSizeRequirement, type RequirementAssessment, type RequirementProduct } from "./product-requirements.js";
import type { ShopifySelectedProductInspector } from "./shopify-selected-product.js";
import {
  VisualProductInputSchema,
  classifyVisualProduct,
  hasVisualProductFamilyConflict,
  visualOfficialStoreSearchQueries,
  visualOfficialStoreDiscoveryQuery,
  visualOfficialStructureQuery,
  type VisualMatch,
  type VisualMatchGroup,
  type VisualOfficialStoreQuery,
  type VisualProductInput
} from "./visual-product-discovery.js";
import { buildVisualRetrievalQuery } from "./visual-retrieval-query.js";
import { productReferenceKey } from "./product-reference.js";
import {
  classifyShopifyCandidate,
  hasNamedProductIntent,
  hasSpecificProductIdentity,
  hasStrongProductIdentifier,
  type ShopifyMatchCandidate,
  type ShopifyMatchStatus
} from "./shopify-match.js";
import type {
  OfficialShopifySearchPort,
  OfficialShopifyStoreSeed
} from "./shopify-official-store-search.js";
import type { OfficialStorefrontRegistryPort } from "./official-storefront-registry-client.js";
import type { MerchantTrustRegistryPort } from "./merchant-trust-registry-client.js";
import {
  candidateKey,
  candidateMerchant,
  candidateTitle as rankedCandidateTitle,
  compareLowestPrice,
  compareRankedCandidates,
  countDisplayEligibleCandidates,
  selectPresentationCandidates,
  selectVisualReviewCandidates
} from "./product-candidate-ranking.js";

export { candidateMerchant } from "./product-candidate-ranking.js";

const QuerySchema = z.string().trim().min(2).max(300)
  .refine((value) => /[\p{L}\p{N}]/u.test(value), "query must contain a letter or number")
  .transform(normalizeQueryPunctuation);

export const SearchProductsInputSchema = z.object({
  query: QuerySchema,
  responseLocale: z.enum(["en-US", "zh-CN"])
    .describe("Language of the user's current request; controls product-card interface text even when query is translated for catalog search")
    .optional(),
  limit: z.number().int().min(1).max(8).default(8)
    .describe("Maximum returned cards across three tiers: 2 official, 3 trusted, 3 best value"),
  maxItemPriceCents: z.number().int().min(1).max(100_000_000)
    .describe("Inclusive price ceiling, never a spending target")
    .optional(),
  budgetFlexible: z.boolean()
    .describe("True only when the user explicitly says there is no fixed budget ceiling")
    .default(false),
  primaryUse: z.string().trim().min(1).max(120)
    .describe("User-stated primary workload or use; never infer it")
    .optional(),
  preferredSize: z.string().trim().min(1).max(80)
    .describe("User-stated preferred physical or screen size; never infer it")
    .optional(),
  requiredSize: z.string().trim().min(1).max(80)
    .describe("User-stated mandatory physical or screen size; use only when the user explicitly requires or selects that size")
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
  requiredFeatures: z.array(z.string().trim().min(1).max(160)).max(10)
    .refine((values) => new Set(values.map(normalize)).size === values.length, "required features must be unique")
    .default([]),
  excludedFeatures: z.array(z.string().trim().min(1).max(80)).max(10)
    .refine((values) => new Set(values.map(normalize)).size === values.length, "excluded features must be unique")
    .describe("Objective disqualifiers such as sample, trial pack, or tester")
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
  parentRenderId: z.string().uuid().optional().describe("Exact prior search snapshot for CONTINUE or CORRECT; never guess the latest search"),
  clearConstraints: z.array(z.enum(["maxItemPriceCents", "requiredSize", "preferredSize", "requiredFeatures", "excludedFeatures", "preferences", "brand", "primaryUse", "allowAlternatives", "conditionPreference"])).max(10).default([])
    .describe("Clear only constraints the user explicitly withdrew; omitted constraints are retained on continuation"),
  visualInput: VisualProductInputSchema.optional(),
  // Backward-compatible input for clients installed before v0.9.5.
  features: z.array(z.string().trim().min(1).max(160)).max(10)
    .refine((values) => new Set(values.map(normalize)).size === values.length, "features must be unique")
    .default([]),
  featureMode: z.enum(["PREFERRED", "REQUIRED"]).default("PREFERRED")
}).strict();

export type SearchProductsInput = z.infer<typeof SearchProductsInputSchema>;

/** Internal execution controls. These are never exposed through the MCP schema. */
export type SearchProductsExecutionInput = SearchProductsInput & {
  deferVisualFiltering?: boolean;
  relaxVisualRetrieval?: boolean;
  searchRun?: SearchRun;
};

type CandidateBase = {
  affiliateState: "APPROVED" | "NONE";
  recommendationTier: MerchantRecommendationTier;
  featureEvidence: string[];
  preferenceEvidence: string[];
  requiredFeatureLimitations: string[];
  requirementAssessment?: RequirementAssessment;
  verifiedCoupons: VerifiedDeal[];
  dealLookupStatus?: DealLookupResult["status"];
  identityStatus: Exclude<ShopifyMatchStatus, "IRRELEVANT">;
  identityEvidence: string[];
  resultGroup: "REQUESTED_PRODUCT" | "DISCOVERY" | "ALTERNATIVE";
  visualMatchGroup?: VisualMatchGroup | undefined;
  visualReviewAssessment?: VisualReviewAssessment | undefined;
  visualMatchEvidence?: string[] | undefined;
  visualMatchScore?: number | undefined;
  presentationGroup?: ProductPresentationGroup | undefined;
};

export type ProductPresentationGroup = "OFFICIAL_STORE" | "TRUSTED_MATCH" | "BEST_VALUE" | "RESEARCH_ONLY";

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
  candidateEvidence: z.string().trim().min(1).max(160),
  referenceObservation: z.object({
    confidence: z.number().min(0).max(1),
    visibility: z.enum(["VISIBLE", "PARTIAL", "OCCLUDED", "UNKNOWN"])
  }).strict().optional().describe("Required only for a newly observed reference attribute. Cannot override prior uncertainty or occlusion.")
}).strict();

export const CodexVisualVerdictSchema = z.object({
  classification: z.enum(["POSSIBLE_SAME_ITEM", "HIGHLY_SIMILAR", "SAME_STYLE", "CONFLICT"]),
  matches: z.array(VisualEvidencePairSchema).max(16).default([]),
  conflicts: z.array(VisualEvidencePairSchema).max(16).default([])
}).strict().superRefine((verdict, context) => {
  const matched = new Set(verdict.matches.map((entry) => entry.attribute));
  if (matched.size !== verdict.matches.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["matches"], message: "match attributes must be unique" });
  }
  const conflicted = new Set(verdict.conflicts.map((entry) => entry.attribute));
  if (conflicted.size !== verdict.conflicts.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["conflicts"], message: "conflict attributes must be unique" });
  }
  if (verdict.conflicts.some((entry) => matched.has(entry.attribute))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["conflicts"],
      message: "an attribute cannot both match and conflict"
    });
  }
});

export type CodexVisualVerdict = z.infer<typeof CodexVisualVerdictSchema>;

export type UnifiedSearchExecution = {
  searchRun?: SearchRun;
  reviewPool?: UnifiedCandidate[];
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
    status: "NOT_USED" | "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
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
  visualInput?: VisualProductInput,
  requestedBrand = true
): UnifiedCandidate[] {
  const accepted = reviewed.flatMap(({ candidate, verdict }) => {
    const review = assessVisualVerdict(verdict, visualInput, allowAlternatives);
    if (review === undefined) return [];
    const { group, matchCount, structuralMatchCount } = review;
    const visualEvidence = review.matches.map((entry) =>
      `Codex visual match ${entry.attribute}: ${entry.referenceEvidence} | ${entry.candidateEvidence}`
    );
    const visualDifferences = review.conflicts.map((entry) =>
      `Codex visual difference ${entry.attribute}: ${entry.referenceEvidence} | ${entry.candidateEvidence}`
    );
    const stableExact = candidate.identityStatus === "EXACT";
    return [{
      ...candidate,
      visualMatchGroup: group,
      visualMatchEvidence: unique([...(candidate.visualMatchEvidence ?? []), ...visualEvidence, ...visualDifferences]),
      visualMatchScore: review.score,
      visualReviewAssessment: { group, matchCount, structuralMatchCount },
      identityEvidence: unique([...candidate.identityEvidence, ...visualEvidence, ...visualDifferences]),
      identityStatus: stableExact ? "EXACT" as const : group === "SAME_STYLE" ? "SIMILAR" as const : "DISCOVERY_MATCH" as const,
      resultGroup: stableExact ? candidate.resultGroup : visualResultGroup(group)
    }];
  }).sort(compareRankedCandidates);
  return selectPresentationCandidates(
    accepted,
    "MERCHANT_DIVERSE",
    allowAlternatives,
    true,
    requestedBrand
  ).sort(compareRankedCandidates).slice(0, limit);
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
    merchantTrustRegistry?: MerchantTrustRegistryPort;
    selectedProducts?: ShopifySelectedProductInspector;
  }
): Promise<UnifiedSearchExecution> {
  const searchRun = rawInput.searchRun ?? new SearchRun();
  await Promise.all([
    ports.officialStorefrontRegistry === undefined ? undefined
      : searchRun.read("REGISTRY", "official", () => ports.officialStorefrontRegistry!.refresh()),
    ports.merchantTrustRegistry === undefined ? undefined
      : searchRun.read("REGISTRY", "trust", () => ports.merchantTrustRegistry!.refresh())
  ]);
  const rawRequiredFeatures = unique([
    ...rawInput.requiredFeatures,
    ...(rawInput.requiredSize === undefined ? [] : [normalizedSizeRequirement(rawInput.requiredSize, rawInput.productType ?? rawInput.query)]),
    ...(rawInput.featureMode === "REQUIRED" ? rawInput.features : [])
  ]);
  const input = {
    ...rawInput,
    visualInput: rawInput.visualInput === undefined
      ? undefined
      : {
          ...rawInput.visualInput,
          ...(rawInput.visualInput.brand === undefined && rawInput.brand !== undefined
            ? { brand: rawInput.brand }
            : {}),
          ...(rawInput.visualInput.productType === undefined && rawInput.productType !== undefined
            ? { productType: rawInput.productType }
            : {})
        },
    conditionPreference: explicitConditionPreference(rawInput.query, rawInput.conditionPreference),
    requiredFeatures: rawRequiredFeatures.filter((feature) => !isPackagingOnlyConstraint(feature)),
    excludedFeatures: unique([
      ...rawInput.excludedFeatures,
      ...inferredPackagingExclusions(rawInput)
    ]),
    preferences: unique([
      ...rawInput.preferences,
      ...(rawInput.featureMode === "PREFERRED" ? rawInput.features : []),
      ...(rawInput.primaryUse === undefined ? [] : [rawInput.primaryUse]),
      ...(rawInput.preferredSize === undefined ? [] : [normalizedSizeRequirement(rawInput.preferredSize, rawInput.productType ?? rawInput.query)])
    ])
  };
  const productQuery = stripRequiredFeaturesFromQuery(
    productOnlyQuery(input.query, input.maxItemPriceCents !== undefined),
    input.requiredFeatures
  );
  const identityProductQuery = stripPreferredSizeFromIdentity(
    stripPrimaryUseFromIdentity(productQuery, input.primaryUse),
    input.requiredSize ?? input.preferredSize
  );
  const searchIntent = resolveSearchIntent({ ...input, query: identityProductQuery });
  const identityQuery = searchIntent === "EXACT_PRODUCT"
    ? unique([
        input.brand !== undefined && !containsBrand(identityProductQuery, input.brand) ? input.brand : "",
        identityProductQuery
      ]).join(" ").slice(0, 300).trim()
    : input.deferVisualFiltering === true && input.visualInput === undefined
      ? productQuery
      : buildSourceQuery({ ...input, query: productQuery });
  const sourceQuery = searchIntent === "EXACT_PRODUCT"
    ? unique([
        input.brand !== undefined && !containsBrand(identityProductQuery, input.brand) ? input.brand : "",
        identityProductQuery
      ]).join(" ").slice(0, 300).trim()
    : input.deferVisualFiltering === true && input.visualInput === undefined
      ? productQuery
      : buildSourceQuery({ ...input, query: productQuery });
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
  const inspected = new Map<string, Promise<ShopifyProduct[]>>();
  const approvedAwinHosts = new Map<string, Set<string>>();
  let inspectionCount = 0;
  const inspectRequiredVariants = async (products: ShopifyProduct[]): Promise<ShopifyProduct[]> => {
    if (ports.selectedProducts === undefined || input.visualInput !== undefined || input.deferVisualFiltering === true || input.requiredFeatures.length === 0) return products;
    const results: ShopifyProduct[][] = [];
    let next = 0;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (next < products.length) {
        const index = next++;
        const product = products[index]!;
        const key = productReferenceKey(product);
        const assessment = evaluateConstraints(product, input);
        if (assessment.assessment.status === "SATISFIED" || product.checkoutPlatform === "MERCHANT") {
          results[index] = [product];
          continue;
        }
        let pending = inspected.get(key);
        if (pending === undefined && inspectionCount < 4 && searchRun.canRead("VARIANT")) {
          inspectionCount++;
          pending = searchRun.read("VARIANT", key, async signal => {
            const result = await ports.selectedProducts!.inspect(product, {}, { signal,
              requirements: { requiredFeatures: input.requiredFeatures, requiredSize: input.requiredSize } });
            const originalUrl = new URL(product.merchantUrl);
            const variants = result.variants.filter(variant => {
              const url = new URL(variant.merchantUrl);
              return variant.merchantId === product.merchantId && variant.sourceHost === product.sourceHost &&
                url.protocol === "https:" && url.hostname === originalUrl.hostname &&
                url.pathname === originalUrl.pathname && url.username === "" && url.password === "";
            });
            return variants.length === 0 ? [product] : variants;
          }).catch(() => [product]);
          inspected.set(key, pending);
        }
        results[index] = pending === undefined ? [product] : await pending;
      }
    }));
    return results.flat();
  };

  const queryAwin = async (query: string, limit: number, merge: boolean): Promise<void> => {
    if (!affiliateEligible) return;
    try {
      const result = await searchRun.read("AWIN", JSON.stringify([query, limit]), (signal) => ports.awin.search({
        query,
        limit,
        signal,
        ...(awinResult?.supportsRequirements === true && input.visualInput === undefined ? {
          ...(input.productType === undefined ? {} : { productType: input.productType }),
          requiredFeatures: input.requiredFeatures.slice(0, 10)
        } : {}),
        ...(input.maxItemPriceCents === undefined ? {} : { maxItemPriceCents: input.maxItemPriceCents })
      }));
      awinResult = result;
      for (const product of result.products) {
        const host = new URL(product.merchantUrl).hostname.toLowerCase().replace(/^www\./u, "");
        const merchants = approvedAwinHosts.get(host) ?? new Set<string>();
        merchants.add(product.merchantId);
        approvedAwinHosts.set(host, merchants);
      }
      awinStatus = "COMPLETE";
      if (input.visualInput !== undefined) searchRun.recordVisualStage("NORMALIZED", result.products.map((product) => sourceProductFingerprint("AWIN", product)), { source: "AWIN", queryHash: visualQueryHash(query) });
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
      if (input.visualInput !== undefined) searchRun.recordVisualStage("ELIGIBLE", incoming.map(candidateFingerprint), { source: "AWIN", queryHash: visualQueryHash(query) });
    } catch {
      awinStatus = "UNAVAILABLE";
      awinError = "DATA_SOURCE_UNAVAILABLE";
    }
  };
  const queryShopify = async (query: string, limit: number, merge: boolean): Promise<void> => {
    try {
      const response = await searchRun.read("SHOPIFY", JSON.stringify([query, limit]), (signal) => ports.shopify.search({
        query,
        limit,
        signal,
        comparisonMode: searchIntent === "VISUAL_DISCOVERY" ? "DISCOVERY" : input.comparisonMode,
        selectionMode: input.selectionMode,
        ...(input.maxItemPriceCents === undefined ? {} : { maxItemPriceCents: input.maxItemPriceCents }),
        ...(input.zipCode === undefined ? {} : { zipCode: input.zipCode }),
        membershipIds: input.membershipIds ?? []
      }));
      const result = { ...response, products: await inspectRequiredVariants(response.products) };
      shopifyResult = result;
      observedShopifyProducts = mergeShopifyProducts(observedShopifyProducts, result.products);
      shopifyStatus = result.coverage;
      if (input.visualInput !== undefined) searchRun.recordVisualStage("NORMALIZED", result.products.map((product) => sourceProductFingerprint("SHOPIFY", product)), { source: "SHOPIFY", queryHash: visualQueryHash(query) });
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
      if (input.visualInput !== undefined) searchRun.recordVisualStage("ELIGIBLE", incoming.map(candidateFingerprint), { source: "SHOPIFY", queryHash: visualQueryHash(query) });
    } catch (error) {
      shopifyStatus = shopifyResult === undefined ? "UNAVAILABLE" : "PARTIAL";
      shopifyError ??= productSourceError(error);
    }
  };
  const queryEbay = async (query: string, limit: number, merge: boolean): Promise<void> => {
    if (ports.ebay === undefined || ebayStatus === "SKIPPED") return;
    try {
      const result = await searchRun.read("EBAY", JSON.stringify([query, limit]), (signal) => ports.ebay!.search({
        query,
        limit,
        signal,
        ...(input.maxItemPriceCents === undefined ? {} : { maxItemPriceCents: input.maxItemPriceCents }),
        ...(input.zipCode === undefined ? {} : { zipCode: input.zipCode })
      }));
      ebayResult = result;
      ebayStatus = "COMPLETE";
      if (input.visualInput !== undefined) searchRun.recordVisualStage("NORMALIZED", result.products.map((product) => sourceProductFingerprint("EBAY", product)), { source: "EBAY", queryHash: visualQueryHash(query) });
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
      if (input.visualInput !== undefined) searchRun.recordVisualStage("ELIGIBLE", incoming.map(candidateFingerprint), { source: "EBAY", queryHash: visualQueryHash(query) });
    } catch (error) {
      if (error instanceof Error && error.message === "SOURCE_NOT_CONFIGURED") {
        if (ebayResult === undefined) ebayStatus = "SKIPPED";
      } else {
        ebayStatus = "UNAVAILABLE";
        ebayError = "DATA_SOURCE_UNAVAILABLE";
      }
    }
  };

  const officialProducts: ShopifyProduct[] = [];
  const officialCandidates: UnifiedCandidate[] = [];
  const queryOfficial = async (officialSeed: OfficialShopifyStoreSeed): Promise<void> => {
    const attempts: NonNullable<UnifiedSearchExecution["officialStoreFallback"]["diagnostic"]>["attempts"] = [];
    const visualExcludedBefore = visualExcludedKeys.size;
    let failed = false;
    let successes = 0;
    let sourcePageUrl = input.visualInput?.sourcePageUrl;
    if (sourcePageUrl !== undefined) {
      const source = new URL(sourcePageUrl);
      // Rewrite only registry-reviewed official/storefront aliases. This avoids
      // following arbitrary cross-origin redirects during exact PDP hydration.
      const storefront = resolveVerifiedOfficialStorefrontByHost(source.hostname);
      if (storefront?.host === officialSeed.sourceHost) {
        source.hostname = storefront.host;
        sourcePageUrl = source.href;
      }
    }
    const stages = [
      ...(sourcePageUrl === undefined ? [] : [{ stage: "FULL" as const, query: "direct official product", sourcePageUrl }]),
      ...buildOfficialStoreQueries(input, searchIntent, officialSeed.platform === "GENERIC_JSON_LD")
    ];
    for (const attempt of stages) {
      const directUrl = "sourcePageUrl" in attempt ? attempt.sourcePageUrl : undefined;
      const queryKey = JSON.stringify([officialSeed.sourceHost, attempt.query, directUrl]);
      if (input.deferVisualFiltering === true && !searchRun.claimOfficialQuery(visualQueryHash(queryKey))) continue;
      try {
        const products = await searchRun.read("OFFICIAL", queryKey, (signal) => ports.officialShopify!.search({
          seed: officialSeed, query: attempt.query, limit: 12, cacheScope: searchRun, signal,
          onRead: delta => searchRun.recordOfficialRead(delta),
          ...(input.requiredSize === undefined ? {} : { requiredSize: input.requiredSize }),
          ...(directUrl === undefined ? {} : { sourcePageUrl: directUrl })
        }));
        successes += 1;
        if (input.visualInput !== undefined) searchRun.recordVisualStage("NORMALIZED", products.map((product) => sourceProductFingerprint("SHOPIFY", product)), { source: "OFFICIAL", queryHash: visualQueryHash(attempt.query) });
        officialProducts.splice(0, officialProducts.length, ...mergeShopifyProducts(officialProducts, products));
        const incoming = products.map((product) => shopifyCandidate(
          product, input, searchIntent, identityQuery, featureExcludedKeys, brandExcludedKeys,
          identityExcludedKeys, visualExcludedKeys
        )).filter((candidate): candidate is UnifiedCandidate => candidate !== undefined);
        if (input.visualInput !== undefined) searchRun.recordVisualStage("ELIGIBLE", incoming.map(candidateFingerprint), { source: "OFFICIAL", queryHash: visualQueryHash(attempt.query) });
        const merged = input.deferVisualFiltering === true
          ? mergeCandidatesPreservingOrder(officialCandidates, incoming)
          : mergeCandidates(officialCandidates, incoming);
        officialCandidates.splice(0, officialCandidates.length, ...merged);
        attempts.push({ stage: attempt.stage, query: attempt.query, productsReturned: products.length, acceptedCandidates: incoming.length });
        if (hasSufficientOfficialMatches(officialCandidates.filter(candidate =>
          !searchRun.wasVisuallyReviewed(candidateFingerprint(candidate).productHash)), input.limit)) break;
      } catch {
        failed = true;
        attempts.push({ stage: attempt.stage, query: attempt.query, productsReturned: 0, acceptedCandidates: 0 });
        // An unsafe/missing direct URL may fall back to reviewed-store search. A
        // failed search stage stops further fan-out, preserving earlier successes.
        if (directUrl === undefined) break;
      }
    }
    const outcome = officialCandidates.length > 0 ? "ACCEPTED" as const
      : failed ? "OFFICIAL_UNAVAILABLE" as const
        : officialProducts.length === 0 ? "OFFICIAL_ZERO_RESULTS" as const
          : visualExcludedKeys.size > visualExcludedBefore ? "OFFICIAL_VISUAL_EVIDENCE_INSUFFICIENT" as const
            : "OFFICIAL_CANDIDATES_REJECTED" as const;
    officialStoreFallback = {
      status: failed ? successes > 0 ? "PARTIAL" : "UNAVAILABLE" : "COMPLETE",
      productsReturned: officialProducts.length, sourceHost: officialSeed.sourceHost,
      diagnostic: { outcome, attempts }
    };
  };
  // Visual searches know a registry seed before global discovery. Starting it
  // here avoids spending the entire shared budget on unrelated global results.
  const earlyOfficialSeed = input.visualInput === undefined ? undefined : officialStoreSeed([], input);
  const earlyOfficial = ports.officialShopify !== undefined && earlyOfficialSeed !== undefined
    ? queryOfficial(earlyOfficialSeed) : undefined;
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
      [...affiliateCandidates, ...ebayCandidates, ...shopifyCandidates, ...officialCandidates],
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

  await earlyOfficial;
  const officialSeed = earlyOfficialSeed ?? officialStoreSeed(observedShopifyProducts, input);
  if (
    earlyOfficial === undefined &&
    ports.officialShopify !== undefined &&
    officialSeed !== undefined &&
    (input.brandMode === "REQUIRED" || lacksStrongMatch([...affiliateCandidates, ...shopifyCandidates, ...ebayCandidates], searchIntent))
  ) {
    await queryOfficial(officialSeed);
  }
  shopifyCandidates = input.deferVisualFiltering === true
    ? mergeCandidatesPreservingOrder(officialCandidates, shopifyCandidates)
    : mergeCandidates(shopifyCandidates, officialCandidates);
  if (shopifyResult !== undefined) {
    shopifyResult = { ...shopifyResult, products: mergeShopifyProducts(shopifyResult.products, officialProducts) };
  }

  // Source-owned Awin identities may verify the exact same storefront returned
  // by another adapter. Never match merchant names, arbitrary subdomains or
  // conflicting advertiser identities. Existing risk denials win.
  shopifyCandidates = shopifyCandidates.map(candidate => {
    if (candidate.shopifyProduct === undefined || candidate.shopifyProduct.merchantTrust.verification === "INDEPENDENT" ||
      candidate.shopifyProduct.merchantTrust.level === "RISKY") return candidate;
    const product = candidate.shopifyProduct;
    const host = new URL(product.merchantUrl).hostname.toLowerCase().replace(/^www\./u, "");
    const merchants = approvedAwinHosts.get(host);
    if (host !== product.sourceHost.toLowerCase().replace(/^www\./u, "") || merchants?.size !== 1) return candidate;
    return { ...candidate, recommendationTier: "TRUSTED_OR_AFFILIATE" as const, shopifyProduct: { ...product,
      merchantTrust: { level: "ESTABLISHED_RETAILER" as const, verification: "INDEPENDENT" as const,
        evidence: [`manually verified approved Awin merchant ${[...merchants][0]} on the same source domain`] }
    } };
  });
  const rawCandidates = [...affiliateCandidates, ...shopifyCandidates, ...ebayCandidates];
  const enrichedCandidates = input.deferVisualFiltering === true ? rawCandidates : await addVerifiedCoupons(
    rawCandidates, ports.deals, input.membershipIds ?? [], searchRun
  );
  const reviewPool = input.deferVisualFiltering === true
    ? selectVisualReviewCandidates(enrichedCandidates, 18, input.visualInput)
    : undefined;
  if (reviewPool !== undefined && input.visualInput !== undefined) searchRun.recordVisualStage("REVIEW_POOL", reviewPool.map(candidateFingerprint));
  const candidates = input.deferVisualFiltering === true
    ? reviewPool!.slice(0, input.limit)
    : selectPresentationCandidates(
        [...enrichedCandidates].sort(
          input.selectionMode === "LOWEST_PRICE" ? compareLowestPrice : compareRankedCandidates
        ),
        input.selectionMode,
        input.allowAlternatives,
        input.visualInput !== undefined,
        input.brand !== undefined && input.brandMode === "REQUIRED"
      ).slice(0, input.limit);
  const queriedSourcesComplete =
    awinStatus !== "UNAVAILABLE" &&
    ebayStatus !== "UNAVAILABLE" &&
    shopifyStatus !== "UNAVAILABLE" &&
    shopifyStatus !== "PARTIAL" &&
    officialStoreFallback.status !== "PARTIAL" && officialStoreFallback.status !== "UNAVAILABLE";
  const chromeFallbackEligible =
    candidates.length === 0 &&
    !searchRun.diagnostics().budgetExhausted &&
    queriedSourcesComplete &&
    searchPasses === 2;

  return {
    candidates,
    searchRun,
    ...(reviewPool === undefined ? {} : { reviewPool }),
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
  return rankedCandidateTitle(candidate);
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
  if (input.maxItemPriceCents !== undefined && product.itemPrice.amountCents > input.maxItemPriceCents) return undefined;
  const brand = assessBrand(input, [product.merchant], [product.title]);
  if (brand.excluded) {
    brandExcludedKeys.add(key);
    return undefined;
  }
  if (!conditionMatches(product.condition, input.conditionPreference)) return undefined;
  const verifiedBrand = brand.matchEvidence.length === 0 ? undefined : input.brand;
  const categoryRelevance = searchIntent === "CATEGORY_DISCOVERY"
    ? classifyShopifyCandidate(identityQuery, {
        title: product.title,
        productType: product.category,
        ...(verifiedBrand === undefined ? {} : { brand: verifiedBrand })
      })
    : undefined;
  if (categoryRelevance?.status === "IRRELEVANT") {
    identityExcludedKeys.add(key);
    return undefined;
  }
  const categoryEvidence = categoryRelevance?.evidence ?? [];
  const identity = candidateIdentity(
    searchIntent,
    input.allowAlternatives,
    identityQuery,
    {
      title: product.title,
      productType: product.category,
      ...(verifiedBrand === undefined ? {} : { brand: verifiedBrand })
    },
    product.matchStatus,
    key,
    identityExcludedKeys
  );
  if (identity === undefined) return undefined;
  const evidence = evaluateConstraints({ title: product.title, productType: product.category,
    description: product.requirementEvidence, evidenceSource: "FEED" }, input);
  if (evidence.contradicted.length > 0) {
    featureExcludedKeys.add(key);
    return undefined;
  }
  const visual = visualIdentity(input, {
    title: product.title,
    productType: product.category,
    brand: verifiedBrand
  }, key, visualExcludedKeys);
  if (visual === null) return undefined;
  return {
    source: "AWIN_PRODUCT_FEED",
    affiliateState: "APPROVED",
    recommendationTier: "TRUSTED_OR_AFFILIATE",
    featureEvidence: unique([...evidence.matched, ...brand.requiredEvidence]),
    preferenceEvidence: unique([...evidence.preferences, ...brand.preferenceEvidence]),
    requiredFeatureLimitations: evidence.unknown,
    requirementAssessment: evidence.assessment,
    verifiedCoupons: [],
    identityStatus: visualIdentityStatus(identity.status, visual),
    identityEvidence: unique([...categoryEvidence, ...identity.evidence, ...brand.matchEvidence, ...(visual?.evidence ?? [])]),
    resultGroup: candidateResultGroup(searchIntent, identity.status, visual),
    ...(visual === undefined ? {} : {
      visualMatchGroup: visual.group,
      visualMatchEvidence: visual.evidence,
      visualMatchScore: visual.score
    }),
    awinProduct: evidence.unknown.length === 0 ? {
      ...product,
      matchEvidence: unique([...product.matchEvidence, ...categoryEvidence, ...identity.evidence, ...brand.matchEvidence, ...(visual?.evidence ?? [])])
    } : {
      ...product,
      matchStatus: "DISCOVERY_MATCH",
      matchEvidence: unique([
        ...product.matchEvidence,
        ...categoryEvidence,
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
  if (input.maxItemPriceCents !== undefined && product.itemPrice !== undefined && product.itemPrice.amountCents > input.maxItemPriceCents) return undefined;
  if (product.merchantTrust.level === "RISKY") return undefined;
  const brand = assessBrand(input, [
    product.brand,
    ...(product.merchantTrust.level === "OFFICIAL" ? [product.merchant] : [])
  ], [product.title]);
  if (brand.excluded) {
    brandExcludedKeys.add(key);
    return undefined;
  }
  if (!conditionMatches(product.condition, input.conditionPreference)) return undefined;
  const evidence = evaluateConstraints(product, input);
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
    requirementAssessment: evidence.assessment,
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
  input: Pick<SearchProductsInput, "query" | "comparisonMode" | "visualInput" | "brand" | "brandMode">
): ProductSearchIntent {
  if (input.comparisonMode === "SAME_PRODUCT" || hasStrongProductIdentifier(input.query)) {
    return "EXACT_PRODUCT";
  }
  if (input.visualInput !== undefined) return "VISUAL_DISCOVERY";
  const identityQuery = input.brand !== undefined && input.brandMode === "REQUIRED"
    ? withoutRequestedBrand(input.query, input.brand)
    : input.query;
  if (
    input.brand !== undefined &&
    input.brandMode === "REQUIRED" &&
    hasSpecificProductIdentity(identityQuery, 1)
  ) return "EXACT_PRODUCT";
  return hasNamedProductIntent(identityQuery) ? "EXACT_PRODUCT" : "CATEGORY_DISCOVERY";
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
  const brand = assessBrand(input, product.attributes.filter(isExplicitBrandAttribute), [product.title]);
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
  const evidence = evaluateConstraints({ title: product.title, productType: product.category,
    description: product.attributes.join(" ") }, input);
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
    requirementAssessment: evidence.assessment,
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
    return buildVisualRetrievalQuery(input.visualInput, {
      ...(input.brand === undefined ? {} : { brand: input.brand }),
      ...(input.productType === undefined ? {} : { productType: input.productType }),
      relaxed: true
    }) || input.query;
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

function buildSourceQuery(input: Pick<SearchProductsInput, "query" | "brand" | "productType" | "visualInput" | "maxItemPriceCents"> & {
  relaxVisualRetrieval?: boolean;
}): string {
  if (input.visualInput !== undefined) {
    return buildVisualRetrievalQuery(input.visualInput, {
      ...(input.brand === undefined ? {} : { brand: input.brand }),
      ...(input.productType === undefined ? {} : { productType: input.productType }),
      relaxed: input.relaxVisualRetrieval === true
    }) || input.query;
  }
  const query = productOnlyQuery(input.query, input.maxItemPriceCents !== undefined);
  return unique([
    input.brand !== undefined && !containsBrand(query, input.brand) ? input.brand : "",
    query,
    input.productType !== undefined && !normalize(query).includes(normalize(input.productType))
      ? input.productType
      : "",
  ]).join(" ").slice(0, 300).trim();
}

function stripRequiredFeaturesFromQuery(value: string, features: readonly string[]): string {
  let query = value;
  for (const feature of features) {
    if (!isMemoryOrStorageSpecification(feature)) continue;
    const tokens = feature.normalize("NFKC").trim().split(/\s+/u).filter((token) => token !== "");
    if (tokens.length === 0) continue;
    const phrase = tokens.map(escapeRegExp).join("\\s*");
    query = query.replace(new RegExp(`(?:^|\\s)${phrase}(?=\\s|$|[,;])`, "giu"), " ");
  }
  return query.replace(/\s+/gu, " ").trim() || value;
}

function isMemoryOrStorageSpecification(value: string): boolean {
  return /\b\d+\s*(?:mb|gb|tb)\b/iu.test(value) &&
    /\b(?:memory|ram|storage|ssd|mb|gb|tb)\b/iu.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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
    .replace(/\b(?:for|suitable\s+for)\s+(?:programming|coding|software\s+development|gaming|video\s+editing|office(?:\s+(?:work|use))?|school|college|travel|everyday\s+use|daily\s+use)\b/giu, " ")
    .replace(/(?:适合|用于)?(?:编程|写代码|软件开发|游戏|剪辑|视频编辑|办公|上学|通勤|日常使用)/gu, " ")
    .replace(/\s+/gu, " ")
    .trim() || value;
}

function stripPreferredSizeFromIdentity(value: string, preferredSize: string | undefined): string {
  if (preferredSize === undefined) return value;
  const stripped = value
    .replace(/\b\d{1,3}(?:\.\d+)?\s*[-\s]*(?:inch(?:es)?|in\b|["″”])/giu, " ")
    .replace(/\d{1,3}(?:\.\d+)?\s*(?:英寸|寸)/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return stripped || value;
}

function stripPrimaryUseFromIdentity(value: string, primaryUse: string | undefined): string {
  if (primaryUse === undefined) return value;
  const useTerms = new Set(searchTerms(primaryUse));
  if (useTerms.size === 0) return value;
  const markers = [...value.matchAll(/\s+(?:for|suitable\s+for)\s+|(?:适合|用于|用来)/giu)];
  for (const marker of markers.reverse()) {
    const suffix = value.slice((marker.index ?? 0) + marker[0].length);
    if (searchTerms(suffix).some((term) => useTerms.has(term))) {
      const stripped = value.slice(0, marker.index).replace(/\s+/gu, " ").trim();
      return stripped || value;
    }
  }
  return value;
}

function searchTerms(value: string): string[] {
  return (value.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((term) => term.length > 1 && !["and", "based", "use"].includes(term));
}

function buildOfficialStoreQueries(
  input: SearchProductsInput,
  searchIntent: ProductSearchIntent,
  compactOfficialDiscovery = false
): VisualOfficialStoreQuery[] {
  if (input.visualInput !== undefined && searchIntent !== "EXACT_PRODUCT") {
    const suspectedName = input.visualInput.suspectedProductName;
    const suspectedQuery = suspectedName === undefined
      ? undefined
      : input.brand === undefined
        ? suspectedName
        : withoutRequestedBrand(suspectedName, input.brand);
    const compactQuery = compactOfficialDiscovery ? visualOfficialStoreDiscoveryQuery(input.visualInput) : undefined;
    const structureQuery = visualOfficialStructureQuery(input.visualInput);
    const ordinaryStages = visualOfficialStoreSearchQueries(input.visualInput);
    const structureStage = structureQuery === undefined ? [] : [{ stage: "CORE" as const, query: structureQuery }];
    const attempts = [
      ...(suspectedQuery === undefined || suspectedQuery.trim() === ""
        ? []
        : [{ stage: "FULL" as const, query: suspectedQuery }]),
      ...(compactQuery === undefined ? [] : [{ stage: "CORE" as const, query: compactQuery }]),
      ...(compactOfficialDiscovery ? structureStage : []),
      ...ordinaryStages.flatMap((attempt, index) => index === 0 && !compactOfficialDiscovery ? [attempt, ...structureStage] : [attempt])
    ];
    const seen = new Set<string>();
    return attempts
      .map((attempt) => ({ ...attempt, query: attempt.query.slice(0, 300).trim() }))
      .filter((attempt) => {
        const key = normalize(attempt.query);
        if (key === "" || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }
  const withoutBrand = input.brand === undefined
    ? input.query
    : withoutRequestedBrand(input.query, input.brand);
  const visualCategory = input.visualInput === undefined
    ? undefined
    : visualOfficialStoreSearchQueries(input.visualInput)
      .find((attempt) => attempt.stage === "CATEGORY")?.query;
  const category = input.productType?.trim() || visualCategory;
  const queries: VisualOfficialStoreQuery[] = [
    { stage: "FULL", query: withoutBrand || category || input.query },
    { stage: "CORE", query: unique([...(category ?? "").split(/\s+/u), ...withoutBrand.split(/\s+/u).slice(0, 3)]).join(" ") },
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
  input: Pick<SearchProductsInput, "brand" | "brandMode" | "visualInput">
): OfficialShopifyStoreSeed | undefined {
  const brand = input.brand ?? input.visualInput?.brand;
  let sourceStore: ReturnType<typeof resolveVerifiedOfficialStorefront>;
  if (input.visualInput?.sourcePageUrl !== undefined) {
    const url = new URL(input.visualInput.sourcePageUrl);
    if (url.protocol === "https:" && url.username === "" && url.password === "" && url.port === "") {
      sourceStore = resolveVerifiedOfficialStorefrontByHost(url.hostname);
    }
  }
  if (brand === undefined && sourceStore === undefined) return undefined;
  if (input.visualInput === undefined && input.brandMode !== "REQUIRED") return undefined;
  const observed = products.find((product) => {
    const trust = resolveMerchantTrust(product.sourceHost, product.merchant);
    return trust.level === "OFFICIAL" &&
      trust.verification === "INDEPENDENT" &&
      [product.brand, product.merchant, product.title]
        .some((value) => value !== undefined && brand !== undefined && containsBrand(value, brand));
  });
  const storefront = sourceStore ?? (brand === undefined ? undefined : resolveVerifiedOfficialStorefront(brand));
  if (storefront === undefined) return observed;
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
  authoritativeValues: Array<string | undefined>,
  productLineValues: Array<string | undefined> = []
): {
  excluded: boolean;
  requiredEvidence: string[];
  preferenceEvidence: string[];
  matchEvidence: string[];
} {
  if (input.brand === undefined) {
    return { excluded: false, requiredEvidence: [], preferenceEvidence: [], matchEvidence: [] };
  }
  const matched = authoritativeValues.some((value) =>
    value !== undefined && containsBrand(value, input.brand!)
  ) || productLineValues.some((value) =>
    value !== undefined && containsOwnedProductLineEvidence(value, input.brand!)
  );
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

function containsOwnedProductLineEvidence(value: string, brand: string): boolean {
  const candidateTokens = brandTokens(value);
  const requestedTokens = brandTokens(brand);
  const ownedProductLines = BRAND_OWNED_PRODUCT_LINES[requestedTokens.join(" ")];
  return ownedProductLines?.some((line) => candidateTokens.includes(line)) === true;
}

function isExplicitBrandAttribute(value: string): boolean {
  const normalized = value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  return /^(?:brand|manufacturer|make)\s*[:=]/u.test(normalized) &&
    !/^(?:compatible\s+brand|compatible\s+with)\s*[:=]/u.test(normalized);
}

const BRAND_OWNED_PRODUCT_LINES: Readonly<Record<string, readonly string[]>> = {
  apple: ["airpods", "imac", "ipad", "iphone", "macbook"]
};

function brandTokens(value: string): string[] {
  return value.normalize("NFKD").toLocaleLowerCase("en-US")
    .replace(/\p{M}+/gu, "")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

function withoutRequestedBrand(query: string, brand: string): string {
  const requestedBrandTokens = new Set(brandTokens(brand));
  return query.split(/\s+/u)
    .filter((token) => !brandTokens(token).some((part) => requestedBrandTokens.has(part)))
    .join(" ")
    .trim();
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
    productReferenceKey(product),
    product
  ]));
  for (const product of incoming) products.set(productReferenceKey(product), product);
  return [...products.values()];
}

export async function addVerifiedCoupons(
  candidates: UnifiedCandidate[],
  deals: DealPort | undefined,
  membershipIds: string[],
  searchRun?: SearchRun
): Promise<UnifiedCandidate[]> {
  if (deals === undefined || candidates.length === 0) return candidates.map((candidate) => ({
    ...candidate, dealLookupStatus: "UNAVAILABLE" as const
  }));
  const merchants = new Map<string, string>();
  for (const candidate of [...candidates].sort(compareRankedCandidates)) {
    const merchant = candidateMerchant(candidate);
    const key = normalize(merchant);
    if (!merchants.has(key)) merchants.set(key, merchant);
    if (merchants.size === 12) break;
  }
  const results: Array<readonly [string, DealLookupResult]> = await Promise.all([...merchants].map(async ([key, merchant]) => {
    try {
      const read = () => searchDealsWithStatus(deals, {
        merchant,
        membershipIds,
        channel: "ONLINE"
      });
      const lookup = await (searchRun === undefined ? read() : searchRun.read("DEALS", key, read));
      return [key, { ...lookup, deals: lookup.deals.filter(isCoupon) }] as const;
    } catch {
      return [key, { status: "UNAVAILABLE" as const, deals: [], reasonCodes: [] }] as const;
    }
  }));
  const byMerchant = new Map(results);
  return candidates.map((candidate) => ({
    ...candidate,
    verifiedCoupons: byMerchant.get(normalize(candidateMerchant(candidate)))?.deals ?? [],
    dealLookupStatus: byMerchant.get(normalize(candidateMerchant(candidate)))?.status ?? "UNAVAILABLE"
  }));
}

function isCoupon(deal: VerifiedDeal): boolean {
  return deal.kind === "COUPON" || deal.kind === "PROMO_CODE" || deal.kind === "BRAND_PROMOTION";
}

function visualIdentity(
  input: SearchProductsExecutionInput,
  candidate: Parameters<typeof classifyVisualProduct>[1],
  key: string,
  excluded: Set<string>
): VisualMatch | undefined | null {
  if (input.visualInput === undefined) return undefined;
  if (input.deferVisualFiltering === true && hasVisualProductFamilyConflict(input.visualInput, candidate)) {
    excluded.add(key);
    return null;
  }
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

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

function evaluateConstraints(
  product: RequirementProduct,
  input: Pick<SearchProductsInput, "requiredFeatures" | "excludedFeatures" | "preferences" | "features" | "featureMode" | "requiredSize">
) {
  const required = unique([
    ...input.requiredFeatures,
    ...(input.featureMode === "REQUIRED" ? input.features : [])
  ]);
  const preferences = unique([
    ...input.preferences,
    ...(input.featureMode === "PREFERRED" ? input.features : [])
  ]);
  return evaluateProductRequirements(product, { requiredFeatures: required,
    excludedFeatures: input.excludedFeatures, preferences, requiredSize: input.requiredSize });
}

function inferredPackagingExclusions(
  input: Pick<SearchProductsInput, "query" | "requiredFeatures" | "features">
): string[] {
  const text = normalize([input.query, ...input.requiredFeatures, ...input.features].join(" "));
  if (!/(?:\b(?:full[-\s]?size|large\s+(?:bag|package)|retail\s+size|regular\s+size)\b|大包装|正装|非试(?:用|吃)装|不要试(?:用|吃)装)/u.test(text)) {
    return [];
  }
  return ["sample", "trial pack", "trial size", "tester"];
}

function isPackagingOnlyConstraint(feature: string): boolean {
  const text = normalize(feature);
  return !/\d/u.test(text) &&
    /(?:\b(?:full[-\s]?size|large\s+(?:bag|package)|retail\s+size|regular\s+size|sample|trial\s+(?:pack|size)|tester)\b|大包装|正装|试(?:用|吃)装)/u.test(text);
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
