import { describe, expect, it } from "vitest";
import { assessSelectedProductDeal, rankAssessedDeals } from "../src/deal-assessment.js";
import type { VerifiedDeal } from "../src/deal-client.js";

const product = { merchantProductId: "wig-1", productType: "wig", title: "Short human hair wig", itemPrice: { amountCents: 3_641, currency: "USD" as const } };
const deal: VerifiedDeal = {
  dealId: "sitewide", merchant: "Ishow Hair", kind: "PROMO_CODE", code: "IS18",
  title: "18% off sitewide", description: "18% off all orders", productApplicability: "MERCHANT_WIDE",
  eligibility: [], channels: ["ONLINE"], sourceUrl: "https://merchant.example/deals",
  checkedAt: "2026-09-04T12:00:00.000Z", validFrom: "2026-09-01T00:00:00.000Z",
  validTo: "2026-10-01T00:00:00.000Z", verificationStatus: "VERIFIED"
};

describe("selected product deal assessment", () => {
  it("keeps merchant-wide evidence conditional and selects only a relevant candidate", () => {
    const assessed = [
      { ...deal, dealId: "minimum", title: "$40 off orders over $199", description: "Spend $199 to save $40" },
      { ...deal, dealId: "wholesale", title: "30% off wholesale orders", description: "Wholesale only" },
      { ...deal, dealId: "bundles", title: "20% off hair bundles only", description: "Hair bundles only" },
      deal
    ].map((value) => ({ ...value, assessment: assessSelectedProductDeal(value, product) }));
    expect(assessed[0]?.assessment).toMatchObject({ status: "INELIGIBLE", reasonCodes: ["MINIMUM_SPEND_NOT_MET"], recommendationEligible: false });
    expect(assessed[1]?.assessment.recommendationEligible).toBe(false);
    expect(assessed[2]?.assessment).toMatchObject({ status: "INELIGIBLE", reasonCodes: ["PRODUCT_SCOPE_MISMATCH"] });
    expect(assessed[3]?.assessment).toMatchObject({ status: "CONDITIONAL", recommendationEligible: true });
    expect(rankAssessedDeals(assessed)[0]?.dealId).toBe("sitewide");
  });

  it("does not choose conflicting headline and terms or unknown customer eligibility", () => {
    expect(assessSelectedProductDeal({ ...deal, title: "$88 off", description: "$58 off orders over $385" }, product))
      .toMatchObject({ status: "UNKNOWN", reasonCodes: ["TERMS_CONFLICT"], recommendationEligible: false });
    expect(assessSelectedProductDeal({ ...deal, title: "15% off for new customers", description: "New customers only" }, product))
      .toMatchObject({ status: "CONDITIONAL", reasonCodes: ["CUSTOMER_ELIGIBILITY_UNCONFIRMED"], recommendationEligible: false });
  });

  it("requires stable ID and satisfied terms for confirmation", () => {
    const confirmed = { ...deal, productApplicability: "PRODUCT_CONFIRMED" as const, applicableProductIds: ["wig-1"], discountPercent: 18 };
    expect(assessSelectedProductDeal(confirmed, product)).toMatchObject({ status: "CONFIRMED", recommendationEligible: true });
    expect(assessSelectedProductDeal(confirmed, { ...product, merchantProductId: "other" }).status).toBe("INELIGIBLE");
    expect(assessSelectedProductDeal({ ...confirmed, eligibility: ["Selected styles only"] }, product).status).toBe("UNKNOWN");
  });

  it("does not let a confirmed product ID override explicit description restrictions", () => {
    const confirmed = { ...deal, title: "50% off", productApplicability: "PRODUCT_CONFIRMED" as const, applicableProductIds: ["wig-1"], discountPercent: 50 };
    expect(assessSelectedProductDeal({ ...confirmed, description: "For hair bundles only" }, product))
      .toMatchObject({ status: "INELIGIBLE", reasonCodes: ["PRODUCT_SCOPE_MISMATCH"], recommendationEligible: false });
    for (const description of ["Selected styles only", "Excludes discounted items", "Minimum order requirement applies"]) {
      expect(assessSelectedProductDeal({ ...confirmed, description }, product), description)
        .toMatchObject({ status: "UNKNOWN", recommendationEligible: false });
    }
  });

  it("does not mistake an unrelated product mention for an offer restriction", () => {
    const confirmed = { ...deal, title: "18% off this item", productApplicability: "PRODUCT_CONFIRMED" as const, applicableProductIds: ["wig-1"], discountPercent: 18 };
    expect(assessSelectedProductDeal({ ...confirmed, description: "This wig pairs well with hair bundles." }, product))
      .toMatchObject({ status: "CONFIRMED", recommendationEligible: true });
    expect(assessSelectedProductDeal({ ...confirmed, description: "This item only" }, product))
      .toMatchObject({ status: "CONFIRMED", recommendationEligible: true });
  });

  it.each(["Orders $100+", "Orders USD100+", "USD100+", "orders of $100 or more", "Orders USD 100 and above"])(
    "does not confirm a twenty dollar product below the order threshold (%#)", (description) => {
      const confirmed = { ...deal, title: "75% off", description, productApplicability: "PRODUCT_CONFIRMED" as const, applicableProductIds: ["wig-1"], discountPercent: 75 };
      expect(assessSelectedProductDeal(confirmed, { ...product, itemPrice: { amountCents: 2_000, currency: "USD" } }))
        .toMatchObject({ status: "INELIGIBLE", reasonCodes: ["MINIMUM_SPEND_NOT_MET"], recommendationEligible: false });
    }
  );

  it("keeps an obvious but unsupported monetary order condition unconfirmed", () => {
    const confirmed = { ...deal, title: "75% off", description: "Orders $100 using cart subtotal", productApplicability: "PRODUCT_CONFIRMED" as const, applicableProductIds: ["wig-1"], discountPercent: 75 };
    for (const description of ["Orders $100 using cart subtotal", "$100 or more orders", "USD100 qualifying cart subtotal"]) {
      expect(assessSelectedProductDeal({ ...confirmed, description }, product), description)
        .toMatchObject({ status: "UNKNOWN", recommendationEligible: false });
    }
    expect(assessSelectedProductDeal({ ...confirmed, description: "This item only" }, product))
      .toMatchObject({ status: "CONFIRMED", recommendationEligible: true });
    expect(assessSelectedProductDeal({ ...confirmed, title: "$5 off", description: "All orders, $5 off" }, product))
      .toMatchObject({ status: "CONFIRMED", recommendationEligible: true });
  });
});
