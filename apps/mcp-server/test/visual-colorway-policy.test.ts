import { describe, expect, it } from "vitest";
import { finalizeCodexVisualCandidates, type CodexVisualVerdict, type UnifiedCandidate } from "../src/search-products.js";
import { choosePrimaryRecommendation } from "../src/product-recommendation.js";
import { VisualProductInputSchema } from "../src/visual-product-discovery.js";

const reference = VisualProductInputSchema.parse({ brand: "DÔEN", productType: "dress", colors: ["black"],
  neckline: "boat neck", sleeveType: "cap sleeve", length: "mini" });
const verdict: CodexVisualVerdict = { classification: "HIGHLY_SIMILAR", matches: [
  { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "boat neck" },
  { attribute: "SLEEVE", referenceEvidence: "cap sleeve", candidateEvidence: "cap sleeve" },
  { attribute: "LENGTH", referenceEvidence: "mini", candidateEvidence: "mini" }
], conflicts: [{ attribute: "COLOR", referenceEvidence: "black", candidateEvidence: "white" }] };
const candidate: Extract<UnifiedCandidate, { source: "SHOPIFY_GLOBAL_CATALOG" }> = {
  source: "SHOPIFY_GLOBAL_CATALOG", affiliateState: "NONE", recommendationTier: "TRUSTED_OR_AFFILIATE",
  featureEvidence: [], preferenceEvidence: [], requiredFeatureLimitations: [], verifiedCoupons: [],
  identityStatus: "DISCOVERY_MATCH", identityEvidence: [], resultGroup: "DISCOVERY",
  shopifyProduct: { merchantId: "test", merchant: "DÔEN", brand: "doen", sourceHost: "example.com",
    handle: "dress", title: "DÔEN white mini dress", productType: "dress",
    merchantTrust: { level: "ESTABLISHED_RETAILER", verification: "INDEPENDENT", evidence: ["fixture"] },
    gtins: [], variantDimensions: { color: "white" }, matchStatus: "DISCOVERY_MATCH", matchEvidence: [],
    condition: "NEW", availability: "IN_STOCK", itemPrice: { amountCents: 5900, currency: "USD" },
    merchantUrl: "https://example.com/products/dress", checkedAt: "2026-09-06T10:00:00.000Z" }
};

describe("approved visual colorway directions", () => {
  it.each(["OtherBrand", "Doen Atelier", " ", undefined])("rejects a changed color without full source-brand identity: %s", brand => {
    const { brand: _brand, ...source } = candidate.shopifyProduct!;
    const original = { ...candidate, shopifyProduct: { ...source, ...(brand === undefined ? {} : { brand }) } };
    const before = structuredClone(original);
    expect(finalizeCodexVisualCandidates([{ candidate: original, verdict }], false, 3, reference)).toEqual([]);
    expect(original).toEqual(before);
  });

  it("requires a known reference brand for an automatic colorway change", () => {
    const unknown = VisualProductInputSchema.parse({ ...reference, brand: undefined });
    expect(finalizeCodexVisualCandidates([{ candidate, verdict }], false, 3, unknown)).toEqual([]);
  });

  it("retains source-proven normalized same-brand colorways as similar buying choices", () => {
    const result = finalizeCodexVisualCandidates([{ candidate, verdict }], false, 3, reference);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ identityStatus: "DISCOVERY_MATCH",
      visualReviewAssessment: { recommendationScope: "SIMILAR" } });
    expect(choosePrimaryRecommendation(result.map(entry => ({ ...entry.shopifyProduct!,
      visualReviewAssessment: entry.visualReviewAssessment, coupons: { verified: [] } })))).toMatchObject({
      state: "READY", primaryProductIndex: 0
    });
    expect(finalizeCodexVisualCandidates([{ candidate, verdict }], false, 3, reference, true, Date.now(),
      { requiredFeatures: ["color: black"], excludedFeatures: [] })).toEqual([]);
  });

  it("retains cross-brand same-color structure and ignores inadmissible differences", () => {
    const other = { ...candidate, shopifyProduct: { ...candidate.shopifyProduct!, brand: "OtherBrand" } };
    const sameColor: CodexVisualVerdict = { ...verdict, conflicts: [], matches: [...verdict.matches,
      { attribute: "COLOR", referenceEvidence: "black", candidateEvidence: "black" }] };
    expect(finalizeCodexVisualCandidates([{ candidate: other, verdict: sameColor }], false, 3, reference)).toHaveLength(1);
    expect(finalizeCodexVisualCandidates([{ candidate: other, verdict: { ...verdict, conflicts: [{ ...verdict.conflicts[0]!,
      referenceObservation: { confidence: 0.2, visibility: "VISIBLE" } }] } }], false, 3, reference)).toHaveLength(1);
  });

  it.each(["Brand: OtherBrand", "Compatible brand: Doen", "Brand: Doen; Make: OtherBrand"])(
    "does not infer eBay same-brand authority from missing or conflicting attributes: %s", attributes => {
      const ebay = ebayCandidate(attributes.split("; "));
      expect(finalizeCodexVisualCandidates([{ candidate: ebay, verdict }], false, 3, reference)).toEqual([]);
    }
  );

  it("accepts consistent explicit eBay brand/manufacturer evidence", () => {
    expect(finalizeCodexVisualCandidates([{ candidate: ebayCandidate(["Brand: DOEN", "Manufacturer: DÔEN"]), verdict }],
      false, 3, reference)).toHaveLength(1);
  });

  it("does not treat an Awin merchant name or flattened source text as product brand", () => {
    const { shopifyProduct: product, ...base } = candidate;
    const awin: UnifiedCandidate = { ...base, source: "AWIN_PRODUCT_FEED", awinProduct: {
      merchantId: "123", merchant: "DÔEN", merchantProductId: "dress", title: product!.title, category: "dress",
      requirementEvidence: "Brand: DÔEN", matchStatus: "DISCOVERY_MATCH", matchEvidence: [], condition: "UNKNOWN",
      availability: "IN_STOCK", itemPrice: product!.itemPrice!, merchantUrl: product!.merchantUrl,
      affiliateUrl: "https://www.awin1.com/cread.php?awinmid=123", checkedAt: product!.checkedAt
    } };
    expect(finalizeCodexVisualCandidates([{ candidate: awin, verdict }], false, 3, reference)).toEqual([]);
  });
});

function ebayCandidate(attributes: string[]): UnifiedCandidate {
  const { shopifyProduct: product, ...base } = candidate;
  return { ...base, source: "EBAY_BROWSE", ebayProduct: { environment: "PRODUCTION", itemId: "v1|123|0",
    productRef: "ebay-00000000000000000000000000000001", title: product!.title, category: "dress", attributes,
    sellerName: "DÔEN", condition: "NEW", availability: "UNKNOWN", itemPrice: product!.itemPrice!,
    matchStatus: "DISCOVERY_MATCH", matchEvidence: [], merchantUrl: "https://www.ebay.com/itm/123", checkedAt: product!.checkedAt } };
}
