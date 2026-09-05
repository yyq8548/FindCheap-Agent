import { describe, expect, it } from "vitest";
import { compareLowestPrice, compareRankedCandidates, selectVisualReviewCandidates } from "../src/product-candidate-ranking.js";
import type { UnifiedCandidate } from "../src/search-products.js";
import type { VerifiedDeal } from "../src/deal-client.js";
import { classifyVisualProduct, VisualProductInputSchema, type VisualProductInput } from "../src/visual-product-discovery.js";

function candidate(handle: string, title: string): UnifiedCandidate {
  return {
    source: "SHOPIFY_GLOBAL_CATALOG", affiliateState: "NONE", recommendationTier: "GENERAL_UNVERIFIED",
    featureEvidence: [], preferenceEvidence: [], requiredFeatureLimitations: [], verifiedCoupons: [],
    identityStatus: "DISCOVERY_MATCH", identityEvidence: [], resultGroup: "DISCOVERY",
    shopifyProduct: {
      merchantId: "test", merchant: "Test", sourceHost: "example.com", handle, title,
      merchantTrust: { level: "UNKNOWN", verification: "UNVERIFIED", evidence: [] },
      gtins: [], variantDimensions: {}, matchStatus: "DISCOVERY_MATCH", matchEvidence: [],
      condition: "UNKNOWN", availability: "IN_STOCK", itemPrice: { amountCents: 1000, currency: "USD" },
      merchantUrl: `https://example.com/products/${handle}`, checkedAt: "2026-09-04T00:00:00.000Z"
    }
  };
}

describe("visual review pool", () => {
  it("reviews reliable color and pattern before unrelated official cache entries without asserting identity", () => {
    const reference = VisualProductInputSchema.parse({ productType: "dress", observations: [
      { attribute: "COLOR", value: "ivory", confidence: 0.98, visibility: "VISIBLE" },
      { attribute: "PATTERN", value: "burgundy floral bouquets", confidence: 0.98, visibility: "VISIBLE" }
    ] });
    const official = Array.from({ length: 9 }, (_, index) => officialCandidate(`official-${index}`, `Plain ${index} Blue Dress`));
    const target = candidate("target", "Ivory Burgundy Floral Dress");
    target.recommendationTier = "TRUSTED_OR_AFFILIATE";
    const result = selectVisualReviewCandidates([...official, target], 9, reference);
    expect(result[0]?.shopifyProduct?.handle).toBe("target");
    expect(result[0]).toMatchObject({ identityStatus: "DISCOVERY_MATCH", recommendationTier: "TRUSTED_OR_AFFILIATE" });
    expect(result[0]?.visualReviewAssessment).toBeUndefined();
  });

  it("does not let official zero-structure cache crowd the observed Satin Tempt catalog candidate out of nine slots", () => {
    const reference = VisualProductInputSchema.parse({ productType: "dress", observations: [
      { attribute: "COLOR", value: "dark chocolate brown", confidence: 0.96, visibility: "VISIBLE" },
      { attribute: "NECKLINE", value: "straight strapless neckline", confidence: 0.99, visibility: "VISIBLE" },
      { attribute: "SLEEVE", value: "strapless with bare shoulders", confidence: 0.99, visibility: "VISIBLE" },
      { attribute: "LENGTH", value: "floor length maxi", confidence: 0.99, visibility: "VISIBLE" },
      { attribute: "SILHOUETTE", value: "fitted bodice and hips with a long slightly flared skirt", confidence: 0.95, visibility: "VISIBLE" }
    ] });
    // Public metadata observed in pdf04; neither the title nor supplier creates an identity verdict.
    const target = candidate("44242283593814", "Satin Tempt Strapless Maxi Dress Chocolate");
    if (target.source !== "SHOPIFY_GLOBAL_CATALOG") throw new Error("invalid fixture");
    target.shopifyProduct.description = "A luxurious satin maxi dress with a strapless design, crisscross back, and fitted bodice. Maxi dress. Semi-lined. Strapless. Satin. Neck scarf. Crisscross back. Fitted bodice. Flowy skirt. Zipper, hook eye closure.";
    target.shopifyProduct.merchant = "Hello Molly US";
    target.shopifyProduct.variantDimensions = { Color: "Chocolate", Size: "XS" };
    expect(classifyVisualProduct(reference, target.shopifyProduct)?.group).toBe("HIGHLY_SIMILAR");
    const official = Array.from({ length: 9 }, (_, index) => officialCandidate(`official-${index}`, `Plain ${index} White Dress`));
    const result = selectVisualReviewCandidates([...official, target], 9, reference);
    expect(result.some(item => item.shopifyProduct?.handle === target.shopifyProduct.handle)).toBe(true);
    expect(result.find(item => item.shopifyProduct?.handle === target.shopifyProduct.handle)?.identityStatus).toBe("DISCOVERY_MATCH");
    expect(result.every(item => item.visualReviewAssessment === undefined)).toBe(true);
  });

  it("keeps any reliable structural layer above weak color and pattern evidence", () => {
    const reference = VisualProductInputSchema.parse({ productType: "dress", colors: ["ivory blue red green"], patterns: ["floral plaid stripe"] });
    const weak = candidate("weak", "Ivory Blue Red Green Floral Plaid Stripe Dress");
    const structured = { ...candidate("structured", "Cream Dress"), visualMatchScore: 1,
      visualMatchEvidence: ["visual attribute matched: neckline: scoop neck"] };
    expect(selectVisualReviewCandidates([weak, structured], 2, reference)[0]?.shopifyProduct?.handle).toBe("structured");
  });

  it("does not rank candidates from uncertain or inferred color observations", () => {
    const reference = VisualProductInputSchema.parse({ productType: "dress", observations: [
      { attribute: "COLOR", value: "ivory", confidence: 0.4, visibility: "VISIBLE" },
      { attribute: "PATTERN", value: "burgundy floral", confidence: 0.9, visibility: "PARTIAL" }
    ] });
    const official = officialCandidate("official", "Plain Blue Dress");
    const guessed = candidate("guessed", "Ivory Burgundy Floral Dress");
    expect(selectVisualReviewCandidates([guessed, official], 2, reference)[0]?.shopifyProduct?.handle).toBe("official");
  });

  it("selects target print colors within a style using catalog detail, not opaque colorway names", () => {
    const reference = VisualProductInputSchema.parse({ productType: "dress", colors: ["ivory base"], patterns: ["burgundy floral bouquets"],
      neckline: "scoop neck", sleeveType: "short puff sleeves" });
    const make = (handle: string, title: string, description: string) => {
      const value = candidate(handle, title);
      if (value.source !== "SHOPIFY_GLOBAL_CATALOG") throw new Error("invalid fixture");
      value.shopifyProduct.description = description;
      return { ...value, visualMatchScore: 73, visualMatchEvidence: ["visual attribute matched: neckline: scoop neck"] };
    };
    const wrong = make("wrong", "Meadow Dress -- Morning", "ivory blue floral bouquets with scoop neck short puff sleeves");
    const target = make("target", "Meadow Dress -- Evening", "ivory burgundy floral bouquets with scoop neck short puff sleeves");
    const other = Array.from({ length: 6 }, (_, index) => make(`other-${index}`, `Different ${index} Dress`, "ivory blue floral dress with scoop neck short puff sleeves"));
    const result = selectVisualReviewCandidates([wrong, ...other, target], 6, reference);
    expect(result[0]?.shopifyProduct?.handle).toBe("target");
    expect(result.some(item => item.shopifyProduct?.handle === "wrong")).toBe(false);
    expect(result[0]?.identityStatus).toBe("DISCOVERY_MATCH");
  });

  it("does not displace strongly matching colorways to satisfy a merchant diversity quota", () => {
    const reference = VisualProductInputSchema.parse({ productType: "dress", colors: ["ivory"], patterns: ["red floral bouquets"], neckline: "scoop neck" });
    const matches = Array.from({ length: 6 }, (_, index) => ({ ...candidate(`match-${index}`, `Style ${index} Ivory Red Floral Dress`),
      visualMatchScore: 73, visualMatchEvidence: ["visual attribute matched: neckline: scoop neck"] }));
    const wrongColor = { ...candidate("wrong", "Ivory Blue Floral Dress"), visualMatchScore: 73,
      visualMatchEvidence: ["visual attribute matched: neckline: scoop neck"] };
    if (wrongColor.source !== "SHOPIFY_GLOBAL_CATALOG") throw new Error("invalid fixture");
    wrongColor.shopifyProduct.merchant = "Other merchant";
    expect(selectVisualReviewCandidates([...matches, wrongColor], 6, reference).some(item => item.shopifyProduct?.handle === "wrong")).toBe(false);
  });

  const visual = VisualProductInputSchema.parse({
    brand: "DOEN", productType: "dress", colors: ["black"],
    neckline: "boat neck", sleeveType: "cap sleeve", length: "mini"
  });

  it("moves a seventh structural match into the first six without asserting exact identity", () => {
    const earlier = Array.from({ length: 6 }, (_, index) =>
      visuallyAssessedCandidate(`plain-${index}`, `Plain ${index} Dress | Black`, "black dress", visual)
    );
    const target = visuallyAssessedCandidate("target", "Lace Mini Dress | Black", "black mini dress with boat neck and cap sleeve", visual);
    const input = [...earlier, target];
    const result = selectVisualReviewCandidates(input, 6, visual);

    expect(result.map(item => item.shopifyProduct?.handle)).toEqual(["target", "plain-0", "plain-1", "plain-2", "plain-3", "plain-4"]);
    expect(result[0]).toMatchObject({ identityStatus: "DISCOVERY_MATCH", visualMatchScore: target.visualMatchScore });
    expect(input[6]).toBe(target);
  });

  it("reviews stronger structure before merchant presentation tiers without promoting merchant trust", () => {
    const official = visuallyAssessedCandidate("official", "Official Dress | Black", "black dress", visual);
    if (official.source !== "SHOPIFY_GLOBAL_CATALOG") throw new Error("invalid fixture");
    official.shopifyProduct = {
      ...official.shopifyProduct, merchant: "DOEN", sourceHost: "www.shopdoen.com",
      merchantUrl: "https://www.shopdoen.com/products/official-dress-black",
      merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT", evidence: ["fixture"] }
    };
    const trusted = visuallyAssessedCandidate("trusted", "Trusted Dress | Black", "black mini dress", visual);
    trusted.recommendationTier = "TRUSTED_OR_AFFILIATE";
    const unverified = visuallyAssessedCandidate("unverified", "DOEN Unverified Dress | Black", "black mini dress with boat neck and cap sleeve", visual);
    if (unverified.source !== "SHOPIFY_GLOBAL_CATALOG") throw new Error("invalid fixture");
    unverified.shopifyProduct.merchant = "DOEN";

    const result = selectVisualReviewCandidates([unverified, trusted, official], 3, visual);

    expect(result.map(item => item.shopifyProduct?.handle)).toEqual(["unverified", "trusted", "official"]);
    expect(result.map(item => item.presentationGroup)).toEqual(["BEST_VALUE", "TRUSTED_MATCH", "OFFICIAL_STORE"]);
    expect(result[0]?.recommendationTier).toBe("GENERAL_UNVERIFIED");
  });

  it("reserves review opportunities across merchants with comparable structure, not unrelated fillers", () => {
    const dominant = Array.from({ length: 6 }, (_, index) => visuallyAssessedCandidate(
      `dominant-${index}`, `Style ${index} Dress | Black`, "black mini dress with boat neck and cap sleeve", visual
    ));
    const peer = visuallyAssessedCandidate("peer", "Peer Dress | Black", "black mini dress with boat neck and cap sleeve", visual);
    const weak = visuallyAssessedCandidate("weak", "Weak Dress | Black", "black dress", visual);
    if (peer.source !== "SHOPIFY_GLOBAL_CATALOG" || weak.source !== "SHOPIFY_GLOBAL_CATALOG") throw new Error("invalid fixture");
    peer.shopifyProduct.merchant = "Other merchant";
    weak.shopifyProduct.merchant = "Third merchant";
    const result = selectVisualReviewCandidates([...dominant, peer, weak], 6, visual);
    expect(result[3]?.shopifyProduct?.handle).toBe("peer");
    expect(result.some((item) => item.shopifyProduct?.handle === "weak")).toBe(false);
  });

  it("uses reliable color as weak review evidence, without promoting brand or material alone", () => {
    const colorVisual = VisualProductInputSchema.parse({ brand: "DOEN", productType: "dress", colors: ["black"], materials: ["cotton"] });
    const input = [
      visuallyAssessedCandidate("brand", "First Dress", "dress", colorVisual),
      visuallyAssessedCandidate("color", "Second Dress | Black", "black dress", colorVisual),
      visuallyAssessedCandidate("material", "Third Dress | Black", "black cotton dress", colorVisual)
    ];

    expect(input[2]!.visualMatchScore).toBeGreaterThan(input[0]!.visualMatchScore!);
    expect(selectVisualReviewCandidates(input, 3, colorVisual).map(item => item.shopifyProduct?.handle))
      .toEqual(["color", "material", "brand"]);
  });

  it("keeps structural ties stable and the requested color representative ahead of sibling variants", () => {
    const input = [
      visuallyAssessedCandidate("plain", "Plain Dress | Black", "black dress", visual),
      visuallyAssessedCandidate("pink", "Lace Dress | Pink", "mini dress with boat neck and cap sleeve", visual),
      visuallyAssessedCandidate("black", "Lace Dress | Black", "black mini dress with boat neck and cap sleeve", visual),
      visuallyAssessedCandidate("other", "Other Mini Dress | Black", "black mini dress with boat neck and cap sleeve", visual)
    ];

    expect(selectVisualReviewCandidates(input, 3, visual).map(item => item.shopifyProduct?.handle))
      .toEqual(["black", "other", "plain"]);
    expect(selectVisualReviewCandidates(input, 4, visual).map(item => item.shopifyProduct?.handle))
      .toEqual(["black", "other", "plain", "pink"]);
  });

  it("does not let one style's color variants crowd out different silhouettes", () => {
    const result = selectVisualReviewCandidates([
      candidate("a", "Slip Dress | Black"), candidate("b", "Slip Dress | Pink"),
      candidate("c", "Slip Dress | Grey"), candidate("d", "Petite Slip Dress | Black"),
      candidate("e", "Lace Mini Dress | Black")
    ], 3);
    expect(result.map(item => item.shopifyProduct?.handle)).toEqual(["a", "d", "e"]);
  });

  it("keeps the requested color representative before other variants without filtering them", () => {
    const result = selectVisualReviewCandidates([
      candidate("pink", "Slip Dress | Pink"), candidate("grey", "Slip Dress | Heather Grey"),
      candidate("mini", "Lace Mini Dress | Black")
    ], 3, VisualProductInputSchema.parse({ productType: "dress", colors: ["grey"] }));
    expect(result.map(item => item.shopifyProduct?.handle)).toEqual(["grey", "mini", "pink"]);
  });
});

function officialCandidate(handle: string, title: string): UnifiedCandidate {
  const value = candidate(handle, title);
  if (value.source !== "SHOPIFY_GLOBAL_CATALOG") throw new Error("invalid fixture");
  value.shopifyProduct = { ...value.shopifyProduct, merchant: "DOEN", sourceHost: "www.shopdoen.com",
    merchantUrl: `https://www.shopdoen.com/products/${handle}`,
    merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT", evidence: ["fixture"] } };
  return value;
}

function visuallyAssessedCandidate(handle: string, title: string, description: string, visual: VisualProductInput): UnifiedCandidate {
  const result = candidate(handle, title);
  if (result.source !== "SHOPIFY_GLOBAL_CATALOG") throw new Error("invalid fixture");
  result.shopifyProduct = { ...result.shopifyProduct, description, productType: "dress", brand: "DOEN" };
  const match = classifyVisualProduct(visual, result.shopifyProduct);
  if (match === undefined) throw new Error("fixture must have a metadata match");
  return { ...result, visualMatchGroup: match.group, visualMatchEvidence: match.evidence, visualMatchScore: match.score };
}

describe("candidate coupon ranking", () => {
  const confirmed: VerifiedDeal = {
    dealId: "confirmed-product", merchant: "Test", kind: "PROMO_CODE", code: "SAVE75",
    title: "75% off", description: "75% off", discountPercent: 75,
    productApplicability: "PRODUCT_CONFIRMED", applicableProductIds: ["coupon-product"],
    eligibility: [], channels: ["ONLINE"], sourceUrl: "https://example.com/deals",
    checkedAt: "2026-09-04T12:00:00.000Z", validFrom: "2026-09-01T00:00:00.000Z",
    validTo: "2026-10-01T00:00:00.000Z", verificationStatus: "VERIFIED"
  };

  it.each([
    { name: "minimum spend", title: "75% off orders over $100", description: "Minimum spend $100" },
    { name: "title scope mismatch", title: "75% off hair bundles only", description: "75% off" },
    { name: "description scope mismatch", title: "75% off", description: "For hair bundles only" }
  ])("does not lower candidate price or promote a product-confirmed coupon with $name", ({ title, description }) => {
    const coupon = { ...confirmed, title, description };
    const expensive = rankingCandidate("coupon-product", "Z Short human hair wig", 2_000, [coupon]);
    const cheaper = rankingCandidate("baseline", "A Short human hair wig", 1_000);
    expect(compareRankedCandidates(expensive, cheaper)).toBeGreaterThan(0);
    expect(compareLowestPrice(expensive, cheaper)).toBeGreaterThan(0);
    const samePrice = rankingCandidate("coupon-product", "Z Short human hair wig", 1_000, [coupon]);
    expect(compareRankedCandidates(samePrice, cheaper)).toBeGreaterThan(0);
    expect(compareLowestPrice(samePrice, cheaper)).toBeGreaterThan(0);
  });

  it("uses a truly product-confirmed coupon only after its terms pass", () => {
    const discounted = rankingCandidate("coupon-product", "Z Short human hair wig", 2_000, [confirmed]);
    const cheaperRaw = rankingCandidate("baseline", "A Short human hair wig", 1_000);
    expect(compareRankedCandidates(discounted, cheaperRaw)).toBeLessThan(0);
    expect(compareLowestPrice(discounted, cheaperRaw)).toBeLessThan(0);
  });
});

function rankingCandidate(handle: string, title: string, amountCents: number, verifiedCoupons: VerifiedDeal[] = []): UnifiedCandidate {
  const value = candidate(handle, title);
  if (value.source !== "SHOPIFY_GLOBAL_CATALOG") throw new Error("invalid fixture");
  return {
    ...value, recommendationTier: "TRUSTED_OR_AFFILIATE", verifiedCoupons,
    featureEvidence: ["human hair", "short wig"],
    shopifyProduct: {
      ...value.shopifyProduct,
      merchantTrust: { level: "ESTABLISHED_RETAILER", verification: "INDEPENDENT", evidence: ["fixture"] },
      itemPrice: { amountCents, currency: "USD" }
    }
  };
}
