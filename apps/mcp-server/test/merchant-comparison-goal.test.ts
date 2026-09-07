import { describe, expect, it } from "vitest";
import { SearchProductsInputSchema, searchProducts } from "../src/search-products.js";
import { mergeSearchRequirements } from "../src/search-requirements-context.js";
import { textSearchRecovery } from "../src/text-search-recovery.js";
import type { ShopifyProduct } from "../src/shopify-client.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

const request = { query: "Sony WH-1000XM6", productType: "headphones", brand: "Sony",
  comparisonMode: "SAME_PRODUCT", compareMerchants: true, requiredFeatures: ["black"], conditionPreference: "NEW", responseLocale: "zh-CN" };
const sony = (host = "sony.com", handle = "1") => product({ sourceHost: host, merchantId: host, merchant: host,
  handle, title: "Sony WH-1000XM6 Black", brand: "Sony", productType: "headphones", gtins: ["0123456789012"],
  variantDimensions: { Color: "Black" }, matchStatus: "EXACT", merchantUrl: `https://${host}/products/wh1000xm6?variant=${handle}` });
const awin = { search: async () => ({ source: "AWIN_PRODUCT_FEED" as const, coverage: "COMPLETE" as const,
  snapshotAt: new Date().toISOString(), products: [], diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 } }) };

describe("explicit merchant comparison is distinct from finding a product", () => {
  it("retains a single trusted match but requests bounded recovery for the unfinished comparison", async () => {
    const replay = await connectReplay(async () => searchResult([sony()]), { awin });
    try {
      const result = await replay.client.callTool({ name: "search_products", arguments: request });
      expect(result.structuredContent).toMatchObject({ products: [expect.objectContaining({ brand: "Sony" })],
        recommendation: { state: "READY" }, recovery: { action: "REQUEST_WEB_SEARCH", reason: "COMPARISON_INCOMPLETE", comparableMerchants: 1 } });
      expect(result.structuredContent).toMatchObject({ comparison: { merchantCount: 1, offerCount: 1, status: "DISCOVERY_ONLY" } });
      expect((result.structuredContent as { message: string }).message).not.toContain("没有返回符合要求的同款");
      expect((result.structuredContent as { message: string }).message).toContain("跨商家比价尚未完成");
    } finally { await replay.close(); }
  });

  it("keeps ordinary exact-product search on its existing fast path", async () => {
    const input = SearchProductsInputSchema.parse({ ...request, compareMerchants: false });
    const result = await searchProducts(input, { awin, shopify: { search: async () => searchResult([sony()]) } });
    expect(textSearchRecovery(result, false, false)).toMatchObject({ action: "NONE", reason: "MATCH_FOUND" });
  });

  it("counts distinct trusted domains, not variants or unknown sellers", async () => {
    const input = SearchProductsInputSchema.parse(request);
    for (const [items, count] of [
      [[sony(), sony("www.sony.com", "2")], 1],
      [[sony(), sony("bhphotovideo.com")], 2],
      [[sony(), { ...sony("unknown.example"), merchantTrust: { level: "UNKNOWN" as const, verification: "UNVERIFIED" as const, evidence: [] } }], 1]
    ] as [ShopifyProduct[], number][]) {
      const result = await searchProducts(input, { awin, shopify: { search: async () => searchResult([...items]) } });
      expect(textSearchRecovery(result, false, true)).toMatchObject({ comparableMerchants: count,
        reason: count === 1 ? "COMPARISON_INCOMPLETE" : "MATCH_FOUND" });
    }
  });

  it("inherits the explicit intent and only clears it when explicitly withdrawn", () => {
    const previous = SearchProductsInputSchema.parse(request);
    const current = { query: "Sony WH-1000XM6", contextMode: "CONTINUE_PREVIOUS_PRODUCT", maxItemPriceCents: 40000 };
    expect(mergeSearchRequirements(SearchProductsInputSchema.parse(current), previous)).toMatchObject({ compareMerchants: true });
    expect(mergeSearchRequirements(SearchProductsInputSchema.parse({ ...current, compareMerchants: false }), previous))
      .toMatchObject({ compareMerchants: false });
  });
});
