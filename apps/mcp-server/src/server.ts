import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ComparisonResultSchema,
  type ComparisonResult,
  type PriceQuote
} from "../../../packages/contracts/src/index.js";
import {
  createUnavailableBestBuyPort,
  type BestBuyPort,
  type BestBuyProduct
} from "./bestbuy-client.js";
import {
  createUnavailableShopifyPort,
  type ShopifyPort,
  type ShopifySearchResult
} from "./shopify-client.js";
import { hasSpecificProductIdentity } from "./shopify-match.js";
import {
  PRODUCT_CARD_HTML,
  PRODUCT_CARD_RESOURCE_DOMAINS,
  PRODUCT_CARD_UI_URI
} from "./product-card-ui.js";

export type { BestBuyPort } from "./bestbuy-client.js";
export type { ShopifyPort } from "./shopify-client.js";

const unavailableMessage =
  "Live comparison is unavailable because no approved shopping data source is connected.";
const bestBuyUnavailableMessage =
  "Best Buy live product data is unavailable because BEST_BUY_API_KEY is not configured or the official API request failed.";
const shopifyUnavailableMessage =
  "Shopify Storefront Beta data is unavailable because the audited registry is not configured or its public API coverage is incomplete.";

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

const BestBuyProductsToolInputSchema = z.object({
  query: z.string().trim().min(2).max(300).optional(),
  sku: z.string().regex(/^\d{1,20}$/u).optional(),
  limit: z.number().int().min(1).max(50).default(10)
}).strict();

export const BestBuyProductsInputSchema = BestBuyProductsToolInputSchema.refine(
  (input) => (input.query === undefined) !== (input.sku === undefined), {
    message: "Provide exactly one of query or sku"
  }
);

const ShopifyProductsToolInputSchema = z.object({
  query: z.string().trim().min(2).max(300).regex(/^[\p{L}\p{N}\s._+'-]+$/u).optional(),
  handle: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(200).optional(),
  limit: z.number().int().min(1).max(3).default(3),
  maxItemPriceCents: z.number().int().min(1).max(100_000_000).optional()
    .describe("Inclusive public item-price ceiling in integer USD cents. Keep price words and currency symbols out of query."),
  zipCode: z.string().regex(/^\d{5}(?:-\d{4})?$/u).optional()
    .describe("Optional US delivery ZIP. Public Shopify results still return item price only unless contextual charges are verified."),
  membershipIds: MembershipIdsSchema.optional()
    .describe("Optional memberships. Member price remains unavailable unless the merchant source verifies it."),
  comparisonMode: z.enum(["DISCOVERY", "SAME_PRODUCT"])
    .describe("Use SAME_PRODUCT only for an explicit like-for-like comparison request; use DISCOVERY otherwise."),
  selectionMode: z.enum(["LOWEST_PRICE", "MERCHANT_DIVERSE"])
    .describe("Use LOWEST_PRICE only for an explicit cheapest request; use MERCHANT_DIVERSE otherwise.")
}).strict();

export const ShopifyProductsInputSchema = ShopifyProductsToolInputSchema.refine(
  (input) => (input.query === undefined) !== (input.handle === undefined), {
    message: "Provide exactly one of query or handle"
  }
);

export interface ComparePort {
  compare(input: CompareProductsInput): Promise<ComparisonResult>;
}

const MoneyOutputSchema = z.object({
  amountCents: z.number().int(),
  currency: z.literal("USD")
});

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

const BestBuyProductOutputSchema = z.object({
  sku: z.string(),
  title: z.string(),
  brand: z.string().optional(),
  modelNumber: z.string().optional(),
  gtins: z.array(z.string()),
  imageUrl: z.string().url().optional(),
  itemPrice: MoneyOutputSchema.optional(),
  availability: z.enum(["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"]),
  merchantUrl: z.string().url(),
  checkedAt: z.string()
});

const BestBuyProductsOutputShape = {
  status: z.enum(["OK", "DATA_SOURCE_UNAVAILABLE"]),
  message: z.string(),
  merchant: z.literal("Best Buy"),
  priceScope: z.literal("ITEM_PRICE_ONLY"),
  products: z.array(BestBuyProductOutputSchema)
};

const ShopifyProductOutputSchema = z.object({
  merchantId: z.string(),
  merchant: z.string(),
  sourceHost: z.string(),
  handle: z.string(),
  title: z.string(),
  brand: z.string().optional(),
  sku: z.string().optional(),
  gtins: z.array(z.string()),
  variantDimensions: z.record(z.string(), z.string()),
  matchStatus: z.enum(["EXACT", "SIMILAR"]),
  matchEvidence: z.array(z.string()),
  condition: z.enum(["NEW", "USED", "REFURBISHED", "OPEN_BOX", "UNKNOWN"]),
  imageUrl: z.string().url().optional(),
  itemPrice: MoneyOutputSchema.optional(),
  availability: z.enum(["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"]),
  merchantUrl: z.string().url(),
  checkedAt: z.string(),
  pricing: z.object({
    scope: z.literal("ITEM_PRICE_ONLY"),
    regularItemPrice: z.object({
      status: z.enum(["VERIFIED", "UNAVAILABLE"]),
      amount: MoneyOutputSchema.optional(),
      reason: z.string().optional()
    }),
    memberPrice: z.object({ status: z.literal("UNAVAILABLE"), reason: z.string() }),
    shipping: z.object({ status: z.literal("UNAVAILABLE"), reason: z.string() }),
    tax: z.object({ status: z.literal("UNAVAILABLE"), reason: z.string() }),
    mandatoryFees: z.object({ status: z.literal("UNAVAILABLE"), reason: z.string() }),
    deliveredPrice: z.object({ status: z.literal("UNAVAILABLE"), reason: z.string() })
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
    url: z.string().url()
  }),
  card: z.object({
    title: z.string(),
    merchant: z.string(),
    imageUrl: z.string().url().optional(),
    primaryPrice: MoneyOutputSchema.optional(),
    priceLabel: z.string(),
    matchBadge: z.enum(["EXACT", "SIMILAR"]),
    conditionBadge: z.enum(["NEW", "USED", "REFURBISHED", "OPEN_BOX", "UNKNOWN"]),
    availability: z.enum(["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"]),
    actionLabel: z.literal("View at merchant")
  })
});

const ShopifyProductsOutputShape = {
  status: z.enum(["OK", "NEEDS_CLARIFICATION", "DATA_SOURCE_UNAVAILABLE"]),
  message: z.string(),
  source: z.literal("SHOPIFY_STOREFRONT_API"),
  priceScope: z.literal("ITEM_PRICE_ONLY"),
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
    identityType: z.enum(["GTIN", "BRAND_MPN"]).optional(),
    evidence: z.array(z.string()),
    merchantCount: z.number().int().nonnegative(),
    offerCount: z.number().int().nonnegative()
  }),
  diagnostics: z.object({
    apiDurationMs: z.number().int().nonnegative(),
    cacheStatus: z.enum(["MISS", "HIT", "COALESCED"]),
    chromeFallbackEligible: z.boolean(),
    irrelevantProductsExcluded: z.number().int().nonnegative(),
    conditionProductsExcluded: z.number().int().nonnegative(),
    priceProductsExcluded: z.number().int().nonnegative(),
    merchantsFailed: z.number().int().nonnegative(),
    coveragePercent: z.number().int().min(0).max(100),
    failedMerchantIds: z.array(z.string()),
    timedOutMerchantIds: z.array(z.string()),
    registryVersion: z.string(),
    searchTimeoutMs: z.number().int().nonnegative(),
    selectionPolicy: z.enum([
      "EXACT_THEN_SIMILAR_THEN_PRICE",
      "EXACT_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE"
    ])
  }),
  questions: z.array(z.string()),
  products: z.array(ShopifyProductOutputSchema)
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

function bestBuyResult(products: BestBuyProduct[]) {
  const message = `Best Buy returned ${products.length} product(s). Prices are item prices only; shipping, tax, coupons, and member pricing are not included.`;
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: {
      status: "OK" as const,
      message,
      merchant: "Best Buy" as const,
      priceScope: "ITEM_PRICE_ONLY" as const,
      products
    }
  };
}

function bestBuyUnavailableResult() {
  return {
    content: [{ type: "text" as const, text: bestBuyUnavailableMessage }],
    structuredContent: {
      status: "DATA_SOURCE_UNAVAILABLE" as const,
      message: bestBuyUnavailableMessage,
      merchant: "Best Buy" as const,
      priceScope: "ITEM_PRICE_ONLY" as const,
      products: []
    }
  };
}

function shopifyResult(
  result: ShopifySearchResult,
  context: { zipCode?: string | undefined; membershipIds?: string[] | undefined }
) {
  const exactCount = result.products.filter((product) => product.matchStatus === "EXACT").length;
  const similarCount = result.products.length - exactCount;
  const priceLimit = result.maxItemPriceCents === undefined
    ? ""
    : ` Maximum item price: USD ${(result.maxItemPriceCents / 100).toFixed(2)}.`;
  const comparison = result.comparison.status === "SAME_PRODUCT"
    ? ` Same-product comparison verified across ${result.comparison.merchantCount} merchants using ${result.comparison.evidence.join("; ")}.`
    : " No cross-merchant same-product identity was independently verified; results are discovery options, not like-for-like offers.";
  const summary = `Comparison status: ${result.comparison.status}. The audited Shopify registry returned ${result.products.length} product card(s): ${exactCount} exact and ${similarCount} similar, from ${result.merchantsSucceeded}/${result.merchantsQueried} stores.${priceLimit}${comparison} Prices are public item prices only; shipping, tax, mandatory fees, member price, delivered price, and verified coupons are unavailable without merchant evidence. Purchase actions use canonical merchant links because no affiliate relationship is approved.`;
  const products = result.products.map((product, index) => {
    const price = product.itemPrice === undefined
      ? "price unavailable"
      : `${product.itemPrice.currency} ${(product.itemPrice.amountCents / 100).toFixed(2)}`;
    const variants = Object.entries(product.variantDimensions)
      .map(([name, value]) => `${name}: ${value}`)
      .join(", ");
    return [
      `${index + 1}. [${product.matchStatus}] ${product.title}`,
      `merchant: ${product.merchant} (${product.sourceHost})`,
      `regular item price: ${price}`,
      "shipping: unavailable | tax: unavailable | mandatory fees: unavailable | member price: unavailable | delivered price unavailable",
      `availability: ${product.availability}`,
      `condition: ${product.condition}`,
      `match evidence: ${product.matchEvidence.join("; ")}`,
      ...(variants === "" ? [] : [`variants: ${variants}`]),
      `URL: ${product.merchantUrl}`
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
      source: "SHOPIFY_STOREFRONT_API" as const,
      priceScope: "ITEM_PRICE_ONLY" as const,
      pricingContext: {
        ...(context.zipCode === undefined ? {} : { zipCode: context.zipCode }),
        membershipIds: context.membershipIds ?? []
      },
      quality: {
        status: "PASS_WITH_LIMITATIONS" as const,
        cardsReturned: result.products.length,
        itemPricesVerified: result.products.filter((product) => product.itemPrice !== undefined).length,
        couponsVerified: 0,
        affiliateLinksApproved: 0,
        limitations: [
          "delivered price components are not verified",
          "coupon source is unavailable",
          "affiliate relationship is not approved"
        ]
      },
      coverage: result.coverage,
      merchantsQueried: result.merchantsQueried,
      merchantsSucceeded: result.merchantsSucceeded,
      ...(result.maxItemPriceCents === undefined ? {} : { maxItemPriceCents: result.maxItemPriceCents }),
      comparison: result.comparison,
      diagnostics: result.diagnostics,
      questions: result.questions,
      products: result.products.map((product) => ({
        ...product,
        pricing: {
          scope: "ITEM_PRICE_ONLY" as const,
          regularItemPrice: product.itemPrice === undefined
            ? { status: "UNAVAILABLE" as const, reason: "public item price was not returned" }
            : { status: "VERIFIED" as const, amount: product.itemPrice },
          memberPrice: { status: "UNAVAILABLE" as const, reason: "membership-specific price was not verified" },
          shipping: { status: "UNAVAILABLE" as const, reason: "ZIP-specific shipping was not verified" },
          tax: { status: "UNAVAILABLE" as const, reason: "ZIP-specific tax was not verified" },
          mandatoryFees: { status: "UNAVAILABLE" as const, reason: "mandatory fees were not verified" },
          deliveredPrice: { status: "UNAVAILABLE" as const, reason: "not all delivered-price components were verified" }
        },
        freshness: { status: "OBSERVED_AT_QUERY" as const, checkedAt: product.checkedAt },
        coupons: { status: "UNAVAILABLE" as const, verified: [] },
        purchaseLink: { kind: "CANONICAL" as const, url: product.merchantUrl },
        card: {
          title: product.title,
          merchant: product.merchant,
          ...(product.imageUrl === undefined ? {} : { imageUrl: product.imageUrl }),
          ...(product.itemPrice === undefined ? {} : { primaryPrice: product.itemPrice }),
          priceLabel: product.itemPrice === undefined ? "Item price unavailable" : "Verified item price",
          matchBadge: product.matchStatus,
          conditionBadge: product.condition,
          availability: product.availability,
          actionLabel: "View at merchant" as const
        }
      }))
    }
  };
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
      "affiliate relationship is not approved"
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
      source: "SHOPIFY_STOREFRONT_API" as const,
      priceScope: "ITEM_PRICE_ONLY" as const,
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
        irrelevantProductsExcluded: 0,
        conditionProductsExcluded: 0,
        priceProductsExcluded: 0,
        merchantsFailed: 0,
        coveragePercent: 0,
        failedMerchantIds: [],
        timedOutMerchantIds: [],
        registryVersion: "NOT_QUERIED",
        searchTimeoutMs: 0,
        selectionPolicy: selectionMode === "LOWEST_PRICE"
          ? "EXACT_THEN_SIMILAR_THEN_PRICE" as const
          : "EXACT_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE" as const
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
      source: "SHOPIFY_STOREFRONT_API" as const,
      priceScope: "ITEM_PRICE_ONLY" as const,
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
        irrelevantProductsExcluded: 0,
        conditionProductsExcluded: 0,
        priceProductsExcluded: 0,
        merchantsFailed: 0,
        coveragePercent: 0,
        failedMerchantIds: [],
        timedOutMerchantIds: [],
        registryVersion: "UNAVAILABLE",
        searchTimeoutMs: 0,
        selectionPolicy: selectionMode === "LOWEST_PRICE"
          ? "EXACT_THEN_SIMILAR_THEN_PRICE" as const
          : "EXACT_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE" as const
      },
      questions: [],
      products: []
    }
  };
}

export function createShoppingServer(
  comparePort: ComparePort,
  bestBuyPort: BestBuyPort = createUnavailableBestBuyPort(),
  shopifyPort: ShopifyPort = createUnavailableShopifyPort()
): McpServer {
  const server = new McpServer({ name: "findcheap-agent", version: "0.3.3" });

  server.registerResource(
    "findcheap-product-cards",
    PRODUCT_CARD_UI_URI,
    {
      title: "FindCheap verified product cards",
      description: "Interactive cards for the latest verified Shopify product results.",
      mimeType: "text/html;profile=mcp-app"
    },
    async () => ({
      contents: [{
        uri: PRODUCT_CARD_UI_URI,
        mimeType: "text/html;profile=mcp-app",
        text: PRODUCT_CARD_HTML,
        _meta: {
          ui: {
            prefersBorder: true,
            csp: {
              connectDomains: [],
              resourceDomains: PRODUCT_CARD_RESOURCE_DOMAINS
            }
          }
        }
      }]
    })
  );

  server.registerTool(
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
    "search_bestbuy_products",
    {
      title: "Search Best Buy products (Beta)",
      description: "Search the official Best Buy Products API by product query or numeric SKU. Returns item price only, not delivered price.",
      inputSchema: BestBuyProductsToolInputSchema,
      outputSchema: BestBuyProductsOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (input) => {
      const validatedInput = BestBuyProductsInputSchema.parse(input);
      try {
        const result = await bestBuyPort.search(validatedInput);
        return bestBuyResult(result.products);
      } catch {
        return bestBuyUnavailableResult();
      }
    }
  );

  server.registerTool(
    "search_shopify_products",
    {
      title: "Search Shopify products (Beta)",
      description: "Search a bounded audited Shopify Storefront registry by product query or handle. Do not call this tool more than once per user lookup. Set comparisonMode=SAME_PRODUCT for an explicit like-for-like request and DISCOVERY otherwise. Generic SAME_PRODUCT input returns NEEDS_CLARIFICATION before merchant calls. Pass an explicit budget through maxItemPriceCents as integer USD cents; keep price words and currency symbols out of query. Set selectionMode=LOWEST_PRICE only for explicit cheapest requests; otherwise set selectionMode=MERCHANT_DIVERSE. Cross-merchant offers are grouped only by exact GTIN plus variant or exact brand plus MPN/SKU plus variant; title similarity never proves the same product.",
      inputSchema: ShopifyProductsToolInputSchema,
      outputSchema: ShopifyProductsOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      },
      _meta: {
        ui: { resourceUri: PRODUCT_CARD_UI_URI },
        "openai/outputTemplate": PRODUCT_CARD_UI_URI,
        "openai/toolInvocation/invoking": "Searching verified stores…",
        "openai/toolInvocation/invoked": "Verified product cards ready."
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
        const result = await shopifyPort.search(validatedInput);
        return shopifyResult(result, {
          ...(validatedInput.zipCode === undefined ? {} : { zipCode: validatedInput.zipCode }),
          membershipIds: validatedInput.membershipIds ?? []
        });
      } catch {
        return shopifyUnavailableResult(validatedInput.selectionMode, validatedInput);
      }
    }
  );

  return server;
}
