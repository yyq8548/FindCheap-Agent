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

  it("keeps official and trusted candidates ahead of stronger unverified structural matches", () => {
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

    expect(result.map(item => item.shopifyProduct?.handle)).toEqual(["official", "trusted", "unverified"]);
    expect(result.map(item => item.presentationGroup)).toEqual(["OFFICIAL_STORE", "TRUSTED_MATCH", "BEST_VALUE"]);
  });

  it("preserves source order when only brand, color, or material matches", () => {
    const colorVisual = VisualProductInputSchema.parse({ brand: "DOEN", productType: "dress", colors: ["black"], materials: ["cotton"] });
    const input = [
      visuallyAssessedCandidate("brand", "First Dress", "dress", colorVisual),
      visuallyAssessedCandidate("color", "Second Dress | Black", "black dress", colorVisual),
      visuallyAssessedCandidate("material", "Third Dress | Black", "black cotton dress", colorVisual)
    ];

    expect(input[2]!.visualMatchScore).toBeGreaterThan(input[0]!.visualMatchScore!);
    expect(selectVisualReviewCandidates(input, 3, colorVisual).map(item => item.shopifyProduct?.handle))
      .toEqual(["brand", "color", "material"]);
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
