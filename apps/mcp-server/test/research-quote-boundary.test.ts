import { describe, expect, it, vi } from "vitest";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

describe("read-only research quote boundary", () => {
  it.each(["search_products", "search_shopify_products"])("does not create a cart for a ZIP supplied to %s", async name => {
    const quote = vi.fn(async () => { throw new Error("UNEXPECTED_CART_WRITE"); });
    const search = vi.fn(async () => searchResult([product({ checkoutPlatform: "SHOPIFY" })]));
    const replay = await connectReplay(search, { cartQuotes: { quote } });
    try {
      const response = await replay.client.callTool({ name, arguments: {
        query: "short human hair wig", ...(name === "search_products" ? { productType: "wig" } : {}), comparisonMode: "DISCOVERY",
        selectionMode: "MERCHANT_DIVERSE", zipCode: "10001"
      } });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      expect(response.structuredContent).toMatchObject({ cartQuoteCoverage: { attempted: 0, succeeded: 0 },
        pricingContext: { zipCode: "10001" }, products: [{ itemPrice: { amountCents: 3_641 } }] });
      expect(quote).not.toHaveBeenCalled();
      expect(search).toHaveBeenCalledWith(expect.objectContaining({ zipCode: "10001" }));
    } finally { await replay.close(); }
  });

  it.each(["CURRENT_DEALS", "CHEAPEST_PATH"])("keeps %s coupon research read-only with ZIP", async objective => {
    const quote = vi.fn(async () => { throw new Error("UNEXPECTED_CART_WRITE"); });
    const replay = await connectReplay(async () => searchResult([product({ handle: "456", checkoutPlatform: "SHOPIFY" })]),
      { cartQuotes: { quote } });
    try {
      const search = await replay.client.callTool({ name: "search_products", arguments: {
        query: "short human hair wig", productType: "wig", comparisonMode: "DISCOVERY"
      } });
      expect(search.isError).not.toBe(true);
      const snapshot = search.structuredContent as { renderId: string; products: Array<{ selectionId: string }> };
      expect(snapshot.products).toHaveLength(1);
      const research = await replay.client.callTool({ name: "research_selected_product_deal", arguments: {
        renderId: snapshot.renderId, selectionId: snapshot.products[0]!.selectionId, zipCode: "10001", objective
      } });
      expect(research.isError).not.toBe(true);
      expect(research.structuredContent).toMatchObject({ quoteStatus: "NOT_REQUESTED",
        currentPrice: { basis: "ITEM_PRICE", amount: { amountCents: 3_641 } } });
      expect(quote).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("keeps visual finalization read-only when the original search includes ZIP", async () => {
    const quote = vi.fn(async () => { throw new Error("UNEXPECTED_CART_WRITE"); });
    const dress = product({ handle: "456", title: "Black boat neck cap sleeve mini dress", productType: "dress",
      description: "Black boat neck cap sleeve mini dress", checkoutPlatform: "SHOPIFY",
      merchantUrl: "https://ishowbeauty.com/products/dress", imageUrl: "https://cdn.shopify.com/dress.jpg" });
    const replay = await connectReplay(async () => searchResult([dress]), { cartQuotes: { quote } });
    try {
      const first = await replay.client.callTool({ name: "search_visual_candidates", arguments: {
        query: "black mini dress", productType: "dress", zipCode: "10001", visualInput: {
          productType: "dress", colors: ["black"], neckline: "boat neck", sleeveType: "cap sleeve", length: "mini"
        }
      } });
      expect(first.isError).not.toBe(true);
      const session = first.structuredContent as { visualSessionId: string; candidates: Array<{ candidateId: string }> };
      expect(session.candidates).toHaveLength(1);
      const final = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: session.visualSessionId, verdicts: [{ candidateId: session.candidates[0]!.candidateId, verdict: {
          classification: "HIGHLY_SIMILAR", matches: [
            { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "boat neck" },
            { attribute: "SLEEVE", referenceEvidence: "cap sleeve", candidateEvidence: "cap sleeve" },
            { attribute: "LENGTH", referenceEvidence: "mini", candidateEvidence: "mini" }
          ], conflicts: []
        } }]
      } });
      expect(final.isError).not.toBe(true);
      expect(final.structuredContent).toMatchObject({ cartQuoteCoverage: { attempted: 0, succeeded: 0 },
        products: [{ itemPrice: { amountCents: 3_641 } }] });
      expect(quote).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });
});
