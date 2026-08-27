import { describe, expect, it, vi } from "vitest";
import { researchSelectedProductDeal } from "../src/deal-concierge.js";

const current = new Date("2026-08-26T12:00:00.000Z");
const selected = {
  merchant: "Merchant",
  availability: "IN_STOCK" as const,
  itemPrice: { amountCents: 9_999, currency: "USD" as const },
  checkedAt: "2026-08-26T11:58:00.000Z",
  quoteCapability: "MERCHANT_CHECKOUT_ONLY" as const
};

describe("current selected-product deal research", () => {
  it("returns current price without making a price-history request", async () => {
    const search = vi.fn(async () => []);
    const result = await researchSelectedProductDeal({
      selected,
      membershipIds: [],
      dealPort: { search },
      now: current
    });

    expect(search).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      dealStatus: "NO_CURRENT_DEAL",
      currentPrice: { basis: "ITEM_PRICE", amount: { amountCents: 9_999 } },
      quoteStatus: "NOT_REQUESTED",
      deals: []
    });
    expect(JSON.stringify(result)).not.toMatch(/history|cadence|BUY_NOW|WAIT/u);
  });

  it("keeps current verified deals bounded by merchant and time", async () => {
    const deal = {
      dealId: "deal-1",
      merchant: "Merchant",
      kind: "PROMO_CODE" as const,
      title: "10% off selected items",
      description: "Selected items only",
      code: "SAVE10",
      discountPercent: 10,
      eligibility: ["Selected items"],
      channels: ["ONLINE" as const],
      sourceUrl: "https://merchant.example/deals",
      checkedAt: "2026-08-26T11:55:00.000Z",
      validFrom: "2026-08-26T00:00:00.000Z",
      validTo: "2026-08-27T00:00:00.000Z",
      verificationStatus: "VERIFIED" as const
    };
    const result = await researchSelectedProductDeal({
      selected,
      membershipIds: [],
      dealPort: { search: async () => [deal, { ...deal, dealId: "other", merchant: "Other" }] },
      now: current
    });

    expect(result.dealStatus).toBe("CURRENT_DEAL_FOUND");
    expect(result.deals).toEqual([expect.objectContaining({
      dealId: "deal-1",
      applicability: "REQUIRES_MERCHANT_CONFIRMATION"
    })]);
    expect(result.limitations.join(" ")).toContain("stacking require merchant confirmation");
  });
});
