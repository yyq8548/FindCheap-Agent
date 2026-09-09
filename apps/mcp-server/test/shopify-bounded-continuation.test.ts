import { describe, expect, it, vi } from "vitest";
import { SearchProductsInputSchema, searchProducts } from "../src/search-products.js";
import { SearchRun } from "../src/search-run.js";
import { textSearchRecovery } from "../src/text-search-recovery.js";
import type { ShopifyPort } from "../src/shopify-client.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

const emptyAwin = { search: async () => ({ source: "AWIN_PRODUCT_FEED" as const, coverage: "COMPLETE" as const,
  snapshotAt: "2026-09-08T22:00:00.000Z", products: [],
  diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 } }) };
function page(cursor: string) {
  const result = searchResult([]);
  return { ...result, coverage: "PARTIAL" as const,
    pagination: { query: "shirt", hasNextPage: true, nextCursor: cursor, estimatedTotalCount: 371 },
    diagnostics: { ...result.diagnostics, coverageScope: "RETURNED_PAGE" as const } };
}

describe("bounded Shopify continuation orchestration", () => {
  it("advances the cursor under its original query before an expanded feature query", async () => {
    const search = vi.fn<ShopifyPort["search"]>(async () => page("cursor-20"));
    search.mockResolvedValueOnce(page("cursor-10"));
    const execution = await searchProducts(SearchProductsInputSchema.parse({ query: "shirt", productType: "shirt", requiredFeatures: ["cotton"] }), {
      awin: emptyAwin, shopify: { search }
    });
    expect(search.mock.calls.map(([input]) => ({ query: input.query, continuation: input.continuation }))).toEqual([
      { query: "shirt", continuation: undefined }, { query: "shirt", continuation: { query: "shirt", cursor: "cursor-10" } }
    ]);
    expect(execution.searchRun?.diagnostics().cacheHits).toBe(0);
    expect(execution.sourceStatus.shopify).toBe("PARTIAL");
    expect(execution.chromeFallbackEligible).toBe(true);
  });

  it("does not recount an unchanged unpaginated source response as a second observation", async () => {
    const observed = product({ title: "Headphones", productType: "headphones", merchantUrl: "https://ishowbeauty.com/products/headphones" });
    const search = vi.fn<ShopifyPort["search"]>(async () => searchResult([observed]));
    const execution = await searchProducts(SearchProductsInputSchema.parse({ query: "headphones", productType: "headphones" }), {
      awin: emptyAwin, shopify: { search }
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(execution.searchPasses).toBe(2);
    expect(execution.sourcePassDiagnostics[1]?.rawProducts.shopify).toBe(0);
    expect(execution.candidateFunnel?.sourceObservations).toBe(1);
  });

  it("exposes bounded pages and estimated counts without turning them into exhaustive coverage", async () => {
    const search = vi.fn<ShopifyPort["search"]>(async () => page("cursor-20"));
    search.mockResolvedValueOnce(page("cursor-10"));
    const replay = await connectReplay(search, { awin: emptyAwin });
    try {
      const response = await replay.client.callTool({ name: "search_products", arguments: { query: "shirt", productType: "shirt" } });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      expect(response.structuredContent).toMatchObject({ sources: { shopify: "PARTIAL" },
        diagnostics: { coverageScope: "RETURNED_PAGE" }, shopifyCoverage: { scope: "RETURNED_PAGES", hasMoreResults: true,
          passes: [{ pass: 1, operation: "QUERY", hasNextPage: true, estimatedTotalCount: 371 },
            { pass: 2, operation: "CONTINUATION", hasNextPage: true, estimatedTotalCount: 371 }] },
        recovery: { action: "REQUEST_WEB_SEARCH", reason: "NO_QUALIFIED_MATCH" } });
      expect(JSON.stringify(response.structuredContent)).not.toContain("cursor-20");
    } finally { await replay.close(); }
  });

  it("does not disguise a real second-page HTTP failure as healthy pagination", async () => {
    const search = vi.fn<ShopifyPort["search"]>(async () => { throw new Error("Shopify Catalog service returned HTTP 502"); });
    search.mockResolvedValueOnce({ ...page("cursor-10"), products: [product({ title: "Cotton shirt", productType: "shirt" })] });
    const execution = await searchProducts(SearchProductsInputSchema.parse({ query: "shirt", productType: "shirt" }), {
      awin: emptyAwin, shopify: { search }
    });
    expect(execution.sourceFailures).toContainEqual({ source: "SHOPIFY", kind: "UPSTREAM_ERROR", retryable: true });
    expect(textSearchRecovery(execution)).toMatchObject({ action: "REPORT_INCOMPLETE", reason: "SOURCE_UNAVAILABLE" });
    expect(execution.sourcePassDiagnostics.map(pass => pass.rawProducts.shopify)).toEqual([1, 0]);
    expect(execution.candidateFunnel?.sourceObservations).toBe(1);
  });

  it("keeps shared exhaustion above a valid pagination continuation", async () => {
    const searchRun = new SearchRun({ maxCatalogRequests: 3 });
    const search = vi.fn<ShopifyPort["search"]>(async () => page("cursor-10"));
    const execution = await searchProducts({ ...SearchProductsInputSchema.parse({ query: "shirt", productType: "shirt" }), searchRun }, {
      awin: emptyAwin, shopify: { search }
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(searchRun.diagnostics().budgetExhausted).toBe(true);
    expect(execution.chromeFallbackEligible).toBe(false);
  });
});
