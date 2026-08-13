export const PRICE_DROP_THRESHOLD_PERCENT = 90;

export type PriceAnomaly = {
  reason: "PRICE_DROP_AT_LEAST_90_PERCENT";
  previousPriceCents: number;
  currentPriceCents: number;
};

export type QuarantineRecord = PriceAnomaly & {
  merchantId: string;
  merchantProductId: string;
  evidenceRefs: string[];
  checkedAt: string;
  quoteContext: { zipCode: string; memberships: string[] };
} | {
  reason: "SOURCE_VERSION_CONFLICT";
  merchantId: string;
  merchantProductId: string;
  sourceIdentityKey: string;
  sourceVersion: string;
  sourceUrl: string;
  rawEvidence: string;
  metadata: Record<string, string>;
  evidenceRefs: string[];
  checkedAt: string;
  quoteContext: { zipCode: string; memberships: string[] };
  expectedContentHash: string;
  actualContentHash: string;
};

export interface QuarantineRepository {
  /** Saves at most one record for an idempotency key. */
  save(record: QuarantineRecord, idempotencyKey: string): Promise<void>;
}

export function detectPriceAnomaly(
  currentPriceCents: number,
  previousPriceCents: number | null
): PriceAnomaly | null {
  if (!Number.isSafeInteger(currentPriceCents) || currentPriceCents < 0) {
    throw new Error("current price must be a non-negative safe integer");
  }
  if (
    previousPriceCents !== null &&
    (!Number.isSafeInteger(previousPriceCents) || previousPriceCents < 0)
  ) {
    throw new Error("price history must be a non-negative safe integer");
  }
  if (previousPriceCents === null || previousPriceCents === 0) return null;

  // Integer arithmetic makes the inclusive 90% boundary deterministic.
  if (
    BigInt(currentPriceCents) * 100n <=
    BigInt(previousPriceCents) * BigInt(100 - PRICE_DROP_THRESHOLD_PERCENT)
  ) {
    return {
      reason: "PRICE_DROP_AT_LEAST_90_PERCENT",
      previousPriceCents,
      currentPriceCents
    };
  }
  return null;
}
