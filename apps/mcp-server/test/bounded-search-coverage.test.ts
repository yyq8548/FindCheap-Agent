import { describe, expect, it, vi } from "vitest";
import { WooSearchResultSchema, type WooSearchResult } from "../../../packages/contracts/src/woocommerce.js";
import { createAffiliateLinkResolver } from "../src/affiliate-links.js";
import { createFindCheapBackend } from "../src/backend.js";
import { createUnavailableDealPort } from "../src/deal-client.js";
import { searchDiagnostics } from "../src/search-diagnostics.js";
import { SearchProductsInputSchema, searchProducts } from "../src/search-products.js";
import { createMemoryWatchStore } from "../src/watch-store.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

const checkedAt = "2026-09-08T22:00:00.000Z";
const emptyAwin = { search: async () => ({ source: "AWIN_PRODUCT_FEED" as const, coverage: "COMPLETE" as const,
  snapshotAt: checkedAt, products: [], diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 } }) };

function wooPass(pass: number, cached = false): WooSearchResult {
  const ids = Array.from({ length: 6 }, (_, index) => `coffee-${(pass - 1) * 6 + index + 1}`);
  return WooSearchResultSchema.parse({ source: "WOOCOMMERCE_STORE_API", schemaVersion: 1, registryVersion: "fixture-v1",
    requestId: `bounded-${pass}`, status: "COMPLETE", snapshotAt: checkedAt, products: [],
    stores: ids.map(merchantId => ({ merchantId, status: "COMPLETE", requests: cached ? 0 : pass, returned: 0 })),
    diagnostics: { eligibleStores: 200, plannedStores: 6, attemptedStores: 6, succeededStores: 6, failedStores: 0,
      skippedStores: 194, physicalRequests: cached ? 0 : 6 * pass, responseBytes: cached ? 0 : 600 * pass,
      cacheHits: cached ? 1 : 0, elapsedMs: 1, truncated: false, registryCoverageComplete: false },
    ...(pass === 1 ? { continuation: { registryVersion: "fixture-v1", attemptedMerchantIds: ids } } : {}) });
}

describe("bounded search coverage receipts", () => {
  it("retains both Woo passes and cumulative unique merchants without claiming registry exhaustion", async () => {
    const woo = vi.fn(async () => wooPass(1));
    woo.mockResolvedValueOnce(wooPass(1)).mockResolvedValueOnce(wooPass(2));
    const shopify = { search: async () => searchResult([]) };
    const backend = createFindCheapBackend({ catalog: { awin: emptyAwin, shopify, woocommerce: { search: woo } },
      product: { affiliateLinks: createAffiliateLinkResolver() }, deals: createUnavailableDealPort(), verifiedDeals: false,
      watches: createMemoryWatchStore() });
    const replay = await connectReplay(shopify.search, { backend });
    try {
      const response = await replay.client.callTool({ name: "search_products", arguments: { query: "coffee capsules", productType: "coffee capsules" } });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      expect(woo.mock.calls).toHaveLength(2);
      expect(response.structuredContent).toMatchObject({ woocommerceCoverage: {
        scope: "LAST_PASS", diagnostics: { attemptedStores: 6, registryCoverageComplete: false },
        passes: [{ pass: 1, diagnostics: { physicalRequests: 6 } }, { pass: 2, diagnostics: { physicalRequests: 12 } }],
        cumulative: { scope: "CURRENT_SEARCH", eligibleStores: 200,
          attemptedMerchantIds: Array.from({ length: 12 }, (_, index) => `coffee-${index + 1}`),
          completedMerchantIds: Array.from({ length: 12 }, (_, index) => `coffee-${index + 1}`),
          physicalRequests: 18, responseBytes: 1800, registryCoverageComplete: false }
      } });
    } finally { await replay.close(); }
  });

  it("does not count cache-served merchants as new physical attempts", async () => {
    const woo = vi.fn(async () => wooPass(1, true));
    woo.mockResolvedValueOnce(wooPass(1, true)).mockResolvedValueOnce(wooPass(2));
    const execution = await searchProducts(SearchProductsInputSchema.parse({ query: "coffee", productType: "coffee" }), {
      awin: emptyAwin, shopify: { search: async () => searchResult([]) }, woocommerce: { search: woo }
    });
    expect(searchDiagnostics(execution, "NO_CANDIDATES")).toMatchObject({ woocommerce: { cumulative: {
      attemptedMerchantIds: ["coffee-7", "coffee-8", "coffee-9", "coffee-10", "coffee-11", "coffee-12"],
      physicalRequests: 12, responseBytes: 1200, registryCoverageComplete: false
    } } });
  });

  it("never counts an unknown product form as satisfied merely because no typed feature was added", async () => {
    const generic = product({ title: "Dark roast coffee", productType: "coffee", description: "Roasted coffee from our cafe.",
      handle: "dark-roast", merchantUrl: "https://ishowbeauty.com/products/dark-roast" });
    const replay = await connectReplay(async () => searchResult([generic]), { awin: emptyAwin });
    try {
      const response = await replay.client.callTool({ name: "search_products", arguments: { query: "coffee capsules", productType: "coffee capsules" } });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      expect(response.structuredContent).toMatchObject({
        products: [{ requestIdentityStatus: "NEEDS_VERIFICATION", presentationGroup: "RESEARCH_ONLY" }],
        retrieval: { satisfied: 0, awaitingVerification: 1 }, recovery: { qualified: 0, awaitingVerification: 1 }
      });
      const trace = response._meta?.["findcheap/searchTrace"];
      expect(trace).toMatchObject({ requirementFunnel: { satisfiedReturned: 0, awaitingVerification: 1 },
        candidateFunnel: { requirementsMatchedUnique: 0, recommendableUnique: 0 } });
    } finally { await replay.close(); }
  });
});
