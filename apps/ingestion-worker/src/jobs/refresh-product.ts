import {
  requireEvidenceRefs,
  requireMetadata,
  requireOfferShape,
  type MerchantAdapter,
  type RawMerchantOffer
} from "../../../../packages/merchant-sdk/src/index.js";
import { storeEvidence, type EvidenceRepository } from "../evidence/store-evidence.js";
import {
  canonicalizeProductRefreshJob,
  productSourceIdentity,
  stableRecordId,
  type RefreshJob
} from "./refresh-identity.js";
import {
  requireEvidenceFreshness,
  requireEvidenceSupportsEntity,
  validateFreshnessPolicy,
  type FreshnessPolicy
} from "./freshness.js";
import { callAdapterSource } from "./source-error.js";

export type { RefreshJob } from "./refresh-identity.js";
export type { FreshnessPolicy } from "./freshness.js";

export type PublishedOffer = RawMerchantOffer & {
  offerId: string;
  sourceIdentityKey: string;
  sourceVersion: string;
  primaryEvidenceId: string;
  externalEvidenceRefs: string[];
  evidenceRefs: string[];
};

export type RefreshOutcome =
  | { status: "DISABLED" }
  | { status: "KILL_SWITCHED" }
  | { status: "CIRCUIT_OPEN" }
  | { status: "NOT_FOUND" }
  | { status: "PUBLISHED"; offerId: string };

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
  return canonicalizeProductRefreshJob(job).idempotencyKey;
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
  const canonicalJob = canonicalizeProductRefreshJob(job);
  validateFreshnessPolicy(deps.freshness);
  const stopped = controlsOutcome(canonicalJob, deps);
  if (stopped) return stopped;

  const adapter = deps.adapters.get(canonicalJob.merchantId);
  const raw = await callAdapterSource(() => adapter.refreshOffer({
    merchantProductId: canonicalJob.merchantProductId,
    sourceVersion: canonicalJob.sourceVersion
  }));
  const offer = raw.offer;
  const now = deps.clock.now();

  if (raw.merchantProductId !== canonicalJob.merchantProductId) {
    throw new Error("refresh result does not match requested product");
  }
  if (raw.sourceVersion !== canonicalJob.sourceVersion) {
    throw new Error("refresh source version does not match requested source version");
  }
  requireSafeSourceUrl(raw.sourceUrl);
  requireEvidenceFreshness(raw.checkedAt, now, deps.freshness);
  requireMetadata(raw.metadata);

  if (!offer) {
    await storeEvidence(deps.evidence, {
      sourceIdentity: productSourceIdentity(canonicalJob),
      sourceUrl: raw.sourceUrl,
      sourceType: sourceType(raw.metadata),
      rawContent: raw.rawEvidence,
      capturedAt: now.toISOString(),
      metadata: { ...raw.metadata, sourceCheckedAt: raw.checkedAt }
    });
    return { status: "NOT_FOUND" };
  }
  if (
    offer.merchantId !== canonicalJob.merchantId ||
    offer.merchantProductId !== canonicalJob.merchantProductId
  ) {
    throw new Error("offer does not match requested merchant product");
  }
  requireEvidenceSupportsEntity(raw.checkedAt, offer, now, deps.freshness);
  requireOfferShape(offer);
  requireEvidenceRefs(offer.evidenceRefs, "offer external evidence refs");

  const identity = productSourceIdentity(canonicalJob);
  const evidence = await storeEvidence(deps.evidence, {
    sourceIdentity: identity,
    sourceUrl: raw.sourceUrl,
    sourceType: sourceType(raw.metadata),
    rawContent: raw.rawEvidence,
    capturedAt: now.toISOString(),
    metadata: { ...raw.metadata, sourceCheckedAt: raw.checkedAt }
  });

  const published: PublishedOffer = {
    ...offer,
    offerId: stableRecordId("offer", identity.key),
    sourceIdentityKey: identity.key,
    sourceVersion: identity.sourceVersion,
    primaryEvidenceId: evidence.id,
    externalEvidenceRefs: [...new Set(offer.evidenceRefs)],
    evidenceRefs: [...new Set([...offer.evidenceRefs, evidence.id])]
  };
  await deps.offers.upsert(published, stableRecordId("offer", identity.key));
  return { status: "PUBLISHED", offerId: published.offerId };
}
