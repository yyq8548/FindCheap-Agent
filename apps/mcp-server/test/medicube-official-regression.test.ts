import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMerchantTrust, resolveVerifiedOfficialStorefront, replaceManagedMerchantTrustRecords, resetManagedMerchantTrustRecords } from "../src/merchant-trust.js";
import { DEFAULT_OFFICIAL_STOREFRONT_REGISTRY } from "../../awin-feed-service/src/official-storefront-registry.js";
import { EMBEDDED_MERCHANT_TRUST_REGISTRY } from "../../../packages/contracts/src/merchant-trust-registry.js";
import { createOfficialShopifySearchPort } from "../src/shopify-official-store-search.js";
import { connectReplay, searchResult } from "./fixtures/conversation-replay-support.js";

describe("R10 medicube source coverage without weakening requirements", () => {
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
