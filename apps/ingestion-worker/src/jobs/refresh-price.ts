import {
  requireEvidenceRefs,
  requireMetadata,
  requireQuoteShape,
  type MerchantAdapter,
  type RawPriceQuote
} from "../../../../packages/merchant-sdk/src/index.js";
import type {
  PublishedQuote,
  QuoteRepository,
  QuarantineRepository
} from "../../../../packages/ingestion-contracts/src/index.js";
import {
  SourceVersionConflictError,
  storeEvidence,
  type EvidenceRepository
} from "../evidence/store-evidence.js";
import {
  requireSafeSourceUrl,
  sourceType,
  type RefreshControls,
} from "./refresh-product.js";
import {
  canonicalizePriceRefreshJob,
  priceSourceIdentity,
  stableRecordId,
  type RefreshPriceJob
} from "./refresh-identity.js";
import {
  requireEvidenceSupportsEntity,
  validateFreshnessPolicy,
  type FreshnessPolicy
} from "./freshness.js";
import { callAdapterSource } from "./source-error.js";

export type { RefreshPriceJob } from "./refresh-identity.js";

export type { PublishedQuote } from "../../../../packages/ingestion-contracts/src/index.js";

export type RefreshPriceOutcome =
  | { status: "DISABLED" }
  | { status: "KILL_SWITCHED" }
  | { status: "CIRCUIT_OPEN" }
  | {
    status: "QUARANTINED";
    reason: "PRICE_DROP_AT_LEAST_90_PERCENT" | "SOURCE_VERSION_CONFLICT";
  }
  | { status: "PUBLISHED"; quoteId: string };

export type { QuoteRepository } from "../../../../packages/ingestion-contracts/src/index.js";

export type RefreshPriceDeps = RefreshControls & {
  adapters: { get(merchantId: string): MerchantAdapter };
  evidence: EvidenceRepository;
  quotes: QuoteRepository;
  quarantine: QuarantineRepository;
  clock: { now(): Date };
  freshness: FreshnessPolicy;
};

function deliveredPriceCents(quote: RawPriceQuote): number {
  const parts = [
    quote.itemPriceCents,
    quote.shippingCents,
    quote.taxCents,
    quote.mandatoryFeeCents
  ];
  if (parts.some((part) => !Number.isSafeInteger(part) || part < 0)) {
    throw new Error("price components must be non-negative safe integers");
  }
  const total = parts.reduce((sum, part) => sum + part, 0);
  if (!Number.isSafeInteger(total)) throw new Error("delivered price exceeds safe integer range");
  return total;
}

export async function refreshPrice(
  job: RefreshPriceJob,
  deps: RefreshPriceDeps
): Promise<RefreshPriceOutcome> {
  const canonicalJob = canonicalizePriceRefreshJob(job);
  validateFreshnessPolicy(deps.freshness);
  if (
    !deps.flags.isMerchantEnabled(canonicalJob.merchantId) ||
    !deps.flags.isSourceEnabled(canonicalJob.merchantId)
  ) {
    return { status: "DISABLED" };
  }
  if (deps.killSwitch.isActive(canonicalJob.merchantId)) return { status: "KILL_SWITCHED" };
  if (deps.circuitBreaker.isOpen(canonicalJob.merchantId)) return { status: "CIRCUIT_OPEN" };

  const adapter = deps.adapters.get(canonicalJob.merchantId);
  const raw = await callAdapterSource(() => adapter.refreshPrice({
    merchantProductId: canonicalJob.merchantProductId,
    zipCode: canonicalJob.zipCode,
    memberships: canonicalJob.memberships,
    sourceVersion: canonicalJob.sourceVersion
  }));
  const quote = raw.quote;
  const now = deps.clock.now();

  if (
    raw.merchantProductId !== canonicalJob.merchantProductId ||
    quote.merchantProductId !== canonicalJob.merchantProductId
  ) {
    throw new Error("price refresh result does not match requested product");
  }
  if (raw.sourceVersion !== canonicalJob.sourceVersion) {
    throw new Error("price refresh source version does not match requested source version");
  }
  requireSafeSourceUrl(raw.sourceUrl);
  requireEvidenceSupportsEntity(raw.checkedAt, quote, now, deps.freshness);
  requireMetadata(raw.metadata);
  requireQuoteShape(quote);
  requireEvidenceRefs(quote.evidenceRefs, "quote external evidence refs");
  const currentPriceCents = deliveredPriceCents(quote);

  const identity = priceSourceIdentity(canonicalJob);
  let evidence;
  try {
    evidence = await storeEvidence(deps.evidence, {
      sourceIdentity: identity,
      sourceUrl: raw.sourceUrl,
      sourceType: sourceType(raw.metadata),
      rawContent: raw.rawEvidence,
      capturedAt: now.toISOString(),
      metadata: { ...raw.metadata, sourceCheckedAt: raw.checkedAt }
    });
  } catch (error) {
    if (!(error instanceof SourceVersionConflictError)) throw error;
    await deps.quarantine.save(
      {
        merchantId: canonicalJob.merchantId,
        merchantProductId: canonicalJob.merchantProductId,
        sourceIdentityKey: identity.key,
        sourceVersion: identity.sourceVersion,
        sourceUrl: raw.sourceUrl,
        rawEvidence: raw.rawEvidence,
        metadata: { ...raw.metadata, sourceCheckedAt: raw.checkedAt },
        quoteContext: { zipCode: canonicalJob.zipCode, memberships: canonicalJob.memberships },
        evidenceRefs: [...new Set([...quote.evidenceRefs, error.evidenceId])],
        primaryEvidenceId: error.evidenceId,
        conflictEvidenceId: error.conflictEvidenceId,
        externalEvidenceRefs: [...new Set(quote.evidenceRefs)],
        checkedAt: raw.checkedAt,
        reason: "SOURCE_VERSION_CONFLICT",
        expectedContentHash: error.expectedContentHash,
        actualContentHash: error.actualContentHash
      },
      stableRecordId("quarantine", identity.key)
    );
    return { status: "QUARANTINED", reason: "SOURCE_VERSION_CONFLICT" };
  }
  const evidenceRefs = [...new Set([...quote.evidenceRefs, evidence.id])];
  const published: PublishedQuote = {
    ...quote,
    quoteId: stableRecordId("quote", identity.key),
    merchantId: canonicalJob.merchantId,
    sourceIdentityKey: identity.key,
    sourceVersion: identity.sourceVersion,
    quoteContext: { zipCode: canonicalJob.zipCode, memberships: canonicalJob.memberships },
    primaryEvidenceId: evidence.id,
    externalEvidenceRefs: [...new Set(quote.evidenceRefs)],
    deliveredPriceCents: currentPriceCents,
    evidenceRefs
  };
  const result = await deps.quotes.commit({
    quote: published,
    publicationKey: stableRecordId("quote", identity.key),
    quarantineKey: stableRecordId("quarantine", identity.key)
  });
  if (result.status === "QUARANTINED") {
    return { status: "QUARANTINED", reason: result.quarantine.reason };
  }
  return { status: "PUBLISHED", quoteId: published.quoteId };
}
