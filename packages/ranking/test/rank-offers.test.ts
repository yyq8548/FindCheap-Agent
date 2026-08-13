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

    const ranked = rankExactOffers(offers, { memberships: [] });

    expect(ranked[0]?.rankingQuote.deliveredPrice.amountCents).toBe(900);
    expect(offers[0]?.rankingQuote.deliveredPrice.amountCents).toBe(600);
    expect(ranked[0]).not.toBe(member);
    expect(ComparisonOfferSchema.parse(ranked[0])).toEqual(ranked[0]);
    expect(ranked[0]?.rankingQuote.status).toBe("VERIFIED");
    expect(ranked[0]?.memberQuote?.eligible).toBe(false);
    expect(ranked[0]?.memberQuote?.quote).toEqual(member.memberQuote?.quote);
    expect(member.memberQuote?.eligible).toBe(true);
  });

  it("breaks equal delivered-price ties by selected quote freshness", () => {
    const ranked = rankExactOffers([
      offer({ id: "older", regularTotal: 700, checkedAt: "2026-08-13T12:00:00.000Z" }),
      offer({ id: "newer", regularTotal: 700, checkedAt: "2026-08-13T12:05:00.000Z" })
    ], { memberships: [] });

    expect(ranked.map((item) => item.offerId)).toEqual(["newer", "older"]);
  });

  it("has no commission input", () => {
    expect(rankExactOffers.length).toBe(2);
  });
});
