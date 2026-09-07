import { describe, expect, it } from "vitest";
import { deduplicateCandidateOffers } from "../src/offer-equivalence.js";
import { product } from "./fixtures/conversation-replay-support.js";
import type { UnifiedCandidate } from "../src/search-products.js";

function candidate(merchantId: string, overrides = {}): UnifiedCandidate {
  return { source: "SHOPIFY_GLOBAL_CATALOG", affiliateState: "NONE", recommendationTier: "TRUSTED_OR_AFFILIATE",
    featureEvidence: [], preferenceEvidence: [], requiredFeatureLimitations: [], verifiedCoupons: [],
    identityStatus: "DISCOVERY_MATCH", identityEvidence: [], resultGroup: "DISCOVERY",
    shopifyProduct: product({ merchantId, sourceHost: "medicube.us", handle: "123",
      merchantUrl: "https://medicube.us/products/pads?variant=123", ...overrides }) };
}

describe("offer equivalence without changing source references", () => {
  it("merges Catalog, official and web observations but keeps atomic latest facts", () => {
    const catalog = candidate("shopify-1", { itemPrice: { amountCents: 1000, currency: "USD" }, availability: "IN_STOCK" });
    const official = candidate("official-medicube.us", { checkedAt: "2026-09-07T12:00:00Z",
      itemPrice: { amountCents: 2400, currency: "USD" }, availability: "OUT_OF_STOCK", condition: "UNKNOWN" });
    const web = candidate("web-1", { sourceKind: "WEB_PRODUCT_PAGE", merchantUrl: "https://medicube.us/products/pads?utm_source=web&variant=123" });
    const result = deduplicateCandidateOffers([catalog, official, web]);
    expect(result).toHaveLength(1);
    expect(result[0]?.shopifyProduct).toBe(official.shopifyProduct);
    expect(result[0]?.offerObservations).toHaveLength(3);
    expect(result[0]?.shopifyProduct).toMatchObject({ merchantId: "official-medicube.us", availability: "OUT_OF_STOCK", itemPrice: { amountCents: 2400 } });
    expect(catalog.offerObservations).toBeUndefined();
    expect(deduplicateCandidateOffers(result)).toEqual(result);
  });
  it.each([
    { sourceHost: "other.example", merchantUrl: "https://other.example/products/pads?variant=123" },
    { handle: "456", merchantUrl: "https://medicube.us/products/pads?variant=456" },
    { condition: "USED" },
    { variantDimensions: { Size: "L" } },
    { title: "Pads 140 count" },
    { merchantUrl: "https://medicube.us/products/pads?variant=123&selling_plan=9" },
    { merchantUrl: "https://medicube.us/products/pads?variant=123&variant=456" },
    { handle: "999" },
    { merchantUrl: "http://medicube.us/products/pads?variant=123" }
  ])("does not merge conflicting or unsupported observations %j", overrides => {
    expect(deduplicateCandidateOffers([candidate("catalog", { title: "Pads 70 count", variantDimensions: { Size: "S" } }), candidate("official", overrides)])).toHaveLength(2);
  });
  it("does not let an unknown observation bridge two conflicting conditions", () => {
    expect(deduplicateCandidateOffers([candidate("unknown", { condition: "UNKNOWN" }), candidate("new"), candidate("used", { condition: "USED" })])).toHaveLength(2);
  });
});
