import { describe, expect, it } from "vitest";
import { WooSearchResultSchema } from "../../../packages/contracts/src/woocommerce.js";
import { wooSearchCoverage, wooRoutingExplanation } from "../src/search-diagnostics.js";

const result = () => WooSearchResultSchema.parse({ source: "WOOCOMMERCE_STORE_API", schemaVersion: 1,
  registryVersion: "test", requestId: "test", status: "COMPLETE", snapshotAt: "2026-09-09T00:00:00.000Z", products: [],
  stores: [{ merchantId: "a", status: "COMPLETE", requests: 1, returned: 0 }],
  diagnostics: { eligibleStores: 1000, plannedStores: 1, attemptedStores: 1, succeededStores: 1, failedStores: 0,
    skippedStores: 999, physicalRequests: 1, responseBytes: 2, cacheHits: 0, elapsedMs: 1, truncated: false,
    registryCoverageComplete: false, routing: { scope: "CURRENT_PASS", matchedStores: 0, relevantPlanned: 0, explorationPlanned: 1 } } });

describe("Woo current-search diagnostic meaning", () => {
  it("preserves a failed merchant pass even if the next pass succeeds, and excludes cache/skipped attempts", () => {
    const last = result();
    const coverage = wooSearchCoverage({ woocommerceResult: last, searchPasses: 2, woocommercePasses: [
      { ...last, pass: 1, stores: [{ merchantId: "a", status: "UNAVAILABLE", reason: "INVALID_RESPONSE", failureDetail: "CONTENT_TYPE", requests: 1, returned: 0 },
        { merchantId: "cached", status: "COMPLETE", requests: 0, returned: 0 },
        { merchantId: "blocked", status: "SKIPPED", reason: "CIRCUIT_OPEN", requests: 0, returned: 0 }] },
      { ...last, pass: 2 }
    ] });
    expect(coverage?.cumulative).toMatchObject({ attemptedStorePasses: 2, failedStorePasses: 1, physicalRequests: 2 });
    expect(coverage?.passes[0]?.stores[0]?.failureDetail).toBe("CONTENT_TYPE");
  });
  it("states metadata coverage rather than product absence, and never infers missing old-server metadata", () => {
    const last = result();
    const coverage = wooSearchCoverage({ woocommerceResult: last, searchPasses: 1 });
    expect(wooRoutingExplanation(coverage, "en-US")).toContain("no matching merchant category or brand metadata");
    expect(wooRoutingExplanation(coverage, "zh-CN")).toContain("不代表商品不存在");
    delete last.diagnostics.routing;
    expect(wooRoutingExplanation(wooSearchCoverage({ woocommerceResult: last, searchPasses: 1 }), "en-US")).toBe("");
  });
});
