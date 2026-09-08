import { describe, expect, it, vi } from "vitest";
import { isHighRatedProduct, type ProductRating } from "../src/merchant-trust.js";
import { choosePrimaryRecommendation } from "../src/product-recommendation.js";
import { countComparableMerchants, countQualifiedMatchCandidates, countRecommendationEligibleCandidates, selectPresentationCandidates } from "../src/product-candidate-ranking.js";
import { finalizeSnapshotProducts, summarizeSearchProducts } from "../src/search-result-summary.js";
import type { UnifiedCandidate } from "../src/search-products.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

// Fixed development evidence, not current prices or a live merchant endorsement.
function ratedOffer() {
  return { ...product({ merchantId: "rated-shop", merchant: "Rated shop", sourceHost: "rated.example",
    merchantUrl: "https://rated.example/products/headphones", handle: "headphones", title: "Sony WH-1000XM6 Black",
    brand: "Sony", mpn: "WH-1000XM6", condition: "NEW", gtins: ["0123456789012"], variantDimensions: { Color: "Black" },
    merchantTrust: { level: "UNKNOWN", verification: "UNVERIFIED", evidence: [] },
    recommendationTier: "HIGH_RATED_UNVERIFIED", productRating: { value: 4.9, count: 21, scaleMax: 5 },
    itemPrice: { amountCents: 34399, currency: "USD" } }),
    requestIdentityStatus: "CONFIRMED" as const, presentationGroup: "RESEARCH_ONLY" as const,
    requirementAssessment: { status: "SATISFIED" as const }, coupons: { verified: [] }, selectionId: "old-rated-reference" };
}

function ratedCandidate(): Extract<UnifiedCandidate, { source: "SHOPIFY_GLOBAL_CATALOG" }> {
  return { source: "SHOPIFY_GLOBAL_CATALOG", affiliateState: "NONE", recommendationTier: "HIGH_RATED_UNVERIFIED",
    shopifyProduct: ratedOffer(), identityStatus: "DISCOVERY_MATCH", requestIdentityStatus: "CONFIRMED", identityEvidence: [],
    featureEvidence: [], preferenceEvidence: [], requiredFeatureLimitations: [], resultGroup: "REQUESTED_PRODUCT", verifiedCoupons: [] };
}

describe("approved high-rating display policy", () => {
  it.each([false, true])("reconciles current recovery counts after a unified-search inspection loses its item price (all sources complete: %s)", async complete => {
    const original = product({ handle: "456", title: "Short human hair wig", merchantUrl: "https://ishowbeauty.com/products/wig?variant=456" });
    const missing = { ...original };
    delete missing.itemPrice;
    const inspect = vi.fn(async () => ({ productTitle: original.title, canonicalProductUrl: original.merchantUrl, variants: [missing] }));
    const replay = await connectReplay(async () => searchResult([original]), { selectedProducts: { inspect },
      ...(complete ? { awin: { search: async () => ({ source: "AWIN_PRODUCT_FEED" as const, coverage: "COMPLETE" as const,
        snapshotAt: "2026-09-04T19:51:00Z", products: [],
        diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 } }) } } : {}) });
    try {
      const found = await replay.client.callTool({ name: "search_products", arguments: {
        query: "wig", productType: "wig", conditionPreference: "NEW", comparisonMode: "DISCOVERY", responseLocale: "en-US"
      } });
      expect(found.isError).not.toBe(true);
      expect(found.structuredContent).toMatchObject({ products: [{ itemPrice: { amountCents: 3641 } }],
        recovery: { qualified: 1, qualifiedMatches: 1, recommendable: 1, awaitingVerification: 0 } });
      const old = found.structuredContent as { renderId: string; products: Array<{ selectionId: string; itemPrice: { amountCents: number } }>;
        recovery: { action: string; consentStatus?: string } };
      const inspected = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
        renderId: old.renderId, selectionId: old.products[0]!.selectionId, responseLocale: "en-US"
      } });
      expect(inspected.isError).not.toBe(true);
      expect(inspected.structuredContent).toMatchObject({ variants: [], updatedSnapshot: { products: [],
        recommendation: { state: "NO_MATCH" }, quality: { cardsReturned: 0, itemPricesVerified: 0 },
        diagnostics: { catalogVariantsReturned: 1 } } });
      const current = (inspected.structuredContent as { updatedSnapshot: { recovery: { action: string; consentStatus?: string } } }).updatedSnapshot;
      const emptyCurrentCounts = { qualified: 0, qualifiedMatches: 0, recommendable: 0, awaitingVerification: 0 };
      expect.soft(current.recovery).toMatchObject(emptyCurrentCounts);
      expect(current.recovery).toMatchObject({ reason: complete ? "NO_QUALIFIED_MATCH" : "SOURCE_UNAVAILABLE" });
      expect(current.recovery.action).toBe(old.recovery.action);
      expect(current.recovery.consentStatus).toBe(old.recovery.consentStatus);
      const contextBlock = (inspected.content as Array<{ type: string; text?: string }>).find(block =>
        block.type === "text" && block.text?.includes('"findcheapContext"'));
      expect(contextBlock?.type).toBe("text");
      const context = JSON.parse(contextBlock!.text!.split("\n")[1]!).findcheapContext;
      expect.soft(context.updatedSnapshot.recovery).toMatchObject(emptyCurrentCounts);
      expect(old.products[0]!.itemPrice.amountCents).toBe(3641);
    } finally { await replay.close(); }
  });

  it("recounts a mixed derived snapshot without discarding the remaining priced sibling", async () => {
    const original = product({ handle: "456", merchantUrl: "https://ishowbeauty.com/products/wig?variant=456" });
    const peer = product({ handle: "457", title: "Long human hair wig", merchantUrl: "https://ishowbeauty.com/products/long-wig?variant=457",
      itemPrice: { amountCents: 4700, currency: "USD" } });
    const missing = { ...original };
    delete missing.itemPrice;
    const replay = await connectReplay(async () => searchResult([original, peer]), { selectedProducts: {
      inspect: async () => ({ productTitle: original.title, canonicalProductUrl: original.merchantUrl, variants: [missing] })
    } });
    try {
      const found = await replay.client.callTool({ name: "search_products", arguments: { query: "wig", productType: "wig", responseLocale: "en-US" } });
      expect(found.isError).not.toBe(true);
      expect(found.structuredContent).toMatchObject({ recovery: { qualified: 2, qualifiedMatches: 2, recommendable: 2 } });
      const old = found.structuredContent as { renderId: string; products: Array<{ handle: string; selectionId: string }> };
      const inspected = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
        renderId: old.renderId, selectionId: old.products.find(entry => entry.handle === "456")!.selectionId
      } });
      expect(inspected.isError).not.toBe(true);
      expect(inspected.structuredContent).toMatchObject({ variants: [], updatedSnapshot: {
        products: [{ handle: "457", itemPrice: { amountCents: 4700 } }],
        comparison: { offerCount: 1, merchantCount: 1 }, quality: { cardsReturned: 1, itemPricesVerified: 1 },
        recovery: { qualified: 1, qualifiedMatches: 1, recommendable: 1, awaitingVerification: 0 }
      } });
      const restored = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: old.renderId } });
      expect(restored.structuredContent).toMatchObject({ products: [
        { handle: "456", itemPrice: { amountCents: 3641 } }, { handle: "457", itemPrice: { amountCents: 4700 } }
      ], recovery: { qualified: 2, qualifiedMatches: 2, recommendable: 2 } });
    } finally { await replay.close(); }
  });

  it("removes an unpriced legacy card from both final references and public prose", async () => {
    const missing = product({ title: "Removed unpriced item", merchantUrl: "https://rated.example/products/removed", sourceHost: "rated.example" });
    delete missing.itemPrice;
    const replay = await connectReplay(async () => searchResult([missing]));
    try {
      const result = await replay.client.callTool({ name: "search_shopify_products", arguments: {
        query: "wig", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE"
      } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ products: [], quality: { cardsReturned: 0, itemPricesVerified: 0 },
        recommendation: { state: "NO_MATCH" }, comparison: { offerCount: 0 } });
      expect(JSON.stringify(result.content)).not.toMatch(/returned 1 product card|Removed unpriced item|rated\.example\/products\/removed/);
      const structured = result.structuredContent as { message: string; diagnostics: { catalogProductsReturned: number } };
      expect(structured.message).not.toContain("returned 1 product card");
      expect(structured.diagnostics).toMatchObject({ catalogProductsReturned: 1 });
    } finally { await replay.close(); }
  });

  it("keeps a price-losing inspection's new snapshot prose consistent and the old card unchanged", async () => {
    const original = product({ handle: "456", title: "Short human hair wig", merchantUrl: "https://ishowbeauty.com/products/wig?variant=456" });
    const missing = { ...original };
    delete missing.itemPrice;
    const inspect = vi.fn(async () => ({
      productTitle: original.title, canonicalProductUrl: original.merchantUrl, variants: [missing]
    }));
    const replay = await connectReplay(async () => searchResult([original]), { selectedProducts: { inspect } });
    try {
      const found = await replay.client.callTool({ name: "search_shopify_products", arguments: {
        query: "wig", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE"
      } });
      const old = found.structuredContent as { renderId: string; products: Array<{ selectionId: string; itemPrice: { amountCents: number } }> };
      const inspected = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
        renderId: old.renderId, selectionId: old.products[0]!.selectionId
      } });
      expect(inspected.isError).not.toBe(true);
      expect(inspected.structuredContent).toMatchObject({ status: "OK", variants: [],
        updatedSnapshot: { products: [], quality: { cardsReturned: 0, itemPricesVerified: 0 }, recommendation: { state: "NO_MATCH" } } });
      const structured = inspected.structuredContent as { message: string; updatedSnapshot: { message: string } };
      expect(structured.updatedSnapshot.message).not.toContain("returned 1 product card");
      expect(structured.message).toContain("no verified USD item price");
      expect(structured.message).not.toContain("Inspected 0");
      expect(old.products[0]!.itemPrice.amountCents).toBe(3641);
      const recovered = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
        renderId: old.renderId, selectionId: old.products[0]!.selectionId
      } });
      expect(recovered.isError).not.toBe(true);
      expect(inspect).toHaveBeenLastCalledWith(expect.objectContaining({ handle: "456", itemPrice: { amountCents: 3641, currency: "USD" } }), {});
    } finally { await replay.close(); }
  });

  it("does not turn high-rating admission into Shopify quote authorization", async () => {
    const quote = vi.fn(async () => { throw new Error("UNEXPECTED_CART_WRITE"); });
    const consent = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
    const offer = { ...ratedOffer(), handle: "456", checkoutPlatform: "SHOPIFY" as const,
      merchantUrl: "https://rated.example/products/headphones?variant=456" };
    const replay = await connectReplay(async () => searchResult([offer]), { cartQuotes: { quote } }, consent);
    try {
      const found = await replay.client.callTool({ name: "search_products", arguments: {
        query: "Sony WH-1000XM6 Black", brand: "Sony", brandMode: "REQUIRED", productType: "headphones",
        conditionPreference: "NEW", comparisonMode: "SAME_PRODUCT", responseLocale: "zh-CN"
      } });
      expect(found.isError).not.toBe(true);
      expect(found.structuredContent).toMatchObject({ products: [{ presentationGroup: "TRUSTED_MATCH", quoteCapability: "NOT_CHECKED" }] });
      const content = found.structuredContent as { renderId: string; products: Array<{ selectionId: string }> };
      const result = await replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
        renderId: content.renderId, selectionId: content.products[0]!.selectionId, zipCode: "33065", responseLocale: "zh-CN"
      } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("QUOTE_CAPABILITY_NOT_CHECKED");
      expect(consent).not.toHaveBeenCalled();
      expect(quote).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("does not derive a high-rating badge from a stale tier marker without rating evidence", async () => {
    const stale = ratedOffer();
    delete stale.productRating;
    const replay = await connectReplay(async () => searchResult([stale]));
    try {
      const result = await replay.client.callTool({ name: "search_products", arguments: {
        query: "Sony WH-1000XM6 Black", brand: "Sony", brandMode: "REQUIRED", productType: "headphones",
        conditionPreference: "NEW", comparisonMode: "SAME_PRODUCT", responseLocale: "zh-CN"
      } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ products: [{ presentationGroup: "RESEARCH_ONLY",
        card: { merchantTrustBadge: "MERCHANT_UNVERIFIED" } }] });
    } finally { await replay.close(); }
  });

  it("returns priced high-rating matches through the real MCP schema and comparison without a primary or quote permission", async () => {
    const first = ratedOffer();
    const second = { ...first, handle: "headphones-other", merchantId: "other-shop", sourceHost: "other.example",
      merchantUrl: "https://other.example/products/headphones-other" };
    const missing = { ...first, handle: "unpriced" };
    delete missing.itemPrice;
    const replay = await connectReplay(async () => searchResult([first, second, missing]));
    try {
      const result = await replay.client.callTool({ name: "search_products", arguments: {
        query: "Sony WH-1000XM6 Black", brand: "Sony", brandMode: "REQUIRED", productType: "headphones",
        requiredFeatures: ["Black"], conditionPreference: "NEW", comparisonMode: "SAME_PRODUCT",
        compareMerchants: true, maxItemPriceCents: 35000, responseLocale: "zh-CN"
      } });
      expect(result.isError).not.toBe(true);
      const content = result.structuredContent as { renderId: string; message: string;
        products: Array<{ selectionId: string; presentationGroup: string; quoteCapability: string; itemPrice: { amountCents: number } }> };
      expect(content.products).toHaveLength(2);
      expect(content.products.every(entry => entry.presentationGroup === "TRUSTED_MATCH" && entry.itemPrice.amountCents === 34399)).toBe(true);
      expect(content.products.every(entry => entry.quoteCapability === "MERCHANT_CHECKOUT_ONLY")).toBe(true);
      expect(result.structuredContent).toMatchObject({ recommendation: { state: "MATCHES_AVAILABLE" },
        quality: { cardsReturned: 2, itemPricesVerified: 2 }, comparison: { merchantCount: 2, offerCount: 2 },
        recovery: { recommendable: 0, qualifiedMatches: 2 } });
      expect(content.message).not.toMatch(/所有卡片仅作为调研线索|找到 \d+ 张调研卡片/);
      const comparison = await replay.client.callTool({ name: "compare_selected_products", arguments: {
        renderId: content.renderId, selectionIds: content.products.map(entry => entry.selectionId), responseLocale: "zh-CN"
      } });
      expect(comparison.isError).not.toBe(true);
      expect(comparison.structuredContent).toMatchObject({ status: "OK", recommendation: { state: "MATCHES_AVAILABLE" },
        entries: content.products.map(entry => expect.objectContaining({ selectionId: entry.selectionId })) });
      expect((comparison.structuredContent as { recommendation: { recommendedSelectionId?: string } }).recommendation.recommendedSelectionId).toBeUndefined();
    } finally { await replay.close(); }
  });

  it("admits a priced requirement-matched product without granting merchant verification, primary or value status", () => {
    const original = ratedOffer();
    const [result] = finalizeSnapshotProducts([original], false, Date.now());
    expect(result).toMatchObject({ presentationGroup: "TRUSTED_MATCH", selectionId: "old-rated-reference",
      merchantTrust: { level: "UNKNOWN", verification: "UNVERIFIED" }, itemPrice: { amountCents: 34399 } });
    expect(result?.valueEvidence).toBeUndefined();
    expect(original.presentationGroup).toBe("RESEARCH_ONLY");
    expect(choosePrimaryRecommendation([original])).toEqual({ state: "MATCHES_AVAILABLE", reasonCodes: [] });
    expect(summarizeSearchProducts(result ? [result] : [])).toMatchObject({ productCount: 1, merchantCount: 1,
      recommendation: { state: "MATCHES_AVAILABLE" } });
  });

  it("uses the same qualified pool for tier two and retrieval coverage, never a tier marker alone", () => {
    const candidate = ratedCandidate();
    expect(selectPresentationCandidates([candidate], "MERCHANT_DIVERSE", false, false, false))
      .toMatchObject([{ presentationGroup: "TRUSTED_MATCH" }]);
    expect(countRecommendationEligibleCandidates([candidate])).toBe(0);
    expect(countQualifiedMatchCandidates([candidate])).toBe(1);
    const other = { ...candidate, shopifyProduct: { ...candidate.shopifyProduct!, merchantId: "other-shop",
      merchantUrl: "https://other.example/products/headphones" } };
    expect(countComparableMerchants([candidate, other])).toBe(2);
    const noRating = { ...candidate, shopifyProduct: { ...candidate.shopifyProduct! } };
    delete noRating.shopifyProduct.productRating;
    expect(countRecommendationEligibleCandidates([noRating])).toBe(0);
    expect(countQualifiedMatchCandidates([noRating])).toBe(0);
  });

  it("removes missing or invalid item prices before new snapshot counts without mutating old references", () => {
    const priced = ratedOffer();
    const unpriced = { ...priced, selectionId: "old-unpriced-reference" };
    delete unpriced.itemPrice;
    const invalid = { ...priced, selectionId: "old-invalid-reference", itemPrice: { amountCents: Number.NaN, currency: "USD" as const } };
    const result = finalizeSnapshotProducts([unpriced, priced, invalid], false, Date.now());
    expect(result.map(entry => entry.selectionId)).toEqual(["old-rated-reference"]);
    expect(summarizeSearchProducts(result)).toMatchObject({ productCount: 1, merchantCount: 1 });
    expect(unpriced.selectionId).toBe("old-unpriced-reference");
    expect(selectPresentationCandidates([{ ...ratedCandidate(), shopifyProduct: unpriced }], "MERCHANT_DIVERSE", false, false, false)).toEqual([]);
  });

  it("keeps genuine item prices when the delivered total is not quoted", () => {
    const offer = { ...ratedOffer(), pricing: { deliveredPrice: { status: "UNAVAILABLE" as const } } };
    expect(finalizeSnapshotProducts([offer], false, Date.now())).toHaveLength(1);
  });

  it("retains an actual verified zero-dollar item price rather than conflating it with missing price", () => {
    const offer = { ...ratedOffer(), itemPrice: { amountCents: 0, currency: "USD" as const } };
    expect(finalizeSnapshotProducts([offer], false, Date.now())).toMatchObject([
      { itemPrice: { amountCents: 0, currency: "USD" }, presentationGroup: "TRUSTED_MATCH" }
    ]);
  });

  it("does not carry a prior best-value label or coupon saving into a rating-only match", () => {
    const offer = { ...ratedOffer(), presentationGroup: "BEST_VALUE" as const,
      valueEvidence: { reason: "CONFIRMED_COUPON_SAVINGS" as const, amountCents: 1000, currency: "USD" as const, basis: "ITEM_PRICE" as const } };
    const [result] = finalizeSnapshotProducts([offer], false, Date.now());
    expect(result?.presentationGroup).toBe("TRUSTED_MATCH");
    expect(result?.valueEvidence).toBeUndefined();
  });

  it.each([
    { requestIdentityStatus: "NEEDS_VERIFICATION" as const },
    { requirementAssessment: { status: "CONFLICT" as const } },
    { requirementAssessment: { status: "NEEDS_VERIFICATION" as const } },
    { merchantTrust: { level: "RISKY" as const, verification: "UNVERIFIED" as const, evidence: [] } },
    { availability: "OUT_OF_STOCK" as const },
    { visualReviewRequired: true },
    { matchStatus: "SIMILAR" as const }
  ])("retains hard and safety gates for rating-only matches: %j", override => {
    const offer = { ...ratedOffer(), ...override };
    expect(finalizeSnapshotProducts([offer], false, Date.now())[0]?.presentationGroup).toBe("RESEARCH_ONLY");
    expect(choosePrimaryRecommendation([offer]).state).toBe("RESEARCH_ONLY");
  });

  it("keeps an independently reviewed merchant eligible without any product rating", () => {
    const offer = { ...ratedOffer(), productRating: undefined, recommendationTier: "TRUSTED_OR_AFFILIATE" as const,
      merchantTrust: { level: "ESTABLISHED_RETAILER" as const, verification: "INDEPENDENT" as const, evidence: ["fixture"] } };
    expect(finalizeSnapshotProducts([offer], false, Date.now())[0]?.presentationGroup).toBe("TRUSTED_MATCH");
    expect(choosePrimaryRecommendation([offer])).toMatchObject({ state: "READY", primaryProductIndex: 0 });
  });

  it.each([
    [{ value: 3.8, count: 100, scaleMax: 5 }, false],
    [{ value: 3.9, count: 2, scaleMax: 5 }, true],
    [{ value: 5, count: 1, scaleMax: 5 }, false],
    [{ value: 6, count: 2, scaleMax: 5 }, false],
    [{ value: 4.9, count: 2.5, scaleMax: 5 }, false],
    [{ value: 4.9, count: 21, scaleMax: 10 }, false],
    [{ value: Number.NaN, count: 21, scaleMax: 5 }, false]
  ])("validates the rating object, not only its tier: %j", (rating, expected) => {
    expect(isHighRatedProduct(rating as ProductRating)).toBe(expected);
  });
});
