import { describe, expect, it } from "vitest";
import { evaluateDealConcierge, type PriceHistoryObservation } from "../src/deal-concierge.js";

const observations = (amounts: number[]): PriceHistoryObservation[] => amounts.map((amountCents, index) => ({
  amountCents,
  currency: "USD",
  basis: "ITEM_PRICE",
  observedAt: `2026-08-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`
}));

describe("Deal Concierge decision evidence", () => {
  it("recommends BUY_NOW only when the current price is near the observed low", () => {
    const result = evaluateDealConcierge({
      availability: "IN_STOCK",
      currentPriceCents: 8_100,
      basis: "ITEM_PRICE",
      observations: observations([8_000, 9_000, 9_500, 10_000, 10_500, 11_000]),
      deals: []
    });

    expect(result).toMatchObject({
      recommendation: "BUY_NOW",
      confidence: "MEDIUM",
      watchSuggested: false,
      history: { status: "AVAILABLE", sampleCount: 6, historicalLowCents: 8_000, typicalMedianCents: 9_750 }
    });
  });

  it("recommends WAIT only when the current price is clearly above the observed median", () => {
    const result = evaluateDealConcierge({
      availability: "IN_STOCK",
      currentPriceCents: 13_000,
      basis: "ITEM_PRICE",
      observations: observations([8_000, 9_000, 9_500, 10_000, 10_500, 11_000]),
      deals: []
    });

    expect(result).toMatchObject({ recommendation: "WAIT", confidence: "MEDIUM", watchSuggested: true });
  });

  it("uses WATCH with low confidence when price history is unavailable", () => {
    const result = evaluateDealConcierge({
      availability: "IN_STOCK",
      currentPriceCents: 9_999,
      basis: "ITEM_PRICE",
      historyUnavailable: true,
      deals: []
    });

    expect(result).toMatchObject({
      recommendation: "WATCH",
      confidence: "LOW",
      history: { status: "UNAVAILABLE", sampleCount: 0 }
    });
    expect(result.limitations.join(" ")).toContain("no historical claim");
  });

  it("labels verified merchant deals as requiring product confirmation", () => {
    const result = evaluateDealConcierge({
      availability: "IN_STOCK",
      currentPriceCents: 9_999,
      basis: "ITEM_PRICE",
      historyUnavailable: true,
      deals: [{
        dealId: "deal-1",
        merchant: "Merchant",
        kind: "PROMO_CODE",
        title: "10% off selected items",
        description: "Selected items only",
        code: "SAVE10",
        discountPercent: 10,
        eligibility: ["Selected items"],
        channels: ["ONLINE"],
        sourceUrl: "https://merchant.example/deals",
        checkedAt: "2026-08-26T12:00:00.000Z",
        validFrom: "2026-08-26T00:00:00.000Z",
        validTo: "2026-08-27T00:00:00.000Z",
        verificationStatus: "VERIFIED"
      }]
    });

    expect(result.deals[0]).toMatchObject({ applicability: "REQUIRES_MERCHANT_CONFIRMATION" });
    expect(result.limitations.join(" ")).toContain("stacking require merchant confirmation");
  });
});
