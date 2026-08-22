import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ComparisonResultSchema,
  type ComparisonResult,
  type PriceQuote
} from "../../../packages/contracts/src/index.js";
import {
  createUnavailableShopifyPort,
  type ShopifyPort,
  type ShopifySearchResult
} from "./shopify-client.js";
import { hasSpecificProductIdentity } from "./shopify-match.js";
import {
  ShopifyCartQuoteError,
  type ShopifyCartQuotePort,
  type ShopifyQuoteFailureCode
} from "./shopify-cart-quote.js";
import type { ShopifySelectedProductInspector } from "./shopify-selected-product.js";
import {
  createAffiliateLinkResolver,
  type AffiliateLinkResolver
} from "./affiliate-links.js";
import {
  PRODUCT_CARD_HTML,
  PRODUCT_CARD_RESOURCE_DOMAINS,
  PRODUCT_CARD_UI_URI
} from "./product-card-ui.js";
import {
  DealSearchInputSchema,
  VerifiedDealsSchema,
  createUnavailableDealPort,
  type DealPort
} from "./deal-client.js";
import {
  WatchSpecSchema,
  WatchSpecInputSchema,
  WatchAutomationIdSchema,
  productWatchClarificationQuestions,
  createMemoryWatchStore,
  type WatchStore
} from "./watch-store.js";
import { evaluateWatch, type WatchEvaluation } from "./watch-service.js";
import { MERCHANT_TRUST_REGISTRY_VERSION } from "./merchant-trust.js";
import {
  createUnavailableAwinPort,
  type AwinProductPort,
  type AwinSearchResult
} from "./awin-feed-client.js";

export type { ShopifyPort } from "./shopify-client.js";
export type { DealPort } from "./deal-client.js";
export type { WatchStore } from "./watch-store.js";
export type { AwinProductPort } from "./awin-feed-client.js";

const CardStageDurationSchema = z.number().nonnegative().max(300_000);
const ProductCardStagesSchema = z.object({
  IFRAME_LOADED: CardStageDurationSchema.optional(),
  RESOURCE_EVALUATED: CardStageDurationSchema.optional(),
  INITIALIZE_SENT: CardStageDurationSchema.optional(),
  INITIALIZE_RETRY: CardStageDurationSchema.optional(),
  INITIALIZE_ACK: CardStageDurationSchema.optional(),
  COMPAT_BRIDGE_READY: CardStageDurationSchema.optional(),
  COMPAT_OUTPUT_RECEIVED: CardStageDurationSchema.optional(),
  TOOL_INPUT_RECEIVED: CardStageDurationSchema.optional(),
  TOOL_OUTPUT_RECEIVED: CardStageDurationSchema.optional(),
  RENDER_STARTED: CardStageDurationSchema.optional(),
  DOM_RENDERED: CardStageDurationSchema.optional(),
  FIRST_IMAGE_PAINTED: CardStageDurationSchema.optional(),
  FIRST_IMAGE_SETTLED: CardStageDurationSchema.optional(),
  TOOL_OUTPUT_TIMEOUT: CardStageDurationSchema.optional(),
  TOOL_OUTPUT_FAILED: CardStageDurationSchema.optional(),
  INITIALIZE_SLOW: CardStageDurationSchema.optional(),
  INITIALIZE_FAILED: CardStageDurationSchema.optional()
}).strict();

const ProductCardTelemetryInputSchema = z.object({
  renderId: z.string().uuid(),
  version: z.literal("0.7.1"),
  terminalStage: z.enum([
    "DOM_RENDERED",
    "FIRST_IMAGE_SETTLED",
    "TOOL_OUTPUT_TIMEOUT",
    "TOOL_OUTPUT_FAILED",
    "INITIALIZE_SLOW"
  ]),
  stages: ProductCardStagesSchema
}).strict();

export type ProductCardTelemetry = z.infer<typeof ProductCardTelemetryInputSchema> & {
  recordedAt: string;
};

export type ProductCardTelemetrySink = {
  record(event: ProductCardTelemetry): void | Promise<void>;
};

const unavailableMessage =
  "Live comparison is unavailable because no approved shopping data source is connected.";
const shopifyUnavailableMessage =
  "Shopify Global Catalog data is unavailable because the official Catalog request failed or the Agent Profile is not configured.";
const dealUnavailableMessage =
  "Verified Coupon and Cashback data is unavailable because no approved Deals API is configured or the request failed.";

const MembershipIdsSchema = z
  .array(z.string().trim().min(1).max(80))
  .max(20)
  .refine((values) => new Set(values).size === values.length, {
    message: "membershipIds must contain unique values"
  });

export const CompareProductsInputSchema = z
  .object({
    query: z.string().trim().min(2).max(300),
    zipCode: z.string().regex(/^\d{5}(?:-\d{4})?$/),
    membershipIds: MembershipIdsSchema.optional()
  })
  .strict();

export type CompareProductsInput = z.infer<typeof CompareProductsInputSchema>;

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

const ShopifySelectedQuoteInputSchema = z.object({
  renderId: z.string().uuid(),
  variantId: z.string().regex(/^\d{1,30}$/u),
  zipCode: z.string().regex(/^\d{5}(?:-\d{4})?$/u),
  deliveryAddress: z.object({
    address1: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(100),
    provinceCode: z.string().regex(/^[A-Z]{2}$/u)
  }).strict().optional()
}).strict();

function quoteFailureMessage(code: ShopifyQuoteFailureCode): string {
  switch (code) {
    case "FULL_ADDRESS_REQUIRED":
      return "[FULL_ADDRESS_REQUIRED] This merchant requires a fuller delivery address. Ask the customer for street address, city, and two-letter state code, then retry the same renderId and variantId. FindCheap sends it once to the merchant and does not save it in FindCheap state.";
    case "NO_DELIVERY_OPTIONS":
      return "[NO_DELIVERY_OPTIONS] This merchant returned no shipping method for this address. The item may not ship to this destination; no shipping, tax, or total was inferred.";
    case "MERCHANT_CART_UNAVAILABLE":
      return "[MERCHANT_CART_UNAVAILABLE] This merchant's Cart quote service is currently unavailable or incompatible. This does not prove the product is out of stock or invalid. Retry later or check merchant checkout.";
    case "VARIANT_REJECTED":
      return "[VARIANT_REJECTED] The merchant rejected this exact Shopify variant. It may be unavailable, sold out, or no longer purchasable; no replacement product was searched.";
    case "QUOTE_TIMEOUT":
      return "[QUOTE_TIMEOUT] The merchant did not return a Cart quote before the deadline. Product availability was not changed; retry later.";
  }
}

const ShopifySelectedProductInputSchema = z.object({
  renderId: z.string().uuid(),
  variantId: z.string().regex(/^\d{1,30}$/u),
  variantDimensions: z.record(
    z.string().trim().min(1).max(100),
    z.string().trim().min(1).max(300)
  ).refine((value) => Object.keys(value).length <= 10, {
    message: "variantDimensions must contain at most 10 entries"
  }).optional()
}).strict();

export interface ComparePort {
  compare(input: CompareProductsInput): Promise<ComparisonResult>;
}

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
      renderId: z.string().uuid(),
      variantId: z.string().regex(/^\d{1,30}$/u)
    }).strict()
  }).strict()).max(3)
};

const LineItemOutputSchema = z.object({
  kind: z.enum(["ITEM", "COUPON", "MEMBERSHIP", "SHIPPING", "TAX", "MANDATORY_FEE"]),
  amount: MoneyOutputSchema,
  label: z.string(),
  condition: z.string().optional()
});

const QuoteOutputSchema = z.object({
  status: z.enum(["VERIFIED", "ESTIMATED", "CONDITIONAL"]),
  deliveredPrice: MoneyOutputSchema,
  lineItems: z.array(LineItemOutputSchema),
  eligibilityConditions: z.array(z.string()),
  checkedAt: z.string(),
  expiresAt: z.string()
});

const ExactOfferOutputSchema = z.object({
  sellerName: z.string(),
  matchStatus: z.literal("EXACT"),
  regularQuote: QuoteOutputSchema,
  memberQuote: z.object({
    programName: z.string(),
    eligible: z.boolean(),
    quote: QuoteOutputSchema
  }).optional(),
  merchantUrl: z.string(),
  recommendationReasons: z.array(z.string())
});

const SimilarOfferOutputSchema = z.object({
  sellerName: z.string(),
  matchStatus: z.literal("SIMILAR"),
  merchantUrl: z.string(),
  recommendationReasons: z.array(z.string())
});

const CompareProductsOutputShape = {
  status: z.enum(["OK", "DATA_SOURCE_UNAVAILABLE"]),
  message: z.string(),
  exactOffers: z.array(ExactOfferOutputSchema),
  similarOffers: z.array(SimilarOfferOutputSchema),
  questions: z.array(z.string())
};

const ShopifyProductOutputSchema = z.object({
  merchantId: z.string(),
  merchant: z.string(),
  sourceHost: z.string(),
  merchantTrust: z.object({
    level: z.enum(["OFFICIAL", "AUTHORIZED_RETAILER", "ESTABLISHED_RETAILER", "UNKNOWN", "RISKY"]),
    verification: z.enum(["INDEPENDENT", "UNVERIFIED"]),
    evidence: z.array(z.string()),
    reviewedAt: z.string().optional()
  }),
  handle: z.string(),
  title: z.string(),
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
  merchantUrl: z.string().url(),
  checkedAt: z.string(),
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
    verified: z.array(z.object({
      code: z.string().optional(),
      amount: MoneyOutputSchema,
      eligibility: z.array(z.string()),
      validTo: z.string()
    }))
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
    imageUrl: z.string().url().optional(),
    primaryPrice: MoneyOutputSchema.optional(),
    priceLabel: z.string(),
    itemPrice: MoneyOutputSchema.optional(),
    shippingLabel: z.string().optional(),
    taxPrice: MoneyOutputSchema.optional(),
    taxLabel: z.string().optional(),
    estimatedTotal: MoneyOutputSchema.optional(),
    matchBadge: z.enum(["EXACT", "DISCOVERY_MATCH", "SIMILAR"]),
    conditionBadge: z.enum(["NEW", "USED", "REFURBISHED", "OPEN_BOX", "UNKNOWN"]),
    availability: z.enum(["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"]),
    merchantTrustBadge: z.enum(["OFFICIAL", "AUTHORIZED_RETAILER", "ESTABLISHED_RETAILER", "MERCHANT_UNVERIFIED"]),
    actionLabel: z.literal("View at merchant")
  }),
  quoteReference: z.object({
    renderId: z.string().uuid(),
    variantId: z.string().regex(/^\d{1,30}$/u)
  }).strict().optional()
});

const ShopifyProductsOutputShape = {
  renderId: z.string().uuid().optional(),
  status: z.enum(["OK", "NEEDS_CLARIFICATION", "DATA_SOURCE_UNAVAILABLE"]),
  message: z.string(),
  source: z.literal("SHOPIFY_GLOBAL_CATALOG"),
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
    outOfStockProductsExcluded: z.number().int().nonnegative(),
    identityProductsExcluded: z.number().int().nonnegative(),
    irrelevantProductsExcluded: z.number().int().nonnegative(),
    conditionProductsExcluded: z.number().int().nonnegative(),
    priceProductsExcluded: z.number().int().nonnegative(),
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
  products: z.array(ShopifyProductOutputSchema)
};

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

type SafeQuote = z.infer<typeof QuoteOutputSchema>;

function safeQuote(quote: PriceQuote): SafeQuote {
  return {
    status: quote.status,
    deliveredPrice: quote.deliveredPrice,
    lineItems: quote.lineItems,
    eligibilityConditions: quote.eligibilityConditions,
    checkedAt: quote.checkedAt,
    expiresAt: quote.expiresAt
  };
}

function unavailableResult() {
  return {
    content: [{ type: "text" as const, text: unavailableMessage }],
    structuredContent: {
      status: "DATA_SOURCE_UNAVAILABLE" as const,
      message: unavailableMessage,
      exactOffers: [],
      similarOffers: [],
      questions: []
    }
  };
}

function successResult(result: ComparisonResult) {
  const exactOffers = result.exactOffers.map((offer) => ({
    sellerName: offer.sellerName,
    matchStatus: "EXACT" as const,
    regularQuote: safeQuote(offer.regularQuote),
    ...(offer.memberQuote
      ? {
          memberQuote: {
            programName: offer.memberQuote.programName,
            eligible: offer.memberQuote.eligible,
            quote: safeQuote(offer.memberQuote.quote)
          }
        }
      : {}),
    merchantUrl: offer.merchantUrl,
    recommendationReasons: offer.recommendationReasons
  }));
  const similarOffers = result.similarOffers.map((offer) => ({
    sellerName: offer.sellerName,
    matchStatus: "SIMILAR" as const,
    merchantUrl: offer.merchantUrl,
    recommendationReasons: offer.recommendationReasons
  }));
  const message = `Comparison complete: ${exactOffers.length} exact and ${similarOffers.length} similar result(s).`;

  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: {
      status: "OK" as const,
      message,
      exactOffers,
      similarOffers,
      questions: result.questions
    }
  };
}

export function createUnavailableComparePort(): ComparePort {
  return {
    async compare() {
      throw new Error("DATA_SOURCE_UNAVAILABLE");
    }
  };
}

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
  const unverifiedCount = result.products.filter((product) => product.merchantTrust.verification === "UNVERIFIED").length;
  const priceLimit = result.maxItemPriceCents === undefined
    ? ""
    : ` Maximum item price: USD ${(result.maxItemPriceCents / 100).toFixed(2)}.`;
  const comparison = result.comparison.status === "SAME_PRODUCT"
    ? ` Same-product comparison verified across ${result.comparison.merchantCount} merchants using ${result.comparison.evidence.join("; ")}.`
    : " No cross-merchant same-product identity was independently verified; results are discovery options, not like-for-like offers.";
  const linkSummary = affiliateLinksApproved === 0
    ? "Purchase actions use canonical merchant links because no affiliate relationship is active."
    : `${affiliateLinksApproved} purchase link(s) use an approved affiliate relationship with disclosure; remaining links are canonical merchant links. Commission never affects ranking.`;
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
  const searchDiagnostics = `Search attempts: ${result.diagnostics.queryAttempts}; relaxed fallback: ${result.diagnostics.fallbackQueryUsed ? "USED" : "NOT_USED"}; Catalog products/variants: ${result.diagnostics.catalogProductsReturned}/${result.diagnostics.catalogVariantsReturned}; zero-result attempts: ${result.diagnostics.catalogZeroResultAttempts}; excluded out-of-stock/identity/condition/price/unverified/risky: ${result.diagnostics.outOfStockProductsExcluded}/${result.diagnostics.identityProductsExcluded}/${result.diagnostics.conditionProductsExcluded}/${result.diagnostics.priceProductsExcluded}/${result.diagnostics.unverifiedMerchantProductsExcluded}/${result.diagnostics.riskyMerchantProductsExcluded}.`;
  const trustSummary = trustedCount > 0
    ? `${trustedCount} independently verified merchant card(s); unknown merchants were not used to pad the result.`
    : `${unverifiedCount} merchant card(s) lack independent trust evidence and are discovery candidates, not merchant recommendations.`;
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
      `regular item price: ${price}`,
      cartQuote === undefined
        ? "shipping: unavailable | tax: unavailable | mandatory fees: unavailable | member price: unavailable | delivered price unavailable"
        : `shipping: ${cartQuote.shipping.amountCents === 0 ? "free shipping USD 0.00" : `${cartQuote.shipping.currency} ${(cartQuote.shipping.amountCents / 100).toFixed(2)} (${cartQuote.shipping.label})`} | tax: ${cartQuote.tax.status === "ZIP_ESTIMATED" ? `USD ${(cartQuote.tax.amount.amountCents / 100).toFixed(2)} ZIP state-average estimate (${cartQuote.tax.jurisdiction})` : `USD ${(cartQuote.tax.amount.amountCents / 100).toFixed(2)} explicitly returned by Shopify${cartQuote.tax.shopifyEstimated ? " as estimated" : ""}`} | estimated total: ${cartQuote.deliveredPrice.currency} ${(cartQuote.deliveredPrice.amountCents / 100).toFixed(2)} | expires: ${cartQuote.expiresAt}`,
      `availability: ${product.availability}`,
      `condition: ${product.condition}`,
      `match evidence: ${product.matchEvidence.join("; ")}`,
      ...(variants === "" ? [] : [`variants: ${variants}`]),
      `purchase link kind: ${purchaseLink.kind}`,
      ...(purchaseLink.disclosure === undefined ? [] : [`affiliate disclosure: ${purchaseLink.disclosure}`]),
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
          ...(unverifiedCount === 0 ? [] : ["one or more merchants lack independent trust evidence"])
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
            : "MERCHANT_UNVERIFIED" as const,
          actionLabel: "View at merchant" as const
        }
      }))
    }
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
  const message = "Awin Product Feed is unavailable. Configure AWIN_PRODUCT_FEED_URL and AWIN_PRODUCT_FEED_TOKEN, or use datafeed_3047955.csv.gz in Downloads for local development.";
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
  awin?: AwinProductPort;
  deals?: DealPort;
  watches?: WatchStore;
  cartQuotes?: ShopifyCartQuotePort;
  selectedProducts?: ShopifySelectedProductInspector;
  now?: () => Date;
  cardTelemetry?: ProductCardTelemetrySink;
  toolAvailability?: {
    commerceCompare: boolean;
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
  context: { zipCode?: string | undefined; membershipIds?: string[] | undefined }
) {
  const question = "Provide a brand and exact model/MPN/GTIN, or a direct product URL, before requesting same-product comparison.";
  const message = `Comparison status: NEEDS_CLARIFICATION. ${question} No merchant API was queried and Chrome is not eligible.`;
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: {
      status: "NEEDS_CLARIFICATION" as const,
      message,
      source: "SHOPIFY_GLOBAL_CATALOG" as const,
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
        evidence: ["specific product identity absent"],
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
        merchantTrustRegistryVersion: MERCHANT_TRUST_REGISTRY_VERSION,
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
        merchantTrustRegistryVersion: MERCHANT_TRUST_REGISTRY_VERSION,
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
  comparePort: ComparePort,
  shopifyPort: ShopifyPort = createUnavailableShopifyPort(),
  affiliateLinks: AffiliateLinkResolver = createAffiliateLinkResolver(),
  dependencies: ShoppingServerDependencies = {}
): McpServer {
  const server = new McpServer({ name: "findcheap-agent", version: "0.7.1" });
  const dealPort = dependencies.deals ?? createUnavailableDealPort();
  const awinPort = dependencies.awin ?? createUnavailableAwinPort();
  const toolAvailability = dependencies.toolAvailability ?? {
    commerceCompare: true,
    verifiedDeals: true
  };
  const watchStore = dependencies.watches ?? createMemoryWatchStore();
  const cartQuotes = dependencies.cartQuotes;
  const selectedProducts = dependencies.selectedProducts;
  const now = dependencies.now ?? (() => new Date());
  const cardTelemetry = dependencies.cardTelemetry ?? {
    record: (event: ProductCardTelemetry) => {
      process.stderr.write(`[findcheap-product-card-metrics] ${JSON.stringify(event)}\n`);
    }
  };
  const watchChecks = new Map<string, Promise<WatchEvaluation>>();
  const renderSnapshots = new Map<string, {
    expiresAt: number;
    content: ReturnType<typeof shopifyResult>["structuredContent"] & { renderId: string };
    sourceResult: ShopifySearchResult;
  }>();
  const recordedCardTelemetry = new Set<string>();
  const rememberSnapshot = (
    content: ReturnType<typeof shopifyResult>["structuredContent"],
    sourceResult: ShopifySearchResult
  ): ReturnType<typeof shopifyResult>["structuredContent"] & { renderId: string } => {
    const renderId = randomUUID();
    const snapshot = {
      ...content,
      renderId,
      products: content.products.map((product) => ({
        ...product,
        quoteReference: { renderId, variantId: product.handle }
      }))
    };
    renderSnapshots.set(renderId, {
      expiresAt: Date.now() + 30 * 60_000,
      content: snapshot,
      sourceResult
    });
    while (renderSnapshots.size > 32) {
      const oldest = renderSnapshots.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      renderSnapshots.delete(oldest);
    }
    return snapshot;
  };

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
              resourceDomains: PRODUCT_CARD_RESOURCE_DOMAINS
            }
          }
        }
      }]
    })
  );

  if (toolAvailability.commerceCompare) server.registerTool(
    "compare_products",
    {
      title: "Compare products",
      description: "Compare exact products and separately identify similar items for a US delivery ZIP.",
      inputSchema: CompareProductsInputSchema,
      outputSchema: CompareProductsOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (input) => {
      try {
        const comparison = ComparisonResultSchema.parse(await comparePort.compare(input));
        return successResult(comparison);
      } catch {
        return unavailableResult();
      }
    }
  );

  server.registerTool(
    "search_shopify_products",
    {
      title: "Search Shopify Global Catalog (Beta)",
      description: "Search Shopify Global Catalog across eligible merchants once per new lookup and render the returned cards directly. Independently reviewed exact domains rank before price; UNKNOWN merchants never pad Top 3 when trusted results exist, and affiliate status never ranks. The tool translates supported Chinese product terms and may make one internal bounded relaxed request only after an empty primary result; relaxed results are DISCOVERY_MATCH, never EXACT. For any later follow-up about a returned product, never search its title again: use inspect_selected_shopify_product for size, color, options, or availability, and quote_selected_shopify_product for a ZIP quote. Use comparisonMode=SAME_PRODUCT only with exact identity; selectionMode=LOWEST_PRICE only when cheapest is explicit, otherwise MERCHANT_DIVERSE. Put budget in maxItemPriceCents.",
      inputSchema: ShopifyProductsToolInputSchema,
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
        "openai/toolInvocation/invoking": "Searching Shopify products…",
        "openai/toolInvocation/invoked": "Product cards ready."
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
        const content = rememberSnapshot(response.structuredContent, enriched.result);
        return {
          ...response,
          content: [{
            type: "text" as const,
            text: `${response.content[0]!.text}\nFor every follow-up about one selected product, reuse quoteReference and never search its title again. Call inspect_selected_shopify_product for size, color, options, or availability; call quote_selected_shopify_product only for a ZIP quote.`
          }],
          structuredContent: content
        };
      } catch {
        return shopifyUnavailableResult(validatedInput.selectionMode, validatedInput);
      }
    }
  );

  server.registerTool(
    "search_awin_products",
    {
      title: "Search approved Awin Product Feed",
      description: "Search the authenticated Amazonliss (US) Awin Product Feed, with a local Downloads fallback for development. Use only for Amazonliss, Nutree Cosmetics, or an explicit Awin-feed lookup. Results are DISCOVERY_MATCH and DISCOVERY_ONLY because the feed lacks GTIN, MPN, brand, and condition. Returned Awin links belong to the checked-in approved publisher/merchant relationship and include disclosure. Item price and feed availability only; no shipping, tax, coupon, member, or delivered-price claims.",
      inputSchema: AwinProductsToolInputSchema,
      outputSchema: AwinProductsOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
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

  server.registerTool(
    "inspect_selected_shopify_product",
    {
      title: "Inspect a selected Shopify product",
      description: "Check size, color, other variants, or current availability for exactly one product returned by search_shopify_products. Copy renderId and variantId from its quoteReference and put requested options in variantDimensions. This resolves the exact prior merchant product path; never run another catalog search, pass a title/query, or substitute another product.",
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
      const { renderId, variantId, variantDimensions = {} } = ShopifySelectedProductInputSchema.parse(input);
      const snapshot = renderSnapshots.get(renderId);
      if (snapshot === undefined || snapshot.expiresAt <= Date.now()) {
        renderSnapshots.delete(renderId);
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Selected product reference expired. Run one new Shopify search before inspecting variants."
          }]
        };
      }
      const selected = snapshot.sourceResult.products.find((product) => product.handle === variantId);
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
          quoteReference: { renderId: remembered.renderId, variantId: product.handle }
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

  server.registerTool(
    "quote_selected_shopify_product",
    {
      title: "Quote a selected Shopify product",
      description: "Get shipping, tax, and estimated total for exactly one product returned by search_shopify_products. Copy renderId and variantId from that product's quoteReference. When FULL_ADDRESS_REQUIRED is returned, ask for street address, city, and two-letter US state code, then retry with deliveryAddress; FindCheap sends it once to the merchant and does not save it in FindCheap state. Never substitute a title query or run another catalog search.",
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
        "openai/toolInvocation/invoking": "Quoting the selected Shopify variant…",
        "openai/toolInvocation/invoked": "Selected-product quote ready."
      }
    },
    async (input) => {
      const { renderId, variantId, zipCode, deliveryAddress } = ShopifySelectedQuoteInputSchema.parse(input);
      const snapshot = renderSnapshots.get(renderId);
      if (snapshot === undefined || snapshot.expiresAt <= Date.now()) {
        renderSnapshots.delete(renderId);
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Selected product reference expired. Run one new Shopify search before requesting a quote."
          }]
        };
      }
      const selected = snapshot.sourceResult.products.find((product) => product.handle === variantId);
      if (selected === undefined) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Selected variant does not belong to that search result. No quote was requested."
          }]
        };
      }
      if (cartQuotes === undefined) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Shopify Cart quote provider is unavailable." }]
        };
      }
      try {
        const cartQuote = deliveryAddress === undefined
          ? await cartQuotes.quote(selected, zipCode)
          : await cartQuotes.quote(selected, zipCode, deliveryAddress);
        const quotedProduct = {
          ...selected,
          itemPrice: cartQuote.subtotal,
          checkedAt: cartQuote.checkedAt,
          cartQuote
        };
        const quotedResult: ShopifySearchResult = {
          ...snapshot.sourceResult,
          merchantsQueried: 1,
          merchantsSucceeded: 1,
          comparison: {
            status: "DISCOVERY_ONLY",
            evidence: ["selected from immutable prior result by Shopify variant identity"],
            merchantCount: 1,
            offerCount: 1
          },
          questions: [],
          products: [quotedProduct]
        };
        const response = shopifyResult(
          quotedResult,
          { zipCode, membershipIds: [] },
          affiliateLinks,
          { attempted: 1, succeeded: 1 }
        );
        const content = rememberSnapshot(response.structuredContent, quotedResult);
        return {
          ...response,
          content: [{
            type: "text" as const,
            text: `Quoted the exact previously returned product by stable Shopify variant reference ${variantId}; no title or catalog search was used.\n${response.content[0]!.text}`
          }],
          structuredContent: content
        };
      } catch (error) {
        const failure = error instanceof ShopifyCartQuoteError
          ? error
          : new ShopifyCartQuoteError("MERCHANT_CART_UNAVAILABLE", { cause: error });
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: quoteFailureMessage(failure.code)
          }]
        };
      }
    }
  );

  if (toolAvailability.verifiedDeals) server.registerTool(
    "find_coupons",
    {
      title: "Find verified coupons and cashback",
      description: "Find current verified Coupon, promo code, brand promotion, membership offer, Cashback, or offline barcode evidence. Never guesses codes.",
      inputSchema: DealSearchInputSchema,
      outputSchema: {
        status: z.enum(["OK", "NO_VERIFIED_DEALS", "DATA_SOURCE_UNAVAILABLE"]),
        message: z.string(),
        deals: z.array(z.object({
          dealId: z.string(), merchant: z.string(), kind: z.string(), title: z.string(), description: z.string(),
          code: z.string().optional(), barcodeUrl: z.string().url().optional(), discountPercent: z.number().optional(),
          discountAmountCents: z.number().int().optional(), cashbackPercent: z.number().optional(), membershipProgram: z.string().optional(),
          eligibility: z.array(z.string()), channels: z.array(z.string()), sourceUrl: z.string().url(), checkedAt: z.string(), validTo: z.string()
        }))
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (input) => {
      const validated = DealSearchInputSchema.parse(input);
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
        const message = deals.length === 0 ? "No current verified deals were found." : `Found ${deals.length} current verified deal(s).`;
        return { content: [{ type: "text" as const, text: message }], structuredContent: {
          status: deals.length === 0 ? "NO_VERIFIED_DEALS" as const : "OK" as const,
          message,
          deals: deals.map(({ verificationStatus: _verificationStatus, validFrom: _validFrom, ...deal }) => deal)
        } };
      } catch {
        return { content: [{ type: "text" as const, text: dealUnavailableMessage }], structuredContent: {
          status: "DATA_SOURCE_UNAVAILABLE" as const, message: dealUnavailableMessage, deals: []
        } };
      }
    }
  );

  server.registerTool(
    "create_watch",
    {
      title: "Create a shopping watch",
      description: "Persist a Watch rule and return the exact Codex Automation handoff. Monitoring is not active until bind_watch_automation succeeds.",
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
      const spec = WatchSpecSchema.parse(input);
      if (
        !toolAvailability.verifiedDeals &&
        ["DISCOUNT_AT_LEAST", "COUPON_AVAILABLE", "CASHBACK_AT_LEAST"].includes(spec.condition)
      ) {
        return { content: [{ type: "text" as const, text: dealUnavailableMessage }], structuredContent: {
          status: "DATA_SOURCE_UNAVAILABLE" as const,
          message: dealUnavailableMessage,
          questions: []
        } };
      }
      const questions = productWatchClarificationQuestions(spec);
      if (questions.length > 0) {
        const message = `More product detail is required before this watch can be created. ${questions.join(" ")}`;
        return { content: [{ type: "text" as const, text: message }], structuredContent: {
          status: "NEEDS_CLARIFICATION" as const,
          questions
        } };
      }
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

  server.registerTool(
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

  server.registerTool(
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
        return evaluateWatch(latest, watchStore, shopifyPort, dealPort, now());
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

  server.registerTool(
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
      intervalMinutes: watch.spec.intervalMinutes
    })) } })
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    "render_product_cards",
    {
      title: "Render identity-labeled product cards",
      description: "Render the immutable snapshot identified by renderId from search_shopify_products.",
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
      if (snapshot === undefined || snapshot.expiresAt <= Date.now()) {
        renderSnapshots.delete(renderId);
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Product-card snapshot is unavailable. Run search_shopify_products once."
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

  server.registerTool(
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
      if (snapshot === undefined || snapshot.expiresAt <= Date.now()) {
        renderSnapshots.delete(telemetry.renderId);
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
