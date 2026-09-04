import { describe, expect, it } from "vitest";
import {
  ProductComparisonInputSchema,
  buildProductComparison,
  type ComparableProduct,
  type ProductComparisonInput
} from "../src/product-comparison.js";

const selectionA = "11111111-1111-4111-8111-111111111111";
const selectionB = "22222222-2222-4222-8222-222222222222";
const selectionC = "33333333-3333-4333-8333-333333333333";
const selectionD = "44444444-4444-4444-8444-444444444444";
const selectionE = "55555555-5555-4555-8555-555555555555";

function product(overrides: Partial<ComparableProduct> = {}): ComparableProduct {
  return {
    selectionId: selectionA,
    title: "Valhalla Java Pods",
    merchant: "Official Store",
    merchantUrl: "https://merchant.example/product",
    purchaseLink: { url: "https://merchant.example/product" },
    brand: "Death Wish Coffee",
    sku: "5094SSC",
    gtins: ["810063341254"],
    variantDimensions: { "Pack Size": "10 count" },
    matchStatus: "EXACT",
    presentationGroup: "OFFICIAL_STORE",
    recommendationTier: "TRUSTED_OR_AFFILIATE",
    itemPrice: { amountCents: 1_499, currency: "USD" },
    pricing: {
      deliveredPrice: {
        status: "ESTIMATED",
        amount: { amountCents: 1_699, currency: "USD" },
        checkedAt: "2026-09-03T05:55:00.000Z",
        expiresAt: "2026-09-03T07:00:00.000Z"
      }
    },
    availability: "IN_STOCK",
    condition: "NEW",
    merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT" },
    coupons: { verified: [] },
    matchEvidence: ["GTIN exact"],
    featureEvidence: ["10 count"],
    preferenceEvidence: [],
    requiredFeatureLimitations: [],
    checkedAt: "2026-09-03T06:00:00.000Z",
    ...overrides
  };
}

const input: ProductComparisonInput = {
  selectionIds: [selectionA, selectionB],
  mode: "AUTO",
  focus: [],
  responseLocale: "en-US"
};

const identity = {
  comparisonId: "33333333-3333-4333-8333-333333333333",
  renderId: "44444444-4444-4444-8444-444444444444",
  expiresAt: "2026-09-03T08:00:00.000Z",
  evaluatedAt: "2026-09-03T06:00:00.000Z"
};

describe("deterministic product comparison", () => {
  it("accepts 2-4 unique selections and rejects boundary violations", () => {
    for (const selectionIds of [
      [selectionA, selectionB],
      [selectionA, selectionB, selectionC],
      [selectionA, selectionB, selectionC, selectionD]
    ]) {
      expect(ProductComparisonInputSchema.safeParse({ selectionIds }).success).toBe(true);
    }
    expect(ProductComparisonInputSchema.safeParse({
      selectionIds: [selectionA, selectionB],
      focus: ["PRICE", "REQUIREMENTS", "MERCHANT_TRUST"]
    }).success).toBe(true);
    expect(ProductComparisonInputSchema.safeParse({
      selectionIds: [selectionA, selectionB],
      focus: ["PRICE", "REQUIREMENTS", "MERCHANT_TRUST", "CONDITION"]
    }).success).toBe(false);
    for (const selectionIds of [
      [selectionA],
      [selectionA, selectionA],
      [selectionA, selectionB, selectionC, selectionD, selectionE]
    ]) {
      expect(ProductComparisonInputSchema.safeParse({ selectionIds }).success).toBe(false);
    }
  });

  it("compares verified same-product offers using one delivered-total basis", () => {
    const result = buildProductComparison(input, [
      product(),
      product({
        selectionId: selectionB,
        merchant: "Authorized Store",
        merchantTrust: { level: "AUTHORIZED_RETAILER", verification: "INDEPENDENT" },
        itemPrice: { amountCents: 1_399, currency: "USD" },
        pricing: { deliveredPrice: {
          status: "ESTIMATED",
          amount: { amountCents: 1_799, currency: "USD" },
          expiresAt: "2026-09-03T07:00:00.000Z"
        } }
      })
    ], identity);

    expect(result).toMatchObject({
      status: "OK",
      mode: "SAME_PRODUCT_OFFERS",
      priceBasis: "DELIVERED_TOTAL",
      priceDelta: {
        lowestSelectionId: selectionA,
        highestSelectionId: selectionB,
        amountCents: 100
      },
      recommendation: { state: "READY", recommendedSelectionId: selectionA }
    });
    expect(result.message).toContain("Delivered totals are quoted and comparable");
    expect(result.entries.every((entry) => entry.deliveredTotalStatus === "QUOTED")).toBe(true);
  });

  it("does not replace quoted delivered totals with an item-level Coupon estimate", () => {
    const result = buildProductComparison(input, [
      product({
        coupons: {
          verified: [{
            kind: "PROMO_CODE",
            title: "20% off",
            code: "ITEM20",
            discountPercent: 20,
            productApplicability: "PRODUCT_CONFIRMED",
            validTo: "2026-09-30T23:59:59.000Z"
          }],
          estimatedItemPriceAfterCoupon: { amountCents: 1_199, currency: "USD" }
        },
        pricing: { deliveredPrice: {
          status: "ESTIMATED",
          amount: { amountCents: 1_899, currency: "USD" },
          expiresAt: "2026-09-03T07:00:00.000Z"
        } }
      }),
      product({
        selectionId: selectionB,
        pricing: { deliveredPrice: {
          status: "ESTIMATED",
          amount: { amountCents: 1_699, currency: "USD" },
          expiresAt: "2026-09-03T07:00:00.000Z"
        } }
      })
    ], identity);

    expect(result.priceBasis).toBe("DELIVERED_TOTAL");
    expect(result.recommendation?.recommendedSelectionId).toBe(selectionB);
    expect(result.entries[0]?.verifiedDeals[0]?.productApplicability).toBe("PRODUCT_CONFIRMED");
  });

  it("fails closed when same-product identity is requested but not verified", () => {
    const result = buildProductComparison(
      { ...input, mode: "SAME_PRODUCT_OFFERS" },
      [product(), product({ selectionId: selectionB, sku: "OTHER", gtins: ["999"] })],
      identity
    );
    expect(result).toMatchObject({ status: "SAME_PRODUCT_IDENTITY_UNVERIFIED", entries: [] });
  });

  it("fails closed when stable identity matches but explicit variants conflict", () => {
    const result = buildProductComparison(
      { ...input, mode: "SAME_PRODUCT_OFFERS" },
      [product(), product({ selectionId: selectionB, variantDimensions: { "Pack Size": "20 count" } })],
      identity
    );
    expect(result).toMatchObject({ status: "SAME_PRODUCT_IDENTITY_UNVERIFIED", entries: [] });
  });

  it("marks price comparison unavailable when no complete common basis exists", () => {
    const deliveredOnly = product({
      selectionId: selectionB,
      sku: "OTHER",
      gtins: ["999"],
      pricing: { deliveredPrice: {
        status: "ESTIMATED",
        amount: { amountCents: 2_099, currency: "USD" },
        expiresAt: "2026-09-03T07:00:00.000Z"
      } }
    });
    delete deliveredOnly.itemPrice;
    const result = buildProductComparison(input, [
      product({ pricing: { deliveredPrice: { status: "UNAVAILABLE" } } }),
      deliveredOnly
    ], identity);
    expect(result).toMatchObject({ status: "OK", priceBasis: "UNAVAILABLE" });
    expect(result).not.toHaveProperty("priceDelta");
    expect(result.entries.every((entry) => entry.comparedPrice === undefined)).toBe(true);
  });

  it("labels unlike products as choices and never mixes price bases", () => {
    const result = buildProductComparison(input, [
      product({ pricing: { deliveredPrice: { status: "UNAVAILABLE" } } }),
      product({
        selectionId: selectionB,
        sku: "OTHER",
        gtins: ["999"],
        itemPrice: { amountCents: 1_899, currency: "USD" },
        condition: "UNKNOWN",
        pricing: { deliveredPrice: {
          status: "ESTIMATED",
          amount: { amountCents: 2_099, currency: "USD" },
          expiresAt: "2026-09-03T07:00:00.000Z"
        } }
      })
    ], identity);

    expect(result).toMatchObject({
      status: "OK",
      mode: "PRODUCT_CHOICES",
      priceBasis: "ITEM_PRICE",
      priceDelta: { amountCents: 400 }
    });
    expect(result.entries[1]?.unknowns).toContain("CONDITION");
  });

  it("distinguishes not-quoted totals from merchant-checkout-only totals", () => {
    const result = buildProductComparison(input, [
      product({
        pricing: { deliveredPrice: { status: "UNAVAILABLE" } },
        quoteCapability: "DELIVERED_TOTAL_SUPPORTED"
      }),
      product({
        selectionId: selectionB,
        sku: "OTHER",
        gtins: ["999"],
        pricing: { deliveredPrice: { status: "UNAVAILABLE" } },
        quoteCapability: "MERCHANT_CHECKOUT_ONLY"
      })
    ], identity);

    expect(result.entries.map((entry) => entry.deliveredTotalStatus)).toEqual([
      "NOT_QUOTED",
      "MERCHANT_CHECKOUT_ONLY"
    ]);
    expect(result.message).toContain("does not support quote retrieval");
  });

  it("refuses to recommend when every merchant is unverified", () => {
    const result = buildProductComparison(input, [
      product({ merchantTrust: { level: "UNKNOWN", verification: "UNVERIFIED" }, presentationGroup: "BEST_VALUE" }),
      product({
        selectionId: selectionB,
        merchantTrust: { level: "UNKNOWN", verification: "UNVERIFIED" },
        presentationGroup: "BEST_VALUE"
      })
    ], identity);
    expect(result.recommendation).toMatchObject({ state: "RESEARCH_ONLY" });
    expect(result.recommendation).not.toHaveProperty("recommendedSelectionId");
  });

  it("does not use partial prices or claim LOWER_PRICE without a common price basis", () => {
    const deliveredOnly = product({
      selectionId: selectionB,
      sku: "OTHER",
      gtins: ["999"],
      pricing: { deliveredPrice: {
        status: "ESTIMATED",
        amount: { amountCents: 500, currency: "USD" },
        expiresAt: "2026-09-03T07:00:00.000Z"
      } }
    });
    delete deliveredOnly.itemPrice;
    const result = buildProductComparison(input, [
      product({ itemPrice: { amountCents: 999, currency: "USD" }, pricing: { deliveredPrice: { status: "UNAVAILABLE" } } }),
      deliveredOnly
    ], identity);

    expect(result.priceBasis).toBe("UNAVAILABLE");
    expect(result.recommendation?.reasonCodes).not.toContain("LOWER_PRICE");
  });

  it("does not claim LOWER_PRICE when comparable prices are equal", () => {
    const result = buildProductComparison(input, [
      product(),
      product({ selectionId: selectionB })
    ], identity);

    expect(result.priceBasis).toBe("DELIVERED_TOTAL");
    expect(result.recommendation?.reasonCodes).not.toContain("LOWER_PRICE");
  });

  it("does not use an expired delivered total", () => {
    const result = buildProductComparison(input, [
      product({ pricing: { deliveredPrice: {
        status: "ESTIMATED",
        amount: { amountCents: 999, currency: "USD" },
        expiresAt: "2026-09-03T05:59:59.000Z"
      } } }),
      product({
        selectionId: selectionB,
        pricing: { deliveredPrice: {
          status: "ESTIMATED",
          amount: { amountCents: 1_099, currency: "USD" },
          expiresAt: "2026-09-03T07:00:00.000Z"
        } }
      })
    ], identity);

    expect(result.priceBasis).toBe("ITEM_PRICE");
    expect(result.entries[0]).not.toHaveProperty("deliveredTotal");
    expect(result.entries[1]).toHaveProperty("deliveredTotalExpiresAt", "2026-09-03T07:00:00.000Z");
  });

  it("does not classify unlike conditions as same-product offers", () => {
    const products = [product(), product({ selectionId: selectionB, condition: "USED" })];
    expect(buildProductComparison(input, products, identity).mode).toBe("PRODUCT_CHOICES");
    expect(buildProductComparison({ ...input, mode: "SAME_PRODUCT_OFFERS" }, products, identity))
      .toMatchObject({ status: "SAME_PRODUCT_IDENTITY_UNVERIFIED" });
  });

  it("keeps recommendation independent from affiliate link form", () => {
    const products = [
      product({ purchaseLink: { url: "https://affiliate.example/a" } }),
      product({ selectionId: selectionB, itemPrice: { amountCents: 1_599, currency: "USD" } })
    ];
    const affiliate = buildProductComparison(input, products, identity);
    const canonical = buildProductComparison(input, [
      { ...products[0]!, purchaseLink: { url: "https://merchant.example/a" } },
      products[1]!
    ], identity);
    expect(affiliate.recommendation).toEqual(canonical.recommendation);
  });
});
