import { describe, expect, it } from "vitest";
import { ComparisonOfferSchema } from "../../contracts/src/index.js";
import { rankExactOffers } from "../src/index.js";

type OfferInput = {
  id: string;
  match?: "EXACT" | "NEEDS_CONFIRMATION" | "SIMILAR" | "INSUFFICIENT";
  regularTotal?: number;
  memberTotal?: number;
  memberEligible?: boolean;
  memberProgramId?: string;
  checkedAt?: string;
};

const offer = (input: OfferInput) => {
  const checkedAt = input.checkedAt ?? "2026-08-13T12:00:00.000Z";
  const quote = (quoteId: string, amountCents: number) => ({
    quoteId,
    offerId: input.id,
    status: "VERIFIED" as const,
    deliveredPrice: { currency: "USD", amountCents },
    lineItems: [],
    eligibilityConditions: [],
    evidenceRefs: ["https://merchant.example/evidence"],
    checkedAt,
    expiresAt: "2026-08-13T12:15:00.000Z"
  });
  const regularQuote = quote(`${input.id}-regular`, input.regularTotal ?? 1000);
  const memberQuote = input.memberTotal === undefined
    ? undefined
    : {
        programId: input.memberProgramId ?? "club",
        programName: "Club",
        eligible: input.memberEligible ?? true,
        quote: quote(`${input.id}-member`, input.memberTotal)
      };

  return ComparisonOfferSchema.parse({
    offerId: input.id,
    merchantId: `merchant-${input.id}`,
    sellerName: `Seller ${input.id}`,
    matchStatus: input.match ?? "EXACT",
    regularQuote,
    ...(memberQuote ? { memberQuote } : {}),
    rankingQuote: memberQuote?.eligible ? memberQuote.quote : regularQuote,
    merchantUrl: `https://merchant.example/${input.id}`,
    recommendationReasons: []
  });
};

describe("rankExactOffers", () => {
  it("excludes similar and unqualified member prices", () => {
    const ranked = rankExactOffers([
      offer({ id: "similar", match: "SIMILAR", regularTotal: 500 }),
      offer({ id: "member-preview", regularTotal: 900, memberTotal: 600, memberEligible: false }),
      offer({ id: "regular", regularTotal: 700 })
    ], { memberships: [] });

    expect(ranked.map((item) => item.offerId)).toEqual(["regular", "member-preview"]);
    expect(ranked[1]?.rankingQuote.deliveredPrice.amountCents).toBe(900);
    expect(ranked[1]?.memberQuote?.quote.deliveredPrice.amountCents).toBe(600);
  });

  it("uses an eligible member quote only when its program is in context without mutating input", () => {
    const member = offer({ id: "member", regularTotal: 900, memberTotal: 600, memberProgramId: "club" });
    const offers = [member];
    const original = structuredClone(offers);

    const withoutMembership = rankExactOffers(offers, { memberships: [] });
    const withMembership = rankExactOffers(offers, { memberships: ["club"] });

    expect(withoutMembership[0]?.rankingQuote.deliveredPrice.amountCents).toBe(900);
    expect(withoutMembership[0]?.memberQuote?.eligible).toBe(true);
    expect(withMembership[0]?.rankingQuote.deliveredPrice.amountCents).toBe(600);
    expect(withMembership[0]?.memberQuote?.eligible).toBe(true);
    expect(withoutMembership[0]).not.toBe(member);
    expect(offers).toEqual(original);
  });

  it("breaks equal delivered-price ties by selected quote freshness", () => {
    const ranked = rankExactOffers([
      offer({ id: "older", regularTotal: 700, checkedAt: "2026-08-13T12:00:00.000Z" }),
      offer({ id: "newer", regularTotal: 700, checkedAt: "2026-08-13T12:05:00.000Z" })
    ], { memberships: [] });

    expect(ranked.map((item) => item.offerId)).toEqual(["newer", "older"]);
  });

  it("breaks equal price and freshness ties by offer ID code units", () => {
    const ranked = rankExactOffers([
      offer({ id: "z", regularTotal: 700 }),
      offer({ id: "A", regularTotal: 700 })
    ], { memberships: [] });

    expect(ranked.map((item) => item.offerId)).toEqual(["A", "z"]);
  });

  it("has no commission input", () => {
    expect(rankExactOffers.length).toBe(2);
  });
});
