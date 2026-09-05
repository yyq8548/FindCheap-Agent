import { describe, expect, it, vi } from "vitest";
import { searchDiagnostics } from "../src/search-diagnostics.js";
import { SearchRun, SearchBudgetError, SearchReadTimeoutError } from "../src/search-run.js";
import type { UnifiedSearchExecution } from "../src/search-products.js";

describe("search outcome telemetry", () => {
  it("reports a separately exhausted web lease without claiming the catalog budget was spent", () => {
    expect(searchDiagnostics(executionFor(new SearchRun()), "BUDGET_EXHAUSTED")).toMatchObject({
      outcome: "BUDGET_EXHAUSTED", termination: "BUDGET_EXHAUSTED", budgetExhausted: false
    });
  });
  it("keeps unique product counts separate from repeated source observations and sanitizes typed failures", () => {
    const execution = executionFor(new SearchRun());
    execution.sourcePassDiagnostics[0]!.rawProducts.awin = 5;
    execution.sourcePassDiagnostics[0]!.sourceQueries = { awin: "PRIVATE QUERY" };
    execution.sourceFailures = [{ source: "AWIN", kind: "INVALID_QUERY", retryable: false }];
    execution.retrievedProductHashes = ["a".repeat(64), "PRIVATE_URL_OR_QUERY", "b".repeat(64)];
    execution.candidateFunnel = { sourceObservations: 5, sourceUnique: 3, previousRechecked: 2, previousRetained: 1,
      eligibleUnique: 3, requirementsMatchedUnique: 2, recommendableUnique: 1, presentedUnique: 1 };
    const result = searchDiagnostics(execution, "NO_CANDIDATES");
    expect(result).toMatchObject({ termination: "INVALID_QUERY", exclusionCountsOverlap: true,
      retrieval: { origin: "SERVER_TRACE", productHashes: ["a".repeat(64), "b".repeat(64)], truncated: false },
      requirementFunnel: { sourceResults: 5, sourceResultsUnit: "OBSERVATIONS" },
      candidateFunnel: { sourceUnique: 3, presentedUnique: 1 },
      sourceFailures: [{ source: "AWIN", kind: "INVALID_QUERY", retryable: false }] });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("distinguishes a healthy empty source from a successful match without raw payloads", () => {
    const execution = executionFor(new SearchRun());
    const empty = searchDiagnostics(execution, "NO_CANDIDATES", { returned: 0 });
    expect(empty).toMatchObject({ outcome: "NO_CANDIDATES", sources: { awin: "COMPLETE" }, returned: 0 });
    expect(empty.officialStore).toMatchObject({ status: "COMPLETE", outcome: "OFFICIAL_ZERO_RESULTS", attempts: 0 });
    execution.officialStoreFallback = { status: "UNAVAILABLE", sourceHost: "PRIVATE_HOST", productsReturned: 0,
      diagnostic: { outcome: "OFFICIAL_UNAVAILABLE", attempts: [] } };
    const unavailable = searchDiagnostics(execution, "NO_CANDIDATES");
    expect(unavailable.officialStore.status).toBe("UNAVAILABLE");
    expect(JSON.stringify(unavailable)).not.toContain("PRIVATE");
    expect(searchDiagnostics(execution, "VISUAL_EVIDENCE_INSUFFICIENT").outcome).toBe("VISUAL_EVIDENCE_INSUFFICIENT");
    expect(JSON.stringify(empty)).not.toContain("PRIVATE");
  });

  it("keeps a successful match after an individual read timeout while reporting degraded reads", async () => {
    vi.useFakeTimers();
    try {
      const run = new SearchRun({ activeBudgetMs: 50, readTimeoutMs: 30 });
      const stalled = run.read("IMAGE", "PRIVATE_IMAGE_URL", () => new Promise(() => {}));
      const rejected = expect(stalled).rejects.toBeInstanceOf(SearchReadTimeoutError);
      await vi.advanceTimersByTimeAsync(30);
      await rejected;
      await run.read("IMAGE", "another-image", async () => "loaded");
      const diagnostic = searchDiagnostics(executionFor(run), "MATCH_FOUND", { returned: 1, imagesLoaded: 1 });
      expect(diagnostic).toMatchObject({ outcome: "MATCH_FOUND", returned: 1, readTimeouts: 1, budgetExhausted: false });
      expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE");
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains match or review outcomes after the catalog budget is reached, without hiding exhaustion", async () => {
    const run = new SearchRun({ maxCatalogRequests: 1 });
    await run.read("SHOPIFY", "first", async () => ["retained-candidate"]);
    await expect(run.read("AWIN", "second", async () => [])).rejects.toBeInstanceOf(SearchBudgetError);
    const execution = executionFor(run);
    expect(searchDiagnostics(execution, "MATCH_FOUND", { returned: 1 })).toMatchObject({
      outcome: "MATCH_FOUND", budgetExhausted: true, returned: 1
    });
    expect(searchDiagnostics(execution, "REVIEW_REQUIRED").outcome).toBe("REVIEW_REQUIRED");
    expect(searchDiagnostics(execution, "NO_CANDIDATES").outcome).toBe("BUDGET_EXHAUSTED");
  });

  it("records optional enrichment limits without converting a product match into budget failure", async () => {
    const run = new SearchRun();
    await Promise.all(Array.from({ length: 8 }, (_, index) => run.read("DEALS", `merchant-${index}`, async () => [])));
    await expect(run.read("DEALS", "ninth", async () => [])).rejects.toBeInstanceOf(SearchBudgetError);
    expect(searchDiagnostics(executionFor(run), "MATCH_FOUND", { returned: 1 })).toMatchObject({
      outcome: "MATCH_FOUND", returned: 1, enrichmentLimited: true, budgetExhausted: false
    });
  });
});

function executionFor(searchRun: SearchRun): UnifiedSearchExecution {
  return {
    candidates: [], sourceStatus: { awin: "COMPLETE", shopify: "COMPLETE", ebay: "SKIPPED" },
    searchRun, searchPasses: 2, searchIntent: "VISUAL_DISCOVERY", chromeFallbackEligible: false,
    sourcePassDiagnostics: [{ pass: 1, query: "PRIVATE USER QUERY", rawProducts: { awin: 0, shopify: 0, ebay: 0 }, acceptedCandidates: { awin: 0, shopify: 0, ebay: 0 } }],
    featureProductsExcluded: 0, brandProductsExcluded: 0, identityProductsExcluded: 0, visualProductsExcluded: 0,
    officialStoreFallback: { status: "COMPLETE", productsReturned: 0, diagnostic: { outcome: "OFFICIAL_ZERO_RESULTS", attempts: [] } }
  };
}
