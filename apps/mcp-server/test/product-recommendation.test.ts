import { describe, expect, it } from "vitest";
import {
  choosePrimaryRecommendation,
  highVarianceClarification
} from "../src/product-recommendation.js";
import { SearchProductsInputSchema } from "../src/search-products.js";

describe("product recommendation", () => {
  it.each([
    ["2026-09-05T12:00:00.001Z", 0],
    ["2026-09-05T12:00:00.000Z", 1],
    ["2026-09-05T11:59:59.999Z", 1],
    [undefined, 1],
    ["not-a-date", 1]
  ])("evaluates coupon expiry once against the supplied time (%s)", (validTo, expectedIndex) => {
    const discounted = product({ title: "With coupon", presentationGroup: "TRUSTED_MATCH", price: 2000,
      coupon: { productApplicability: "PRODUCT_CONFIRMED", estimatedPrice: 100 } });
    const result = choosePrimaryRecommendation([
      { ...discounted, coupons: { ...discounted.coupons, verified: discounted.coupons.verified.map(offer => ({ ...offer, validTo })) } },
      product({ title: "Ordinary", presentationGroup: "TRUSTED_MATCH", price: 1000 })
    ], Date.parse("2026-09-05T12:00:00Z"));
    expect(result.primaryProductIndex).toBe(expectedIndex);
  });
  it("does not assign an expired coupon's cached price to a different active coupon", () => {
    const discounted = product({ title: "With coupon", presentationGroup: "TRUSTED_MATCH", price: 2000,
      coupon: { productApplicability: "PRODUCT_CONFIRMED", estimatedPrice: 100 } });
    const offer = discounted.coupons.verified[0]!;
    const result = choosePrimaryRecommendation([
      { ...discounted, coupons: { ...discounted.coupons, verified: [{ ...offer, validTo: "2026-09-05T11:00:00Z" },
        { ...offer, validTo: "2026-09-06T12:00:00Z" }] } },
      product({ title: "Ordinary", presentationGroup: "TRUSTED_MATCH", price: 1000 })
    ], Date.parse("2026-09-05T12:00:00Z"));
    expect(result.primaryProductIndex).toBe(1);
  });
  it.each(["EV charging station", "Tesla EV charger", "Tesla 充电桩"])("asks one compatibility question before recommending %s", query => {
    const input = SearchProductsInputSchema.parse({ query, productType: "EV charging station", comparisonMode: "DISCOVERY", responseLocale: "zh-CN" });
    expect(highVarianceClarification(input)).toMatchObject({ question: expect.stringContaining("使用国家或地区"),
      evidence: "EV charger compatibility lacks region, vehicle/connector, complete charger/kit" });
  });
  it("accepts explicit charger compatibility and leaves accessory searches alone", () => {
    const input = SearchProductsInputSchema.parse({ query: "EV charger", productType: "EV charging station", comparisonMode: "DISCOVERY",
      primaryUse: "US home charging", requiredFeatures: ["J1772", "complete charger"] });
    expect(highVarianceClarification(input)).toBeUndefined();
    expect(highVarianceClarification(SearchProductsInputSchema.parse({ query: "Tesla charger cable", productType: "EV charger accessory", comparisonMode: "DISCOVERY" }))).toBeUndefined();
  });
  it("does not confuse a charger with an included cable or unknown connector with an accessory or known compatibility", () => {
    expect(highVarianceClarification(SearchProductsInputSchema.parse({ query: "EV charger with cable", comparisonMode: "DISCOVERY" }))).toBeDefined();
    expect(highVarianceClarification(SearchProductsInputSchema.parse({ query: "美国充电桩整机，接口未知", comparisonMode: "DISCOVERY" }))?.evidence)
      .toBe("EV charger compatibility lacks vehicle/connector");
  });
  it("identifies EV clarification and asks only about missing compatibility", () => {
    const clarification = highVarianceClarification(SearchProductsInputSchema.parse({
      query: "美国充电桩整机", comparisonMode: "DISCOVERY", responseLocale: "zh-CN"
    }));
    expect(clarification).toEqual({
      kind: "EV_COMPATIBILITY",
      question: "请确认车辆型号或充电接口。",
      evidence: "EV charger compatibility lacks vehicle/connector"
    });
  });
  it("does not repeat a supplied English charger requirement or accept a negative one", () => {
    const clarification = highVarianceClarification(SearchProductsInputSchema.parse({
      query: "EV charger", primaryUse: "Canada", requiredFeatures: ["NACS", "kit unknown"],
      comparisonMode: "DISCOVERY", responseLocale: "en-US"
    }));
    expect(clarification).toEqual({
      kind: "EV_COMPATIBILITY",
      question: "Please confirm whether you need a complete charger or a DIY kit.",
      evidence: "EV charger compatibility lacks complete charger/kit"
    });
  });
  it("does not claim lower price for a single bottle against a mixed bundle", () => {
    const decision = choosePrimaryRecommendation([
      product({ title: "Shampoo 250 mL", presentationGroup: "TRUSTED_MATCH", price: 1000 }),
      product({ title: "Shampoo and Conditioner Bundle 250 mL", presentationGroup: "TRUSTED_MATCH", price: 2000 })
    ]);
    expect(decision.reasonCodes).not.toContain("LOWER_PRICE");
  });

  it("rejects a conditional product-confirmed coupon as a price or recommendation benefit", () => {
    const conditional = product({ title: "Conditional", presentationGroup: "TRUSTED_MATCH", price: 2000,
      coupon: { productApplicability: "PRODUCT_CONFIRMED", estimatedPrice: 100 } });
    const decision = choosePrimaryRecommendation([
      { ...conditional, coupons: { ...conditional.coupons, verified: [{ productApplicability: "PRODUCT_CONFIRMED" as const,
        assessment: { status: "CONDITIONAL" as const, recommendationEligible: false } }] } },
      product({ title: "Ordinary", presentationGroup: "TRUSTED_MATCH", price: 1000 })
    ]);
    expect(decision.primaryProductIndex).toBe(1);
    expect(decision.reasonCodes).not.toContain("VERIFIED_COUPON");
  });
  it("keeps a server-validated possible same item ahead of a cheaper similar item", () => {
    const decision = choosePrimaryRecommendation([
      { ...product({ title: "Possible same dress", matchStatus: "DISCOVERY_MATCH", presentationGroup: "TRUSTED_MATCH", price: 59800 }),
        visualReviewAssessment: { group: "POSSIBLE_SAME_ITEM" as const, structuralMatchCount: 3, matchCount: 5 } },
      { ...product({ title: "Cheaper similar dress", matchStatus: "DISCOVERY_MATCH", presentationGroup: "TRUSTED_MATCH", price: 10000 }),
        visualReviewAssessment: { group: "HIGHLY_SIMILAR" as const, structuralMatchCount: 2, matchCount: 4 } }
    ]);
    expect(decision.primaryProductIndex).toBe(0);
    expect(decision.reasonCodes).not.toContain("LOWER_PRICE");
  });

  it("uses price only after equal verified visual fit", () => {
    const review = { group: "HIGHLY_SIMILAR" as const, structuralMatchCount: 2, matchCount: 4 };
    const decision = choosePrimaryRecommendation([
      { ...product({ title: "Expensive", matchStatus: "DISCOVERY_MATCH", presentationGroup: "TRUSTED_MATCH", price: 20000 }), visualReviewAssessment: review },
      { ...product({ title: "Cheaper", matchStatus: "DISCOVERY_MATCH", presentationGroup: "TRUSTED_MATCH", price: 10000 }), visualReviewAssessment: review }
    ]);
    expect(decision.primaryProductIndex).toBe(1);
    expect(decision.reasonCodes).toContain("LOWER_PRICE");
  });

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
      kind: "SHOPPING_PREFERENCES",
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

    expect(decision).toEqual({ state: "RESEARCH_ONLY", reasonCodes: ["UNVERIFIED_MERCHANT"] });
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
    ])).toEqual({ state: "RESEARCH_ONLY", reasonCodes: ["UNFULFILLED_REQUIREMENTS"] });
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
    expect(decision).toEqual({ state: "RESEARCH_ONLY", reasonCodes: ["UNVERIFIED_MERCHANT"] });
  });

  it("does not use a merchant-wide coupon estimate as a confirmed product price", () => {
    const decision = choosePrimaryRecommendation([
      product({ title: "Lower raw price", presentationGroup: "TRUSTED_MATCH", price: 1_000 }),
      product({ title: "Unconfirmed coupon", presentationGroup: "TRUSTED_MATCH", price: 2_000,
        coupon: { productApplicability: "MERCHANT_WIDE", estimatedPrice: 500 } })
    ]);
    expect(decision.primaryProductIndex).toBe(0);
  });

  it("attributes an official out-of-stock variant to inventory, not merchant trust", () => {
    const faye = { ...product({ title: "FAYE DRESS -- ALDERBROOK PLAID", presentationGroup: "OFFICIAL_STORE", price: 26800 }),
      availability: "OUT_OF_STOCK" as const, merchantTrust: { verification: "INDEPENDENT" as const, level: "OFFICIAL" as const } };
    expect(choosePrimaryRecommendation([faye])).toEqual({ state: "RESEARCH_ONLY", reasonCodes: ["VARIANT_OUT_OF_STOCK"] });
    expect(faye.merchantTrust.level).toBe("OFFICIAL");
  });

  it.each([undefined, NaN, -1, 1.5])("does not select a primary without a valid item price (%s)", (amountCents) => {
    const item = product({ title: "No price", presentationGroup: "OFFICIAL_STORE", price: 100 });
    const missing = { ...item, itemPrice: amountCents === undefined ? undefined : { amountCents, currency: "USD" as const } };
    expect(choosePrimaryRecommendation([missing])).toEqual({ state: "RESEARCH_ONLY", reasonCodes: ["MISSING_PRICE"] });
  });

  it("keeps verified zero prices valid and research blockers out of READY reasons", () => {
    const item = product({ title: "Verified free sample", presentationGroup: "OFFICIAL_STORE", price: 0 });
    expect(choosePrimaryRecommendation([item, { ...item, availability: "OUT_OF_STOCK" as const }])).toMatchObject({
      state: "READY", primaryProductIndex: 0, reasonCodes: ["EXACT_MATCH", "TRUSTED_MERCHANT"]
    });
  });

  it("deduplicates actual blockers and stays inside the three-reason output contract", () => {
    const item = product({ title: "Research", presentationGroup: "TRUSTED_MATCH", price: 100, merchantVerified: false,
      requiredFeatureLimitations: ["required material unknown"] });
    const result = choosePrimaryRecommendation([{ ...item, availability: "OUT_OF_STOCK" as const, matchStatus: "SIMILAR" as const,
      itemPrice: undefined }, item]);
    expect(result.reasonCodes).toEqual(["VARIANT_OUT_OF_STOCK", "UNVERIFIED_MERCHANT", "UNFULFILLED_REQUIREMENTS"]);
    expect(choosePrimaryRecommendation([{ ...product({ title: "Only similar", presentationGroup: "OFFICIAL_STORE", price: 100 }),
      matchStatus: "SIMILAR" as const }]).reasonCodes).toEqual(["SIMILAR_ONLY"]);
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
    brand: "Fixture brand", sku: "SAME-VARIANT", gtins: [], variantDimensions: {}, condition: "NEW" as const,
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
          verified: [{ title: "Coupon", productApplicability: options.coupon.productApplicability, validTo: "2099-01-01T00:00:00Z",
            assessment: { status: options.coupon.productApplicability === "PRODUCT_CONFIRMED" ? "CONFIRMED" as const : "CONDITIONAL" as const,
              recommendationEligible: options.coupon.productApplicability === "PRODUCT_CONFIRMED" } }],
          ...(options.coupon.estimatedPrice === undefined
            ? {}
            : { estimatedItemPriceAfterCoupon: { amountCents: options.coupon.estimatedPrice } })
        }
  };
}
