import type { MerchantAdapter, RawMerchantOffer } from "../../../../packages/merchant-sdk/src/index.js";
import {
  storeEvidence,
  type EvidenceRepository
} from "../evidence/store-evidence.js";

export type RefreshJob = {
  merchantId: string;
  merchantProductId: string;
  sourceVersion: string;
  idempotencyKey?: string;
};

export type PublishedOffer = RawMerchantOffer & {
  offerId: string;
  evidenceRefs: string[];
};

export type RefreshOutcome =
  | { status: "DISABLED" }
  | { status: "KILL_SWITCHED" }
  | { status: "CIRCUIT_OPEN" }
  | { status: "NOT_FOUND" }
  | { status: "PUBLISHED"; offerId: string };

export type FreshnessPolicy = { ttlMs: number; maxFutureSkewMs: number };

export interface OfferRepository {
  /** Upserts at most once for an idempotency key. */
  upsert(offer: PublishedOffer, idempotencyKey: string): Promise<void>;
}

export type RefreshControls = {
  flags: {
    isMerchantEnabled(merchantId: string): boolean;
    isSourceEnabled(merchantId: string): boolean;
  };
  killSwitch: { isActive(merchantId: string): boolean };
  circuitBreaker: { isOpen(merchantId: string): boolean };
};

export type RefreshProductDeps = RefreshControls & {
  adapters: { get(merchantId: string): MerchantAdapter };
  evidence: EvidenceRepository;
  offers: OfferRepository;
  clock: { now(): Date };
  freshness: FreshnessPolicy;
};

export function jobIdempotencyKey(job: RefreshJob): string {
  return `${job.merchantId}:${job.merchantProductId}:${job.sourceVersion}`;
}

export function sourceType(metadata: Record<string, string>): string {
  const value = metadata.sourceType;
  return value && value.length > 0 ? value : "unknown";
}

export function requireSafeSourceUrl(sourceUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error("evidence source URL is invalid");
  }
  if (parsed.protocol !== "https:") throw new Error("evidence source URL must use HTTPS");
}

export function requireEvidenceTimestamp(
  checkedAt: string,
  now: Date,
  maxFutureSkewMs: number
): void {
  const checked = Date.parse(checkedAt);
  if (!Number.isFinite(checked) || checked > now.getTime() + maxFutureSkewMs) {
    throw new Error("evidence freshness is invalid or future-skewed");
  }
}

export function requireFreshness(
  value: { checkedAt: string; expiresAt: string },
  now: Date,
  policy: FreshnessPolicy
): void {
  const checked = Date.parse(value.checkedAt);
  const expires = Date.parse(value.expiresAt);
  if (!Number.isFinite(checked) || !Number.isFinite(expires)) {
    throw new Error("freshness timestamps are invalid");
  }
  if (checked > now.getTime() + policy.maxFutureSkewMs) {
    throw new Error("freshness checkedAt is future-skewed");
  }
  if (expires <= checked || expires <= now.getTime()) {
    throw new Error("freshness has expired or has an invalid interval");
  }
  if (expires - checked > policy.ttlMs) {
    throw new Error("freshness exceeds the configured TTL");
  }
}

function controlsOutcome(job: RefreshJob, deps: RefreshControls): RefreshOutcome | null {
  if (!deps.flags.isMerchantEnabled(job.merchantId) || !deps.flags.isSourceEnabled(job.merchantId)) {
    return { status: "DISABLED" };
  }
  if (deps.killSwitch.isActive(job.merchantId)) return { status: "KILL_SWITCHED" };
  if (deps.circuitBreaker.isOpen(job.merchantId)) return { status: "CIRCUIT_OPEN" };
  return null;
}

export async function refreshProduct(
  job: RefreshJob,
  deps: RefreshProductDeps
): Promise<RefreshOutcome> {
  const stopped = controlsOutcome(job, deps);
  if (stopped) return stopped;

  const adapter = deps.adapters.get(job.merchantId);
  const raw = await adapter.refreshProduct(job.merchantProductId);
  const offer = await adapter.getOffer(job.merchantProductId);
  const now = deps.clock.now();

  if (raw.merchantProductId !== job.merchantProductId) {
    throw new Error("refresh result does not match requested product");
  }
  requireSafeSourceUrl(raw.sourceUrl);
  requireEvidenceTimestamp(raw.checkedAt, now, deps.freshness.maxFutureSkewMs);

  const baseKey = jobIdempotencyKey(job);
  const evidence = await storeEvidence(deps.evidence, {
    jobIdempotencyKey: baseKey,
    merchantId: job.merchantId,
    sourceUrl: raw.sourceUrl,
    sourceType: sourceType(raw.metadata),
    rawContent: raw.rawEvidence,
    capturedAt: now.toISOString(),
    metadata: { ...raw.metadata, sourceCheckedAt: raw.checkedAt }
  });

  if (!offer) return { status: "NOT_FOUND" };
  if (offer.merchantId !== job.merchantId || offer.merchantProductId !== job.merchantProductId) {
    throw new Error("offer does not match requested merchant product");
  }
  requireFreshness(offer, now, deps.freshness);

  const published: PublishedOffer = {
    ...offer,
    offerId: `${job.merchantId}:${job.merchantProductId}`,
    evidenceRefs: [...new Set([...offer.evidenceRefs, evidence.id])]
  };
  await deps.offers.upsert(published, `${baseKey}:offer:${evidence.contentHash}`);
  return { status: "PUBLISHED", offerId: published.offerId };
}
