import { z } from "zod";
import { PriceQuoteSchema, type PriceQuote } from "../../contracts/src/index.js";
import {
  CouponEligibilityRuleSchema,
  UserPriceContextSchema,
  describeRule,
  ruleSatisfied,
  type UserPriceContext
} from "./coupon-eligibility.js";

const cents = z.number().int().nonnegative();

export const QuoteInputSchema = z
  .object({
    quoteId: z.string().min(1),
    offerId: z.string().min(1),
    itemPriceCents: cents,
    shippingCents: cents,
    taxCents: cents,
    mandatoryFeeCents: cents,
    taxVerified: z.boolean(),
    shippingVerified: z.boolean(),
    evidenceRefs: z.array(z.string().min(1)),
    checkedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    membershipDiscount: z
      .object({ programId: z.string().min(1), programName: z.string().min(1), amountCents: cents })
      .strict()
      .optional(),
    coupon: z
      .object({
        amountCents: cents,
        verificationStatus: z.enum(["VERIFIED", "UNVERIFIED", "EXPIRED"]),
        eligibility: z.array(CouponEligibilityRuleSchema)
      })
      .strict()
      .optional()
  })
  .strict();

export type QuoteInput = z.infer<typeof QuoteInputSchema>;

export type PriceOptions = {
  regularQuote: PriceQuote;
  memberQuote?: { programId: string; programName: string; eligible: boolean; quote: PriceQuote };
  rankingQuote: PriceQuote;
};

const line = (kind: "ITEM" | "COUPON" | "MEMBERSHIP" | "SHIPPING" | "TAX" | "MANDATORY_FEE", amountCents: number) => ({
  kind,
  amount: { amountCents, currency: "USD" as const },
  label: kind
});

function collectConditions(input: QuoteInput, includeMemberDiscount: boolean): string[] {
  return [
    ...(includeMemberDiscount && input.membershipDiscount
      ? [`Requires membership: ${input.membershipDiscount.programName}`]
      : []),
    ...(input.coupon ? input.coupon.eligibility.map(describeRule) : [])
  ];
}

function composeQuote(input: QuoteInput, user: UserPriceContext, includeMemberDiscount: boolean): PriceQuote {
  const couponEligible =
    input.coupon?.verificationStatus === "VERIFIED" &&
    input.coupon.eligibility.every((rule) => ruleSatisfied(rule, user));
  const lines = [
    line("ITEM", input.itemPriceCents),
    ...(includeMemberDiscount && input.membershipDiscount
      ? [line("MEMBERSHIP", -input.membershipDiscount.amountCents)]
      : []),
    ...(couponEligible && input.coupon ? [line("COUPON", -input.coupon.amountCents)] : []),
    line("SHIPPING", input.shippingCents),
    line("TAX", input.taxCents),
    line("MANDATORY_FEE", input.mandatoryFeeCents)
  ];
  const deliveredPriceCents = lines.reduce((sum, item) => sum + item.amount.amountCents, 0);
  if (deliveredPriceCents < 0) {
    throw new RangeError("delivered price cannot be negative");
  }

  return PriceQuoteSchema.parse({
    quoteId: input.quoteId,
    offerId: input.offerId,
    lineItems: lines,
    deliveredPrice: { amountCents: deliveredPriceCents, currency: "USD" },
    status:
      input.taxVerified && input.shippingVerified && input.evidenceRefs.length > 0
        ? "VERIFIED"
        : "ESTIMATED",
    eligibilityConditions: collectConditions(input, includeMemberDiscount),
    evidenceRefs: input.evidenceRefs,
    checkedAt: input.checkedAt,
    expiresAt: input.expiresAt
  });
}

export function calculatePriceOptions(input: QuoteInput, user: UserPriceContext): PriceOptions {
  const parsedInput = QuoteInputSchema.parse(input);
  const parsedUser = UserPriceContextSchema.parse(user);
  const regularQuote = composeQuote(parsedInput, parsedUser, false);
  if (!parsedInput.membershipDiscount) return { regularQuote, rankingQuote: regularQuote };

  const eligible = parsedUser.memberships.includes(parsedInput.membershipDiscount.programId);
  const memberQuote = {
    programId: parsedInput.membershipDiscount.programId,
    programName: parsedInput.membershipDiscount.programName,
    eligible,
    quote: composeQuote(parsedInput, parsedUser, true)
  };
  return { regularQuote, memberQuote, rankingQuote: eligible ? memberQuote.quote : regularQuote };
}
