import { parseRfc3339Timestamp } from "../../../../packages/merchant-sdk/src/index.js";

export type FreshnessPolicy = {
  ttlMs: number;
  maxFutureSkewMs: number;
  evidenceMaxAgeMs: number;
  maxEvidenceToEntitySkewMs: number;
};

function requireNonnegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
}

export function validateFreshnessPolicy(policy: FreshnessPolicy): void {
  requireNonnegativeFinite(policy.ttlMs, "ttlMs");
  requireNonnegativeFinite(policy.maxFutureSkewMs, "maxFutureSkewMs");
  requireNonnegativeFinite(policy.evidenceMaxAgeMs, "evidenceMaxAgeMs");
  requireNonnegativeFinite(policy.maxEvidenceToEntitySkewMs, "maxEvidenceToEntitySkewMs");
}

function strictTimestamp(value: string, label: string): number {
  const parsed = parseRfc3339Timestamp(value);
  if (parsed === undefined) throw new Error(`${label} freshness timestamp is not strict RFC3339`);
  return parsed;
}

export function requireEvidenceFreshness(
  checkedAt: string,
  now: Date,
  policy: FreshnessPolicy
): number {
  validateFreshnessPolicy(policy);
  const checked = strictTimestamp(checkedAt, "evidence");
  if (checked > now.getTime() + policy.maxFutureSkewMs) {
    throw new Error("evidence freshness is future-skewed");
  }
  if (now.getTime() - checked > policy.evidenceMaxAgeMs) {
    throw new Error("evidence freshness is stale");
  }
  return checked;
}

export function requireEntityFreshness(
  value: { checkedAt: string; expiresAt: string },
  now: Date,
  policy: FreshnessPolicy
): { checked: number; expires: number } {
  validateFreshnessPolicy(policy);
  const checked = strictTimestamp(value.checkedAt, "entity checkedAt");
  const expires = strictTimestamp(value.expiresAt, "entity expiresAt");
  if (checked > now.getTime() + policy.maxFutureSkewMs) {
    throw new Error("entity freshness checkedAt is future-skewed");
  }
  if (expires <= checked || expires <= now.getTime()) {
    throw new Error("entity freshness has expired or has an invalid interval");
  }
  if (expires - checked > policy.ttlMs) {
    throw new Error("entity freshness exceeds the configured TTL");
  }
  return { checked, expires };
}

export function requireEvidenceSupportsEntity(
  evidenceCheckedAt: string,
  entity: { checkedAt: string; expiresAt: string },
  now: Date,
  policy: FreshnessPolicy
): void {
  const evidenceChecked = requireEvidenceFreshness(evidenceCheckedAt, now, policy);
  const { checked: entityChecked, expires } = requireEntityFreshness(entity, now, policy);
  if (Math.abs(evidenceChecked - entityChecked) > policy.maxEvidenceToEntitySkewMs) {
    throw new Error("evidence freshness does not match entity checkedAt");
  }
  if (evidenceChecked >= expires) {
    throw new Error("evidence freshness must precede entity expiry");
  }
}
