import { createHash, randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { productReferenceKey } from "./product-reference.js";
import { createFindCheapBackend, type FindCheapBackend } from "./backend.js";
import { ToolExecutor } from "./execution/tool-executor.js";
import { toolError } from "./execution/tool-outcome.js";
import { SearchRun, SearchBudgetError, SearchReadTimeoutError } from "./search-run.js";
import { buildVisualRetrievalQuery } from "./visual-retrieval-query.js";
import { assessVisualVerdict, hasAdmissibleVisualConflict } from "./visual-review-policy.js";
import { researchRecommendationMessage } from "./recommendation-message.js";
import type { OfficialCatalogPort } from "./official-catalog.js";
import { searchDiagnostics, type SearchOutcome } from "./search-diagnostics.js";
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
import { hasSpecificProductIdentity } from "./shopify-match.js";
import {
  ShopifyCartQuoteError,
  type ShopifyCartQuotePort,
  type ShopifyCartEstimate,
  type ShopifyQuoteFailureCode
} from "./shopify-cart-quote.js";
import type { ShopifySelectedProductInspector } from "./shopify-selected-product.js";
import type { OfficialShopifySearchPort } from "./shopify-official-store-search.js";
import type { OfficialStorefrontRegistryPort } from "./official-storefront-registry-client.js";
import type { MerchantTrustRegistryPort } from "./merchant-trust-registry-client.js";
import {
  VisualCandidateImageError,
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
import { DealAssessmentSchema, DealSummarySchema, assessSelectedProductDeal, rankAssessedDeals } from "./deal-assessment.js";
import {
  WatchSpecSchema,
  WatchSpecInputSchema,
  WatchAutomationIdSchema,
  productWatchClarificationQuestions,
  createMemoryWatchStore,
  type WatchStore
} from "./watch-store.js";
import { evaluateWatch, type WatchEvaluation } from "./watch-service.js";
import {
  currentMerchantTrustRegistryVersion,
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
  const productKey = candidate.source === "SHOPIFY_GLOBAL_CATALOG"
    ? productReferenceKey(candidate.shopifyProduct)
    : candidate.source === "AWIN_PRODUCT_FEED"
      ? JSON.stringify([candidate.source, candidate.awinProduct.merchantId, candidate.awinProduct.merchantProductId])
      : JSON.stringify([candidate.source, candidate.ebayProduct.itemId]);
  const merchantUrl = candidate.source === "AWIN_PRODUCT_FEED"
    ? candidate.awinProduct.merchantUrl
    : candidate.source === "EBAY_BROWSE"
      ? candidate.ebayProduct.merchantUrl
      : candidate.shopifyProduct.merchantUrl;
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
  const product = candidate.source === "SHOPIFY_GLOBAL_CATALOG" ? candidate.shopifyProduct
    : candidate.source === "AWIN_PRODUCT_FEED" ? awinCardProduct(candidate) : ebayCardProduct(candidate);
  return createHash("sha256").update(productReferenceKey(product)).digest("hex");
}

function visualEvaluationMeta(execution: UnifiedSearchExecution, retrieved: ReadonlySet<string>,
  entries: Array<{ candidateId: string; candidate: UnifiedCandidate; image: { data: string } }> = [],
  products?: ProductCardProduct[], primarySelectionId?: string) {
  const hash = (product: ProductCardProduct) => createHash("sha256").update(productReferenceKey(product)).digest("hex");
  const primary = primarySelectionId === undefined ? undefined : products?.find((product) => product.selectionId === primarySelectionId);
  return { "findcheap/visualEvaluation": {
    version: 1, traceId: execution.searchRun?.traceId,
    retrievedProductHashes: [...retrieved],
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
  zipCode: ZipCodeSchema
}).strict().superRefine(validateSingleProductSelector);

const ProductComparisonOptionsSchema = ProductComparisonInputSchema.omit({ selectionIds: true });
const ProductComparisonToolInputSchema = ProductComparisonOptionsSchema.extend({
  renderId: RenderIdSchema,
  selectionIds: ProductComparisonInputSchema.shape.selectionIds.optional()
}).strict();

const QuotedProductComparisonOptionsSchema = ProductComparisonOptionsSchema.extend({ zipCode: ZipCodeSchema });
const QuotedProductComparisonInputSchema = QuotedProductComparisonOptionsSchema.extend({
  renderId: RenderIdSchema,
  selectionIds: ProductComparisonInputSchema.shape.selectionIds.optional()
}).strict();

export const VisualCandidateSearchInputSchema = SearchProductsInputSchema
  .omit({ limit: true })
  .extend({ visualInput: VisualProductInputSchema });

const VisualCandidateDescriptorShape = z.object({
  candidateId: z.string().uuid(),
  title: z.string(),
  merchant: z.string(),
  source: z.enum(["AWIN_PRODUCT_FEED", "SHOPIFY_GLOBAL_CATALOG", "EBAY_BROWSE"]),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"])
}).strict();

const VisualCandidateOutputShape = {
  status: z.enum(["OK", "NO_IMAGE_CANDIDATES", "DATA_SOURCE_UNAVAILABLE"]),
  message: z.string(),
  visualSessionId: VisualSessionIdSchema.optional(),
  expiresAt: z.string().optional(),
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
  renderId: RenderIdSchema,
  selectionId: SelectionIdSchema.optional(),
  position: ProductPositionSchema.optional(),
  ...DealConciergeOptionsShape
}).strict().superRefine(validateSingleProductSelector);

const DealConciergeOutputShape = {
  status: z.enum(["OK", "SELECTION_UNAVAILABLE"]),
  message: z.string(),
  selectionId: SelectionIdSchema.optional(),
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

function quoteFailureMessage(code: ShopifyQuoteFailureCode): string {
  switch (code) {
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
  variantDimensions: VariantDimensionsSchema
}).strict().superRefine(validateSingleProductSelector);

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
  sourceKind: z.enum(["AWIN_PRODUCT_FEED", "SHOPIFY_GLOBAL_CATALOG", "EBAY_BROWSE"]).optional(),
  sourceEnvironment: z.enum(["PRODUCTION", "SANDBOX"]).optional(),
  affiliateState: z.enum(["APPROVED", "NONE"]).optional(),
  featureEvidence: z.array(z.string()).optional(),
  preferenceEvidence: z.array(z.string()).optional(),
  requiredFeatureLimitations: z.array(z.string()).optional(),
  resultGroup: z.enum(["REQUESTED_PRODUCT", "DISCOVERY", "ALTERNATIVE"]).optional(),
  presentationGroup: z.enum(["OFFICIAL_STORE", "TRUSTED_MATCH", "BEST_VALUE"]).optional(),
  visualMatchGroup: z.enum(["POSSIBLE_SAME_ITEM", "HIGHLY_SIMILAR", "SAME_STYLE"]).optional(),
  visualReviewAssessment: z.object({
    group: z.enum(["POSSIBLE_SAME_ITEM", "HIGHLY_SIMILAR", "SAME_STYLE"]),
    structuralMatchCount: z.number().int().min(0).max(16),
    matchCount: z.number().int().min(0).max(16)
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
      "MERCHANT_UNVERIFIED"
    ]),
    quoteCapability: z.enum(["DELIVERED_TOTAL_SUPPORTED", "ZIP_ESTIMATE_ONLY", "MERCHANT_CHECKOUT_ONLY"]),
    actionLabel: z.literal("View at merchant")
  }),
  selectionId: SelectionIdSchema.optional(),
  quoteCapability: z.enum(["DELIVERED_TOTAL_SUPPORTED", "ZIP_ESTIMATE_ONLY", "MERCHANT_CHECKOUT_ONLY"]),
  quoteReference: z.object({
    selectionId: SelectionIdSchema,
    renderId: z.string().uuid(),
    variantId: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/u)
  }).strict().optional()
});

const ShopifyProductsOutputShape = {
  renderId: z.string().uuid().optional(),
  traceId: z.string().uuid().optional(),
  locale: z.enum(["en-US", "zh-CN"]).optional(),
  status: z.enum(["OK", "NEEDS_CLARIFICATION", "DATA_SOURCE_UNAVAILABLE"]),
  message: z.string(),
  source: z.enum(["SHOPIFY_GLOBAL_CATALOG", "UNIFIED_PRODUCT_SEARCH"]),
  sources: z.object({
    awin: z.enum(["SKIPPED", "COMPLETE", "UNAVAILABLE"]),
    shopify: z.enum(["SKIPPED", "COMPLETE", "PARTIAL", "UNAVAILABLE"]),
    ebay: z.enum(["SKIPPED", "COMPLETE", "UNAVAILABLE"])
  }).optional(),
  searchIntent: z.enum(["EXACT_PRODUCT", "CATEGORY_DISCOVERY", "VISUAL_DISCOVERY"]).optional(),
  sourceErrors: z.object({
    awin: z.literal("DATA_SOURCE_UNAVAILABLE").optional(),
    shopify: z.enum(["CATALOG_SCHEMA_CHANGED", "DATA_SOURCE_UNAVAILABLE"]).optional(),
    ebay: z.literal("DATA_SOURCE_UNAVAILABLE").optional()
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
    state: z.enum(["READY", "NEEDS_CLARIFICATION", "RESEARCH_ONLY", "NO_MATCH"]),
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
        sourceKind: "SHOPIFY_GLOBAL_CATALOG" as const,
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
            : product.recommendationTier === "HIGH_RATED_UNVERIFIED"
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
    if (candidate.source === "AWIN_PRODUCT_FEED") {
      return [withVerifiedCoupons(awinCardProduct(candidate), candidate.verifiedCoupons, candidate.dealLookupStatus)];
    }
    if (candidate.source === "EBAY_BROWSE") {
      return [withVerifiedCoupons(ebayCardProduct(candidate), candidate.verifiedCoupons, candidate.dealLookupStatus)];
    }
    const card = shopifyCards.get(productReferenceKey(candidate.shopifyProduct));
    return card === undefined ? [] : [withVerifiedCoupons({
      ...card,
      sourceKind: "SHOPIFY_GLOBAL_CATALOG" as const,
      affiliateState: card.purchaseLink.kind === "APPROVED_AFFILIATE"
        ? "APPROVED" as const
        : "NONE" as const,
      featureEvidence: candidate.featureEvidence,
      preferenceEvidence: candidate.preferenceEvidence,
      requiredFeatureLimitations: candidate.requiredFeatureLimitations,
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
  const affiliateCount = products.filter((product) => product.affiliateState === "APPROVED").length;
  const itemPriceCount = products.filter((product) => product.itemPrice !== undefined).length;
  const couponCount = products.reduce((count, product) => count + product.coupons.verified.length, 0);
  const unavailableSource = Object.values(execution.sourceStatus).includes("UNAVAILABLE");
  const budgetExhausted = execution.searchRun?.diagnostics().budgetExhausted === true;
  const partialSource = execution.sourceStatus.shopify === "PARTIAL" || budgetExhausted;
  const highRatedUnverifiedCount = products.filter((product) =>
    product.recommendationTier === "HIGH_RATED_UNVERIFIED"
  ).length;
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
  const merchantCount = new Set(products.map((product) => product.merchantId)).size;
  const coverage = unavailableSource || partialSource ? "PARTIAL" as const : "COMPLETE" as const;
  const recommendation = choosePrimaryRecommendation(products);
  const locale = input.responseLocale ?? (/\p{Script=Han}/u.test(input.query) ? "zh-CN" as const : "en-US" as const);
  const localized = (english: string, chinese: string) => locale === "zh-CN" ? chinese : english;
  const chromeAdvice = execution.chromeFallbackEligible
    ? execution.searchIntent === "EXACT_PRODUCT"
      ? localized(
          "No configured source returned a qualifying match for the requested product; unrelated alternatives were not substituted. The user may authorize one bounded Chrome whole-web fallback.",
          "现有来源没有返回符合要求的同款商品，也没有用无关替代品凑数。用户可以授权一次受限的 Chrome 全网搜索。"
        )
      : localized(
          "No configured source returned a qualifying product. The user may authorize one bounded Chrome whole-web fallback.",
          "现有来源没有返回符合要求的商品。用户可以授权一次受限的 Chrome 全网搜索。"
        )
    : "";
  const sourceFailureMessage = execution.sourceErrors?.shopify === "CATALOG_SCHEMA_CHANGED"
    ? localized(
        "Shopify Catalog response schema changed and could not be safely parsed. No zero-result conclusion was made; retry after the connector is updated.",
        "Shopify Catalog 返回结构发生变化，当前无法安全解析，因此不能据此判断没有商品。连接器更新后可重试。"
      )
    : unavailableSource
      ? localized(
          "A configured product source is unavailable. No zero-result conclusion was made.",
          "一个已配置的商品来源暂时不可用，因此不能据此判断没有商品。"
        )
      : "";
  const message = products.length === 0
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
          : researchRecommendationMessage({ productCount: products.length, merchantCount,
              reasonCodes: recommendation.reasonCodes }, locale),
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
        ...(independentlyTrustedCount > 0
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
  const dataUnavailable = products.length === 0 && (
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
          ...(independentlyTrustedCount > 0
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
      comparison: execution.candidates.some((candidate) => candidate.source !== "SHOPIFY_GLOBAL_CATALOG")
        ? {
            status: "DISCOVERY_ONLY" as const,
            evidence: ["cross-source results are product recommendations, not independently verified same-product offers"],
            merchantCount: new Set(products.map((product) => product.merchantId)).size,
            offerCount: products.length
          }
        : shopifyResponse.structuredContent.comparison,
      diagnostics: {
        ...shopifyResponse.structuredContent.diagnostics,
        featureProductsExcluded: execution.featureProductsExcluded,
        brandProductsExcluded: execution.brandProductsExcluded,
        visualProductsExcluded: execution.visualProductsExcluded,
        identityProductsExcluded: shopifyResponse.structuredContent.diagnostics.identityProductsExcluded + execution.identityProductsExcluded,
        chromeFallbackEligible: execution.chromeFallbackEligible
      },
      questions: input.visualInput === undefined
        ? shopifyResponse.structuredContent.questions
        : shopifyResponse.structuredContent.questions.slice(0, 1),
      products
    }
  };
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
    variantDimensions: {},
    matchStatus: candidate.identityStatus === "SIMILAR" ? "SIMILAR" : product.matchStatus,
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
      matchBadge: candidate.identityStatus === "SIMILAR" ? "SIMILAR" : product.matchStatus,
      conditionBadge: product.condition,
      availability: product.availability,
      merchantTrustBadge: "TRUSTED_MERCHANT",
      quoteCapability: "MERCHANT_CHECKOUT_ONLY",
      actionLabel: "View at merchant"
    }
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
    matchStatus: candidate.identityStatus === "SIMILAR" ? "SIMILAR" : product.matchStatus,
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
      matchBadge: candidate.identityStatus === "SIMILAR" ? "SIMILAR" : product.matchStatus,
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
    dealAppliesToProduct(deal, product.handle)
  ).map((deal) => ({ ...deal, assessment: assessSelectedProductDeal(deal, {
    merchantProductId: product.handle, title: product.title,
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
  const first = coupons[0]!;
  const couponValue = first.code !== undefined
    ? first.code
    : first.discountPercent !== undefined
      ? `${first.discountPercent}% off`
      : first.discountAmount !== undefined
        ? `$${(first.discountAmount.amountCents / 100).toFixed(2)} off`
        : first.title;
  const couponLabel = first.productApplicability === "PRODUCT_CONFIRMED"
    ? `Verified Coupon: ${couponValue}`
    : first.productApplicability === "MERCHANT_WIDE"
      ? `Merchant offer: ${couponValue}`
      : `Offer eligibility unconfirmed: ${couponValue}`;
  const estimatedPrice = product.itemPrice === undefined
    ? undefined
    : estimatedItemPriceAfterCoupon(product.itemPrice.amountCents,
      rankedDeals.filter((deal) => deal.assessment.status === "CONFIRMED"), product.handle);
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
  backend?: FindCheapBackend;
  awin?: AwinProductPort;
  ebay?: EbayBrowsePort;
  awinShopifyQuotes?: AwinShopifyQuoteResolver;
  deals?: DealPort;
  watches?: WatchStore;
  cartQuotes?: ShopifyCartQuotePort;
  selectedProducts?: ShopifySelectedProductInspector;
  officialShopify?: OfficialShopifySearchPort;
  officialCatalog?: OfficialCatalogPort;
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

async function enrichShopifyCartQuotes(
  result: ShopifySearchResult,
  zipCode: string | undefined,
  cartQuotes: ShopifyCartQuotePort | undefined
): Promise<{ result: ShopifySearchResult; attempted: number; succeeded: number }> {
  if (zipCode === undefined || cartQuotes === undefined || result.products.length === 0) {
    return { result, attempted: 0, succeeded: 0 };
  }
  const attempts = result.products.map(async (product) => ({
    ...product,
    cartQuote: await cartQuotes.quote(product, zipCode)
  }));
  const settled = await Promise.allSettled(attempts);
  const products = settled.map((outcome, index) =>
    outcome.status === "fulfilled" ? outcome.value : result.products[index]!
  );
  const succeeded = settled.filter((outcome) => outcome.status === "fulfilled").length;
  if (
    succeeded === products.length &&
    result.diagnostics.selectionPolicy === "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_PRICE"
  ) {
    products.sort((left, right) =>
      left.cartQuote!.deliveredPrice.amountCents - right.cartQuote!.deliveredPrice.amountCents ||
      (left.merchantUrl < right.merchantUrl ? -1 : left.merchantUrl > right.merchantUrl ? 1 : 0)
    );
  }
  return { result: { ...result, products }, attempted: attempts.length, succeeded };
}

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
      ...(dependencies.officialCatalog === undefined ? {} : { officialCatalog: dependencies.officialCatalog }),
      ...(dependencies.officialStorefrontRegistry === undefined ? {} : { officialStorefrontRegistry: dependencies.officialStorefrontRegistry }),
      ...(dependencies.merchantTrustRegistry === undefined ? {} : { merchantTrustRegistry: dependencies.merchantTrustRegistry })
    },
    product: {
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
  const watchStore = backend.watches;
  const cartQuotes = backend.product.cartQuotes;
  const awinShopifyQuotes = backend.product.awinShopifyQuotes;
  const selectedProducts = backend.product.selectedProducts;
  const officialShopify = backend.catalog.officialShopify;
  const officialCatalog = backend.catalog.officialCatalog;
  const officialStorefrontRegistry = backend.catalog.officialStorefrontRegistry;
  const merchantTrustRegistry = backend.catalog.merchantTrustRegistry;
  const visualCandidateImages = backend.visualCandidateImages;
  shopifyPort = backend.catalog.shopify;
  affiliateLinks = backend.product.affiliateLinks;
  const executor = new ToolExecutor({ capabilities: backend.capabilities });
  const toolRegistrar = createExecutedToolRegistrar(server, executor);
  const now = dependencies.now ?? (() => new Date());
  const cardTelemetry = dependencies.cardTelemetry ?? {
    record: (event: ProductCardTelemetry) => {
      process.stderr.write(`[findcheap-product-card-metrics] ${JSON.stringify(event)}\n`);
    }
  };
  const watchChecks = new Map<string, Promise<WatchEvaluation>>();
  const selections = new Map<string, { renderId: string; variantId: string; productKey: string }>();
  const cardSelections = new Map<string, { revision: number; selectionIds: string[] }>();
  const renderSnapshots = new Map<string, {
    expiresAt: number;
    content: ProductCardContent & { renderId: string };
    sourceResult: ShopifySearchResult;
    resolvedAwinProducts: Map<string, ShopifyProduct>;
  }>();
  const visualSearchSnapshots = new Map<string, {
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
  }>();
  const comparisonSnapshots = new Map<string, {
    expiresAt: number;
    content: ProductComparisonOutput;
  }>();
  const recordedCardTelemetry = new Set<string>();
  const deleteSnapshot = (renderId: string) => {
    const snapshot = renderSnapshots.get(renderId);
    if (snapshot !== undefined) {
      for (const product of snapshot.content.products) {
        if (product.selectionId !== undefined) selections.delete(product.selectionId);
      }
    }
    cardSelections.delete(renderId);
    renderSnapshots.delete(renderId);
  };
  const preflightQuoteCapabilities = async (content: ProductCardContent) => {
    const resolvedAwinProducts = new Map<string, ShopifyProduct>();
    const products = await Promise.all(content.products.map(async (product) => {
      if (product.checkoutPlatform === "MERCHANT") return product;
      if (product.sourceKind === "EBAY_BROWSE") return product;
      if (product.sourceKind === "SHOPIFY_GLOBAL_CATALOG" || product.sourceKind === undefined) {
        const quoteCapability = cartQuotes === undefined
          ? "MERCHANT_CHECKOUT_ONLY" as const
          : "DELIVERED_TOTAL_SUPPORTED" as const;
        return { ...product, quoteCapability, card: { ...product.card, quoteCapability } };
      }
      if (cartQuotes === undefined || awinShopifyQuotes === undefined || product.itemPrice === undefined) {
        return product;
      }
      const seed = awinQuoteSeed(product);
      if (!awinShopifyQuotes.supports(seed)) return product;
      try {
        const resolved = await awinShopifyQuotes.resolve(seed);
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
        return product;
      }
    }));
    return { content: { ...content, products }, resolvedAwinProducts };
  };
  const rememberSnapshot = (
    content: ProductCardContent,
    sourceResult: ShopifySearchResult,
    resolvedAwinProducts = new Map<string, ShopifyProduct>(),
    primaryProductIndex?: number
  ): ProductCardContent & { renderId: string } => {
    const renderId = randomUUID();
    let primarySelectionId: string | undefined;
    const orderedProducts = primaryProductIndex === undefined || primaryProductIndex === 0
      ? content.products
      : [
          content.products[primaryProductIndex]!,
          ...content.products.filter((_product, index) => index !== primaryProductIndex)
        ];
    const products = orderedProducts.map((product, index) => {
      const selectionId = randomUUID();
      if (primaryProductIndex !== undefined && index === 0) primarySelectionId = selectionId;
      selections.set(selectionId, { renderId, variantId: product.handle, productKey: productReferenceKey(product) });
      return {
        ...product,
        selectionId,
        quoteReference: { selectionId, renderId, variantId: product.handle }
      };
    });
    const snapshot = {
      ...content,
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
      content: snapshot,
      sourceResult,
      resolvedAwinProducts
    });
    while (renderSnapshots.size > MAX_PRODUCT_SELECTION_SNAPSHOTS) {
      const oldest = renderSnapshots.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      deleteSnapshot(oldest);
    }
    return snapshot;
  };
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
  const recoverableQuoteResult = (
    snapshot: (typeof renderSnapshots extends Map<string, infer T> ? T : never),
    selectedKey: string,
    message: string
  ) => ({
    content: [{ type: "text" as const, text: message }],
    structuredContent: {
      ...snapshot.content,
      message,
      products: snapshot.content.products.map((product) => productReferenceKey(product) === selectedKey
        ? {
            ...product,
            quoteCapability: "MERCHANT_CHECKOUT_ONLY" as const,
            card: { ...product.card, quoteCapability: "MERCHANT_CHECKOUT_ONLY" as const }
          }
        : product)
    }
  });
  const runUnifiedSearch = (input: SearchProductsExecutionInput) => searchProducts(input, {
    awin: awinPort,
    shopify: shopifyPort,
    ...(ebayPort === undefined ? {} : { ebay: ebayPort }),
    ...(toolAvailability.verifiedDeals ? { deals: dealPort } : {}),
    ...(officialShopify === undefined ? {} : { officialShopify }),
    ...(officialCatalog === undefined ? {} : { officialCatalog }),
    ...(officialStorefrontRegistry === undefined ? {} : { officialStorefrontRegistry }),
    ...(merchantTrustRegistry === undefined ? {} : { merchantTrustRegistry })
  });
  const buildUnifiedResponse = async (input: SearchProductsInput, execution: UnifiedSearchExecution, outcome?: SearchOutcome) => {
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
    const enriched = selectedShopifyProducts.length === 0 && execution.shopifyResult === undefined
      ? { result: initialShopify, attempted: 0, succeeded: 0 }
      : await enrichShopifyCartQuotes(initialShopify, input.zipCode, cartQuotes);
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
    const terminalOutcome = outcome ?? (returned > 0 ? "MATCH_FOUND"
      : Object.values(execution.sourceStatus).includes("UNAVAILABLE") ? "SOURCE_UNAVAILABLE" : "NO_CANDIDATES");
    return { response: {
      ...response,
      _meta: searchTraceMeta(execution, terminalOutcome, { returned }),
      structuredContent: { ...response.structuredContent, traceId: execution.searchRun?.traceId }
    }, enriched };
  };
  const pruneComparisonSnapshots = () => {
    const currentTime = now().getTime();
    for (const [id, snapshot] of comparisonSnapshots) {
      if (snapshot.expiresAt <= currentTime) comparisonSnapshots.delete(id);
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
      failures: [] as Array<{ code: VisualCandidateImageFailureCode; sourceHost?: string; count: number }>
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
    const failures: Array<{ code: VisualCandidateImageFailureCode; sourceHost?: string }> = [];
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
          const image = await (execution.searchRun === undefined ? read() : execution.searchRun.read("IMAGE", imageUrl, read));
          return { candidate, image };
        } catch (error) {
          let sourceHost: string | undefined;
          try { sourceHost = new URL(imageUrl).hostname.toLocaleLowerCase("en-US"); } catch { /* safe code only */ }
          failures.push(error instanceof VisualCandidateImageError
            ? { code: error.code, ...(error.sourceHost === undefined ? {} : { sourceHost: error.sourceHost }) }
            : { code: error instanceof SearchReadTimeoutError ? "REQUEST_TIMEOUT"
              : error instanceof SearchBudgetError ? "REQUEST_ABORTED" : "REQUEST_FAILED", ...(sourceHost === undefined ? {} : { sourceHost }) });
          return undefined;
        }
      }));
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
    execution.searchRun?.noteUnattemptedImages(eligiblePool.filter((candidate) =>
      !attemptedKeys.has(visualCandidateKey(candidate))).length);
    const failureCounts = new Map<string, { code: VisualCandidateImageFailureCode; sourceHost?: string; count: number }>();
    for (const failure of failures) {
      const key = `${failure.code}:${failure.sourceHost ?? ""}`;
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
      failures: Array<{ code: VisualCandidateImageFailureCode; sourceHost?: string; count: number }>;
    }>
  ) => {
    const failureCounts = new Map<string, { code: VisualCandidateImageFailureCode; sourceHost?: string; count: number }>();
    for (const item of items) {
      for (const failure of item.failures) {
        const key = `${failure.code}:${failure.sourceHost ?? ""}`;
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
      description: "For an initial text search, after the required Skill is loaded, match current user-message language and use exactly one progress sentence before this tool: English 'Searching for suitable products.'; Chinese '正在搜索合适商品。'. Selected-product follow-ups do not use that generic sentence. Never output a plan or read Memory, Skill files, repository files, logs, task files, or plugin caches. Text-only product-search entrypoint; call once. A tool error is not a zero-result search; report the returned safe error honestly. For a newly attached image use search_visual_candidates and then finalize_visual_search instead. Always pass responseLocale from the user's current message, even when query is translated into English for catalog retrieval. Keep query focused on product identity; pass use, budget, and size only in their typed fields. Pass family in productType, explicit brand in brand with brandMode=REQUIRED, objective must-have attributes in requiredFeatures, explicit disqualifiers in excludedFeatures, and preferences in preferences. One requiredFeatures entry may contain explicitly acceptable alternatives separated by 'or' and must stay under 160 characters. Pass primaryUse, preferredSize, requiredSize, maxItemPriceCents, or budgetFlexible only when the user states them; never infer them. A size explicitly required or selected from the clarification belongs in requiredSize; use preferredSize only when the user says it is flexible or merely preferred. Broad high-variance products return one clarification before source search when decision constraints are missing. Full-size or large-package requests exclude sample, trial-size, and tester products. Never put a brand in productType or requiredFeatures. Use CONTINUE_PREVIOUS_PRODUCT when the user adds budget, use, size, or constraints; CORRECT_PREVIOUS_PRODUCT only for changed identity; NEW_PRODUCT for a different shopping goal. Missing soft evidence remains a limitation-labeled DISCOVERY_MATCH; hard conflicts exclude. Return at most 8 cards in three display tiers: 2 verified official-store matches, 3 trusted high matches, and 3 best-value high matches. Display tier never determines the primary choice; render the backend-selected primary recommendation first. When recommendation.state is READY, recommend only recommendation.primarySelectionId; otherwise recommend none. Equivalent fit and trust prefer a confirmed after-Coupon price, then the raw item price; merchant-level or unconfirmed offers never override a lower price. Use selectionMode=LOWEST_PRICE only when requested; it never collapses the three display tiers. maxItemPriceCents is a ceiling, never a spending target. If every merchant is unverified, show research leads but recommend none for purchase. Never recommend a product absent from returned cards. Commercial relationships never affect relevance or ranking. Reuse selectionId for exact follow-ups; use renderId for UI-synced choices and renderId plus one-based position for ordinal references. Never print IDs or search a selected title again.",
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
    async (rawInput) => {
      const parsedInput = SearchProductsInputSchema.parse(rawInput);
      const input = parsedInput.visualInput === undefined
        ? parsedInput
        : { ...parsedInput, visualInput: enforceVisualEvidenceAuthority(parsedInput.visualInput) };
      if (input.contextMode === "AMBIGUOUS") {
        return shopifyClarificationResult(input.selectionMode, input, {
          question: "Is this a new product, or a follow-up about the previous product?",
          evidence: "product context is ambiguous",
          source: "UNIFIED_PRODUCT_SEARCH"
        });
      }
      if (input.visualInput !== undefined && input.visualInput.productType === undefined && input.productType === undefined) {
        return shopifyClarificationResult(input.selectionMode, input, {
          question: "Identify the product type shown; if one detail is decision-critical, also provide the size, budget, color, or occasion.",
          evidence: "visual product type absent",
          source: "UNIFIED_PRODUCT_SEARCH"
        });
      }
      const purchaseClarification = highVarianceClarification(input);
      if (purchaseClarification !== undefined) {
        return shopifyClarificationResult(input.selectionMode, input, {
          ...purchaseClarification,
          source: "UNIFIED_PRODUCT_SEARCH"
        });
      }
      if (
        input.visualInput === undefined &&
        input.comparisonMode === "SAME_PRODUCT" &&
        !hasSpecificProductIdentity(input.query)
      ) {
        return shopifyClarificationResult(input.selectionMode, input);
      }
      const execution = await runUnifiedSearch(input);
      const { response, enriched } = await buildUnifiedResponse(input, execution);
      if (response.structuredContent.products.length === 0) return response;
      const preflight = await preflightQuoteCapabilities(response.structuredContent);
      const recommendation = choosePrimaryRecommendation(preflight.content.products);
      const content = rememberSnapshot({
        ...preflight.content,
        recommendation: {
          state: recommendation.state,
          reasonCodes: recommendation.reasonCodes
        }
      }, enriched.result, preflight.resolvedAwinProducts, recommendation.primaryProductIndex);
      return {
        ...response,
        content: [{
          type: "text" as const,
          text: `${response.content[0]!.text}\n${recommendationInstruction(content)}\nUse structured selection references for follow-ups; never print them or search titles.`
        }],
        structuredContent: content
      };
    }
  );

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
      description: "First stage for a newly attached product image. Use only the current request; do not read Memory, Skill, repository, task, log, or plugin-cache files. Inspect the user's image, pass structured visualInput, and call once. Never pass a local file path as visualInput.imageUrl; that field accepts only a credential-free public HTTPS URL and is normally omitted for an attached image. If the user states or image analysis strongly identifies a specific product name, preserve it in visualInput.suspectedProductName for exact official-store retrieval; never manufacture a name from generic attributes and never treat it as identity proof. Never send hardClues or negativeClues. User-stated hard constraints belong in requiredFeatures or excludedFeatures; pixel-inferred details belong in observations or softClues. The execution layer downgrades or removes model-authored hard constraints. Record occlusions; an obscured attribute cannot be a conflict. The tool returns at most six labeled candidate images with finalAnswerAllowed=false. Compare every image, then call requiredNextTool. Do not present candidates as recommendations. Do not use this tool for text-only, Watch, or batch searches.",
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
    async (rawInput) => {
      const parsedInput = VisualCandidateSearchInputSchema.parse(rawInput);
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
      const searchRun = new SearchRun();
      const searchInput = visualRetrievalSearchInput(finalInput, false, searchRun);
      let execution = await runUnifiedSearch(searchInput);
      const retrievedProductHashes = new Set((execution.reviewPool ?? execution.candidates).map(visualProductHash));
      const imageContentKeys = new Set<string>();
      // Preserve three of the shared twelve image requests for the second review.
      let imageLoad = await loadVisualCandidates(execution, new Set(), MAX_VISUAL_CANDIDATES, {
        maxAttempts: 12 - MAX_RELAXED_VISUAL_CANDIDATES, contentKeys: imageContentKeys, round: 1
      });
      let available = imageLoad.entries;
      let attempt: 1 | 2 = 1;
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
          return {
            content: [{ type: "text" as const, text: message }],
            _meta: { ...searchTraceMeta(relaxedExecution, fallbackCode === "NO_LOADABLE_IMAGES" ? "NO_LOADABLE_IMAGES" : "NO_CANDIDATES",
              { imageAttempts: diagnostics.attempted, imagesLoaded: diagnostics.loaded, returned: 0 }),
              "findcheap/visualImageLoadDiagnostics": diagnostics,
              ...visualEvaluationMeta(relaxedExecution, retrievedProductHashes, [], []) },
            structuredContent: {
              status: "NO_IMAGE_CANDIDATES" as const,
              message,
              candidates: [],
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
    }
  );

  if (backend.capabilities.has("VISUAL_SEARCH")) toolRegistrar.registerTool(
    "finalize_visual_search",
    {
      title: "Finalize visual search",
      description: "Visual-review stage for interactive image search. Use only candidate IDs and images returned by the latest tool result. Report directly visible matching and conflicting attributes. Obscured or low-confidence attributes cannot match or conflict. Clearly visible family, sleeve, neckline, and length conflicts exclude. Color or pattern difference alone may remain HIGHLY_SIMILAR only when at least three independent structural attributes match; disclose the difference. POSSIBLE_SAME_ITEM additionally needs a distinguishing visible pattern, detail or mark; generic cut, color or name hints are insufficient. A visual verdict can exclude or rerank candidates, but cannot create EXACT identity. Each visual session is immutable and single-use. If the result has visualReview.finalAnswerAllowed=false, a final answer is forbidden: review every returned relaxed candidate and immediately call visualReview.requiredNextTool with its new visualSessionId. Never retry more than once.",
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
    async (rawInput) => {
      const input = FinalizeVisualSearchInputSchema.parse(rawInput);
      pruneVisualSearchSnapshots();
      const snapshot = visualSearchSnapshots.get(input.visualSessionId);
      if (snapshot === undefined || snapshot.expiresAt <= now().getTime()) {
        visualSearchSnapshots.delete(input.visualSessionId);
        throw new Error("VISUAL_SESSION_EXPIRED");
      }
      const reviewed: Array<{ candidate: UnifiedCandidate; verdict: CodexVisualVerdict }> = [];
      for (const entry of input.verdicts) {
        const candidate = snapshot.candidates.get(entry.candidateId);
        if (candidate === undefined) throw new Error("VISUAL_CANDIDATE_NOT_IN_SESSION");
        reviewed.push({ candidate, verdict: entry.verdict });
      }
      if (reviewed.length !== snapshot.candidates.size) return toolError("INVALID_ARGUMENTS", {
        issues: [{ path: "verdicts", code: "REQUIRED", action: "SUPPLY_REQUIRED_FIELD", minimum: snapshot.candidates.size }]
      });
      visualSearchSnapshots.delete(input.visualSessionId);
      const reviewGroups = { REVIEW_ACCEPTED: [] as UnifiedCandidate[], REVIEW_CONFLICT: [] as UnifiedCandidate[],
        REVIEW_INSUFFICIENT: [] as UnifiedCandidate[] };
      for (const entry of reviewed) {
        const accepted = assessVisualVerdict(entry.verdict, snapshot.input.visualInput, snapshot.input.allowAlternatives);
        const group = accepted !== undefined ? "REVIEW_ACCEPTED"
          : hasAdmissibleVisualConflict(entry.verdict, snapshot.input.visualInput!) ? "REVIEW_CONFLICT" : "REVIEW_INSUFFICIENT";
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
      const newlyAccepted = finalizeCodexVisualCandidates(
        reviewed,
        snapshot.input.allowAlternatives,
        snapshot.input.limit,
        snapshot.input.visualInput
      );
      const acceptedKeys = new Set<string>();
      const finalCandidates = [...snapshot.accepted, ...newlyAccepted].sort(compareRankedCandidates)
        .filter((candidate) => {
          const key = candidateKey(candidate);
          if (acceptedKeys.has(key)) return false;
          acceptedKeys.add(key);
          return true;
        }).slice(0, snapshot.input.limit);
      const unreviewedPool = (snapshot.execution.reviewPool ?? snapshot.execution.candidates).some((candidate) =>
        candidateImageUrl(candidate) !== undefined && !snapshot.imageAttemptedKeys.has(visualCandidateKey(candidate)));
      const needsReview = finalCandidates.length === 0 || (unreviewedPool &&
        !finalCandidates.some((candidate) => candidate.visualMatchGroup === "POSSIBLE_SAME_ITEM"));
      if (needsReview && snapshot.attempt === 1 && snapshot.execution.searchRun?.canRead("IMAGE") !== false) {
        // A recalled seventh result must not disappear when the first six conflict.
        let secondExecution = snapshot.execution;
        let secondImageLoad = await loadVisualCandidates(
          secondExecution,
          snapshot.imageAttemptedKeys,
          MAX_RELAXED_VISUAL_CANDIDATES,
          { contentKeys: snapshot.imageContentKeys, round: 2 }
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
          const supplemental = await loadVisualCandidates(secondExecution, imageAttemptedKeys,
            MAX_RELAXED_VISUAL_CANDIDATES - secondImageLoad.entries.length, { maxDataChars: remainingDataChars,
              contentKeys: snapshot.imageContentKeys, round: 2 });
          for (const key of supplemental.attemptedKeys) imageAttemptedKeys.add(key);
          secondImageLoad = {
            entries: [...secondImageLoad.entries, ...supplemental.entries],
            diagnostics: mergeVisualImageLoadDiagnostics(secondImageLoad.diagnostics, supplemental.diagnostics),
            attemptedKeys: imageAttemptedKeys
          };
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
          const message = `REVIEW REQUIRED. Final answer is forbidden. ${finalCandidates.length} accepted first-round matches are retained; no sufficient possible-same-item result yet. Review all ${candidateEntries.length} remaining candidates, then call finalize_visual_search once with visualSessionId ${visualSessionId}. Do not relax product family or accept visible conflicts. This is the final review round.`;
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
          const { response } = await buildUnifiedResponse(snapshot.input, emptyExecution, "NO_LOADABLE_IMAGES");
          return {
            ...response,
            content: [{ type: "text" as const, text: message }],
            _meta: { ...searchTraceMeta(secondExecution, "NO_LOADABLE_IMAGES", { reviewed: snapshot.reviewedCount,
              reviewConflicts: snapshot.reviewConflictCount, reviewInsufficient: snapshot.reviewInsufficientCount,
              imageAttempts: secondImageLoad.diagnostics.attempted, imagesLoaded: 0, returned: 0 }),
              "findcheap/visualImageLoadDiagnostics": secondImageLoad.diagnostics,
              ...visualEvaluationMeta(secondExecution, snapshot.retrievedProductHashes, [], []) },
            structuredContent: {
              ...response.structuredContent,
              message,
              visualSearchFailure: failure
            }
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
        return {
          ...response,
          _meta: { ...searchTraceMeta(execution, emptyOutcome, { reviewed: snapshot.reviewedCount,
            reviewConflicts: snapshot.reviewConflictCount, reviewInsufficient: snapshot.reviewInsufficientCount, returned: 0 }),
            ...visualEvaluationMeta(execution, snapshot.retrievedProductHashes, [], []) },
          content: [{ type: "text" as const, text: failure.message }],
          structuredContent: {
            ...response.structuredContent,
            message: failure.message,
            visualSearchFailure: failure
          }
        };
      }
      const preflight = await preflightQuoteCapabilities(response.structuredContent);
      const recommendation = choosePrimaryRecommendation(preflight.content.products);
      const content = rememberSnapshot({
        ...preflight.content,
        recommendation: {
          state: recommendation.state,
          reasonCodes: recommendation.reasonCodes
        }
      }, enriched.result, preflight.resolvedAwinProducts, recommendation.primaryProductIndex);
      return {
        ...response,
        _meta: { ...searchTraceMeta(execution, "MATCH_FOUND", { reviewed: snapshot.reviewedCount,
          reviewConflicts: snapshot.reviewConflictCount, reviewInsufficient: snapshot.reviewInsufficientCount, returned: content.products.length }),
          ...visualEvaluationMeta(execution, snapshot.retrievedProductHashes, [], content.products, content.recommendation?.primarySelectionId) },
        content: [{
          type: "text" as const,
          text: `${response.content[0]!.text}\n${recommendationInstruction(content)}\nUse structured selection references for follow-ups; never print them or search titles.`
        }],
        structuredContent: content
      };
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
      if (
        validatedInput.comparisonMode === "SAME_PRODUCT" &&
        validatedInput.query !== undefined &&
        !hasSpecificProductIdentity(validatedInput.query)
      ) {
        return shopifyClarificationResult(validatedInput.selectionMode, validatedInput);
      }
      try {
        const searched = await shopifyPort.search(validatedInput);
        const enriched = await enrichShopifyCartQuotes(searched, validatedInput.zipCode, cartQuotes);
        const response = shopifyResult(enriched.result, {
          ...(validatedInput.zipCode === undefined ? {} : { zipCode: validatedInput.zipCode }),
          membershipIds: validatedInput.membershipIds ?? []
        }, affiliateLinks, {
          attempted: enriched.attempted,
          succeeded: enriched.succeeded
        });
        if (response.structuredContent.products.length === 0) return response;
        return {
          ...response,
          structuredContent: rememberSnapshot(response.structuredContent, enriched.result)
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

  if (backend.capabilities.has("PRODUCT_INSPECTION")) toolRegistrar.registerTool(
    "inspect_selected_shopify_product",
    {
      title: "Inspect a selected Shopify product",
      description: "Check size, color, other variants, or current availability for exactly one native Shopify catalog product returned by search_products. Schema requires the prior renderId plus selectionId or one-based position for a user reference such as 'the first product'. On MISSING_REFERENCE_CONTEXT, retry once with the prior search renderId; do not describe the reference as expired. Never call this when the current turn includes a newly attached image; that image starts NEW_PRODUCT through search_visual_candidates. Never scan task history, guess by title, or run another catalog search. Awin cards can be quoted when supported but cannot use this variant-inspection tool.",
      inputSchema: ShopifySelectedProductInputSchema,
      outputSchema: ShopifySelectedProductOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (input) => {
      const parsed = ShopifySelectedProductInputSchema.parse(input);
      const reference = resolveSelectionReference(parsed);
      if (reference === undefined) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Selected product reference is unavailable. Run one new product search." }]
        };
      }
      const { renderId, variantId } = reference;
      const { variantDimensions = {} } = parsed;
      const snapshot = renderSnapshots.get(renderId);
      if (snapshot === undefined || snapshot.expiresAt <= now().getTime()) {
        deleteSnapshot(renderId);
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Selected product reference expired. Run one new Shopify search before inspecting variants."
          }]
        };
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

      try {
        const inspection = await selectedProducts.inspect(selected, variantDimensions);
        if (inspection.variants.length === 0) {
          const message = "The exact selected product has no variant matching the requested options. No title or catalog search was used.";
          return {
            content: [{ type: "text" as const, text: message }],
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
        const remembered = rememberSnapshot(internalResponse.structuredContent, inspectedResult);
        const variants = remembered.products.map((product) => ({
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
        const message = `Inspected ${variants.length} variant(s) from the exact previously returned product by stable Shopify product and variant identity; no title or catalog search was used.`;
        return {
          content: [{ type: "text" as const, text: message }],
          structuredContent: {
            status: "OK" as const,
            message,
            sourceVariantId: variantId,
            merchant: selected.merchant,
            sourceHost: selected.sourceHost,
            productTitle: inspection.productTitle,
            canonicalProductUrl: inspection.canonicalProductUrl,
            variants
          }
        };
      } catch {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "The exact selected product could not be inspected safely. No replacement product was searched."
          }]
        };
      }
    }
  );

  if (backend.capabilities.has("PRODUCT_QUOTE")) toolRegistrar.registerTool(
    "quote_selected_shopify_product",
    {
      title: "Quote a selected product",
      description: "Call only when the referenced card is DELIVERED_TOTAL_SUPPORTED or ZIP_ESTIMATE_ONLY and the user supplied a ZIP. Schema requires the prior renderId plus selectionId or one-based position for a user reference such as 'the first product'. On MISSING_REFERENCE_CONTEXT, retry once with the prior search renderId; do not describe the reference as expired. Never call this when the current turn includes a newly attached image; that image starts NEW_PRODUCT through search_visual_candidates. If ZIP is missing, ask only for ZIP. For MERCHANT_CHECKOUT_ONLY, do not ask for ZIP and do not call this tool. Never guess by title, request a street address, or run another search.",
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
    async (input) => {
      const parsed = ShopifySelectedQuoteInputSchema.parse(input);
      const reference = resolveSelectionReference(parsed);
      if (reference === undefined) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Selected product reference is unavailable or does not belong to that search result. No quote was requested." }]
        };
      }
      const { renderId, productKey } = reference;
      const { zipCode } = parsed;
      const snapshot = renderSnapshots.get(renderId);
      if (snapshot === undefined || snapshot.expiresAt <= now().getTime()) {
        deleteSnapshot(renderId);
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Selected product reference expired. Run one new Shopify search before requesting a quote."
          }]
        };
      }
      const selectedCard = snapshot.content.products.find((product) => productReferenceKey(product) === productKey);
      if (selectedCard === undefined) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Selected product does not belong to that search result. No quote was requested."
          }]
        };
      }
      if (selectedCard.quoteCapability === "MERCHANT_CHECKOUT_ONLY") {
        return recoverableQuoteResult(
          snapshot,
          productKey,
          "[MERCHANT_CHECKOUT_ONLY] Quote unsupported: this product cannot provide a ZIP delivered-total estimate. Continue at merchant checkout or choose another existing card; no new search is required."
        );
      }
      if (cartQuotes === undefined) {
        return recoverableQuoteResult(
          snapshot,
          productKey,
          "[MERCHANT_CART_UNAVAILABLE] ZIP quoting is temporarily unavailable. Continue at merchant checkout or choose another existing card; no new search is required."
        );
      }
      try {
        const selected = selectedCard.sourceKind === "AWIN_PRODUCT_FEED"
          ? snapshot.resolvedAwinProducts.get(productKey)
          : snapshot.sourceResult.products.find((product) => productReferenceKey(product) === productKey);
        if (selected === undefined) {
          throw new ShopifyCartQuoteError("MERCHANT_CART_UNAVAILABLE");
        }
        const cartQuote = await cartQuotes.quote(selected, zipCode);
        const quotedProduct = withCartQuote(selectedCard, cartQuote);
        const { renderId: _previousRenderId, ...previousContent } = snapshot.content;
        const message = `Estimated delivered total for the selected product is USD ${(cartQuote.deliveredPrice.amountCents / 100).toFixed(2)}. It includes item price, selected shipping, and ${cartQuote.tax.status === "ZIP_ESTIMATED" ? "ZIP state-average estimated tax" : "merchant-reported tax"}; final checkout may change.`;
        const content = rememberSnapshot({
          ...previousContent,
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
        }, snapshot.sourceResult, snapshot.resolvedAwinProducts);
        return {
          content: [{ type: "text" as const, text: message }],
          structuredContent: content
        };
      } catch (error) {
        const failure = error instanceof ShopifyCartQuoteError
          ? error
          : new ShopifyCartQuoteError("MERCHANT_CART_UNAVAILABLE", { cause: error });
        return recoverableQuoteResult(
          snapshot,
          productKey,
          `${quoteFailureMessage(failure.code)} Continue at merchant checkout or choose another existing card; no new search is required.`
        );
      }
    }
  );

  if (backend.capabilities.has("PRODUCT_QUOTE")) toolRegistrar.registerTool(
    "quote_and_compare_selected_products",
    {
      title: "Quote and compare selected products",
      description: "Quote and compare 2-4 products from one immutable search snapshot for a supplied ZIP. Schema requires the prior renderId; selectionIds are optional explicit UI choices bound to it. Use responseLocale for the current message language. On MISSING_REFERENCE_CONTEXT, retry once with the prior search renderId; do not describe the reference as expired. The execution layer rejects stale, foreign, or cross-snapshot selections. Use this instead of multiple single-product quote calls and never calculate totals or differences in prose.",
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
    async (rawInput) => {
      const request = QuotedProductComparisonInputSchema.parse(rawInput);
      const localizedError = (english: string, chinese: string) => ({
        isError: true,
        content: [{
          type: "text" as const,
          text: request.responseLocale === "zh-CN" ? chinese : english
        }]
      });
      const selectionIds = resolveComparisonSelectionIds(request);
      if (selectionIds === undefined || selectionIds.length < 2 || selectionIds.length > 4) {
        return localizedError(
          "No valid 2-4 product UI selection is synced for this search snapshot.",
          "该搜索快照没有已同步的 2–4 个有效商品选择。"
        );
      }
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
      if (selectedCards.some((product) => product!.quoteCapability === "MERCHANT_CHECKOUT_ONLY")) {
        return localizedError(
          "Quote unsupported for at least one selected product: merchant checkout is required, so ZIP delivered totals cannot be compared.",
          "至少一个所选商品不支持报价：只能在商家结账页计算总价，无法按 ZIP 比较到手价。"
        );
      }
      try {
        const quotedProducts = await Promise.all(selectedCards.map(async (selectedCard, index) => {
          const selected = selectedCard!.sourceKind === "AWIN_PRODUCT_FEED"
            ? snapshot.resolvedAwinProducts.get(productReferenceKey(selectedCard!))
            : snapshot.sourceResult.products.find((product) => productReferenceKey(product) === productReferenceKey(selectedCard!));
          if (selected === undefined) throw new ShopifyCartQuoteError("MERCHANT_CART_UNAVAILABLE");
          return {
            ...withCartQuote(selectedCard!, await cartQuotes!.quote(selected, request.zipCode)),
            selectionId: input.selectionIds[index]!
          };
        }));
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
          evaluatedAt: comparisonAt.toISOString()
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
        return localizedError(
          quoteFailureMessage(failure.code),
          quoteFailureMessage(failure.code)
        );
      }
    }
  );

  toolRegistrar.registerTool(
    "research_selected_product_deal",
    {
      title: "Check current price and deals",
      description: "Check one exact prior product for current verified merchant deals, current price, optional delivered-price evidence, and inventory. Schema requires the prior renderId plus selectionId or one-based position for a user reference such as 'the first product'. On MISSING_REFERENCE_CONTEXT, retry once with the prior search renderId; do not describe the reference as expired. Never call this when the current turn includes a newly attached image; that image starts NEW_PRODUCT through search_visual_candidates. Never search or guess by title. Return current evidence only; do not make historical or buy-or-wait claims. Monitoring is created only after an explicit Watch request.",
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
      const reference = resolveSelectionReference(parsed);
      if (reference === undefined) {
        const message = "Selected product does not belong to the referenced immutable search snapshot.";
        return {
          content: [{ type: "text" as const, text: message }],
          structuredContent: {
            status: "SELECTION_UNAVAILABLE" as const,
            message,
            quoteStatus: "NOT_REQUESTED" as const,
            limitations: ["No product title fallback search was performed."],
            deals: []
          }
        };
      }
      const snapshot = renderSnapshots.get(reference.renderId);
      if (snapshot === undefined || snapshot.expiresAt <= now().getTime()) {
        deleteSnapshot(reference.renderId);
        const message = "Selected product snapshot expired or is no longer available. Run one new product search, then select a card.";
        return {
          content: [{ type: "text" as const, text: message }],
          structuredContent: {
            status: "SELECTION_UNAVAILABLE" as const,
            message,
            quoteStatus: "NOT_REQUESTED" as const,
            limitations: ["No product title fallback search was performed."],
            deals: []
          }
        };
      }
      const selectedCard = snapshot.content.products.find((product) => productReferenceKey(product) === reference.productKey);
      if (selectedCard === undefined) {
        const message = "Selected product does not belong to the immutable prior result.";
        return {
          content: [{ type: "text" as const, text: message }],
          structuredContent: {
            status: "SELECTION_UNAVAILABLE" as const,
            message,
            quoteStatus: "NOT_REQUESTED" as const,
            limitations: ["No product title fallback search was performed."],
            deals: []
          }
        };
      }

      const quoteProduct = selectedCard.sourceKind === "AWIN_PRODUCT_FEED"
        ? snapshot.resolvedAwinProducts.get(reference.productKey)
        : snapshot.sourceResult.products.find((product) => productReferenceKey(product) === reference.productKey);
      const research = await researchSelectedProductDeal({
        selected: {
          merchantProductId: selectedCard.handle,
          merchant: selectedCard.merchant,
          title: selectedCard.title,
          availability: selectedCard.availability,
          ...(selectedCard.itemPrice === undefined ? {} : { itemPrice: selectedCard.itemPrice }),
          checkedAt: selectedCard.checkedAt,
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
        ? "Current price: unavailable."
        : `Current ${research.currentPrice.basis === "DELIVERED_TOTAL" ? "estimated delivered total" : "item price"}: USD ${(research.currentPrice.amount.amountCents / 100).toFixed(2)}; checked at ${research.currentPrice.checkedAt}.`;
      const dealEvidence = research.dealLookupStatus !== "COMPLETE" && research.deals.length === 0
        ? "Deal source unavailable or incomplete; coupon availability cannot be determined."
        : research.deals.length === 0 ? "Verified deals: none found in the completed lookup."
        : `Verified deals: ${research.deals.map((deal) => [
            deal.title,
            deal.code === undefined ? undefined : `code ${deal.code}`,
            `eligibility: ${deal.eligibility.join(", ") || "merchant confirmation required"}`,
            `valid through ${deal.validTo}`,
            `checked at ${deal.checkedAt}`,
            `source ${deal.sourceUrl}`
          ].filter((part): part is string => part !== undefined).join("; ")).join(" | ")}.`;
      const message = [
        `Selected product: ${selectedCard.title}; merchant: ${selectedCard.merchant}; availability: ${selectedCard.availability}.`,
        priceEvidence,
        dealEvidence,
        ...research.limitations.map((limitation) => `Limit: ${limitation}`)
      ].join(" ");
      return {
        content: [{ type: "text" as const, text: message }],
        _meta: { "findcheap/referenceTrace": { traceId: snapshot.content.traceId, renderId: reference.renderId, operation: "DEAL_RESEARCH" } },
        structuredContent: {
          status: "OK" as const,
          message,
          selectionId: selectedCard.selectionId,
          selectedProduct: {
            merchantId: selectedCard.merchantId,
            merchant: selectedCard.merchant,
            merchantProductId: selectedCard.handle,
            title: selectedCard.title,
            availability: selectedCard.availability,
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
          evaluatedAt: comparisonAt.toISOString()
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
      if (snapshot === undefined) {
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
      description: "For a clear Watch request, call immediately without Memory, repo scans, or sequence narration. Persist one rule and return exact Automation handoff. PRICE_BELOW needs explicit priceBasis. DELIVERED_TOTAL needs ZIP and prior selectionId. Active only after bind_watch_automation succeeds.",
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
      const questions = productWatchClarificationQuestions(requested);
      if (questions.length > 0) {
        const message = `More product detail is required before this watch can be created. ${questions.join(" ")}`;
        return { content: [{ type: "text" as const, text: message }], structuredContent: {
          status: "NEEDS_CLARIFICATION" as const,
          questions
        } };
      }
      const { quoteReference, ...persistedInput } = requested;
      let selectedProduct: z.infer<typeof WatchSpecSchema>["selectedProduct"];
      if (requested.priceBasis === "DELIVERED_TOTAL") {
        const reference = quoteReference === undefined ? undefined : resolveSelectionReference(quoteReference);
        const snapshot = reference === undefined ? undefined : renderSnapshots.get(reference.renderId);
        if (snapshot === undefined || snapshot.expiresAt <= now().getTime()) {
          if (reference !== undefined) deleteSnapshot(reference.renderId);
          const message = "The selected product reference expired. Run one new product search, then create the delivered-total watch from that exact card.";
          return { content: [{ type: "text" as const, text: message }], structuredContent: {
            status: "DATA_SOURCE_UNAVAILABLE" as const,
            message,
            questions: []
          } };
        }
        const selectedCard = snapshot.content.products.find((product) => productReferenceKey(product) === reference?.productKey);
        const selected = selectedCard?.sourceKind === "AWIN_PRODUCT_FEED"
          ? snapshot.resolvedAwinProducts.get(productReferenceKey(selectedCard))
          : snapshot.sourceResult.products.find((product) => productReferenceKey(product) === reference?.productKey);
        if (selected === undefined) {
          const message = "The selected product does not support a stable ZIP quote. Choose another existing card or use ITEM_PRICE; no new search is required.";
          return { content: [{ type: "text" as const, text: message }], structuredContent: {
            status: "DATA_SOURCE_UNAVAILABLE" as const,
            message,
            questions: []
          } };
        }
        const selectedCondition = selectedCard?.condition ?? selected.condition;
        if (requested.conditionPreference !== "ANY" && selectedCondition !== requested.conditionPreference) {
          const question = `The selected product condition is ${selectedCondition}; choose a matching product or explicitly accept ANY condition.`;
          return { content: [{ type: "text" as const, text: question }], structuredContent: {
            status: "NEEDS_CLARIFICATION" as const,
            message: question,
            questions: [question]
          } };
        }
        if (cartQuotes === undefined) {
          const message = "Shopify Cart quote provider is unavailable; a delivered-total watch was not created.";
          return { content: [{ type: "text" as const, text: message }], structuredContent: {
            status: "DATA_SOURCE_UNAVAILABLE" as const,
            message,
            questions: []
          } };
        }
        try {
          await cartQuotes.quote(selected, requested.zipCode!);
        } catch (error) {
          const failure = error instanceof ShopifyCartQuoteError
            ? error
            : new ShopifyCartQuoteError("MERCHANT_CART_UNAVAILABLE", { cause: error });
          const reason = failure.code === "FULL_ADDRESS_REQUIRED"
            ? "[FULL_ADDRESS_REQUIRED] This merchant requires a full address, but recurring delivered-total Watch rules store ZIP only. Use ITEM_PRICE or choose another merchant."
            : quoteFailureMessage(failure.code);
          const message = `${reason} A delivered-total watch was not created.`;
          return { content: [{ type: "text" as const, text: message }], structuredContent: {
            status: "DATA_SOURCE_UNAVAILABLE" as const,
            message,
            questions: []
          } };
        }
        selectedProduct = {
          sourceKind: "SHOPIFY_GLOBAL_CATALOG",
          merchantId: selected.merchantId,
          merchant: selected.merchant,
          sourceHost: selected.sourceHost,
          variantId: selected.handle,
          title: selected.title,
          merchantUrl: selected.merchantUrl,
          condition: selected.condition,
          variantDimensions: selected.variantDimensions,
          selectedAt: createdAt.toISOString()
        };
      }
      const spec = WatchSpecSchema.parse({
        ...persistedInput,
        ...(selectedProduct === undefined ? {} : { selectedProduct })
      });
      if (spec.expiresAt !== undefined && Date.parse(spec.expiresAt) <= createdAt.getTime()) {
        throw new Error("expiresAt must be in the future");
      }
      const watch = await watchStore.create(spec, createdAt.toISOString());
      const automationPrompt = `Call FindCheap Agent check_watch exactly once with watchId ${watch.watchId}. Notify the user only when status is TRIGGERED; include the observed value, checkedAt, and direct source or merchant link from observation. Treat NOT_TRIGGERED as a silent check. Do not purchase, reserve, submit forms, or use Chrome.`;
      const status = watch.status === "PAUSED" ? "PAUSED" as const
        : watch.schedulingState === undefined ? "LEGACY_UNVERIFIED" as const
          : watch.automationId === undefined ? "READY_TO_SCHEDULE" as const : "ACTIVE" as const;
      const message = status === "ACTIVE"
        ? `Watch ${watch.watchId} is active with Codex Automation ${watch.automationId}.`
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
      description: "Record the Codex Automation created from create_watch. Monitoring becomes active only after this binding succeeds.",
      inputSchema: z.object({ watchId: z.string().uuid(), automationId: WatchAutomationIdSchema }).strict(),
      outputSchema: {
        status: z.enum(["ACTIVE", "PAUSED", "EXPIRED", "NOT_FOUND", "AUTOMATION_ALREADY_BOUND"]),
        watchId: z.string().uuid(),
        automationId: WatchAutomationIdSchema
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
      if (watch.spec.expiresAt !== undefined && Date.parse(watch.spec.expiresAt) <= boundAt.getTime()) {
        await watchStore.save({ ...watch, status: "EXPIRED", updatedAt: boundAt.toISOString() });
        return {
          content: [{ type: "text" as const, text: "Watch expired before Automation binding." }],
          structuredContent: { status: "EXPIRED" as const, watchId, automationId }
        };
      }
      if (watch.automationId !== undefined && watch.automationId !== automationId) {
        return {
          content: [{ type: "text" as const, text: "Watch is already bound to a different Codex Automation." }],
          structuredContent: { status: "AUTOMATION_ALREADY_BOUND" as const, watchId, automationId: watch.automationId }
        };
      }
      const conflict = (await watchStore.list()).find((candidate) =>
        candidate.watchId !== watchId && candidate.automationId === automationId
      );
      if (conflict !== undefined) {
        return {
          content: [{ type: "text" as const, text: "Codex Automation is already bound to a different watch." }],
          structuredContent: { status: "AUTOMATION_ALREADY_BOUND" as const, watchId, automationId }
        };
      }
      const updated = { ...watch, automationId, schedulingState: "BOUND" as const, updatedAt: boundAt.toISOString() };
      await watchStore.save(updated);
      return {
        content: [{ type: "text" as const, text: `Watch monitoring is ${updated.status.toLowerCase()}.` }],
        structuredContent: { status: updated.status, watchId, automationId }
      };
    }
  );

  toolRegistrar.registerTool(
    "check_watch",
    {
      title: "Check a shopping watch",
      description: "Evaluate one persisted watch against current verified sources and update deduplication state.",
      inputSchema: z.object({ watchId: z.string().uuid() }).strict(),
      outputSchema: {
        status: z.enum(["TRIGGERED", "NOT_TRIGGERED", "PAUSED", "EXPIRED", "NEEDS_CLARIFICATION", "NOT_SCHEDULED", "NOT_FOUND", "DATA_SOURCE_UNAVAILABLE"]),
        message: z.string(),
        watchId: z.string().uuid(),
        observation: z.record(z.string(), z.unknown()).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ watchId }) => {
      const watch = await watchStore.get(watchId);
      if (watch === undefined) return { content: [{ type: "text" as const, text: "Watch not found." }], structuredContent: { status: "NOT_FOUND" as const, message: "Watch not found.", watchId } };
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
        return evaluateWatch(latest, watchStore, shopifyPort, dealPort, cartQuotes, now());
      });
      watchChecks.set(watchId, check);
      const result = await check.finally(() => {
        if (watchChecks.get(watchId) === check) watchChecks.delete(watchId);
      });
      return { content: [{ type: "text" as const, text: result.message }], structuredContent: {
        status: result.status,
        message: result.message,
        watchId,
        ...(result.observation === undefined ? {} : { observation: result.observation })
      } };
    }
  );

  toolRegistrar.registerTool(
    "list_watches",
    {
      title: "List shopping watches",
      description: "List persisted shopping watches without contacting merchants.",
      inputSchema: z.object({}).strict(),
      outputSchema: { watches: z.array(z.object({
        watchId: z.string().uuid(),
        status: z.string(),
        monitoringStatus: z.enum(["READY_TO_SCHEDULE", "ACTIVE", "PAUSED", "EXPIRED", "LEGACY_UNVERIFIED"]),
        automationId: WatchAutomationIdSchema.optional(),
        query: z.string(),
        condition: z.string(),
        priceBasis: z.enum(["ITEM_PRICE", "DELIVERED_TOTAL"]).optional(),
        intervalMinutes: z.number().int()
      })) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => ({ content: [{ type: "text" as const, text: "Shopping watches listed." }], structuredContent: { watches: (await watchStore.list()).map((watch) => ({
      watchId: watch.watchId,
      status: watch.status,
      monitoringStatus: watch.status === "EXPIRED" ? "EXPIRED" as const
        : watch.status === "PAUSED" ? "PAUSED" as const
          : watch.schedulingState === undefined ? "LEGACY_UNVERIFIED" as const
            : watch.automationId === undefined ? "READY_TO_SCHEDULE" as const : "ACTIVE" as const,
      ...(watch.automationId === undefined ? {} : { automationId: watch.automationId }),
      query: watch.spec.query,
      condition: watch.spec.condition,
      ...(watch.spec.priceBasis === undefined ? {} : { priceBasis: watch.spec.priceBasis }),
      intervalMinutes: watch.spec.intervalMinutes
    })) } })
  );

  toolRegistrar.registerTool(
    "pause_watch",
    {
      title: "Pause or resume a shopping watch",
      description: "Pause or resume one persisted shopping watch.",
      inputSchema: z.object({ watchId: z.string().uuid(), paused: z.boolean(), automationId: WatchAutomationIdSchema.optional() }).strict(),
      outputSchema: { status: z.enum(["ACTIVE", "PAUSED", "NOT_FOUND", "AUTOMATION_SYNC_REQUIRED"]), watchId: z.string().uuid(), automationId: WatchAutomationIdSchema.optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ watchId, paused, automationId }) => {
      const watch = await watchStore.get(watchId);
      if (watch === undefined) return { content: [{ type: "text" as const, text: "Watch not found." }], structuredContent: { status: "NOT_FOUND" as const, watchId } };
      if (watch.schedulingState === undefined) {
        return {
          content: [{ type: "text" as const, text: "Bind the legacy Watch to its existing Codex Automation before pausing or resuming it." }],
          structuredContent: { status: "AUTOMATION_SYNC_REQUIRED" as const, watchId }
        };
      }
      if (watch.automationId !== undefined && watch.automationId !== automationId) {
        return {
          content: [{ type: "text" as const, text: "Update the bound Codex Automation first, then retry with its automationId." }],
          structuredContent: { status: "AUTOMATION_SYNC_REQUIRED" as const, watchId, automationId: watch.automationId }
        };
      }
      const status = paused ? "PAUSED" as const : "ACTIVE" as const;
      await watchStore.save({ ...watch, status, updatedAt: now().toISOString() });
      return { content: [{ type: "text" as const, text: `Watch is ${status.toLowerCase()}.` }], structuredContent: {
        status, watchId, ...(watch.automationId === undefined ? {} : { automationId: watch.automationId })
      } };
    }
  );

  toolRegistrar.registerTool(
    "delete_watch",
    {
      title: "Delete a shopping watch",
      description: "Permanently delete one local shopping watch. The host must also remove its scheduled automation.",
      inputSchema: z.object({ watchId: z.string().uuid(), automationId: WatchAutomationIdSchema.optional() }).strict(),
      outputSchema: { status: z.enum(["DELETED", "NOT_FOUND", "AUTOMATION_SYNC_REQUIRED"]), deleted: z.boolean(), watchId: z.string().uuid(), automationId: WatchAutomationIdSchema.optional() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
    },
    async ({ watchId, automationId }) => {
      const watch = await watchStore.get(watchId);
      if (watch === undefined) return { content: [{ type: "text" as const, text: "Watch not found." }], structuredContent: {
        status: "NOT_FOUND" as const, deleted: false, watchId
      } };
      if (watch.schedulingState === undefined) {
        return {
          content: [{ type: "text" as const, text: "Bind the legacy Watch to its existing Codex Automation before deleting it." }],
          structuredContent: { status: "AUTOMATION_SYNC_REQUIRED" as const, deleted: false, watchId }
        };
      }
      if (watch.automationId !== undefined && watch.automationId !== automationId) {
        return {
          content: [{ type: "text" as const, text: "Delete the bound Codex Automation first, then retry with its automationId." }],
          structuredContent: {
            status: "AUTOMATION_SYNC_REQUIRED" as const,
            deleted: false,
            watchId,
            automationId: watch.automationId
          }
        };
      }
      const deleted = await watchStore.delete(watchId);
      return { content: [{ type: "text" as const, text: deleted ? "Watch deleted." : "Watch not found." }], structuredContent: {
        status: deleted ? "DELETED" as const : "NOT_FOUND" as const,
        deleted,
        watchId,
        ...(watch.automationId === undefined ? {} : { automationId: watch.automationId })
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
