import { describe, expect, it, vi } from "vitest";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";
import type { ShopifyProduct } from "../src/shopify-client.js";
import { productReferenceKey } from "../src/product-reference.js";

function collidingProducts() {
  return [product({ handle: "same-variant", title: "Short human hair wig A", itemPrice: { amountCents: 1000, currency: "USD" },
    merchantUrl: "https://ishowbeauty.com/products/wig-a" }),
  product({ merchantId: "hairsofly", merchant: "HAIRSOFLY SHOP", sourceHost: "hairsoflyshop.com", handle: "same-variant",
    title: "Short human hair wig B", itemPrice: { amountCents: 2000, currency: "USD" },
    merchantUrl: "https://hairsoflyshop.com/products/wig-b" })];
}

type Snapshot = { renderId: string; products: Array<{ title: string; merchantId: string; handle: string; selectionId: string;
  itemPrice: { amountCents: number }; merchantUrl: string }> };

describe("merchant-qualified product reference", () => {
  it("separates source kind, merchant, host and variant without delimiter collisions", () => {
    const base = { merchantId: "a:b", sourceHost: "SHOP.EXAMPLE", handle: "c" };
    expect(productReferenceKey(base)).toBe(productReferenceKey({ ...base, sourceHost: "shop.example" }));
    expect(new Set([base, { ...base, merchantId: "a", handle: "b:c" }, { ...base, sourceHost: "other.example" },
      { ...base, sourceKind: "AWIN_PRODUCT_FEED" as const }].map(productReferenceKey)).size).toBe(4);
  });

  it("keeps same-handle merchant cards, prices and URLs separate through unified enrichment", async () => {
    const originals = collidingProducts();
    const replay = await connectReplay(async () => searchResult(originals));
    try {
      const response = await replay.client.callTool({ name: "search_products", arguments: {
        query: "wig", productType: "wig", comparisonMode: "DISCOVERY", contextMode: "NEW_PRODUCT", limit: 8
      } });
      expect(response.isError).not.toBe(true);
      const snapshot = response.structuredContent as Snapshot;
      expect(snapshot.products).toHaveLength(2);
      expect(snapshot.products.map(({ merchantId, itemPrice, merchantUrl }) => ({ merchantId, itemPrice, merchantUrl })))
        .toEqual(originals.map(({ merchantId, itemPrice, merchantUrl }) => ({ merchantId, itemPrice, merchantUrl })));
    } finally { await replay.close(); }
  });

  it("binds selection and position to the correct merchant, rejecting ambiguous variant-only requests", async () => {
    const inspect = vi.fn(async () => { throw new Error("STOP_AFTER_IDENTITY_CHECK"); });
    const replay = await connectReplay(async () => searchResult(collidingProducts()), { selectedProducts: { inspect } });
    try {
      const response = await replay.client.callTool({ name: "search_shopify_products", arguments: { query: "wig", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE" } });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const snapshot = response.structuredContent as Snapshot;
      expect(snapshot.products).toHaveLength(2);
      const second = snapshot.products[1]!;
      await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, selectionId: second.selectionId
      } });
      expect(inspect).toHaveBeenLastCalledWith(expect.objectContaining({ merchantId: second.merchantId }), {});
      await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: { renderId: snapshot.renderId, position: 2 } });
      expect(inspect).toHaveBeenLastCalledWith(expect.objectContaining({ merchantId: second.merchantId }), {});
      inspect.mockClear();
      const ambiguous = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, variantId: "same-variant"
      } });
      expect(ambiguous.isError).toBe(true);
      expect(inspect).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("keeps selected deal research bound to the merchant instead of first matching handle", async () => {
    const replay = await connectReplay(async () => searchResult(collidingProducts()));
    try {
      const response = await replay.client.callTool({ name: "search_shopify_products", arguments: { query: "wig", comparisonMode: "DISCOVERY", selectionMode: "MERCHANT_DIVERSE" } });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const snapshot = response.structuredContent as Snapshot;
      const second = snapshot.products[1]!;
      const research = await replay.client.callTool({ name: "research_selected_product_deal", arguments: {
        renderId: snapshot.renderId, selectionId: second.selectionId, objective: "CURRENT_DEALS"
      } });
      expect(research.isError).not.toBe(true);
      expect(research.structuredContent).toMatchObject({ selectedProduct: { title: second.title } });
    } finally { await replay.close(); }
  });

  it("quotes and compares two colliding handles using each selected merchant's own price", async () => {
    const quote = vi.fn(async (selected: ShopifyProduct) => {
      const cents = selected.itemPrice!.amountCents;
      return {
        status: "ESTIMATED" as const, subtotal: { amountCents: cents, currency: "USD" as const },
        shipping: { amountCents: 0, currency: "USD" as const, label: "Standard" },
        tax: { status: "ZIP_ESTIMATED" as const, amount: { amountCents: 100, currency: "USD" as const },
          jurisdiction: "FL", rateBasisPoints: 698, source: "TAX_FOUNDATION_STATE_AVERAGE_2026" as const },
        deliveredPrice: { amountCents: cents + 100, currency: "USD" as const }, totalEstimated: true,
        checkedAt: "2026-09-04T19:51:00.000Z", expiresAt: "2026-09-04T20:01:00.000Z"
      };
    });
    const replay = await connectReplay(async () => searchResult(collidingProducts().map((entry) => ({ ...entry, checkoutPlatform: "SHOPIFY" as const }))),
      { cartQuotes: { quote } });
    try {
      const response = await replay.client.callTool({ name: "search_products", arguments: { query: "wig", productType: "wig", comparisonMode: "DISCOVERY" } });
      const snapshot = response.structuredContent as Snapshot;
      const second = snapshot.products[1]!;
      const single = await replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, selectionId: second.selectionId, zipCode: "33433"
      } });
      expect(single.isError, JSON.stringify(single.content)).not.toBe(true);
      expect(single.structuredContent).toMatchObject({ products: [{ merchantId: second.merchantId,
        pricing: { deliveredPrice: { amount: { amountCents: 2100 } } } }] });
      const comparison = await replay.client.callTool({ name: "quote_and_compare_selected_products", arguments: {
        renderId: snapshot.renderId, selectionIds: snapshot.products.map(({ selectionId }) => selectionId), zipCode: "33433", mode: "PRODUCT_CHOICES"
      } });
      expect(comparison.isError, JSON.stringify(comparison.content)).not.toBe(true);
      expect(quote.mock.calls.map(([selected]) => selected.merchantId)).toEqual(["hairsofly", "ishow", "hairsofly"]);
      quote.mockRejectedValueOnce(new Error("TEMPORARY_QUOTE_FAILURE"));
      const failed = await replay.client.callTool({ name: "quote_selected_shopify_product", arguments: {
        renderId: snapshot.renderId, selectionId: second.selectionId, zipCode: "33433"
      } });
      expect(failed.structuredContent).toMatchObject({ products: [
        { merchantId: "ishow", quoteCapability: "DELIVERED_TOTAL_SUPPORTED" },
        { merchantId: "hairsofly", quoteCapability: "MERCHANT_CHECKOUT_ONLY" }
      ] });
    } finally { await replay.close(); }
  });

  it("deduplicates a cross-round alternate image of the same product while retaining the stronger review", async () => {
    const originals = Array.from({ length: 7 }, (_, index) => product({ handle: `same-item-${index}`,
      title: `Black Mini Dress ${index}`, productType: "dress", description: "black boat neck mini dress",
      itemPrice: { amountCents: 59800, currency: "USD" },
      imageUrl: `https://cdn.shopify.com/original-${index}.jpg`, merchantUrl: `https://ishowbeauty.com/products/same-item-${index}`
    }));
    const alternateView = { ...originals[0]!, imageUrl: "https://cdn.shopify.com/alternate-view.jpg" };
    const search = vi.fn(async (input: { query?: string | undefined }) => searchResult(
      input.query?.includes("initialhint") === true ? originals : [alternateView]
    ));
    // An alternate view must contain different pixels, not just a different URL.
    const load = vi.fn(async (url: string) => ({ data: Buffer.from(url).toString("base64"), mimeType: "image/jpeg" as const }));
    const replay = await connectReplay(search, { visualCandidateImages: { load } });
    try {
      const first = await replay.client.callTool({ name: "search_visual_candidates", arguments: {
        query: "black mini dress", productType: "dress", comparisonMode: "DISCOVERY", contextMode: "NEW_PRODUCT",
        visualInput: { productType: "dress", suspectedProductName: "initialhint", colors: ["black"], neckline: "boat neck", length: "mini",
          distinctiveDetails: ["horizontal lace bands"] }
      } });
      type Session = { visualSessionId: string; candidates: Array<{ candidateId: string; title: string }> };
      const firstSession = first.structuredContent as Session;
      expect(firstSession.candidates).toHaveLength(6);
      const matches = [
        { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
        { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "boat neck" },
        { attribute: "LENGTH", referenceEvidence: "mini", candidateEvidence: "mini" },
        { attribute: "DISTINCTIVE_DETAIL", referenceEvidence: "horizontal lace bands", candidateEvidence: "horizontal lace bands" }
      ];
      const reject = { classification: "CONFLICT", conflicts: [
        { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "V neck" }
      ] };
      const continuation = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: firstSession.visualSessionId,
        verdicts: firstSession.candidates.map(({ candidateId, title }) => ({ candidateId, verdict: title === originals[0]!.title
          ? { classification: "HIGHLY_SIMILAR", matches: matches.slice(0, 2), conflicts: [] } : reject }))
      } });
      expect(continuation.isError, JSON.stringify(continuation.content)).not.toBe(true);
      const secondSession = (continuation.structuredContent as { visualReview: Session }).visualReview;
      expect(secondSession.candidates.map(({ title }) => title)).toEqual([originals[6]!.title, originals[0]!.title]);
      expect(secondSession.visualSessionId).not.toBe(firstSession.visualSessionId);
      const firstIds = new Set(firstSession.candidates.map(({ candidateId }) => candidateId));
      expect(secondSession.candidates.every(({ candidateId }) => !firstIds.has(candidateId))).toBe(true);
      const final = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: secondSession.visualSessionId,
        verdicts: secondSession.candidates.map(({ candidateId, title }) => ({ candidateId, verdict: title === originals[0]!.title
          ? { classification: "POSSIBLE_SAME_ITEM", matches, conflicts: [] } : reject }))
      } });
      expect(final.isError, JSON.stringify(final.content)).not.toBe(true);
      expect(final.structuredContent).toMatchObject({ products: [{ title: originals[0]!.title, handle: originals[0]!.handle,
        merchantId: originals[0]!.merchantId, merchantUrl: originals[0]!.merchantUrl, itemPrice: originals[0]!.itemPrice,
        visualMatchGroup: "POSSIBLE_SAME_ITEM", visualReviewAssessment: { group: "POSSIBLE_SAME_ITEM", structuralMatchCount: 3, matchCount: 4 }
      }] });
      expect((final.structuredContent as Snapshot).products).toHaveLength(1);
      expect(load).toHaveBeenCalledTimes(8);
      expect(final.structuredContent).not.toHaveProperty("visualReview");
    } finally { await replay.close(); }
  });
});
