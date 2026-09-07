import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMerchantTrust, resolveVerifiedOfficialStorefront, replaceManagedMerchantTrustRecords, resetManagedMerchantTrustRecords } from "../src/merchant-trust.js";
import { DEFAULT_OFFICIAL_STOREFRONT_REGISTRY } from "../../awin-feed-service/src/official-storefront-registry.js";
import { EMBEDDED_MERCHANT_TRUST_REGISTRY } from "../../../packages/contracts/src/merchant-trust-registry.js";
import { createOfficialShopifySearchPort } from "../src/shopify-official-store-search.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

describe("R10 medicube source coverage without weakening requirements", () => {
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
