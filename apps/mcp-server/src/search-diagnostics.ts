import type { UnifiedSearchExecution } from "./search-products.js";

export type SearchOutcome = "REVIEW_REQUIRED" | "MATCH_FOUND" | "NO_CANDIDATES" |
  "SOURCE_UNAVAILABLE" | "NO_LOADABLE_IMAGES" | "CANDIDATES_CONFLICTED" |
  "VISUAL_EVIDENCE_INSUFFICIENT" | "BUDGET_EXHAUSTED";

/** Public diagnostic allowlist: never serialize an execution, query, source URL,
 * image, coupon, or provider exception into the trace. */
export function searchDiagnostics(execution: UnifiedSearchExecution, outcome: SearchOutcome, counts: {
  imageAttempts?: number; imagesLoaded?: number; reviewed?: number; reviewConflicts?: number; reviewInsufficient?: number; returned?: number;
} = {}) {
  const run = execution.searchRun?.diagnostics();
  const snapshotTime = execution.awinResult?.snapshotAt;
  const snapshotAt = snapshotTime !== undefined && Number.isFinite(Date.parse(snapshotTime))
    ? new Date(snapshotTime).toISOString() : undefined;
  return {
    version: 1,
    ...run,
    outcome: run?.budgetExhausted === true && outcome !== "MATCH_FOUND" && outcome !== "REVIEW_REQUIRED"
      ? "BUDGET_EXHAUSTED" as const : outcome,
    sources: execution.sourceStatus,
    officialStore: {
      status: execution.officialStoreFallback.status,
      productsReturned: execution.officialStoreFallback.productsReturned,
      ...(execution.officialStoreFallback.diagnostic === undefined ? {} : {
        outcome: execution.officialStoreFallback.diagnostic.outcome,
        attempts: execution.officialStoreFallback.diagnostic.attempts.length
      })
    },
    sourcePasses: execution.searchPasses,
    ...(snapshotAt === undefined ? {} : { awinSnapshotAt: snapshotAt }),
    candidatePool: (execution.reviewPool ?? execution.candidates).length,
    exclusions: {
      identity: execution.identityProductsExcluded,
      brand: execution.brandProductsExcluded,
      requirements: execution.featureProductsExcluded,
      visual: execution.visualProductsExcluded
    },
    ...(counts.imageAttempts === undefined ? {} : { imageAttempts: counts.imageAttempts }),
    ...(counts.imagesLoaded === undefined ? {} : { imagesLoaded: counts.imagesLoaded }),
    ...(counts.reviewed === undefined ? {} : { reviewed: counts.reviewed }),
    ...(counts.reviewConflicts === undefined ? {} : { reviewConflicts: counts.reviewConflicts }),
    ...(counts.reviewInsufficient === undefined ? {} : { reviewInsufficient: counts.reviewInsufficient }),
    ...(counts.returned === undefined ? {} : { returned: counts.returned })
  };
}
