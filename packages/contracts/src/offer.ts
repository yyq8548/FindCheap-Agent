import { z } from "zod";
import { MoneySchema } from "./money.js";
import { HttpsUrlSchema } from "./url.js";

export const MatchStatusSchema = z.enum([
  "EXACT",
  "NEEDS_CONFIRMATION",
  "SIMILAR",
  "INSUFFICIENT"
]);
export const QuoteStatusSchema = z.enum(["VERIFIED", "ESTIMATED", "CONDITIONAL"]);
export const CouponStackingPolicySchema = z.enum([
  "STACKABLE_WITH_MEMBERSHIP",
  "NOT_STACKABLE_WITH_MEMBERSHIP"
]);
export type CouponStackingPolicy = z.infer<typeof CouponStackingPolicySchema>;

const UtcTimestampSchema = z.string().datetime();

export const MatchEvidenceSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("GTIN"),
      gtin: z.string().regex(/^\d{8,14}$/),
      source: z.enum(["MERCHANT_PAGE", "MANUFACTURER_PAGE", "RETAILER_FEED"])
    })
    .strict(),
  z
    .object({
      type: z.literal("BRAND_MPN"),
      brand: z.string().min(1),
      manufacturerPartNumber: z.string().min(1),
      source: z.enum(["MERCHANT_PAGE", "MANUFACTURER_PAGE", "RETAILER_FEED"])
    })
    .strict(),
  z
    .object({
      type: z.literal("SEMANTIC"),
      source: z.enum(["LLM", "EMBEDDING"]),
      confidence: z.number().min(0).max(1)
    })
    .strict()
]);

export const PriceLineItemSchema = z
  .object({
    kind: z.enum(["ITEM", "COUPON", "MEMBERSHIP", "SHIPPING", "TAX", "MANDATORY_FEE"]),
    amount: MoneySchema,
    label: z.string().min(1),
    condition: z.string().min(1).optional()
  })
  .strict();

export const PriceQuoteSchema = z
  .object({
    quoteId: z.string().min(1),
    offerId: z.string().min(1),
    status: QuoteStatusSchema,
    deliveredPrice: MoneySchema,
    lineItems: z.array(PriceLineItemSchema),
    eligibilityConditions: z.array(z.string()),
    evidenceRefs: z.array(z.string()),
    checkedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema
  })
  .strict()
  .superRefine((quote, ctx) => {
    if (quote.status === "VERIFIED" && quote.evidenceRefs.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["evidenceRefs"],
        message: "verified quote requires evidence"
      });
    }
    if (Date.parse(quote.expiresAt) <= Date.parse(quote.checkedAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "expiresAt must be after checkedAt"
      });
    }
  });

export type PriceQuote = z.infer<typeof PriceQuoteSchema>;

export const MerchantOfferSchema = z
  .object({
    offerId: z.string().min(1),
    merchantId: z.string().min(1),
    merchantProductId: z.string().min(1),
    productId: z.string().min(1).optional(),
    sellerName: z.string().min(1),
    condition: z.enum(["NEW", "REFURBISHED", "USED"]),
    matchStatus: MatchStatusSchema,
    inventoryStatus: z.enum(["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"]),
    merchantUrl: HttpsUrlSchema,
    evidenceRefs: z.array(z.string()).min(1),
    matchEvidence: z.array(MatchEvidenceSchema).default([]),
    checkedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema
  })
  .strict()
  .superRefine((offer, ctx) => {
    if (
      offer.matchStatus === "EXACT" &&
      !offer.matchEvidence.some(
        (evidence) => evidence.type === "GTIN" || evidence.type === "BRAND_MPN"
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["matchEvidence"],
        message: "exact offer requires GTIN or BRAND_MPN match evidence"
      });
    }
    if (Date.parse(offer.expiresAt) <= Date.parse(offer.checkedAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "expiresAt must be after checkedAt"
      });
    }
  });

export type MerchantOffer = z.infer<typeof MerchantOfferSchema>;
