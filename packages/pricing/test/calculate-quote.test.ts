import { describe, expect, it } from "vitest";
import {
  calculatePriceOptions,
  type CouponEligibilityRule,
  type QuoteInput,
  type UserPriceContext
} from "../src/index.js";

const identity = {
  quoteId: "quote-1",
  offerId: "offer-1",
  checkedAt: "2026-08-13T12:00:00.000Z",
  expiresAt: "2026-08-13T12:15:00.000Z",
  evidenceRefs: ["https://merchant.example/offers/1"],
  taxVerified: true,
  shippingVerified: true
};

type OfferParts = {
  item?: number;
  shipping?: number;
  tax?: number;
  fee?: number;
  taxVerified?: boolean;
  shippingVerified?: boolean;
  coupon?: {
    cents: number;
    verified?: boolean;
    eligibility?: CouponEligibilityRule[];
    stackingPolicy?: "STACKABLE_WITH_MEMBERSHIP" | "NOT_STACKABLE_WITH_MEMBERSHIP";
  };
};

const offer = (parts: OfferParts = {}): QuoteInput => ({
  ...identity,
  itemPriceCents: parts.item ?? 1000,
  shippingCents: parts.shipping ?? 0,
  taxCents: parts.tax ?? 0,
  mandatoryFeeCents: parts.fee ?? 0,
  taxVerified: parts.taxVerified ?? identity.taxVerified,
  shippingVerified: parts.shippingVerified ?? identity.shippingVerified,
  ...(parts.coupon
    ? {
        coupon: {
          amountCents: parts.coupon.cents,
          verificationStatus: parts.coupon.verified === false ? "UNVERIFIED" : "VERIFIED",
          eligibility: parts.coupon.eligibility ?? [],
          stackingPolicy: parts.coupon.stackingPolicy ?? "STACKABLE_WITH_MEMBERSHIP"
        }
      }
    : {})
});

const offerWithMemberDiscount = (itemPriceCents: number, amountCents: number): QuoteInput => ({
  ...offer({ item: itemPriceCents }),
  membershipDiscount: { programId: "costco", programName: "Costco", amountCents }
});

const user = (overrides: Partial<UserPriceContext> = {}): UserPriceContext => ({
  memberships: [],
  isFirstOrder: false,
  hasSubscription: false,
  paymentMethods: [],
  ...overrides
});

describe("calculatePriceOptions", () => {
  it("uses member discount only when the user already has membership", () => {
    const eligible = calculatePriceOptions(
      offerWithMemberDiscount(1000, 200),
      user({ memberships: ["costco"] })
    );
    const ineligible = calculatePriceOptions(offerWithMemberDiscount(1000, 200), user());

    expect(eligible.regularQuote.deliveredPrice.amountCents).toBe(1000);
    expect(eligible.memberQuote?.quote.deliveredPrice.amountCents).toBe(800);
    expect(eligible.rankingQuote.deliveredPrice.amountCents).toBe(800);
    expect(ineligible.memberQuote?.quote.deliveredPrice.amountCents).toBe(800);
    expect(ineligible.memberQuote?.eligible).toBe(false);
    expect(ineligible.rankingQuote.deliveredPrice.amountCents).toBe(1000);
  });

  it("does not count an unverified coupon", () => {
    const prices = calculatePriceOptions(offer({ item: 1000, coupon: { cents: 100, verified: false } }), user());

    expect(prices.rankingQuote.deliveredPrice.amountCents).toBe(1000);
    expect(prices.rankingQuote.lineItems.map((line) => line.kind)).not.toContain("COUPON");
  });

  it.each([
    [{ item: 1000, shipping: 100, tax: 80, fee: 20 }, 1200, "VERIFIED"],
    [{ item: 1000, shipping: 0, tax: 70, fee: 0, taxVerified: false }, 1070, "ESTIMATED"]
  ])("calculates item, shipping, tax, and mandatory fee", (parts, total, status) => {
    const prices = calculatePriceOptions(offer(parts), user());

    expect([prices.rankingQuote.deliveredPrice.amountCents, prices.rankingQuote.status]).toEqual([
      total,
      status
    ]);
  });

  it("applies a verified coupon only when every explicit condition is satisfied", () => {
    const prices = calculatePriceOptions(
      offer({
        coupon: {
          cents: 100,
          eligibility: [{ type: "PAYMENT_METHOD", paymentMethod: "visa" }]
        }
      }),
      user({ paymentMethods: ["mastercard"] })
    );

    expect(prices.rankingQuote.deliveredPrice.amountCents).toBe(1000);
    expect(prices.rankingQuote.eligibilityConditions).toContain("Requires payment method: visa");
  });

  it("rejects fractional cents and negative delivered totals at the public boundary", () => {
    expect(() =>
      calculatePriceOptions({ ...offer(), itemPriceCents: 1000.5 }, user())
    ).toThrow();
    expect(() =>
      calculatePriceOptions(offerWithMemberDiscount(100, 200), user({ memberships: ["costco"] }))
    ).toThrow();
  });

  it("stacks an eligible coupon with a membership discount when explicitly allowed", () => {
    const prices = calculatePriceOptions(
      {
        ...offerWithMemberDiscount(1000, 200),
        coupon: {
          amountCents: 100,
          verificationStatus: "VERIFIED",
          eligibility: [],
          stackingPolicy: "STACKABLE_WITH_MEMBERSHIP"
        }
      },
      user({ memberships: ["costco"] })
    );

    expect(prices.regularQuote.deliveredPrice.amountCents).toBe(900);
    expect(prices.memberQuote?.quote.deliveredPrice.amountCents).toBe(700);
    expect(prices.memberQuote?.quote.lineItems.map((item) => item.kind)).toEqual([
      "ITEM",
      "MEMBERSHIP",
      "COUPON",
      "SHIPPING",
      "TAX",
      "MANDATORY_FEE"
    ]);
    expect(Number.isInteger(prices.memberQuote?.quote.deliveredPrice.amountCents)).toBe(true);
  });

  it.each([
    [300, 200, "COUPON", 700],
    [100, 200, "MEMBERSHIP", 800]
  ] as const)(
    "selects the better %s discount when coupon and membership cannot stack",
    (couponCents, membershipCents, selectedKind, expectedTotal) => {
      const prices = calculatePriceOptions(
        {
          ...offerWithMemberDiscount(1000, membershipCents),
          coupon: {
            amountCents: couponCents,
            verificationStatus: "VERIFIED",
            eligibility: [],
            stackingPolicy: "NOT_STACKABLE_WITH_MEMBERSHIP"
          }
        },
        user({ memberships: ["costco"] })
      );

      const member = prices.memberQuote?.quote;
      expect(prices.regularQuote.deliveredPrice.amountCents).toBe(1000 - couponCents);
      expect(member?.deliveredPrice.amountCents).toBe(expectedTotal);
      expect(member?.lineItems.filter((item) => ["COUPON", "MEMBERSHIP"].includes(item.kind))).toHaveLength(1);
      expect(member?.lineItems.find((item) => item.kind === selectedKind)?.condition).toMatch(/does not stack/i);
      expect(member?.eligibilityConditions.join(" ")).toMatch(/does not stack/i);
      expect(Number.isInteger(member?.deliveredPrice.amountCents)).toBe(true);
    }
  );
});
