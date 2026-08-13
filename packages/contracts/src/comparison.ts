import { z } from "zod";
import { MatchStatusSchema, PriceQuoteSchema } from "./offer.js";

const MemberQuoteSchema = z
  .object({
    programId: z.string(),
    programName: z.string(),
    eligible: z.boolean(),
    quote: PriceQuoteSchema
  })
  .strict();

export const ComparisonOfferSchema = z
  .object({
    offerId: z.string(),
    merchantId: z.string(),
    sellerName: z.string(),
    matchStatus: MatchStatusSchema,
    regularQuote: PriceQuoteSchema,
    memberQuote: MemberQuoteSchema.optional(),
    rankingQuote: PriceQuoteSchema,
    affiliateUrl: z.string().url().optional(),
    merchantUrl: z.string().url(),
    recommendationReasons: z.array(z.string())
  })
  .strict();

export const ComparisonResultSchema = z
  .object({
    productId: z.string(),
    exactOffers: z.array(ComparisonOfferSchema),
    similarOffers: z.array(ComparisonOfferSchema),
    questions: z.array(z.string())
  })
  .strict();

export type ComparisonResult = z.infer<typeof ComparisonResultSchema>;
