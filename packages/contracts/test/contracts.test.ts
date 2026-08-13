import { describe, expect, it } from "vitest";
import {
  ComparisonOfferSchema,
  ComparisonResultSchema,
  MerchantOfferSchema,
  MoneySchema,
  PriceQuoteSchema
} from "../src/index.js";

const quote = (quoteId: string) => ({
  quoteId,
  offerId: "o1",
  status: "ESTIMATED" as const,
  deliveredPrice: { amountCents: 1000, currency: "USD" as const },
  lineItems: [],
  eligibilityConditions: [],
  evidenceRefs: [],
  checkedAt: "2026-08-13T12:00:00.000Z",
  expiresAt: "2026-08-13T12:15:00.000Z"
});

const comparisonOffer = (matchStatus: "EXACT" | "SIMILAR") => {
  const regularQuote = quote("regular");

  return {
    offerId: "o1",
    merchantId: "m1",
    sellerName: "Merchant",
    matchStatus,
    regularQuote,
    rankingQuote: regularQuote,
    merchantUrl: "https://merchant.example/products/1",
    recommendationReasons: []
  };
};

describe("commerce contracts", () => {
  it("rejects fractional cents", () => {
    expect(() => MoneySchema.parse({ amountCents: 10.5, currency: "USD" })).toThrow();
  });

  it("rejects non-USD money and unknown money fields", () => {
    expect(() => MoneySchema.parse({ amountCents: 1000, currency: "CAD" })).toThrow();
    expect(() =>
      MoneySchema.parse({ amountCents: 1000, currency: "USD", display: "$10.00" })
    ).toThrow();
  });

  it("requires evidence for a verified quote", () => {
    expect(() =>
      PriceQuoteSchema.parse({
        quoteId: "q1",
        offerId: "o1",
        status: "VERIFIED",
        deliveredPrice: { amountCents: 1000, currency: "USD" },
        lineItems: [],
        eligibilityConditions: [],
        evidenceRefs: [],
        checkedAt: "2026-08-13T12:00:00.000Z",
        expiresAt: "2026-08-13T12:15:00.000Z"
      })
    ).toThrow();
  });

  it("requires a quote expiry after its UTC check timestamp", () => {
    expect(() =>
      PriceQuoteSchema.parse({
        quoteId: "q1",
        offerId: "o1",
        status: "ESTIMATED",
        deliveredPrice: { amountCents: 1000, currency: "USD" },
        lineItems: [],
        eligibilityConditions: [],
        evidenceRefs: [],
        checkedAt: "2026-08-13T12:00:00.000Z",
        expiresAt: "2026-08-13T12:00:00.000Z"
      })
    ).toThrow();
  });

  it("requires public comparison offers to carry regular and ranking quotes", () => {
    expect(() =>
      ComparisonOfferSchema.parse({
        offerId: "o1",
        merchantId: "m1",
        sellerName: "Merchant",
        matchStatus: "EXACT",
        merchantUrl: "https://merchant.example/products/1",
        recommendationReasons: []
      })
    ).toThrow();
  });

  it("rejects similar offers from exact-offer ranking", () => {
    expect(() =>
      ComparisonResultSchema.parse({
        productId: "p1",
        exactOffers: [comparisonOffer("SIMILAR")],
        similarOffers: [],
        questions: []
      })
    ).toThrow();
  });

  it("rejects an ineligible member quote selected for ranking", () => {
    const regularQuote = quote("regular");
    const memberQuote = quote("member");

    expect(() =>
      ComparisonOfferSchema.parse({
        ...comparisonOffer("EXACT"),
        regularQuote,
        memberQuote: {
          programId: "club",
          programName: "Club",
          eligible: false,
          quote: memberQuote
        },
        rankingQuote: memberQuote
      })
    ).toThrow();
  });

  it("rejects an exact offer without deterministic match evidence", () => {
    expect(() =>
      MerchantOfferSchema.parse({
        offerId: "o1",
        merchantId: "m1",
        merchantProductId: "sku1",
        sellerName: "Merchant",
        condition: "NEW",
        matchStatus: "EXACT",
        inventoryStatus: "IN_STOCK",
        merchantUrl: "https://merchant.example/products/1",
        evidenceRefs: ["https://merchant.example/products/1"],
        checkedAt: "2026-08-13T12:00:00.000Z",
        expiresAt: "2026-08-13T12:15:00.000Z"
      })
    ).toThrow();
    expect(() =>
      MerchantOfferSchema.parse({
        offerId: "o1",
        merchantId: "m1",
        merchantProductId: "sku1",
        sellerName: "Merchant",
        condition: "NEW",
        matchStatus: "EXACT",
        inventoryStatus: "IN_STOCK",
        merchantUrl: "https://merchant.example/products/1",
        evidenceRefs: ["https://merchant.example/products/1"],
        matchEvidence: [{ type: "SEMANTIC", source: "LLM", confidence: 0.99 }],
        checkedAt: "2026-08-13T12:00:00.000Z",
        expiresAt: "2026-08-13T12:15:00.000Z"
      })
    ).toThrow();
  });

  it("accepts non-exact offers without match evidence", () => {
    for (const matchStatus of ["SIMILAR", "NEEDS_CONFIRMATION", "INSUFFICIENT"] as const) {
      expect(() =>
        MerchantOfferSchema.parse({
          offerId: `o-${matchStatus}`,
          merchantId: "m1",
          merchantProductId: "sku1",
          sellerName: "Merchant",
          condition: "NEW",
          matchStatus,
          inventoryStatus: "IN_STOCK",
          merchantUrl: "https://merchant.example/products/1",
          evidenceRefs: ["https://merchant.example/products/1"],
          checkedAt: "2026-08-13T12:00:00.000Z",
          expiresAt: "2026-08-13T12:15:00.000Z"
        })
      ).not.toThrow();
    }
  });

  it("accepts status-scoped comparison rankings and deterministic exact evidence", () => {
    const regularQuote = quote("regular");
    const memberQuote = quote("member");

    expect(() =>
      ComparisonResultSchema.parse({
        productId: "p1",
        exactOffers: [comparisonOffer("EXACT")],
        similarOffers: [comparisonOffer("SIMILAR")],
        questions: []
      })
    ).not.toThrow();
    expect(() =>
      ComparisonOfferSchema.parse({
        ...comparisonOffer("EXACT"),
        regularQuote,
        memberQuote: {
          programId: "club",
          programName: "Club",
          eligible: true,
          quote: memberQuote
        },
        rankingQuote: memberQuote
      })
    ).not.toThrow();
    expect(() =>
      MerchantOfferSchema.parse({
        offerId: "o1",
        merchantId: "m1",
        merchantProductId: "sku1",
        sellerName: "Merchant",
        condition: "NEW",
        matchStatus: "EXACT",
        inventoryStatus: "IN_STOCK",
        merchantUrl: "https://merchant.example/products/1",
        evidenceRefs: ["https://merchant.example/products/1"],
        matchEvidence: [
          { type: "GTIN", gtin: "12345678", source: "MERCHANT_PAGE" }
        ],
        checkedAt: "2026-08-13T12:00:00.000Z",
        expiresAt: "2026-08-13T12:15:00.000Z"
      })
    ).not.toThrow();
    expect(() =>
      MerchantOfferSchema.parse({
        offerId: "o2",
        merchantId: "m1",
        merchantProductId: "sku2",
        sellerName: "Merchant",
        condition: "NEW",
        matchStatus: "SIMILAR",
        inventoryStatus: "IN_STOCK",
        merchantUrl: "https://merchant.example/products/2",
        evidenceRefs: ["https://merchant.example/products/2"],
        matchEvidence: [{ type: "SEMANTIC", source: "LLM", confidence: 0.99 }],
        checkedAt: "2026-08-13T12:00:00.000Z",
        expiresAt: "2026-08-13T12:15:00.000Z"
      })
    ).not.toThrow();
  });
});
