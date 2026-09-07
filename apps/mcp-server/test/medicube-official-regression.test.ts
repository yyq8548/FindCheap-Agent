import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMerchantTrust, resolveVerifiedOfficialStorefront, replaceManagedMerchantTrustRecords, resetManagedMerchantTrustRecords } from "../src/merchant-trust.js";
import { DEFAULT_OFFICIAL_STOREFRONT_REGISTRY } from "../../awin-feed-service/src/official-storefront-registry.js";
import { EMBEDDED_MERCHANT_TRUST_REGISTRY } from "../../../packages/contracts/src/merchant-trust-registry.js";
import { createOfficialShopifySearchPort } from "../src/shopify-official-store-search.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

describe("R10 medicube source coverage without weakening requirements", () => {
  it.each(["medicube Zero Pore Pad Mild", "medicube Zero Pore Madecassoside Pads (Mild)"])(
    "continues the original goal after inspection and explicit edition confirmation: %s", async query => {
      const mild = product({ merchantId: "medicube", merchant: "medicube", sourceHost: "medicube.us", brand: "medicube",
        title: "Zero Pore Madecassoside Pads (Mild)", productType: "toner pads", description: "medicube Zero Pore Pad Mild. Net wt. 155g (70 pads)",
        handle: "41268489650224", merchantUrl: "https://medicube.us/products/zero-pore-pads-mild?variant=41268489650224" });
      const other = { ...mild, merchantId: "other", sourceHost: "other.example", merchantUrl: "https://other.example/products/pads?variant=41268489650224" };
      const search = vi.fn(async () => searchResult([mild, other]));
      const replay = await connectReplay(search, { selectedProducts: { inspect: async () => ({
        productTitle: mild.title, canonicalProductUrl: "https://medicube.us/products/zero-pore-pads-mild", variants: [mild]
      }) } });
      try {
        const first = await replay.client.callTool({ name: "search_products", arguments: {
          query: "medicube Zero Pore Pad", brand: "medicube", productType: "toner pads", requiredSize: "70 pads, 155g",
          maxItemPriceCents: 5000, compareMerchants: true, comparisonMode: "SAME_PRODUCT", responseLocale: "zh-CN"
        } });
        const original = first.structuredContent as { renderId: string; goalId: string; products: { selectionId: string }[] };
        expect(original.products, JSON.stringify(first.structuredContent)).toHaveLength(2);
        const inspect = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
          renderId: original.renderId, position: 1
        } });
        expect(inspect.isError, JSON.stringify(inspect)).not.toBe(true);
        const next = await replay.client.callTool({ name: "search_products", arguments: {
          query, contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: original.renderId, responseLocale: "zh-CN"
        } });
        expect(next.isError).not.toBe(true);
        expect(next.structuredContent).toMatchObject({ goalId: original.goalId });
        const updated = next.structuredContent as typeof original;
        expect(updated.products).toHaveLength(2);
        for (const card of updated.products) expect(card).toMatchObject({ requestIdentityStatus: "CONFIRMED", requirementAssessment: { status: "SATISFIED" } });
        const ids = updated.products.map(card => card.selectionId);
        const comparison = await replay.client.callTool({ name: "compare_selected_products", arguments: {
          renderId: updated.renderId, selectionIds: ids, responseLocale: "zh-CN"
        } });
        expect(comparison.isError).not.toBe(true);
        expect(comparison.structuredContent).toMatchObject({ entries: ids.map(selectionId => expect.objectContaining({ selectionId, requestIdentityStatus: "CONFIRMED" })) });
        const historical = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: original.renderId } });
        expect(historical.structuredContent).toMatchObject({ products: original.products.map(card => expect.objectContaining({ selectionId: card.selectionId,
          requestIdentityStatus: "NEEDS_VERIFICATION" })) });
        const bad = await replay.client.callTool({ name: "search_products", arguments: {
          query: "Sony headphones", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: original.renderId, responseLocale: "zh-CN"
        } });
        expect(bad.isError).toBe(true);
        expect(bad._meta?.["findcheap/errorCode"]).toBe("PRODUCT_CONTEXT_CONFLICT");
      } finally { await replay.close(); }
    });
  it("normalizes the recorded package-in-size input before source execution and snapshot assessment", async () => {
    const mild = product({ merchantId: "medicube", merchant: "medicube", sourceHost: "medicube.us",
      title: "Zero Pore Madecassoside Pads (Mild)", brand: "medicube", productType: "toner pads",
      description: "Net wt. 155g (70 pads)", handle: "41268489650224",
      merchantUrl: "https://medicube.us/products/zero-pore-pads-mild?variant=41268489650224" });
    const regular = { ...mild, title: "Zero Pore Pads", description: "medicube Zero Pore Pad. Net weight: 100ml / 70pads",
      handle: "40542710825008", merchantUrl: "https://medicube.us/products/zero-pore-pad-1?variant=40542710825008" };
    const replay = await connectReplay(async () => searchResult([mild, regular]));
    try {
      const response = await replay.client.callTool({ name: "search_products", arguments: {
        query: "medicube Zero Pore Pad", brand: "medicube", productType: "toner pads",
        requiredSize: "70 pads, 155g", compareMerchants: true, responseLocale: "zh-CN"
      } });
      expect(response.isError).not.toBe(true);
      const cards = (response.structuredContent as { products: { title: string; requirementAssessment: unknown }[] }).products;
      expect(cards.find(card => card.title.includes("Mild"))?.requirementAssessment).toMatchObject({ status: "SATISFIED",
        entries: [expect.objectContaining({ requirement: "70 pads", status: "MATCHED" }), expect.objectContaining({ requirement: "155 g", status: "MATCHED" })] });
      expect(cards.find(card => !card.title.includes("Mild"))?.requirementAssessment).toMatchObject({ status: "NEEDS_VERIFICATION",
        entries: [expect.objectContaining({ status: "MATCHED" }), expect.objectContaining({ requirement: "155 g", status: "UNKNOWN" })] });
    } finally { await replay.close(); }
  });
  it("deduplicates Catalog and official offers before limits and recomputes final comparison counts", async () => {
    const mild = product({ merchantId: "shopify-15639052336", merchant: "MEDICUBE US", sourceHost: "medicube.us",
      title: "medicube Zero Pore Pad Mild 70 pads 155g", brand: "medicube", productType: "toner pads",
      description: "Net wt. 155g (70 pads)", handle: "41268489650224",
      merchantUrl: "https://medicube.us/products/zero-pore-pads-mild?variant=41268489650224" });
    const official = { ...mild, merchantId: "official-medicube.us" };
    const replay = await connectReplay(async () => ({ ...searchResult([mild, official]),
      comparison: { status: "SAME_PRODUCT", identityType: "UPID", evidence: ["raw upstream group"], merchantCount: 6, offerCount: 9 } }));
    try {
      const response = await replay.client.callTool({ name: "search_products", arguments: {
        query: "medicube Zero Pore Pad 70 pads 155g", brand: "medicube", productType: "toner pads",
        requiredFeatures: ["70 pads", "155 g"], comparisonMode: "SAME_PRODUCT", compareMerchants: true, responseLocale: "zh-CN"
      } });
      expect(response.isError).not.toBe(true);
      expect(response.structuredContent).toMatchObject({ products: [expect.objectContaining({ requestIdentityStatus: "NEEDS_VERIFICATION" })],
        comparison: { status: "DISCOVERY_ONLY", merchantCount: 1, offerCount: 1 }, recommendation: { state: "RESEARCH_ONLY" } });
      expect((response.structuredContent as { message: string }).message).toContain("来自 1 家商家");
      expect((response.structuredContent as { questions: string[] }).questions).toEqual(["请确认具体版本，或提供对应的官网商品链接。"]);
    } finally { await replay.close(); }
  });
  it.each([false, true])("assesses the requested edition across cards and comparison (explicit Mild: %s)", async explicit => {
    const mild = product({ merchantId: "shopify-15639052336", merchant: "MEDICUBE US", sourceHost: "medicube.us",
      title: "Zero Pore Madecassoside Pads (Mild)", brand: "SHOPIFY_ME", productType: "toner pads",
      description: "medicube Zero Pore Pad Mild. Net wt. 5.46 fl.oz. / 155g (70 pads)",
      handle: "41268489650224", merchantUrl: "https://medicube.us/products/zero-pore-pads-mild?variant=41268489650224",
      matchStatus: "EXACT", matchEvidence: ["Shopify Universal Product ID exact"],
      merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT", evidence: ["synthetic reviewed official host"] }
    });
    const replay = await connectReplay(async () => searchResult([mild]));
    try {
      const response = await replay.client.callTool({ name: "search_products", arguments: {
        query: `medicube Zero Pore Pad${explicit ? " Mild" : ""} 70 pads 155g`, brand: "medicube", productType: "toner pads",
        requiredFeatures: ["70 pads", "155 g"], comparisonMode: "SAME_PRODUCT", responseLocale: "zh-CN"
      } });
      expect(response.isError).not.toBe(true);
      const result = response.structuredContent as { products: Record<string, unknown>[]; recommendation: { state: string }; message: string };
      expect(result.products).toHaveLength(1);
      expect(result.products[0]).toMatchObject({ matchStatus: "DISCOVERY_MATCH", card: { matchBadge: "DISCOVERY_MATCH" },
        requestIdentityStatus: explicit ? "CONFIRMED" : "NEEDS_VERIFICATION" });
      expect(result.recommendation.state).toBe(explicit ? "READY" : "RESEARCH_ONLY");
      if (!explicit) expect(response.structuredContent).toMatchObject({ recovery: {
        reason: "IDENTITY_UNVERIFIED", qualified: 0, recommendable: 0, awaitingVerification: 1
      } });
      expect(result.products[0]!.matchEvidence).not.toContain("Shopify Universal Product ID exact");
      if (!explicit) expect(result.message).toContain("版本身份待确认");
    } finally { await replay.close(); }
  });
  afterEach(resetManagedMerchantTrustRecords);
  it("does not call a newly embedded official host absent from current authoritative trust", async () => {
    replaceManagedMerchantTrustRecords(EMBEDDED_MERCHANT_TRUST_REGISTRY.merchants.filter(entry => entry.host !== "medicube.us"), "older-registry");
    const search = vi.fn(async () => { throw new Error("INELIGIBLE_SOURCE_CALLED"); });
    const replay = await connectReplay(async () => searchResult([]), { officialShopify: { search } });
    try {
      const result = await replay.client.callTool({ name: "search_products", arguments: { query: "medicube Zero Pore Pad",
        brand: "medicube", productType: "toner pads" } });
      expect(search).not.toHaveBeenCalled();
      expect(result._meta?.["findcheap/searchTrace"]).toMatchObject({ officialStore: { status: "NOT_USED" } });
    } finally { await replay.close(); }
  });
  it("registers the reviewed US host consistently without trusting lookalikes", () => {
    expect(resolveVerifiedOfficialStorefront("medicube")).toMatchObject({ host: "medicube.us", platform: "SHOPIFY" });
    expect(DEFAULT_OFFICIAL_STOREFRONT_REGISTRY.stores).toContainEqual(expect.objectContaining({ brand: "medicube", officialHost: "medicube.us" }));
    expect(EMBEDDED_MERCHANT_TRUST_REGISTRY.merchants).toContainEqual(expect.objectContaining({ host: "medicube.us", level: "OFFICIAL" }));
    for (const host of ["medicube.us.evil.example", "medicubie.shop", "usamedicube.com"]) {
      expect(resolveMerchantTrust(host).verification).toBe("UNVERIFIED");
    }
  });

  it("runs the original brand/package request through the official adapter without inventing 155g", async () => {
    // Observed field shape, minimal synthetic data; shipping weight is deliberately
    // not a net-content assertion. No fixture price is a current merchant quote.
    const officialShopify = createOfficialShopifySearchPort({ fetchDocument: async url => ({ finalUrl: url,
      response: Response.json(new URL(url).pathname.endsWith(".js") ? {
        title: "Zero Pore Pads", handle: "zero-pore-pad-1", vendor: "SHOPIFY_ME", type: "ZERO LINE - Pore Care",
        description: "Net weight : 100ml / 70pads", options: [{ name: "Option", position: 1, values: ["SINGLE"] }],
        variants: [{ id: 40542710825008, title: "SINGLE", available: true, price: 2400, weight: 318, options: ["SINGLE"] }]
      } : { resources: { results: { products: [{ title: "Zero Pore Pads", handle: "zero-pore-pad-1", url: "/products/zero-pore-pad-1" }] } } })
    }) });
    const replay = await connectReplay(async () => searchResult([]), { officialShopify });
    try {
      const result = await replay.client.callTool({ name: "search_products", arguments: {
        query: "medicube Zero Pore Pad 70 pads 155g", brand: "medicube", productType: "toner pads",
        requiredFeatures: ["70 pads", "155 g"], comparisonMode: "SAME_PRODUCT", compareMerchants: true,
        responseLocale: "zh-CN", limit: 8
      } });
      expect(result.isError).not.toBe(true);
      expect(result._meta?.["findcheap/searchTrace"]).toMatchObject({ officialStore: { status: "COMPLETE" } });
      expect(result.structuredContent).not.toMatchObject({ recommendation: { state: "READY" } });
    } finally { await replay.close(); }
  });
});
