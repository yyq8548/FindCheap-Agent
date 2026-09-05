import { z } from "zod";
import type { UnifiedSearchExecution } from "./search-products.js";
import { countDisplayEligibleCandidates, countRecommendationEligibleCandidates } from "./product-candidate-ranking.js";

export const TextSearchRecoverySchema = z.object({
  action: z.enum(["NONE", "REQUEST_WEB_SEARCH", "REPORT_UNVERIFIED_MERCHANT", "REPORT_INCOMPLETE"]),
  reason: z.enum(["MATCH_FOUND", "NO_QUALIFIED_MATCH", "REQUIREMENTS_UNVERIFIED", "MERCHANT_UNVERIFIED", "SOURCE_UNAVAILABLE", "BUDGET_EXHAUSTED"]),
  qualified: z.number().int().nonnegative(), recommendable: z.number().int().nonnegative(),
  awaitingVerification: z.number().int().nonnegative()
}).strict();

export function textSearchRecovery(execution: UnifiedSearchExecution, allowAlternatives = false) {
  const qualified = countDisplayEligibleCandidates(execution.candidates, allowAlternatives);
  const recommendable = countRecommendationEligibleCandidates(execution.candidates);
  const awaitingVerification = execution.candidates.length - qualified;
  const base = { qualified, recommendable, awaitingVerification };
  if (execution.searchRun?.diagnostics().budgetExhausted) return { ...base,
    action: "REPORT_INCOMPLETE" as const, reason: "BUDGET_EXHAUSTED" as const };
  // The execution layer independently assesses safe recovery. A transient failed
  // source is incomplete coverage, not a veto on another authorized read-only source.
  if (execution.chromeFallbackEligible) return { ...base, action: "REQUEST_WEB_SEARCH" as const,
    reason: Object.values(execution.sourceStatus).some(value => value === "UNAVAILABLE" || value === "PARTIAL")
      ? "SOURCE_UNAVAILABLE" as const : qualified > 0 && recommendable === 0 ? "MERCHANT_UNVERIFIED" as const
        : awaitingVerification > 0 ? "REQUIREMENTS_UNVERIFIED" as const : "NO_QUALIFIED_MATCH" as const };
  if (Object.values(execution.sourceStatus).some(value => value === "UNAVAILABLE" || value === "PARTIAL") ||
    ["UNAVAILABLE", "PARTIAL"].includes(execution.officialStoreFallback.status)) return { ...base,
    action: "REPORT_INCOMPLETE" as const, reason: "SOURCE_UNAVAILABLE" as const };
  if (qualified > 0 && recommendable === 0 && execution.candidates.filter(candidate =>
    countDisplayEligibleCandidates([candidate], allowAlternatives) > 0).every(candidate => candidate.recommendationTier !== "TRUSTED_OR_AFFILIATE")) return { ...base,
    action: "REPORT_UNVERIFIED_MERCHANT" as const, reason: "MERCHANT_UNVERIFIED" as const };
  return { ...base, action: "NONE" as const, reason: qualified > 0 ? "MATCH_FOUND" as const
    : awaitingVerification > 0 ? "REQUIREMENTS_UNVERIFIED" as const : "NO_QUALIFIED_MATCH" as const };
}
