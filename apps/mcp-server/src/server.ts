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
  query: z.string().trim().min(2).max(300).optional(),
  handle: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(200).optional(),
  limit: z.number().int().min(1).max(3).default(3),
  selectionMode: z.enum(["LOWEST_PRICE", "MERCHANT_DIVERSE"])
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
  imageUrl: z.string().url().optional(),
  itemPrice: MoneyOutputSchema.optional(),
  availability: z.enum(["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"]),
  merchantUrl: z.string().url(),
  checkedAt: z.string()
});

const ShopifyProductsOutputShape = {
  status: z.enum(["OK", "DATA_SOURCE_UNAVAILABLE"]),
  message: z.string(),
  source: z.literal("SHOPIFY_STOREFRONT_API"),
  priceScope: z.literal("ITEM_PRICE_ONLY"),
  coverage: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]),
  merchantsQueried: z.number().int(),
  merchantsSucceeded: z.number().int(),
  diagnostics: z.object({
    apiDurationMs: z.number().int().nonnegative(),
    cacheStatus: z.enum(["MISS", "HIT", "COALESCED"]),
    chromeFallbackEligible: z.boolean(),
    irrelevantProductsExcluded: z.number().int().nonnegative(),
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

function shopifyResult(result: ShopifySearchResult) {
  const exactCount = result.products.filter((product) => product.matchStatus === "EXACT").length;
  const similarCount = result.products.length - exactCount;
  const message = `The audited Shopify registry returned ${result.products.length} product(s): ${exactCount} exact and ${similarCount} similar, from ${result.merchantsSucceeded}/${result.merchantsQueried} stores. Prices are public item prices only; shipping, tax, coupons, and member pricing are not included.`;
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: {
      status: "OK" as const,
      message,
      source: "SHOPIFY_STOREFRONT_API" as const,
      priceScope: "ITEM_PRICE_ONLY" as const,
      coverage: result.coverage,
      merchantsQueried: result.merchantsQueried,
      merchantsSucceeded: result.merchantsSucceeded,
      diagnostics: result.diagnostics,
      questions: result.questions,
      products: result.products
    }
  };
}

function shopifyUnavailableResult(selectionMode: "LOWEST_PRICE" | "MERCHANT_DIVERSE") {
  return {
    content: [{ type: "text" as const, text: shopifyUnavailableMessage }],
    structuredContent: {
      status: "DATA_SOURCE_UNAVAILABLE" as const,
      message: shopifyUnavailableMessage,
      source: "SHOPIFY_STOREFRONT_API" as const,
      priceScope: "ITEM_PRICE_ONLY" as const,
      coverage: "UNAVAILABLE" as const,
      merchantsQueried: 0,
      merchantsSucceeded: 0,
      diagnostics: {
        apiDurationMs: 0,
        cacheStatus: "MISS" as const,
        chromeFallbackEligible: false,
        irrelevantProductsExcluded: 0,
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
  const server = new McpServer({ name: "findcheap-agent", version: "0.2.2" });

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
      description: "Search a bounded audited Shopify Storefront registry by product query or handle. Requires Top 3 ranking intent: literal lowest price or merchant-diverse recommendations. Returns coverage diagnostics; exact matches rank before labeled similar products and irrelevant products are excluded.",
      inputSchema: ShopifyProductsToolInputSchema,
      outputSchema: ShopifyProductsOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (input) => {
      const validatedInput = ShopifyProductsInputSchema.parse(input);
      try {
        const result = await shopifyPort.search(validatedInput);
        return shopifyResult(result);
      } catch {
        return shopifyUnavailableResult(validatedInput.selectionMode);
      }
    }
  );

  return server;
}
