import { describe, expect, it } from "vitest";
import { compareLowestPrice, compareRankedCandidates, selectVisualReviewCandidates } from "../src/product-candidate-ranking.js";
import type { UnifiedCandidate } from "../src/search-products.js";
import type { VerifiedDeal } from "../src/deal-client.js";
import { VisualProductInputSchema } from "../src/visual-product-discovery.js";

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
