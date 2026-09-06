import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { connectReplay, product, REPLAY_NOW, searchResult } from "./fixtures/conversation-replay-support.js";
import type { ProductCardContent } from "../src/server.js";

describe("Coupon current-message locale", () => {
  it.each(["zh-CN", "en-US"])("preserves original coupon facts in %s without claiming product eligibility", async responseLocale => {
    const offer = { dealId: "fixture-offer", merchant: "Ishow Hair", title: "Sitewide promotion", description: "Merchant terms apply",
      kind: "PROMO_CODE" as const, code: "FIXTURE18", discountPercent: 18, eligibility: [], channels: ["ONLINE" as const],
      sourceUrl: "https://ishowbeauty.com/pages/offers", productApplicability: "MERCHANT_WIDE" as const,
      checkedAt: REPLAY_NOW.toISOString(), validFrom: "2026-09-01T00:00:00Z", validTo: "2026-10-01T00:00:00Z", verificationStatus: "VERIFIED" as const };
    const replay = await connectReplay(async () => searchResult([product()]), { deals: { search: async () => [offer] } });
    try {
      const found = await replay.client.callTool({ name: "search_products", arguments: { query: "wig" } });
      const snapshot = found.structuredContent as ProductCardContent;
      const result = await replay.client.callTool({ name: "research_selected_product_deal", arguments: {
        renderId: snapshot.renderId, position: 1, responseLocale
      } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ locale: responseLocale, renderId: snapshot.renderId,
        deals: [expect.objectContaining({ code: "FIXTURE18", title: offer.title, sourceUrl: offer.sourceUrl })] });
      const message = String((result.structuredContent as Record<string, unknown>).message);
      expect(message).toContain(responseLocale === "zh-CN" ? "优惠码：FIXTURE18" : "code FIXTURE18");
      expect(message).toContain(responseLocale === "zh-CN" ? "仍需商家确认" : "require merchant confirmation");
    } finally { await replay.close(); }
  });
  it.each(["zh-CN", "en-US"])("uses %s after an opposite-language search without creating a Cart", async responseLocale => {
    const quote = vi.fn(async () => { throw new Error("UNEXPECTED_CART"); });
    let unavailable = false;
    const replay = await connectReplay(async () => searchResult([product()]), {
      cartQuotes: { quote }, deals: { search: async () => { if (unavailable) throw new Error("SOURCE_TIMEOUT"); return []; } }
    });
    try {
      const found = await replay.client.callTool({ name: "search_products", arguments: { query: "wig", responseLocale: responseLocale === "zh-CN" ? "en-US" : "zh-CN" } });
      const snapshot = found.structuredContent as ProductCardContent;
      for (const failed of [false, true]) {
        unavailable = failed;
        const result = await replay.client.callTool({ name: "research_selected_product_deal", arguments: {
          renderId: snapshot.renderId, selectionId: snapshot.products[0]!.selectionId, zipCode: "10001", responseLocale
        } });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({ locale: responseLocale, quoteStatus: "NOT_REQUESTED",
          dealLookupStatus: failed ? "UNAVAILABLE" : "COMPLETE" });
        const message = String((result.structuredContent as Record<string, unknown>)?.message);
        expect(message).toContain(responseLocale === "zh-CN" ? "所选商品" : "Selected product");
        expect(message).toContain(responseLocale === "zh-CN" ? "ZIP 不等于" : "ZIP alone does not authorize");
        if (failed) expect(message).toContain(responseLocale === "zh-CN" ? "不代表没有优惠" : "does not mean no coupon");
      }
      expect(quote).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });
  it.each(["zh-CN", "en-US"])("localizes foreign and expired references in %s", async responseLocale => {
    let current = REPLAY_NOW;
    const replay = await connectReplay(async () => searchResult([product()]), { now: () => current });
    try {
      const found = await replay.client.callTool({ name: "search_products", arguments: { query: "wig" } });
      const snapshot = found.structuredContent as ProductCardContent;
      for (const expired of [false, true]) {
        if (expired) current = new Date("2099-01-01T00:00:00Z");
        const result = await replay.client.callTool({ name: "research_selected_product_deal", arguments: {
          renderId: snapshot.renderId, selectionId: expired ? snapshot.products[0]!.selectionId : randomUUID(), responseLocale
        } });
        expect(result.structuredContent).toMatchObject({ locale: responseLocale, status: "SELECTION_UNAVAILABLE", deals: [] });
        const data = result.structuredContent as Record<string, unknown>;
        expect(String(data?.message)).toContain(responseLocale === "zh-CN" ? "商品" : "product");
        expect(data?.selectionId).toBeUndefined();
      }
    } finally { await replay.close(); }
  });
});
