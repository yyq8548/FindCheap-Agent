import type {
  EvidenceRepository,
  EvidenceSaveResult,
  StoredEvidence
} from "../../../../apps/ingestion-worker/src/evidence/store-evidence.js";
import type {
  PublishedQuote,
  QuoteRepository
} from "../../../../apps/ingestion-worker/src/jobs/refresh-price.js";
import { canonicalHash, quoteContextKey } from "../../../../apps/ingestion-worker/src/jobs/refresh-identity.js";
import type {
  OfferRepository as WorkerOfferRepository
} from "../../../../apps/ingestion-worker/src/jobs/refresh-product.js";
import {
  detectPriceAnomaly,
  type QuarantineRecord,
  type QuarantineRepository
} from "../../../../apps/ingestion-worker/src/quality/quarantine.js";
import type { Database, SqlExecutor } from "../client.js";

type EvidenceRow = {
  id: string;
  source_identity_key: string;
  merchant_id: string;
  merchant_product_id: string;
  source_version: string;
  quote_context: { zipCode: string; memberships: string[] } | null;
  source_url: string;
  source_type: string;
  content_hash: string;
  raw_content: string;
  captured_at: Date;
  metadata: Record<string, string>;
};

export class IdempotencyConflictError extends Error {
  constructor(scope: string, key: string) {
    super(`idempotency conflict for ${scope}:${key}`);
    this.name = "IdempotencyConflictError";
  }
}

async function claimLedger(
  transaction: SqlExecutor,
  input: {
    scope: string;
    key: string;
    inputHash: string;
    resultKind: string;
    resultId: string;
  }
): Promise<"CLAIMED" | "REUSED"> {
  const inserted = await transaction.query<{ idempotency_key: string }>(
    `INSERT INTO ingestion_idempotency (
       scope, idempotency_key, input_hash, result_kind, result_id
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING
     RETURNING idempotency_key`,
    [input.scope, input.key, input.inputHash, input.resultKind, input.resultId]
  );
  if (inserted.rows[0]) return "CLAIMED";
  const existing = await transaction.query<{ input_hash: string; result_kind: string; result_id: string }>(
    `SELECT input_hash, result_kind, result_id
     FROM ingestion_idempotency WHERE scope = $1 AND idempotency_key = $2`,
    [input.scope, input.key]
  );
  const row = existing.rows[0];
  if (
    !row ||
    row.input_hash !== input.inputHash ||
    row.result_kind !== input.resultKind ||
    row.result_id !== input.resultId
  ) {
    throw new IdempotencyConflictError(input.scope, input.key);
  }
  return "REUSED";
}

function toStoredEvidence(row: EvidenceRow): StoredEvidence {
  return {
    id: row.id,
    sourceIdentityKey: row.source_identity_key,
    merchantId: row.merchant_id,
    merchantProductId: row.merchant_product_id,
    sourceVersion: row.source_version,
    ...(row.quote_context ? { quoteContext: row.quote_context } : {}),
    sourceUrl: row.source_url,
    sourceType: row.source_type,
    contentHash: row.content_hash,
    rawContent: row.raw_content,
    capturedAt: row.captured_at.toISOString(),
    metadata: row.metadata
  };
}

export function createIngestionEvidenceRepository(db: Database): EvidenceRepository {
  return {
    async save(write): Promise<EvidenceSaveResult> {
      return db.transaction(async (transaction) => {
        await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          write.sourceIdentityKey
        ]);
        const existing = await transaction.query<EvidenceRow>(
          "SELECT * FROM ingestion_evidence WHERE source_identity_key = $1",
          [write.sourceIdentityKey]
        );
        const row = existing.rows[0];
        if (row) {
          if (row.content_hash !== write.contentHash) {
            return {
              status: "CONFLICT",
              evidenceId: row.id,
              expectedContentHash: row.content_hash,
              actualContentHash: write.contentHash
            };
          }
          return { status: "REUSED", record: toStoredEvidence(row) };
        }

        await transaction.query(
          `INSERT INTO ingestion_evidence (
             id, source_identity_key, merchant_id, merchant_product_id, source_version,
             quote_context, source_url, source_type, content_hash, raw_content, captured_at, metadata
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12::jsonb)`,
          [
            write.id,
            write.sourceIdentityKey,
            write.merchantId,
            write.merchantProductId,
            write.sourceVersion,
            write.quoteContext ? JSON.stringify(write.quoteContext) : null,
            write.sourceUrl,
            write.sourceType,
            write.contentHash,
            write.rawContent,
            write.capturedAt,
            JSON.stringify(write.metadata)
          ]
        );
        return { status: "STORED", record: write };
      });
    }
  };
}

export function createIngestionOfferRepository(db: Database): WorkerOfferRepository {
  return {
    async upsert(offer, idempotencyKey) {
      await db.transaction(async (transaction) => {
        const primaryEvidenceId = requireIngestionEvidenceRef(offer.evidenceRefs);
        const inputHash = canonicalHash(offer);
        const claim = await claimLedger(transaction, {
          scope: "product-publication",
          key: idempotencyKey,
          inputHash,
          resultKind: "PUBLISHED",
          resultId: offer.offerId
        });
        if (claim === "REUSED") return;
        await transaction.query(
          `INSERT INTO merchant_product_staging (
             id, source_identity_key, merchant_id, merchant_product_id, source_version,
             payload, primary_evidence_id, evidence_refs, checked_at, expires_at
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
          [
            offer.offerId,
            offer.sourceIdentityKey,
            offer.merchantId,
            offer.merchantProductId,
            offer.sourceVersion,
            JSON.stringify(offer),
            primaryEvidenceId,
            offer.evidenceRefs,
            offer.checkedAt,
            offer.expiresAt
          ]
        );
      });
    }
  };
}

function requireIngestionEvidenceRef(evidenceRefs: string[]): string {
  const evidenceId = evidenceRefs.find((reference) => /^[a-f0-9]{64}$/u.test(reference));
  if (!evidenceId) throw new Error("published record requires ingestion evidence");
  return evidenceId;
}

async function latestPrice(
  transaction: SqlExecutor,
  quote: PublishedQuote,
  contextHash: string
): Promise<number | null> {
  const result = await transaction.query<{ delivered_price_cents: string }>(
    `SELECT delivered_price_cents::text
     FROM merchant_quote_staging
     WHERE merchant_id = $1 AND merchant_product_id = $2
       AND zip_code = $3 AND context_hash = $4
     ORDER BY checked_at DESC, id ASC LIMIT 1`,
    [quote.merchantId, quote.merchantProductId, quote.quoteContext.zipCode, contextHash]
  );
  const value = result.rows[0]?.delivered_price_cents;
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("price history must be a non-negative safe integer");
  }
  return parsed;
}

function priceAnomalyRecord(
  quote: PublishedQuote,
  previous: number
): QuarantineRecord | null {
  const anomaly = detectPriceAnomaly(quote.deliveredPriceCents, previous);
  return anomaly
    ? {
      merchantId: quote.merchantId,
      merchantProductId: quote.merchantProductId,
      quoteContext: quote.quoteContext,
      evidenceRefs: quote.evidenceRefs,
      checkedAt: quote.checkedAt,
      ...anomaly
    }
    : null;
}

export function createIngestionQuoteRepository(db: Database): QuoteRepository {
  return {
    async commit(input) {
      return db.transaction(async (transaction) => {
        await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          canonicalHash({
            merchantId: input.quote.merchantId,
            merchantProductId: input.quote.merchantProductId,
            quoteContext: input.quote.quoteContext
          })
        ]);
        const contextHash = quoteContextKey(input.quote.quoteContext);
        const previous = await latestPrice(transaction, input.quote, contextHash);
        const quarantine = previous === null ? null : priceAnomalyRecord(input.quote, previous);
        const primaryEvidenceId = requireIngestionEvidenceRef(input.quote.evidenceRefs);
        const inputHash = canonicalHash(input.quote);
        const existingPublication = await transaction.query<{
          input_hash: string;
          result_kind: "PUBLISHED" | "QUARANTINED";
          result_id: string;
        }>(
          `SELECT input_hash, result_kind, result_id
           FROM ingestion_idempotency
           WHERE scope = $1 AND idempotency_key = $2`,
          ["price-publication", input.publicationKey]
        );
        const existing = existingPublication.rows[0];
        if (existing) {
          if (existing.input_hash !== inputHash) {
            throw new IdempotencyConflictError("price-publication", input.publicationKey);
          }
          if (existing.result_kind === "PUBLISHED" && existing.result_id === input.quote.quoteId) {
            return { status: "PUBLISHED" };
          }
          if (
            existing.result_kind === "QUARANTINED" &&
            existing.result_id === input.quarantineKey
          ) {
            const persisted = await transaction.query<{
              reason: "PRICE_DROP_AT_LEAST_90_PERCENT";
              previous_price_cents: string;
              current_price_cents: string;
              evidence_refs: string[];
              checked_at: Date;
            }>(
              `SELECT reason, previous_price_cents::text, current_price_cents::text,
                      evidence_refs, checked_at
               FROM merchant_ingestion_quarantine WHERE id = $1`,
              [input.quarantineKey]
            );
            const row = persisted.rows[0];
            if (!row) throw new Error("idempotency ledger points to missing quarantine");
            return {
              status: "QUARANTINED",
              quarantine: {
                reason: row.reason,
                merchantId: input.quote.merchantId,
                merchantProductId: input.quote.merchantProductId,
                quoteContext: input.quote.quoteContext,
                evidenceRefs: row.evidence_refs,
                checkedAt: row.checked_at.toISOString(),
                previousPriceCents: Number(row.previous_price_cents),
                currentPriceCents: Number(row.current_price_cents)
              }
            };
          }
          throw new IdempotencyConflictError("price-publication", input.publicationKey);
        }

        if (quarantine) {
          const claim = await claimLedger(transaction, {
            scope: "price-publication",
            key: input.publicationKey,
            inputHash,
            resultKind: "QUARANTINED",
            resultId: input.quarantineKey
          });
          if (claim === "CLAIMED") {
            await insertQuarantine(transaction, {
              id: input.quarantineKey,
              sourceIdentityKey: input.quote.sourceIdentityKey,
              sourceVersion: input.quote.sourceVersion,
              record: quarantine,
              primaryEvidenceId,
              payload: input.quote
            });
          }
          return { status: "QUARANTINED", quarantine };
        }

        const claim = await claimLedger(transaction, {
          scope: "price-publication",
          key: input.publicationKey,
          inputHash,
          resultKind: "PUBLISHED",
          resultId: input.quote.quoteId
        });
        if (claim === "CLAIMED") {
          await transaction.query(
            `INSERT INTO merchant_quote_staging (
               id, source_identity_key, merchant_id, merchant_product_id, source_version,
               zip_code, memberships, context_hash, delivered_price_cents, payload,
               primary_evidence_id, evidence_refs, checked_at, expires_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb, $11, $12, $13, $14)`,
            [
              input.quote.quoteId,
              input.quote.sourceIdentityKey,
              input.quote.merchantId,
              input.quote.merchantProductId,
              input.quote.sourceVersion,
              input.quote.quoteContext.zipCode,
              JSON.stringify(input.quote.quoteContext.memberships),
              contextHash,
              input.quote.deliveredPriceCents,
              JSON.stringify(input.quote),
              primaryEvidenceId,
              input.quote.evidenceRefs,
              input.quote.checkedAt,
              input.quote.expiresAt
            ]
          );
        }
        return { status: "PUBLISHED" };
      });
    }
  };
}

async function insertQuarantine(
  transaction: SqlExecutor,
  input: {
    id: string;
    sourceIdentityKey: string;
    sourceVersion: string;
    record: QuarantineRecord;
    primaryEvidenceId: string;
    payload: unknown;
  }
): Promise<void> {
  const previousPriceCents = "previousPriceCents" in input.record
    ? input.record.previousPriceCents
    : null;
  const currentPriceCents = "currentPriceCents" in input.record
    ? input.record.currentPriceCents
    : null;
  await transaction.query(
    `INSERT INTO merchant_ingestion_quarantine (
       id, source_identity_key, merchant_id, merchant_product_id, source_version,
       zip_code, memberships, context_hash, reason, previous_price_cents,
       current_price_cents, payload, primary_evidence_id, evidence_refs, checked_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12::jsonb, $13, $14, $15)`,
    [
      input.id,
      input.sourceIdentityKey,
      input.record.merchantId,
      input.record.merchantProductId,
      input.sourceVersion,
      input.record.quoteContext.zipCode,
      JSON.stringify(input.record.quoteContext.memberships),
      quoteContextKey(input.record.quoteContext),
      input.record.reason,
      previousPriceCents,
      currentPriceCents,
      JSON.stringify(input.payload),
      input.primaryEvidenceId,
      input.record.evidenceRefs,
      input.record.checkedAt
    ]
  );
}

export function createIngestionQuarantineRepository(db: Database): QuarantineRepository {
  return {
    async save(record, idempotencyKey) {
      await db.transaction(async (transaction) => {
        const primaryEvidenceId = requireIngestionEvidenceRef(record.evidenceRefs);
        const inputHash = canonicalHash(record);
        const claim = await claimLedger(transaction, {
          scope: "source-conflict-quarantine",
          key: idempotencyKey,
          inputHash,
          resultKind: "QUARANTINED",
          resultId: idempotencyKey
        });
        if (claim === "REUSED") return;
        await insertQuarantine(transaction, {
          id: idempotencyKey,
          sourceIdentityKey: "sourceIdentityKey" in record
            ? record.sourceIdentityKey
            : idempotencyKey,
          sourceVersion: "sourceVersion" in record ? record.sourceVersion : "source-conflict",
          record,
          primaryEvidenceId,
          payload: record
        });
      });
    }
  };
}

/** Concrete durable dependencies for ingestion workers; promotion waits for product identity. */
export function createIngestionPersistence(db: Database): {
  evidence: EvidenceRepository;
  offers: WorkerOfferRepository;
  quotes: QuoteRepository;
  quarantine: QuarantineRepository;
} {
  return {
    evidence: createIngestionEvidenceRepository(db),
    offers: createIngestionOfferRepository(db),
    quotes: createIngestionQuoteRepository(db),
    quarantine: createIngestionQuarantineRepository(db)
  };
}
