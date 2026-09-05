import type { UnifiedSearchExecution } from "./search-products.js";

export type SearchOutcome = "REVIEW_REQUIRED" | "REQUIREMENTS_UNVERIFIED" | "MATCH_FOUND" | "NO_CANDIDATES" |
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
  const sourceFailures = execution.sourceFailures?.map(({ source, kind, retryable }) => ({ source, kind, retryable }));
  const nonTransientFailure = ["SECURITY_REJECTED", "SCHEMA_INVALID", "INVALID_QUERY", "SOURCE_REJECTED", "BUDGET_EXHAUSTED", "UNKNOWN"]
    .map(kind => sourceFailures?.find(failure => !failure.retryable && failure.kind === kind)).find(Boolean);
  const sourceObservations = execution.sourcePassDiagnostics.reduce((total, pass) =>
    total + pass.rawProducts.awin + pass.rawProducts.shopify + pass.rawProducts.ebay, 0) + (execution.webRecovery?.verified ?? 0);
  const funnel = execution.candidateFunnel;
  const retrieved = execution.retrievedProductHashes;
  return {
    version: 1,
    ...run,
    outcome: run?.budgetExhausted === true && outcome !== "MATCH_FOUND" && outcome !== "REVIEW_REQUIRED"
      ? "BUDGET_EXHAUSTED" as const : outcome,
    sources: execution.sourceStatus,
    ...(retrieved === undefined ? {} : { retrieval: {
      origin: "SERVER_TRACE" as const,
      order: "SOURCE_OBSERVATION_ORDER" as const,
      productHashes: retrieved.filter(hash => /^[a-f0-9]{64}$/u.test(hash)).slice(0, 200),
      revalidatedProductHashes: (execution.previousProductHashes ?? []).filter(hash => /^[a-f0-9]{64}$/u.test(hash)).slice(0, 18),
      truncated: execution.retrievedProductsTruncated === true || retrieved.length > 200
    } }),
    ...(sourceFailures === undefined ? {} : { sourceFailures }),
    ...(execution.webRecovery === undefined ? {} : { webRecovery: execution.webRecovery }),
    officialStore: {
      status: execution.officialStoreFallback.status,
      productsReturned: execution.officialStoreFallback.productsReturned,
      ...(execution.officialStoreFallback.diagnostic === undefined ? {} : {
        outcome: execution.officialStoreFallback.diagnostic.outcome,
        attempts: execution.officialStoreFallback.diagnostic.attempts.length
      })
    },
    sourcePasses: execution.searchPasses,
    retrievalExtent: "BOUNDED" as const,
    requirementFunnel: {
      // Legacy count is observations, not unique products. Never calculate recall from it.
      sourceResults: sourceObservations,
      sourceResultsUnit: "OBSERVATIONS" as const,
      conflictingProducts: execution.featureProductsExcluded,
      satisfiedReturned: execution.candidates.filter(candidate => candidate.requiredFeatureLimitations.length === 0).length,
      awaitingVerification: execution.candidates.filter(candidate => candidate.requiredFeatureLimitations.length > 0).length,
      trustedReturned: execution.candidates.filter(candidate => candidate.recommendationTier === "TRUSTED_OR_AFFILIATE").length
    },
    ...(funnel === undefined ? {} : { candidateFunnel: {
      sourceObservations: funnel.sourceObservations, sourceUnique: funnel.sourceUnique,
      previousRechecked: funnel.previousRechecked, previousRetained: funnel.previousRetained,
      eligibleUnique: funnel.eligibleUnique, requirementsMatchedUnique: funnel.requirementsMatchedUnique,
      recommendableUnique: funnel.recommendableUnique, presentedUnique: funnel.presentedUnique
    } }),
    termination: run?.budgetExhausted || outcome === "BUDGET_EXHAUSTED" ? "BUDGET_EXHAUSTED"
      : nonTransientFailure !== undefined ? nonTransientFailure.kind
      : Object.values(execution.sourceStatus).some(value => value === "UNAVAILABLE" || value === "PARTIAL") ? "SOURCE_UNAVAILABLE"
        : execution.candidates.length > 0 && execution.candidates.every(candidate => candidate.requiredFeatureLimitations.length > 0)
          ? "REQUIREMENTS_UNVERIFIED" : "BOUNDED_SEARCH_COMPLETE",
    ...(snapshotAt === undefined ? {} : { awinSnapshotAt: snapshotAt }),
    candidatePool: (execution.reviewPool ?? execution.candidates).length,
    exclusions: {
      identity: execution.identityProductsExcluded,
      brand: execution.brandProductsExcluded,
      requirements: execution.featureProductsExcluded,
      visual: execution.visualProductsExcluded
    },
    exclusionCountsOverlap: true,
    ...(counts.imageAttempts === undefined ? {} : { imageAttempts: counts.imageAttempts }),
    ...(counts.imagesLoaded === undefined ? {} : { imagesLoaded: counts.imagesLoaded }),
    ...(counts.reviewed === undefined ? {} : { reviewed: counts.reviewed }),
    ...(counts.reviewConflicts === undefined ? {} : { reviewConflicts: counts.reviewConflicts }),
    ...(counts.reviewInsufficient === undefined ? {} : { reviewInsufficient: counts.reviewInsufficient }),
    ...(counts.returned === undefined ? {} : { returned: counts.returned })
  };
}
