import { describe, expect, it } from "vitest";
import { connectReplay, REPLAY_NOW, searchResult } from "./fixtures/conversation-replay-support.js";
import type { ProductCardContent } from "../src/server.js";
import type { AwinProduct } from "../../../packages/awin-feed/src/index.js";

const products: AwinProduct[] = ["Finger Wave / Natura Black", "8 / Brazilian Hair / Natural Black", "8 / Indian Hair / Natural Black"].map((variant, index) => ({
  merchantId: "50707", merchant: "Ishow Hair", merchantProductId: String(123456 + index),
  title: `Short Human Hair Wig - ${variant}`, category: "wig", matchStatus: "DISCOVERY_MATCH", matchEvidence: [], condition: "UNKNOWN",
  itemPrice: { amountCents: 3641 + index * 1000, currency: "USD" }, availability: "IN_STOCK",
  merchantUrl: `https://ishowbeauty.com/products/${index === 0 ? "finger-wave" : "u-part"}?variant=${123456 + index}`,
  affiliateUrl: `https://www.awin1.com/pclick.php?p=${index}&a=3047955&m=50707`, checkedAt: REPLAY_NOW.toISOString()
}));

describe("Awin reported specifications through immutable cards and comparison", () => {
  it("preserves each variant's source text, price and selection without inventing quality or units", async () => {
    const replay = await connectReplay(async () => searchResult([]), { awin: { search: async () => ({
      source: "AWIN_PRODUCT_FEED", coverage: "COMPLETE", snapshotAt: REPLAY_NOW.toISOString(), products,
      diagnostics: { feedRows: 3, validRows: 3, rejectedRows: 0, queryMatches: 3, priceProductsExcluded: 0 }
    }) } });
    try {
      const found = await replay.client.callTool({ name: "search_products", arguments: { query: "wig", productType: "wig", comparisonMode: "DISCOVERY" } });
      const snapshot = found.structuredContent as ProductCardContent;
      expect(snapshot.products).toHaveLength(3);
      expect(snapshot.products[0]!.displayFamilyKey).toEqual(expect.any(String));
      expect(snapshot.products[1]!.displayFamilyKey).toBe(snapshot.products[2]!.displayFamilyKey);
      expect(snapshot.products[0]!.displayFamilyKey).not.toBe(snapshot.products[1]!.displayFamilyKey);
      for (const card of snapshot.products) {
        const original = products.find(p => p.merchantProductId === card.handle)!;
        expect(card.variantDimensions).toEqual({ "Merchant variant": original.title.split(" - ")[1] });
        expect(card.itemPrice).toEqual(original.itemPrice);
        expect(card.condition).toBe("UNKNOWN");
        expect(JSON.stringify(card.variantDimensions)).not.toMatch(/inch|verified|verified quality/iu);
      }
      const ids = snapshot.products.slice(0, 2).map(p => p.selectionId!);
      const compared = await replay.client.callTool({ name: "compare_selected_products", arguments: { renderId: snapshot.renderId, selectionIds: ids } });
      expect(compared.isError).not.toBe(true);
      expect(compared.structuredContent).toMatchObject({ entries: snapshot.products.slice(0, 2).map(p => ({ selectionId: p.selectionId, variantDimensions: p.variantDimensions })) });
    } finally { await replay.close(); }
  });
});
