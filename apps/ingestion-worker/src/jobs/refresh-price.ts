import type { MerchantAdapter, RawPriceQuote } from "../../../../packages/merchant-sdk/src/index.js";
import {
  storeEvidence,
  type EvidenceRepository
} from "../evidence/store-evidence.js";
import {
  detectPriceAnomaly,
  type QuarantineRepository
} from "../quality/quarantine.js";
import {
  jobIdempotencyKey,
  requireEvidenceTimestamp,
  requireFreshness,
  requireSafeSourceUrl,
  sourceType,
  type FreshnessPolicy,
  type RefreshControls,
  type RefreshJob
} from "./refresh-product.js";

export type RefreshPriceJob = RefreshJob & { zipCode: string; memberships: string[] };

export type PublishedQuote = RawPriceQuote & {
  quoteId: string;
  merchantId: string;
  deliveredPriceCents: number;
  evidenceRefs: string[];
};

export type RefreshPriceOutcome =
  | { status: "DISABLED" }
  | { status: "KILL_SWITCHED" }
  | { status: "CIRCUIT_OPEN" }
  | { status: "QUARANTINED"; reason: "PRICE_DROP_AT_LEAST_90_PERCENT" }
  | { status: "PUBLISHED"; quoteId: string };

export interface QuoteRepository {
  previousDeliveredPriceCents(merchantId: string, merchantProductId: string): Promise<number | null>;
  /** Saves at most one record for an idempotency key. */
  save(quote: PublishedQuote, idempotencyKey: string): Promise<void>;
}

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
  if (!deps.flags.isMerchantEnabled(job.merchantId) || !deps.flags.isSourceEnabled(job.merchantId)) {
    return { status: "DISABLED" };
  }
  if (deps.killSwitch.isActive(job.merchantId)) return { status: "KILL_SWITCHED" };
  if (deps.circuitBreaker.isOpen(job.merchantId)) return { status: "CIRCUIT_OPEN" };

  const adapter = deps.adapters.get(job.merchantId);
  const raw = await adapter.refreshProduct(job.merchantProductId);
  const quote = await adapter.quoteDeliveredPrice({
    merchantProductId: job.merchantProductId,
    zipCode: job.zipCode,
    memberships: job.memberships
  });
  const now = deps.clock.now();

  if (raw.merchantProductId !== job.merchantProductId || quote.merchantProductId !== job.merchantProductId) {
    throw new Error("price refresh result does not match requested product");
  }
  requireSafeSourceUrl(raw.sourceUrl);
  requireEvidenceTimestamp(raw.checkedAt, now, deps.freshness.maxFutureSkewMs);
  requireFreshness(quote, now, deps.freshness);
  const currentPriceCents = deliveredPriceCents(quote);

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
  const evidenceRefs = [...new Set([...quote.evidenceRefs, evidence.id])];
  const previous = await deps.quotes.previousDeliveredPriceCents(
    job.merchantId,
    job.merchantProductId
  );
  const anomaly = detectPriceAnomaly(currentPriceCents, previous);
  if (anomaly) {
    await deps.quarantine.save(
      {
        merchantId: job.merchantId,
        merchantProductId: job.merchantProductId,
        evidenceRefs,
        checkedAt: quote.checkedAt,
        ...anomaly
      },
      `${baseKey}:quarantine`
    );
    return { status: "QUARANTINED", reason: anomaly.reason };
  }

  const published: PublishedQuote = {
    ...quote,
    quoteId: `${job.merchantId}:${job.merchantProductId}:${job.zipCode}`,
    merchantId: job.merchantId,
    deliveredPriceCents: currentPriceCents,
    evidenceRefs
  };
  await deps.quotes.save(published, `${baseKey}:quote:${evidence.contentHash}`);
  return { status: "PUBLISHED", quoteId: published.quoteId };
}
