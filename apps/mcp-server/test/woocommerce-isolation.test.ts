import { describe, expect, it, vi } from "vitest";
import type { AwinProduct } from "../../../packages/awin-feed/src/index.js";
import { WooProductSchema, type WooProduct } from "../../../packages/contracts/src/woocommerce.js";
import { dealAppliesToProduct, VerifiedDealSchema } from "../src/deal-client.js";
import { deduplicateCandidateOffers } from "../src/offer-equivalence.js";
import { SearchBudgetError, SearchRun } from "../src/search-run.js";
import type { UnifiedCandidate } from "../src/search-products.js";
import { dealProductId, wooProductFacts } from "../src/woocommerce-product.js";

const url = "https://woo-shop.example/product/keyboard?variation_id=2001&attribute_color=Black";
const base = {
  affiliateState: "NONE" as const, recommendationTier: "TRUSTED_OR_AFFILIATE" as const,
  featureEvidence: [], preferenceEvidence: [], requiredFeatureLimitations: [], verifiedCoupons: [],
  identityStatus: "DISCOVERY_MATCH" as const, identityEvidence: [], resultGroup: "DISCOVERY" as const
};

function wooProduct(overrides: Partial<WooProduct> = {}): WooProduct {
  return WooProductSchema.parse({
    sourceKind: "WOOCOMMERCE_STORE_API", merchantId: "woo-shop", merchantName: "Woo Shop", sourceHost: "woo-shop.example",
    productId: 2000, parentProductId: 2000, variationId: 2001, title: "Black mechanical keyboard", category: "keyboard",
    productType: "variation", condition: "NEW", attributes: ["Color: Black"],
    selectedAttributes: { Color: "Black" }, variantDimensions: { Color: ["Black"] }, merchantUrl: url, images: [],
    itemPrice: { amountCents: 2300, currency: "USD" },
    priceEvidence: { amountMinor: "2300", currency: "USD", currencyMinorUnit: 2, scope: "VARIANT", taxBasis: "UNKNOWN" },
    availability: "OUT_OF_STOCK", availabilityScope: "VARIANT", checkedAt: "2026-09-08T16:00:00.000Z", ...overrides
  });
}
function woo(overrides: Partial<WooProduct> = {}): UnifiedCandidate {
  return { ...base, source: "WOOCOMMERCE_STORE_API", woocommerceProduct: wooProduct(overrides) };
}
function awin(overrides: Partial<AwinProduct> = {}): UnifiedCandidate {
  return { ...base, source: "AWIN_PRODUCT_FEED", affiliateState: "APPROVED", awinProduct: {
    merchantId: "999", merchant: "Woo Shop", merchantProductId: "2001", title: "Black mechanical keyboard", category: "keyboard",
    matchStatus: "DISCOVERY_MATCH", matchEvidence: [], condition: "UNKNOWN", itemPrice: { amountCents: 1000, currency: "USD" },
    availability: "IN_STOCK", merchantUrl: url, affiliateUrl: "https://www.awin1.com/pclick.php?p=2001&m=999",
    checkedAt: "2026-09-08T15:00:00.000Z", ...overrides
  } };
}

describe("Woo independent offer identity", () => {
  it("merges a proven same-URL Woo/Awin variant while preserving the latest atomic price and stock", () => {
    const source = woo();
    const feed = awin();
    const result = deduplicateCandidateOffers([feed, source]);
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe("WOOCOMMERCE_STORE_API");
    expect(result[0]?.woocommerceProduct).toBe(source.woocommerceProduct);
    expect(result[0]?.woocommerceProduct).toMatchObject({ itemPrice: { amountCents: 2300 }, availability: "OUT_OF_STOCK" });
    expect(result[0]?.offerObservations?.map(observation => observation.source)).toEqual(["AWIN_PRODUCT_FEED", "WOOCOMMERCE_STORE_API"]);
    expect(source.offerObservations).toBeUndefined();
    expect(feed.offerObservations).toBeUndefined();
    expect(deduplicateCandidateOffers(result)).toEqual(result);
  });

  it.each([
    ["different variant", "https://woo-shop.example/product/keyboard?variation_id=2002&attribute_color=Black"],
    ["different host", "https://other-shop.example/product/keyboard?variation_id=2001&attribute_color=Black"],
    ["parent URL without child proof", "https://woo-shop.example/product/keyboard"],
    ["conflicting selected color", "https://woo-shop.example/product/keyboard?variation_id=2001&attribute_color=White"]
  ])("retains separate observations for %s", (_label, merchantUrl) => {
    expect(deduplicateCandidateOffers([woo(), awin({ merchantUrl })])).toHaveLength(2);
  });

  it("does not merge different conditions or let an unknown condition bridge them", () => {
    const fresh = woo({ condition: "NEW" });
    const used = woo({ condition: "USED" });
    expect(deduplicateCandidateOffers([fresh, used])).toHaveLength(2);
    expect(deduplicateCandidateOffers([awin(), fresh, used])).toHaveLength(2);
  });

  it("keeps an otherwise identical numeric product and variation in another merchant domain", () => {
    const other = woo({ merchantId: "other-shop", sourceHost: "other-shop.example", merchantUrl: url.replace("woo-shop.example", "other-shop.example") });
    expect(deduplicateCandidateOffers([woo(), other])).toHaveLength(2);
  });
});

describe("Woo product-specific coupon namespace", () => {
  const coupon = VerifiedDealSchema.parse({
    dealId: "awin-2001-offer", merchant: "Woo Shop", kind: "COUPON", title: "Product discount",
    description: "Verified only for Awin product 2001", discountAmountCents: 500,
    productApplicability: "PRODUCT_CONFIRMED", applicableProductIds: ["2001"], eligibility: [], channels: ["ONLINE"],
    sourceUrl: "https://woo-shop.example/coupons", checkedAt: "2026-09-08T16:00:00.000Z",
    validFrom: "2026-09-08T00:00:00.000Z", validTo: "2026-09-09T00:00:00.000Z", verificationStatus: "VERIFIED"
  });

  it("does not apply an Awin confirmed product coupon to a colliding Woo numeric ID", () => {
    const wooId = dealProductId(wooProductFacts(wooProduct()));
    const awinId = dealProductId({ merchantId: "999", handle: "2001" });
    expect(awinId).toBe("2001");
    expect(wooId).toBe("woocommerce:woo-shop:2001");
    expect(dealAppliesToProduct(coupon, awinId)).toBe(true);
    expect(dealAppliesToProduct(coupon, wooId)).toBe(false);
    expect(dealAppliesToProduct({ ...coupon, applicableProductIds: [wooId] }, wooId)).toBe(true);
  });

  it("keeps merchant and child identity in Woo coupon targets", () => {
    const original = dealProductId(wooProductFacts(wooProduct()));
    const merchant = dealProductId(wooProductFacts(wooProduct({ merchantId: "other-shop" })));
    const child = dealProductId(wooProductFacts(wooProduct({ variationId: 2002 })));
    expect(new Set([original, merchant, child]).size).toBe(3);
    expect(dealAppliesToProduct({ ...coupon, applicableProductIds: [original] }, merchant)).toBe(false);
    expect(dealAppliesToProduct({ ...coupon, applicableProductIds: [original] }, child)).toBe(false);
  });
});

describe("Woo SearchRun request and physical-read isolation", () => {
  it("dispatches at most two Woo reads while leaving budget for peer sources", async () => {
    const run = new SearchRun();
    const read = vi.fn(async () => { run.recordWooRead({ physicalRequests: 18, responseBytes: 8192 }); return "observed"; });
    await run.read("WOOCOMMERCE", "first-query", read);
    await run.read("WOOCOMMERCE", "second-query", read);
    expect(run.canRead("WOOCOMMERCE")).toBe(false);
    await expect(run.read("WOOCOMMERCE", "third-query", read)).rejects.toBeInstanceOf(SearchBudgetError);
    expect(read).toHaveBeenCalledTimes(2);
    expect(run.canRead("SHOPIFY")).toBe(true);
    expect(await run.read("SHOPIFY", "peer-query", async () => "peer")).toBe("peer");
    expect(run.diagnostics()).toMatchObject({ catalogRequests: 3, woocommerceRequests: 2, woocommerceHttpRequests: 36, woocommerceHttpBytes: 16384 });
    expect(JSON.stringify(run.diagnostics())).not.toContain("first-query");
  });

  it("shares pending and cached Woo reads without double counting physical requests or bytes", async () => {
    const run = new SearchRun();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const read = vi.fn(async () => { await gate; run.recordWooRead({ physicalRequests: 3, responseBytes: 1500 }); return { productIds: [2001] }; });
    const first = run.read("WOOCOMMERCE", "same-request", read);
    const concurrent = run.read("WOOCOMMERCE", "same-request", read);
    release();
    expect(await first).toEqual({ productIds: [2001] });
    expect(await concurrent).toEqual({ productIds: [2001] });
    expect(await run.read("WOOCOMMERCE", "same-request", read)).toEqual({ productIds: [2001] });
    expect(read).toHaveBeenCalledTimes(1);
    expect(run.diagnostics()).toMatchObject({ catalogRequests: 1, woocommerceRequests: 1, woocommerceHttpRequests: 3, woocommerceHttpBytes: 1500, cacheHits: 2 });
  });

  it("counts a service cache response as one source call and zero physical HTTP reads", async () => {
    const run = new SearchRun();
    await run.read("WOOCOMMERCE", "cached-upstream-request", async () => {
      run.recordWooRead({ physicalRequests: 0, responseBytes: 0 }); return [];
    });
    expect(run.diagnostics()).toMatchObject({ catalogRequests: 1, woocommerceRequests: 1, woocommerceHttpRequests: 0, woocommerceHttpBytes: 0, cacheHits: 0 });
  });
});
