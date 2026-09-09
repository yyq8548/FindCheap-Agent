import type { UnifiedSearchExecution } from "./search-products.js";
import { allowsIndependentSourceRecovery, isCompletedShopifyPage, wooCoverageState, SourceValidationDetailsSchema } from "./source-failure.js";
import { countDisplayEligibleCandidates } from "./product-candidate-ranking.js";

/** Only typed coverage metadata is retained; source products and query text are omitted. */
export function wooSearchCoverage(execution: Pick<UnifiedSearchExecution, "woocommerceResult" | "woocommercePasses" | "searchPasses">) {
  const last = execution.woocommerceResult;
  if (last === undefined) return undefined;
  const passes = execution.woocommercePasses ?? [{ pass: execution.searchPasses, registryVersion: last.registryVersion,
    status: last.status, stores: last.stores, diagnostics: last.diagnostics }];
  const attemptedMerchantIds = [...new Set(passes.flatMap(pass => pass.stores.filter(store => store.requests > 0).map(store => store.merchantId)))];
  const completedMerchantIds = [...new Set(passes.flatMap(pass => pass.stores.filter(store => store.status === "COMPLETE").map(store => store.merchantId)))];
  const eligibleStores = Math.max(0, ...passes.map(pass => pass.diagnostics.eligibleStores));
  const attemptedStorePasses = passes.flatMap(pass => pass.stores.filter(store => store.requests > 0));
  return { schemaVersion: last.schemaVersion, registryVersion: last.registryVersion, status: last.status,
    stores: last.stores, diagnostics: last.diagnostics, scope: "LAST_PASS" as const, passes,
    cumulative: { scope: "CURRENT_SEARCH" as const, eligibleStores, attemptedMerchantIds, completedMerchantIds,
      attemptedStorePasses: attemptedStorePasses.length,
      failedStorePasses: attemptedStorePasses.filter(store => store.status === "UNAVAILABLE" ||
        store.status === "PARTIAL" && store.reason !== undefined).length,
      physicalRequests: passes.reduce((total, pass) => total + pass.diagnostics.physicalRequests, 0),
      responseBytes: passes.reduce((total, pass) => total + pass.diagnostics.responseBytes, 0),
      registryCoverageComplete: eligibleStores > 0 && completedMerchantIds.length === eligibleStores &&
        passes.every(pass => pass.registryVersion === last.registryVersion) } };
}

export function wooRoutingExplanation(coverage: ReturnType<typeof wooSearchCoverage>, locale: "en-US" | "zh-CN"): string {
  if (coverage === undefined || coverage.passes.length === 0 ||
    !coverage.passes.every(pass => pass.diagnostics.routing?.matchedStores === 0)) return "";
  return locale === "zh-CN"
    ? "WooCommerce 本次候选池没有匹配的商家类目或品牌元数据，仅作有限探索；这是覆盖缺口，不代表商品不存在。"
    : "WooCommerce found no matching merchant category or brand metadata in this pass's candidate pool and used bounded exploration only; this is a coverage gap, not proof of product absence.";
}

export function shopifySearchCoverage(execution: Pick<UnifiedSearchExecution, "shopifyResult" | "shopifyPasses">) {
  if (execution.shopifyPasses === undefined) return undefined;
  return { scope: "RETURNED_PAGES" as const, passes: execution.shopifyPasses,
    ...(execution.shopifyResult?.pagination === undefined ? {} : { hasMoreResults: execution.shopifyResult.pagination.hasNextPage }) };
}

export type SearchOutcome = "REVIEW_REQUIRED" | "IDENTITY_UNVERIFIED" | "REQUIREMENTS_UNVERIFIED" | "MATCH_FOUND" | "NO_CANDIDATES" |
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
  const sourceFailures = execution.sourceFailures?.map(({ source, kind, retryable, scope, phase, validation }) => {
    const safeValidation = SourceValidationDetailsSchema.safeParse(validation);
    return { source, kind, retryable,
      ...(scope === "SOURCE" || scope === "SEARCH" ? { scope } : {}),
      ...(phase !== undefined && ["DNS", "REQUEST", "BODY"].includes(phase) ? { phase } : {}),
      ...(safeValidation.success ? { validation: safeValidation.data } : {}) };
  });
  const nonTransientFailure = ["SECURITY_REJECTED", "SCHEMA_INVALID", "INVALID_QUERY", "SOURCE_REJECTED", "BUDGET_EXHAUSTED", "UNKNOWN"]
    .map(kind => sourceFailures?.find(failure => !allowsIndependentSourceRecovery(failure) && failure.kind === kind)).find(Boolean);
  const sourceObservations = execution.sourcePassDiagnostics.reduce((total, pass) =>
    total + pass.rawProducts.awin + pass.rawProducts.shopify + pass.rawProducts.ebay + (pass.rawProducts.woocommerce ?? 0), 0) + (execution.webRecovery?.verified ?? 0);
  const funnel = execution.candidateFunnel;
  const retrieved = execution.retrievedProductHashes;
  const wooCoverage = wooSearchCoverage(execution);
  const wooState = wooCoverageState(execution.woocommerceResult, execution.sourceFailures, execution.woocommercePasses);
  const shopifyCoverage = shopifySearchCoverage(execution);
  const satisfiedReturned = countDisplayEligibleCandidates(execution.candidates, true);
  return {
    version: 1,
    ...run,
    // A relaxed execution can have zero new offers while retaining reviewed
    // first-round cards. These scopes do not change the underlying counters.
    diagnosticScopes: {
      officialStore: "CURRENT_RETRIEVAL" as const,
      ...(funnel === undefined ? {} : { candidateFunnel: "CURRENT_RETRIEVAL" as const }),
      ...(run?.visualFunnel === undefined ? {} : { visualFunnel: "SEARCH_FLOW_EVENTS" as const }),
      ...(counts.imageAttempts === undefined ? {} : { imageAttempts: "CURRENT_IMAGE_LOAD" as const }),
      ...(counts.imagesLoaded === undefined ? {} : { imagesLoaded: "CURRENT_IMAGE_LOAD" as const }),
      ...(counts.reviewed === undefined ? {} : { reviewed: "VISUAL_FLOW" as const }),
      ...(counts.reviewConflicts === undefined ? {} : { reviewConflicts: "VISUAL_FLOW" as const }),
      ...(counts.reviewInsufficient === undefined ? {} : { reviewInsufficient: "VISUAL_FLOW" as const }),
      ...(counts.returned === undefined ? {} : { returned: "CURRENT_RESPONSE" as const })
    },
    outcome: run?.budgetExhausted === true && outcome !== "MATCH_FOUND" && outcome !== "REVIEW_REQUIRED"
      ? "BUDGET_EXHAUSTED" as const : outcome,
    sources: execution.sourceStatus,
    ...(shopifyCoverage === undefined ? {} : { shopifyCoverage }),
    ...(wooCoverage === undefined ? {} : { woocommerce: { registryVersion: wooCoverage.registryVersion, status: wooCoverage.status,
      ...wooCoverage.diagnostics, scope: wooCoverage.scope, passes: wooCoverage.passes, cumulative: wooCoverage.cumulative } }),
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
      satisfiedReturned,
      awaitingVerification: execution.candidates.length - satisfiedReturned,
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
      : Object.entries(execution.sourceStatus).some(([source, status]) => source === "woocommerce" ? !wooState.completed : status === "UNAVAILABLE" ||
        (status === "PARTIAL" && !(source === "shopify" && isCompletedShopifyPage(execution.shopifyResult, execution.sourceFailures)))) ? "SOURCE_UNAVAILABLE"
        : satisfiedReturned === 0 && execution.candidates.some(candidate => candidate.requestIdentityStatus === "NEEDS_VERIFICATION")
          ? "IDENTITY_UNVERIFIED" : execution.candidates.length > 0 && satisfiedReturned === 0
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
