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

export type { BestBuyPort } from "./bestbuy-client.js";

const unavailableMessage =
  "Live comparison is unavailable because no approved shopping data source is connected.";
const bestBuyUnavailableMessage =
  "Best Buy live product data is unavailable because BEST_BUY_API_KEY is not configured or the official API request failed.";

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

export const BestBuyProductsInputSchema = z
  .object({
    query: z.string().trim().min(2).max(300).optional(),
    sku: z.string().regex(/^\d{1,20}$/u).optional(),
    limit: z.number().int().min(1).max(50).default(10)
  })
  .strict()
  .refine((input) => (input.query === undefined) !== (input.sku === undefined), {
    message: "Provide exactly one of query or sku"
  });

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

export function createShoppingServer(
  comparePort: ComparePort,
  bestBuyPort: BestBuyPort = createUnavailableBestBuyPort()
): McpServer {
  const server = new McpServer({ name: "findcheap-agent", version: "0.1.0" });

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
      inputSchema: BestBuyProductsInputSchema,
      outputSchema: BestBuyProductsOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (input) => {
      try {
        const result = await bestBuyPort.search(input);
        return bestBuyResult(result.products);
      } catch {
        return bestBuyUnavailableResult();
      }
    }
  );

  return server;
}
