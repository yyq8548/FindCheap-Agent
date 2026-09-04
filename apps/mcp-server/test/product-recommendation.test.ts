import { describe, expect, it } from "vitest";
import {
  choosePrimaryRecommendation,
  highVarianceClarification
} from "../src/product-recommendation.js";
import { SearchProductsInputSchema } from "../src/search-products.js";

describe("product recommendation", () => {
  it.each([
    ["en-US", "Apple MacBook Pro", "laptop computer", "maximum budget, main use, and preferred screen size"],
    ["zh-CN", "想买一台笔记本电脑", "笔记本电脑", "预算上限、主要用途和偏好的屏幕尺寸"]
  ] as const)("asks the same bounded laptop question in %s", (responseLocale, query, productType, expected) => {
    const input = SearchProductsInputSchema.parse({
      query,
      productType,
      comparisonMode: "DISCOVERY",
      contextMode: "NEW_PRODUCT",
      responseLocale
    });

    expect(highVarianceClarification(input)).toMatchObject({
      question: expect.stringContaining(expected),
      evidence: "high-variance laptop discovery lacks budget, use, size"
    });
  });

  it("does not treat an unrelated preference as the primary use", () => {
    const input = SearchProductsInputSchema.parse({
      query: "lightweight laptop",
      productType: "laptop computer",
      preferences: ["blue"],
      maxItemPriceCents: 150_000,
      preferredSize: "14 inch",
      comparisonMode: "DISCOVERY"
    });

    expect(highVarianceClarification(input)?.evidence).toBe("high-variance laptop discovery lacks use");
  });

  it("allows high-variance discovery after explicit decision constraints", () => {
    const input = SearchProductsInputSchema.parse({
      query: "Apple MacBook Pro",
      productType: "laptop computer",
      maxItemPriceCents: 250_000,
      primaryUse: "software development",
      preferredSize: "14 inch",
      comparisonMode: "DISCOVERY"
    });

    expect(highVarianceClarification(input)).toBeUndefined();
  });

  it("lets an exact trusted match beat a weaker official match", () => {
    const decision = choosePrimaryRecommendation([
      product({
        title: "Official discovery result",
        matchStatus: "DISCOVERY_MATCH",
        presentationGroup: "OFFICIAL_STORE",
        price: 190_000
      }),
      product({
        title: "Trusted exact result",
        matchStatus: "EXACT",
        presentationGroup: "TRUSTED_MATCH",
        price: 200_000
      })
    ]);

    expect(decision).toMatchObject({
      state: "READY",
      primaryProductIndex: 1,
      reasonCodes: ["EXACT_MATCH", "TRUSTED_MERCHANT"]
    });
  });

  it("selects the lower price when fit and trust are equal", () => {
    const decision = choosePrimaryRecommendation([
      product({ title: "Official expensive", presentationGroup: "OFFICIAL_STORE", price: 220_000 }),
      product({ title: "Trusted cheaper", presentationGroup: "TRUSTED_MATCH", price: 190_000 })
    ]);

    expect(decision).toMatchObject({
      state: "READY",
      primaryProductIndex: 1,
      reasonCodes: ["EXACT_MATCH", "TRUSTED_MERCHANT", "LOWER_PRICE"]
    });
  });

  it("does not claim a lower price when equal-fit products have the same price", () => {
    const decision = choosePrimaryRecommendation([
      product({ title: "Same price A", presentationGroup: "OFFICIAL_STORE", price: 190_000 }),
      product({ title: "Same price B", presentationGroup: "TRUSTED_MATCH", price: 190_000 })
    ]);

    expect(decision.reasonCodes).not.toContain("LOWER_PRICE");
  });

  it("uses only a product-confirmed after-Coupon price for the primary recommendation", () => {
    const decision = choosePrimaryRecommendation([
      product({ title: "Lower raw price", presentationGroup: "OFFICIAL_STORE", price: 100_000 }),
      product({
        title: "Confirmed lower net price",
        presentationGroup: "TRUSTED_MATCH",
        price: 120_000,
        coupon: { productApplicability: "PRODUCT_CONFIRMED", estimatedPrice: 96_000 }
      })
    ]);

    expect(decision).toMatchObject({
      state: "READY",
      primaryProductIndex: 1,
      reasonCodes: ["EXACT_MATCH", "TRUSTED_MERCHANT", "LOWER_PRICE"]
    });
  });

  it("never recommends an independently unverified merchant", () => {
    const decision = choosePrimaryRecommendation([
      product({
        title: "Highly rated but unverified",
        presentationGroup: "TRUSTED_MATCH",
        merchantVerified: false,
        recommendationTier: "HIGH_RATED_UNVERIFIED",
        price: 100_000
      })
    ]);

    expect(decision).toEqual({ state: "RESEARCH_ONLY", reasonCodes: [] });
  });

  it("never recommends a product with an unresolved required feature", () => {
    const decision = choosePrimaryRecommendation([
      product({
        title: "Lower-priced unresolved match",
        presentationGroup: "TRUSTED_MATCH",
        price: 100_000,
        requiredFeatureLimitations: ["dandruff control"]
      }),
      product({
        title: "Verified required-feature match",
        presentationGroup: "OFFICIAL_STORE",
        price: 120_000
      })
    ]);

    expect(decision).toMatchObject({ state: "READY", primaryProductIndex: 1 });
    expect(choosePrimaryRecommendation([
      product({
        title: "Only unresolved match",
        presentationGroup: "TRUSTED_MATCH",
        price: 100_000,
        requiredFeatureLimitations: ["dandruff control"]
      })
    ])).toEqual({ state: "RESEARCH_ONLY", reasonCodes: [] });
  });

  it("keeps primary choice unchanged when trusted products move between all three display groups", () => {
    for (const group of ["OFFICIAL_STORE", "TRUSTED_MATCH", "BEST_VALUE"] as const) {
      const decision = choosePrimaryRecommendation([
        product({ title: "Expensive", presentationGroup: "OFFICIAL_STORE", price: 2_000 }),
        { ...product({ title: "Best fit cheaper", presentationGroup: "TRUSTED_MATCH", price: 1_000 }), presentationGroup: group }
      ]);
      expect(decision).toMatchObject({ state: "READY", primaryProductIndex: 1 });
    }
  });

  it("does not treat equal evidence counts for different needs as equivalent fit", () => {
    const decision = choosePrimaryRecommendation([
      { ...product({ title: "Short human hair", presentationGroup: "TRUSTED_MATCH", price: 1_000 }),
        featureEvidence: ["human hair", "short finger waves"], preferenceEvidence: [] },
      { ...product({ title: "Long synthetic hair", presentationGroup: "TRUSTED_MATCH", price: 2_000 }),
        featureEvidence: ["synthetic fiber", "28 inch long"], preferenceEvidence: [] }
    ]);
    expect(decision.reasonCodes).not.toContain("LOWER_PRICE");
  });

  it.each(["RISKY", "UNKNOWN"] as const)("does not promote contradictory independently verified %s merchants", (level) => {
    const decision = choosePrimaryRecommendation([{
      ...product({ title: "Conflicted merchant", presentationGroup: "TRUSTED_MATCH", price: 100 }),
      merchantTrust: { level, verification: "INDEPENDENT" as const }
    }]);
    expect(decision).toEqual({ state: "RESEARCH_ONLY", reasonCodes: [] });
  });

  it("does not use a merchant-wide coupon estimate as a confirmed product price", () => {
    const decision = choosePrimaryRecommendation([
      product({ title: "Lower raw price", presentationGroup: "TRUSTED_MATCH", price: 1_000 }),
      product({ title: "Unconfirmed coupon", presentationGroup: "TRUSTED_MATCH", price: 2_000,
        coupon: { productApplicability: "MERCHANT_WIDE", estimatedPrice: 500 } })
    ]);
    expect(decision.primaryProductIndex).toBe(0);
  });
});

function product(options: {
  title: string;
  price: number;
  matchStatus?: "EXACT" | "DISCOVERY_MATCH";
  presentationGroup: "OFFICIAL_STORE" | "TRUSTED_MATCH";
  merchantVerified?: boolean;
  recommendationTier?: "TRUSTED_OR_AFFILIATE" | "HIGH_RATED_UNVERIFIED";
  requiredFeatureLimitations?: string[];
  coupon?: {
    productApplicability: "PRODUCT_CONFIRMED" | "MERCHANT_WIDE";
    estimatedPrice?: number;
  };
}) {
  return {
    title: options.title,
    matchStatus: options.matchStatus ?? "EXACT",
    presentationGroup: options.presentationGroup,
    recommendationTier: options.recommendationTier ?? "TRUSTED_OR_AFFILIATE",
    merchantTrust: { verification: options.merchantVerified === false ? "UNVERIFIED" as const : "INDEPENDENT" as const },
    availability: "IN_STOCK" as const,
    featureEvidence: ["product family matched"],
    preferenceEvidence: ["use matched"],
    requiredFeatureLimitations: options.requiredFeatureLimitations ?? [],
    matchEvidence: ["identity evidence"],
    itemPrice: { amountCents: options.price, currency: "USD" as const },
    coupons: options.coupon === undefined
      ? { verified: [] }
      : {
          verified: [{ title: "Coupon", productApplicability: options.coupon.productApplicability }],
          ...(options.coupon.estimatedPrice === undefined
            ? {}
            : { estimatedItemPriceAfterCoupon: { amountCents: options.coupon.estimatedPrice } })
        }
  };
}
