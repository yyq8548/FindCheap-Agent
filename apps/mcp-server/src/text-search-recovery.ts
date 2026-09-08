import { z } from "zod";
import { WebConsentStatusSchema } from "./web-product-recovery.js";
import type { UnifiedSearchExecution } from "./search-products.js";
import { countComparableMerchants, countDisplayEligibleCandidates, countQualifiedMatchCandidates, countRecommendationEligibleCandidates } from "./product-candidate-ranking.js";

export const TextSearchRecoverySchema = z.object({
  action: z.enum(["NONE", "REQUEST_WEB_SEARCH", "REPORT_UNVERIFIED_MERCHANT", "REPORT_INCOMPLETE"]),
  reason: z.enum(["MATCH_FOUND", "COMPARISON_INCOMPLETE", "NO_QUALIFIED_MATCH", "IDENTITY_UNVERIFIED", "REQUIREMENTS_UNVERIFIED", "MERCHANT_UNVERIFIED", "SOURCE_UNAVAILABLE", "BUDGET_EXHAUSTED", "AUTHORIZATION_STOPPED"]),
  consentStatus: WebConsentStatusSchema.optional(),
  comparableMerchants: z.number().int().nonnegative().optional(),
  qualified: z.number().int().nonnegative(), recommendable: z.number().int().nonnegative(),
  qualifiedMatches: z.number().int().nonnegative().optional(),
  awaitingVerification: z.number().int().nonnegative()
}).strict();

export function textSearchRecovery(execution: UnifiedSearchExecution, allowAlternatives = false, compareMerchants = false) {
  const qualified = countDisplayEligibleCandidates(execution.candidates, allowAlternatives);
  const recommendable = countRecommendationEligibleCandidates(execution.candidates);
  const qualifiedMatches = countQualifiedMatchCandidates(execution.candidates);
  const awaitingVerification = execution.candidates.length - qualified;
  const comparableMerchants = countComparableMerchants(execution.candidates);
  const base = { qualified, recommendable, qualifiedMatches, awaitingVerification, ...(compareMerchants ? { comparableMerchants } : {}) };
  if (execution.searchRun?.diagnostics().budgetExhausted) return { ...base,
    action: "REPORT_INCOMPLETE" as const, reason: "BUDGET_EXHAUSTED" as const };
  if (qualifiedMatches === 0 && execution.candidates.some(candidate => candidate.requestIdentityStatus === "NEEDS_VERIFICATION")) return { ...base,
    action: execution.chromeFallbackEligible ? "REQUEST_WEB_SEARCH" as const : "REPORT_INCOMPLETE" as const,
    reason: "IDENTITY_UNVERIFIED" as const };
  if (compareMerchants && comparableMerchants < 2) return { ...base,
    action: execution.chromeFallbackEligible ? "REQUEST_WEB_SEARCH" as const : "REPORT_INCOMPLETE" as const,
    reason: "COMPARISON_INCOMPLETE" as const };
  // The execution layer independently assesses safe recovery. A transient failed
  // source is incomplete coverage, not a veto on another authorized read-only source.
  if (execution.chromeFallbackEligible) return { ...base, action: "REQUEST_WEB_SEARCH" as const,
    reason: Object.values(execution.sourceStatus).some(value => value === "UNAVAILABLE" || value === "PARTIAL")
      ? "SOURCE_UNAVAILABLE" as const : qualified > 0 && qualifiedMatches === 0 ? "MERCHANT_UNVERIFIED" as const
        : awaitingVerification > 0 ? "REQUIREMENTS_UNVERIFIED" as const : "NO_QUALIFIED_MATCH" as const };
  if (Object.values(execution.sourceStatus).some(value => value === "UNAVAILABLE" || value === "PARTIAL") ||
    ["UNAVAILABLE", "PARTIAL"].includes(execution.officialStoreFallback.status)) return { ...base,
    action: "REPORT_INCOMPLETE" as const, reason: "SOURCE_UNAVAILABLE" as const };
  if (qualified > 0 && qualifiedMatches === 0 && execution.candidates.filter(candidate =>
    countDisplayEligibleCandidates([candidate], allowAlternatives) > 0).every(candidate => candidate.recommendationTier !== "TRUSTED_OR_AFFILIATE")) return { ...base,
    action: "REPORT_UNVERIFIED_MERCHANT" as const, reason: "MERCHANT_UNVERIFIED" as const };
  return { ...base, action: "NONE" as const, reason: qualified > 0 ? "MATCH_FOUND" as const
    : awaitingVerification > 0 ? "REQUIREMENTS_UNVERIFIED" as const : "NO_QUALIFIED_MATCH" as const };
}
