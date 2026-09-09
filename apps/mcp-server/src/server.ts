import { TaskScope, mapCodec } from "./task-scope.js";
import { TASK_HISTORY_TTL_MS, type TaskStateStore } from "./task-state-store.js";
import { pauseTaskWatches, type TaskLifecycleReader } from "./task-lifecycle.js";
import { candidateFingerprint } from "./visual-source-fingerprints.js";
import { wooProductFacts, candidateProductFacts, dealProductId } from "./woocommerce-product.js";
import { createWooProductAnchor } from "./woo-product-identity.js";
import { snapshotProductIndex, type SnapshotSourceProduct } from "./snapshot-products.js";
import { WooSearchResultSchema, wooProductTarget } from "../../../packages/contracts/src/woocommerce.js";
import { createHash, randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { productReferenceKey } from "./product-reference.js";
import { RequirementAssessmentSchema, ambiguousShoeSize, normalizedSizeRequirement } from "./product-requirements.js";
import { mergeSearchRequirements, shoppingRequirementLedger } from "./search-requirements-context.js";
import { normalizePackageRequirements } from "./package-requirements.js";
import { assessQualityEvidence, unitPriceEvidence, QualityEvidenceSchema, UnitPriceSchema, ValueEvidenceSchema } from "./product-value-evidence.js";
import { createFindCheapBackend, type FindCheapBackend } from "./backend.js";
import { describeVisualOutcome, needsMoreVisualReview, selectVisualResults, VisualSearchOutcomeSchema } from "./visual-search-outcome.js";
import { ToolExecutor } from "./execution/tool-executor.js";
import { toolError } from "./execution/tool-outcome.js";
import { SearchRun, SearchBudgetError, SearchReadTimeoutError } from "./search-run.js";
import { buildVisualRetrievalQuery } from "./visual-retrieval-query.js";
import { assessVisualVerdict, hasAdmissibleVisualConflict } from "./visual-review-policy.js";
import { researchRecommendationMessage } from "./recommendation-message.js";
import { searchDiagnostics, shopifySearchCoverage, wooSearchCoverage, wooRoutingExplanation, type SearchOutcome } from "./search-diagnostics.js";
import { SourceValidationDetailsSchema } from "./source-failure.js";
import { textSearchRecovery, TextSearchRecoverySchema } from "./text-search-recovery.js";
import { WebRecoverySessions, WebConsentStatusSchema, WebDiscoveryOutcomeSchema, WebProductUrlSchema, WEB_SEARCH_LIMITS, webSearchQueries, readWebCandidates, type WebProductPagePort } from "./web-product-recovery.js";
import { awaitWithSignal } from "./await-with-signal.js";
import { evaluateRecoveredProducts, evaluateSearchProductRequirements, productIdentityBrand, woocommerceCandidate, resolveSearchIntent, parseStoredSearchRequest, requestedCoffeeCategory, StoredSearchProductsInputSchema } from "./search-products.js";
import { inspectedShopifyProductAnchor, matchesShopifyProductAnchor, matchesSelectedShopifyInspection, hasConflictingShopifyVariantId } from "./shopify-product-anchor.js";
import { assessCoffeeCategory, assessCoffeeCompatibility, COFFEE_SYSTEMS } from "./coffee-category.js";
import { createExecutedToolRegistrar } from "./execution/tool-registry.js";
import {
  ProductComparisonInputSchema,
  ProductComparisonOutputSchema,
  buildProductComparison,
  type ComparableProduct,
  type ProductComparisonOutput
} from "./product-comparison.js";
import {
  PRODUCT_COMPARISON_HTML,
  PRODUCT_COMPARISON_UI_URI
} from "./product-comparison-ui.js";
import { FINDCHEAP_VERSION } from "../../../config/version.js";
import {
  ProductCardTelemetryInputSchema,
  type ProductCardTelemetry,
  type ProductCardTelemetrySink
} from "./product-card-telemetry.js";
import {
  createUnavailableShopifyPort,
  type ShopifyPort,
  type ShopifyProduct,
  type ShopifySearchResult
} from "./shopify-client.js";
import { assessRequestIdentity, classifyShopifyCandidate, hasSpecificProductIdentity } from "./shopify-match.js";
import { hasAmbiguousSonyFamily, resolveSonyFamilyQuery } from "./sony-family.js";
import { finalizeSnapshotProducts, reconcileComparison, searchFallbackExplanation, snapshotCardSummary, summarizeSearchProducts } from "./search-result-summary.js";
import {
  ShopifyCartQuoteError,
  validateShopifyCartQuoteTarget,
  type ShopifyCartQuotePort,
  type ShopifyCartEstimate,
  type ShopifyQuoteFailureCode
} from "./shopify-cart-quote.js";
import { issueQuoteAuthorization } from "./quote-authorization.js";
import { selectedInspectionFailure, type ShopifySelectedProductInspector } from "./shopify-selected-product.js";
import type { OfficialShopifySearchPort } from "./shopify-official-store-search.js";
import type { OfficialStorefrontRegistryPort } from "./official-storefront-registry-client.js";
import type { MerchantTrustRegistryPort } from "./merchant-trust-registry-client.js";
import {
  VisualCandidateImageError,
  isRetryableVisualImageFailure,
  type VisualCandidateImageFailureCode,
  type VisualCandidateImagePort
} from "./visual-candidate-images.js";
import type { AwinShopifyQuoteResolver, AwinShopifyQuoteSeed } from "./awin-shopify-quote.js";
import type { EbayBrowsePort } from "./ebay-client.js";
import {
  createAffiliateLinkResolver,
  type AffiliateLinkResolver
} from "./affiliate-links.js";
import {
  PRODUCT_CARD_HTML,
  PRODUCT_CARD_RESOURCE_DOMAINS,
  PRODUCT_CARD_UI_URI
} from "./product-card-ui.js";
import { MAX_PRODUCT_CARDS, candidateKey, compareRankedCandidates } from "./product-candidate-ranking.js";
import {
  RECOMMENDATION_REASON_CODES,
  choosePrimaryRecommendation,
  coffeeCompatibilityClarification,
  highVarianceClarification
} from "./product-recommendation.js";
import {
  DealSearchInputSchema,
  DealLookupStatusSchema,
  DealLookupReasonSchema,
  VerifiedDealsSchema,
  createUnavailableDealPort,
  dealAppliesToProduct,
  estimatedItemPriceAfterCoupon,
  type DealPort,
  type VerifiedDeal
} from "./deal-client.js";
import { researchSelectedProductDeal } from "./deal-concierge.js";
import { DealAssessmentSchema, DealSummarySchema, assessSelectedProductDeal, isPlaceholderDealTerm, rankAssessedDeals } from "./deal-assessment.js";
import { merchantReportedVariant, merchantVariantStyleKey } from "./merchant-variant.js";
import {
  WatchSpecSchema,
  WatchSpecInputSchema,
  WatchAutomationIdSchema,
  WatchStopIntentSchema,
  WatchCompletionNotificationSchema,
  watchStopIntent,
  productWatchClarificationQuestions,
  createMemoryWatchStore,
  type WatchStore
} from "./watch-store.js";
import { evaluateWatch, observeWooProduct, type WatchEvaluation, type WooWatchObservation } from "./watch-service.js";
import {
  currentMerchantTrustRegistryVersion,
  isTrustedMerchant,
  isHighRatedProduct,
  resolveMerchantTrust
} from "./merchant-trust.js";
import {
  CodexVisualVerdictSchema,
  SearchProductsInputSchema,
  candidateImageUrl,
  candidateMerchant,
  candidateTitle,
  addVerifiedCoupons,
  finalizeCodexVisualCandidates,
  assessCodexVisualCandidate,
  searchProducts,
  type CodexVisualVerdict,
  type SearchProductsExecutionInput,
  type SearchProductsInput,
  type UnifiedCandidate,
  type UnifiedSearchExecution
} from "./search-products.js";
import {
  VisualProductInputSchema,
  enforceVisualEvidenceAuthority,
  relaxVisualProductInput
} from "./visual-product-discovery.js";
import {
  createUnavailableAwinPort,
  type AwinProductPort,
  type AwinSearchResult
} from "../../../packages/awin-feed/src/index.js";

export type { ShopifyPort } from "./shopify-client.js";
export type { DealPort } from "./deal-client.js";
export type { WatchStore } from "./watch-store.js";
export type { AwinProductPort } from "../../../packages/awin-feed/src/index.js";

const SelectionIdSchema = z.string().uuid();
const ProductPositionSchema = z.number().int().min(1).max(MAX_PRODUCT_CARDS)
  .describe("One-based position in the immutable product list returned by search_products.");
const VisualSessionIdSchema = z.string().uuid();
export type { ProductCardTelemetry, ProductCardTelemetrySink } from "./product-card-telemetry.js";

export const PRODUCT_SELECTION_SNAPSHOT_TTL_MS = 2 * 60 * 60_000;
export const MAX_PRODUCT_SELECTION_SNAPSHOTS = 128;
export const MAX_PRODUCT_COMPARISON_SNAPSHOTS = 128;
export const VISUAL_SEARCH_SNAPSHOT_TTL_MS = 10 * 60_000;
export const MAX_VISUAL_SEARCH_SNAPSHOTS = 32;
export const MAX_VISUAL_CANDIDATES = 6;
export const MAX_RELAXED_VISUAL_CANDIDATES = 3;
export const MAX_VISUAL_CANDIDATE_OUTPUT_DATA_CHARS = 400_000;

const ProductCardSelectionInputSchema = z.object({
  renderId: z.string().uuid(),
  selectionIds: z.array(SelectionIdSchema).max(4).refine(
    (values) => new Set(values).size === values.length,
    { message: "selectionIds must contain unique values" }
  ),
  revision: z.number().int().min(1).max(1_000_000)
}).strict();

function uniqueVisualTerms(values: Array<string | undefined>): string[] {
  return [...new Set(values
    .filter((value): value is string => value !== undefined)
    .map((value) => value.normalize("NFKC").trim())
    .filter(Boolean))];
}

function visualRetrievalSearchInput(input: SearchProductsInput, relaxed: boolean, searchRun?: SearchRun): SearchProductsExecutionInput {
  const visual = input.visualInput!;
  const retrievalVisual = relaxed ? relaxVisualProductInput(visual) : visual;
  const query = buildVisualRetrievalQuery(retrievalVisual, {
    ...(input.brand === undefined ? {} : { brand: input.brand }),
    ...(input.productType === undefined ? {} : { productType: input.productType }), relaxed
  });
  return {
    ...input,
    ...(searchRun === undefined ? {} : { searchRun }),
    query: query.length >= 2 ? query.slice(0, 300) : input.query,
    limit: MAX_VISUAL_CANDIDATES,
    allowAlternatives: input.allowAlternatives,
    preferences: uniqueVisualTerms([
      ...input.preferences,
      ...(input.featureMode === "PREFERRED" ? input.features : [])
    ]).slice(0, 10),
    // Keep visual evidence for official-store query generation, but do not let
    // sparse catalog metadata reject candidates before Codex reviews images.
    visualInput: retrievalVisual,
    relaxVisualRetrieval: relaxed,
    deferVisualFiltering: true
  };
}

function visualCandidateKey(candidate: UnifiedCandidate): string {
  const productKey = candidate.source === "WOOCOMMERCE_STORE_API" ? candidateFingerprint(candidate).productHash
    : candidate.source === "SHOPIFY_GLOBAL_CATALOG"
    ? productReferenceKey(candidate.shopifyProduct)
    : candidate.source === "AWIN_PRODUCT_FEED"
      ? JSON.stringify([candidate.source, candidate.awinProduct.merchantId, candidate.awinProduct.merchantProductId])
      : JSON.stringify([candidate.source, candidate.ebayProduct.itemId]);
  const merchantUrl = candidateProductFacts(candidate).merchantUrl;
  try {
    const url = new URL(merchantUrl);
    url.hash = "";
    // Tracking is not identity; variant parameters and the actual candidate
    // image are. Reviewing one colour must not consume every colour of a style.
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|gclid|fbclid|msclkid|awc|awinaffid)$/iu.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return `${productKey}|${url.hostname.toLocaleLowerCase("en-US")}${url.pathname.replace(/\/$/u, "")}${url.search}|${candidateImageUrl(candidate) ?? ""}`;
  } catch {
    // Source-specific fallback keeps malformed external identity isolated.
  }
  return productKey;
}

function visualProductHash(candidate: UnifiedCandidate): string {
  if (candidate.source === "WOOCOMMERCE_STORE_API") return candidateFingerprint(candidate).productHash;
  const product = candidate.source === "SHOPIFY_GLOBAL_CATALOG" ? candidate.shopifyProduct
    : candidate.source === "AWIN_PRODUCT_FEED" ? awinCardProduct(candidate) : ebayCardProduct(candidate);
  return createHash("sha256").update(productReferenceKey(product)).digest("hex");
}

function visualEvaluationMeta(execution: UnifiedSearchExecution, retrieved: ReadonlySet<string>,
  entries: Array<{ candidateId: string; candidate: UnifiedCandidate; image: { data: string } }> = [],
  products?: ProductCardProduct[], primarySelectionId?: string) {
  const wooHashes = new Map([...(execution.reviewPool ?? []), ...execution.candidates]
    .filter(candidate => candidate.source === "WOOCOMMERCE_STORE_API")
    .map(candidate => [productReferenceKey(wooProductFacts(candidate.woocommerceProduct)), candidateFingerprint(candidate).productHash]));
  const hash = (product: ProductCardProduct) => wooHashes.get(productReferenceKey(product)) ??
    createHash("sha256").update(productReferenceKey(product)).digest("hex");
  const primary = primarySelectionId === undefined ? undefined : products?.find((product) => product.selectionId === primarySelectionId);
  return { "findcheap/visualEvaluation": {
    version: 1, traceId: execution.searchRun?.traceId,
    retrievedProductHashes: [...retrieved],
    reviewedCandidatesScope: "CURRENT_RESPONSE_IMAGES",
    reviewedCandidates: entries.map(({ candidateId, candidate, image }) => ({
      candidateId, productHash: visualProductHash(candidate),
      imageUrlHash: createHash("sha256").update(candidateImageUrl(candidate) ?? "").digest("hex"),
      imageSha256: createHash("sha256").update(Buffer.from(image.data, "base64")).digest("hex")
    })),
    ...(products === undefined ? {} : { finalProductHashes: products.map(hash) }),
    ...(primary === undefined ? {} : { primaryProductHash: hash(primary) })
  } };
}

const shopifyUnavailableMessage =
  "Shopify Global Catalog data is unavailable because the official Catalog request failed or the Agent Profile is not configured.";
const dealUnavailableMessage =
  "Verified Coupon and Cashback data is unavailable because no approved Deals API is configured or the request failed.";
const FindCouponsInputSchema = DealSearchInputSchema.extend({
  responseLocale: z.enum(["en-US", "zh-CN"]).default("en-US")
}).strict();

type VisualSearchFailureCode =
  | "OFFICIAL_SOURCE_UNAVAILABLE"
  | "OFFICIAL_ZERO_RESULTS"
  | "NO_CATALOG_CANDIDATES"
  | "NO_LOADABLE_IMAGES"
  | "IMAGE_PROCESSING_LIMIT"
  | "VISUAL_EVIDENCE_INSUFFICIENT"
  | "SEARCH_BUDGET_EXHAUSTED"
  | "CANDIDATES_CONFLICTED";

function imageFailureCode(diagnostics: {
  attempted: number; outputBudgetSkipped: number;
  failures: Array<{ code: string }>;
}): "NO_CATALOG_CANDIDATES" | "NO_LOADABLE_IMAGES" | "IMAGE_PROCESSING_LIMIT" {
  if (diagnostics.outputBudgetSkipped > 0 || diagnostics.failures.some(({ code }) =>
    /^(?:OUTPUT_BUDGET_EXCEEDED|IMAGE_TRANSFORM_|IMAGE_PROCESSING_|IMAGE_PIXEL_)/u.test(code))) return "IMAGE_PROCESSING_LIMIT";
  return diagnostics.attempted === 0 ? "NO_CATALOG_CANDIDATES" : "NO_LOADABLE_IMAGES";
}

function visualSearchFailure(
  execution: UnifiedSearchExecution,
  fallbackCode: Exclude<VisualSearchFailureCode, "OFFICIAL_SOURCE_UNAVAILABLE" | "OFFICIAL_ZERO_RESULTS" | "SEARCH_BUDGET_EXHAUSTED">,
  locale: "en-US" | "zh-CN"
): { code: VisualSearchFailureCode; message: string; sourceHost?: string } {
  const localized = (english: string, chinese: string) => locale === "zh-CN" ? chinese : english;
  if (fallbackCode === "IMAGE_PROCESSING_LIMIT") return {
    code: fallbackCode,
    message: localized("Candidate images could not fit the bounded image-processing or output capacity. This is not a reference-image safety rejection or proof the product is absent.",
      "候选图片受处理或输出容量限制，未能完成视觉检查；不是参考图片不安全，也不代表商品不存在。")
  };
  if (execution.searchRun?.diagnostics().budgetExhausted === true) return {
    code: "SEARCH_BUDGET_EXHAUSTED",
    message: localized("Search budget was reached; retrieval is incomplete, not proof that the product is absent.",
      "本次检索预算已用尽，检索尚不完整，不能据此判断商品不存在。")
  };
  if (fallbackCode === "VISUAL_EVIDENCE_INSUFFICIENT") return {
    code: fallbackCode,
    message: localized("Reviewed candidates lack enough visible matching evidence; this is not a confirmed visual conflict.",
      "已检查候选的可见匹配证据不足；这不等于已确认存在款式冲突。")
  };
  const official = execution.officialStoreFallback;
  if (official.status === "UNAVAILABLE") {
    return {
      code: "OFFICIAL_SOURCE_UNAVAILABLE",
      message: localized(
        "Verified official-store search was unavailable. Candidate conflicts do not prove the product is absent.",
        "已验证品牌官网搜索暂不可用；候选冲突不能证明商品不存在。"
      ),
      ...(official.sourceHost === undefined ? {} : { sourceHost: official.sourceHost })
    };
  }
  if (official.diagnostic?.outcome === "OFFICIAL_ZERO_RESULTS") {
    return {
      code: "OFFICIAL_ZERO_RESULTS",
      message: localized(
        "Verified official-store search completed but returned no candidate for this visual description.",
        "已完成品牌官网搜索，但没有找到符合该视觉描述的候选商品。"
      ),
      ...(official.sourceHost === undefined ? {} : { sourceHost: official.sourceHost })
    };
  }
  return fallbackCode === "NO_CATALOG_CANDIDATES"
    ? {
        code: fallbackCode,
        message: localized(
          "No eligible product candidates were returned for this brand and product family.",
          "当前品牌和商品大类没有返回可用候选商品。"
        )
      }
    : fallbackCode === "NO_LOADABLE_IMAGES"
    ? {
        code: fallbackCode,
        message: localized(
          "Candidate image loading failed; the uploaded reference image was accepted. This is not a reference-image safety rejection.",
          "候选商品图片加载失败；上传的参考图片已接受，并非参考图片被安全规则拒绝。"
        )
      }
    : {
        code: fallbackCode,
        message: localized(
          "Candidates were found, but every reviewed image had a visible non-occluded conflict.",
          "已找到候选商品，但所有已检查图片都存在清晰且未被遮挡的冲突。"
        )
      };
}

function searchTraceMeta(execution: UnifiedSearchExecution, outcome: SearchOutcome,
  counts: Parameters<typeof searchDiagnostics>[2] = {}) {
  const trace = { ...searchDiagnostics(execution, outcome, counts), buildVersion: FINDCHEAP_VERSION };
  process.stderr.write(`[findcheap-search-trace] ${JSON.stringify(trace)}\n`);
  return { "findcheap/searchTrace": trace };
}

const MembershipIdsSchema = z
  .array(z.string().trim().min(1).max(80))
  .max(20)
  .refine((values) => new Set(values).size === values.length, {
    message: "membershipIds must contain unique values"
  });

const ShopifyProductsToolInputSchema = z.object({
  query: z.string().trim().min(2).max(300).regex(/^[\p{L}\p{N}\s._+'-]+$/u),
  limit: z.number().int().min(1).max(3).default(3),
  maxItemPriceCents: z.number().int().min(1).max(100_000_000).optional()
    .describe("Inclusive public item-price ceiling in integer USD cents. Keep price words and currency symbols out of query."),
  zipCode: z.string().regex(/^\d{5}(?:-\d{4})?$/u).optional()
    .describe("Optional US delivery ZIP. Enables a bounded tokenless Shopify Cart estimate when the merchant supports it."),
  membershipIds: MembershipIdsSchema.optional()
    .describe("Optional memberships. Member price remains unavailable unless the merchant source verifies it."),
  comparisonMode: z.enum(["DISCOVERY", "SAME_PRODUCT"])
    .describe("Use SAME_PRODUCT only for an explicit like-for-like comparison request; use DISCOVERY otherwise."),
  selectionMode: z.enum(["LOWEST_PRICE", "MERCHANT_DIVERSE"])
    .describe("Use LOWEST_PRICE only for an explicit cheapest request; use MERCHANT_DIVERSE otherwise.")
}).strict();

const AwinProductsToolInputSchema = z.object({
  query: z.string().trim().min(2).max(300).regex(/^[\p{L}\p{N}\s._+'-]+$/u)
    .refine((value) => /[\p{L}\p{N}]/u.test(value), "query must contain a letter or number"),
  limit: z.number().int().min(1).max(3).default(3),
  maxItemPriceCents: z.number().int().min(1).max(100_000_000).optional()
    .describe("Inclusive Awin Feed item-price ceiling in integer USD cents. Keep price words and currency symbols out of query.")
}).strict();

export const ShopifyProductsInputSchema = ShopifyProductsToolInputSchema;

const RenderIdSchema = z.string().uuid()
  .describe("Immutable renderId returned by the prior product search.");
const ZipCodeSchema = z.string().regex(/^\d{5}(?:-\d{4})?$/u);

function validateSingleProductSelector(
  value: { selectionId?: string | undefined; position?: number | undefined; variantId?: string | undefined },
  context: z.RefinementCtx
): void {
  const validSelectionIdReference = value.selectionId !== undefined && value.position === undefined;
  const validSnapshotReference = value.selectionId === undefined &&
    (value.position === undefined) !== (value.variantId === undefined);
  if (!validSelectionIdReference && !validSnapshotReference) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "provide exactly one product selector" });
  }
}

const ShopifySelectedQuoteInputSchema = z.object({
  renderId: RenderIdSchema,
  selectionId: SelectionIdSchema.optional(),
  position: ProductPositionSchema.optional(),
  variantId: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/u).optional(),
  zipCode: ZipCodeSchema,
  responseLocale: z.enum(["en-US", "zh-CN"]).optional()
}).strict().superRefine((value, context) => {
  // A renderId-only quote may resolve exactly one synchronized UI choice.
  if (value.selectionId !== undefined || value.position !== undefined || value.variantId !== undefined) {
    validateSingleProductSelector(value, context);
  }
});

const ProductComparisonOptionsSchema = ProductComparisonInputSchema.omit({ selectionIds: true });
const ProductComparisonToolInputSchema = ProductComparisonOptionsSchema.extend({
  renderId: RenderIdSchema,
  selectionIds: ProductComparisonInputSchema.shape.selectionIds.optional()
}).strict();

const QuotedProductComparisonOptionsSchema = ProductComparisonOptionsSchema.extend({ zipCode: ZipCodeSchema });
const QuotedProductComparisonInputSchema = QuotedProductComparisonOptionsSchema.extend({
  renderId: RenderIdSchema,
  // Zero/one choices receive a precise routing error; only 2–4 reach comparison or consent.
  selectionIds: z.array(SelectionIdSchema).max(4).refine(ids => new Set(ids).size === ids.length,
    { message: "selectionIds must contain unique values" }).optional()
}).strict();

export const VisualCandidateSearchInputSchema = SearchProductsInputSchema
  .omit({ limit: true })
  .extend({ visualInput: VisualProductInputSchema });

const VisualCandidateDescriptorShape = z.object({
  candidateId: z.string().uuid(),
  title: z.string(),
  merchant: z.string(),
  source: z.enum(["AWIN_PRODUCT_FEED", "SHOPIFY_GLOBAL_CATALOG", "EBAY_BROWSE", "WOOCOMMERCE_STORE_API"]),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"])
}).strict();

const VisualCandidateOutputShape = {
  status: z.enum(["OK", "NEEDS_CLARIFICATION", "NO_IMAGE_CANDIDATES", "DATA_SOURCE_UNAVAILABLE"]),
  message: z.string(),
  visualSessionId: VisualSessionIdSchema.optional(),
  expiresAt: z.string().optional(),
  renderId: z.string().uuid().optional(),
  goalId: z.string().uuid().optional(),
  goalRevision: z.number().int().positive().optional(),
  recovery: TextSearchRecoverySchema.optional(),
  visualSearchOutcome: VisualSearchOutcomeSchema.optional(),
  candidates: z.array(VisualCandidateDescriptorShape).max(MAX_VISUAL_CANDIDATES),
  workflow: z.object({
    state: z.literal("REVIEW_REQUIRED"),
    finalAnswerAllowed: z.literal(false),
    requiredNextTool: z.literal("finalize_visual_search")
  }).strict().optional(),
  visualSearchFailure: z.object({
    code: z.enum(["OFFICIAL_SOURCE_UNAVAILABLE", "OFFICIAL_ZERO_RESULTS", "NO_CATALOG_CANDIDATES", "NO_LOADABLE_IMAGES", "IMAGE_PROCESSING_LIMIT", "CANDIDATES_CONFLICTED", "VISUAL_EVIDENCE_INSUFFICIENT", "SEARCH_BUDGET_EXHAUSTED"]),
    message: z.string(),
    sourceHost: z.string().optional()
  }).strict().optional()
};

export const FinalizeVisualSearchInputSchema = z.object({
  visualSessionId: VisualSessionIdSchema,
  verdicts: z.array(z.object({
    candidateId: z.string().uuid(),
    verdict: CodexVisualVerdictSchema
  }).strict()).min(1).max(MAX_VISUAL_CANDIDATES)
    .refine(
      (entries) => new Set(entries.map((entry) => entry.candidateId)).size === entries.length,
      "candidate IDs must be unique"
    )
}).strict();

const DealConciergeOptionsShape = {
  zipCode: z.string().regex(/^\d{5}(?:-\d{4})?$/u).optional(),
  membershipIds: MembershipIdsSchema.optional(),
  objective: z.enum(["CURRENT_DEALS", "CHEAPEST_PATH"]).default("CURRENT_DEALS")
};
const DealConciergeInputSchema = z.object({
  responseLocale: z.enum(["en-US", "zh-CN"]).optional(),
  renderId: RenderIdSchema,
  selectionId: SelectionIdSchema.optional(),
  position: ProductPositionSchema.optional(),
  ...DealConciergeOptionsShape
}).strict().superRefine((value, context) => {
  if (value.selectionId !== undefined || value.position !== undefined) {
    validateSingleProductSelector(value, context);
  }
});

const DealConciergeOutputShape = {
  locale: z.enum(["en-US", "zh-CN"]).optional(),
  renderId: RenderIdSchema.optional(),
  status: z.enum(["OK", "SELECTION_UNAVAILABLE"]),
  message: z.string(),
  selectionId: SelectionIdSchema.optional(),
  selectionSource: z.enum(["UI", "EXPLICIT"]).optional(),
  selectionRevision: z.number().int().min(0).optional(),
  reasonCode: z.enum(["DEAL_SELECTION_NOT_SYNCED", "DEAL_SELECTION_EMPTY", "DEAL_MULTIPLE_SELECTIONS",
    "DEAL_REFERENCE_UNAVAILABLE", "DEAL_REFERENCE_EXPIRED"]).optional(),
  selectedProduct: z.object({
    merchantId: z.string(),
    merchant: z.string(),
    merchantProductId: z.string(),
    title: z.string(),
    availability: z.enum(["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"]),
    merchantUrl: z.string().url()
  }).strict().optional(),
  currentPrice: z.object({
    basis: z.enum(["ITEM_PRICE", "DELIVERED_TOTAL"]),
    amount: z.object({ amountCents: z.number().int(), currency: z.literal("USD") }),
    checkedAt: z.string()
  }).strict().optional(),
  quoteStatus: z.enum(["NOT_REQUESTED", "ESTIMATED", "UNAVAILABLE"]),
  dealStatus: z.enum(["CURRENT_DEAL_FOUND", "NO_CURRENT_DEAL", "DEAL_LOOKUP_UNAVAILABLE", "OUT_OF_STOCK", "CURRENT_PRICE_UNAVAILABLE"]).optional(),
  dealLookupStatus: DealLookupStatusSchema.optional(),
  dealLookupReasonCodes: z.array(DealLookupReasonSchema).optional(),
  dealSummary: DealSummarySchema.optional(),
  limitations: z.array(z.string()),
  deals: z.array(z.object({
    dealId: z.string(), merchant: z.string(), kind: z.string(), title: z.string(), description: z.string(),
    code: z.string().optional(), barcodeUrl: z.string().url().optional(), discountPercent: z.number().optional(),
    discountAmountCents: z.number().int().optional(), cashbackPercent: z.number().optional(), membershipProgram: z.string().optional(),
    productApplicability: z.enum(["PRODUCT_CONFIRMED", "MERCHANT_WIDE", "UNKNOWN"]).optional(),
    applicableProductIds: z.array(z.string()).optional(),
    eligibility: z.array(z.string()), channels: z.array(z.string()), sourceUrl: z.string().url(), checkedAt: z.string(),
    validFrom: z.string(), validTo: z.string(), verificationStatus: z.literal("VERIFIED"),
    applicability: z.enum(["PRODUCT_CONFIRMED", "REQUIRES_MERCHANT_CONFIRMATION"]),
    assessment: DealAssessmentSchema.optional()
  }).strict()),
  objective: z.enum(["CURRENT_DEALS", "CHEAPEST_PATH"]).optional()
};

function quoteFailureMessage(code: ShopifyQuoteFailureCode, locale = "en-US"): string {
  if (locale === "zh-CN") {
    const messages: Record<ShopifyQuoteFailureCode, string> = {
      QUOTE_POLICY_UNVERIFIED: "报价需要本次有效授权及已审核的匿名购物车接口；未授权新的购物车请求。请在商家结账页确认，不要自动重试。",
      FULL_ADDRESS_REQUIRED: "该商家不支持仅凭 ZIP 报价。不要在聊天中索取或发送街道地址；请在商家结账页确认最终总价，或选择其他现有卡片。",
      NO_DELIVERY_OPTIONS: "商家未返回适用于该 ZIP 的配送方式，未推算运费、税费或总价。请选择其他现有卡片，或在商家结账页确认。",
      MERCHANT_CART_UNAVAILABLE: "商家的购物车报价服务暂时不可用或不兼容；这不证明商品缺货或无效。请在商家结账页确认，不要自动重试。",
      VARIANT_REJECTED: "商家拒绝了该准确变体，可能暂不可购买、缺货或已下架；未搜索替代商品，也未推断其他变体状态。",
      QUOTE_TIMEOUT: "报价超时：商家未在期限内返回购物车报价。商品库存和报价能力保持不变；不要自动重试。"
    };
    return `[${code}] ${messages[code]}`;
  }
  switch (code) {
    case "QUOTE_POLICY_UNVERIFIED":
      return "[QUOTE_POLICY_UNVERIFIED] Quote unsupported without current user authorization and a reviewed anonymous Cart interface. No new Cart request was authorized; use merchant checkout. Do not retry without a new explicit user request.";
    case "FULL_ADDRESS_REQUIRED":
      return "[FULL_ADDRESS_REQUIRED] ZIP-only quoting is unavailable for this merchant. Do not ask for or send a street address in chat. Use merchant checkout for the final total or choose another existing card.";
    case "NO_DELIVERY_OPTIONS":
      return "[NO_DELIVERY_OPTIONS] This merchant returned no shipping method for the supplied ZIP. No shipping, tax, or total was inferred. Choose another existing card or check merchant checkout.";
    case "MERCHANT_CART_UNAVAILABLE":
      return "[MERCHANT_CART_UNAVAILABLE] This merchant's Cart quote service is currently unavailable or incompatible. This does not prove the product is out of stock or invalid. Retry later or check merchant checkout.";
    case "VARIANT_REJECTED":
      return "[VARIANT_REJECTED] The merchant rejected this exact Shopify variant. It may be unavailable, sold out, or no longer purchasable; no replacement product was searched.";
    case "QUOTE_TIMEOUT":
      return "[QUOTE_TIMEOUT] The merchant did not return a Cart quote before the deadline. Product availability was not changed; retry later.";
  }
}

const VariantDimensionsSchema = z.record(
  z.string().trim().min(1).max(100),
  z.string().trim().min(1).max(300)
).refine((value) => Object.keys(value).length <= 10, {
  message: "variantDimensions must contain at most 10 entries"
}).optional();
const ShopifySelectedProductInputSchema = z.object({
  renderId: RenderIdSchema,
  selectionId: SelectionIdSchema.optional(),
  position: ProductPositionSchema.optional(),
  variantId: z.string().regex(/^\d{1,30}$/u).optional(),
  variantDimensions: VariantDimensionsSchema,
  responseLocale: z.enum(["en-US", "zh-CN"]).optional()
}).strict().superRefine((value, context) => {
  if (value.selectionId !== undefined || value.position !== undefined || value.variantId !== undefined) {
    validateSingleProductSelector(value, context);
  }
});

const MoneyOutputSchema = z.object({
  amountCents: z.number().int(),
  currency: z.literal("USD")
});

const ShopifySelectedProductOutputShape = {
  status: z.enum(["OK", "NO_MATCHING_VARIANT"]),
  message: z.string(),
  sourceVariantId: z.string().regex(/^\d{1,30}$/u),
  merchant: z.string(),
  sourceHost: z.string(),
  productTitle: z.string(),
  canonicalProductUrl: z.string().url(),
  updatedSnapshot: z.lazy(() => _ShopifyProductsOutputSchemaObject).optional(),
  variants: z.array(z.object({
    variantId: z.string().regex(/^\d{1,30}$/u),
    title: z.string(),
    sku: z.string().optional(),
    variantDimensions: z.record(z.string(), z.string()),
    itemPrice: MoneyOutputSchema.optional(),
    availability: z.enum(["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"]),
    merchantUrl: z.string().url(),
    checkedAt: z.string(),
    quoteReference: z.object({
      selectionId: SelectionIdSchema,
      renderId: z.string().uuid(),
      variantId: z.string().regex(/^\d{1,30}$/u)
    }).strict()
  }).strict()).max(3)
};

const ShopifyProductOutputSchema = z.object({
  valueEvidence: ValueEvidenceSchema.optional(),
  unitPrice: UnitPriceSchema.optional(),
  qualityEvidence: QualityEvidenceSchema.optional(),
  sourceKind: z.enum(["AWIN_PRODUCT_FEED", "SHOPIFY_GLOBAL_CATALOG", "EBAY_BROWSE", "WOOCOMMERCE_STORE_API", "WEB_PRODUCT_PAGE"]).optional(),
  sourceEnvironment: z.enum(["PRODUCTION", "SANDBOX"]).optional(),
  affiliateState: z.enum(["APPROVED", "NONE"]).optional(),
  featureEvidence: z.array(z.string()).optional(),
  preferenceEvidence: z.array(z.string()).optional(),
  requiredFeatureLimitations: z.array(z.string()).optional(),
  requirementAssessment: RequirementAssessmentSchema.optional(),
  requirementAssessmentScope: z.literal("TYPED_REQUIREMENTS").optional(),
  coffeeCompatibility: z.object({ status: z.enum(["NOT_APPLICABLE", "MATCHED", "UNKNOWN", "CONTRADICTED"]),
    evidence: z.string().max(240), requestedSystem: z.enum(COFFEE_SYSTEMS).optional(),
    observedSystems: z.array(z.enum(COFFEE_SYSTEMS)).max(COFFEE_SYSTEMS.length) }).strict().optional(),
  requestIdentityStatus: z.enum(["CONFIRMED", "NEEDS_VERIFICATION"]).optional(),
  resultGroup: z.enum(["REQUESTED_PRODUCT", "DISCOVERY", "ALTERNATIVE"]).optional(),
  presentationGroup: z.enum(["OFFICIAL_STORE", "TRUSTED_MATCH", "BEST_VALUE", "RESEARCH_ONLY"]).optional(),
  displayFamilyKey: z.string().max(2048).optional(),
  visualMatchGroup: z.enum(["POSSIBLE_SAME_ITEM", "HIGHLY_SIMILAR", "SAME_STYLE"]).optional(),
  visualReviewRequired: z.boolean().optional(),
  visualReviewAssessment: z.object({
    group: z.enum(["POSSIBLE_SAME_ITEM", "HIGHLY_SIMILAR", "SAME_STYLE"]),
    structuralMatchCount: z.number().int().min(0).max(16),
    matchCount: z.number().int().min(0).max(16),
    recommendationScope: z.literal("SIMILAR").optional()
  }).strict().optional(),
  visualMatchEvidence: z.array(z.string()).optional(),
  merchantId: z.string(),
  merchant: z.string(),
  sellerName: z.string().optional(),
  sourceHost: z.string(),
  merchantTrust: z.object({
    level: z.enum(["OFFICIAL", "AUTHORIZED_RETAILER", "ESTABLISHED_RETAILER", "UNKNOWN", "RISKY"]),
    verification: z.enum(["INDEPENDENT", "UNVERIFIED"]),
    evidence: z.array(z.string()),
    reviewedAt: z.string().optional()
  }),
  recommendationTier: z.enum([
    "TRUSTED_OR_AFFILIATE",
    "HIGH_RATED_UNVERIFIED",
    "GENERAL_UNVERIFIED"
  ]).optional(),
  handle: z.string(),
  title: z.string(),
  productType: z.string().optional(),
  description: z.string().optional(),
  brand: z.string().optional(),
  sku: z.string().optional(),
  mpn: z.string().optional(),
  gtins: z.array(z.string()),
  variantDimensions: z.record(z.string(), z.string()),
  matchStatus: z.enum(["EXACT", "DISCOVERY_MATCH", "SIMILAR"]),
  matchEvidence: z.array(z.string()),
  condition: z.enum(["NEW", "USED", "REFURBISHED", "OPEN_BOX", "UNKNOWN"]),
  imageUrl: z.string().url().optional(),
  itemPrice: MoneyOutputSchema.optional(),
  availability: z.enum(["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"]),
  availableSizes: z.array(z.string().max(100)).max(100).optional(),
  availabilityScope: z.enum(["SELECTED_VARIANT", "PRODUCT_COLOR"]).optional(),
  merchantUrl: z.string().url(),
  checkedAt: z.string(),
  checkoutPlatform: z.enum(["SHOPIFY", "MERCHANT"]).optional(),
  productRating: z.object({
    value: z.number().min(0).max(5),
    count: z.number().int().nonnegative(),
    scaleMax: z.literal(5)
  }).optional(),
  cartQuote: z.object({
    status: z.literal("ESTIMATED"),
    subtotal: MoneyOutputSchema,
    shipping: MoneyOutputSchema.extend({ label: z.string() }),
    tax: z.discriminatedUnion("status", [
      z.object({
        status: z.literal("SHOPIFY_REPORTED"),
        amount: MoneyOutputSchema,
        shopifyEstimated: z.boolean(),
        source: z.literal("SHOPIFY_CART")
      }),
      z.object({
        status: z.literal("ZIP_ESTIMATED"),
        amount: MoneyOutputSchema,
        jurisdiction: z.string(),
        rateBasisPoints: z.number().int().nonnegative(),
        source: z.literal("TAX_FOUNDATION_STATE_AVERAGE_2026")
      })
    ]),
    deliveredPrice: MoneyOutputSchema,
    totalEstimated: z.boolean(),
    checkedAt: z.string(),
    expiresAt: z.string()
  }).optional(),
  pricing: z.object({
    scope: z.enum(["ITEM_PRICE_ONLY", "SHOPIFY_CART_ESTIMATE"]),
    regularItemPrice: z.object({
      status: z.enum(["VERIFIED", "UNAVAILABLE"]),
      amount: MoneyOutputSchema.optional(),
      reason: z.string().optional()
    }),
    memberPrice: z.object({ status: z.literal("UNAVAILABLE"), reason: z.string() }),
    shipping: z.object({
      status: z.enum(["ESTIMATED", "UNAVAILABLE"]),
      amount: MoneyOutputSchema.optional(),
      label: z.string().optional(),
      reason: z.string().optional()
    }),
    tax: z.object({
      status: z.enum(["VERIFIED", "ESTIMATED", "UNAVAILABLE"]),
      amount: MoneyOutputSchema.optional(),
      source: z.enum(["SHOPIFY_CART", "ZIP_STATE_AVERAGE_2026"]).optional(),
      jurisdiction: z.string().optional(),
      rateBasisPoints: z.number().int().nonnegative().optional(),
      reason: z.string()
    }),
    mandatoryFees: z.object({ status: z.literal("UNAVAILABLE"), reason: z.string() }),
    deliveredPrice: z.object({
      status: z.enum(["ESTIMATED", "UNAVAILABLE"]),
      amount: MoneyOutputSchema.optional(),
      reason: z.string(),
      checkedAt: z.string().optional(),
      expiresAt: z.string().optional()
    })
  }),
  freshness: z.object({ status: z.literal("OBSERVED_AT_QUERY"), checkedAt: z.string() }),
  coupons: z.object({
    status: z.enum(["VERIFIED", "UNAVAILABLE"]),
    lookupStatus: DealLookupStatusSchema.optional(),
    summary: DealSummarySchema.optional(),
    verified: z.array(z.object({
      dealId: z.string().optional(),
      title: z.string(),
      kind: z.enum(["COUPON", "PROMO_CODE", "BRAND_PROMOTION"]),
      code: z.string().optional(),
      discountPercent: z.number().min(0).max(100).optional(),
      discountAmount: MoneyOutputSchema.optional(),
      productApplicability: z.enum(["PRODUCT_CONFIRMED", "MERCHANT_WIDE", "UNKNOWN"]),
      assessment: DealAssessmentSchema.optional(),
      eligibility: z.array(z.string()),
      validTo: z.string(),
      sourceUrl: z.string().url()
    })),
    estimatedItemPriceAfterCoupon: MoneyOutputSchema.optional()
  }),
  purchaseLink: z.object({
    kind: z.enum(["APPROVED_AFFILIATE", "CANONICAL"]),
    url: z.string().url(),
    providerName: z.string().optional(),
    disclosure: z.string().optional()
  }),
  card: z.object({
    title: z.string(),
    merchant: z.string(),
    sellerName: z.string().optional(),
    imageUrl: z.string().url().optional(),
    primaryPrice: MoneyOutputSchema.optional(),
    priceLabel: z.string(),
    itemPrice: MoneyOutputSchema.optional(),
    shippingLabel: z.string().optional(),
    taxPrice: MoneyOutputSchema.optional(),
    taxLabel: z.string().optional(),
    estimatedTotal: MoneyOutputSchema.optional(),
    couponLabel: z.string().optional(),
    matchBadge: z.enum(["EXACT", "DISCOVERY_MATCH", "SIMILAR"]),
    conditionBadge: z.enum(["NEW", "USED", "REFURBISHED", "OPEN_BOX", "UNKNOWN"]),
    availability: z.enum(["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"]),
    merchantTrustBadge: z.enum([
      "OFFICIAL",
      "AUTHORIZED_RETAILER",
      "ESTABLISHED_RETAILER",
      "TRUSTED_MERCHANT",
      "SHOPIFY_HIGH_RATED",
      "PRODUCT_HIGH_RATED",
      "MERCHANT_UNVERIFIED"
    ]),
    quoteCapability: z.enum(["DELIVERED_TOTAL_SUPPORTED", "ZIP_ESTIMATE_ONLY", "MERCHANT_CHECKOUT_ONLY", "NOT_CHECKED"]),
    actionLabel: z.literal("View at merchant")
  }),
  selectionId: SelectionIdSchema.optional(),
  quoteCapability: z.enum(["DELIVERED_TOTAL_SUPPORTED", "ZIP_ESTIMATE_ONLY", "MERCHANT_CHECKOUT_ONLY", "NOT_CHECKED"]),
  quoteReference: z.object({
    selectionId: SelectionIdSchema,
    renderId: z.string().uuid(),
    variantId: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/u)
  }).strict().optional()
});

const QuoteOperationSchema = z.object({
  renderId: z.string().uuid(), selectionId: SelectionIdSchema,
  selectionSource: z.enum(["UI", "EXPLICIT"]), selectionRevision: z.number().int().positive().optional()
}).strict();
const ShopifyProductsOutputShape = {
  quoteOperation: QuoteOperationSchema.optional(),
  recovery: TextSearchRecoverySchema.optional(),
  sourceFailures: z.array(z.object({
    source: z.enum(["AWIN", "SHOPIFY", "EBAY", "WOOCOMMERCE", "OFFICIAL"]),
    kind: z.enum(["INVALID_QUERY", "SOURCE_REJECTED", "TIMEOUT", "RATE_LIMITED", "UPSTREAM_ERROR", "CONNECTION_FAILED", "SCHEMA_INVALID", "SECURITY_REJECTED", "BUDGET_EXHAUSTED", "UNSUPPORTED", "UNKNOWN"]),
    phase: z.enum(["DNS", "REQUEST", "BODY"]).optional(),
    retryable: z.boolean(),
    scope: z.enum(["SOURCE", "SEARCH"]).optional(),
    validation: SourceValidationDetailsSchema.optional()
  }).strict()).max(40).optional(),
  renderId: z.string().uuid().optional(),
  requirementsVersion: z.number().int().positive().optional(),
  goalId: z.string().uuid().optional(),
  goalRevision: z.number().int().positive().optional(),
  requirementLedger: z.array(z.object({
    field: z.enum(["requiredFeatures", "excludedFeatures", "preferences", "primaryUse", "brand", "requiredSize", "maxItemPriceCents"]),
    value: z.string().max(160), strength: z.enum(["REQUIRED", "EXCLUDED", "PREFERRED"]),
    origin: z.literal("REQUEST_FIELD")
  }).strict()).max(40).optional(),
  retrieval: z.object({
    extent: z.literal("BOUNDED"), satisfied: z.number().int().nonnegative(),
    awaitingVerification: z.number().int().nonnegative(), termination: z.string().max(80)
  }).strict().optional(),
  requirementsSummary: z.object({
    productType: z.string().optional(), brand: z.string().optional(),
    maxItemPriceCents: z.number().int().positive().optional(), requiredSize: z.string().optional(),
    requiredFeatures: z.array(z.string()), excludedFeatures: z.array(z.string()),
    primaryUse: z.string().optional(), preferences: z.array(z.string()).optional()
  }).strict().optional(),
  traceId: z.string().uuid().optional(),
  locale: z.enum(["en-US", "zh-CN"]).optional(),
  status: z.enum(["OK", "NEEDS_CLARIFICATION", "DATA_SOURCE_UNAVAILABLE"]),
  message: z.string(),
  source: z.enum(["SHOPIFY_GLOBAL_CATALOG", "UNIFIED_PRODUCT_SEARCH"]),
  sources: z.object({
    awin: z.enum(["SKIPPED", "COMPLETE", "UNAVAILABLE"]),
    shopify: z.enum(["SKIPPED", "COMPLETE", "PARTIAL", "UNAVAILABLE"]),
    ebay: z.enum(["SKIPPED", "COMPLETE", "UNAVAILABLE"]),
    woocommerce: z.enum(["SKIPPED", "COMPLETE", "PARTIAL", "UNAVAILABLE"]).optional(),
    web: z.enum(["COMPLETE", "PARTIAL"]).optional()
  }).optional(),
  searchIntent: z.enum(["EXACT_PRODUCT", "CATEGORY_DISCOVERY", "VISUAL_DISCOVERY"]).optional(),
  shopifyCoverage: z.object({ scope: z.literal("RETURNED_PAGES"), hasMoreResults: z.boolean().optional(),
    passes: z.array(z.object({ pass: z.union([z.literal(1), z.literal(2)]), operation: z.enum(["QUERY", "CONTINUATION", "NO_INCREMENT"]),
      coverage: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]), returnedProducts: z.number().int().nonnegative(),
      hasNextPage: z.boolean().optional(), estimatedTotalCount: z.number().int().nonnegative().optional() }).strict()).max(2)
  }).strict().optional(),
  woocommerceCoverage: WooSearchResultSchema.pick({ schemaVersion: true, registryVersion: true, status: true, stores: true, diagnostics: true }).extend({
    scope: z.literal("LAST_PASS").optional(),
    passes: z.array(WooSearchResultSchema.pick({ registryVersion: true, status: true, stores: true, diagnostics: true })
      .extend({ pass: z.union([z.literal(1), z.literal(2)]) })).max(2).optional(),
    cumulative: z.object({ scope: z.literal("CURRENT_SEARCH"), eligibleStores: z.number().int().nonnegative(),
      attemptedMerchantIds: z.array(z.string()).max(12), completedMerchantIds: z.array(z.string()).max(12),
      attemptedStorePasses: z.number().int().nonnegative().max(12).optional(), failedStorePasses: z.number().int().nonnegative().max(12).optional(),
      physicalRequests: z.number().int().nonnegative(), responseBytes: z.number().int().nonnegative(),
      registryCoverageComplete: z.boolean() }).strict().optional()
  }).optional(),
  sourceErrors: z.object({
    awin: z.literal("DATA_SOURCE_UNAVAILABLE").optional(),
    shopify: z.enum(["CATALOG_SCHEMA_CHANGED", "DATA_SOURCE_UNAVAILABLE"]).optional(),
    ebay: z.literal("DATA_SOURCE_UNAVAILABLE").optional(),
    woocommerce: z.literal("DATA_SOURCE_UNAVAILABLE").optional()
  }).strict().optional(),
  priceScope: z.enum(["ITEM_PRICE_ONLY", "SHOPIFY_CART_ESTIMATE", "MIXED"]),
  cartQuoteCoverage: z.object({
    attempted: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative()
  }),
  pricingContext: z.object({
    zipCode: z.string().optional(),
    membershipIds: z.array(z.string())
  }),
  quality: z.object({
    status: z.enum(["PASS", "PASS_WITH_LIMITATIONS"]),
    cardsReturned: z.number().int().nonnegative(),
    itemPricesVerified: z.number().int().nonnegative(),
    couponsVerified: z.number().int().nonnegative(),
    affiliateLinksApproved: z.number().int().nonnegative(),
    limitations: z.array(z.string())
  }),
  coverage: z.enum(["COMPLETE", "PARTIAL", "NOT_QUERIED", "UNAVAILABLE"]),
  merchantsQueried: z.number().int(),
  merchantsSucceeded: z.number().int(),
  maxItemPriceCents: z.number().int().positive().optional(),
  recommendation: z.object({
    state: z.enum(["READY", "MATCHES_AVAILABLE", "NEEDS_CLARIFICATION", "RESEARCH_ONLY", "NO_MATCH"]),
    primarySelectionId: SelectionIdSchema.optional(),
    reasonCodes: z.array(z.enum(RECOMMENDATION_REASON_CODES)).max(3),
    question: z.string().optional()
  }).strict().optional(),
  comparison: z.object({
    status: z.enum(["SAME_PRODUCT", "DISCOVERY_ONLY", "NEEDS_CLARIFICATION", "UNAVAILABLE"]),
    identityType: z.enum(["GTIN", "BRAND_MPN", "UPID"]).optional(),
    evidence: z.array(z.string()),
    merchantCount: z.number().int().nonnegative(),
    offerCount: z.number().int().nonnegative()
  }),
  diagnostics: z.object({
    coverageScope: z.literal("RETURNED_PAGE").optional(),
    apiDurationMs: z.number().int().nonnegative(),
    cacheStatus: z.enum(["MISS", "HIT", "COALESCED"]),
    chromeFallbackEligible: z.boolean(),
    queryAttempts: z.number().int().min(0).max(2),
    fallbackQueryUsed: z.boolean(),
    catalogProductsReturned: z.number().int().nonnegative(),
    catalogVariantsReturned: z.number().int().nonnegative(),
    catalogZeroResultAttempts: z.number().int().nonnegative(),
    malformedCatalogProductsExcluded: z.number().int().nonnegative().optional(),
    outOfStockProductsExcluded: z.number().int().nonnegative(),
    identityProductsExcluded: z.number().int().nonnegative(),
    irrelevantProductsExcluded: z.number().int().nonnegative(),
    conditionProductsExcluded: z.number().int().nonnegative(),
    priceProductsExcluded: z.number().int().nonnegative(),
    featureProductsExcluded: z.number().int().nonnegative().optional(),
    brandProductsExcluded: z.number().int().nonnegative().optional(),
    visualProductsExcluded: z.number().int().nonnegative().optional(),
    trustedMerchantProductsReturned: z.number().int().nonnegative(),
    unverifiedMerchantProductsReturned: z.number().int().nonnegative(),
    unverifiedMerchantProductsExcluded: z.number().int().nonnegative(),
    riskyMerchantProductsExcluded: z.number().int().nonnegative(),
    merchantTrustRegistryVersion: z.string(),
    merchantsFailed: z.number().int().nonnegative(),
    coveragePercent: z.number().int().min(0).max(100),
    failedMerchantIds: z.array(z.string()),
    timedOutMerchantIds: z.array(z.string()),
    registryVersion: z.string(),
    searchTimeoutMs: z.number().int().nonnegative(),
    selectionPolicy: z.enum([
      "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_PRICE",
      "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE"
    ])
  }),
  questions: z.array(z.string()),
  products: z.array(ShopifyProductOutputSchema).max(MAX_PRODUCT_CARDS),
  visualSearchOutcome: VisualSearchOutcomeSchema.optional(),
  visualReview: z.object({
    stage: z.enum(["POOL_REVIEW", "RELAXED_REVIEW"]),
    terminal: z.literal(false),
    finalAnswerAllowed: z.literal(false),
    requiredNextTool: z.literal("finalize_visual_search"),
    visualSessionId: VisualSessionIdSchema,
    expiresAt: z.string(),
    candidates: z.array(VisualCandidateDescriptorShape).min(1).max(MAX_VISUAL_CANDIDATES)
  }).strict().optional(),
  visualSearchFailure: z.object({
    code: z.enum(["OFFICIAL_SOURCE_UNAVAILABLE", "OFFICIAL_ZERO_RESULTS", "NO_CATALOG_CANDIDATES", "NO_LOADABLE_IMAGES", "IMAGE_PROCESSING_LIMIT", "CANDIDATES_CONFLICTED", "VISUAL_EVIDENCE_INSUFFICIENT", "SEARCH_BUDGET_EXHAUSTED"]),
    message: z.string(),
    sourceHost: z.string().optional()
  }).strict().optional()
};
const _ShopifyProductsOutputSchemaObject = z.object(ShopifyProductsOutputShape);

const AwinProductsOutputShape = {
  status: z.enum(["OK", "DATA_SOURCE_UNAVAILABLE"]),
  message: z.string(),
  source: z.literal("AWIN_PRODUCT_FEED"),
  coverage: z.enum(["COMPLETE", "UNAVAILABLE"]),
  snapshotAt: z.string().optional(),
  comparison: z.object({
    status: z.literal("DISCOVERY_ONLY"),
    evidence: z.array(z.string())
  }),
  diagnostics: z.object({
    feedRows: z.number().int().nonnegative(),
    validRows: z.number().int().nonnegative(),
    rejectedRows: z.number().int().nonnegative(),
    queryMatches: z.number().int().nonnegative(),
    priceProductsExcluded: z.number().int().nonnegative()
  }),
  products: z.array(z.object({
    merchantId: z.string(),
    merchant: z.string(),
    merchantProductId: z.string(),
    title: z.string(),
    category: z.string(),
    matchStatus: z.literal("DISCOVERY_MATCH"),
    matchEvidence: z.array(z.string()),
    condition: z.literal("UNKNOWN"),
    imageUrl: z.string().url().optional(),
    itemPrice: MoneyOutputSchema,
    availability: z.enum(["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"]),
    merchantUrl: z.string().url(),
    checkedAt: z.string(),
    purchaseLink: z.object({
      kind: z.literal("APPROVED_AFFILIATE"),
      providerName: z.literal("Awin"),
      url: z.string().url(),
      disclosure: z.string()
    })
  }))
};

function shopifyResult(
  result: ShopifySearchResult,
  context: { zipCode?: string | undefined; membershipIds?: string[] | undefined },
  affiliateLinks: AffiliateLinkResolver,
  cartQuoteCoverage: { attempted: number; succeeded: number } = { attempted: 0, succeeded: 0 }
) {
  const computedComparison = summarizeSearchProducts(result.products.map(product => ({ ...product, coupons: { verified: [] } }))).comparison;
  result = { ...result, comparison: reconcileComparison(result.comparison, computedComparison) };
  const linkedProducts = result.products.map((product) => ({
    product,
    purchaseLink: affiliateLinks.resolve({
      merchantId: product.merchantId,
      merchantUrl: product.merchantUrl,
      sourceHost: product.sourceHost
    })
  }));
  const affiliateLinksApproved = linkedProducts.filter(({ purchaseLink }) =>
    purchaseLink.kind === "APPROVED_AFFILIATE"
  ).length;
  const exactCount = result.products.filter((product) => product.matchStatus === "EXACT").length;
  const discoveryCount = result.products.filter((product) => product.matchStatus === "DISCOVERY_MATCH").length;
  const similarCount = result.products.filter((product) => product.matchStatus === "SIMILAR").length;
  const trustedCount = result.products.filter((product) => product.merchantTrust.verification === "INDEPENDENT").length;
  const highRatedUnverifiedCount = result.products.filter((product) =>
    product.recommendationTier === "HIGH_RATED_UNVERIFIED"
  ).length;
  const generalUnverifiedCount = result.products.filter((product) =>
    product.recommendationTier === "GENERAL_UNVERIFIED"
  ).length;
  const priceLimit = result.maxItemPriceCents === undefined
    ? ""
    : ` Maximum item price: USD ${(result.maxItemPriceCents / 100).toFixed(2)}.`;
  const comparison = result.comparison.status === "SAME_PRODUCT"
    ? ` Same-product comparison verified across ${result.comparison.merchantCount} merchants using ${result.comparison.evidence.join("; ")}.`
    : " No cross-merchant same-product identity was independently verified; results are discovery options, not like-for-like offers.";
  const linkSummary = "Purchase actions use direct merchant links. Commercial relationships never affect relevance or ranking.";
  const source = result.source;
  const sourceLabel = "Shopify Global Catalog";
  const priceScope = cartQuoteCoverage.succeeded === 0
    ? "ITEM_PRICE_ONLY" as const
    : cartQuoteCoverage.succeeded === result.products.length
      ? "SHOPIFY_CART_ESTIMATE" as const
      : "MIXED" as const;
  const quoteSummary = cartQuoteCoverage.attempted === 0
    ? "Prices are public item prices only; shipping, tax, mandatory fees, member price, delivered price, and verified coupons are unavailable without merchant evidence."
    : `${cartQuoteCoverage.succeeded}/${cartQuoteCoverage.attempted} products received a ZIP-specific Shopify Cart estimate. Tax uses Shopify totalTaxAmount only when explicitly returned; otherwise it is a labeled ZIP state-average estimate. Some merchants require a full address or checkout before calculating tax.`;
  const searchDiagnostics = `Search attempts: ${result.diagnostics.queryAttempts}; relaxed fallback: ${result.diagnostics.fallbackQueryUsed ? "USED" : "NOT_USED"}; Catalog products/variants: ${result.diagnostics.catalogProductsReturned}/${result.diagnostics.catalogVariantsReturned}; zero-result attempts: ${result.diagnostics.catalogZeroResultAttempts}; excluded out-of-stock/identity/condition/price/feature/unverified/risky: ${result.diagnostics.outOfStockProductsExcluded}/${result.diagnostics.identityProductsExcluded}/${result.diagnostics.conditionProductsExcluded}/${result.diagnostics.priceProductsExcluded}/${result.diagnostics.featureProductsExcluded ?? 0}/${result.diagnostics.unverifiedMerchantProductsExcluded}/${result.diagnostics.riskyMerchantProductsExcluded}.`;
  const trustSummary = `${trustedCount} trusted merchant card(s); ${highRatedUnverifiedCount} product card(s) qualify by a product rating above 3.8 with at least 2 reviews; ${generalUnverifiedCount} product card(s) come from merchants with limited trust evidence. Product ratings do not verify merchant trust.`;
  const chromeAdvice = result.products.length === 0 && result.diagnostics.chromeFallbackEligible
    ? " Shopify still returned no usable product; the user may authorize one bounded Chrome whole-web fallback."
    : "";
  const summary = `Comparison status: ${result.comparison.status}. ${sourceLabel} returned ${result.products.length} product card(s): ${exactCount} exact, ${discoveryCount} discovery, and ${similarCount} similar, from ${result.merchantsSucceeded}/${result.merchantsQueried} returned merchants. ${trustSummary}${priceLimit}${comparison} ${quoteSummary} ${linkSummary} ${searchDiagnostics}${chromeAdvice}`;
  const products = linkedProducts.map(({ product, purchaseLink }, index) => {
    const price = product.itemPrice === undefined
      ? "price unavailable"
      : `${product.itemPrice.currency} ${(product.itemPrice.amountCents / 100).toFixed(2)}`;
    const variants = Object.entries(product.variantDimensions)
      .map(([name, value]) => `${name}: ${value}`)
      .join(", ");
    const cartQuote = product.cartQuote;
    return [
      `${index + 1}. [${product.matchStatus}] ${product.title}`,
      `merchant: ${product.merchant} (${product.sourceHost})`,
      `merchant trust: ${product.merchantTrust.level} (${product.merchantTrust.verification})`,
      `merchant trust evidence: ${product.merchantTrust.evidence.join("; ")}`,
      ...(product.productRating === undefined
        ? []
        : [`product rating: ${product.productRating.value}/5 (${product.productRating.count} reviews)`]),
      `regular item price: ${price}`,
      cartQuote === undefined
        ? "shipping: unavailable | tax: unavailable | mandatory fees: unavailable | member price: unavailable | delivered price unavailable"
        : `shipping: ${cartQuote.shipping.amountCents === 0 ? "free shipping USD 0.00" : `${cartQuote.shipping.currency} ${(cartQuote.shipping.amountCents / 100).toFixed(2)} (${cartQuote.shipping.label})`} | tax: ${cartQuote.tax.status === "ZIP_ESTIMATED" ? `USD ${(cartQuote.tax.amount.amountCents / 100).toFixed(2)} ZIP state-average estimate (${cartQuote.tax.jurisdiction})` : `USD ${(cartQuote.tax.amount.amountCents / 100).toFixed(2)} explicitly returned by Shopify${cartQuote.tax.shopifyEstimated ? " as estimated" : ""}`} | estimated total: ${cartQuote.deliveredPrice.currency} ${(cartQuote.deliveredPrice.amountCents / 100).toFixed(2)} | expires: ${cartQuote.expiresAt}`,
      `availability: ${product.availability}`,
      `condition: ${product.condition}`,
      `match evidence: ${product.matchEvidence.join("; ")}`,
      ...(variants === "" ? [] : [`variants: ${variants}`]),
      `URL: ${purchaseLink.url}`
    ].join(" | ");
  });
  const message = [
    summary,
    ...products,
    "This response is complete. Do not call this tool again for this user lookup; format the answer from this response."
  ].join("\n");
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: {
      status: "OK" as const,
      message,
      source,
      priceScope,
      cartQuoteCoverage,
      pricingContext: {
        ...(context.zipCode === undefined ? {} : { zipCode: context.zipCode }),
        membershipIds: context.membershipIds ?? []
      },
      quality: {
        status: "PASS_WITH_LIMITATIONS" as const,
        cardsReturned: result.products.length,
        itemPricesVerified: result.products.filter((product) => product.itemPrice !== undefined).length,
        couponsVerified: 0,
        affiliateLinksApproved,
        limitations: [
          ...(cartQuoteCoverage.succeeded === result.products.length && result.products.length > 0
            ? ["tax may be a ZIP state-average estimate; some merchants require a full address or checkout"]
            : ["one or more delivered prices remain unavailable"]),
          "coupon source is unavailable",
          ...(affiliateLinksApproved === result.products.length
            ? []
            : ["one or more purchase links remain canonical merchant links"]),
          ...(highRatedUnverifiedCount === 0
            ? []
            : ["one or more products qualify by product rating above 3.8 with at least 2 reviews; this does not verify merchant trust"]),
          ...(generalUnverifiedCount === 0
            ? []
            : ["one or more merchants have limited trust evidence; verify seller identity, returns, and payment protection"])
        ]
      },
      coverage: result.coverage,
      merchantsQueried: result.merchantsQueried,
      merchantsSucceeded: result.merchantsSucceeded,
      ...(result.maxItemPriceCents === undefined ? {} : { maxItemPriceCents: result.maxItemPriceCents }),
      comparison: result.comparison,
      diagnostics: result.diagnostics,
      questions: result.questions,
      products: linkedProducts.map(({ product, purchaseLink }) => ({
        sourceKind: product.sourceKind ?? "SHOPIFY_GLOBAL_CATALOG" as const,
        affiliateState: purchaseLink.kind === "APPROVED_AFFILIATE" ? "APPROVED" as const : "NONE" as const,
        featureEvidence: [],
        ...product,
        pricing: {
          scope: product.cartQuote === undefined ? "ITEM_PRICE_ONLY" as const : "SHOPIFY_CART_ESTIMATE" as const,
          regularItemPrice: product.itemPrice === undefined
            ? { status: "UNAVAILABLE" as const, reason: "public item price was not returned" }
            : { status: "VERIFIED" as const, amount: product.itemPrice },
          memberPrice: { status: "UNAVAILABLE" as const, reason: "membership-specific price was not verified" },
          shipping: product.cartQuote === undefined
            ? { status: "UNAVAILABLE" as const, reason: "ZIP-specific shipping was not returned" }
            : {
                status: "ESTIMATED" as const,
                amount: {
                  amountCents: product.cartQuote.shipping.amountCents,
                  currency: product.cartQuote.shipping.currency
                },
                label: product.cartQuote.shipping.label
              },
          tax: product.cartQuote === undefined
            ? { status: "UNAVAILABLE" as const, reason: "ZIP-specific tax was not returned" }
            : product.cartQuote.tax.status === "ZIP_ESTIMATED"
              ? {
                  status: "ESTIMATED" as const,
                  amount: product.cartQuote.tax.amount,
                  source: "ZIP_STATE_AVERAGE_2026" as const,
                  jurisdiction: product.cartQuote.tax.jurisdiction,
                  rateBasisPoints: product.cartQuote.tax.rateBasisPoints,
                  reason: "ZIP-inferred state plus 2026 population-weighted average local rate; local and product-specific tax rules may differ"
                }
              : {
                  status: product.cartQuote.tax.shopifyEstimated ? "ESTIMATED" as const : "VERIFIED" as const,
                  amount: product.cartQuote.tax.amount,
                  source: "SHOPIFY_CART" as const,
                  reason: product.cartQuote.tax.shopifyEstimated
                    ? "Shopify explicitly returned totalTaxAmount and marked it estimated"
                    : "Shopify explicitly returned totalTaxAmount"
                },
          mandatoryFees: product.cartQuote === undefined
            ? { status: "UNAVAILABLE" as const, reason: "mandatory fees were not returned" }
            : { status: "UNAVAILABLE" as const, reason: "mandatory fees were not separately returned" },
          deliveredPrice: product.cartQuote === undefined
            ? { status: "UNAVAILABLE" as const, reason: "not all delivered-price components were returned" }
            : {
                status: "ESTIMATED" as const,
                amount: product.cartQuote.deliveredPrice,
                reason: product.cartQuote.tax.status === "ZIP_ESTIMATED"
                  ? "item subtotal plus selected shipping plus ZIP state-average estimated tax; final checkout total may change"
                  : "Shopify Cart total; final checkout total may change",
                checkedAt: product.cartQuote.checkedAt,
                expiresAt: product.cartQuote.expiresAt
              }
        },
        freshness: { status: "OBSERVED_AT_QUERY" as const, checkedAt: product.checkedAt },
        coupons: { status: "UNAVAILABLE" as const, verified: [] },
        purchaseLink,
        quoteCapability: product.checkoutPlatform === "MERCHANT"
          ? "MERCHANT_CHECKOUT_ONLY" as const
          : "DELIVERED_TOTAL_SUPPORTED" as const,
        card: {
          title: product.title,
          merchant: product.merchant,
          ...(product.imageUrl === undefined ? {} : { imageUrl: product.imageUrl }),
          ...(product.cartQuote !== undefined
            ? { primaryPrice: product.cartQuote.deliveredPrice }
            : product.itemPrice === undefined ? {} : { primaryPrice: product.itemPrice }),
          priceLabel: product.cartQuote !== undefined
            ? "Estimated total"
            : product.itemPrice === undefined ? "Item price unavailable" : "Verified item price",
          ...(product.cartQuote !== undefined
            ? { itemPrice: product.cartQuote.subtotal }
            : product.itemPrice === undefined ? {} : { itemPrice: product.itemPrice }),
          ...(product.cartQuote === undefined
            ? {}
            : {
                shippingLabel: product.cartQuote.shipping.amountCents === 0
                  ? "免费配送 $0.00"
                  : `${product.cartQuote.shipping.label} shipping $${(product.cartQuote.shipping.amountCents / 100).toFixed(2)}`,
                taxPrice: product.cartQuote.tax.amount,
                taxLabel: product.cartQuote.tax.status === "ZIP_ESTIMATED"
                  ? `Estimated tax (${product.cartQuote.tax.jurisdiction} ZIP state average ${(product.cartQuote.tax.rateBasisPoints / 100).toFixed(2)}%)`
                  : product.cartQuote.tax.shopifyEstimated ? "Shopify estimated tax" : "Shopify-reported tax",
                estimatedTotal: product.cartQuote.deliveredPrice
              }),
          matchBadge: product.matchStatus,
          conditionBadge: product.condition,
          availability: product.availability,
          merchantTrustBadge: product.merchantTrust.verification === "INDEPENDENT"
            ? product.merchantTrust.level as "OFFICIAL" | "AUTHORIZED_RETAILER" | "ESTABLISHED_RETAILER"
            : isHighRatedProduct(product.productRating)
              ? "SHOPIFY_HIGH_RATED" as const
              : "MERCHANT_UNVERIFIED" as const,
          quoteCapability: product.checkoutPlatform === "MERCHANT"
            ? "MERCHANT_CHECKOUT_ONLY" as const
            : "DELIVERED_TOTAL_SUPPORTED" as const,
          actionLabel: "View at merchant" as const
        }
      }))
    }
  };
}

export type ProductCardProduct = z.infer<typeof ShopifyProductOutputSchema>;
export type ProductCardContent = z.infer<typeof _ShopifyProductsOutputSchemaObject>;

function recommendationInstruction(content: ProductCardContent): string {
  const chinese = content.locale === "zh-CN";
  if (content.recommendation?.reasonCodes.includes("COFFEE_SYSTEM_UNVERIFIED")) return (chinese
    ? "已找到胶囊商品，但咖啡机系统兼容性尚未核实，暂不指定首选。"
    : "Coffee capsules were found, but machine-system compatibility is unverified; no primary recommendation is selected.") +
    (content.recommendation.question === undefined ? "" : ` ${content.recommendation.question}`);
  if (content.recommendation?.state === "MATCHES_AVAILABLE") return chinese
    ? "已有符合要求的高评分商品可供比较；评分不代表商家已独立核验，暂不指定首选。"
    : "Highly rated products meet the requirements and are available to compare; ratings do not independently verify merchants or establish a primary choice.";
  if (content.recommendation?.state === "READY" && content.recommendation.primarySelectionId !== undefined) {
    return chinese
      ? "服务器已在结构化结果中标出唯一首选；只能推荐该已返回卡片，且不要显示内部 ID。"
      : "The server marked one returned card as the only primary recommendation in structured data; recommend only that card and do not print internal IDs.";
  }
  return chinese
    ? "没有可安全推荐的首选商品；卡片仅供调研。"
    : "No safe primary recommendation is available; treat the cards as research only.";
}

function unifiedResult(
  execution: UnifiedSearchExecution,
  input: z.infer<typeof SearchProductsInputSchema>,
  shopifyResponse: ReturnType<typeof shopifyResult>,
  cartQuoteCoverage: { attempted: number; succeeded: number }
) {
  const shopifyCards = new Map<string, ProductCardProduct>(
    shopifyResponse.structuredContent.products.map((product) => [productReferenceKey(product), product])
  );
  const products = execution.candidates.flatMap((candidate) => {
    if (candidate.source === "WOOCOMMERCE_STORE_API") return [withVerifiedCoupons({ ...wooCardProduct(candidate), ...candidateValueOutput(candidate) }, candidate.verifiedCoupons, candidate.dealLookupStatus)];
    if (candidate.source === "AWIN_PRODUCT_FEED") {
      return [withVerifiedCoupons({ ...awinCardProduct(candidate), ...candidateValueOutput(candidate) }, candidate.verifiedCoupons, candidate.dealLookupStatus)];
    }
    if (candidate.source === "EBAY_BROWSE") {
      return [withVerifiedCoupons({ ...ebayCardProduct(candidate), ...candidateValueOutput(candidate) }, candidate.verifiedCoupons, candidate.dealLookupStatus)];
    }
    const card = shopifyCards.get(productReferenceKey(candidate.shopifyProduct));
    return card === undefined ? [] : [withVerifiedCoupons({
      ...card,
      ...candidateValueOutput(candidate),
      matchStatus: candidate.identityStatus,
      matchEvidence: candidate.identityEvidence,
      card: { ...card.card, matchBadge: candidate.identityStatus },
      sourceKind: candidate.shopifyProduct.sourceKind ?? "SHOPIFY_GLOBAL_CATALOG" as const,
      affiliateState: card.purchaseLink.kind === "APPROVED_AFFILIATE"
        ? "APPROVED" as const
        : "NONE" as const,
      featureEvidence: candidate.featureEvidence,
      preferenceEvidence: candidate.preferenceEvidence,
      requiredFeatureLimitations: candidate.requiredFeatureLimitations,
      requirementAssessment: candidate.requirementAssessment,
      coffeeCompatibility: candidate.coffeeCompatibility,
      resultGroup: candidate.resultGroup,
      presentationGroup: candidate.presentationGroup,
      ...(candidate.visualMatchGroup === undefined ? {} : {
        visualMatchGroup: candidate.visualMatchGroup,
        visualReviewAssessment: candidate.visualReviewAssessment,
        visualMatchEvidence: candidate.visualMatchEvidence ?? []
      }),
      recommendationTier: candidate.recommendationTier
    }, candidate.verifiedCoupons, candidate.dealLookupStatus)];
  });
  if (execution.searchIntent === "CATEGORY_DISCOVERY" && input.selectionMode === "MERCHANT_DIVERSE" && !input.compareMerchants) {
    for (const product of products) {
      const family = merchantVariantStyleKey(product);
      if (family !== undefined) product.displayFamilyKey = family;
    }
  }
  for (const product of products) if (product.requirementAssessment !== undefined) product.requirementAssessmentScope = "TYPED_REQUIREMENTS";
  const wooCoverage = wooSearchCoverage(execution);
  const shopifyCoverage = shopifySearchCoverage(execution);
  const wooMerchantsQueried = new Set([...(wooCoverage?.cumulative.attemptedMerchantIds ?? []), ...(wooCoverage?.cumulative.completedMerchantIds ?? [])]).size;
  const affiliateCount = products.filter((product) => product.affiliateState === "APPROVED").length;
  const itemPriceCount = products.filter((product) => product.itemPrice !== undefined).length;
  const couponCount = new Set(products.flatMap(product => product.coupons.verified.map(deal =>
    JSON.stringify([product.sourceHost.toLowerCase(), product.merchantId, deal.dealId])
  ))).size;
  const unavailableSource = Object.values(execution.sourceStatus).includes("UNAVAILABLE");
  const budgetExhausted = execution.searchRun?.diagnostics().budgetExhausted === true;
  const partialSource = Object.values(execution.sourceStatus).includes("PARTIAL") || budgetExhausted;
  const summary = summarizeSearchProducts(products);
  const highRatedUnverifiedCount = summary.highRatedQualifiedCount;
  const generalUnverifiedCount = products.filter((product) =>
    product.recommendationTier === "GENERAL_UNVERIFIED"
  ).length;
  const independentlyTrustedCount = products.filter((product) =>
    product.merchantTrust.verification === "INDEPENDENT" &&
    product.merchantTrust.level !== "UNKNOWN" &&
    product.merchantTrust.level !== "RISKY"
  ).length;
  const preferenceEvidenceCount = products.filter((product) =>
    (product.preferenceEvidence?.length ?? 0) > 0
  ).length;
  const { merchantCount, recommendation } = summary;
  const coverage = unavailableSource || partialSource ? "PARTIAL" as const : "COMPLETE" as const;
  const locale = input.responseLocale ?? (/\p{Script=Han}/u.test(input.query) ? "zh-CN" as const : "en-US" as const);
  const localized = (english: string, chinese: string) => locale === "zh-CN" ? chinese : english;
  const chromeAdvice = execution.searchIntent !== "VISUAL_DISCOVERY" && execution.chromeFallbackEligible
    ? searchFallbackExplanation(summary, input.compareMerchants === true, locale)
    : "";
  const sourceFailureMessage = execution.sourceErrors?.shopify === "CATALOG_SCHEMA_CHANGED"
    ? localized(
        "Shopify Catalog response schema changed and could not be safely parsed. No zero-result conclusion was made; retry after the connector is updated.",
        "Shopify Catalog 返回结构发生变化，当前无法安全解析，因此不能据此判断没有商品。连接器更新后可重试。"
      )
    : budgetExhausted || partialSource
      ? localized("Search coverage is incomplete. This does not establish product absence.", "检索尚不完整，不能据此判断商品不存在。")
    : unavailableSource
      ? localized(
          "A configured product source is unavailable. No zero-result conclusion was made.",
          "一个已配置的商品来源暂时不可用，因此不能据此判断没有商品。"
        )
      : "";
  const resultMessage = products.length === 0
    ? sourceFailureMessage || chromeAdvice || (execution.searchIntent === "EXACT_PRODUCT"
      ? localized(
          "No qualifying match for the requested product returned; unrelated alternatives were not substituted.",
          "没有找到符合要求的同款商品，也没有用无关替代品凑数。"
        )
      : execution.searchIntent === "VISUAL_DISCOVERY"
        ? localized(
            "No qualifying visual match returned. The image was not treated as proof of exact identity.",
            "没有找到证据足够的视觉匹配；图片本身不会被当作精确身份凭证。"
          )
        : localized("No qualifying product returned.", "没有找到符合要求的商品。"))
    : [
        recommendation.state === "READY"
          ? localized(
              `Found ${products.length} ranked product card(s) from ${merchantCount} merchant(s). Recommend only the backend-selected primary card and give no more than two evidence-backed reasons.`,
              `找到 ${products.length} 款排序后的商品，来自 ${merchantCount} 家商家。只推荐后端指定的首选卡片，并给出不超过两条有证据支持的理由。`
            )
          : recommendation.state === "MATCHES_AVAILABLE" ? localized(
              `Found ${summary.qualifiedMatchCount} requirement-matched high-rating option(s). Compare their verified item prices; no primary purchase recommendation has been selected.`,
              `找到 ${summary.qualifiedMatchCount} 款符合要求的高评分商品，可以比较已核实的商品价；暂不指定购买首选。`
            )
          : researchRecommendationMessage({ productCount: products.length, merchantCount,
              reasonCodes: recommendation.reasonCodes }, locale),
        ...(chromeAdvice === "" ? [] : [chromeAdvice]),
        ...(sourceFailureMessage === "" ? [] : [sourceFailureMessage]),
        ...(execution.searchIntent === "VISUAL_DISCOVERY"
          ? [localized(
              "Visual results are separated into possible same item, highly similar, and same style; none is an exact identity claim without a stable product identifier.",
              "视觉结果分为可能同款、高度相似和同风格；缺少稳定商品标识时，均不能声称精确同款。"
            )]
          : []),
        ...(highRatedUnverifiedCount === 0
          ? []
          : [localized(
              `${highRatedUnverifiedCount} later result(s) qualify by product rating above 3.8 with at least 2 reviews; product ratings do not verify merchant trust.`,
              `后续有 ${highRatedUnverifiedCount} 款商品因评分高于 3.8 且至少有 2 条评价而入选；商品评分不等于商家已被独立验证。`
            )]),
        ...(generalUnverifiedCount === 0
          ? []
          : [localized(
              `${generalUnverifiedCount} later result(s) come from merchants with limited trust evidence; verify seller identity, returns, and payment protection.`,
              `后续有 ${generalUnverifiedCount} 款商品的商家可信证据有限；购买前需核验卖家身份、退货政策和付款保障。`
            )]),
        ...(independentlyTrustedCount > 0 || summary.qualifiedMatchCount > 0
          ? []
          : [localized(
              "No returned merchant has independent trust evidence. Treat every card as a research lead only; do not recommend purchasing from one.",
              "返回商家均缺少独立可信证据。所有卡片仅作为调研线索，不要建议直接购买。"
            )]),
        ...(input.maxItemPriceCents === undefined
          ? []
          : [localized(
              "The maximum budget is a ceiling, not a spending target. Never prefer a higher price or higher specification without evidence that it better fits the requested use.",
              "最高预算是上限，不是需要花满的目标。没有使用场景证据时，不要偏爱更贵或参数更高的商品。"
            )]),
        ...(input.preferences.length === 0 || preferenceEvidenceCount > 0
          ? []
          : [localized(
              "No returned card independently verifies the requested preferences. Do not claim one is the best fit from specification or price alone.",
              "返回卡片没有独立验证用户偏好，不能只凭参数或价格声称最适合。"
            )]),
        ...(couponCount === 0 ? [] : [localized(
          `${couponCount} current Coupon or promotion result(s) are shown with product-applicability status on the ranked cards.`,
          `排序卡片已显示 ${couponCount} 条当前优惠券或促销，并标明是否确认适用于对应商品。`
        )]),
        localized(
          "Trust labels do not prove manufacturer authorization; never call a merchant authorized without explicit brand-authorization evidence.",
          "可信标签不等于品牌授权；没有明确的品牌授权证据时，不得称商家为授权零售商。"
        ),
        localized(
          "Use each card's quoteCapability: request ZIP only for DELIVERED_TOTAL_SUPPORTED or ZIP_ESTIMATE_ONLY; MERCHANT_CHECKOUT_ONLY requires checkout and no ZIP request.",
          "按卡片的报价能力处理：仅 DELIVERED_TOTAL_SUPPORTED 或 ZIP_ESTIMATE_ONLY 可询问 ZIP；MERCHANT_CHECKOUT_ONLY 需在结账页确认，不询问 ZIP。"
        ),
        localized(
          "Use the cards without repeating every field. End with one useful next step or limitation.",
          "结合卡片作答，不要重复所有字段；最后只给一个有用的下一步或限制。"
        )
      ].join(" ");
  const message = [resultMessage, wooRoutingExplanation(wooCoverage, locale)].filter(Boolean).join(" ");
  const dataUnavailable = products.length === 0 && (
    execution.sourceStatus.woocommerce === "UNAVAILABLE" ||
    execution.sourceStatus.shopify === "UNAVAILABLE" ||
    execution.sourceStatus.ebay === "UNAVAILABLE" ||
    (execution.sourceStatus.awin === "UNAVAILABLE" && execution.sourceStatus.shopify === "SKIPPED" && execution.sourceStatus.ebay === "SKIPPED")
  );
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: {
      ...shopifyResponse.structuredContent,
      locale,
      status: dataUnavailable ? "DATA_SOURCE_UNAVAILABLE" as const : "OK" as const,
      message,
      source: "UNIFIED_PRODUCT_SEARCH" as const,
      sources: execution.sourceStatus,
      ...(shopifyCoverage === undefined ? {} : { shopifyCoverage }),
      ...(wooCoverage === undefined ? {} : { woocommerceCoverage: wooCoverage }),
      merchantsQueried: shopifyResponse.structuredContent.merchantsQueried + wooMerchantsQueried,
      merchantsSucceeded: shopifyResponse.structuredContent.merchantsSucceeded + (wooCoverage?.cumulative.completedMerchantIds.length ?? 0),
      searchIntent: execution.searchIntent,
      ...(execution.sourceErrors === undefined ? {} : { sourceErrors: execution.sourceErrors }),
      recommendation: {
        state: recommendation.state,
        reasonCodes: recommendation.reasonCodes
      },
      coverage,
      priceScope: cartQuoteCoverage.succeeded === 0
        ? "ITEM_PRICE_ONLY" as const
        : cartQuoteCoverage.succeeded === products.length
          ? "SHOPIFY_CART_ESTIMATE" as const
          : "MIXED" as const,
      cartQuoteCoverage,
      quality: {
        status: unavailableSource || partialSource || products.length === 0 || products.some((product) =>
          product.condition === "UNKNOWN" || product.recommendationTier !== "TRUSTED_OR_AFFILIATE"
          || (product.requiredFeatureLimitations?.length ?? 0) > 0
        )
          ? "PASS_WITH_LIMITATIONS" as const
          : "PASS" as const,
        cardsReturned: products.length,
        itemPricesVerified: itemPriceCount,
        couponsVerified: couponCount,
        affiliateLinksApproved: affiliateCount,
        limitations: [
          ...(unavailableSource ? ["one configured source was unavailable"] : []),
          ...(budgetExhausted ? ["search budget exhausted; source coverage is incomplete"] : []),
          ...(products.length === 0 ? ["no qualifying product returned; source health is not match success"] : []),
          ...(products.some((product) => product.condition === "UNKNOWN")
            ? ["one or more product conditions are unverified"]
            : []),
          ...(products.some((product) => (product.requiredFeatureLimitations?.length ?? 0) > 0)
            ? ["one or more required product attributes lack enough evidence and are labeled DISCOVERY_MATCH"]
            : []),
          ...(products.some((product) => product.sourceKind === "AWIN_PRODUCT_FEED")
            ? ["Awin cards contain verified item price and feed availability only; shipping, tax, and delivered price are unavailable"]
            : []),
          ...(products.some((product) => product.sourceKind === "EBAY_BROWSE")
            ? ["eBay cards contain live fixed-price listing data only; seller identity, shipping, tax, fees, and delivered price require eBay checkout verification"]
            : []),
          ...(highRatedUnverifiedCount === 0
            ? []
            : ["one or more products qualify by product rating above 3.8 with at least 2 reviews; this does not verify merchant trust"]),
          ...(generalUnverifiedCount === 0
            ? []
            : ["one or more merchants have limited trust evidence; verify seller identity, returns, and payment protection"]),
          ...(independentlyTrustedCount > 0 || summary.qualifiedMatchCount > 0
            ? []
            : ["no returned merchant has independent trust evidence; cards are research leads, not purchase recommendations"]),
          ...(input.maxItemPriceCents === undefined
            ? []
            : ["maximum budget is an inclusive ceiling, not a spending target"]),
          ...(input.preferences.length === 0 || preferenceEvidenceCount > 0
            ? []
            : ["requested preferences were not independently verified by returned product evidence"])
        ]
      },
      comparison: summary.comparison,
      questions: execution.searchIntent === "EXACT_PRODUCT" && summary.identityUnverified > 0 && recommendation.state !== "READY"
        ? [localized("Please confirm the product edition or provide its official product link.", "请确认具体版本，或提供对应的官网商品链接。")]
        : [],
      diagnostics: {
        ...shopifyResponse.structuredContent.diagnostics,
        featureProductsExcluded: execution.featureProductsExcluded,
        brandProductsExcluded: execution.brandProductsExcluded,
        visualProductsExcluded: execution.visualProductsExcluded,
        identityProductsExcluded: shopifyResponse.structuredContent.diagnostics.identityProductsExcluded + execution.identityProductsExcluded,
        chromeFallbackEligible: execution.chromeFallbackEligible
      },
      products
    }
  };
}

function candidateValueOutput(candidate: UnifiedCandidate) {
  const product = candidateProductFacts(candidate);
  return { requestIdentityStatus: candidate.requestIdentityStatus,
    valueEvidence: candidate.valueEvidence, unitPrice: unitPriceEvidence(product),
    qualityEvidence: assessQualityEvidence({ productRating: "productRating" in product ? product.productRating : undefined }) };
}

function awinCardProduct(candidate: UnifiedCandidate): ProductCardProduct {
  const product = candidate.awinProduct;
  if (product === undefined) throw new Error("Awin candidate is missing its source product");
  const sourceHost = new URL(product.merchantUrl).hostname;
  const registeredTrust = resolveMerchantTrust(sourceHost, product.merchant);
  const merchantTrust = registeredTrust.verification === "INDEPENDENT"
    ? registeredTrust
    : {
        level: "ESTABLISHED_RETAILER" as const,
        verification: "INDEPENDENT" as const,
        evidence: ["approved Awin merchant manually verified by FindCheap"]
      };
  return {
    sourceKind: "AWIN_PRODUCT_FEED",
    affiliateState: "APPROVED",
    recommendationTier: candidate.recommendationTier,
    featureEvidence: candidate.featureEvidence,
    preferenceEvidence: candidate.preferenceEvidence,
    requiredFeatureLimitations: candidate.requiredFeatureLimitations,
    requirementAssessment: candidate.requirementAssessment,
    coffeeCompatibility: candidate.coffeeCompatibility,
    resultGroup: candidate.resultGroup,
    presentationGroup: candidate.presentationGroup,
    ...(candidate.visualMatchGroup === undefined ? {} : {
      visualMatchGroup: candidate.visualMatchGroup,
      visualReviewAssessment: candidate.visualReviewAssessment,
      visualMatchEvidence: candidate.visualMatchEvidence ?? []
    }),
    merchantId: product.merchantId,
    merchant: product.merchant,
    sourceHost,
    merchantTrust,
    handle: product.merchantProductId,
    title: product.title,
    gtins: [],
    variantDimensions: merchantReportedVariant({ ...product, sourceHost, handle: product.merchantProductId }),
    matchStatus: candidate.identityStatus,
    matchEvidence: product.matchEvidence,
    condition: product.condition,
    ...(product.imageUrl === undefined ? {} : { imageUrl: product.imageUrl }),
    itemPrice: product.itemPrice,
    availability: product.availability,
    merchantUrl: product.merchantUrl,
    checkedAt: product.checkedAt,
    pricing: {
      scope: "ITEM_PRICE_ONLY",
      regularItemPrice: { status: "VERIFIED", amount: product.itemPrice },
      memberPrice: { status: "UNAVAILABLE", reason: "membership-specific price was not provided by the Awin Feed" },
      shipping: { status: "UNAVAILABLE", reason: "shipping was not provided by the Awin Feed" },
      tax: { status: "UNAVAILABLE", reason: "tax was not provided by the Awin Feed" },
      mandatoryFees: { status: "UNAVAILABLE", reason: "mandatory fees were not provided by the Awin Feed" },
      deliveredPrice: { status: "UNAVAILABLE", reason: "shipping, tax, and fees were not provided by the Awin Feed" }
    },
    freshness: { status: "OBSERVED_AT_QUERY", checkedAt: product.checkedAt },
    coupons: { status: "UNAVAILABLE", verified: [] },
    purchaseLink: {
      kind: "APPROVED_AFFILIATE",
      providerName: "Awin",
      url: product.affiliateUrl,
      disclosure: "Affiliate link. FindCheap may earn a commission."
    },
    quoteCapability: "MERCHANT_CHECKOUT_ONLY",
    card: {
      title: product.title,
      merchant: product.merchant,
      ...(product.imageUrl === undefined ? {} : { imageUrl: product.imageUrl }),
      primaryPrice: product.itemPrice,
      priceLabel: "Verified item price",
      itemPrice: product.itemPrice,
      matchBadge: candidate.identityStatus,
      conditionBadge: product.condition,
      availability: product.availability,
      merchantTrustBadge: "TRUSTED_MERCHANT",
      quoteCapability: "MERCHANT_CHECKOUT_ONLY",
      actionLabel: "View at merchant"
    }
  };
}

function wooCardProduct(candidate: UnifiedCandidate): ProductCardProduct {
  if (candidate.source !== "WOOCOMMERCE_STORE_API") throw new Error("WooCommerce candidate is missing its source product");
  const product = wooProductFacts(candidate.woocommerceProduct);
  const unavailable = { status: "UNAVAILABLE" as const, reason: "not supplied by the public WooCommerce product API" };
  return {
    ...product, affiliateState: "NONE", recommendationTier: candidate.recommendationTier,
    featureEvidence: candidate.featureEvidence, preferenceEvidence: candidate.preferenceEvidence,
    requiredFeatureLimitations: candidate.requiredFeatureLimitations, requirementAssessment: candidate.requirementAssessment,
    coffeeCompatibility: candidate.coffeeCompatibility,
    requestIdentityStatus: candidate.requestIdentityStatus, resultGroup: candidate.resultGroup, presentationGroup: candidate.presentationGroup,
    ...(candidate.visualMatchGroup === undefined ? {} : { visualMatchGroup: candidate.visualMatchGroup,
      visualReviewAssessment: candidate.visualReviewAssessment, visualMatchEvidence: candidate.visualMatchEvidence ?? [] }),
    matchStatus: candidate.identityStatus, matchEvidence: candidate.identityEvidence,
    pricing: { scope: "ITEM_PRICE_ONLY", regularItemPrice: product.itemPrice ? { status: "VERIFIED", amount: product.itemPrice } : unavailable,
      memberPrice: unavailable, shipping: unavailable, tax: unavailable, mandatoryFees: unavailable, deliveredPrice: unavailable },
    freshness: { status: "OBSERVED_AT_QUERY", checkedAt: product.checkedAt }, coupons: { status: "UNAVAILABLE", verified: [] },
    purchaseLink: { kind: "CANONICAL", url: product.merchantUrl }, quoteCapability: "MERCHANT_CHECKOUT_ONLY",
    card: { title: product.title, merchant: product.merchant,
      ...(product.imageUrl === undefined ? {} : { imageUrl: product.imageUrl }),
      ...(product.itemPrice === undefined ? {} : { primaryPrice: product.itemPrice, itemPrice: product.itemPrice }),
      priceLabel: "Item price", matchBadge: candidate.identityStatus, conditionBadge: product.condition, availability: product.availability,
      merchantTrustBadge: product.merchantTrust.verification === "INDEPENDENT"
        ? product.merchantTrust.level as "OFFICIAL" | "AUTHORIZED_RETAILER" | "ESTABLISHED_RETAILER"
        : isHighRatedProduct(product.productRating) ? "PRODUCT_HIGH_RATED" : "MERCHANT_UNVERIFIED",
      quoteCapability: "MERCHANT_CHECKOUT_ONLY", actionLabel: "View at merchant" }
  };
}

function ebayCardProduct(candidate: UnifiedCandidate): ProductCardProduct {
  if (candidate.source !== "EBAY_BROWSE") throw new Error("eBay candidate is missing its source product");
  const product = candidate.ebayProduct;
  const purchaseUrl = product.affiliateUrl ?? product.merchantUrl;
  return {
    sourceKind: "EBAY_BROWSE",
    sourceEnvironment: product.environment,
    affiliateState: candidate.affiliateState,
    recommendationTier: "GENERAL_UNVERIFIED",
    featureEvidence: candidate.featureEvidence,
    preferenceEvidence: candidate.preferenceEvidence,
    requiredFeatureLimitations: candidate.requiredFeatureLimitations,
    requirementAssessment: candidate.requirementAssessment,
    coffeeCompatibility: candidate.coffeeCompatibility,
    resultGroup: candidate.resultGroup,
    presentationGroup: candidate.presentationGroup,
    ...(candidate.visualMatchGroup === undefined ? {} : {
      visualMatchGroup: candidate.visualMatchGroup,
      visualReviewAssessment: candidate.visualReviewAssessment,
      visualMatchEvidence: candidate.visualMatchEvidence ?? []
    }),
    merchantId: `ebay:${product.sellerName}`,
    merchant: "eBay",
    sellerName: product.sellerName,
    sourceHost: product.environment === "SANDBOX" ? "www.sandbox.ebay.com" : "www.ebay.com",
    merchantTrust: {
      level: "UNKNOWN",
      verification: "UNVERIFIED",
      evidence: [
        "listing supplied by the eBay Browse API",
        ...(product.sellerFeedbackPercentage === undefined
          ? []
          : [`eBay-reported seller feedback: ${product.sellerFeedbackPercentage}%`]),
        ...(product.sellerFeedbackScore === undefined
          ? []
          : [`eBay-reported seller feedback score: ${product.sellerFeedbackScore}`])
      ]
    },
    handle: product.productRef,
    title: product.title,
    productType: product.category,
    gtins: [],
    variantDimensions: {},
    matchStatus: candidate.identityStatus,
    matchEvidence: product.matchEvidence,
    condition: product.condition,
    ...(product.imageUrl === undefined ? {} : { imageUrl: product.imageUrl }),
    itemPrice: product.itemPrice,
    availability: product.availability,
    merchantUrl: product.merchantUrl,
    checkedAt: product.checkedAt,
    pricing: {
      scope: "ITEM_PRICE_ONLY",
      regularItemPrice: { status: "VERIFIED", amount: product.itemPrice },
      memberPrice: { status: "UNAVAILABLE", reason: "membership-specific price was not provided by eBay Browse" },
      shipping: { status: "UNAVAILABLE", reason: "shipping requires verification on the eBay listing or checkout" },
      tax: { status: "UNAVAILABLE", reason: "tax requires verification at eBay checkout" },
      mandatoryFees: { status: "UNAVAILABLE", reason: "mandatory fees require verification at eBay checkout" },
      deliveredPrice: { status: "UNAVAILABLE", reason: "shipping, tax, and fees require verification at eBay checkout" }
    },
    freshness: { status: "OBSERVED_AT_QUERY", checkedAt: product.checkedAt },
    coupons: { status: "UNAVAILABLE", verified: [] },
    purchaseLink: product.affiliateUrl === undefined
      ? { kind: "CANONICAL", url: purchaseUrl }
      : {
          kind: "APPROVED_AFFILIATE",
          providerName: "eBay Partner Network",
          url: purchaseUrl,
          disclosure: "As an eBay Partner, FindCheap may be compensated if you make a purchase."
        },
    quoteCapability: "MERCHANT_CHECKOUT_ONLY",
    card: {
      title: product.title,
      merchant: "eBay",
      sellerName: product.sellerName,
      ...(product.imageUrl === undefined ? {} : { imageUrl: product.imageUrl }),
      primaryPrice: product.itemPrice,
      priceLabel: "Live item price",
      itemPrice: product.itemPrice,
      matchBadge: candidate.identityStatus,
      conditionBadge: product.condition,
      availability: product.availability,
      merchantTrustBadge: "MERCHANT_UNVERIFIED",
      quoteCapability: "MERCHANT_CHECKOUT_ONLY",
      actionLabel: "View at merchant"
    }
  };
}

function withVerifiedCoupons(
  product: ProductCardProduct,
  deals: VerifiedDeal[],
  lookupStatus: "COMPLETE" | "PARTIAL" | "UNAVAILABLE" = "UNAVAILABLE"
): ProductCardProduct {
  const rankedDeals = rankAssessedDeals(deals.filter((deal): deal is VerifiedDeal & {
    kind: "COUPON" | "PROMO_CODE" | "BRAND_PROMOTION";
  } =>
    (deal.kind === "COUPON" || deal.kind === "PROMO_CODE" || deal.kind === "BRAND_PROMOTION") &&
    dealAppliesToProduct(deal, dealProductId(product))
  ).map((deal) => ({ ...deal, assessment: assessSelectedProductDeal(deal, {
    merchantProductId: dealProductId(product), title: product.title,
    ...(product.itemPrice === undefined ? {} : { itemPrice: product.itemPrice })
  }) })));
  const preferred = rankedDeals.find((deal) => deal.assessment.recommendationEligible);
  const summary = {
    status: preferred?.assessment.status === "CONFIRMED" ? "CONFIRMED_DEAL" as const
      : preferred !== undefined ? "MERCHANT_CANDIDATE" as const
        : lookupStatus !== "COMPLETE" ? "UNAVAILABLE" as const : "NO_ELIGIBLE_DEAL" as const,
    ...(preferred === undefined ? {} : { recommendedDealId: preferred.dealId }),
    reasonCodes: preferred?.assessment.reasonCodes ?? []
  };
  const coupons = rankedDeals.flatMap((deal) => {
    return [{
      dealId: deal.dealId,
      title: deal.title,
      kind: deal.kind,
      ...(deal.code === undefined ? {} : { code: deal.code }),
      ...(deal.discountPercent === undefined ? {} : { discountPercent: deal.discountPercent }),
      ...(deal.discountAmountCents === undefined
        ? {}
        : { discountAmount: { amountCents: deal.discountAmountCents, currency: "USD" as const } }),
      productApplicability: deal.assessment.status === "CONFIRMED" ? "PRODUCT_CONFIRMED" as const
        : deal.productApplicability === "MERCHANT_WIDE" ? "MERCHANT_WIDE" as const : "UNKNOWN" as const,
      assessment: deal.assessment,
      eligibility: deal.eligibility,
      validTo: deal.validTo,
      sourceUrl: deal.sourceUrl
    }];
  });
  if (coupons.length === 0) return { ...product, coupons: { ...product.coupons, lookupStatus, summary } };
  const first = coupons.find(deal => deal.dealId === summary.recommendedDealId);
  const couponValue = first === undefined ? undefined : first.code !== undefined
    ? first.code
    : first.discountPercent !== undefined
      ? `${first.discountPercent}% off`
      : first.discountAmount !== undefined
        ? `$${(first.discountAmount.amountCents / 100).toFixed(2)} off`
        : first.title;
  const couponLabel = first === undefined ? undefined : first.productApplicability === "PRODUCT_CONFIRMED"
    ? `Verified Coupon: ${couponValue}`
    : first.productApplicability === "MERCHANT_WIDE"
      ? `Merchant offer: ${couponValue}`
      : `Offer eligibility unconfirmed: ${couponValue}`;
  const estimatedPrice = product.itemPrice === undefined
    ? undefined
    : estimatedItemPriceAfterCoupon(product.itemPrice.amountCents,
      rankedDeals.filter((deal) => deal.assessment.status === "CONFIRMED"), dealProductId(product));
  return {
    ...product,
    coupons: {
      status: "VERIFIED",
      lookupStatus,
      summary,
      verified: coupons,
      ...(estimatedPrice === undefined
        ? {}
        : { estimatedItemPriceAfterCoupon: { amountCents: estimatedPrice, currency: "USD" as const } })
    },
    card: { ...product.card, couponLabel }
  };
}

function awinQuoteSeed(product: ProductCardProduct): AwinShopifyQuoteSeed {
  if (product.sourceKind !== "AWIN_PRODUCT_FEED" || product.itemPrice === undefined) {
    throw new ShopifyCartQuoteError("MERCHANT_CART_UNAVAILABLE");
  }
  return {
    merchantId: product.merchantId,
    merchant: product.merchant,
    merchantProductId: product.handle,
    title: product.title,
    sourceHost: product.sourceHost,
    merchantUrl: product.merchantUrl,
    itemPrice: product.itemPrice,
    availability: product.availability,
    checkedAt: product.checkedAt
  };
}

function withCartQuote(
  product: ProductCardProduct,
  cartQuote: ShopifyCartEstimate
): ProductCardProduct {
  const tax = cartQuote.tax.status === "ZIP_ESTIMATED"
    ? {
        status: "ESTIMATED" as const,
        amount: cartQuote.tax.amount,
        source: "ZIP_STATE_AVERAGE_2026" as const,
        jurisdiction: cartQuote.tax.jurisdiction,
        rateBasisPoints: cartQuote.tax.rateBasisPoints,
        reason: "ZIP-inferred state plus 2026 population-weighted average local rate; local and product-specific tax rules may differ"
      }
    : {
        status: cartQuote.tax.shopifyEstimated ? "ESTIMATED" as const : "VERIFIED" as const,
        amount: cartQuote.tax.amount,
        source: "SHOPIFY_CART" as const,
        reason: cartQuote.tax.shopifyEstimated
          ? "Shopify explicitly returned totalTaxAmount and marked it estimated"
          : "Shopify explicitly returned totalTaxAmount"
      };
  return {
    ...product,
    itemPrice: cartQuote.subtotal,
    checkedAt: cartQuote.checkedAt,
    cartQuote,
    pricing: {
      scope: "SHOPIFY_CART_ESTIMATE",
      regularItemPrice: { status: "VERIFIED", amount: cartQuote.subtotal },
      memberPrice: { status: "UNAVAILABLE", reason: "membership-specific price was not verified" },
      shipping: {
        status: "ESTIMATED",
        amount: {
          amountCents: cartQuote.shipping.amountCents,
          currency: cartQuote.shipping.currency
        },
        label: cartQuote.shipping.label
      },
      tax,
      mandatoryFees: { status: "UNAVAILABLE", reason: "mandatory fees were not separately returned" },
      deliveredPrice: {
        status: "ESTIMATED",
        amount: cartQuote.deliveredPrice,
        reason: cartQuote.tax.status === "ZIP_ESTIMATED"
          ? "item subtotal plus selected shipping plus ZIP state-average estimated tax; final checkout total may change"
          : "Shopify Cart total; final checkout total may change",
        checkedAt: cartQuote.checkedAt,
        expiresAt: cartQuote.expiresAt
      }
    },
    card: {
      ...product.card,
      primaryPrice: cartQuote.deliveredPrice,
      priceLabel: "Estimated total",
      itemPrice: cartQuote.subtotal,
      shippingLabel: cartQuote.shipping.amountCents === 0
        ? "免费配送 $0.00"
        : `${cartQuote.shipping.label} shipping $${(cartQuote.shipping.amountCents / 100).toFixed(2)}`,
      taxPrice: cartQuote.tax.amount,
      taxLabel: cartQuote.tax.status === "ZIP_ESTIMATED"
        ? `Estimated tax (${cartQuote.tax.jurisdiction} ZIP state average ${(cartQuote.tax.rateBasisPoints / 100).toFixed(2)}%)`
        : cartQuote.tax.shopifyEstimated ? "Shopify estimated tax" : "Shopify-reported tax",
      estimatedTotal: cartQuote.deliveredPrice
    }
  };
}

function emptyShopifySearchResult(
  input: z.infer<typeof SearchProductsInputSchema>
): ShopifySearchResult {
  return {
    source: "SHOPIFY_GLOBAL_CATALOG",
    coverage: "COMPLETE",
    merchantsQueried: 0,
    merchantsSucceeded: 0,
    ...(input.maxItemPriceCents === undefined ? {} : { maxItemPriceCents: input.maxItemPriceCents }),
    comparison: {
      status: "DISCOVERY_ONLY",
      evidence: ["Shopify source not needed or returned no qualifying product"],
      merchantCount: 0,
      offerCount: 0
    },
    diagnostics: {
      apiDurationMs: 0,
      cacheStatus: "MISS",
      chromeFallbackEligible: false,
      queryAttempts: 0,
      fallbackQueryUsed: false,
      catalogProductsReturned: 0,
      catalogVariantsReturned: 0,
      catalogZeroResultAttempts: 0,
      outOfStockProductsExcluded: 0,
      identityProductsExcluded: 0,
      irrelevantProductsExcluded: 0,
      conditionProductsExcluded: 0,
      priceProductsExcluded: 0,
      trustedMerchantProductsReturned: 0,
      unverifiedMerchantProductsReturned: 0,
      unverifiedMerchantProductsExcluded: 0,
      riskyMerchantProductsExcluded: 0,
      merchantTrustRegistryVersion: currentMerchantTrustRegistryVersion(),
      merchantsFailed: 0,
      coveragePercent: 100,
      failedMerchantIds: [],
      timedOutMerchantIds: [],
      registryVersion: "NOT_QUERIED",
      searchTimeoutMs: 0,
      selectionPolicy: input.selectionMode === "LOWEST_PRICE"
        ? "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_PRICE"
        : "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE"
    },
    questions: [],
    products: []
  };
}

function awinResult(result: AwinSearchResult) {
  const products = result.products.map((product) => ({
    merchantId: product.merchantId,
    merchant: product.merchant,
    merchantProductId: product.merchantProductId,
    title: product.title,
    category: product.category,
    matchStatus: product.matchStatus,
    matchEvidence: product.matchEvidence,
    condition: product.condition,
    ...(product.imageUrl === undefined ? {} : { imageUrl: product.imageUrl }),
    itemPrice: product.itemPrice,
    availability: product.availability,
    merchantUrl: product.merchantUrl,
    checkedAt: product.checkedAt,
    purchaseLink: {
      kind: "APPROVED_AFFILIATE" as const,
      providerName: "Awin" as const,
      url: product.affiliateUrl,
      disclosure: "Affiliate link: FindCheap may earn a commission; ranking is not commission-based."
    }
  }));
  const message = [
    `Awin Feed snapshot returned ${products.length}/${result.diagnostics.queryMatches} matching Amazonliss product(s) from ${result.diagnostics.validRows} valid rows.`,
    "All results are DISCOVERY_MATCH with condition UNKNOWN because GTIN, MPN, brand, and condition are absent. Item price and feed stock only; shipping, tax, coupons, and delivered price are unavailable.",
    ...products.map((product, index) =>
      `${index + 1}. [DISCOVERY_MATCH] ${product.title} | ${product.category} | USD ${(product.itemPrice.amountCents / 100).toFixed(2)} | ${product.availability} | condition UNKNOWN | ${product.purchaseLink.url}`
    )
  ].join("\n");
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: {
      status: "OK" as const,
      message,
      source: result.source,
      coverage: result.coverage,
      snapshotAt: result.snapshotAt,
      comparison: {
        status: "DISCOVERY_ONLY" as const,
        evidence: ["Awin Feed has merchant product IDs but no GTIN, MPN, brand, or condition"]
      },
      diagnostics: result.diagnostics,
      products
    }
  };
}

function awinUnavailableResult() {
  const message = "Approved Affiliate products are temporarily unavailable from the FindCheap Search API. Shopify discovery may still be used; no unverified Affiliate result was substituted.";
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: {
      status: "DATA_SOURCE_UNAVAILABLE" as const,
      message,
      source: "AWIN_PRODUCT_FEED" as const,
      coverage: "UNAVAILABLE" as const,
      comparison: {
        status: "DISCOVERY_ONLY" as const,
        evidence: ["Awin Product Feed unavailable"]
      },
      diagnostics: {
        feedRows: 0,
        validRows: 0,
        rejectedRows: 0,
        queryMatches: 0,
        priceProductsExcluded: 0
      },
      products: []
    }
  };
}

export type ShoppingServerDependencies = {
  taskState?: TaskStateStore;
  taskWatches?: (taskId: string) => WatchStore;
  taskLifecycle?: TaskLifecycleReader;
  webProducts?: WebProductPagePort;
  backend?: FindCheapBackend;
  awin?: AwinProductPort;
  ebay?: EbayBrowsePort;
  awinShopifyQuotes?: AwinShopifyQuoteResolver;
  deals?: DealPort;
  watches?: WatchStore;
  cartQuotes?: ShopifyCartQuotePort;
  selectedProducts?: ShopifySelectedProductInspector;
  officialShopify?: OfficialShopifySearchPort;
  officialStorefrontRegistry?: OfficialStorefrontRegistryPort;
  merchantTrustRegistry?: MerchantTrustRegistryPort;
  visualCandidateImages?: VisualCandidateImagePort;
  now?: () => Date;
  cardTelemetry?: ProductCardTelemetrySink;
  productCardResourceDomains?: readonly string[];
  toolAvailability?: {
    verifiedDeals: boolean;
  };
};

function emptyShopifyQuality() {
  return {
    status: "PASS_WITH_LIMITATIONS" as const,
    cardsReturned: 0,
    itemPricesVerified: 0,
    couponsVerified: 0,
    affiliateLinksApproved: 0,
    limitations: [
      "no product cards were returned",
      "coupon source is unavailable",
      "no purchase links were returned"
    ]
  };
}

function shopifyClarificationResult(
  selectionMode: "LOWEST_PRICE" | "MERCHANT_DIVERSE",
  context: {
    zipCode?: string | undefined;
    membershipIds?: string[] | undefined;
    responseLocale?: "en-US" | "zh-CN" | undefined;
    query?: string | undefined;
  },
  options: {
    question?: string;
    evidence?: string;
    source?: "SHOPIFY_GLOBAL_CATALOG" | "UNIFIED_PRODUCT_SEARCH";
  } = {}
) {
  const chinese = context.responseLocale === "zh-CN" ||
    (context.responseLocale === undefined && context.query !== undefined && /\p{Script=Han}/u.test(context.query));
  const question = options.question ?? (chinese
    ? "请提供品牌和准确型号、MPN、GTIN 或商品直达链接，再进行同款比价。"
    : "Provide a brand and exact model/MPN/GTIN, or a direct product URL, before requesting same-product comparison.");
  const message = chinese
    ? `需要补充信息（NEEDS_CLARIFICATION）：${question} 尚未查询商家 API，也不会启用 Chrome。`
    : `Needs clarification (NEEDS_CLARIFICATION): ${question} No merchant API was queried and Chrome is not eligible.`;
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: {
      status: "NEEDS_CLARIFICATION" as const,
      message,
      source: options.source ?? "SHOPIFY_GLOBAL_CATALOG" as const,
      recommendation: {
        state: "NEEDS_CLARIFICATION" as const,
        reasonCodes: [],
        question
      },
      priceScope: "ITEM_PRICE_ONLY" as const,
      cartQuoteCoverage: { attempted: 0, succeeded: 0 },
      pricingContext: {
        ...(context.zipCode === undefined ? {} : { zipCode: context.zipCode }),
        membershipIds: context.membershipIds ?? []
      },
      quality: emptyShopifyQuality(),
      coverage: "NOT_QUERIED" as const,
      merchantsQueried: 0,
      merchantsSucceeded: 0,
      comparison: {
        status: "NEEDS_CLARIFICATION" as const,
        evidence: [options.evidence ?? "specific product identity absent"],
        merchantCount: 0,
        offerCount: 0
      },
      diagnostics: {
        apiDurationMs: 0,
        cacheStatus: "MISS" as const,
        chromeFallbackEligible: false,
        queryAttempts: 0,
        fallbackQueryUsed: false,
        catalogProductsReturned: 0,
        catalogVariantsReturned: 0,
        catalogZeroResultAttempts: 0,
        outOfStockProductsExcluded: 0,
        identityProductsExcluded: 0,
        irrelevantProductsExcluded: 0,
        conditionProductsExcluded: 0,
        priceProductsExcluded: 0,
        trustedMerchantProductsReturned: 0,
        unverifiedMerchantProductsReturned: 0,
        unverifiedMerchantProductsExcluded: 0,
        riskyMerchantProductsExcluded: 0,
        merchantTrustRegistryVersion: currentMerchantTrustRegistryVersion(),
        merchantsFailed: 0,
        coveragePercent: 0,
        failedMerchantIds: [],
        timedOutMerchantIds: [],
        registryVersion: "NOT_QUERIED",
        searchTimeoutMs: 0,
        selectionPolicy: selectionMode === "LOWEST_PRICE"
          ? "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_PRICE" as const
          : "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE" as const
      },
      questions: [question],
      products: []
    }
  };
}

function shopifyUnavailableResult(
  selectionMode: "LOWEST_PRICE" | "MERCHANT_DIVERSE",
  context: { zipCode?: string | undefined; membershipIds?: string[] | undefined }
) {
  return {
    content: [{ type: "text" as const, text: shopifyUnavailableMessage }],
    structuredContent: {
      status: "DATA_SOURCE_UNAVAILABLE" as const,
      message: shopifyUnavailableMessage,
      source: "SHOPIFY_GLOBAL_CATALOG" as const,
      recommendation: { state: "NO_MATCH" as const, reasonCodes: [] },
      priceScope: "ITEM_PRICE_ONLY" as const,
      cartQuoteCoverage: { attempted: 0, succeeded: 0 },
      pricingContext: {
        ...(context.zipCode === undefined ? {} : { zipCode: context.zipCode }),
        membershipIds: context.membershipIds ?? []
      },
      quality: emptyShopifyQuality(),
      coverage: "UNAVAILABLE" as const,
      merchantsQueried: 0,
      merchantsSucceeded: 0,
      comparison: {
        status: "UNAVAILABLE" as const,
        evidence: [],
        merchantCount: 0,
        offerCount: 0
      },
      diagnostics: {
        apiDurationMs: 0,
        cacheStatus: "MISS" as const,
        chromeFallbackEligible: false,
        queryAttempts: 0,
        fallbackQueryUsed: false,
        catalogProductsReturned: 0,
        catalogVariantsReturned: 0,
        catalogZeroResultAttempts: 0,
        outOfStockProductsExcluded: 0,
        identityProductsExcluded: 0,
        irrelevantProductsExcluded: 0,
        conditionProductsExcluded: 0,
        priceProductsExcluded: 0,
        trustedMerchantProductsReturned: 0,
        unverifiedMerchantProductsReturned: 0,
        unverifiedMerchantProductsExcluded: 0,
        riskyMerchantProductsExcluded: 0,
        merchantTrustRegistryVersion: currentMerchantTrustRegistryVersion(),
        merchantsFailed: 0,
        coveragePercent: 0,
        failedMerchantIds: [],
        timedOutMerchantIds: [],
        registryVersion: "UNAVAILABLE",
        searchTimeoutMs: 0,
        selectionPolicy: selectionMode === "LOWEST_PRICE"
          ? "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_PRICE" as const
          : "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE" as const
      },
      questions: [],
      products: []
    }
  };
}

export function createShoppingServer(
  shopifyPort: ShopifyPort = createUnavailableShopifyPort(),
  affiliateLinks: AffiliateLinkResolver = createAffiliateLinkResolver(),
  dependencies: ShoppingServerDependencies = {}
): McpServer {
  const server = new McpServer({ name: "findcheap-agent", version: FINDCHEAP_VERSION });
  const requestedToolAvailability = dependencies.toolAvailability ?? {
    verifiedDeals: dependencies.deals !== undefined
  };
  const backend = dependencies.backend ?? createFindCheapBackend({
    catalog: {
      shopify: shopifyPort,
      awin: dependencies.awin ?? createUnavailableAwinPort(),
      ...(dependencies.ebay === undefined ? {} : { ebay: dependencies.ebay }),
      ...(dependencies.officialShopify === undefined ? {} : { officialShopify: dependencies.officialShopify }),
      ...(dependencies.officialStorefrontRegistry === undefined ? {} : { officialStorefrontRegistry: dependencies.officialStorefrontRegistry }),
      ...(dependencies.merchantTrustRegistry === undefined ? {} : { merchantTrustRegistry: dependencies.merchantTrustRegistry })
    },
    product: {
      ...(dependencies.webProducts === undefined ? {} : { webProducts: dependencies.webProducts }),
      affiliateLinks,
      ...(dependencies.awinShopifyQuotes === undefined ? {} : { awinShopifyQuotes: dependencies.awinShopifyQuotes }),
      ...(dependencies.cartQuotes === undefined ? {} : { cartQuotes: dependencies.cartQuotes }),
      ...(dependencies.selectedProducts === undefined ? {} : { selectedProducts: dependencies.selectedProducts })
    },
    deals: dependencies.deals ?? createUnavailableDealPort(),
    watches: dependencies.watches ?? createMemoryWatchStore(),
    ...(dependencies.visualCandidateImages === undefined ? {} : { visualCandidateImages: dependencies.visualCandidateImages }),
    verifiedDeals: requestedToolAvailability.verifiedDeals
  });
  const toolAvailability = {
    verifiedDeals: backend.capabilities.has("VERIFIED_DEALS")
  };
  const dealPort = backend.deals;
  const awinPort = backend.catalog.awin;
  const ebayPort = backend.catalog.ebay;
  const woocommercePort = backend.catalog.woocommerce;
  const woocommerceProducts = backend.product.woocommerceProducts;
  const cartQuotes = backend.product.cartQuotes;
  const awinShopifyQuotes = backend.product.awinShopifyQuotes;
  const selectedProducts = backend.product.selectedProducts;
  const officialShopify = backend.catalog.officialShopify;
  const officialStorefrontRegistry = backend.catalog.officialStorefrontRegistry;
  const merchantTrustRegistry = backend.catalog.merchantTrustRegistry;
  const visualCandidateImages = backend.visualCandidateImages;
  shopifyPort = backend.catalog.shopify;
  affiliateLinks = backend.product.affiliateLinks;
  const executor = new ToolExecutor({ capabilities: backend.capabilities });
  const taskScope = new TaskScope({ ...(dependencies.taskState === undefined ? {} : { store: dependencies.taskState }),
    trustedHost: () => server.server.getClientVersion()?.name === "codex-mcp-client" });
  const watchStore = taskScope.resource("watches", () => {
    const id = taskScope.taskId();
    return id === undefined ? backend.watches : dependencies.taskWatches?.(id) ?? createMemoryWatchStore();
  });
  const taskLifecycle = taskScope.resource("lifecycle", () => new Map<string, boolean>(), mapCodec(value => z.boolean().parse(value)));
  const seenTasks = new Set<string>();
  const applyLifecycle = async () => {
    const id = taskScope.taskId();
    if (id === undefined || dependencies.taskLifecycle === undefined) return "UNKNOWN" as const;
    seenTasks.add(id);
    if (seenTasks.size > 500) seenTasks.delete(seenTasks.values().next().value!);
    const status = await dependencies.taskLifecycle.status(id);
    if (status === "ARCHIVED") {
      taskLifecycle.set("archived", true);
      await pauseTaskWatches(watchStore, (dependencies.now?.() ?? new Date()).toISOString());
    } else if (status === "ACTIVE") taskLifecycle.set("archived", false);
    return status;
  };
  const toolRegistrar = createExecutedToolRegistrar(server, executor, (extra, handler, name) =>
    taskScope.run(extra, async () => {
      const status = await applyLifecycle();
      if (taskLifecycle.get("archived") === true && !["clear_shopping_history", "pause_watch", "delete_watch", "list_watches"].includes(name)) return toolError("TASK_ARCHIVED");
      if (taskScope.taskId() !== undefined && dependencies.taskLifecycle !== undefined && ["create_watch", "bind_watch_automation", "check_watch"].includes(name) && status !== "ACTIVE") return toolError("TASK_HOST_STATE_UNAVAILABLE");
      return handler();
    }, name === "clear_shopping_history"));
  let lifecyclePolling = false;
  const lifecycleTimer = dependencies.taskLifecycle === undefined ? undefined : setInterval(() => {
    if (lifecyclePolling || server.server.getClientVersion()?.name !== "codex-mcp-client") return;
    lifecyclePolling = true;
    void (async () => {
      for (const id of [...seenTasks].slice(-10)) {
        try { await taskScope.run({ _meta: { threadId: id } }, applyLifecycle); }
        catch { process.stderr.write("[findcheap-task-lifecycle] verification or pause pending; will retry\n"); }
      }
    })().finally(() => { lifecyclePolling = false; });
  }, 30_000);
  lifecycleTimer?.unref();
  const previousClose = server.server.onclose;
  server.server.onclose = () => {
    if (lifecycleTimer !== undefined) clearInterval(lifecycleTimer);
    dependencies.taskLifecycle?.close?.();
    previousClose?.();
  };
  const now = dependencies.now ?? (() => new Date());
  const webSessions = taskScope.resource("webRecovery", () => new WebRecoverySessions(() => now().getTime()), {
    encode: value => value.history(), decode: value => new WebRecoverySessions(() => now().getTime()).restoreHistory(value)
  });
  const cardTelemetry = dependencies.cardTelemetry ?? {
    record: (event: ProductCardTelemetry) => {
      process.stderr.write(`[findcheap-product-card-metrics] ${JSON.stringify(event)}\n`);
    }
  };
  const watchChecks = new Map<string, Promise<WatchEvaluation>>();
  const selections = taskScope.resource("selections", () => new Map<string, { renderId: string; variantId: string; productKey: string }>(),
    mapCodec(value => z.object({ renderId: z.string().uuid(), variantId: z.string(), productKey: z.string() }).strict().parse(value)));
  const cardSelections = taskScope.resource("cardSelections", () => new Map<string, { revision: number; selectionIds: string[] }>(),
    mapCodec(value => z.object({ revision: z.number().int().nonnegative(), selectionIds: z.array(z.string().uuid()).max(4) }).strict().parse(value)));
  type VisualSearchSnapshot = {
    expiresAt: number;
    input: SearchProductsInput;
    execution: UnifiedSearchExecution;
    candidates: Map<string, UnifiedCandidate>;
    attempt: 1 | 2;
    reviewedCandidateKeys: Set<string>;
    imageAttemptedKeys: Set<string>;
    imageContentKeys: Set<string>;
    reviewedCount: number;
    reviewConflictCount: number;
    reviewInsufficientCount: number;
    accepted: UnifiedCandidate[];
    retrievedProductHashes: Set<string>;
  };
  type RenderSnapshot = {
    expiresAt: number;
    historyExpiresAt: number;
    restored?: boolean;
    content: ProductCardContent & { renderId: string };
    sourceResult: ShopifySearchResult;
    sourceProductIndex: Map<string, SnapshotSourceProduct>;
    resolvedAwinProducts: Map<string, ShopifyProduct>;
    request?: SearchProductsInput;
    candidates?: UnifiedCandidate[];
    searchRun?: SearchRun;
    visualRecovery?: VisualSearchSnapshot;
    chargingClarificationAsked: boolean;
  };
  const snapshotCodec = mapCodec<RenderSnapshot>(value => {
    const stored = z.object({ expiresAt: z.number().finite(), historyExpiresAt: z.number().finite(),
      content: _ShopifyProductsOutputSchemaObject.extend({ renderId: z.string().uuid() }),
      sourceResult: z.object({ source: z.literal("SHOPIFY_GLOBAL_CATALOG"), products: z.array(z.object({
        merchantId: z.string(), sourceHost: z.string(), handle: z.string(), checkedAt: z.string() }).passthrough()).max(256) }).passthrough(),
      sourceProductIndex: z.array(z.tuple([z.string(), z.object({ sourceKind: z.enum(["SHOPIFY_GLOBAL_CATALOG", "AWIN_PRODUCT_FEED", "EBAY_BROWSE", "WOOCOMMERCE_STORE_API"]), product: z.record(z.unknown()) }).strict()])).max(256),
      resolvedAwinProducts: z.array(z.tuple([z.string(), z.record(z.unknown())])).max(18),
      request: StoredSearchProductsInputSchema.optional(), chargingClarificationAsked: z.boolean()
    }).strict().parse(value);
    const { request, ...required } = stored;
    return { ...required, ...(request === undefined ? {} : { request: parseStoredSearchRequest(request) }),
      restored: true, sourceResult: stored.sourceResult as ShopifySearchResult,
      sourceProductIndex: new Map(stored.sourceProductIndex) as Map<string, SnapshotSourceProduct>,
      resolvedAwinProducts: new Map(stored.resolvedAwinProducts) as Map<string, ShopifyProduct> };
  });
  const renderSnapshots = taskScope.resource("renderSnapshots", () => new Map<string, RenderSnapshot>(), {
    decode: snapshotCodec.decode,
    encode: values => [...values].map(([id, snapshot]) => {
      const { searchRun: _run, visualRecovery: _visual, candidates: _candidates, restored: _restored, ...stored } = snapshot;
      const request = stored.request === undefined ? undefined : structuredClone(stored.request);
      if (request?.visualInput !== undefined) { delete request.visualInput.imageUrl; delete request.visualInput.sourcePageUrl; }
      const keys = new Set(snapshot.content.products.map(productReferenceKey));
      return [id, { ...stored, ...(request === undefined ? {} : { request }),
        sourceResult: { ...stored.sourceResult, products: stored.sourceResult.products.filter(product => keys.has(productReferenceKey(product))) },
        sourceProductIndex: [...snapshot.sourceProductIndex].filter(([key]) => keys.has(key)),
        resolvedAwinProducts: [...snapshot.resolvedAwinProducts] }];
    })
  });
  const visualSearchSnapshots = taskScope.resource("visualSearchSnapshots", () => new Map<string, VisualSearchSnapshot>());
  const comparisonSnapshots = taskScope.resource("comparisonSnapshots", () => new Map<string, {
    expiresAt: number;
    content: ProductComparisonOutput;
  }>(), mapCodec(value => z.object({ expiresAt: z.number().finite(), content: ProductComparisonOutputSchema }).strict().parse(value)));
  const recordedCardTelemetry = taskScope.resource("recordedCardTelemetry", () => new Set<string>());
  toolRegistrar.registerTool("get_shopping_history", {
    title: "Recover this task's shopping history",
    description: "Read bounded shopping references and historical observations for this host task after restart. These are historical prices and stock, never fresh purchase advice. Use the original renderId to continue requirements with a new live search. This tool cannot access another task or restore web permission.",
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ status: z.literal("HISTORICAL"), message: z.string(),
      searches: z.array(z.object({ renderId: z.string().uuid(), goalId: z.string().uuid().optional(), goalRevision: z.number().optional(),
        query: z.string().optional(), requirements: z.record(z.unknown()).optional(), selectedIds: z.array(z.string().uuid()),
        referenceExpiresAt: z.string(), historyExpiresAt: z.string(),
        products: z.array(z.object({ selectionId: z.string().uuid().optional(), title: z.string(), merchant: z.string(),
          checkedAt: z.string(), variantDimensions: z.record(z.string()), historicalItemPrice: z.unknown().optional() })) })),
      comparisons: z.array(z.object({ comparisonId: z.string().uuid(), renderId: z.string().uuid().optional(), evaluatedAt: z.string().optional(), expiresAt: z.string(),
        historicalComparison: ProductComparisonOutputSchema })) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => {
    const message = "Historical observations only. Continue using the original reference for a live search; old price, stock and authorization are not refreshed.";
    return { content: [{ type: "text" as const, text: message }], structuredContent: {
      status: "HISTORICAL" as const, message,
      searches: [...renderSnapshots.values()].filter(snapshot => snapshot.historyExpiresAt > now().getTime()).slice(-12).reverse().map(snapshot => ({
        renderId: snapshot.content.renderId, goalId: snapshot.content.goalId, goalRevision: snapshot.content.goalRevision,
        query: snapshot.request?.query, requirements: snapshot.content.requirementsSummary,
        selectedIds: cardSelections.get(snapshot.content.renderId)?.selectionIds ?? [],
        referenceExpiresAt: new Date(snapshot.expiresAt).toISOString(), historyExpiresAt: new Date(snapshot.historyExpiresAt).toISOString(),
        products: snapshot.content.products.map(product => ({ selectionId: product.selectionId, title: product.title, merchant: product.merchant,
          checkedAt: product.checkedAt, variantDimensions: product.variantDimensions, historicalItemPrice: product.itemPrice }))
      })),
      comparisons: [...comparisonSnapshots].filter(([, snapshot]) => snapshot.expiresAt + TASK_HISTORY_TTL_MS > now().getTime()).slice(-12).reverse().map(([comparisonId, snapshot]) => ({
        comparisonId, renderId: snapshot.content.renderId, evaluatedAt: snapshot.content.evaluatedAt, expiresAt: new Date(snapshot.expiresAt).toISOString(),
        historicalComparison: snapshot.content
      }))
    } };
  });
  toolRegistrar.registerTool("clear_shopping_history", {
    title: "Clear this task's shopping history",
    description: "Only after the user asks to clear shopping history: erase this trusted host task's saved requirements, product selections and comparisons. No taskId argument is accepted. Watch rules have separate pause/delete tools; this does not stop their host schedules.",
    inputSchema: z.object({}).strict(), outputSchema: z.object({ status: z.literal("CLEARED"), message: z.string() }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  }, async () => {
    taskScope.clear(["lifecycle"]);
    const message = "This task's shopping history was cleared. Watch rules and host schedules require their own pause/delete operations.";
    return { content: [{ type: "text" as const, text: message }], structuredContent: { status: "CLEARED" as const, message } };
  });
  const deleteSnapshot = (renderId: string, force = false) => {
    const snapshot = renderSnapshots.get(renderId);
    if (!force && snapshot !== undefined && snapshot.historyExpiresAt > now().getTime()) return;
    webSessions.forget(renderId);
    if (snapshot !== undefined) {
      for (const product of snapshot.content.products) {
        if (product.selectionId !== undefined) selections.delete(product.selectionId);
      }
    }
    cardSelections.delete(renderId);
    renderSnapshots.delete(renderId);
    const scope = snapshot?.content.goalId ?? renderId;
    if (![...renderSnapshots.values()].some(value => value.content.goalId === scope)) webSessions.forgetGoal(scope);
  };
  const preflightQuoteCapabilities = async (content: ProductCardContent, searchRun: SearchRun) => {
    const resolvedAwinProducts = new Map<string, ShopifyProduct>();
    const diagnostics = { attempted: 0, succeeded: 0, skippedBudget: 0, failed: 0, unsupported: 0 };
    const unchecked = (product: ProductCardProduct): ProductCardProduct => ({ ...product, quoteCapability: "NOT_CHECKED",
      card: { ...product.card, quoteCapability: "NOT_CHECKED" } });
    const products = await Promise.all(content.products.map(async (product) => {
      searchRun.throwIfCancelled();
      if (product.checkoutPlatform === "MERCHANT" || product.sourceKind === "EBAY_BROWSE") {
        diagnostics.unsupported++; return product;
      }
      if (product.sourceKind === "SHOPIFY_GLOBAL_CATALOG" || product.sourceKind === undefined) {
        const quoteCapability = cartQuotes === undefined
          ? "MERCHANT_CHECKOUT_ONLY" as const
          : "DELIVERED_TOTAL_SUPPORTED" as const;
        if (cartQuotes === undefined) diagnostics.unsupported++;
        return { ...product, quoteCapability, card: { ...product.card, quoteCapability } };
      }
      if (cartQuotes === undefined || awinShopifyQuotes === undefined || product.itemPrice === undefined) {
        diagnostics.unsupported++;
        return product;
      }
      const seed = awinQuoteSeed(product);
      if (!awinShopifyQuotes.supports(seed)) { diagnostics.unsupported++; return product; }
      if (!searchRun.canRead("VARIANT")) { diagnostics.skippedBudget++; return unchecked(product); }
      try {
        diagnostics.attempted++;
        const resolved = await searchRun.read("VARIANT", `awin-preflight:${productReferenceKey(product)}`,
          signal => awinShopifyQuotes.resolve(seed, { signal }));
        searchRun.throwIfCancelled();
        diagnostics.succeeded++;
        const quoteCapability = resolved.availability === "IN_STOCK"
          ? "ZIP_ESTIMATE_ONLY" as const
          : "MERCHANT_CHECKOUT_ONLY" as const;
        if (quoteCapability === "ZIP_ESTIMATE_ONLY") resolvedAwinProducts.set(productReferenceKey(product), resolved);
        return {
          ...product,
          itemPrice: resolved.itemPrice,
          availability: resolved.availability,
          quoteCapability,
          pricing: {
            ...product.pricing,
            regularItemPrice: { status: "VERIFIED" as const, amount: resolved.itemPrice }
          },
          card: {
            ...product.card,
            primaryPrice: resolved.itemPrice,
            itemPrice: resolved.itemPrice,
            availability: resolved.availability,
            quoteCapability
          }
        };
      } catch {
        searchRun.throwIfCancelled();
        diagnostics.failed++;
        return unchecked(product);
      }
    }));
    searchRun.throwIfCancelled();
    return { content: { ...content, products,
      ...(content.retrieval === undefined ? {} : { retrieval: { ...content.retrieval,
        ...(searchRun.diagnostics().budgetExhausted ? { termination: "BUDGET_EXHAUSTED" as const } : {}) } }) }, resolvedAwinProducts, diagnostics };
  };
  const rememberSnapshot = (
    content: ProductCardContent,
    sourceResult: ShopifySearchResult,
    resolvedAwinProducts = new Map<string, ShopifyProduct>(),
    primaryProductIndex?: number,
    request?: SearchProductsInput,
    candidates?: UnifiedCandidate[],
    askedChargingCompatibility = false,
    searchRun?: SearchRun
  ): ProductCardContent & { renderId: string } => {
    const renderId = randomUUID();
    const parent = request?.parentRenderId === undefined ? undefined : renderSnapshots.get(request.parentRenderId);
    const anchoredProducts = request?.shopifyAnchor === undefined ? content.products
      : content.products.flatMap(product => product.sourceKind === "SHOPIFY_GLOBAL_CATALOG" && hasConflictingShopifyVariantId(product, request.shopifyAnchor!) ? []
        : matchesShopifyProductAnchor(product, request.shopifyAnchor!) ? [product]
        : request.allowAlternatives ? [{ ...product, matchStatus: "SIMILAR" as const, resultGroup: "ALTERNATIVE" as const,
          requestIdentityStatus: "NEEDS_VERIFICATION" as const, card: { ...product.card, matchBadge: "SIMILAR" as const },
          matchEvidence: [...new Set([...product.matchEvidence, "Different product or unverified identity relative to the source URL; explicitly requested alternative only"])] }] : []);
    const finalizedProducts = finalizeSnapshotProducts(anchoredProducts, request?.brand !== undefined, now().getTime());
    const summary = summarizeSearchProducts(finalizedProducts, now().getTime());
    const previousSummary = summarizeSearchProducts(content.products, now().getTime());
    if (finalizedProducts.length !== content.products.length || content.comparison.offerCount !== summary.productCount ||
      summary.qualifiedMatchCount !== previousSummary.qualifiedMatchCount ||
      summary.recommendation.state !== previousSummary.recommendation.state) {
      content = { ...content, message: snapshotCardSummary(summary, content.locale ?? "en-US") +
        (content.coverage === "PARTIAL" ? content.locale === "zh-CN" ? " 检索覆盖尚不完整。" : " Search coverage remains incomplete." : "") };
    }
    // A clarification is an explicit no-recommendation state, not an empty search.
    const decision = content.recommendation?.state === "NEEDS_CLARIFICATION" ? undefined : summary.recommendation;
    primaryProductIndex = decision?.primaryProductIndex;
    content = { ...content, products: finalizedProducts, comparison: reconcileComparison(content.comparison, summary.comparison),
      ...(content.recovery === undefined ? {} : { recovery: { ...content.recovery,
        qualified: summary.recoveryCounts.qualified, qualifiedMatches: summary.recoveryCounts.qualifiedMatches,
        recommendable: summary.recoveryCounts.recommendable, awaitingVerification: summary.recoveryCounts.awaitingVerification,
        ...(content.recovery.comparableMerchants === undefined ? {} : { comparableMerchants: summary.recoveryCounts.comparableMerchants }),
        ...(summary.productCount === 0 && content.recovery.reason === "MATCH_FOUND" ? { reason: "NO_QUALIFIED_MATCH" as const } : {}) } }),
      quality: { ...content.quality, cardsReturned: finalizedProducts.length,
        itemPricesVerified: finalizedProducts.length,
        affiliateLinksApproved: finalizedProducts.filter(product => product.purchaseLink.kind === "APPROVED_AFFILIATE").length,
        couponsVerified: new Set(finalizedProducts.flatMap(product => product.coupons.verified.map(deal =>
          JSON.stringify([product.sourceHost.toLowerCase(), product.merchantId, deal.dealId])
        ))).size },
      ...(decision === undefined ? {} : { recommendation: { state: decision.state, reasonCodes: decision.reasonCodes } }) };
    const compatibilityQuestion = request !== undefined && content.products.some(product => product.coffeeCompatibility?.status === "UNKNOWN")
      ? coffeeCompatibilityClarification({ ...request, responseLocale: content.locale ?? request.responseLocale }, true) : undefined;
    if (compatibilityQuestion !== undefined && content.recommendation !== undefined && content.recommendation.state !== "READY") {
      content = { ...content, recommendation: { ...content.recommendation, question: compatibilityQuestion.question } };
    }
    const goalId = request === undefined ? undefined : parent?.content.goalId ?? randomUUID();
    if (parent?.restored === true && goalId !== undefined) webSessions.closeGoal(goalId, parent.content.renderId);
    const consent = webSessions.current(goalId ?? renderId);
    if (content.recovery?.action === "REQUEST_WEB_SEARCH" && consent !== undefined && !consent.retryable) {
      const message = content.locale === "zh-CN"
        ? "本次结果已保留；同一购物目标不能重复申请网页授权，查看规格或修改预算不重置授权状态。检索仍不完整，不能据此判断商品不存在。"
        : "Current results are retained. Web authorization cannot be requested again for this shopping goal; inspecting variants or changing budget does not reset consent. Coverage remains incomplete, not proof of product absence.";
      content = { ...content, message, recovery: { ...content.recovery, action: "REPORT_INCOMPLETE",
        reason: "AUTHORIZATION_STOPPED", consentStatus: consent.status } };
    }
    // Scope revision allocation to the explicitly referenced goal, not a global latest search.
    const goalRevision = goalId === undefined ? undefined : Math.max(0, ...[...renderSnapshots.values()]
      .filter(snapshot => snapshot.content.goalId === goalId)
      .map(snapshot => snapshot.content.goalRevision ?? 0)) + 1;
    let primarySelectionId: string | undefined;
    const products = content.products.map((product, index) => {
      // Every snapshot entry point uses the same static target checks as execution.
      const quoteCapability = cartQuotes === undefined ? "MERCHANT_CHECKOUT_ONLY" as const
        : ["DELIVERED_TOTAL_SUPPORTED", "ZIP_ESTIMATE_ONLY"].includes(product.quoteCapability) &&
          verifiedQuoteTarget({ sourceResult, resolvedAwinProducts }, product) === undefined
          ? "NOT_CHECKED" as const : product.quoteCapability;
      const selectionId = randomUUID();
      if (primaryProductIndex !== undefined && index === primaryProductIndex) primarySelectionId = selectionId;
      selections.set(selectionId, { renderId, variantId: product.handle, productKey: productReferenceKey(product) });
      return {
        ...product,
        quoteCapability,
        card: { ...product.card, quoteCapability },
        selectionId,
        quoteReference: { selectionId, renderId, variantId: product.handle }
      };
    });
    const snapshot = {
      ...content,
      ...(request === undefined ? {} : {
        goalId, goalRevision,
        requirementLedger: shoppingRequirementLedger(request),
        requirementsVersion: (request.parentRenderId === undefined ? 0 : renderSnapshots.get(request.parentRenderId)?.content.requirementsVersion ?? 0) + 1,
        requirementsSummary: { productType: request.productType, brand: request.brand,
          maxItemPriceCents: request.maxItemPriceCents, requiredSize: request.requiredSize,
          requiredFeatures: request.requiredFeatures, excludedFeatures: request.excludedFeatures,
          primaryUse: request.primaryUse, preferences: request.preferences }
      }),
      renderId,
      products,
      ...(content.recommendation === undefined ? {} : {
        recommendation: primarySelectionId === undefined
          ? content.recommendation
          : { ...content.recommendation, primarySelectionId }
      })
    };
    renderSnapshots.set(renderId, {
      expiresAt: now().getTime() + PRODUCT_SELECTION_SNAPSHOT_TTL_MS,
      historyExpiresAt: now().getTime() + (taskScope.taskId() === undefined ? PRODUCT_SELECTION_SNAPSHOT_TTL_MS : TASK_HISTORY_TTL_MS),
      content: snapshot,
      sourceResult,
      sourceProductIndex: snapshotProductIndex(sourceResult.products, candidates),
      resolvedAwinProducts,
      ...(searchRun === undefined && parent?.searchRun === undefined ? {} : { searchRun: searchRun ?? parent!.searchRun! }),
      chargingClarificationAsked: askedChargingCompatibility || parent?.chargingClarificationAsked === true,
      ...(candidates === undefined ? {} : { candidates: structuredClone(candidates.slice(0, 18)) }),
      ...(request === undefined ? {} : { request: parseStoredSearchRequest(request) })
    });
    while (renderSnapshots.size > MAX_PRODUCT_SELECTION_SNAPSHOTS) {
      const oldest = renderSnapshots.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      deleteSnapshot(oldest, true);
    }
    if (request !== undefined) process.stderr.write(`[findcheap-shopping-goal] ${JSON.stringify({
      goalId, goalRevision, renderId, traceId: content.traceId, requirementsVersion: snapshot.requirementsVersion
    })}\n`);
    return snapshot;
  };
  const resolveSearchParent = (input: SearchProductsInput) => {
    if ((input.goalId === undefined) !== (input.goalRevision === undefined)) return undefined;
    const candidates = input.parentRenderId !== undefined
      ? [renderSnapshots.get(input.parentRenderId)].filter(snapshot => snapshot !== undefined)
      : input.goalId === undefined ? [] : [...renderSnapshots.values()].filter(snapshot =>
        snapshot.content.goalId === input.goalId && snapshot.content.goalRevision === input.goalRevision);
    const matches = candidates.filter(snapshot => snapshot.request !== undefined &&
      (input.goalId === undefined || snapshot.content.goalId === input.goalId && snapshot.content.goalRevision === input.goalRevision));
    return matches.length === 1 ? matches[0] : undefined;
  };
  const unavailableReference = (snapshot?: { expiresAt: number }) => toolError(
    snapshot !== undefined && snapshot.expiresAt <= now().getTime() ? "REFERENCE_EXPIRED" : "REFERENCE_STATE_UNAVAILABLE"
  );
  const resolveSelectionReference = (reference: {
    selectionId?: string | undefined;
    renderId?: string | undefined;
    position?: number | undefined;
    variantId?: string | undefined;
  }) => {
    if (reference.selectionId !== undefined) {
      const selected = selections.get(reference.selectionId);
      if (selected === undefined || selected.renderId !== reference.renderId) return undefined;
      if (reference.variantId !== undefined && selected.variantId !== reference.variantId) return undefined;
      return selected;
    }
    if (reference.renderId === undefined) return undefined;
    if (reference.position !== undefined) {
      const product = renderSnapshots.get(reference.renderId)?.content.products[reference.position - 1];
      return product === undefined ? undefined : { renderId: reference.renderId, variantId: product.handle, productKey: productReferenceKey(product) };
    }
    if (reference.variantId === undefined) return undefined;
    const matching = renderSnapshots.get(reference.renderId)?.content.products.filter((product) => product.handle === reference.variantId) ?? [];
    // Legacy variant-only references must never silently choose a merchant.
    return matching.length !== 1 ? undefined : {
      renderId: reference.renderId, variantId: reference.variantId, productKey: productReferenceKey(matching[0]!)
    };
  };
  const resolveComparisonSelectionIds = (input: {
    selectionIds?: string[] | undefined;
    renderId?: string | undefined;
  }): string[] | undefined => input.selectionIds ?? (
    input.renderId === undefined ? undefined : cardSelections.get(input.renderId)?.selectionIds
  );
  const resolveSingleSelectionReference = (input: Pick<z.infer<typeof ShopifySelectedQuoteInputSchema>,
    "renderId" | "selectionId" | "position" | "variantId">) => {
    if (input.selectionId !== undefined || input.position !== undefined || input.variantId !== undefined) {
      return resolveSelectionReference(input);
    }
    const ids = cardSelections.get(input.renderId)?.selectionIds;
    return ids?.length === 1 ? resolveSelectionReference({ renderId: input.renderId, selectionId: ids[0]! }) : undefined;
  };
  const quoteRequestFailure = (locale: string, code: string, english: string, chinese: string) => ({
    isError: true as const,
    content: [{ type: "text" as const, text: `[${code}] ${locale === "zh-CN" ? chinese : english}` }]
  });
  const quoteSelectionFailure = (ids: string[] | undefined, mode: "SINGLE" | "BATCH", locale: string) => {
    if (ids === undefined) return quoteRequestFailure(locale, "QUOTE_SELECTION_NOT_SYNCED",
      "No UI selection receipt is available for this snapshot. Select its cards or provide an exact original selection ID; no quote was requested.",
      "尚未收到该快照的卡片选择记录。请选择原卡片，或提供原快照中的准确选择 ID；未请求报价。");
    if (ids.length === 0) return quoteRequestFailure(locale, "QUOTE_SELECTION_EMPTY",
      "No product is currently selected in this snapshot. Select a product first; no quote was requested.",
      "该快照当前未选择商品。请先选择商品；未请求报价。");
    if (mode === "BATCH" && ids.length === 1) return quoteRequestFailure(locale, "QUOTE_SINGLE_SELECTION",
      `This request selects one product. Use quote_selected_shopify_product with selectionId=${ids[0]!}, the original renderId and ZIP; do not substitute the current UI choice. No quote was requested.`,
      `本次请求只选择了 1 件商品。请使用 quote_selected_shopify_product，传入 selectionId=${ids[0]!} 并保留原 renderId 和 ZIP；不要替换为其他当前 UI 选择。未请求报价。`);
    if (mode === "SINGLE" && ids.length > 1) return quoteRequestFailure(locale, "QUOTE_MULTIPLE_SELECTIONS",
      "Multiple products are selected. Use quote_and_compare_selected_products with this original renderId for 2–4 products, or specify one original selection ID; no quote was requested.",
      "当前选择了多件商品。2–4 件请使用 quote_and_compare_selected_products 并保留原 renderId，或指定其中一件原选择 ID；未请求报价。");
    return undefined;
  };
  const recoverableQuoteResult = (
    snapshot: (typeof renderSnapshots extends Map<string, infer T> ? T : never),
    message: string,
    locale: string
  ) => ({
    content: [{ type: "text" as const, text: message }],
    structuredContent: {
      ...snapshot.content,
      locale,
      message
    }
  });
  const quoteAuthorizationFailure = (code: string, locale: string) => {
    const reasons: Record<string, [string, string]> = {
      QUOTE_AUTHORIZATION_UNAVAILABLE: ["Host form authorization is unavailable or did not complete; whether a prompt was displayed is unknown.",
        "宿主表单授权不可用或未完成；无法确认授权弹窗是否显示。"],
      QUOTE_AUTHORIZATION_DECLINED: ["The host did not grant this quote permission; whether a prompt was displayed is unknown.",
        "宿主未授予本次报价权限；无法确认授权弹窗是否显示。"],
      QUOTE_AUTHORIZATION_CANCELLED: ["The quote authorization request was cancelled.", "本次报价授权请求已取消。"],
      QUOTE_REFERENCE_CHANGED: ["The original selection changed or expired during authorization.", "授权期间原商品选择已改变或过期。"],
      QUOTE_TARGET_UNVERIFIED: ["The selected product, variant or reviewed merchant quote interface could not be verified.",
        "所选商品、变体或已审核的商家报价接口未通过核验。"],
      QUOTE_MERCHANT_UNVERIFIED: ["The selected merchant has not passed independent trust review; host approval was not requested.",
        "所选商家尚未通过独立可信审核；尚未请求宿主授权。"],
      QUOTE_UNSUPPORTED: ["At least one selected product requires merchant checkout and does not support this quote; host approval was not requested.",
        "至少一个所选商品只支持商家结账，不支持本次报价；尚未请求宿主授权。"],
      QUOTE_CAPABILITY_NOT_CHECKED: ["The selected product's quote capability has not been verified; host approval was not requested.",
        "所选商品的报价能力尚未核验；尚未请求宿主授权。"]
    };
    const reason = reasons[code] ?? ["The quote did not pass authorization safety checks.", "本次报价未通过授权安全检查。"];
    return quoteRequestFailure(locale, code,
      `${reason[0]} No quote Cart was created. Existing products and selections are unchanged. Do not automatically retry or ask for a street address.`,
      `${reason[1]}未创建报价购物车。现有商品和选择保持不变。不要自动重试，也不要索取完整地址。`);
  };
  const discardedQuoteResult = (locale: string) => ({
    isError: true as const,
    content: [{ type: "text" as const, text: "[QUOTE_RESULT_DISCARDED] " + (locale === "zh-CN"
      ? "请求已取消或原商品选择已改变；迟到的报价结果未写入。先前授权的临时匿名购物车可能已创建，但未下单或付款。不要自动重试。"
      : "The request was cancelled or its original selection changed; the late quote was not saved. An already authorized temporary anonymous Cart may have been created, but no order or payment. Do not automatically retry.") }]
  });
  type QuoteSnapshot = typeof renderSnapshots extends Map<string, infer T> ? T : never;
  const verifiedQuoteTarget = (snapshot: Pick<QuoteSnapshot, "sourceResult" | "resolvedAwinProducts">, card: ProductCardProduct) => {
    if (!isTrustedMerchant({ level: card.merchantTrust.level, verification: card.merchantTrust.verification,
      evidence: card.merchantTrust.evidence })) return undefined;
    const key = productReferenceKey(card);
    const target = card.sourceKind === "AWIN_PRODUCT_FEED"
      ? snapshot.resolvedAwinProducts.get(key)
      : snapshot.sourceResult.products.find(product => productReferenceKey(product) === key);
    if (target === undefined || target.merchantId !== card.merchantId) return undefined;
    try {
      const validated = validateShopifyCartQuoteTarget(target);
      if (resolveMerchantTrust(validated.sourceHost).level === "RISKY") return undefined;
      if (card.sourceKind === "AWIN_PRODUCT_FEED") {
        const seed = awinQuoteSeed(card);
        if (awinShopifyQuotes?.supports(seed) !== true || !awinShopifyQuotes.supports({
          ...seed, sourceHost: target.sourceHost, merchantUrl: target.merchantUrl
        })) return undefined;
      }
      return target;
    } catch { return undefined; }
  };
  const selectedQuoteTarget = (snapshot: QuoteSnapshot, card: ProductCardProduct) =>
    ["DELIVERED_TOTAL_SUPPORTED", "ZIP_ESTIMATE_ONLY"].includes(card.quoteCapability)
      ? verifiedQuoteTarget(snapshot, card) : undefined;
  const quoteEligibilityFailure = (snapshot: QuoteSnapshot, card: ProductCardProduct): string | undefined => {
    if (!isTrustedMerchant({ level: card.merchantTrust.level, verification: card.merchantTrust.verification,
      evidence: card.merchantTrust.evidence })) return "QUOTE_MERCHANT_UNVERIFIED";
    if (card.quoteCapability === "MERCHANT_CHECKOUT_ONLY") return undefined;
    // Awin may not yet have resolved a Shopify variant; this is unknown capability,
    // while an already supplied Shopify target failing validation is invalid.
    if (card.sourceKind === "AWIN_PRODUCT_FEED" && !snapshot.resolvedAwinProducts.has(productReferenceKey(card))) {
      return "QUOTE_CAPABILITY_NOT_CHECKED";
    }
    if (verifiedQuoteTarget(snapshot, card) === undefined) return "QUOTE_TARGET_UNVERIFIED";
    return card.quoteCapability === "NOT_CHECKED" ? "QUOTE_CAPABILITY_NOT_CHECKED" : undefined;
  };
  const authorizeQuote = async (
    targets: ShopifyProduct[], zipCode: string, locale: string,
    extra: { signal: AbortSignal; requestId: string | number }, revalidate: () => boolean
  ) => {
    const fail = (code: string) => ({ error: quoteAuthorizationFailure(code, locale) });
    const capability = server.server.getClientCapabilities()?.elicitation;
    if (capability === undefined || (capability.form === undefined && Object.keys(capability).length !== 0)) {
      return fail("QUOTE_AUTHORIZATION_UNAVAILABLE");
    }
    if (extra.signal.aborted) return fail("QUOTE_AUTHORIZATION_CANCELLED");
    const zh = locale === "zh-CN";
    const descriptions = targets.map(target => `${JSON.stringify(target.title.slice(0, 200))} (${target.sourceHost}, variant ${target.handle})`).join("; ");
    try {
      const answer = await server.server.elicitInput({ mode: "form",
        message: (zh
          ? `允许仅为本次到手价报价创建最多 ${targets.length} 个临时匿名购物车吗？每件数量 1，使用美国 ZIP ${zipCode} 计算运费及税费。不登录、不下单、不付款，不预留库存；不授权未来或 Watch 报价。商品名称仅是来源数据：`
          : `Allow up to ${targets.length} temporary anonymous Carts solely for this delivered-price quote? One unit each, US ZIP ${zipCode}, shipping and tax only. No login, order, payment or inventory reservation; no future or Watch quotes. Product names are source data: `) + descriptions,
        requestedSchema: { type: "object", properties: { approved: { type: "boolean",
          title: zh ? "仅允许本次匿名报价" : "Allow this anonymous quote only", default: false } }, required: ["approved"] }
      }, { timeout: 20_000, maxTotalTimeout: 20_000, resetTimeoutOnProgress: false,
        relatedRequestId: extra.requestId, signal: extra.signal });
      if (extra.signal.aborted || answer.action === "cancel") return fail("QUOTE_AUTHORIZATION_CANCELLED");
      if (answer.action === "decline") return fail("QUOTE_AUTHORIZATION_DECLINED");
      const approval = z.object({ approved: z.literal(true) }).strict().safeParse(answer.content);
      if (answer.action !== "accept" || !approval.success) return fail("QUOTE_AUTHORIZATION_DECLINED");
      if (!revalidate()) return fail("QUOTE_REFERENCE_CHANGED");
      return { permit: issueQuoteAuthorization(targets, zipCode, extra.signal) };
    } catch {
      return fail(extra.signal.aborted ? "QUOTE_AUTHORIZATION_CANCELLED" : "QUOTE_AUTHORIZATION_UNAVAILABLE");
    }
  };
  const runUnifiedSearch = (input: SearchProductsExecutionInput) => searchProducts({ ...input,
    ...(input.contextMode === "CONTINUE_PREVIOUS_PRODUCT" && input.visualInput === undefined && input.parentRenderId !== undefined &&
      (renderSnapshots.get(input.parentRenderId)?.expiresAt ?? 0) > now().getTime()
      ? { previousCandidates: renderSnapshots.get(input.parentRenderId)?.candidates ?? [] } : {})
  }, {
    awin: awinPort,
    shopify: shopifyPort,
    ...(backend.product.selectedProducts === undefined ? {} : { selectedProducts: backend.product.selectedProducts }),
    ...(ebayPort === undefined ? {} : { ebay: ebayPort }),
    ...(woocommercePort === undefined ? {} : { woocommerce: woocommercePort }),
    ...(toolAvailability.verifiedDeals ? { deals: dealPort } : {}),
    ...(officialShopify === undefined ? {} : { officialShopify }),
    ...(officialStorefrontRegistry === undefined ? {} : { officialStorefrontRegistry }),
    ...(merchantTrustRegistry === undefined ? {} : { merchantTrustRegistry })
  });
  const buildUnifiedResponse = async (input: SearchProductsInput, execution: UnifiedSearchExecution, outcome?: SearchOutcome) => {
    execution.searchRun?.throwIfCancelled();
    const selectedShopifyProducts = execution.candidates.flatMap((candidate) =>
      candidate.shopifyProduct === undefined ? [] : [candidate.shopifyProduct]
    );
    const initialShopify = execution.shopifyResult === undefined
      ? { ...emptyShopifySearchResult(input), products: selectedShopifyProducts }
      : {
          ...execution.shopifyResult,
          // Candidates retain accepted products across passes and sources. The
          // last source response is diagnostic context, not the selected set.
          products: selectedShopifyProducts
        };
    // A delivery location constrains discovery; it does not authorize a cart mutation.
    const enriched = { result: initialShopify, attempted: 0, succeeded: 0 };
    if (enriched.result.products.length > 0) {
      const enrichedByReference = new Map(enriched.result.products.map((product) => [productReferenceKey(product), product]));
      execution.shopifyResult = enriched.result;
      execution.candidates = execution.candidates.map((candidate) =>
        candidate.shopifyProduct === undefined
          ? candidate
          : {
              ...candidate,
              shopifyProduct: enrichedByReference.get(productReferenceKey(candidate.shopifyProduct)) ?? candidate.shopifyProduct
            }
      );
    }
    const shopifyResponse = shopifyResult(enriched.result, {
      ...(input.zipCode === undefined ? {} : { zipCode: input.zipCode }),
      membershipIds: input.membershipIds ?? []
    }, affiliateLinks, {
      attempted: enriched.attempted,
      succeeded: enriched.succeeded
    });
    const response = unifiedResult(execution, input, shopifyResponse, {
      attempted: enriched.attempted,
      succeeded: enriched.succeeded
    });
    const returned = response.structuredContent.products.length;
    const recovery = textSearchRecovery(execution, input.allowAlternatives, input.compareMerchants);
    const terminalOutcome = outcome ?? (recovery.reason === "IDENTITY_UNVERIFIED" ? "IDENTITY_UNVERIFIED" : input.visualInput === undefined && recovery.qualified === 0 && recovery.awaitingVerification > 0
      ? "REQUIREMENTS_UNVERIFIED" : returned > 0 ? "MATCH_FOUND"
      : Object.values(execution.sourceStatus).includes("UNAVAILABLE") ? "SOURCE_UNAVAILABLE" : "NO_CANDIDATES");
    const diagnostics = searchDiagnostics(execution, terminalOutcome);
    return { response: {
      ...response,
      _meta: searchTraceMeta(execution, terminalOutcome, { returned }),
      structuredContent: { ...response.structuredContent, traceId: execution.searchRun?.traceId,
        ...(execution.sourceFailures === undefined ? {} : { sourceFailures: execution.sourceFailures }),
        ...(input.visualInput === undefined ? { recovery } : {}),
        retrieval: { extent: "BOUNDED" as const, satisfied: diagnostics.requirementFunnel.satisfiedReturned,
          awaitingVerification: diagnostics.requirementFunnel.awaitingVerification, termination: diagnostics.termination } }
    }, enriched };
  };
  const pruneComparisonSnapshots = () => {
    const currentTime = now().getTime();
    for (const [id, snapshot] of comparisonSnapshots) {
      if (snapshot.expiresAt + (taskScope.taskId() === undefined ? 0 : TASK_HISTORY_TTL_MS) <= currentTime) comparisonSnapshots.delete(id);
    }
    while (comparisonSnapshots.size > MAX_PRODUCT_COMPARISON_SNAPSHOTS) {
      const oldest = comparisonSnapshots.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      comparisonSnapshots.delete(oldest);
    }
  };
  const pruneVisualSearchSnapshots = () => {
    const currentTime = now().getTime();
    for (const [id, snapshot] of visualSearchSnapshots) {
      if (snapshot.expiresAt <= currentTime) visualSearchSnapshots.delete(id);
    }
    while (visualSearchSnapshots.size > MAX_VISUAL_SEARCH_SNAPSHOTS) {
      const oldest = visualSearchSnapshots.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      visualSearchSnapshots.delete(oldest);
    }
  };
  const rememberVisualFailure = (content: ProductCardContent, sourceResult: ShopifySearchResult, snapshot: VisualSearchSnapshot) => {
    snapshot.execution.searchRun?.throwIfCancelled();
    const canRecover = backend.capabilities.has("WEB_RECOVERY") && visualCandidateImages !== undefined &&
      snapshot.attempt === 1 && snapshot.execution.webRecovery === undefined &&
      snapshot.execution.searchRun?.canRead("IMAGE") === true &&
      !snapshot.execution.sourceFailures?.some(failure => !failure.retryable);
    const blockedByBudget = snapshot.attempt === 2 || snapshot.execution.searchRun?.canRead("IMAGE") === false;
    const visualSearchOutcome = describeVisualOutcome([], true, snapshot.input.responseLocale ?? "en-US");
    const message = `${content.message} ${visualSearchOutcome.message} ${snapshot.input.responseLocale === "zh-CN"
      ? canRecover ? "可申请一次仅发送商品描述的网页补搜；不会上传参考图，找到候选后仍须看图核验。"
        : blockedByBudget ? "剩余图片读取或复核轮次不足，不能再启动需要看图核验的补搜。" : "本次未启动网页补搜。"
      : canRecover ? "A descriptor-only web recovery may be authorized. The reference image is not uploaded; recovered candidates still require image review."
        : blockedByBudget ? "No image-read or review-round budget remains for a visually verified web recovery." : "No web recovery started."}`;
    const remembered = rememberSnapshot({ ...content, message, visualSearchOutcome, recovery: {
      action: canRecover ? "REQUEST_WEB_SEARCH" : "REPORT_INCOMPLETE",
      reason: canRecover ? "NO_QUALIFIED_MATCH" : blockedByBudget ? "BUDGET_EXHAUSTED" : "SOURCE_UNAVAILABLE",
      qualified: 0, recommendable: 0, awaitingVerification: 0
    } }, sourceResult, undefined, undefined, snapshot.input, [], false, snapshot.execution.searchRun);
    if (canRecover) renderSnapshots.get(remembered.renderId)!.visualRecovery = snapshot;
    return remembered;
  };
  const loadVisualCandidates = async (
    execution: UnifiedSearchExecution,
    excludedKeys: ReadonlySet<string> = new Set(),
    limit = MAX_VISUAL_CANDIDATES,
    options: { maxAttempts?: number; maxDataChars?: number; contentKeys?: Set<string>; round?: 1 | 2 } = {}
  ) => {
    const attemptedKeys = new Set<string>();
    const emptyDiagnostics = {
      attempted: 0,
      loaded: 0,
      downloaded: 0,
      outputBudgetSkipped: 0,
      duplicateContentSkipped: 0,
      failures: [] as Array<{ code: VisualCandidateImageFailureCode; sourceHost?: string; phase?: "DNS" | "REQUEST" | "BODY"; count: number }>
    };
    if (visualCandidateImages === undefined) return { entries: [], diagnostics: emptyDiagnostics, attemptedKeys };
    const seen = new Set(excludedKeys);
    const eligiblePool = (execution.reviewPool ?? execution.candidates).flatMap((candidate) => {
      const key = visualCandidateKey(candidate);
      if (seen.has(key) || candidateImageUrl(candidate) === undefined) return [];
      seen.add(key);
      return [candidate];
    });
    const pool = eligiblePool.slice(0, Math.min(options.maxAttempts ?? 12, execution.searchRun?.remainingImageRequests() ?? 12));
    const selected: Array<{ candidate: UnifiedCandidate; image: Awaited<ReturnType<VisualCandidateImagePort["load"]>> }> = [];
    const failures: Array<{ code: VisualCandidateImageFailureCode; sourceHost?: string; phase?: "DNS" | "REQUEST" | "BODY" }> = [];
    let attempted = 0;
    let downloaded = 0;
    let outputBudgetSkipped = 0;
    let duplicateContentSkipped = 0;
    const contentKeys = options.contentKeys ?? new Set<string>();
    let encodedChars = 0;
    // Fill failed/oversized image slots from the existing bounded pool before
    // spending the one relaxed retrieval. Only returned images count as reviewed.
    for (let offset = 0; offset < pool.length && selected.length < limit;) {
      if (execution.searchRun?.canRead("IMAGE") === false) break;
      const batch = pool.slice(offset, offset + limit - selected.length);
      offset += batch.length;
      const loaded = await Promise.all(batch.map(async (candidate) => {
        const imageUrl = candidateImageUrl(candidate)!;
        attempted += 1;
        attemptedKeys.add(visualCandidateKey(candidate));
        try {
          const read = (signal?: AbortSignal) => visualCandidateImages.load(imageUrl, {
            ...(signal === undefined ? {} : { signal }),
            maxDataChars: Math.floor(((options.maxDataChars ?? MAX_VISUAL_CANDIDATE_OUTPUT_DATA_CHARS) - encodedChars) / batch.length)
          });
          const image = await (execution.searchRun === undefined ? read() : execution.searchRun.read("IMAGE", imageUrl, read,
            { retryTransient: isRetryableVisualImageFailure }));
          return { candidate, image };
        } catch (error) {
          let sourceHost: string | undefined;
          try { sourceHost = new URL(imageUrl).hostname.toLocaleLowerCase("en-US"); } catch { /* safe code only */ }
          failures.push(error instanceof VisualCandidateImageError
            ? { code: error.code, ...(error.phase === undefined ? {} : { phase: error.phase }),
              ...(error.sourceHost === undefined ? {} : { sourceHost: error.sourceHost }) }
            : { code: error instanceof SearchReadTimeoutError ? "REQUEST_TIMEOUT"
              : error instanceof SearchBudgetError ? "REQUEST_ABORTED" : "REQUEST_FAILED", ...(sourceHost === undefined ? {} : { sourceHost }) });
          return undefined;
        }
      }));
      execution.searchRun?.throwIfCancelled();
      for (const entry of loaded) {
        if (entry === undefined) continue;
        downloaded += 1;
        const productHash = visualProductHash(entry.candidate);
        const imageSha256 = createHash("sha256").update(Buffer.from(entry.image.data, "base64")).digest("hex");
        // Dedup raw response bytes: output resizing budgets differ between rounds.
        // Legacy injected ports may not expose a source hash; their output stays the fallback.
        const sourceSha256 = entry.image.sourceContentSha256;
        const contentKey = `${productHash}:${sourceSha256 !== undefined && /^[a-f0-9]{64}$/u.test(sourceSha256)
          ? sourceSha256 : imageSha256}`;
        if (contentKeys.has(contentKey)) {
          duplicateContentSkipped += 1;
          execution.searchRun?.recordVisualStage("IMAGES_DUPLICATED", [{ productHash, imageSha256 }],
            options.round === undefined ? {} : { round: options.round });
          continue;
        }
        if (encodedChars + entry.image.data.length > (options.maxDataChars ?? MAX_VISUAL_CANDIDATE_OUTPUT_DATA_CHARS)) {
          outputBudgetSkipped += 1;
          continue;
        }
        selected.push(entry);
        contentKeys.add(contentKey);
        encodedChars += entry.image.data.length;
      }
    }
    execution.searchRun?.throwIfCancelled();
    execution.searchRun?.noteUnattemptedImages(eligiblePool.filter((candidate) =>
      !attemptedKeys.has(visualCandidateKey(candidate))).length);
    const failureCounts = new Map<string, { code: VisualCandidateImageFailureCode; sourceHost?: string; phase?: "DNS" | "REQUEST" | "BODY"; count: number }>();
    for (const failure of failures) {
      const key = `${failure.code}:${failure.sourceHost ?? ""}:${failure.phase ?? ""}`;
      const existing = failureCounts.get(key);
      if (existing === undefined) failureCounts.set(key, { ...failure, count: 1 });
      else existing.count += 1;
    }
    execution.searchRun?.recordVisualStage("IMAGES_PRESENTED", selected.map(({ candidate, image }) => ({
      productHash: visualProductHash(candidate),
      imageUrlHash: createHash("sha256").update(candidateImageUrl(candidate) ?? "").digest("hex"),
      imageSha256: createHash("sha256").update(Buffer.from(image.data, "base64")).digest("hex")
    })), options.round === undefined ? {} : { round: options.round });
    return {
      entries: selected.map(({ candidate, image }) => ({ candidate, image })),
      attemptedKeys,
      diagnostics: {
        attempted,
        loaded: selected.length,
        downloaded,
        outputBudgetSkipped,
        duplicateContentSkipped,
        failures: [...failureCounts.values()]
      }
    };
  };
  const mergeVisualImageLoadDiagnostics = (
    ...items: Array<{
      attempted: number;
      loaded: number;
      downloaded: number;
      outputBudgetSkipped: number;
      duplicateContentSkipped: number;
      failures: Array<{ code: VisualCandidateImageFailureCode; sourceHost?: string; phase?: "DNS" | "REQUEST" | "BODY"; count: number }>;
    }>
  ) => {
    const failureCounts = new Map<string, { code: VisualCandidateImageFailureCode; sourceHost?: string; phase?: "DNS" | "REQUEST" | "BODY"; count: number }>();
    for (const item of items) {
      for (const failure of item.failures) {
        const key = `${failure.code}:${failure.sourceHost ?? ""}:${failure.phase ?? ""}`;
        const existing = failureCounts.get(key);
        if (existing === undefined) failureCounts.set(key, { ...failure });
        else existing.count += failure.count;
      }
    }
    return {
      attempted: items.reduce((total, item) => total + item.attempted, 0),
      loaded: items.reduce((total, item) => total + item.loaded, 0),
      downloaded: items.reduce((total, item) => total + item.downloaded, 0),
      outputBudgetSkipped: items.reduce((total, item) => total + item.outputBudgetSkipped, 0),
      duplicateContentSkipped: items.reduce((total, item) => total + item.duplicateContentSkipped, 0),
      failures: [...failureCounts.values()]
    };
  };
  const visualCandidateContent = (
    message: string,
    entries: Array<{
      candidateId: string;
      candidate: UnifiedCandidate;
      image: { data: string; mimeType: "image/jpeg" | "image/png" | "image/webp" };
    }>
  ) => [
    { type: "text" as const, text: message },
    ...entries.flatMap((entry, index) => [
      {
        type: "text" as const,
        text: `Candidate ${index + 1} | ${entry.candidateId} | ${candidateTitle(entry.candidate)} | ${candidateMerchant(entry.candidate)}`
      },
      { type: "image" as const, data: entry.image.data, mimeType: entry.image.mimeType }
    ])
  ];
  const visualCandidateDescriptors = (entries: Array<{
    candidateId: string;
    candidate: UnifiedCandidate;
    image: { mimeType: "image/jpeg" | "image/png" | "image/webp" };
  }>) => entries.map((entry) => ({
    candidateId: entry.candidateId,
    title: candidateTitle(entry.candidate),
    merchant: candidateMerchant(entry.candidate),
    source: entry.candidate.source,
    mimeType: entry.image.mimeType
  }));

  server.registerResource(
    "findcheap-product-cards",
    PRODUCT_CARD_UI_URI,
    {
      title: "FindCheap Agent identity-labeled product cards",
      description: "Interactive cards that separate exact, discovery, and similar Shopify product results.",
      mimeType: "text/html;profile=mcp-app"
    },
    async () => ({
      contents: [{
        uri: PRODUCT_CARD_UI_URI,
        mimeType: "text/html;profile=mcp-app",
        text: PRODUCT_CARD_HTML,
        _meta: {
          ui: {
            prefersBorder: false,
            csp: {
              connectDomains: [],
              resourceDomains: dependencies.productCardResourceDomains ?? PRODUCT_CARD_RESOURCE_DOMAINS
            }
          }
        }
      }]
    })
  );

  toolRegistrar.registerTool(
    "search_products",
    {
      title: "FindCheap",
      description: "For an initial text search, load the required Skill and match current user-message language. Follow required host announcements; add no optional progress narration. Before nonempty cards, show only the host Search products label and current requirements; keep relevant limitations on cards. Follow required host instructions; skip optional Memory, repository, log, task and cache reads. Do not repeat progress or narrate the tool sequence. Text-only product-search entrypoint; call once. Pass a direct official product URL unchanged as query. Set compareMerchants=true only for an explicit cross-merchant price-comparison request; COMPARISON_INCOMPLETE retains found offers but requires bounded recovery or an honest comparison limitation. Retain findcheapContext from text content or the structuredContent of this same result; it contains the exact references for clarification answers, selected products and web recovery. Internal IDs are tool arguments, never user-facing prose. A tool error is not a zero-result search; report the returned safe error honestly. For a newly attached image use search_visual_candidates and then finalize_visual_search instead. Always pass responseLocale from the user's current message, even when query is translated into English for catalog retrieval. Keep query focused on product identity; pass use, budget, and size only in their typed fields. Pass family in productType, explicit brand in brand with brandMode=REQUIRED, objective must-have attributes in requiredFeatures, explicit disqualifiers in excludedFeatures, and preferences in preferences. One requiredFeatures entry may contain explicitly acceptable alternatives separated by 'or' and must stay under 160 characters. Pass primaryUse, preferredSize, requiredSize, maxItemPriceCents, or budgetFlexible only when the user states them; never infer them. A size explicitly required or selected from the clarification belongs in requiredSize; use preferredSize only when the user says it is flexible or merely preferred. Broad high-variance products return one clarification before source search when decision constraints are missing. Symptom wording must retain its meaning: 改善干燥毛躁 or reduce dryness and frizz is not for dry hair, which means suitability for that hair type. Explicit cosplay in primaryUse is a required use. Same-category identity refinement uses CONTINUE with the full updated identity query; a different character or model requires CORRECT. EV discovery may proceed after one clarification, but missing compatibility prevents purchase recommendations. Full-size or large-package requests exclude sample, trial-size, and tester products. Never put a brand in productType or requiredFeatures. Use CONTINUE_PREVIOUS_PRODUCT when the user adds budget, use, size, or constraints; pass the returned renderId as parentRenderId or the returned goalId plus goalRevision, including after NEEDS_CLARIFICATION. On MISSING_REFERENCE_CONTEXT/REUSE_ORIGINAL_REFERENCE, correct the omitted reference once from that original receipt; never guess a latest snapshot or switch to NEW_PRODUCT to bypass the error. The server inherits prior typed requirements; use clearConstraints only for explicitly withdrawn requirements. CORRECT_PREVIOUS_PRODUCT requires the same explicit reference; NEW_PRODUCT starts an independent goal. Shoe size requires a stated US/UK/EU system, never display inches. Missing soft evidence remains a limitation-labeled DISCOVERY_MATCH; hard conflicts exclude. Return at most 8 cards. Official tier requires an explicitly requested brand; tier two allows reviewed merchants including manually verified approved Awin merchants, or eligible high-rated products. Product ratings do not establish independent merchant trust; label the actual rating subject. Missing item price means no card; unknown delivered total alone does not remove a priced card. Best-value follows verified fit. Missing hard evidence belongs in RESEARCH_ONLY, not fulfilled matches. COMPLETE reports a bounded source request, not exhaustive product coverage. Display tier never determines the primary choice; highlight the backend-selected primary in its original display group; never reorder cards or change ordinal references. When recommendation.state is READY, recommend only recommendation.primarySelectionId; MATCHES_AVAILABLE means matching choices without a primary, not research-only results. Otherwise recommend none. Equivalent fit and trust prefer a confirmed after-Coupon price, then the raw item price; merchant-level or unconfirmed offers never override a lower price. Use selectionMode=LOWEST_PRICE only when requested; it never collapses the three display tiers. maxItemPriceCents is a ceiling, never a spending target. Only RESEARCH_ONLY entries are research leads. A high-rated eligible match may appear in tier two without independent merchant verification or quote permission. Never recommend a product absent from returned cards. Commercial relationships never affect relevance or ranking. Reuse selectionId for exact follow-ups; use renderId for UI-synced choices and renderId plus one-based position for ordinal references. Never print IDs or search a selected title again.",
      inputSchema: SearchProductsInputSchema,
      outputSchema: ShopifyProductsOutputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      },
      _meta: {
        ui: { resourceUri: PRODUCT_CARD_UI_URI },
        "openai/outputTemplate": PRODUCT_CARD_UI_URI,
        "openai/toolInvocation/invoking": "FindCheap",
        "openai/toolInvocation/invoked": "FindCheap"
      }
    },
    async (rawInput, extra) => {
      let parsedInput = normalizePackageRequirements(SearchProductsInputSchema.parse(rawInput));
      if (parsedInput.contextMode === "NEW_PRODUCT" && (parsedInput.parentRenderId !== undefined ||
        parsedInput.goalId !== undefined || parsedInput.goalRevision !== undefined)) return toolError("INVALID_ARGUMENTS");
      if (parsedInput.removeRequiredFeatures.length > 0 && !["CONTINUE_PREVIOUS_PRODUCT", "CORRECT_PREVIOUS_PRODUCT"].includes(parsedInput.contextMode)) return toolError("INVALID_ARGUMENTS");
      if (["CONTINUE_PREVIOUS_PRODUCT", "CORRECT_PREVIOUS_PRODUCT"].includes(parsedInput.contextMode)) {
        if (parsedInput.parentRenderId === undefined && parsedInput.goalId === undefined) return toolError("MISSING_REFERENCE_CONTEXT");
        const parent = resolveSearchParent(parsedInput);
        if (parent?.request === undefined || parent.historyExpiresAt <= now().getTime()) return unavailableReference(parent);
        try { parsedInput = mergeSearchRequirements({ ...parsedInput, parentRenderId: parent.content.renderId }, parent.request,
          parent.content.products.map(product => ({ title: product.title, brand: productIdentityBrand({
            sourceHost: product.sourceHost, merchantTrust: { level: product.merchantTrust.level,
              verification: product.merchantTrust.verification, evidence: product.merchantTrust.evidence },
            ...(product.brand === undefined ? {} : { brand: product.brand }) }) }))); }
        catch (error) { return toolError(error instanceof Error && error.message === "PRODUCT_CONTEXT_CONFLICT"
          ? "PRODUCT_CONTEXT_CONFLICT" : "INVALID_ARGUMENTS"); }
      }
      parsedInput = { ...parsedInput, query: resolveSonyFamilyQuery(parsedInput.query, parsedInput.productType) };
      let input = parsedInput.visualInput === undefined
        ? parsedInput
        : { ...parsedInput, visualInput: enforceVisualEvidenceAuthority(parsedInput.visualInput) };
      if (input.visualInput !== undefined) {
        const details = { version: 1, phase: "INPUT_VALIDATION", recovery: {
          action: "USE_VISUAL_TOOL", requiredNextTool: "search_visual_candidates", maxAttempts: 1
        } };
        const message = input.responseLocale === "zh-CN"
          ? "图片搜索（包括品类纠正）须使用视觉候选工具。保留本次 visualInput、需求和原快照引用，去掉 limit，调用 search_visual_candidates 一次；尚未检索，不是零结果。"
          : "Image searches, including category corrections, require the visual candidate tool. Keep visualInput, requirements and the original snapshot reference, omit limit, and call search_visual_candidates once. No search ran; this is not a zero result.";
        return { isError: true, content: [{ type: "text" as const, text: `[VISUAL_TOOL_REQUIRED] ${message}\n${JSON.stringify(details)}` }],
          _meta: { "findcheap/errorCode": "INVALID_ARGUMENTS", "findcheap/errorDetails": details } };
      }
      if (input.contextMode === "AMBIGUOUS") {
        const previous = input.parentRenderId === undefined ? undefined : renderSnapshots.get(input.parentRenderId);
        const requirements = previous !== undefined && previous.expiresAt > now().getTime()
          ? previous.request?.requiredFeatures.join(", ") : undefined;
        return shopifyClarificationResult(input.selectionMode, input, {
          question: input.parentRenderId === undefined ? input.responseLocale === "zh-CN"
            ? "这是新商品，还是继续讨论之前的商品？" : "Is this a new product, or a follow-up about the previous product?"
            : input.responseLocale === "zh-CN"
            ? `是继续保留之前的要求，还是替换购买用途？请说明哪些要求不再需要。${requirements ? `之前的必要要求：${requirements}。` : ""}`
            : `Keep the previous requirements, or replace the shopping use? Which requirements are no longer needed?${requirements ? ` Previous required features: ${requirements}.` : ""}`,
          evidence: "product context is ambiguous",
          source: "UNIFIED_PRODUCT_SEARCH"
        });
      }
      const purchaseClarification = highVarianceClarification(input);
      if (ambiguousShoeSize(input.requiredSize, input.productType ?? input.query)) {
        const response = shopifyClarificationResult(input.selectionMode, input, {
          question: input.responseLocale === "zh-CN" ? "你说的尺码是美码 US、英码 UK 还是欧码 EU？" : "Is that a US, UK or EU shoe size?",
          evidence: "shoe size system not specified", source: "UNIFIED_PRODUCT_SEARCH"
        });
        return { ...response, structuredContent: rememberSnapshot(response.structuredContent, emptyShopifySearchResult(input), undefined, undefined, input) };
      }
      const chargingClarificationAsked = input.parentRenderId !== undefined &&
        renderSnapshots.get(input.parentRenderId)?.chargingClarificationAsked === true;
      if (purchaseClarification !== undefined &&
        (purchaseClarification.kind !== "EV_COMPATIBILITY" || !chargingClarificationAsked)) {
        const response = shopifyClarificationResult(input.selectionMode, input, {
          ...purchaseClarification,
          source: "UNIFIED_PRODUCT_SEARCH"
        });
        return { ...response, structuredContent: rememberSnapshot(response.structuredContent, emptyShopifySearchResult(input),
          undefined, undefined, input, undefined, purchaseClarification.kind === "EV_COMPATIBILITY") };
      }
      if (
        input.visualInput === undefined &&
        input.comparisonMode === "SAME_PRODUCT" &&
        !hasSpecificProductIdentity(input.query)
      ) {
        return shopifyClarificationResult(input.selectionMode, input);
      }
      const searchRun = new SearchRun();
      return searchRun.withRequestSignal(extra.signal, async () => {
        const execution = await runUnifiedSearch({ ...input, searchRun });
        if (execution.resolvedRequest !== undefined) input = execution.resolvedRequest;
        searchRun.throwIfCancelled();
        const { response, enriched } = await buildUnifiedResponse(input, execution);
        searchRun.throwIfCancelled();
        if (response.structuredContent.products.length === 0) {
          const content = rememberSnapshot(response.structuredContent, enriched.result, undefined, undefined, input, execution.candidates, false, searchRun);
          return { ...response, content: [{ type: "text" as const, text: content.message }], structuredContent: content };
        }
        const preflight = await preflightQuoteCapabilities(response.structuredContent, searchRun);
        searchRun.throwIfCancelled();
        const recommendation = choosePrimaryRecommendation(preflight.content.products, now().getTime());
        const content = rememberSnapshot({
          ...preflight.content,
          recommendation: {
            state: recommendation.state,
            reasonCodes: recommendation.reasonCodes
          }
        }, enriched.result, preflight.resolvedAwinProducts, recommendation.primaryProductIndex, input, execution.candidates, false, searchRun);
        return {
          ...response,
          _meta: { ...searchTraceMeta(execution, response._meta["findcheap/searchTrace"].outcome, { returned: content.products.length }),
            "findcheap/quotePreflight": preflight.diagnostics },
          content: [{
            type: "text" as const,
            text: `${content.message}\n${recommendationInstruction(content)}\nUse structured selection references for follow-ups; never print them or search titles.`
          }],
          structuredContent: content
        };
      });
    }
  );

  if (backend.product.webProducts !== undefined) {
    toolRegistrar.registerTool("begin_web_search", {
      title: "Authorize bounded web recovery",
      description: "Only after a search result returns recovery.action=REQUEST_WEB_SEARCH. Pass that immutable renderId. Requests explicit consent through the host; the plugin cannot confirm whether a form is displayed. Never promise a popup or attribute a host decline to the user. No model boolean can grant permission. Inventory Chrome before requesting a lease, retain its actual browser ID, and do not open pages until READY. Reserve 15 seconds for server verification; report late or failed discovery with a zero-IO complete_web_search closure. Follow returned queries and limits; never reset the budget with another search call. For image searches, send descriptions only, never upload the reference image. Recovered visual candidates must pass the remaining visual review before recommendation.",
      inputSchema: z.object({ renderId: z.string().uuid() }).strict(),
      outputSchema: z.object({ status: WebConsentStatusSchema, message: z.string(), retryable: z.boolean(), attempt: z.number().int().min(0).max(2),
        diagnostics: z.object({ formSupported: z.boolean(), durationMs: z.number().int().nonnegative(),
          hostAction: z.enum(["NOT_REQUESTED", "ACCEPT_TRUE", "ACCEPT_FALSE", "DECLINE", "CANCEL", "ERROR"]) }).strict().optional(),
        webSessionId: z.string().uuid().optional(), expiresAt: z.string().datetime().optional(), queries: z.array(z.string()).max(2).optional(),
        limits: z.object({ durationMs: z.number().int().min(1).max(60000), merchantPages: z.literal(5), results: z.literal(3), discoveryQueries: z.literal(2) }).optional() }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    }, async ({ renderId }, extra) => {
      const parent = renderSnapshots.get(renderId);
      if (parent?.request === undefined || parent.expiresAt <= now().getTime()) return unavailableReference(parent);
      const searchRun = parent.searchRun;
      if (searchRun === undefined) return toolError("TOOL_REQUEST_REJECTED");
      const zh = parent.content.locale === "zh-CN";
      const startedAt = Date.now();
      const elicitation = server.server.getClientCapabilities()?.elicitation;
      const formSupported = elicitation !== undefined && (Object.keys(elicitation).length === 0 || elicitation.form !== undefined);
      let hostAction: "NOT_REQUESTED" | "ACCEPT_TRUE" | "ACCEPT_FALSE" | "DECLINE" | "CANCEL" | "ERROR" = "NOT_REQUESTED";
      const consentDiagnostics = () => ({ formSupported, durationMs: Math.max(0, Date.now() - startedAt), hostAction });
      const logConsent = (status: z.infer<typeof WebConsentStatusSchema>, retryable: boolean, attempt: number) =>
        process.stderr.write(`[findcheap-web-consent] ${JSON.stringify({ renderId, status, retryable, attempt, ...consentDiagnostics() })}\n`);
      const reply = (status: z.infer<typeof WebConsentStatusSchema>, retryable = false, attempt = 0) => {
        const messages: Record<z.infer<typeof WebConsentStatusSchema>, [string, string]> = {
          READY: ["Authorized.", "已获授权。"],
          PERMISSION_DENIED: ["The host did not grant permission. We cannot confirm whether the authorization form was displayed or infer a user action from this response. No recovery started; do not request again for this shopping goal, including derived snapshots.", "宿主未授予本次授权。无法确认授权表单是否显示，也不能据此判断用户操作。未启动补搜；不再为同一购物目标及其派生快照重复申请。"],
          PERMISSION_CANCELLED: ["The authorization request was cancelled. No recovery started.", "授权请求已取消，未启动补搜。"],
          PERMISSION_UNAVAILABLE: ["Host consent is unavailable. No recovery started; this does not prove product absence.", "当前宿主不支持本次授权请求，未启动补搜；这不代表商品不存在。"],
          PERMISSION_TIMEOUT: ["The authorization request timed out. No recovery started.", "授权请求超时，未启动补搜。"],
          PERMISSION_ERROR: ["The authorization interface failed. This is not evidence of user refusal; no recovery started.", "授权接口异常，不能据此判断用户拒绝；未启动补搜。"],
          APPROVAL_PENDING: ["An authorization request is already pending. Do not create another.", "已有授权请求正在等待处理，请勿重复申请。"],
          ALREADY_USED: ["This recovery was already authorized or used. Do not create another session.", "本次补搜已授权或已使用，不得创建新的补搜会话。"],
          EXPIRED: ["This recovery has expired. Do not renew its budget.", "本次补搜已过期，不得重置预算。"],
          RETRY_LIMIT_REACHED: ["The authorization attempt limit was reached. No recovery started.", "授权申请已达次数上限，未启动补搜。"]
        };
        const message = messages[status][zh ? 1 : 0] + (retryable
          ? zh ? " 可在同一结果上重试授权一次；在 READY 前不得打开浏览器。" : " One consent retry is available on the same results; do not open a browser before READY."
          : "");
        logConsent(status, retryable, attempt);
        return { content: [{ type: "text" as const, text: message }], structuredContent: { status, message, retryable, attempt, diagnostics: consentDiagnostics() } };
      };
      const scope = parent.content.goalId ?? renderId;
      if (parent.content.recovery?.action !== "REQUEST_WEB_SEARCH" && parent.content.recovery?.reason !== "AUTHORIZATION_STOPPED") {
        return toolError("TOOL_REQUEST_REJECTED");
      }
      const currentConsent = webSessions.current(scope);
      if (searchRun.signal.aborted) return reply("PERMISSION_CANCELLED");
      if (searchRun.remainingServiceMs() <= 0) return reply("EXPIRED");
      if (currentConsent !== undefined && !currentConsent.retryable) return reply(currentConsent.status, false, currentConsent.attempt);
      if (parent.content.recovery?.action !== "REQUEST_WEB_SEARCH") return toolError("TOOL_REQUEST_REJECTED");
      if (parent.request.visualInput !== undefined && (parent.visualRecovery === undefined ||
        parent.visualRecovery.expiresAt <= now().getTime() || parent.visualRecovery.attempt !== 1 ||
        !searchRun.canRead("IMAGE"))) return toolError("TOOL_REQUEST_REJECTED");
      return searchRun.withRequestSignal(extra.signal, async () => {
        const queries = webSearchQueries(parent.request!);
        const lease = await webSessions.begin(renderId, async () => {
          if (!formSupported) throw new McpError(ErrorCode.MethodNotFound, "Host form consent unavailable");
          const answer = await searchRun.withVerifiedUserWait(() => server.server.elicitInput({ mode: "form",
            message: (zh ? `${parent.content.recovery?.reason === "COMPARISON_INCOMPLETE"
              ? "已保留核实的商品，但可信商家比价尚不完整。" : "现有来源尚未完成符合要求的商品核验。"}允许一次 Chrome 全网补搜吗？授权后最多 60 秒、2 次检索、5 个商家商品页；只读、不购买。检索：${queries.join(" / ")}`
              : `Allow one Chrome web recovery? Up to 60 seconds after approval, 2 discovery queries and 5 merchant product pages. Read-only; no purchases. Queries: ${queries.join(" / ")}`) +
              (parent.request!.visualInput === undefined ? "" : zh ? " 仅发送商品描述，不上传参考图片；商品仍需图片复核。" : " Descriptions only; do not upload the reference image. Candidates still require visual review."),
            requestedSchema: { type: "object", properties: { approved: { type: "boolean", title: zh ? "允许本次补搜" : "Allow this recovery", default: false } }, required: ["approved"] }
          }, { timeout: 25_000, maxTotalTimeout: 25_000, resetTimeoutOnProgress: false,
            relatedRequestId: extra.requestId, signal: extra.signal })).catch((error: unknown) => {
            hostAction = "ERROR";
            if (extra.signal.aborted) return { action: "cancel" as const };
            throw error;
          });
          if (extra.signal.aborted || answer.action === "cancel") { hostAction = "CANCEL"; return "CANCEL"; }
          if (answer.action === "decline") { hostAction = "DECLINE"; return "DECLINE"; }
          hostAction = "ERROR";
          const content = z.object({ approved: z.boolean() }).strict().parse(answer.content);
          hostAction = content.approved ? "ACCEPT_TRUE" : "ACCEPT_FALSE";
          return content.approved ? "ACCEPT" : "DECLINE";
        }, () => searchRun.remainingServiceMs(), scope);
        searchRun.throwIfCancelled();
        if (lease.status !== "READY") return reply(lease.status, lease.retryable, lease.attempt);
        if (renderSnapshots.get(renderId) !== parent || parent.expiresAt <= now().getTime()) {
          webSessions.forget(renderId); return unavailableReference(parent);
        }
        const message = zh ? "已获授权。用 Chrome 搜索所给查询；提交最多 5 个不同商家的直接商品链接给 complete_web_search。不得把摘要当作价格或功效证据；到期即停。"
          : "Authorized. Discover with Chrome using the supplied queries; submit up to 5 direct product URLs from distinct merchants to complete_web_search. Snippets are not price or efficacy evidence. Stop at expiry.";
        logConsent("READY", false, lease.attempt);
        return { content: [{ type: "text" as const, text: message }], structuredContent: { status: "READY" as const, message,
          diagnostics: consentDiagnostics(),
          retryable: false, attempt: lease.attempt,
          webSessionId: lease.token!, expiresAt: new Date(lease.deadline!).toISOString(), queries,
          limits: { ...WEB_SEARCH_LIMITS, durationMs: Math.max(1, Math.floor(lease.deadline! - now().getTime())) } } };
      });
    });
    toolRegistrar.registerTool("complete_web_search", {
      title: "Verify recovered products",
      description: "Complete one authorized begin_web_search lease. Successful page verification must start before expiry. For BROWSER_UNAVAILABLE, DISCOVERY_TIMEOUT or DISCOVERY_CANCELLED, pass discoveryOutcome and urls=[] once; this zero-IO failure closure may occur after lease expiry while the original snapshot remains valid and cannot renew access. Submit only direct HTTPS merchant product URLs, at most 5 distinct merchants; pass [] when discovery found none. No prices, descriptions, trust claims or rewritten requirements. Server reads each exact page against original requirements. For an image request, products stay empty until the returned visualReview.requiredNextTool completes; review every returned candidate image. Never upload the user's reference image. Do not repeat recovery or erase the original snapshot.",
      inputSchema: z.object({ renderId: z.string().uuid(), webSessionId: z.string().uuid(), urls: z.array(WebProductUrlSchema).max(5),
        discoveryOutcome: WebDiscoveryOutcomeSchema.default("COMPLETED") }).strict(),
      outputSchema: ShopifyProductsOutputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      _meta: { ui: { resourceUri: PRODUCT_CARD_UI_URI }, "openai/outputTemplate": PRODUCT_CARD_UI_URI }
    }, async ({ renderId, webSessionId, urls, discoveryOutcome }, extra) => {
      const parent = renderSnapshots.get(renderId);
      if (parent?.request === undefined || parent.expiresAt <= now().getTime()) return unavailableReference(parent);
      const searchRun = parent.searchRun;
      if (searchRun === undefined) return toolError("TOOL_REQUEST_REJECTED");
      // A host-reported discovery failure is bookkeeping only. An expired lease
      // can close here, but can never pass through to page reads or renew consent.
      if (discoveryOutcome !== "COMPLETED") {
        if (urls.length !== 0 || !webSessions.closeFailedDiscovery(renderId, webSessionId)) return toolError("TOOL_REQUEST_REJECTED");
        const message = parent.content.locale === "zh-CN" ? "网页补搜未完成，已保留现有结果。"
          : "Web search did not finish. Existing results are retained.";
        const content: ProductCardContent = { ...parent.content, message,
          recovery: { qualified: 0, recommendable: 0, awaitingVerification: 0, ...parent.content.recovery,
            action: "REPORT_INCOMPLETE", reason: "SOURCE_UNAVAILABLE", discoveryOutcome } };
        return { structuredContent: content, content: [{ type: "text" as const, text: message }],
          _meta: { "findcheap/webDiscovery": { outcome: discoveryOutcome, origin: "CALLER_REPORTED", pageReads: 0 } } };
      }
      return searchRun.withRequestSignal(extra.signal, async () => {
        if (searchRun.remainingServiceMs() <= 0) {
          const failure = toolError("TOOL_REQUEST_REJECTED");
          const message = parent.content.locale === "zh-CN"
            ? "本次检索预算已用尽，检索尚不完整；保留原有商品信息，不能据此判断商品不存在。"
            : "This search budget is exhausted and retrieval is incomplete. Previous product information is retained; this does not prove product absence.";
          return { ...failure, content: [{ type: "text" as const, text: message }],
            _meta: { ...failure._meta, "findcheap/searchTrace": searchRun.diagnostics() } };
        }
        const visual = parent.visualRecovery;
        if (parent.request!.visualInput !== undefined && (visual === undefined || visual.expiresAt <= now().getTime() ||
          visual.attempt !== 1 || visual.execution.searchRun?.canRead("IMAGE") !== true)) return toolError("TOOL_REQUEST_REJECTED");
        const leaseRemaining = webSessions.consume(renderId, webSessionId);
        if (leaseRemaining === undefined) return toolError("TOOL_REQUEST_REJECTED");
        const remaining = Math.min(leaseRemaining, searchRun.remainingServiceMs());
        const webDeadline = now().getTime() + remaining;
        const request = parseStoredSearchRequest({ ...parent.request, contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: renderId });
        const pages: WebProductPagePort = { read: (url, pageRequest, pageSignal) => searchRun.read("OFFICIAL", `web-recovery:${url}`, signal => {
          const combined = AbortSignal.any([signal, pageSignal]);
          combined.throwIfAborted();
          return awaitWithSignal(backend.product.webProducts!.read(url, pageRequest, combined), combined);
        }) };
        const found = await readWebCandidates(urls, request, pages, visual === undefined ? remaining : Math.min(remaining, 15_000), { signal: searchRun.signal });
        searchRun.throwIfCancelled();
        if (visual !== undefined) {
          delete parent.visualRecovery;
          const execution = evaluateRecoveredProducts(request, found.products, found.unavailable > 0, { deferVisualFiltering: true });
          execution.searchRun = visual.execution.searchRun!;
          execution.sourceStatus = { ...visual.execution.sourceStatus, web: found.unavailable > 0 ? "PARTIAL" : "COMPLETE" };
          if (visual.execution.sourceFailures !== undefined) execution.sourceFailures = visual.execution.sourceFailures;
          execution.webRecovery = { submitted: urls.length, verified: found.products.length, rejected: found.rejected, unavailable: found.unavailable };
          for (const candidate of execution.candidates) visual.retrievedProductHashes.add(visualProductHash(candidate));
          // One batch of at most three image reads uses the existing 10-second
          // per-read cap. Do not start it without room inside the original lease.
          const imageBudgetAvailable = webDeadline - now().getTime() >= 10_500;
          const loaded = await loadVisualCandidates(execution, visual.imageAttemptedKeys, MAX_RELAXED_VISUAL_CANDIDATES,
            { contentKeys: visual.imageContentKeys, round: 2, maxAttempts: imageBudgetAvailable ? MAX_RELAXED_VISUAL_CANDIDATES : 0 });
          searchRun.throwIfCancelled();
          const leaseExhausted = !imageBudgetAvailable || now().getTime() >= webDeadline;
          if (leaseExhausted) loaded.entries = [];
          const imageAttemptedKeys = new Set([...visual.imageAttemptedKeys, ...loaded.attemptedKeys]);
          const { response, enriched } = await buildUnifiedResponse(request, { ...execution, candidates: [] },
            loaded.entries.length > 0 ? "REVIEW_REQUIRED" : "NO_LOADABLE_IMAGES");
          if (loaded.entries.length === 0) {
            const failure = leaseExhausted ? { code: "SEARCH_BUDGET_EXHAUSTED" as const,
              message: request.responseLocale === "zh-CN" ? "网页补搜剩余时间不足以完成图片核验，未生成推荐；这不代表商品不存在。"
                : "The web recovery lease has insufficient time for image verification. No recommendation was generated; this does not prove absence." }
              : visualSearchFailure(execution, imageFailureCode(loaded.diagnostics), request.responseLocale ?? "en-US");
            const content = rememberVisualFailure({ ...response.structuredContent, message: failure.message, visualSearchFailure: failure }, enriched.result,
              { ...visual, input: request, execution, attempt: 2, candidates: new Map(), imageAttemptedKeys });
            return { ...response, structuredContent: content, content: [{ type: "text" as const, text: content.message }],
              _meta: { ...searchTraceMeta(execution, leaseExhausted ? "BUDGET_EXHAUSTED" : "NO_LOADABLE_IMAGES"), "findcheap/visualImageLoadDiagnostics": loaded.diagnostics,
                ...visualEvaluationMeta(execution, visual.retrievedProductHashes, [], []) } };
          }
          pruneVisualSearchSnapshots();
          const visualSessionId = randomUUID();
          const expiresAt = Math.min(visual.expiresAt, now().getTime() + VISUAL_SEARCH_SNAPSHOT_TTL_MS);
          const entries = loaded.entries.map(entry => ({ ...entry, candidateId: randomUUID() }));
          searchRun.throwIfCancelled();
          visualSearchSnapshots.set(visualSessionId, { ...visual, expiresAt, input: request,
            execution: { ...execution, candidates: entries.map(entry => entry.candidate) },
            candidates: new Map(entries.map(entry => [entry.candidateId, entry.candidate])), attempt: 2,
            reviewedCandidateKeys: new Set([...visual.reviewedCandidateKeys, ...entries.map(entry => visualCandidateKey(entry.candidate))]),
            imageAttemptedKeys });
          const message = request.responseLocale === "zh-CN"
            ? `网页补搜找到 ${entries.length} 个可看图候选，尚未生成推荐。必须复核全部图片，再调用 finalize_visual_search；这是最后一次图片复核。`
            : `Web recovery found ${entries.length} loadable candidates, not recommendations. Review every image and call finalize_visual_search. This is the final visual review round.`;
          return { ...response, content: visualCandidateContent(message, entries),
            _meta: { ...searchTraceMeta(execution, "REVIEW_REQUIRED"), "findcheap/visualImageLoadDiagnostics": loaded.diagnostics,
              ...visualEvaluationMeta(execution, visual.retrievedProductHashes, entries) },
            structuredContent: { ...response.structuredContent, message,
              goalId: parent.content.goalId, goalRevision: parent.content.goalRevision,
              visualReview: { stage: "RELAXED_REVIEW" as const, terminal: false as const, finalAnswerAllowed: false as const,
                requiredNextTool: "finalize_visual_search" as const, visualSessionId, expiresAt: new Date(expiresAt).toISOString(),
                candidates: visualCandidateDescriptors(entries) } } };
        }
        const execution = evaluateRecoveredProducts(request, found.products, found.unavailable > 0,
          { previousCandidates: parent.candidates ?? [] });
        execution.searchRun = searchRun;
        execution.webRecovery = { submitted: urls.length, verified: found.products.length, rejected: found.rejected, unavailable: found.unavailable };
        const { response, enriched } = await buildUnifiedResponse(request, execution);
        searchRun.throwIfCancelled();
        const zh = parent.content.locale === "zh-CN";
        const message = (zh ? `本次补搜提交 ${urls.length} 个商品链接，核验读取成功 ${found.products.length} 个，未能核验 ${found.unavailable} 个。仅代表本次有限搜索，不代表全网无货。`
          : `This recovery submitted ${urls.length} product URLs; ${found.products.length} pages verified, ${found.unavailable} unavailable. This bounded search does not establish web-wide absence.`)
          + " " + response.structuredContent.message;
        const recommendation = choosePrimaryRecommendation(response.structuredContent.products, now().getTime());
        const content = rememberSnapshot({ ...response.structuredContent, message }, enriched.result, undefined,
          recommendation.primaryProductIndex, request, execution.candidates, false, searchRun);
        return { ...response, structuredContent: content, content: [{ type: "text" as const,
          text: `${message}\n${recommendationInstruction(content)}\nRecovery finished. Preserve previous renderId and selectionIds; do not start another recovery automatically.` }] };
      });
    });
  }

  server.registerResource(
    "findcheap-product-comparison",
    PRODUCT_COMPARISON_UI_URI,
    {
      title: "FindCheap Agent evidence-backed product comparison",
      description: "A 2-4 column comparison whose facts and recommendation are generated from one immutable server snapshot.",
      mimeType: "text/html;profile=mcp-app"
    },
    async () => ({
      contents: [{
        uri: PRODUCT_COMPARISON_UI_URI,
        mimeType: "text/html;profile=mcp-app",
        text: PRODUCT_COMPARISON_HTML,
        _meta: {
          ui: {
            prefersBorder: false,
            csp: {
              connectDomains: [],
              resourceDomains: dependencies.productCardResourceDomains ?? PRODUCT_CARD_RESOURCE_DOMAINS
            }
          }
        }
      }]
    })
  );

  if (backend.capabilities.has("VISUAL_SEARCH")) toolRegistrar.registerTool(
    "search_visual_candidates",
    {
      title: "Search visual candidates",
      description: "First stage for a newly attached product image. Use the current request and its explicit receipts. Follow required host instructions; skip optional Memory, repository, task, log or cache reads. Inspect the user's image, pass structured visualInput, and call once. Never pass a local file path as visualInput.imageUrl; that field accepts only a credential-free public HTTPS URL and is normally omitted for an attached image. If the user states or image analysis strongly identifies a specific product name, preserve it in visualInput.suspectedProductName for exact official-store retrieval; never manufacture a name from generic attributes and never treat it as identity proof. Never send hardClues or negativeClues. User-stated hard constraints belong in requiredFeatures or excludedFeatures; pixel-inferred details belong in observations or softClues. The execution layer downgrades or removes model-authored hard constraints. When the user's category and the visible product family conflict, pass categoryCandidates with the 2-3 plausible families before retrieving. After the user confirms, call this visual tool with CORRECT_PREVIOUS_PRODUCT and the clarification renderId; omit categoryCandidates. Image corrections retain the original flow budget and cannot gain a third review. Record occlusions; an obscured attribute cannot be a conflict. The tool returns at most six labeled candidate images with finalAnswerAllowed=false. Compare every image, then call requiredNextTool. Do not present candidates as recommendations. Do not use this tool for text-only, Watch, or batch searches.",
      inputSchema: VisualCandidateSearchInputSchema,
      outputSchema: VisualCandidateOutputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      },
      _meta: {
        "openai/toolInvocation/invoking": "Finding visual candidates…",
        "openai/toolInvocation/invoked": "Visual candidates ready for review."
      }
    },
    async (rawInput, extra) => {
      let parsedInput = normalizePackageRequirements(VisualCandidateSearchInputSchema.parse(rawInput));
      let parentRun: SearchRun | undefined;
      if (parsedInput.contextMode === "NEW_PRODUCT" && (parsedInput.parentRenderId !== undefined ||
        parsedInput.goalId !== undefined || parsedInput.goalRevision !== undefined)) return toolError("INVALID_ARGUMENTS");
      if (parsedInput.removeRequiredFeatures.length > 0 && !["CONTINUE_PREVIOUS_PRODUCT", "CORRECT_PREVIOUS_PRODUCT"].includes(parsedInput.contextMode)) return toolError("INVALID_ARGUMENTS");
      if (["CONTINUE_PREVIOUS_PRODUCT", "CORRECT_PREVIOUS_PRODUCT"].includes(parsedInput.contextMode)) {
        if (parsedInput.parentRenderId === undefined && parsedInput.goalId === undefined) return toolError("MISSING_REFERENCE_CONTEXT");
        const parent = resolveSearchParent({ ...parsedInput, limit: 3 });
        if (parent?.request === undefined || parent.expiresAt <= now().getTime()) return unavailableReference(parent);
        parentRun = parent.searchRun;
        if (parent.request.visualInput !== undefined && parentRun === undefined) return toolError("TOOL_REQUEST_REJECTED");
        try {
          const merged = mergeSearchRequirements({ ...parsedInput, limit: 3, parentRenderId: parent.content.renderId }, parent.request);
          const { limit: _limit, ...visualRequest } = merged;
          parsedInput = VisualCandidateSearchInputSchema.parse(visualRequest);
        }
        catch (error) { return toolError(error instanceof Error && error.message === "PRODUCT_CONTEXT_CONFLICT"
          ? "PRODUCT_CONTEXT_CONFLICT" : "INVALID_ARGUMENTS"); }
      }
      const parsed = {
        ...parsedInput,
        visualInput: enforceVisualEvidenceAuthority(parsedInput.visualInput)
      };
      if (parsed.contextMode === "AMBIGUOUS") {
        throw new Error("VISUAL_CONTEXT_AMBIGUOUS");
      }
      if (parsed.visualInput.productType === undefined && parsed.productType === undefined) {
        throw new Error("VISUAL_PRODUCT_TYPE_REQUIRED");
      }
      if (visualCandidateImages === undefined) {
        const message = parsed.responseLocale === "zh-CN"
          ? "远程候选商品图片加载服务暂不可用。可改用文字搜索，或重启插件后重试；上传的参考图片未被判定为不安全。"
          : "Remote candidate-image loading is unavailable. Use text search or retry after the plugin restarts; the uploaded reference image was not rejected as unsafe.";
        return {
          content: [{ type: "text" as const, text: message }],
          structuredContent: { status: "DATA_SOURCE_UNAVAILABLE" as const, message, candidates: [] }
        };
      }
      const finalInput: SearchProductsInput = {
        ...parsed,
        limit: 3,
        allowAlternatives: parsed.allowAlternatives
      };
      const searchRun = parentRun ?? new SearchRun({ serviceBudgetMs: 180_000 });
      if (searchRun.awaitingCategoryClarification() && (parsed.contextMode !== "CORRECT_PREVIOUS_PRODUCT" ||
        parsed.visualInput.categoryCandidates !== undefined || parsed.parentRenderId === undefined ||
        !searchRun.resumeCategoryClarification(parsed.parentRenderId))) return toolError("INVALID_ARGUMENTS");
      return searchRun.withRequestSignal(extra.signal, async () => {
        if (parsed.visualInput.categoryCandidates !== undefined) {
          const types = parsed.visualInput.categoryCandidates.join(" / ");
          const clarification = shopifyClarificationResult(finalInput.selectionMode, finalInput, {
            question: parsed.responseLocale === "zh-CN" ? `图片中的商品是 ${types} 中的哪一类？`
              : `Which product family does the image show: ${types}?`,
            evidence: "visible product category is ambiguous", source: "UNIFIED_PRODUCT_SEARCH"
          });
          const content = rememberSnapshot(clarification.structuredContent, emptyShopifySearchResult(finalInput),
            undefined, undefined, finalInput, [], false, searchRun);
          if (!searchRun.beginCategoryClarification(content.renderId)) return toolError("TOOL_REQUEST_REJECTED");
          return { content: clarification.content, structuredContent: { status: "NEEDS_CLARIFICATION" as const,
            message: content.message, renderId: content.renderId, goalId: content.goalId, goalRevision: content.goalRevision, candidates: [] } };
        }
        if (searchRun.remainingVisualReviewRounds() === 0 || !searchRun.canRead("IMAGE")) {
          const execution = { ...evaluateRecoveredProducts(finalInput, [], false), searchRun };
          const { response, enriched } = await buildUnifiedResponse(finalInput, execution, "NO_CANDIDATES");
          const content = rememberVisualFailure(response.structuredContent, enriched.result, {
            expiresAt: now().getTime() + VISUAL_SEARCH_SNAPSHOT_TTL_MS, input: finalInput, execution,
            candidates: new Map(), attempt: 2, reviewedCandidateKeys: new Set(), imageAttemptedKeys: new Set(),
            imageContentKeys: new Set(), reviewedCount: 0, reviewConflictCount: 0, reviewInsufficientCount: 0,
            accepted: [], retrievedProductHashes: new Set()
          });
          return { content: [{ type: "text" as const, text: content.message }],
            _meta: searchTraceMeta(execution, "NO_CANDIDATES", { returned: 0 }), structuredContent: {
              status: "NO_IMAGE_CANDIDATES" as const, message: content.message, renderId: content.renderId,
              goalId: content.goalId, goalRevision: content.goalRevision, recovery: content.recovery,
              visualSearchOutcome: content.visualSearchOutcome, candidates: []
            } };
        }
        const searchInput = visualRetrievalSearchInput(finalInput, false, searchRun);
        let execution = await runUnifiedSearch(searchInput);
        searchRun.throwIfCancelled();
        const retrievedProductHashes = new Set((execution.reviewPool ?? execution.candidates).map(visualProductHash));
        const imageContentKeys = new Set<string>();
        // Preserve three of the shared twelve image requests for the second review.
        let imageLoad = await loadVisualCandidates(execution, new Set(), MAX_VISUAL_CANDIDATES, {
          maxAttempts: 12 - MAX_RELAXED_VISUAL_CANDIDATES, contentKeys: imageContentKeys, round: 1
        });
        let available = imageLoad.entries;
        let attempt: 1 | 2 = searchRun.remainingVisualReviewRounds() === 1 ? 2 : 1;
        const reviewedCandidateKeys = new Set(available.map((entry) => visualCandidateKey(entry.candidate)));
        const imageAttemptedKeys = new Set(imageLoad.attemptedKeys);
        if (available.length === 0) {
          // Zero loaded images and zero visual matches share the same recovery order:
          // inspect the retained original tail before spending a relaxed retrieval.
          let relaxedExecution = execution;
          let relaxedImageLoad = await loadVisualCandidates(
            execution,
            imageAttemptedKeys,
            MAX_RELAXED_VISUAL_CANDIDATES,
            { contentKeys: imageContentKeys, round: 2 }
          );
          for (const key of relaxedImageLoad.attemptedKeys) imageAttemptedKeys.add(key);
          if (relaxedImageLoad.entries.length === 0 && searchRun.canRead("IMAGE")) {
            relaxedExecution = await runUnifiedSearch(visualRetrievalSearchInput(finalInput, true, searchRun));
            for (const candidate of relaxedExecution.reviewPool ?? relaxedExecution.candidates) retrievedProductHashes.add(visualProductHash(candidate));
            const supplemental = await loadVisualCandidates(relaxedExecution, imageAttemptedKeys, MAX_RELAXED_VISUAL_CANDIDATES,
              { contentKeys: imageContentKeys, round: 2 });
            relaxedImageLoad = { ...supplemental,
              diagnostics: mergeVisualImageLoadDiagnostics(relaxedImageLoad.diagnostics, supplemental.diagnostics) };
          }
          for (const entry of relaxedImageLoad.entries) reviewedCandidateKeys.add(visualCandidateKey(entry.candidate));
          for (const key of relaxedImageLoad.attemptedKeys) imageAttemptedKeys.add(key);
          const diagnostics = mergeVisualImageLoadDiagnostics(imageLoad.diagnostics, relaxedImageLoad.diagnostics);
          if (relaxedImageLoad.entries.length === 0) {
            relaxedExecution.searchRun?.recordVisualStage("FINAL", [], { round: 2 });
            const fallbackCode = imageFailureCode(diagnostics);
            const failure = visualSearchFailure(relaxedExecution, fallbackCode, parsed.responseLocale ?? "en-US");
            const message = `${failure.message} ${parsed.responseLocale === "zh-CN" ? "未生成视觉推荐。" : "No visual recommendation was produced."}`;
            const { response, enriched } = await buildUnifiedResponse(finalInput, { ...relaxedExecution, candidates: [] }, "NO_CANDIDATES");
            const remembered = rememberVisualFailure({ ...response.structuredContent, message, visualSearchFailure: failure }, enriched.result, {
              expiresAt: now().getTime() + VISUAL_SEARCH_SNAPSHOT_TTL_MS, input: finalInput, execution: relaxedExecution,
              candidates: new Map(), attempt: 1, reviewedCandidateKeys, imageAttemptedKeys, imageContentKeys,
              reviewedCount: 0, reviewConflictCount: 0, reviewInsufficientCount: 0, accepted: [], retrievedProductHashes
            });
            return {
              content: [{ type: "text" as const, text: remembered.message }],
              _meta: { ...searchTraceMeta(relaxedExecution, fallbackCode === "NO_LOADABLE_IMAGES" ? "NO_LOADABLE_IMAGES" : "NO_CANDIDATES",
                { imageAttempts: diagnostics.attempted, imagesLoaded: diagnostics.loaded, returned: 0 }),
                "findcheap/visualImageLoadDiagnostics": diagnostics,
                ...visualEvaluationMeta(relaxedExecution, retrievedProductHashes, [], []) },
              structuredContent: {
                status: "NO_IMAGE_CANDIDATES" as const,
                message: remembered.message,
                renderId: remembered.renderId, goalId: remembered.goalId, goalRevision: remembered.goalRevision, recovery: remembered.recovery,
                candidates: [],
                visualSearchOutcome: remembered.visualSearchOutcome,
                visualSearchFailure: failure
              }
            };
          }
          execution = relaxedExecution;
          imageLoad = { entries: relaxedImageLoad.entries, diagnostics, attemptedKeys: imageAttemptedKeys };
          available = relaxedImageLoad.entries;
          attempt = 2;
        }
        pruneVisualSearchSnapshots();
        const visualSessionId = randomUUID();
        const expiresAtMs = now().getTime() + VISUAL_SEARCH_SNAPSHOT_TTL_MS;
        const candidateEntries = available.map(({ candidate, image }) => ({
          candidateId: randomUUID(),
          candidate,
          image
        }));
        const candidateMap = new Map(candidateEntries.map((entry) => [entry.candidateId, entry.candidate]));
        searchRun.throwIfCancelled();
        visualSearchSnapshots.set(visualSessionId, {
          expiresAt: expiresAtMs,
          input: finalInput,
          execution: { ...execution, candidates: candidateEntries.map((entry) => entry.candidate) },
          candidates: candidateMap,
          attempt,
          reviewedCandidateKeys,
          imageAttemptedKeys,
          imageContentKeys,
          reviewedCount: 0, reviewConflictCount: 0, reviewInsufficientCount: 0,
          accepted: [], retrievedProductHashes
        });
        pruneVisualSearchSnapshots();
        const message = `Review all ${candidateEntries.length} labeled candidate images against the user's reference image. Then call finalize_visual_search once with visualSessionId ${visualSessionId}.`;
        return {
          content: visualCandidateContent(message, candidateEntries),
          _meta: { ...searchTraceMeta(execution, "REVIEW_REQUIRED", {
            imageAttempts: imageLoad.diagnostics.attempted, imagesLoaded: available.length }),
            "findcheap/visualImageLoadDiagnostics": imageLoad.diagnostics,
            ...visualEvaluationMeta(execution, retrievedProductHashes, candidateEntries) },
          structuredContent: {
            status: "OK" as const,
            message,
            visualSessionId,
            expiresAt: new Date(expiresAtMs).toISOString(),
            candidates: visualCandidateDescriptors(candidateEntries),
            workflow: {
              state: "REVIEW_REQUIRED" as const,
              finalAnswerAllowed: false as const,
              requiredNextTool: "finalize_visual_search" as const
            }
          }
        };
      });
    }
  );

  if (backend.capabilities.has("VISUAL_SEARCH")) toolRegistrar.registerTool(
    "finalize_visual_search",
    {
      title: "Finalize visual search",
      description: "Visual-review stage for interactive image search. Use only candidate IDs and images returned by the latest tool result. Report directly visible matching and conflicting attributes. Keep each referenceEvidence and candidateEvidence to at most 160 characters. Use each attribute only once per verdict, in either matches or conflicts, never both. Obscured or low-confidence attributes cannot match or conflict. Clearly visible family, sleeve, neckline, and length conflicts exclude. Color or pattern difference alone may remain HIGHLY_SIMILAR only with a source-proven same brand and at least three independent structural matches; disclose the difference. Unknown brand cannot authorize colorway changes; merchant names and titles do not prove product brand. Same-color cross-brand structural alternatives remain allowed. POSSIBLE_SAME_ITEM additionally needs a distinguishing visible pattern, detail or mark; generic cut, color or name hints are insufficient. A visual verdict can exclude or rerank candidates, but cannot create EXACT identity. Each visual session is immutable and single-use. If the result has visualReview.finalAnswerAllowed=false, a final answer is forbidden: review every returned relaxed candidate and immediately call visualReview.requiredNextTool with its new visualSessionId. At most two visual review rounds. Reviewed HIGHLY_SIMILAR or SAME_STYLE alternatives are automatic for image searches when no confirmed purchasable same item is found; keep the returned recommendation scope and disclose differences. User-required features, excluded features, brand and budget remain hard constraints. Preserve unavailable same-item evidence without recommending purchase. Follow visualSearchOutcome: POSSIBLE is not confirmed, incomplete is not absence. Offer an opt-in restock Watch only; do not create one automatically. Changed variants marked visualReviewRequired need fresh visual review.",
      inputSchema: FinalizeVisualSearchInputSchema,
      outputSchema: ShopifyProductsOutputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      },
      _meta: {
        ui: { resourceUri: PRODUCT_CARD_UI_URI },
        "openai/outputTemplate": PRODUCT_CARD_UI_URI,
        "openai/toolInvocation/invoking": "Validating visual matches…",
        "openai/toolInvocation/invoked": "Verified visual matches ready."
      }
    },
    async (rawInput, extra) => {
      const input = FinalizeVisualSearchInputSchema.parse(rawInput);
      pruneVisualSearchSnapshots();
      const snapshot = visualSearchSnapshots.get(input.visualSessionId);
      if (snapshot === undefined || snapshot.expiresAt <= now().getTime()) {
        visualSearchSnapshots.delete(input.visualSessionId);
        throw new Error("VISUAL_SESSION_EXPIRED");
      }
      const searchRun = snapshot.execution.searchRun;
      if (searchRun === undefined) return toolError("TOOL_REQUEST_REJECTED");
      return searchRun.withRequestSignal(extra.signal, async () => {
        const reviewed: Array<{ candidate: UnifiedCandidate; verdict: CodexVisualVerdict }> = [];
        for (const entry of input.verdicts) {
          const candidate = snapshot.candidates.get(entry.candidateId);
          if (candidate === undefined) throw new Error("VISUAL_CANDIDATE_NOT_IN_SESSION");
          reviewed.push({ candidate, verdict: entry.verdict });
        }
        if (reviewed.length !== snapshot.candidates.size) return toolError("INVALID_ARGUMENTS", {
          issues: [{ path: "verdicts", code: "REQUIRED", action: "SUPPLY_REQUIRED_FIELD", minimum: snapshot.candidates.size }]
        });
        if (!searchRun.claimVisualReviewRound()) return toolError("TOOL_REQUEST_REJECTED");
        visualSearchSnapshots.delete(input.visualSessionId);
        const reviewRequirements = {
          requiredFeatures: [...snapshot.input.requiredFeatures,
            ...(snapshot.input.featureMode === "REQUIRED" ? snapshot.input.features : [])],
          excludedFeatures: snapshot.input.excludedFeatures
        };
        const referenceBrand = snapshot.input.brand ?? snapshot.input.visualInput?.brand;
        const reviewGroups = { REVIEW_ACCEPTED: [] as UnifiedCandidate[], REVIEW_CONFLICT: [] as UnifiedCandidate[],
          REVIEW_INSUFFICIENT: [] as UnifiedCandidate[] };
        for (const entry of reviewed) {
          const accepted = assessCodexVisualCandidate(entry.candidate, entry.verdict, snapshot.input.visualInput, true, reviewRequirements, referenceBrand);
          const group = accepted !== undefined ? "REVIEW_ACCEPTED"
            : assessVisualVerdict(entry.verdict, snapshot.input.visualInput, true) !== undefined ||
              hasAdmissibleVisualConflict(entry.verdict, snapshot.input.visualInput!) ? "REVIEW_CONFLICT" : "REVIEW_INSUFFICIENT";
          reviewGroups[group].push(entry.candidate);
        }
        snapshot.reviewedCount += reviewed.length;
        snapshot.reviewConflictCount += reviewGroups.REVIEW_CONFLICT.length;
        snapshot.reviewInsufficientCount += reviewGroups.REVIEW_INSUFFICIENT.length;
        for (const stage of ["REVIEW_ACCEPTED", "REVIEW_CONFLICT", "REVIEW_INSUFFICIENT"] as const) {
          snapshot.execution.searchRun?.recordVisualStage(stage, reviewGroups[stage].map((candidate) => ({
            productHash: visualProductHash(candidate)
          })), { round: snapshot.attempt });
        }
        const evaluatedAtMs = now().getTime();
        const newlyAccepted = finalizeCodexVisualCandidates(
          reviewed,
          snapshot.input.allowAlternatives,
          snapshot.input.limit,
          snapshot.input.visualInput,
          snapshot.input.brand !== undefined && snapshot.input.brandMode === "REQUIRED",
          evaluatedAtMs,
          reviewRequirements,
          referenceBrand
        );
        const acceptedKeys = new Set<string>();
        const finalCandidates = selectVisualResults([...snapshot.accepted, ...newlyAccepted].sort((left, right) => compareRankedCandidates(left, right, evaluatedAtMs))
          .filter((candidate) => {
            const key = candidateKey(candidate);
            if (acceptedKeys.has(key)) return false;
            acceptedKeys.add(key);
            return true;
          }), snapshot.input.limit);
        const unreviewedPool = (snapshot.execution.reviewPool ?? snapshot.execution.candidates).some((candidate) =>
          candidateImageUrl(candidate) !== undefined && !snapshot.imageAttemptedKeys.has(visualCandidateKey(candidate)));
        const needsReview = needsMoreVisualReview(finalCandidates, unreviewedPool);
        if (needsReview && snapshot.attempt === 1 && snapshot.execution.searchRun?.canRead("IMAGE") !== false) {
          // A recalled seventh result must not disappear when the first six conflict.
          // A full same-run tail must not starve official continuation either. Reserve
          // one output slot, request, and byte share; unused capacity returns to the tail.
          const reserveContinuation = finalCandidates.length === 0 &&
            snapshot.execution.officialStoreFallback.status === "COMPLETE" &&
            snapshot.execution.searchRun?.canRead("OFFICIAL") === true;
          let secondExecution = snapshot.execution;
          let secondImageLoad = await loadVisualCandidates(
            secondExecution,
            snapshot.imageAttemptedKeys,
            MAX_RELAXED_VISUAL_CANDIDATES - (reserveContinuation ? 1 : 0),
            { contentKeys: snapshot.imageContentKeys, round: 2,
              ...(reserveContinuation ? {
                maxAttempts: Math.max(0, secondExecution.searchRun!.remainingImageRequests() - 1),
                maxDataChars: Math.floor(MAX_VISUAL_CANDIDATE_OUTPUT_DATA_CHARS * 2 / 3)
              } : {}) }
          );
          const imageAttemptedKeys = new Set([...snapshot.imageAttemptedKeys, ...secondImageLoad.attemptedKeys]);
          let stage: "POOL_REVIEW" | "RELAXED_REVIEW" = "POOL_REVIEW";
          const remainingDataChars = MAX_VISUAL_CANDIDATE_OUTPUT_DATA_CHARS -
            secondImageLoad.entries.reduce((total, entry) => total + entry.image.data.length, 0);
          if (secondImageLoad.entries.length < MAX_RELAXED_VISUAL_CANDIDATES && remainingDataChars > 0 &&
              snapshot.execution.searchRun?.canRead("IMAGE") !== false) {
            stage = "RELAXED_REVIEW";
            secondExecution = await runUnifiedSearch(visualRetrievalSearchInput(snapshot.input, true, snapshot.execution.searchRun));
            for (const candidate of secondExecution.reviewPool ?? secondExecution.candidates) snapshot.retrievedProductHashes.add(visualProductHash(candidate));
            const excludedKeys = reserveContinuation ? new Set([...imageAttemptedKeys,
              ...(snapshot.execution.reviewPool ?? snapshot.execution.candidates).map(visualCandidateKey)]) : imageAttemptedKeys;
            const supplemental = await loadVisualCandidates(secondExecution, excludedKeys,
              MAX_RELAXED_VISUAL_CANDIDATES - secondImageLoad.entries.length, { maxDataChars: remainingDataChars,
                contentKeys: snapshot.imageContentKeys, round: 2 });
            for (const key of supplemental.attemptedKeys) imageAttemptedKeys.add(key);
            secondImageLoad = {
              entries: [...secondImageLoad.entries, ...supplemental.entries],
              diagnostics: mergeVisualImageLoadDiagnostics(secondImageLoad.diagnostics, supplemental.diagnostics),
              attemptedKeys: imageAttemptedKeys
            };
          }
          if (reserveContinuation && secondImageLoad.entries.length < MAX_RELAXED_VISUAL_CANDIDATES &&
              snapshot.execution.searchRun?.canRead("IMAGE")) {
            const tail = await loadVisualCandidates(snapshot.execution, imageAttemptedKeys,
              MAX_RELAXED_VISUAL_CANDIDATES - secondImageLoad.entries.length, {
                maxDataChars: MAX_VISUAL_CANDIDATE_OUTPUT_DATA_CHARS - secondImageLoad.entries.reduce((sum, entry) => sum + entry.image.data.length, 0),
                contentKeys: snapshot.imageContentKeys, round: 2
              });
            for (const key of tail.attemptedKeys) imageAttemptedKeys.add(key);
            secondImageLoad = { entries: [...secondImageLoad.entries, ...tail.entries],
              diagnostics: mergeVisualImageLoadDiagnostics(secondImageLoad.diagnostics, tail.diagnostics),
              attemptedKeys: imageAttemptedKeys };
          }
          const available = secondImageLoad.entries;
          snapshot.execution = secondExecution;
          if (available.length > 0) {
            pruneVisualSearchSnapshots();
            const visualSessionId = randomUUID();
            const expiresAtMs = now().getTime() + VISUAL_SEARCH_SNAPSHOT_TTL_MS;
            const candidateEntries = available.map(({ candidate, image }) => ({
              candidateId: randomUUID(),
              candidate,
              image
            }));
            searchRun.throwIfCancelled();
            visualSearchSnapshots.set(visualSessionId, {
              expiresAt: expiresAtMs,
              input: snapshot.input,
              execution: {
                ...secondExecution,
                candidates: candidateEntries.map((entry) => entry.candidate)
              },
              candidates: new Map(candidateEntries.map((entry) => [entry.candidateId, entry.candidate])),
              attempt: 2,
              reviewedCandidateKeys: new Set([
                ...snapshot.reviewedCandidateKeys,
                ...candidateEntries.map((entry) => visualCandidateKey(entry.candidate))
              ]),
              imageAttemptedKeys,
              imageContentKeys: snapshot.imageContentKeys,
              reviewedCount: snapshot.reviewedCount,
              reviewConflictCount: snapshot.reviewConflictCount,
              reviewInsufficientCount: snapshot.reviewInsufficientCount,
              accepted: finalCandidates,
              retrievedProductHashes: snapshot.retrievedProductHashes
            });
            pruneVisualSearchSnapshots();
            const message = `REVIEW REQUIRED. Final answer is forbidden. ${finalCandidates.length} accepted first-round matches are retained; no sufficient purchasable same-item result yet; any unavailable identity evidence is retained. Review all ${candidateEntries.length} remaining candidates, then call finalize_visual_search once with visualSessionId ${visualSessionId}. Do not relax product family or accept visible conflicts. This is the final review round.`;
            const emptyExecution = { ...secondExecution, candidates: [] };
            const { response } = await buildUnifiedResponse(snapshot.input, emptyExecution, "REVIEW_REQUIRED");
            return {
              ...response,
              content: visualCandidateContent(message, candidateEntries),
              _meta: { ...searchTraceMeta(secondExecution, "REVIEW_REQUIRED", { reviewed: snapshot.reviewedCount,
                reviewConflicts: snapshot.reviewConflictCount, reviewInsufficient: snapshot.reviewInsufficientCount,
                imageAttempts: secondImageLoad.diagnostics.attempted, imagesLoaded: available.length }),
                "findcheap/visualImageLoadDiagnostics": secondImageLoad.diagnostics,
                ...visualEvaluationMeta(secondExecution, snapshot.retrievedProductHashes, candidateEntries) },
              structuredContent: {
                ...response.structuredContent,
                message,
                visualReview: {
                  stage,
                  terminal: false as const,
                  finalAnswerAllowed: false as const,
                  requiredNextTool: "finalize_visual_search" as const,
                  visualSessionId,
                  expiresAt: new Date(expiresAtMs).toISOString(),
                  candidates: visualCandidateDescriptors(candidateEntries)
                }
              }
            };
          }
          if ((secondImageLoad.diagnostics.failures.length > 0 || secondImageLoad.diagnostics.outputBudgetSkipped > 0) && finalCandidates.length === 0) {
            secondExecution.searchRun?.recordVisualStage("FINAL", [], { round: 2 });
            const failure = visualSearchFailure(secondExecution, imageFailureCode(secondImageLoad.diagnostics), snapshot.input.responseLocale ?? "en-US");
            const message = `${failure.message} ${snapshot.input.responseLocale === "zh-CN" ? "未生成视觉推荐。" : "No visual recommendation was produced."}`;
            const emptyExecution = { ...secondExecution, candidates: [] };
            const { response, enriched } = await buildUnifiedResponse(snapshot.input, emptyExecution, "NO_LOADABLE_IMAGES");
            const remembered = rememberVisualFailure({ ...response.structuredContent, message, visualSearchFailure: failure }, enriched.result,
              { ...snapshot, execution: secondExecution, imageAttemptedKeys });
            return {
              ...response,
              content: [{ type: "text" as const, text: remembered.message }],
              _meta: { ...searchTraceMeta(secondExecution, "NO_LOADABLE_IMAGES", { reviewed: snapshot.reviewedCount,
                reviewConflicts: snapshot.reviewConflictCount, reviewInsufficient: snapshot.reviewInsufficientCount,
                imageAttempts: secondImageLoad.diagnostics.attempted, imagesLoaded: 0, returned: 0 }),
                "findcheap/visualImageLoadDiagnostics": secondImageLoad.diagnostics,
                ...visualEvaluationMeta(secondExecution, snapshot.retrievedProductHashes, [], []) },
              structuredContent: remembered
            };
          }
        }
        const candidatesWithDeals = await addVerifiedCoupons(finalCandidates,
          toolAvailability.verifiedDeals ? dealPort : undefined, snapshot.input.membershipIds ?? [], snapshot.execution.searchRun);
        const execution: UnifiedSearchExecution = { ...snapshot.execution, candidates: candidatesWithDeals };
        const allConflicted = snapshot.reviewedCount > 0 && snapshot.reviewConflictCount === snapshot.reviewedCount;
        const emptyOutcome = allConflicted ? "CANDIDATES_CONFLICTED" : "VISUAL_EVIDENCE_INSUFFICIENT";
        execution.searchRun?.recordVisualStage("FINAL", finalCandidates.map((candidate) => ({ productHash: visualProductHash(candidate) })),
          { round: snapshot.attempt });
        const { response, enriched } = await buildUnifiedResponse(snapshot.input, execution,
          finalCandidates.length > 0 ? "MATCH_FOUND" : emptyOutcome);
        if (response.structuredContent.products.length === 0) {
          const failure = visualSearchFailure(
            snapshot.execution,
            emptyOutcome,
            snapshot.input.responseLocale ?? "en-US"
          );
          const remembered = rememberVisualFailure({ ...response.structuredContent, message: failure.message, visualSearchFailure: failure }, enriched.result,
            { ...snapshot, execution });
          return {
            ...response,
            _meta: { ...searchTraceMeta(execution, emptyOutcome, { reviewed: snapshot.reviewedCount,
              reviewConflicts: snapshot.reviewConflictCount, reviewInsufficient: snapshot.reviewInsufficientCount, returned: 0 }),
              ...visualEvaluationMeta(execution, snapshot.retrievedProductHashes, [], []) },
            content: [{ type: "text" as const, text: remembered.message }],
            structuredContent: remembered
          };
        }
        const preflight = await preflightQuoteCapabilities(response.structuredContent, snapshot.execution.searchRun!);
        searchRun.throwIfCancelled();
        const recommendation = choosePrimaryRecommendation(preflight.content.products, now().getTime());
        const content = rememberSnapshot({
          ...preflight.content,
          recommendation: {
            state: recommendation.state,
            reasonCodes: recommendation.reasonCodes
          },
          visualSearchOutcome: describeVisualOutcome(execution.candidates.map(candidate => ({
            identityStatus: candidate.identityStatus, visualMatchGroup: candidate.visualMatchGroup,
            availabilityScope: candidate.shopifyProduct?.availabilityScope,
            availability: candidateProductFacts(candidate).availability
          })), execution.searchRun?.diagnostics().budgetExhausted === true ||
            Object.values(execution.sourceStatus).some(status => status === "PARTIAL" || status === "UNAVAILABLE") ||
            execution.officialStoreFallback.status === "UNAVAILABLE" || execution.officialStoreFallback.status === "PARTIAL",
          snapshot.input.responseLocale ?? "en-US")
        }, enriched.result, preflight.resolvedAwinProducts, recommendation.primaryProductIndex, snapshot.input, execution.candidates, false, searchRun);
        return {
          ...response,
          _meta: { ...searchTraceMeta(execution, "MATCH_FOUND", { reviewed: snapshot.reviewedCount,
            reviewConflicts: snapshot.reviewConflictCount, reviewInsufficient: snapshot.reviewInsufficientCount, returned: content.products.length }),
            "findcheap/quotePreflight": preflight.diagnostics,
            ...visualEvaluationMeta(execution, snapshot.retrievedProductHashes, [], content.products, content.recommendation?.primarySelectionId) },
          content: [{
            type: "text" as const,
            text: `${content.visualSearchOutcome?.message ?? ""}\n${response.content[0]!.text}\n${recommendationInstruction(content)}\nUse structured selection references for follow-ups; never print them or search titles.`
          }],
          structuredContent: content
        };
      });
    }
  );

  toolRegistrar.registerTool(
    "search_shopify_products",
    {
      title: "Legacy Shopify search",
      description: "Compatibility alias for an existing app task. New model calls use search_products.",
      inputSchema: ShopifyProductsToolInputSchema,
      outputSchema: ShopifyProductsOutputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      },
      _meta: {
        ui: { visibility: ["app"], resourceUri: PRODUCT_CARD_UI_URI },
        "openai/outputTemplate": PRODUCT_CARD_UI_URI
      }
    },
    async (input) => {
      const validatedInput = ShopifyProductsInputSchema.parse(input);
      if (hasAmbiguousSonyFamily(validatedInput.query)) {
        const request = SearchProductsInputSchema.parse(validatedInput);
        const clarification = highVarianceClarification(request)!;
        const response = shopifyClarificationResult(request.selectionMode, request, { ...clarification, source: "UNIFIED_PRODUCT_SEARCH" });
        return { ...response, structuredContent: rememberSnapshot(response.structuredContent, emptyShopifySearchResult(request),
          undefined, undefined, request) };
      }
      if (
        validatedInput.comparisonMode === "SAME_PRODUCT" &&
        validatedInput.query !== undefined &&
        !hasSpecificProductIdentity(validatedInput.query)
      ) {
        return shopifyClarificationResult(validatedInput.selectionMode, validatedInput);
      }
      try {
        const searched = await shopifyPort.search(validatedInput);
        const enriched = { result: searched, attempted: 0, succeeded: 0 };
        const response = shopifyResult(enriched.result, {
          ...(validatedInput.zipCode === undefined ? {} : { zipCode: validatedInput.zipCode }),
          membershipIds: validatedInput.membershipIds ?? []
        }, affiliateLinks, {
          attempted: enriched.attempted,
          succeeded: enriched.succeeded
        });
        if (response.structuredContent.products.length === 0) return response;
        const remembered = rememberSnapshot(response.structuredContent, enriched.result);
        return {
          ...response,
          ...(remembered.message === response.structuredContent.message ? {} : { content: [{ type: "text" as const, text: remembered.message }] }),
          structuredContent: remembered
        };
      } catch {
        return shopifyUnavailableResult(validatedInput.selectionMode, validatedInput);
      }
    }
  );

  toolRegistrar.registerTool(
    "search_awin_products",
    {
      title: "Legacy Awin search",
      description: "Compatibility alias for an existing app task. New model calls use search_products.",
      inputSchema: AwinProductsToolInputSchema,
      outputSchema: AwinProductsOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: { ui: { visibility: ["app"] } }
    },
    async (input) => {
      const validatedInput = AwinProductsToolInputSchema.parse(input);
      try {
        return awinResult(await awinPort.search(validatedInput));
      } catch {
        return awinUnavailableResult();
      }
    }
  );

  if (backend.capabilities.has("PRODUCT_INSPECTION")) {
    const inspectionConfig = {
      title: "Inspect a selected product",
      description: "Check size, color, other variants, or current availability for exactly one Shopify or WooCommerce product returned by search_products. Only returned specs verified; missing capacity/weight/count/etc unknown, never from memory/user requirements. Optional gaps: no blocking/extra calls/questions. The server dispatches by the original source. Pass the prior renderId and current responseLocale. Omit the selector only for exactly one UI-synced choice in that snapshot; otherwise use its exact selectionId, one-based position, or variantId. Do not call comparison first to inspect one. Unsynced, empty, multiple and expired selections have distinct errors. To accumulate multiple inspections, use each returned updatedSnapshot and that snapshot's own IDs for the next inspection; do not mix IDs or silently merge parallel branches. On MISSING_REFERENCE_CONTEXT, retry once with the prior search renderId; do not describe the reference as expired. Never call this when the current turn includes a newly attached image; that image starts NEW_PRODUCT through search_visual_candidates. Never scan task history, guess by title, or run another catalog search. Awin cards can be quoted when supported but cannot use this variant-inspection tool.",
      inputSchema: ShopifySelectedProductInputSchema,
      outputSchema: ShopifySelectedProductOutputShape,
      _meta: { ui: { resourceUri: PRODUCT_CARD_UI_URI }, "openai/outputTemplate": PRODUCT_CARD_UI_URI },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    };
    const inspectionHandler = async (input: z.infer<typeof ShopifySelectedProductInputSchema>) => {
      const parsed = ShopifySelectedProductInputSchema.parse(input);
      const snapshot = renderSnapshots.get(parsed.renderId);
      const locale = parsed.responseLocale ?? snapshot?.content.locale ?? "en-US";
      const failure = (code: string, english: string, chinese: string) => ({
        isError: true as const,
        content: [{ type: "text" as const, text: `[${code}] ${locale === "zh-CN" ? chinese : english}` }]
      });
      if (snapshot === undefined) return failure("INSPECTION_REFERENCE_UNAVAILABLE",
        "The original product cards are no longer available. No product was inspected; do not substitute another search.",
        "原商品卡片已不可用，这次没有检查商品；不会替换成其他搜索结果。");
      if (snapshot.expiresAt <= now().getTime()) {
        deleteSnapshot(parsed.renderId);
        return failure("INSPECTION_REFERENCE_EXPIRED",
          "The original product cards have expired. No product was inspected; do not substitute another search.",
          "原商品卡片已过期，这次没有检查商品；不会替换成其他搜索结果。");
      }
      const uiSelection = parsed.selectionId === undefined && parsed.position === undefined && parsed.variantId === undefined;
      const receipt = cardSelections.get(parsed.renderId);
      if (uiSelection) {
        if (receipt === undefined) return failure("INSPECTION_SELECTION_NOT_SYNCED",
          "I have not received a selection for these cards yet. Select one original card, or use its exact reference; no product was inspected.",
          "尚未收到这组卡片的选择。请选中一件原商品，或使用它的准确引用；这次没有检查商品。");
        if (receipt.selectionIds.length === 0) return failure("INSPECTION_SELECTION_EMPTY",
          "No product is selected in these cards. Select the one you want to check first; no product was inspected.",
          "这组卡片还没有选中商品。先选一件你想查看的；这次没有检查商品。");
        if (receipt.selectionIds.length > 1) return failure("INSPECTION_MULTIPLE_SELECTIONS",
          "More than one product is selected. Specify which one to inspect using its original reference; no product was inspected.",
          "当前选中了多件商品。请用原商品引用明确要先查看哪一件；这次没有检查商品。");
      }
      const reference = resolveSingleSelectionReference(parsed);
      if (reference === undefined) {
        return failure("INSPECTION_REFERENCE_UNAVAILABLE",
          "That selection does not belong to the original cards. No product was inspected, and the current UI choice was not substituted.",
          "这个选择不属于原商品卡片。这次没有检查商品，也没有替换成当前界面中的其他选择。");
      }
      const { renderId, variantId } = reference;
      const { variantDimensions = {} } = parsed;
      const sourceEntry = snapshot.sourceProductIndex.get(reference.productKey);
      if (sourceEntry?.sourceKind === "WOOCOMMERCE_STORE_API") {
        if (!woocommerceProducts) return failure("INSPECTION_SOURCE_UNAVAILABLE", "WooCommerce inspection is unavailable.", "WooCommerce 商品检查暂不可用。");
        const selected = sourceEntry.product;
        const inspectionSelection = { renderId, selectionId: snapshot.content.products.find(product => productReferenceKey(product) === reference.productKey)?.selectionId,
          selectionSource: uiSelection ? "UI" as const : "EXPLICIT" as const, ...(uiSelection ? { selectionRevision: receipt!.revision } : {}) };
        try {
          const inspected = await woocommerceProducts.inspect(wooProductTarget(selected), { attributes: variantDimensions });
          if (inspected.status === "UNAVAILABLE" || inspected.status === "UNSUPPORTED" || (inspected.status === "PARTIAL" && inspected.products.length === 0)) {
            return failure("INSPECTION_SOURCE_UNAVAILABLE", "The original WooCommerce product could not be verified; no replacement was searched.", "原 WooCommerce 商品暂未核实；没有改搜其他商品。");
          }
          if (inspected.products.some(product => product.merchantId !== selected.merchantId ||
            product.productId !== selected.productId || product.sourceHost !== selected.sourceHost)) {
            throw new Error("WooCommerce inspection returned another product family");
          }
          const inspectionAnchor = (product: typeof selected, exactVariant = true) => {
            const url = new URL(product.merchantUrl);
            for (const key of [...url.searchParams.keys()]) {
              if (key === "variation_id" || key.startsWith("attribute_")) url.searchParams.delete(key);
            }
            if (exactVariant && product.variationId !== undefined) url.searchParams.set("variation_id", String(product.variationId));
            return createWooProductAnchor(product, url.href);
          };
          const size = Object.entries(variantDimensions).find(([key]) => /^(?:shoe )?size$/iu.test(key))?.[1];
          let nextRequest = parseStoredSearchRequest({ ...(snapshot.request ?? { query: selected.title }), parentRenderId: renderId,
            responseLocale: locale, ...(size === undefined ? {} : { requiredSize: size }) });
          const previousCard = snapshot.content.products.find(product => productReferenceKey(product) === reference.productKey);
          const eligible = inspected.products.map(product => woocommerceCandidate(product,
            { ...nextRequest, includeUnavailableVariants: true,
              ...(nextRequest.wooAnchor === undefined ? {} : { wooAnchor: inspectionAnchor(product) }) }, resolveSearchIntent(nextRequest), nextRequest.query,
            new Set(), new Set(), new Set(), new Set())).filter((candidate): candidate is UnifiedCandidate => candidate !== undefined);
          const changed = eligible.slice(0, 3);
          if (nextRequest.wooAnchor !== undefined && changed.length > 0) nextRequest = parseStoredSearchRequest({ ...nextRequest,
            wooAnchor: changed.length === 1 ? inspectionAnchor(changed[0]!.woocommerceProduct!) : inspectionAnchor(selected, false) });
          const inspectedCards = changed.map(candidate => {
            const card = { ...wooCardProduct(candidate), ...candidateValueOutput(candidate) };
            if (previousCard?.visualReviewAssessment === undefined && snapshot.request?.visualInput === undefined) return card;
            const same = previousCard !== undefined && productReferenceKey(card) === productReferenceKey(previousCard) &&
              card.imageUrl === previousCard.imageUrl && JSON.stringify(card.variantDimensions) === JSON.stringify(previousCard.variantDimensions);
            return same ? { ...card, visualReviewAssessment: previousCard.visualReviewAssessment, visualMatchGroup: previousCard.visualMatchGroup,
              visualMatchEvidence: previousCard.visualMatchEvidence, visualReviewRequired: previousCard.visualReviewRequired }
              : { ...card, visualReviewRequired: true, visualReviewAssessment: undefined, visualMatchGroup: undefined, visualMatchEvidence: undefined };
          });
          if (inspected.products.length === 0 || changed.length === 0) return {
            content: [{ type: "text" as const, text: locale === "zh-CN" ? "未找到同时符合原要求且有已核实商品价的规格；原快照保留。" : "No variant with verified price meets the original requirements; the original snapshot is retained." }],
            _meta: { "findcheap/inspectionSelection": inspectionSelection }, structuredContent: { status: "NO_MATCHING_VARIANT" as const,
              message: "No eligible priced variant", sourceVariantId: variantId, merchant: selected.merchantName, sourceHost: selected.sourceHost,
              productTitle: selected.title, canonicalProductUrl: selected.merchantUrl, variants: [] }
          };
          const onlyOne = changed.length === 1;
          const keys = new Set(inspectedCards.map(productReferenceKey));
          const products = onlyOne ? snapshot.content.products.flatMap(product => productReferenceKey(product) === reference.productKey ? inspectedCards : [product]) : inspectedCards;
          const candidates = onlyOne ? (snapshot.candidates ?? []).flatMap(candidate => candidate.source === "WOOCOMMERCE_STORE_API" &&
            productReferenceKey(wooProductFacts(candidate.woocommerceProduct)) === reference.productKey ? changed : [candidate]) : changed;
          const remembered = rememberSnapshot({ ...snapshot.content, locale, products,
            coverage: inspected.status === "PARTIAL" || inspected.truncated || eligible.length > 3 ? "PARTIAL" : snapshot.content.coverage },
            snapshot.sourceResult, snapshot.resolvedAwinProducts, undefined, nextRequest, candidates, false, snapshot.searchRun);
          const variants = remembered.products.filter(product => keys.has(productReferenceKey(product))).map(product => ({
            variantId: product.handle, title: product.title, ...(product.sku === undefined ? {} : { sku: product.sku }),
            variantDimensions: product.variantDimensions, ...(product.itemPrice === undefined ? {} : { itemPrice: product.itemPrice }),
            availability: product.availability, merchantUrl: product.merchantUrl, checkedAt: product.checkedAt, quoteReference: product.quoteReference!
          }));
          const message = locale === "zh-CN" ? `已核验原 WooCommerce 商品的 ${variants.length} 个规格；新快照供后续选择，旧快照保留。` : `Verified ${variants.length} variants of the original WooCommerce product; use the new snapshot for subsequent selections. The old snapshot is retained.`;
          return { content: [{ type: "text" as const, text: message }], _meta: { "findcheap/inspectionSelection": inspectionSelection },
            structuredContent: { status: "OK" as const, message, sourceVariantId: variantId, merchant: selected.merchantName, sourceHost: selected.sourceHost,
              productTitle: selected.title, canonicalProductUrl: selected.merchantUrl, updatedSnapshot: remembered, variants } };
        } catch { return failure("INSPECTION_SOURCE_UNAVAILABLE", "WooCommerce inspection failed; the original snapshot is retained.", "WooCommerce 商品检查失败；原快照保留。"); }
      }
      const selected = snapshot.sourceResult.products.find((product) => productReferenceKey(product) === reference.productKey);
      if (selected === undefined) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Selected variant does not belong to that search result. No product inspection was requested."
          }]
        };
      }
      if (selectedProducts === undefined) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Selected-product inspection provider is unavailable. No replacement product was searched."
          }]
        };
      }

      const inspectionSelection = {
        renderId,
        selectionId: snapshot.content.products.find(product => productReferenceKey(product) === reference.productKey)?.selectionId,
        selectionSource: uiSelection ? "UI" as const : "EXPLICIT" as const,
        ...(uiSelection ? { selectionRevision: receipt!.revision } : {})
      };
      try {
        const observedInspection = await selectedProducts.inspect(selected, variantDimensions);
        const previousAnchor = snapshot.request?.shopifyAnchor;
        const inspectedAnchor = previousAnchor === undefined ? undefined
          : inspectedShopifyProductAnchor(previousAnchor, selected, variantDimensions, observedInspection.variants);
        const coffeeCategory = snapshot.request === undefined ? undefined : requestedCoffeeCategory(snapshot.request);
        const inspection = snapshot.request === undefined ? observedInspection : { ...observedInspection,
          variants: observedInspection.variants.filter(product =>
            (inspectedAnchor === undefined || matchesSelectedShopifyInspection(selected, variantDimensions, product) &&
              (matchesShopifyProductAnchor(product, inspectedAnchor) || snapshot.request!.allowAlternatives)) &&
            (coffeeCategory === undefined || assessCoffeeCategory(coffeeCategory, product).status !== "CONTRADICTED") &&
            assessCoffeeCompatibility(snapshot.request!, product).status !== "CONTRADICTED") };
        if (inspection.variants.length === 0) {
          const message = locale === "zh-CN"
            ? "这件商品没有符合所选条件的规格；没有改搜其他商品。"
            : "The exact selected product has no variant matching the requested options. No title or catalog search was used.";
          return {
            content: [{ type: "text" as const, text: message }],
            _meta: { "findcheap/inspectionSelection": inspectionSelection },
            structuredContent: {
              status: "NO_MATCHING_VARIANT" as const,
              message,
              sourceVariantId: variantId,
              merchant: selected.merchant,
              sourceHost: selected.sourceHost,
              productTitle: inspection.productTitle,
              canonicalProductUrl: inspection.canonicalProductUrl,
              variants: []
            }
          };
        }

        const inspectedResult: ShopifySearchResult = {
          ...snapshot.sourceResult,
          merchantsQueried: 1,
          merchantsSucceeded: 1,
          comparison: {
            status: "DISCOVERY_ONLY",
            evidence: ["exact prior merchant product path and source Shopify variant identity"],
            merchantCount: 1,
            offerCount: inspection.variants.length
          },
          diagnostics: {
            ...snapshot.sourceResult.diagnostics,
            chromeFallbackEligible: false,
            queryAttempts: 0,
            fallbackQueryUsed: false,
            catalogProductsReturned: 1,
            catalogVariantsReturned: inspection.variants.length,
            catalogZeroResultAttempts: 0
          },
          questions: [],
          products: inspection.variants
        };
        const internalResponse = shopifyResult(
          inspectedResult,
          { membershipIds: [] },
          affiliateLinks
        );
        const requestedSize = Object.entries(variantDimensions).find(([key]) => /^(?:shoe )?size$/iu.test(key));
        const verifiedSize = inspection.variants.length === 1
          ? Object.entries(inspection.variants[0]!.variantDimensions).find(([key]) => /^(?:shoe )?size$/iu.test(key))?.[1]
          : undefined;
        const nextRequest = snapshot.request === undefined ? undefined : parseStoredSearchRequest({
          ...snapshot.request, parentRenderId: renderId, responseLocale: locale,
          ...(inspectedAnchor === undefined ? {} : { shopifyAnchor: inspectedAnchor }),
          ...(inspectedAnchor === previousAnchor || previousAnchor === undefined ? {} : { requiredFeatures: [
            ...snapshot.request.requiredFeatures.filter(feature => !Object.entries(previousAnchor.variantDimensions)
              .some(([name, value]) => Object.keys(variantDimensions).some(key => key.toLowerCase() === name.toLowerCase()) &&
                feature.toLowerCase() === value.toLowerCase())),
            ...Object.entries(inspectedAnchor!.variantDimensions).filter(([name]) => Object.keys(variantDimensions)
              .some(key => key.toLowerCase() === name.toLowerCase())).map(([, value]) => value)
          ] }),
          ...(requestedSize === undefined ? {} : { requiredSize: verifiedSize ?? requestedSize[1] })
        });
        const inspectedKeys = new Set(inspection.variants.map(productReferenceKey));
        const previousCard = snapshot.content.products.find(product => productReferenceKey(product) === reference.productKey);
        const visualDerived = snapshot.request?.visualInput !== undefined || previousCard?.visualReviewAssessment !== undefined ||
          previousCard?.visualReviewRequired === true;
        const inspectedCards: ProductCardContent["products"] = internalResponse.structuredContent.products.map(product => {
          if (!visualDerived || previousCard === undefined) {
            if (previousCard?.requestIdentityStatus === undefined) return product;
            const identityProduct = { ...product, ...(productIdentityBrand(product) === undefined ? {} : { brand: productIdentityBrand(product)! }) };
            const match = classifyShopifyCandidate(snapshot.request?.query ?? "", identityProduct);
            const status = match.status === "IRRELEVANT" ? "SIMILAR" as const : match.status;
            return { ...product, matchStatus: status, matchEvidence: match.evidence,
              card: { ...product.card, matchBadge: status },
              requestIdentityStatus: assessRequestIdentity(snapshot.request?.query ?? "", identityProduct, match.status) };
          }
          const sameVisualEvidence = productReferenceKey(product) === productReferenceKey(previousCard) &&
            product.imageUrl === previousCard.imageUrl &&
            JSON.stringify(Object.entries(product.variantDimensions).sort()) === JSON.stringify(Object.entries(previousCard.variantDimensions).sort());
          if (!sameVisualEvidence) return { ...product, visualReviewRequired: true };
          return { ...product, matchStatus: previousCard.matchStatus, card: { ...product.card, matchBadge: previousCard.card.matchBadge },
            visualReviewRequired: previousCard.visualReviewRequired, visualReviewAssessment: previousCard.visualReviewAssessment,
            visualMatchGroup: previousCard.visualMatchGroup, visualMatchEvidence: previousCard.visualMatchEvidence };
        }).map(product => coffeeCategory !== undefined && assessCoffeeCategory(coffeeCategory, product).status === "UNKNOWN"
          ? { ...product, requestIdentityStatus: "NEEDS_VERIFICATION" as const } : product);
        // One exact sibling updates the comparison set; multiple options require a
        // fresh user selection. Old snapshots and their selection IDs never change.
        const derivedSource = inspection.variants.length === 1 ? {
          ...inspectedResult,
          products: snapshot.sourceResult.products.flatMap(product => productReferenceKey(product) === reference.productKey
            ? inspection.variants : [product])
        } : inspectedResult;
        const derivedProducts = inspection.variants.length === 1
          ? snapshot.content.products.flatMap(product => productReferenceKey(product) === reference.productKey
            ? inspectedCards : [product])
          : inspectedCards;
        const assessedProducts = derivedProducts.map(product => {
          if (nextRequest === undefined) return product;
          const source = derivedSource.products.find(value => productReferenceKey(value) === productReferenceKey(product));
          const checked = evaluateSearchProductRequirements(source ?? product, { ...nextRequest,
            requiredFeatures: [...nextRequest.requiredFeatures, ...(nextRequest.requiredSize === undefined ? []
              : [normalizedSizeRequirement(nextRequest.requiredSize, nextRequest.productType ?? nextRequest.query)])] });
          const compatibility = assessCoffeeCompatibility(nextRequest, source ?? product);
          const limitations = [...checked.unknown, ...checked.contradicted];
          if (nextRequest.maxItemPriceCents !== undefined &&
            (product.itemPrice === undefined || product.itemPrice.amountCents > nextRequest.maxItemPriceCents)) limitations.push("maximum item price");
          return { ...product, requirementAssessment: checked.assessment,
            requirementAssessmentScope: "TYPED_REQUIREMENTS" as const,
            ...(compatibility.status === "NOT_APPLICABLE" ? {} : { coffeeCompatibility: compatibility }),
            featureEvidence: checked.matched, requiredFeatureLimitations: limitations };
        });
        const derivedCandidates = snapshot.candidates?.flatMap((candidate): UnifiedCandidate[] => {
          if (candidate.source !== "SHOPIFY_GLOBAL_CATALOG" || productReferenceKey(candidate.shopifyProduct) !== reference.productKey) {
            return inspection.variants.length === 1 ? [candidate] : [];
          }
          return inspection.variants.map(source => {
            const card = assessedProducts.find(product => productReferenceKey(product) === productReferenceKey(source))!;
            return { ...candidate, shopifyProduct: source, identityStatus: card.matchStatus, identityEvidence: card.matchEvidence,
              requestIdentityStatus: card.requestIdentityStatus, requiredFeatureLimitations: card.requiredFeatureLimitations ?? [],
              ...(card.requirementAssessment === undefined ? {} : { requirementAssessment: card.requirementAssessment }),
              ...(card.coffeeCompatibility === undefined ? {} : { coffeeCompatibility: card.coffeeCompatibility }),
              featureEvidence: card.featureEvidence ?? [] };
          });
        });
        const decision = choosePrimaryRecommendation(assessedProducts, now().getTime());
        const remembered = rememberSnapshot({
          ...internalResponse.structuredContent,
          locale,
          ...(snapshot.content.recovery === undefined ? {} : { recovery: snapshot.content.recovery }),
          products: assessedProducts,
          quality: { ...internalResponse.structuredContent.quality, cardsReturned: assessedProducts.length },
          recommendation: { state: decision.state, reasonCodes: decision.reasonCodes }
        }, derivedSource, snapshot.resolvedAwinProducts, decision.primaryProductIndex, nextRequest, derivedCandidates, false, snapshot.searchRun);
        const variants = remembered.products.filter(product => inspectedKeys.has(productReferenceKey(product))).map((product) => ({
          variantId: product.handle,
          title: product.title,
          ...(product.sku === undefined ? {} : { sku: product.sku }),
          variantDimensions: product.variantDimensions,
          ...(product.itemPrice === undefined ? {} : { itemPrice: product.itemPrice }),
          availability: product.availability,
          merchantUrl: product.merchantUrl,
          checkedAt: product.checkedAt,
          quoteReference: product.quoteReference!
        }));
        const message = variants.length === 0 && inspection.variants.length > 0
          ? locale === "zh-CN"
            ? "已读取所选商品详情，但未取得可核实的美元商品价，未生成新的商品卡片；旧卡片仍保留当时的价格。"
            : "The selected product details were read, but no verified USD item price was available, so no new product card was created. Old cards retain their historical prices."
          : locale === "zh-CN"
          ? `已核验原商品的 ${variants.length} 个规格，并生成新快照。后续对比请在新卡片中重新选择；旧快照仍保留。`
          : `Inspected ${variants.length} variant(s) from the exact previously returned product; no title or catalog search was used. Select cards in the updated snapshot for subsequent comparison; the old snapshot remains unchanged.`;
        return {
          content: [{ type: "text" as const, text: message }],
          _meta: { "findcheap/inspectionSelection": inspectionSelection },
          structuredContent: {
            status: "OK" as const,
            message,
            sourceVariantId: variantId,
            merchant: selected.merchant,
            sourceHost: selected.sourceHost,
            productTitle: inspection.productTitle,
            canonicalProductUrl: inspection.canonicalProductUrl,
            variants,
            updatedSnapshot: remembered
          }
        };
      } catch (error) {
        const failure = selectedInspectionFailure(error);
        const host = /^[a-z0-9.-]{1,253}$/iu.test(selected.sourceHost) ? selected.sourceHost : "UNKNOWN";
        const message = locale === "zh-CN"
          ? "所选商品详情未能完成安全核验，原有商品与选择未改变；未搜索替代商品。"
          : "The exact selected product could not be inspected safely. Original products and selections are unchanged. No replacement product was searched.";
        return { isError: true,
          content: [{ type: "text" as const, text: `[INSPECTION_${failure.reason}] ${message}` }],
          _meta: { "findcheap/inspectionFailure": { ...failure, host } } };
      }
    };
    toolRegistrar.registerTool("inspect_selected_product", inspectionConfig, inspectionHandler);
    toolRegistrar.registerTool("inspect_selected_shopify_product", inspectionConfig, inspectionHandler);
  }

  if (backend.capabilities.has("PRODUCT_QUOTE")) toolRegistrar.registerTool(
    "quote_selected_shopify_product",
    {
      title: "Quote a selected product",
      description: "An explicit quote request and host form approval are required; ZIP alone is not consent. Only DELIVERED_TOTAL_SUPPORTED or ZIP_ESTIMATE_ONLY cards qualify. The tool requests single-use anonymous Cart permission; no host form/decline/cancel/timeout means no quote, never automatically retry. Use current responseLocale. Requires prior renderId; omit the selector only when exactly one UI choice is synchronized to that snapshot, otherwise supply its selectionId or one-based position. On MISSING_REFERENCE_CONTEXT, correct once from the original receipt, not expiry. Never call this when the current turn includes a newly attached image; that image starts NEW_PRODUCT through search_visual_candidates. For unsupported cards or unavailable host consent, do not ask for ZIP. Never guess by title, request a street address, or run another search.",
      inputSchema: ShopifySelectedQuoteInputSchema,
      outputSchema: ShopifyProductsOutputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      },
      _meta: {
        ui: { resourceUri: PRODUCT_CARD_UI_URI },
        "openai/outputTemplate": PRODUCT_CARD_UI_URI,
        "openai/toolInvocation/invoking": "Quoting the selected product…",
        "openai/toolInvocation/invoked": "Selected-product quote ready."
      }
    },
    async (input, extra) => {
      const parsed = ShopifySelectedQuoteInputSchema.parse(input);
      const snapshot = renderSnapshots.get(parsed.renderId);
      const locale = parsed.responseLocale ?? snapshot?.content.locale ?? "en-US";
      if (snapshot === undefined || snapshot.expiresAt <= now().getTime()) {
        deleteSnapshot(parsed.renderId);
        return quoteRequestFailure(locale, "QUOTE_REFERENCE_EXPIRED",
          "The original product snapshot is unavailable or expired. No quote was requested; do not substitute another snapshot or automatically search again.",
          "原商品快照已不可用或过期。未请求报价；不要替换成其他快照或自动重新搜索。");
      }
      if (parsed.selectionId === undefined && parsed.position === undefined && parsed.variantId === undefined) {
        const failure = quoteSelectionFailure(cardSelections.get(parsed.renderId)?.selectionIds, "SINGLE", locale);
        if (failure !== undefined) return failure;
      }
      const reference = resolveSingleSelectionReference(parsed);
      if (reference === undefined) {
        return quoteRequestFailure(locale, "QUOTE_REFERENCE_UNAVAILABLE",
          "Selected product reference is unavailable or does not belong to that search result. No quote was requested.",
          "所选商品引用不可用或不属于原搜索快照；未请求报价。");
      }
      const { renderId, productKey } = reference;
      const { zipCode } = parsed;
      const selectedCard = snapshot.content.products.find((product) => productReferenceKey(product) === productKey);
      if (selectedCard === undefined) {
        return quoteRequestFailure(locale, "QUOTE_REFERENCE_UNAVAILABLE",
          "Selected product does not belong to that search result. No quote was requested.",
          "所选商品不属于原搜索快照；未请求报价。");
      }
      // Capture only the resolved server-owned target, before consent can change UI state.
      const uiSelection = parsed.selectionId === undefined && parsed.position === undefined && parsed.variantId === undefined;
      const operation = QuoteOperationSchema.parse({ renderId, selectionId: selectedCard.selectionId,
        selectionSource: uiSelection ? "UI" : "EXPLICIT",
        ...(uiSelection ? { selectionRevision: cardSelections.get(renderId)?.revision } : {}) });
      const withTarget = (result: CallToolResult) => ({
        ...result,
        _meta: { ...result._meta, "findcheap/quoteOperation": operation },
        ...(result.structuredContent === undefined ? {} : {
          structuredContent: { ...result.structuredContent, quoteOperation: operation }
        }),
        // Error results do not get the ordinary snapshot context projection.
        content: [...result.content, { type: "text" as const, text: JSON.stringify({ quoteOperation: operation }) }]
      });
      const eligibilityFailure = quoteEligibilityFailure(snapshot, selectedCard);
      if (eligibilityFailure !== undefined) return withTarget(quoteAuthorizationFailure(eligibilityFailure, locale));
      if (selectedCard.quoteCapability === "MERCHANT_CHECKOUT_ONLY") {
        return withTarget(recoverableQuoteResult(
          snapshot,
          locale === "zh-CN"
            ? "[MERCHANT_CHECKOUT_ONLY] 不支持报价：该商品无法提供按 ZIP 预估的到手价。请在商家结账页确认，或选择其他现有卡片；无需重新搜索。"
            : "[MERCHANT_CHECKOUT_ONLY] Quote unsupported: this product cannot provide a ZIP delivered-total estimate. Continue at merchant checkout or choose another existing card; no new search is required.",
          locale
        ));
      }
      if (cartQuotes === undefined) {
        return withTarget(recoverableQuoteResult(
          snapshot,
          quoteFailureMessage("MERCHANT_CART_UNAVAILABLE", locale),
          locale
        ));
      }
      let quoteContextIsCurrent = () => true;
      try {
        const selected = selectedQuoteTarget(snapshot, selectedCard);
        if (selected === undefined) {
          return withTarget(quoteAuthorizationFailure("QUOTE_TARGET_UNVERIFIED", locale));
        }
        const originalSelection = cardSelections.get(renderId);
        const revalidate = () => renderSnapshots.get(renderId) === snapshot && snapshot.expiresAt > now().getTime() &&
          cardSelections.get(renderId) === originalSelection && resolveSingleSelectionReference(parsed)?.productKey === productKey &&
          selectedQuoteTarget(snapshot, selectedCard) === selected;
        quoteContextIsCurrent = revalidate;
        const authorization = await authorizeQuote([selected], zipCode, locale, extra, revalidate);
        if ("error" in authorization) return withTarget(authorization.error);
        const cartQuote = await cartQuotes.quote(selected, zipCode, authorization.permit);
        if (extra.signal.aborted || !revalidate()) return withTarget(discardedQuoteResult(locale));
        const quotedProduct = withCartQuote(selectedCard, cartQuote);
        const { renderId: _previousRenderId, ...previousContent } = snapshot.content;
        const message = locale === "zh-CN"
          ? `所选商品预估到手价为 USD ${(cartQuote.deliveredPrice.amountCents / 100).toFixed(2)}，包括商品价、已选运费及${cartQuote.tax.status === "ZIP_ESTIMATED" ? "按 ZIP 估算的州平均税费" : "商家返回税费"}；最终结账金额可能变化。`
          : `Estimated delivered total for the selected product is USD ${(cartQuote.deliveredPrice.amountCents / 100).toFixed(2)}. It includes item price, selected shipping, and ${cartQuote.tax.status === "ZIP_ESTIMATED" ? "ZIP state-average estimated tax" : "merchant-reported tax"}; final checkout may change.`;
        const content = rememberSnapshot({
          ...previousContent,
          locale,
          message,
          priceScope: "SHOPIFY_CART_ESTIMATE",
          cartQuoteCoverage: { attempted: 1, succeeded: 1 },
          pricingContext: { zipCode, membershipIds: [] },
          quality: {
            ...previousContent.quality,
            cardsReturned: 1,
            itemPricesVerified: 1,
            limitations: ["final checkout total may change", "coupons and membership prices remain unavailable unless separately verified"]
          },
          comparison: {
            status: "DISCOVERY_ONLY",
            evidence: ["selected from the immutable prior result without a title search"],
            merchantCount: 1,
            offerCount: 1
          },
          products: [quotedProduct]
        }, snapshot.sourceResult, snapshot.resolvedAwinProducts, undefined,
        snapshot.request === undefined ? undefined : { ...snapshot.request, parentRenderId: renderId });
        return withTarget({
          content: [{ type: "text" as const, text: message }],
          structuredContent: content
        });
      } catch (error) {
        const failure = error instanceof ShopifyCartQuoteError
          ? error
          : new ShopifyCartQuoteError("MERCHANT_CART_UNAVAILABLE", { cause: error });
        if (extra.signal.aborted || !quoteContextIsCurrent()) return withTarget(discardedQuoteResult(locale));
        return withTarget(recoverableQuoteResult(snapshot, quoteFailureMessage(failure.code, locale), locale));
      }
    }
  );

  if (backend.capabilities.has("PRODUCT_QUOTE")) toolRegistrar.registerTool(
    "quote_and_compare_selected_products",
    {
      title: "Quote and compare selected products",
      description: "An explicit quote request and host form approval are required; ZIP alone is not consent. Quote and compare 2-4 supported products from one immutable snapshot. One form grants one selected batch only, never future or Watch quotes. Missing/declined/cancelled/expired consent means no quote and no automatic retry. Requires prior renderId; selectionIds are optional UI choices bound to it. Use responseLocale for the current message language. On MISSING_REFERENCE_CONTEXT, correct once from original receipt, not expiry. Reject stale, foreign or cross-snapshot choices. Never calculate totals or differences in prose.",
      inputSchema: QuotedProductComparisonInputSchema,
      outputSchema: ProductComparisonOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      },
      _meta: {
        ui: { resourceUri: PRODUCT_COMPARISON_UI_URI },
        "openai/outputTemplate": PRODUCT_COMPARISON_UI_URI,
        "openai/toolInvocation/invoking": "Quoting and comparing delivered totals…",
        "openai/toolInvocation/invoked": "Delivered-total comparison ready."
      }
    },
    async (rawInput, extra) => {
      const request = QuotedProductComparisonInputSchema.parse(rawInput);
      const localizedError = (english: string, chinese: string) => ({
        isError: true,
        content: [{
          type: "text" as const,
          text: request.responseLocale === "zh-CN" ? chinese : english
        }]
      });
      const requestedSnapshot = renderSnapshots.get(request.renderId);
      if (requestedSnapshot === undefined || requestedSnapshot.expiresAt <= now().getTime()) {
        deleteSnapshot(request.renderId);
        return quoteRequestFailure(request.responseLocale, "QUOTE_REFERENCE_EXPIRED",
          "The original product snapshot is unavailable or expired. No quote was requested; do not substitute another snapshot or automatically search again.",
          "原商品快照已不可用或过期。未请求报价；不要替换成其他快照或自动重新搜索。");
      }
      const selectionIds = resolveComparisonSelectionIds(request);
      if (selectionIds?.length === 1 && (resolveSelectionReference({ renderId: request.renderId, selectionId: selectionIds[0]! }) === undefined ||
        !requestedSnapshot.content.products.some(product => product.selectionId === selectionIds[0]))) {
        return quoteRequestFailure(request.responseLocale, "QUOTE_REFERENCE_UNAVAILABLE",
          "Selected product reference is unavailable or does not belong to that search result. No quote was requested.",
          "所选商品引用不可用或不属于原搜索快照；未请求报价。");
      }
      const selectionFailure = quoteSelectionFailure(selectionIds, "BATCH", request.responseLocale);
      if (selectionFailure !== undefined) return selectionFailure;
      const input = ProductComparisonInputSchema.parse({
        selectionIds,
        mode: request.mode,
        focus: request.focus,
        responseLocale: request.responseLocale
      });
      const references = input.selectionIds.map((selectionId) => selections.get(selectionId));
      if (references.some((reference) => reference === undefined)) {
        return localizedError(
          "One or more product selections are unavailable. Run one new search and select 2-4 cards from it.",
          "一个或多个商品选择已不可用。请重新搜索，并从同一结果中选择 2–4 张卡片。"
        );
      }
      const renderIds = new Set(references.map((reference) => reference!.renderId));
      if (renderIds.size !== 1 || (request.renderId !== undefined && !renderIds.has(request.renderId))) {
        return localizedError(
          "Selections cannot be mixed with or bound to a different search snapshot. Run one search containing all finalists.",
          "所选商品不能混合或绑定到其他搜索快照。请重新搜索，让所有候选商品出现在同一结果中。"
        );
      }
      const renderId = references[0]!.renderId;
      const snapshot = renderSnapshots.get(renderId);
      const comparisonAt = now();
      if (snapshot === undefined || snapshot.expiresAt <= comparisonAt.getTime()) {
        deleteSnapshot(renderId);
        return localizedError(
          "The product selection snapshot expired. Run one new search before comparing.",
          "商品选择快照已过期。请重新搜索后再对比。"
        );
      }
      const selectedCards = input.selectionIds.map((selectionId) =>
        snapshot.content.products.find((product) => product.selectionId === selectionId)
      );
      if (selectedCards.some((product) => product === undefined)) {
        return localizedError(
          "A selected product does not belong to the immutable search snapshot.",
          "某个所选商品不属于该不可变搜索快照。"
        );
      }
      const eligibilityFailure = selectedCards.map(product => quoteEligibilityFailure(snapshot, product!)).find(code => code !== undefined);
      if (eligibilityFailure !== undefined) return quoteAuthorizationFailure(eligibilityFailure, request.responseLocale);
      if (selectedCards.some((product) => product!.quoteCapability === "MERCHANT_CHECKOUT_ONLY")) {
        return quoteAuthorizationFailure("QUOTE_UNSUPPORTED", request.responseLocale);
      }
      let quoteContextIsCurrent = () => true;
      try {
        const targets = selectedCards.map(card => selectedQuoteTarget(snapshot, card!));
        if (targets.some(target => target === undefined)) {
          return quoteAuthorizationFailure("QUOTE_TARGET_UNVERIFIED", request.responseLocale);
        }
        const originalSelection = cardSelections.get(renderId);
        const revalidate = () => renderSnapshots.get(renderId) === snapshot && snapshot.expiresAt > now().getTime() &&
          cardSelections.get(renderId) === originalSelection && input.selectionIds.every((id, index) =>
            selections.get(id) === references[index] && selectedQuoteTarget(snapshot, selectedCards[index]!) === targets[index]);
        quoteContextIsCurrent = revalidate;
        const authorization = await authorizeQuote(targets as ShopifyProduct[], request.zipCode, request.responseLocale, extra, revalidate);
        if ("error" in authorization) return authorization.error;
        const quotedProducts = await Promise.all(selectedCards.map(async (selectedCard, index) => {
          return {
            ...withCartQuote(selectedCard!, await cartQuotes!.quote(targets[index]!, request.zipCode, authorization.permit)),
            selectionId: input.selectionIds[index]!
          };
        }));
        if (extra.signal.aborted || !revalidate()) return discardedQuoteResult(request.responseLocale);
        const quoteExpiries = quotedProducts.map((product) =>
          Date.parse(product.pricing.deliveredPrice.expiresAt!)
        );
        const comparisonExpiresAt = Math.min(snapshot.expiresAt, ...quoteExpiries);
        const comparisonId = randomUUID();
        const comparisonInput = ProductComparisonInputSchema.parse({
          selectionIds: input.selectionIds,
          mode: input.mode,
          focus: [...new Set(["DELIVERED_TOTAL" as const, ...input.focus])].slice(0, 3),
          responseLocale: input.responseLocale
        });
        const content = buildProductComparison(comparisonInput, quotedProducts as ComparableProduct[], {
          comparisonId,
          renderId,
          expiresAt: new Date(comparisonExpiresAt).toISOString(),
          evaluatedAt: comparisonAt.toISOString(),
          ...(snapshot.content.requirementsVersion === undefined ? {} : { requirementsVersion: snapshot.content.requirementsVersion })
        });
        if (content.status === "OK") {
          pruneComparisonSnapshots();
          comparisonSnapshots.set(comparisonId, { expiresAt: comparisonExpiresAt, content });
          pruneComparisonSnapshots();
        }
        return { content: [{ type: "text" as const, text: content.message }], structuredContent: content };
      } catch (error) {
        const failure = error instanceof ShopifyCartQuoteError
          ? error
          : new ShopifyCartQuoteError("MERCHANT_CART_UNAVAILABLE", { cause: error });
        if (extra.signal.aborted || !quoteContextIsCurrent()) return discardedQuoteResult(request.responseLocale);
        return localizedError(quoteFailureMessage(failure.code), quoteFailureMessage(failure.code, "zh-CN"));
      }
    }
  );

  toolRegistrar.registerTool(
    "research_selected_product_deal",
    {
      title: "Check current price and deals",
      description: "Check one exact prior product for current verified merchant deals, current item price, and inventory; this does not request a Cart quote. Use responseLocale for the current message language. Pass the prior renderId alone for exactly one UI-synced choice. Use selectionId or one-based position only for an explicit user reference from that snapshot. Unsynced, empty, multiple and expired choices are distinct; never substitute the first card. On MISSING_REFERENCE_CONTEXT, retry once with the prior search renderId; do not describe the reference as expired. Never call this when the current turn includes a newly attached image; that image starts NEW_PRODUCT through search_visual_candidates. Never search or guess by title. Return current evidence only; do not make historical or buy-or-wait claims. Monitoring is created only after an explicit Watch request.",
      inputSchema: DealConciergeInputSchema,
      outputSchema: DealConciergeOutputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const parsed = DealConciergeInputSchema.parse(input);
      const snapshot = renderSnapshots.get(parsed.renderId);
      const locale = parsed.responseLocale ?? snapshot?.content.locale ?? "en-US";
      const text = (english: string, chinese: string) => locale === "zh-CN" ? chinese : english;
      const failure = (reasonCode: z.infer<typeof DealConciergeOutputShape.reasonCode>, english: string, chinese: string) => {
        const message = text(english, chinese);
        return {
          content: [{ type: "text" as const, text: `[${reasonCode}] ${message}` }],
          structuredContent: {
            status: "SELECTION_UNAVAILABLE" as const,
            locale,
            reasonCode,
            message,
            quoteStatus: "NOT_REQUESTED" as const,
            limitations: [text("No product title fallback search was performed.", "未按商品标题猜测或重新搜索。")],
            deals: []
          }
        };
      };
      if (snapshot === undefined) return failure("DEAL_REFERENCE_UNAVAILABLE",
        "The original product cards are no longer available. No deals were checked; do not substitute another product.",
        "原商品卡片已不可用。这次没有查优惠，不会替换成其他商品。");
      if (snapshot.expiresAt <= now().getTime()) {
        deleteSnapshot(parsed.renderId);
        return failure("DEAL_REFERENCE_EXPIRED",
          "The original product cards have expired. No deals were checked; do not substitute another product.",
          "原商品卡片已过期。这次没有查优惠，不会替换成其他商品。");
      }
      const uiSelection = parsed.selectionId === undefined && parsed.position === undefined;
      const receipt = cardSelections.get(parsed.renderId);
      if (uiSelection) {
        if (receipt === undefined) return failure("DEAL_SELECTION_NOT_SYNCED",
          "I have not received a selection for these product cards yet. Select one original card; no deals were checked.",
          "尚未收到这组商品卡片的选择。请选中一件原商品；这次没有查优惠。");
        if (receipt.selectionIds.length === 0) return failure("DEAL_SELECTION_EMPTY",
          "No product is selected in these cards. Select the one you want to check; no deals were checked.",
          "这组卡片还没有选中商品。先选一件你想查看的；这次没有查优惠。");
        if (receipt.selectionIds.length > 1) return failure("DEAL_MULTIPLE_SELECTIONS",
          "More than one product is selected. Specify which product to check using its original reference; no deals were checked.",
          "当前选中了多件商品。请用原商品引用明确要先查看哪一件；这次没有查优惠。");
      }
      const reference = resolveSingleSelectionReference(parsed);
      if (reference === undefined) {
        return failure("DEAL_REFERENCE_UNAVAILABLE",
          "That product selection does not belong to the original cards. No deals were checked, and the current UI choice was not substituted.",
          "这个商品选择不属于原卡片。这次没有查优惠，也没有替换成当前界面中的其他选择。");
      }
      const selectedCard = snapshot.content.products.find((product) => productReferenceKey(product) === reference.productKey);
      if (selectedCard === undefined) {
        return failure("DEAL_REFERENCE_UNAVAILABLE",
          "The selected product does not belong to the original cards. No deals were checked.",
          "所选商品不属于原卡片；这次没有查优惠。");
      }

      const quoteProduct = selectedCard.sourceKind === "AWIN_PRODUCT_FEED"
        ? snapshot.resolvedAwinProducts.get(reference.productKey)
        : snapshot.sourceResult.products.find((product) => productReferenceKey(product) === reference.productKey);
      const dealSelection = {
        renderId: reference.renderId,
        selectionId: selectedCard.selectionId,
        selectionSource: uiSelection ? "UI" as const : "EXPLICIT" as const,
        ...(uiSelection && receipt !== undefined ? { selectionRevision: receipt.revision } : {})
      };
      let dealProduct = selectedCard;
      if (selectedCard.sourceKind === "WOOCOMMERCE_STORE_API") {
        const entry = snapshot.sourceProductIndex.get(reference.productKey);
        const { itemPrice: _oldPrice, ...withoutPrice } = selectedCard;
        dealProduct = { ...withoutPrice, availability: "UNKNOWN" };
        if (entry?.sourceKind === "WOOCOMMERCE_STORE_API" && woocommerceProducts !== undefined) {
          try {
            const lookup = await woocommerceProducts.lookup(wooProductTarget(entry.product));
            const current = lookup.product === undefined ? undefined : wooProductFacts(lookup.product);
            if (lookup.status === "FOUND" && current !== undefined && productReferenceKey(current) === reference.productKey &&
              Date.parse(current.checkedAt) >= now().getTime() - 60_000 && Date.parse(current.checkedAt) <= now().getTime() + 120_000 &&
              Object.entries(selectedCard.variantDimensions).every(([name, value]) => current.variantDimensions[name] === value)) {
              dealProduct = { ...withoutPrice, ...(current.itemPrice === undefined ? {} : { itemPrice: current.itemPrice }),
                availability: current.availability, checkedAt: current.checkedAt };
            }
          } catch { /* Merchant offers may still be researched; current product price remains unavailable. */ }
        }
      }
      const research = await researchSelectedProductDeal({
        responseLocale: locale,
        selected: {
          merchantProductId: dealProductId(selectedCard),
          merchant: selectedCard.merchant,
          title: selectedCard.title,
          availability: dealProduct.availability,
          ...(dealProduct.itemPrice === undefined ? {} : { itemPrice: dealProduct.itemPrice }),
          checkedAt: dealProduct.checkedAt,
          quoteCapability: selectedCard.quoteCapability,
          ...(quoteProduct === undefined ? {} : { quoteProduct })
        },
        ...(parsed.zipCode === undefined ? {} : { zipCode: parsed.zipCode }),
        membershipIds: parsed.membershipIds ?? [],
        dealPort,
        ...(cartQuotes === undefined ? {} : { cartQuotes }),
        now: now()
      });
      const priceEvidence = research.currentPrice === undefined
        ? text("Current price: unavailable.", "当前价格不可用。")
        : text(`Current ${research.currentPrice.basis === "DELIVERED_TOTAL" ? "estimated delivered total" : "item price"}: USD ${(research.currentPrice.amount.amountCents / 100).toFixed(2)}; checked at ${research.currentPrice.checkedAt}.`,
          `当前${research.currentPrice.basis === "DELIVERED_TOTAL" ? "预估到手价" : "商品价"}：USD ${(research.currentPrice.amount.amountCents / 100).toFixed(2)}；核验时间：${research.currentPrice.checkedAt}。`);
      const preferredDeals = research.deals.filter(deal => deal.dealId === research.dealSummary.recommendedDealId);
      const dealEvidence = research.dealLookupStatus !== "COMPLETE" && research.deals.length === 0
        ? text("Deal source unavailable or incomplete; coupon availability cannot be determined.", "优惠来源不可用或查询尚不完整；不能判断是否有优惠。")
        : research.deals.length === 0 ? text("Verified deals: none found in the completed lookup.", "本次已完成查询，未找到已验证的优惠。")
        : text(`${research.deals.length} merchant offers found; `, `找到 ${research.deals.length} 条商家优惠；`) +
          (preferredDeals.length === 0 ? text("none can currently be recommended for the selected product.", "目前没有可推荐给所选商品的优惠。") :
          preferredDeals.slice(0, 1).map((deal) => [
            deal.title.slice(0, 120),
            deal.code === undefined ? undefined : text("code ", "优惠码：") + deal.code,
            deal.assessment.status === "CONFIRMED" ? text("product eligibility confirmed", "已确认适用于所选商品")
              : text("conditional merchant offer; merchant confirmation required", "商家优惠候选；适用性需商家确认"),
            text("eligibility: ", "适用条件：") + (deal.eligibility.filter(term => !isPlaceholderDealTerm(term)).join(", ").slice(0, 200) || text("merchant confirmation required", "需商家确认")),
            text("valid through ", "有效期至：") + deal.validTo,
            text("checked at ", "核验时间：") + deal.checkedAt
          ].filter((part): part is string => part !== undefined).join("; ")).join(" | "));
      const message = [
        text(`Selected product: ${selectedCard.title}; merchant: ${selectedCard.merchant}; availability: ${dealProduct.availability}.`,
          `所选商品：${selectedCard.title}；商家：${selectedCard.merchant}；库存：${({ IN_STOCK: "有货", OUT_OF_STOCK: "缺货", UNKNOWN: "未知" })[dealProduct.availability]}。`),
        priceEvidence,
        dealEvidence,
        ...research.limitations.map((limitation) => text("Limit: ", "限制：") + limitation)
      ].join(" ");
      return {
        content: [{ type: "text" as const, text: message }],
        _meta: {
          "findcheap/referenceTrace": { traceId: snapshot.content.traceId, renderId: reference.renderId, operation: "DEAL_RESEARCH" },
          "findcheap/dealSelection": dealSelection
        },
        structuredContent: {
          status: "OK" as const,
          locale,
          ...dealSelection,
          message,
          selectedProduct: {
            merchantId: selectedCard.merchantId,
            merchant: selectedCard.merchant,
            merchantProductId: dealProductId(selectedCard),
            title: selectedCard.title,
            availability: dealProduct.availability,
            merchantUrl: selectedCard.merchantUrl
          },
          ...(research.currentPrice === undefined ? {} : { currentPrice: research.currentPrice }),
          quoteStatus: research.quoteStatus,
          dealStatus: research.dealStatus,
          dealLookupStatus: research.dealLookupStatus,
          dealLookupReasonCodes: research.dealLookupReasonCodes,
          dealSummary: research.dealSummary,
          limitations: research.limitations,
          deals: research.deals,
          objective: parsed.objective
        }
      };
    }
  );

  toolRegistrar.registerTool(
    "compare_selected_products",
    {
      title: "Compare selected products",
      description: "Build one evidence-backed 2-4 column comparison. Schema requires the prior renderId; selectionIds are optional explicit UI choices bound to it, while renderId alone resolves UI-synced IDs. Use responseLocale for the current message language. On MISSING_REFERENCE_CONTEXT, retry once with the prior search renderId; do not describe the reference as expired. Omit focus for an ordinary comparison; pass at most 3 explicit priorities. Call once after any reference retry. Never claim selection arrived unless this tool succeeds. Server owns facts, prices, deltas, limitations, and recommendation.",
      inputSchema: ProductComparisonToolInputSchema,
      outputSchema: ProductComparisonOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      },
      _meta: {
        ui: { resourceUri: PRODUCT_COMPARISON_UI_URI },
        "openai/outputTemplate": PRODUCT_COMPARISON_UI_URI,
        "openai/toolInvocation/invoking": "Building evidence-backed comparison…",
        "openai/toolInvocation/invoked": "Product comparison ready."
      }
    },
    async (rawInput) => {
      const request = ProductComparisonToolInputSchema.parse(rawInput);
      const failure = (
        status: "SELECTION_UNAVAILABLE" | "CROSS_SNAPSHOT_UNSUPPORTED",
        english: string,
        chinese: string
      ): ProductComparisonOutput => ({
        status,
        message: request.responseLocale === "zh-CN" ? chinese : english,
        locale: request.responseLocale,
        focus: request.focus,
        entries: []
      });
      const selectionIds = resolveComparisonSelectionIds(request);
      if (selectionIds === undefined || selectionIds.length < 2 || selectionIds.length > 4) {
        const content = failure(
          "SELECTION_UNAVAILABLE",
          "No valid 2-4 product UI selection is synced for this search snapshot.",
          "该搜索快照没有已同步的 2–4 个有效商品选择。"
        );
        return { content: [{ type: "text" as const, text: content.message }], structuredContent: content };
      }
      const input = ProductComparisonInputSchema.parse({
        selectionIds,
        mode: request.mode,
        focus: request.focus,
        responseLocale: request.responseLocale
      });
      const references = input.selectionIds.map((selectionId) => selections.get(selectionId));
      if (references.some((reference) => reference === undefined)) {
        const content = failure(
          "SELECTION_UNAVAILABLE",
          "One or more product selections are unavailable. Run one new search and select 2-4 cards from it.",
          "一个或多个商品选择已不可用。请重新搜索，并从同一结果中选择 2–4 张卡片。"
        );
        return { content: [{ type: "text" as const, text: content.message }], structuredContent: content };
      }
      const renderIds = new Set(references.map((reference) => reference!.renderId));
      if (renderIds.size !== 1 || (request.renderId !== undefined && !renderIds.has(request.renderId))) {
        const content = failure(
          "CROSS_SNAPSHOT_UNSUPPORTED",
          "Selections cannot be mixed with or bound to a different search snapshot. Run one search containing all finalists.",
          "所选商品不能混合或绑定到其他搜索快照。请重新搜索，让所有候选商品出现在同一结果中。"
        );
        return { content: [{ type: "text" as const, text: content.message }], structuredContent: content };
      }
      const renderId = references[0]!.renderId;
      const snapshot = renderSnapshots.get(renderId);
      const comparisonAt = now();
      if (snapshot === undefined || snapshot.expiresAt <= comparisonAt.getTime()) {
        deleteSnapshot(renderId);
        const content = failure(
          "SELECTION_UNAVAILABLE",
          "The product selection snapshot expired. Run one new search before comparing.",
          "商品选择快照已过期。请重新搜索后再对比。"
        );
        return { content: [{ type: "text" as const, text: content.message }], structuredContent: content };
      }
      const products = input.selectionIds.map((selectionId) =>
        snapshot.content.products.find((product) => product.selectionId === selectionId)
      );
      if (products.some((product) => product === undefined)) {
        const content = failure(
          "SELECTION_UNAVAILABLE",
          "A selected product does not belong to the immutable search snapshot.",
          "某个所选商品不属于该不可变搜索快照。"
        );
        return { content: [{ type: "text" as const, text: content.message }], structuredContent: content };
      }
      const quoteExpiries = products.flatMap((product) => {
        const expiresAt = product?.pricing.deliveredPrice.expiresAt;
        if (expiresAt === undefined) return [];
        const expiresAtMs = Date.parse(expiresAt);
        return Number.isFinite(expiresAtMs) && expiresAtMs > comparisonAt.getTime() ? [expiresAtMs] : [];
      });
      const comparisonExpiresAt = Math.min(snapshot.expiresAt, ...quoteExpiries);
      const comparisonId = randomUUID();
      const content = buildProductComparison(
        input,
        products as ComparableProduct[],
        {
          comparisonId,
          renderId,
          expiresAt: new Date(comparisonExpiresAt).toISOString(),
          evaluatedAt: comparisonAt.toISOString(),
          ...(snapshot.content.requirementsVersion === undefined ? {} : { requirementsVersion: snapshot.content.requirementsVersion })
        }
      );
      if (content.status === "OK") {
        pruneComparisonSnapshots();
        comparisonSnapshots.set(comparisonId, { expiresAt: comparisonExpiresAt, content });
        pruneComparisonSnapshots();
      }
      return { content: [{ type: "text" as const, text: content.message }], structuredContent: content,
        _meta: { "findcheap/referenceTrace": { traceId: snapshot.content.traceId, renderId, operation: "COMPARISON" } } };
    }
  );

  toolRegistrar.registerTool(
    "render_product_comparison",
    {
      title: "Render a product comparison",
      description: "Render one immutable comparison snapshot.",
      inputSchema: z.object({ comparisonId: z.string().uuid() }).strict(),
      outputSchema: ProductComparisonOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: {
        ui: { resourceUri: PRODUCT_COMPARISON_UI_URI, visibility: ["app"] },
        "openai/outputTemplate": PRODUCT_COMPARISON_UI_URI
      }
    },
    async ({ comparisonId }) => {
      pruneComparisonSnapshots();
      const snapshot = comparisonSnapshots.get(comparisonId);
      if (snapshot === undefined || snapshot.expiresAt <= now().getTime()) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Product comparison snapshot is unavailable." }]
        };
      }
      return {
        content: [{ type: "text" as const, text: snapshot.content.message }],
        structuredContent: snapshot.content
      };
    }
  );

  if (toolAvailability.verifiedDeals) toolRegistrar.registerTool(
    "find_coupons",
    {
      title: "Find verified coupons and cashback",
      description: "Find current verified Coupon, promo code, brand promotion, membership offer, Cashback, or offline barcode evidence. productQuery ranks product-specific evidence but never discards verified merchant-wide offers. Never guesses codes.",
      inputSchema: FindCouponsInputSchema,
      outputSchema: {
        status: z.enum(["OK", "NO_VERIFIED_DEALS", "DATA_SOURCE_UNAVAILABLE"]),
        message: z.string(),
        deals: z.array(z.object({
          dealId: z.string(), merchant: z.string(), kind: z.string(), title: z.string(), description: z.string(),
          code: z.string().optional(), barcodeUrl: z.string().url().optional(), discountPercent: z.number().optional(),
          discountAmountCents: z.number().int().optional(), cashbackPercent: z.number().optional(), membershipProgram: z.string().optional(),
          productApplicability: z.enum(["PRODUCT_CONFIRMED", "MERCHANT_WIDE", "UNKNOWN"]).optional(),
          applicableProductIds: z.array(z.string()).optional(),
          eligibility: z.array(z.string()), channels: z.array(z.string()), sourceUrl: z.string().url(), checkedAt: z.string(), validTo: z.string()
        }))
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (input) => {
      const { responseLocale, ...validated } = FindCouponsInputSchema.parse(input);
      const localized = (english: string, chinese: string) => responseLocale === "zh-CN" ? chinese : english;
      try {
        const checkedAt = now().getTime();
        const requestedMerchant = validated.merchant.toLocaleLowerCase("en-US");
        const deals = VerifiedDealsSchema.parse(await dealPort.search(validated)).filter((deal) => {
          const observedAt = Date.parse(deal.checkedAt);
          const channelMatches = validated.channel === "ANY" || deal.channels.includes(validated.channel);
          return deal.merchant.toLocaleLowerCase("en-US") === requestedMerchant && channelMatches &&
            observedAt <= checkedAt + 120_000 && observedAt >= checkedAt - 86_400_000 &&
            Date.parse(deal.validFrom) <= checkedAt && Date.parse(deal.validTo) > checkedAt;
        });
        const message = deals.length === 0
          ? localized(
            "No current verified merchant deal was found. A joined affiliate merchant does not necessarily have an active Coupon or promotion.",
            "当前没有找到该商家的已验证有效优惠。商家已加入联盟计划，不代表当前一定有 Coupon 或促销。"
          )
          : localized(
            `Found ${deals.length} current verified merchant deal(s). Check each offer's eligibility for this product.`,
            `找到 ${deals.length} 个当前有效的商家优惠；请核对每个优惠对该商品的适用条件。`
          );
        return { content: [{ type: "text" as const, text: message }], structuredContent: {
          status: deals.length === 0 ? "NO_VERIFIED_DEALS" as const : "OK" as const,
          message,
          deals: deals.map(({ verificationStatus: _verificationStatus, validFrom: _validFrom, ...deal }) => deal)
        } };
      } catch {
        const message = localized(
          dealUnavailableMessage,
          "已验证 Coupon 和 Cashback 数据暂不可用：尚未配置获批的优惠接口，或本次请求失败。"
        );
        return { content: [{ type: "text" as const, text: message }], structuredContent: {
          status: "DATA_SOURCE_UNAVAILABLE" as const, message, deals: []
        } };
      }
    }
  );

  toolRegistrar.registerTool(
    "create_watch",
    {
      title: "Create a shopping watch",
      description: "For a clear Watch request, call without Memory, repo scans, or sequence narration. Persist one rule and return Automation handoff. PRICE_BELOW requires explicit ITEM_PRICE. DELIVERED_TOTAL Watch is unavailable because one-shot consent does not authorize recurring Cart quotes; do not ask for ZIP or selected quote references. For a selected WooCommerce product, pass its exact quoteReference to pin merchant/product/variant IDs. Binding alone records an Automation identifier, not verified host execution.",
      inputSchema: WatchSpecInputSchema,
      outputSchema: {
        status: z.enum(["READY_TO_SCHEDULE", "ACTIVE", "PAUSED", "LEGACY_UNVERIFIED", "NEEDS_CLARIFICATION", "DATA_SOURCE_UNAVAILABLE"]),
        message: z.string().optional(),
        watchId: z.string().uuid().optional(),
        automationId: WatchAutomationIdSchema.optional(),
        intervalMinutes: z.number().int().optional(),
        automationPrompt: z.string().optional(),
        questions: z.array(z.string())
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (input) => {
      const createdAt = now();
      const requested = WatchSpecInputSchema.parse(input);
      if (requested.priceBasis === "DELIVERED_TOTAL") {
        const message = "[RECURRING_QUOTE_AUTHORIZATION_UNAVAILABLE] " + (/\p{Script=Han}/u.test(requested.query)
          ? "暂不支持到手价持续监控：单次匿名购物车授权不授权持续监控报价。未请求报价或保存规则；不要索取 ZIP 或完整地址。可由用户另选商品价监控。"
          : "Delivered-total Watch is unavailable: one-time anonymous Cart consent does not authorize recurring quotes. No quote or Watch was created; do not request ZIP or a street address. The user may instead choose item-price monitoring.");
        return { content: [{ type: "text" as const, text: message }], structuredContent: {
          status: "DATA_SOURCE_UNAVAILABLE" as const, message, questions: []
        } };
      }
      if (
        !toolAvailability.verifiedDeals &&
        ["DISCOUNT_AT_LEAST", "COUPON_AVAILABLE", "CASHBACK_AT_LEAST"].includes(requested.condition)
      ) {
        return { content: [{ type: "text" as const, text: dealUnavailableMessage }], structuredContent: {
          status: "DATA_SOURCE_UNAVAILABLE" as const,
          message: dealUnavailableMessage,
          questions: []
        } };
      }
      let selectedWoo: z.infer<typeof WatchSpecSchema>["selectedProduct"];
      if (requested.quoteReference !== undefined) {
        const selectedRender = requested.quoteReference.renderId ?? (requested.quoteReference.selectionId === undefined ? undefined : selections.get(requested.quoteReference.selectionId)?.renderId);
        const reference = selectedRender === undefined ? undefined : resolveSingleSelectionReference({ ...requested.quoteReference, renderId: selectedRender });
        const snapshot = reference === undefined ? undefined : renderSnapshots.get(reference.renderId);
        const entry = reference === undefined ? undefined : snapshot?.sourceProductIndex.get(reference.productKey);
        if (reference === undefined || snapshot === undefined || snapshot.expiresAt <= createdAt.getTime()) return {
          isError: true, content: [{ type: "text" as const, text: "[WATCH_REFERENCE_UNAVAILABLE] The original selection is unavailable; no watch was created." }]
        };
        if (entry?.sourceKind === "WOOCOMMERCE_STORE_API") {
          const product = entry.product;
          if (product.productType === "variable" || !woocommerceProducts) return { isError: true,
            content: [{ type: "text" as const, text: "[WATCH_TARGET_UNSUPPORTED] Select a verified simple product or exact variation; no watch was created." }] };
          selectedWoo = { ...wooProductTarget(product), sourceKind: "WOOCOMMERCE_STORE_API", productType: product.productType,
            merchant: product.merchantName, sourceHost: product.sourceHost, title: product.title, merchantUrl: product.merchantUrl,
            condition: product.condition, variantDimensions: product.selectedAttributes, selectedAt: createdAt.toISOString() };
        }
      }
      const questions = productWatchClarificationQuestions({ ...requested, ...(selectedWoo === undefined ? {} : { selectedProduct: selectedWoo }) });
      if (questions.length > 0) {
        const message = `More product detail is required before this watch can be created. ${questions.join(" ")}`;
        return { content: [{ type: "text" as const, text: message }], structuredContent: {
          status: "NEEDS_CLARIFICATION" as const,
          questions
        } };
      }
      const { quoteReference: _quoteReference, ...persistedInput } = requested;
      const spec = WatchSpecSchema.parse({ ...persistedInput, ...(selectedWoo === undefined ? {} : { selectedProduct: selectedWoo }) });
      if (spec.expiresAt !== undefined && Date.parse(spec.expiresAt) <= createdAt.getTime()) {
        throw new Error("expiresAt must be in the future");
      }
      let initialObservation: WooWatchObservation | undefined;
      if (selectedWoo !== undefined) {
        try {
          initialObservation = await observeWooProduct({ spec }, woocommerceProducts, now());
        } catch {
          const message = "[WATCH_SOURCE_UNAVAILABLE] The exact selected WooCommerce product could not be verified with fresh price or inventory; no watch was created.";
          return { content: [{ type: "text" as const, text: message }], structuredContent: {
            status: "DATA_SOURCE_UNAVAILABLE" as const, message, questions: []
          } };
        }
      }
      const watch = await watchStore.create(spec, createdAt.toISOString(), initialObservation === undefined ? undefined : {
        checkedAt: String(initialObservation.data["checkedAt"]), data: initialObservation.data
      });
      const automationPrompt = `Call FindCheap Agent check_watch exactly once with watchId ${watch.watchId}. Notify only for TRIGGERED; include value, checkedAt and source link, and deduplicate any completionEventId. NOT_TRIGGERED is silent. COMPLETED/EXPIRED/PAUSED/NOT_FOUND must not produce a new product alert. For STOP_REQUIRED, verify this task's own host Automation identity/scope before stopping it; the returned ID is only an unverified reference. Never claim host stop without real host evidence. Do not purchase, reserve, submit forms, or use Chrome.`;
      const status = watch.status === "PAUSED" ? "PAUSED" as const
        : watch.schedulingState === undefined ? "LEGACY_UNVERIFIED" as const
          : watch.automationId === undefined ? "READY_TO_SCHEDULE" as const : "ACTIVE" as const;
      const message = status === "ACTIVE"
        ? `Watch ${watch.watchId} is locally active with recorded Automation ${watch.automationId}; host ownership and scheduling remain unverified.`
        : status === "PAUSED"
          ? `Watch ${watch.watchId} already exists and is paused.`
        : status === "LEGACY_UNVERIFIED"
          ? `Watch ${watch.watchId} predates Automation binding. Reconcile its existing Codex Automation before changing it.`
        : `Watch ${watch.watchId} is ready for Codex Automation scheduling every ${watch.spec.intervalMinutes} minutes.`;
      return { content: [{ type: "text" as const, text: message }], structuredContent: {
        status,
        watchId: watch.watchId,
        ...(watch.automationId === undefined ? {} : { automationId: watch.automationId }),
        intervalMinutes: watch.spec.intervalMinutes,
        automationPrompt,
        questions: []
      } };
    }
  );

  toolRegistrar.registerTool(
    "bind_watch_automation",
    {
      title: "Bind a Codex Automation to a shopping watch",
      description: "Record an unverified Codex Automation identifier for a local Watch. Binding is not proof of host ownership, scheduling, or stop acknowledgement; terminal rules cannot rebind.",
      inputSchema: z.object({ watchId: z.string().uuid(), automationId: WatchAutomationIdSchema }).strict(),
      outputSchema: {
        status: z.enum(["ACTIVE", "PAUSED", "EXPIRED", "COMPLETED", "NOT_FOUND", "AUTOMATION_ALREADY_BOUND", "AUTOMATION_SYNC_REQUIRED"]),
        watchId: z.string().uuid(),
        automationId: WatchAutomationIdSchema,
        stopIntent: WatchStopIntentSchema.optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ watchId, automationId }) => {
      const watch = await watchStore.get(watchId);
      if (watch === undefined) {
        return {
          content: [{ type: "text" as const, text: "Watch not found." }],
          structuredContent: { status: "NOT_FOUND" as const, watchId, automationId }
        };
      }
      const boundAt = now();
      if (watch.status === "COMPLETED" || watch.status === "EXPIRED" ||
        (watch.spec.expiresAt !== undefined && Date.parse(watch.spec.expiresAt) <= boundAt.getTime())) {
        const terminal = (await evaluateWatch(watch, watchStore, shopifyPort, dealPort, cartQuotes, boundAt, woocommerceProducts)).watch;
        return {
          content: [{ type: "text" as const, text: "Watch is locally terminal and cannot bind or resume; host scheduling remains unverified." }],
          structuredContent: { status: terminal.status, watchId, automationId: terminal.automationId ?? automationId,
            ...(terminal.stopIntent === undefined ? {} : { stopIntent: terminal.stopIntent }) }
        };
      }
      if (watch.automationId !== undefined && watch.automationId !== automationId) {
        return {
          content: [{ type: "text" as const, text: "Watch is already bound to a different Codex Automation." }],
          structuredContent: { status: "AUTOMATION_ALREADY_BOUND" as const, watchId, automationId: watch.automationId }
        };
      }
      if (watch.stopIntent !== undefined) return {
        content: [{ type: "text" as const, text: "STOP_REQUIRED is unresolved; binding cannot acknowledge or restart the host scheduler." }],
        structuredContent: { status: "AUTOMATION_SYNC_REQUIRED" as const, watchId, automationId, stopIntent: watch.stopIntent }
      };
      const conflict = (await watchStore.list()).find((candidate) =>
        candidate.watchId !== watchId && candidate.automationId === automationId
      );
      const reserved = (await watchStore.listPendingStops()).some(stop => stop.watchId !== watchId && stop.automationId === automationId);
      if (conflict !== undefined || reserved) {
        return {
          content: [{ type: "text" as const, text: "Codex Automation is already bound to a different watch." }],
          structuredContent: { status: "AUTOMATION_ALREADY_BOUND" as const, watchId, automationId }
        };
      }
      const updated = { ...watch, automationId, schedulingState: "BOUND" as const, updatedAt: boundAt.toISOString() };
      const stopIntent = watch.status === "PAUSED" ? watchStopIntent(updated, "PAUSED", boundAt.toISOString()) : undefined;
      const saved = await watchStore.save({ ...updated, ...(stopIntent === undefined ? {} : { stopIntent }) });
      return {
        content: [{ type: "text" as const, text: `Watch is locally ${saved.status.toLowerCase()}; the recorded Automation ID is unverified host state, not ownership or stop acknowledgement.` }],
        structuredContent: { status: saved.status, watchId, automationId,
          ...(saved.stopIntent === undefined ? {} : { stopIntent: saved.stopIntent }) }
      };
    }
  );

  toolRegistrar.registerTool(
    "check_watch",
    {
      title: "Check a shopping watch",
      description: "Evaluate a persisted Watch. A completed restock may return its original completionNotification for recovery; DELIVERY_UNCONFIRMED is not a delivery ACK or a new stock observation. Repeated COMPLETED results must not trigger another product alert.",
      inputSchema: z.object({ watchId: z.string().uuid() }).strict(),
      outputSchema: {
        status: z.enum(["TRIGGERED", "NOT_TRIGGERED", "PAUSED", "EXPIRED", "COMPLETED", "NEEDS_CLARIFICATION", "NOT_SCHEDULED", "NOT_FOUND", "DATA_SOURCE_UNAVAILABLE"]),
        message: z.string(),
        watchId: z.string().uuid(),
        observation: z.record(z.string(), z.unknown()).optional(),
        completionEventId: z.string().uuid().optional(),
        completionNotification: WatchCompletionNotificationSchema.optional(),
        stopIntent: WatchStopIntentSchema.optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ watchId }) => {
      const watch = await watchStore.get(watchId);
      if (watch === undefined) {
        const stopIntent = (await watchStore.listPendingStops()).find(stop => stop.watchId === watchId);
        const message = stopIntent === undefined ? "Watch not found." : "Watch is locally deleted; STOP_REQUIRED remains pending and host scheduling is unverified.";
        return { content: [{ type: "text" as const, text: message }], structuredContent: {
          status: "NOT_FOUND" as const, message, watchId, ...(stopIntent === undefined ? {} : { stopIntent })
        } };
      }
      const questions = productWatchClarificationQuestions(watch.spec);
      const expired = watch.spec.expiresAt !== undefined && Date.parse(watch.spec.expiresAt) <= now().getTime();
      if (
        questions.length === 0 && watch.status === "ACTIVE" && !expired &&
        watch.schedulingState === "PENDING"
      ) {
        const message = "Watch rule exists, but no Codex Automation is bound; monitoring is not active.";
        return { content: [{ type: "text" as const, text: message }], structuredContent: {
          status: "NOT_SCHEDULED" as const, message, watchId
        } };
      }
      const previous = watchChecks.get(watchId);
      const ready = previous === undefined ? Promise.resolve() : previous.then(() => undefined, () => undefined);
      const check = ready.then(async () => {
        const latest = await watchStore.get(watchId);
        if (latest === undefined) throw new Error("Watch not found");
        return evaluateWatch(latest, watchStore, shopifyPort, dealPort, cartQuotes, now(), woocommerceProducts);
      });
      watchChecks.set(watchId, check);
      const result = await check.finally(() => {
        if (watchChecks.get(watchId) === check) watchChecks.delete(watchId);
      });
      return { content: [{ type: "text" as const, text: result.message }], structuredContent: {
        status: result.status,
        message: result.message,
        watchId,
        ...(result.watch.completionEventId === undefined ? {} : { completionEventId: result.watch.completionEventId }),
        ...(result.watch.completionNotification === undefined ? {} : { completionNotification: result.watch.completionNotification }),
        ...(result.watch.stopIntent === undefined ? {} : { stopIntent: result.watch.stopIntent }),
        ...(result.observation === undefined ? {} : { observation: result.observation })
      } };
    }
  );

  toolRegistrar.registerTool(
    "list_watches",
    {
      title: "List shopping watches",
      description: "List local Watch states and minimal pending scheduler stops without contacting merchants. ACTIVE/BOUND never proves host ownership or scheduling; STOP_REQUIRED is not acknowledged.",
      inputSchema: z.object({}).strict(),
      outputSchema: { watches: z.array(z.object({
        watchId: z.string().uuid(),
        status: z.string(),
        monitoringStatus: z.enum(["READY_TO_SCHEDULE", "ACTIVE", "PAUSED", "EXPIRED", "COMPLETED", "LEGACY_UNVERIFIED"]),
        notificationStatus: z.literal("DELIVERY_UNCONFIRMED").optional(),
        automationId: WatchAutomationIdSchema.optional(),
        completionEventId: z.string().uuid().optional(),
        stopIntent: WatchStopIntentSchema.optional(),
        query: z.string(),
        condition: z.string(),
        priceBasis: z.enum(["ITEM_PRICE", "DELIVERED_TOTAL"]).optional(),
        intervalMinutes: z.number().int()
      })), pendingStops: z.array(WatchStopIntentSchema).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => {
      const pendingStops = await watchStore.listPendingStops();
      return { content: [{ type: "text" as const, text: "Local shopping watches listed; host ownership, scheduling and stop acknowledgement remain unverified." }], structuredContent: { watches: (await watchStore.list()).map((watch) => ({
      watchId: watch.watchId,
      status: watch.status,
      monitoringStatus: watch.status !== "ACTIVE" ? watch.status
          : watch.schedulingState === undefined ? "LEGACY_UNVERIFIED" as const
            : watch.automationId === undefined ? "READY_TO_SCHEDULE" as const : "ACTIVE" as const,
      ...(watch.automationId === undefined ? {} : { automationId: watch.automationId }),
      ...(watch.completionEventId === undefined ? {} : { completionEventId: watch.completionEventId }),
      ...(watch.completionNotification === undefined ? {} : { notificationStatus: watch.completionNotification.status }),
      ...(watch.stopIntent === undefined ? {} : { stopIntent: watch.stopIntent }),
      query: watch.spec.query,
      condition: watch.spec.condition,
      ...(watch.spec.priceBasis === undefined ? {} : { priceBasis: watch.spec.priceBasis }),
      intervalMinutes: watch.spec.intervalMinutes
    })), ...(pendingStops.length === 0 ? {} : { pendingStops }) } };
    }
  );

  toolRegistrar.registerTool(
    "pause_watch",
    {
      title: "Pause or resume a shopping watch",
      description: "Pause local Watch checks first, returning any STOP_REQUIRED handoff; never treat a supplied Automation ID as host acknowledgement. Resume is blocked for terminal, legacy or unresolved-stop rules.",
      inputSchema: z.object({ watchId: z.string().uuid(), paused: z.boolean(), automationId: WatchAutomationIdSchema.optional() }).strict(),
      outputSchema: { status: z.enum(["ACTIVE", "PAUSED", "EXPIRED", "COMPLETED", "NOT_FOUND", "AUTOMATION_SYNC_REQUIRED"]), watchId: z.string().uuid(), automationId: WatchAutomationIdSchema.optional(), stopIntent: WatchStopIntentSchema.optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ watchId, paused, automationId }) => {
      if (!paused && taskScope.taskId() !== undefined && dependencies.taskLifecycle !== undefined) {
        const taskId = taskScope.taskId();
        if (taskId === undefined || await dependencies.taskLifecycle.status(taskId) !== "ACTIVE") return toolError("TASK_HOST_STATE_UNAVAILABLE");
      }
      const watch = await watchStore.get(watchId);
      if (watch === undefined) return { content: [{ type: "text" as const, text: "Watch not found." }], structuredContent: { status: "NOT_FOUND" as const, watchId } };
      if (automationId !== undefined && watch.automationId !== automationId) {
        return {
          content: [{ type: "text" as const, text: "Automation binding mismatch; verify the reference. No local or host state changed." }],
          structuredContent: { status: "AUTOMATION_SYNC_REQUIRED" as const, watchId, ...(watch.automationId === undefined ? {} : { automationId: watch.automationId }) }
        };
      }
      const changedAt = now();
      if (watch.status === "COMPLETED" || watch.status === "EXPIRED" ||
        (watch.spec.expiresAt !== undefined && Date.parse(watch.spec.expiresAt) <= changedAt.getTime())) {
        const terminal = (await evaluateWatch(watch, watchStore, shopifyPort, dealPort, cartQuotes, changedAt, woocommerceProducts)).watch;
        return { content: [{ type: "text" as const, text: "Watch is locally terminal and cannot resume; host scheduling remains unverified." }], structuredContent: {
          status: terminal.status, watchId, ...(terminal.automationId === undefined ? {} : { automationId: terminal.automationId }),
          ...(terminal.stopIntent === undefined ? {} : { stopIntent: terminal.stopIntent })
        } };
      }
      if (!paused && (watch.stopIntent !== undefined || watch.schedulingState === undefined)) {
        return {
          content: [{ type: "text" as const, text: "Resume refused: unresolved STOP_REQUIRED or legacy scheduler state needs trusted host reconciliation, which this binding cannot acknowledge." }],
          structuredContent: { status: "AUTOMATION_SYNC_REQUIRED" as const, watchId,
            ...(watch.automationId === undefined ? {} : { automationId: watch.automationId }),
            ...(watch.stopIntent === undefined ? {} : { stopIntent: watch.stopIntent }) }
        };
      }
      const status = paused ? "PAUSED" as const : "ACTIVE" as const;
      const stopIntent = paused ? watchStopIntent(watch, "PAUSED", changedAt.toISOString()) : undefined;
      if (watch.status !== status || stopIntent !== watch.stopIntent) await watchStore.save({ ...watch, status, updatedAt: changedAt.toISOString(),
        ...(stopIntent === undefined ? {} : { stopIntent }) });
      return { content: [{ type: "text" as const, text: `Watch is locally ${status.toLowerCase()}; host scheduling and stop acknowledgement remain unverified.` }], structuredContent: {
        status, watchId, ...(watch.automationId === undefined ? {} : { automationId: watch.automationId }),
        ...(stopIntent === undefined ? {} : { stopIntent })
      } };
    }
  );

  toolRegistrar.registerTool(
    "delete_watch",
    {
      title: "Delete a shopping watch",
      description: "Delete the local Watch first and retain a minimal STOP_REQUIRED handoff. The host must verify ownership/scope and stop its Automation separately; an identifier is not acknowledgement.",
      inputSchema: z.object({ watchId: z.string().uuid(), automationId: WatchAutomationIdSchema.optional() }).strict(),
      outputSchema: { status: z.enum(["DELETED", "NOT_FOUND", "AUTOMATION_SYNC_REQUIRED"]), deleted: z.boolean(), watchId: z.string().uuid(), automationId: WatchAutomationIdSchema.optional(), stopIntent: WatchStopIntentSchema.optional() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
    },
    async ({ watchId, automationId }) => {
      const watch = await watchStore.get(watchId);
      const pendingStop = (await watchStore.listPendingStops()).find(stop => stop.watchId === watchId);
      const recordedAutomationId = watch?.automationId ?? pendingStop?.automationId;
      if (automationId !== undefined && recordedAutomationId !== automationId) {
        return {
          content: [{ type: "text" as const, text: "Automation binding mismatch; verify the reference. No local or host state changed." }],
          structuredContent: {
            status: "AUTOMATION_SYNC_REQUIRED" as const,
            deleted: false,
            watchId,
            ...(recordedAutomationId === undefined ? {} : { automationId: recordedAutomationId })
          }
        };
      }
      const removed = await watchStore.delete(watchId);
      const stopIntent = (await watchStore.listPendingStops()).find(stop => stop.watchId === watchId);
      const deleted = removed || stopIntent !== undefined;
      return { content: [{ type: "text" as const, text: deleted ? "Watch locally deleted; host scheduling and stop acknowledgement remain unverified." : "Watch not found." }], structuredContent: {
        status: deleted ? "DELETED" as const : "NOT_FOUND" as const,
        deleted,
        watchId,
        ...(recordedAutomationId === undefined ? {} : { automationId: recordedAutomationId }),
        ...(stopIntent === undefined ? {} : { stopIntent })
      } };
    }
  );

  toolRegistrar.registerTool(
    "render_product_cards",
    {
      title: "Render identity-labeled product cards",
      description: "Render the immutable cross-source snapshot identified by renderId from search_products.",
      inputSchema: z.object({ renderId: z.string().uuid() }).strict(),
      outputSchema: ShopifyProductsOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: {
        ui: { resourceUri: PRODUCT_CARD_UI_URI, visibility: ["app"] },
        "openai/outputTemplate": PRODUCT_CARD_UI_URI,
        "openai/toolInvocation/invoking": "Rendering product cards…",
        "openai/toolInvocation/invoked": "Product cards ready."
      }
    },
    async ({ renderId }) => {
      const snapshot = renderSnapshots.get(renderId);
      if (snapshot === undefined || snapshot.expiresAt <= now().getTime()) {
        deleteSnapshot(renderId);
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Product-card snapshot is unavailable. Run search_products once."
          }]
        };
      }
      return {
        content: [{
          type: "text" as const,
          text: `Rendered ${snapshot.content.products.length} product card${snapshot.content.products.length === 1 ? "" : "s"} with explicit identity labels.`
        }],
        structuredContent: snapshot.content
      };
    }
  );

  toolRegistrar.registerTool(
    "sync_product_card_selection",
    {
      title: "Sync product-card selection",
      description: "Store bounded UI selection state for one active immutable product-card snapshot.",
      inputSchema: ProductCardSelectionInputSchema,
      outputSchema: {
        status: z.enum(["RECORDED", "IGNORED"]),
        selectedCount: z.number().int().min(0).max(4)
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: { ui: { visibility: ["app"] } }
    },
    async (input) => {
      const selection = ProductCardSelectionInputSchema.parse(input);
      const snapshot = renderSnapshots.get(selection.renderId);
      if (snapshot === undefined || snapshot.expiresAt <= now().getTime()) {
        deleteSnapshot(selection.renderId);
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Product-card selection snapshot is unavailable." }]
        };
      }
      const validSelectionIds = new Set(snapshot.content.products.flatMap((product) =>
        product.selectionId === undefined ? [] : [product.selectionId]
      ));
      if (selection.selectionIds.some((selectionId) => !validSelectionIds.has(selectionId))) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Product-card selection does not belong to this snapshot." }]
        };
      }
      const current = cardSelections.get(selection.renderId);
      if (current !== undefined && current.revision >= selection.revision) {
        return {
          content: [{ type: "text" as const, text: "Stale product-card selection update ignored." }],
          structuredContent: { status: "IGNORED" as const, selectedCount: current.selectionIds.length }
        };
      }
      cardSelections.set(selection.renderId, {
        revision: selection.revision,
        selectionIds: [...selection.selectionIds]
      });
      return {
        content: [{ type: "text" as const, text: "Product-card selection synced." }],
        structuredContent: { status: "RECORDED" as const, selectedCount: selection.selectionIds.length }
      };
    }
  );

  toolRegistrar.registerTool(
    "report_product_card_metrics",
    {
      title: "Report product-card performance metrics",
      description: "Record bounded, non-sensitive product-card lifecycle timings for an active render snapshot.",
      inputSchema: ProductCardTelemetryInputSchema,
      outputSchema: { status: z.enum(["RECORDED", "IGNORED"]) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: { ui: { visibility: ["app"] } }
    },
    async (input) => {
      const telemetry = ProductCardTelemetryInputSchema.parse(input);
      const snapshot = renderSnapshots.get(telemetry.renderId);
      if (snapshot === undefined || snapshot.expiresAt <= now().getTime()) {
        deleteSnapshot(telemetry.renderId);
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Product-card telemetry snapshot is unavailable." }]
        };
      }
      const key = `${telemetry.renderId}:${telemetry.terminalStage}`;
      if (recordedCardTelemetry.has(key)) {
        return {
          content: [{ type: "text" as const, text: "Product-card metrics already recorded." }],
          structuredContent: { status: "IGNORED" as const }
        };
      }
      const event = { ...telemetry, recordedAt: now().toISOString() };
      await cardTelemetry.record(event);
      recordedCardTelemetry.add(key);
      while (recordedCardTelemetry.size > 96) {
        const oldest = recordedCardTelemetry.values().next().value as string | undefined;
        if (oldest === undefined) break;
        recordedCardTelemetry.delete(oldest);
      }
      return {
        content: [{ type: "text" as const, text: "Product-card metrics recorded." }],
        structuredContent: { status: "RECORDED" as const }
      };
    }
  );

  return server;
}
