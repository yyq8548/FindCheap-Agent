import { describe, expect, it } from "vitest";
import {
  ComparisonOfferSchema,
  MoneySchema,
  PriceQuoteSchema
} from "../src/index.js";

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
});
