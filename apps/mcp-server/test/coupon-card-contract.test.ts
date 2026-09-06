import { describe, expect, it, vi } from "vitest";
import { connectReplay, product, REPLAY_NOW, searchResult } from "./fixtures/conversation-replay-support.js";
import type { ProductCardContent } from "../src/server.js";

const sitewide = {
  dealId: "sitewide", merchant: "Ishow Hair", title: "18% off sitewide", description: "Anniversary sale",
  kind: "PROMO_CODE" as const, code: "IS18", eligibility: ["NO"], channels: ["ONLINE" as const],
  sourceUrl: "https://ishowbeauty.com/pages/offers", productApplicability: "MERCHANT_WIDE" as const,
  checkedAt: REPLAY_NOW.toISOString(), validFrom: "2026-09-01T00:00:00Z", validTo: "2026-10-01T00:00:00Z", verificationStatus: "VERIFIED" as const
};
const wholesale = { ...sitewide, dealId: "wholesale", code: "WS30", title: "30% off", description: "Wholesale package deal" };

describe("shared Coupon card and selected-deal contract", () => {
  it.each(["zh-CN", "en-US"])("counts 29 unique merchant offers across three products and gives a bounded %s summary", async responseLocale => {
    const offers = [wholesale, sitewide, ...Array.from({ length: 27 }, (_, index) => ({ ...wholesale, dealId: `bulk-${index}` }))];
    const quote = vi.fn(async () => { throw new Error("UNEXPECTED_CART"); });
    const replay = await connectReplay(async () => searchResult(Array.from({ length: 3 }, (_, index) => product({ handle: `wig-${index}` }))), {
      deals: { search: async () => offers }, cartQuotes: { quote }
    });
    try {
      const found = await replay.client.callTool({ name: "search_products", arguments: { query: "wig", responseLocale } });
      const snapshot = found.structuredContent as ProductCardContent;
      expect(snapshot.products).toHaveLength(3);
      expect(snapshot.quality.couponsVerified).toBe(29);
      for (const card of snapshot.products) {
        expect(card.card.couponLabel).toBe("Merchant offer: IS18");
        expect(card.coupons.summary).toMatchObject({ status: "MERCHANT_CANDIDATE", recommendedDealId: "sitewide" });
        expect(card.coupons.estimatedItemPriceAfterCoupon).toBeUndefined();
        expect(card.coupons.verified).toHaveLength(29);
      }
      const ids = snapshot.products.slice(0, 2).map(p => p.selectionId!);
      const comparison = await replay.client.callTool({ name: "compare_selected_products", arguments: { renderId: snapshot.renderId, selectionIds: ids, responseLocale } });
      expect(comparison.isError).not.toBe(true);
      const selected = await replay.client.callTool({ name: "research_selected_product_deal", arguments: {
        renderId: snapshot.renderId, selectionId: ids[0], responseLocale, zipCode: "10001"
      } });
      expect(selected.structuredContent).toMatchObject({ renderId: snapshot.renderId, selectionId: ids[0], quoteStatus: "NOT_REQUESTED",
        dealSummary: { status: "MERCHANT_CANDIDATE", recommendedDealId: "sitewide" }, deals: expect.any(Array) });
      const message = String((selected.structuredContent as Record<string, unknown>).message);
      expect(message).toContain("IS18");
      expect(message).not.toContain("WS30");
      expect(message).not.toContain("eligibility: NO");
      expect(message.length).toBeLessThan(1600);
      expect(message).toContain(responseLocale === "zh-CN" ? "需商家确认" : "merchant confirmation required");
      expect(quote).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("never adds a raw card label when all offers fail selected-product eligibility", async () => {
    const replay = await connectReplay(async () => searchResult([product()]), { deals: { search: async () => [wholesale] } });
    try {
      const result = await replay.client.callTool({ name: "search_products", arguments: { query: "wig" } });
      const card = (result.structuredContent as ProductCardContent).products[0]!;
      expect(card.coupons.summary?.status).toBe("NO_ELIGIBLE_DEAL");
      expect(card.card.couponLabel).toBeUndefined();
    } finally { await replay.close(); }
  });
});
