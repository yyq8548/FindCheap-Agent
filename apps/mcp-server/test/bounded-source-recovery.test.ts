import { describe, expect, it, vi } from "vitest";
import { WooSearchResultSchema, type WooSearchResult } from "../../../packages/contracts/src/woocommerce.js";
import { SearchProductsInputSchema, searchProducts } from "../src/search-products.js";
import { SearchRun } from "../src/search-run.js";
import { searchDiagnostics } from "../src/search-diagnostics.js";
import { textSearchRecovery } from "../src/text-search-recovery.js";
import { searchResult } from "./fixtures/conversation-replay-support.js";

const checkedAt = "2026-09-08T22:00:00.000Z";
const emptyAwin = { search: async () => ({ source: "AWIN_PRODUCT_FEED" as const, coverage: "COMPLETE" as const,
  snapshotAt: checkedAt, products: [], diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 } }) };
const input = SearchProductsInputSchema.parse({ query: "coffee capsules", productType: "coffee capsules" });

function partialWoo(reason: NonNullable<WooSearchResult["stores"][number]["reason"]>): WooSearchResult {
  return WooSearchResultSchema.parse({ source: "WOOCOMMERCE_STORE_API", schemaVersion: 1, registryVersion: "fixture-v1",
    requestId: "bounded-source", status: "PARTIAL", snapshotAt: checkedAt, products: [],
    stores: [{ merchantId: "fixture-coffee", status: "PARTIAL", reason, requests: 1, returned: 0 }],
    diagnostics: { eligibleStores: 200, plannedStores: 1, attemptedStores: 1, succeededStores: 1, failedStores: 0,
      skippedStores: 199, physicalRequests: 1, responseBytes: 100, cacheHits: 0, elapsedMs: 1,
      truncated: true, registryCoverageComplete: false } });
}

describe("bounded source failure recovery", () => {
  it.each(["UNSUPPORTED", "BUDGET_EXHAUSTED"] as const)("does not turn nonretryable Woo %s into a search-wide stop", async reason => {
    const woo = vi.fn(async () => partialWoo(reason));
    const execution = await searchProducts(input, { awin: emptyAwin, shopify: { search: async () => searchResult([]) }, woocommerce: { search: woo } });
    expect(execution.sourceFailures).toContainEqual({ source: "WOOCOMMERCE", kind: reason, retryable: false, scope: "SOURCE" });
    expect(execution.searchRun?.diagnostics().budgetExhausted).toBe(false);
    expect(execution.chromeFallbackEligible).toBe(true);
    expect(textSearchRecovery(execution)).toMatchObject({ action: "REQUEST_WEB_SEARCH", reason: "SOURCE_UNAVAILABLE" });
    expect(searchDiagnostics(execution, "NO_CANDIDATES").termination).not.toBe("BUDGET_EXHAUSTED");
    expect(woo).toHaveBeenCalledTimes(2);
  });

  it.each(["SECURITY_REJECTED", "ACCESS_DENIED", "INVALID_RESPONSE"] as const)("keeps Woo %s closed even when another source only reached a local limit", async reason => {
    const response = partialWoo("BUDGET_EXHAUSTED");
    response.stores.push({ merchantId: "unsafe-coffee", status: "UNAVAILABLE", reason, requests: 1, returned: 0 });
    const execution = await searchProducts(input, { awin: emptyAwin, shopify: { search: async () => searchResult([]) }, woocommerce: { search: async () => response } });
    expect(execution.chromeFallbackEligible).toBe(false);
    expect(textSearchRecovery(execution).action).toBe("REPORT_INCOMPLETE");
  });

  it("keeps unknown provider failures closed", async () => {
    const execution = await searchProducts(input, { awin: emptyAwin, shopify: { search: async () => { throw new Error("unknown private source fault"); } },
      woocommerce: { search: async () => partialWoo("UNSUPPORTED") } });
    expect(execution.chromeFallbackEligible).toBe(false);
    expect(JSON.stringify(execution.sourceFailures)).not.toContain("private");
  });

  it("does not reopen recovery after the shared request budget is exhausted", async () => {
    const searchRun = new SearchRun({ maxCatalogRequests: 1 });
    const execution = await searchProducts({ ...input, searchRun }, { awin: emptyAwin, shopify: { search: async () => searchResult([]) },
      woocommerce: { search: async () => partialWoo("UNSUPPORTED") } });
    expect(searchRun.diagnostics().budgetExhausted).toBe(true);
    expect(execution.chromeFallbackEligible).toBe(false);
    expect(textSearchRecovery(execution)).toMatchObject({ action: "REPORT_INCOMPLETE", reason: "BUDGET_EXHAUSTED" });
  });
});
