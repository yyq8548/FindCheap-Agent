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
  .strict()
  .superRefine((offer, ctx) => {
    const quotesEqual = (left: unknown, right: unknown) =>
      JSON.stringify(left) === JSON.stringify(right);
    const allowedRankingQuotes = [
      offer.regularQuote,
      ...(offer.memberQuote?.eligible ? [offer.memberQuote.quote] : [])
    ];

    if (!allowedRankingQuotes.some((quote) => quotesEqual(offer.rankingQuote, quote))) {
      ctx.addIssue({
        code: "custom",
        path: ["rankingQuote"],
        message: "rankingQuote must use the regular quote or an eligible member quote"
      });
    }
  });

export const ComparisonResultSchema = z
  .object({
    productId: z.string(),
    exactOffers: z.array(ComparisonOfferSchema),
    similarOffers: z.array(ComparisonOfferSchema),
    questions: z.array(z.string())
  })
  .strict()
  .superRefine((result, ctx) => {
    result.exactOffers.forEach((offer, index) => {
      if (offer.matchStatus !== "EXACT") {
        ctx.addIssue({
          code: "custom",
          path: ["exactOffers", index, "matchStatus"],
          message: "exactOffers require EXACT match status"
        });
      }
    });
    result.similarOffers.forEach((offer, index) => {
      if (offer.matchStatus !== "SIMILAR") {
        ctx.addIssue({
          code: "custom",
          path: ["similarOffers", index, "matchStatus"],
          message: "similarOffers require SIMILAR match status"
        });
      }
    });
  });

export type ComparisonResult = z.infer<typeof ComparisonResultSchema>;
