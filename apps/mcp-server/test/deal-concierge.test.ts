import { describe, expect, it, vi } from "vitest";
import { researchSelectedProductDeal } from "../src/deal-concierge.js";

const current = new Date("2026-08-26T12:00:00.000Z");
const selected = {
  merchantProductId: "sku-1",
  merchant: "Merchant",
  availability: "IN_STOCK" as const,
  itemPrice: { amountCents: 9_999, currency: "USD" as const },
  checkedAt: "2026-08-26T11:58:00.000Z",
  quoteCapability: "MERCHANT_CHECKOUT_ONLY" as const
};

const sitewide = {
  dealId: "sitewide", merchant: "Merchant", kind: "PROMO_CODE" as const, code: "IS18",
  title: "18% off sitewide", description: "18% off all orders", productApplicability: "MERCHANT_WIDE" as const,
  eligibility: [], channels: ["ONLINE" as const], sourceUrl: "https://merchant.example/deals",
  checkedAt: "2026-08-26T11:55:00.000Z", validFrom: "2026-08-26T00:00:00.000Z",
  validTo: "2026-08-27T00:00:00.000Z", verificationStatus: "VERIFIED" as const
};

describe("current selected-product deal research", () => {
  it("provides a server-selected merchant candidate without promoting unrelated offers", async () => {
    const search = vi.fn(async () => [
      { ...sitewide, dealId: "minimum", title: "$40 off orders over $199", description: "Spend $199 to save $40" },
      { ...sitewide, dealId: "wholesale", title: "30% off wholesale", description: "Wholesale only" },
      { ...sitewide, dealId: "bundles", title: "20% off hair bundles only", description: "Hair bundles only" },
      sitewide
    ]);
    const result = await researchSelectedProductDeal({
      selected: { ...selected, title: "Short human hair wig", productType: "wig", itemPrice: { amountCents: 3_641, currency: "USD" } },
      membershipIds: [], dealPort: { search }, now: current
    });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ productQuery: "Short human hair wig" }));
    expect(result.dealSummary).toMatchObject({ status: "MERCHANT_CANDIDATE", recommendedDealId: "sitewide" });
    expect(result.deals[0]).toMatchObject({ dealId: "sitewide", applicability: "REQUIRES_MERCHANT_CONFIRMATION" });
    expect(result.currentPrice?.amount.amountCents).toBe(3_641);
  });

  it.each(["timeout", "429", "malformed response"])("does not report no coupon when provider fails: %s", async (message) => {
    const result = await researchSelectedProductDeal({ selected, membershipIds: [], dealPort: { search: async () => { throw new Error(message); } }, now: current });
    expect(result).toMatchObject({ dealLookupStatus: "UNAVAILABLE", dealStatus: "DEAL_LOOKUP_UNAVAILABLE", dealSummary: { status: "UNAVAILABLE" } });
    expect(result.limitations.join(" ")).not.toContain("No current verified merchant deal was found");
  });

  it("marks an entirely damaged response unavailable instead of no deal", async () => {
    const result = await researchSelectedProductDeal({ selected, membershipIds: [], dealPort: { search: async () => [null] as never }, now: current });
    expect(result).toMatchObject({ dealLookupStatus: "UNAVAILABLE", dealLookupReasonCodes: ["INVALID_RESPONSE"] });
  });

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
    const partial = await researchSelectedProductDeal({
      selected, membershipIds: [], now: current,
      dealPort: { search: async () => [deal, null] as never }
    });
    expect(partial).toMatchObject({ dealLookupStatus: "PARTIAL", dealLookupReasonCodes: ["INVALID_RESPONSE"] });
    expect(partial.deals).toHaveLength(1);
    expect(partial.limitations.join(" ")).toContain("may be incomplete");
    const stale = await researchSelectedProductDeal({
      selected, membershipIds: [], now: current,
      dealPort: { search: async () => [{ ...deal, checkedAt: "2026-08-24T11:55:00.000Z" }] }
    });
    expect(stale).toMatchObject({ dealLookupStatus: "UNAVAILABLE", dealLookupReasonCodes: ["STALE_EVIDENCE"], dealStatus: "DEAL_LOOKUP_UNAVAILABLE" });
  });

  it("keeps product-confirmed deals bound to the selected stable ID", async () => {
    const deal = {
      dealId: "deal-1",
      merchant: "Merchant",
      kind: "PROMO_CODE" as const,
      title: "20% off this item",
      description: "This item only",
      code: "ITEM20",
      discountPercent: 20,
      productApplicability: "PRODUCT_CONFIRMED" as const,
      applicableProductIds: ["sku-1"],
      eligibility: [],
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
      dealPort: { search: async () => [deal, {
        ...deal,
        dealId: "other-product",
        applicableProductIds: ["sku-2"]
      }] },
      now: current
    });

    expect(result.deals).toEqual([expect.objectContaining({
      dealId: "deal-1",
      applicability: "PRODUCT_CONFIRMED"
    })]);
    expect(result.limitations.join(" ")).toContain("confirmed for this selected product");
  });
});
