import { z } from "zod";
import {
  CouponStackingPolicySchema,
  PriceQuoteSchema,
  type PriceQuote
} from "../../contracts/src/index.js";
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
        eligibility: z.array(CouponEligibilityRuleSchema),
        stackingPolicy: CouponStackingPolicySchema
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

const line = (
  kind: "ITEM" | "COUPON" | "MEMBERSHIP" | "SHIPPING" | "TAX" | "MANDATORY_FEE",
  amountCents: number,
  condition?: string
) => ({
  kind,
  amount: { amountCents, currency: "USD" as const },
  label: kind,
  ...(condition ? { condition } : {})
});

type DiscountSelection = {
  coupon: boolean;
  membership: boolean;
  stackingCondition?: string;
};

function selectDiscounts(
  input: QuoteInput,
  user: UserPriceContext,
  includeMemberDiscount: boolean
): DiscountSelection {
  const couponEligible = Boolean(
    input.coupon?.verificationStatus === "VERIFIED" &&
      input.coupon.eligibility.every((rule) => ruleSatisfied(rule, user))
  );
  if (!includeMemberDiscount || !input.membershipDiscount) {
    return { coupon: couponEligible, membership: false };
  }
  if (
    !couponEligible ||
    !input.coupon ||
    input.coupon?.stackingPolicy === "STACKABLE_WITH_MEMBERSHIP"
  ) {
    return { coupon: couponEligible, membership: true };
  }

  const couponWins = input.coupon.amountCents > input.membershipDiscount.amountCents;
  return {
    coupon: couponWins,
    membership: !couponWins,
    stackingCondition: couponWins
      ? "Coupon does not stack with membership; coupon discount selected"
      : "Coupon does not stack with membership; membership discount selected"
  };
}

function collectConditions(input: QuoteInput, selection: DiscountSelection): string[] {
  return [
    ...(selection.membership && input.membershipDiscount
      ? [`Requires membership: ${input.membershipDiscount.programName}`]
      : []),
    ...(input.coupon ? input.coupon.eligibility.map(describeRule) : []),
    ...(selection.stackingCondition ? [selection.stackingCondition] : [])
  ];
}

function composeQuote(input: QuoteInput, user: UserPriceContext, includeMemberDiscount: boolean): PriceQuote {
  const selection = selectDiscounts(input, user, includeMemberDiscount);
  const lines = [
    line("ITEM", input.itemPriceCents),
    ...(selection.membership && input.membershipDiscount
      ? [line("MEMBERSHIP", -input.membershipDiscount.amountCents, selection.stackingCondition)]
      : []),
    ...(selection.coupon && input.coupon
      ? [line("COUPON", -input.coupon.amountCents, selection.stackingCondition)]
      : []),
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
    eligibilityConditions: collectConditions(input, selection),
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
