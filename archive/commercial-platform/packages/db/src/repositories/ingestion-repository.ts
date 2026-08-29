import type {
  EvidenceRepository,
  EvidenceSaveResult,
  EvidenceWrite,
  OfferRepository as WorkerOfferRepository,
  PublishedQuote,
  PublishedOffer,
  QuoteRepository,
  QuarantineRecord,
  QuarantineRepository,
  StoredEvidence
} from "../../../ingestion-contracts/src/index.js";
import {
  canonicalHash,
  detectPriceAnomaly,
  sha256,
  normalizeMemberships,
  normalizeZipCode,
  priceSourceIdentity,
  productSourceIdentity,
  quoteContextKey,
  stableRecordId
} from "../../../ingestion-contracts/src/index.js";
import {
  requireEvidenceRefs,
  requireHttpsUrl,
  requireJsonSafe,
  requireMetadata,
  requireOfferShape,
  requireQuoteShape,
  requireRawEvidence,
  requireSourceType,
  requireStrictTimestamp
} from "../../../merchant-sdk/src/index.js";
import type { Database, SqlExecutor } from "../client.js";

type QuoteContext = { zipCode: string; memberships: string[] };

type EvidenceRow = {
  id: string;
  source_identity_key: string;
  merchant_id: string;
  merchant_product_id: string;
  source_version: string;
  quote_context: QuoteContext | null;
  source_url: string;
  source_type: string;
  content_hash: string;
  raw_content: string;
  captured_at: Date;
  metadata: Record<string, string>;
};

type ConflictEvidenceRow = EvidenceRow & { expected_evidence_id: string };

export class IdempotencyConflictError extends Error {
  constructor(scope: string, key: string) {
    super(`idempotency conflict for ${scope}:${key}`);
    this.name = "IdempotencyConflictError";
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalHash(left) === canonicalHash(right);
}

function expectedIdentity(input: {
  merchantId: string;
  merchantProductId: string;
  sourceVersion: string;
  quoteContext?: QuoteContext;
}) {
  return input.quoteContext
    ? priceSourceIdentity({
      merchantId: input.merchantId,
      merchantProductId: input.merchantProductId,
      sourceVersion: input.sourceVersion,
      zipCode: input.quoteContext.zipCode,
      memberships: input.quoteContext.memberships
    })
    : productSourceIdentity(input);
}

function validateEvidenceWrite(write: EvidenceWrite): void {
  requireHttpsUrl(write.sourceUrl);
  requireSourceType(write.sourceType);
  requireRawEvidence(write.rawContent);
  requireMetadata(write.metadata);
  requireJsonSafe(write.metadata);
  requireStrictTimestamp(write.capturedAt, "evidence capturedAt");
  const identity = expectedIdentity(write);
  if (write.sourceIdentityKey !== identity.key) {
    throw new Error("evidence source identity key does not match canonical source tuple");
  }
  if (write.quoteContext && !sameJson(write.quoteContext, identity.quoteContext)) {
    throw new Error("evidence quote context is not canonical");
  }
  if (write.contentHash !== sha256(write.rawContent)) {
    throw new Error("evidence content hash does not match raw content");
  }
  if (write.id !== stableRecordId("evidence", identity.key)) {
    throw new Error("evidence id does not match canonical source identity");
  }
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

function rowMatchesSource(row: EvidenceRow, write: EvidenceWrite): boolean {
  return row.source_identity_key === write.sourceIdentityKey &&
    row.merchant_id === write.merchantId &&
    row.merchant_product_id === write.merchantProductId &&
    row.source_version === write.sourceVersion &&
    sameJson(row.quote_context, write.quoteContext ?? null);
}

function conflictEvidenceId(sourceIdentityKey: string, contentHash: string): string {
  return canonicalHash({ kind: "conflict-evidence", sourceIdentityKey, contentHash });
}

async function saveConflictEvidence(
  transaction: SqlExecutor,
  write: EvidenceWrite,
  expected: EvidenceRow
): Promise<string> {
  if (expected.id !== write.id || !rowMatchesSource(expected, write)) {
    throw new Error("stored evidence does not match canonical source tuple");
  }
  const id = conflictEvidenceId(write.sourceIdentityKey, write.contentHash);
  await transaction.query(
    `INSERT INTO ingestion_conflict_evidence (
       id, expected_evidence_id, source_identity_key, merchant_id, merchant_product_id,
       source_version, quote_context, source_url, source_type, content_hash,
       raw_content, captured_at, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13::jsonb)
     ON CONFLICT (source_identity_key, content_hash) DO NOTHING`,
    [
      id,
      expected.id,
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
  const persisted = await transaction.query<ConflictEvidenceRow>(
    "SELECT * FROM ingestion_conflict_evidence WHERE source_identity_key = $1 AND content_hash = $2",
    [write.sourceIdentityKey, write.contentHash]
  );
  const row = persisted.rows[0];
  if (!row || row.id !== id || row.expected_evidence_id !== expected.id ||
      !rowMatchesSource(row, write) || row.content_hash !== write.contentHash ||
      row.raw_content !== write.rawContent || row.source_url !== write.sourceUrl ||
      row.source_type !== write.sourceType || !sameJson(row.metadata, write.metadata)) {
    throw new Error("conflict evidence provenance mismatch");
  }
  return id;
}

export function createIngestionEvidenceRepository(db: Database): EvidenceRepository {
  return {
    async save(write): Promise<EvidenceSaveResult> {
      validateEvidenceWrite(write);
      return db.transaction(async (transaction) => {
        await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          write.sourceIdentityKey
        ]);
        const existing = await transaction.query<EvidenceRow>(
          "SELECT * FROM ingestion_evidence WHERE source_identity_key = $1 FOR SHARE",
          [write.sourceIdentityKey]
        );
        const row = existing.rows[0];
        if (row) {
          validateEvidenceWrite(toStoredEvidence(row));
          if (row.id !== write.id || !rowMatchesSource(row, write)) {
            throw new Error("stored evidence does not match canonical source tuple");
          }
          if (row.content_hash !== write.contentHash) {
            const conflictId = await saveConflictEvidence(transaction, write, row);
            return {
              status: "CONFLICT",
              evidenceId: row.id,
              conflictEvidenceId: conflictId,
              expectedContentHash: row.content_hash,
              actualContentHash: write.contentHash
            };
          }
          if (row.raw_content !== write.rawContent) {
            throw new Error("stored evidence content hash collision");
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

async function claimLedger(
  transaction: SqlExecutor,
  input: { scope: string; key: string; inputHash: string; resultKind: string; resultId: string }
): Promise<"CLAIMED" | "REUSED"> {
  const inserted = await transaction.query<{ idempotency_key: string }>(
    `INSERT INTO ingestion_idempotency (
       scope, idempotency_key, input_hash, result_kind, result_id
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING RETURNING idempotency_key`,
    [input.scope, input.key, input.inputHash, input.resultKind, input.resultId]
  );
  if (inserted.rows[0]) return "CLAIMED";
  const existing = await transaction.query<{ input_hash: string; result_kind: string; result_id: string }>(
    `SELECT input_hash, result_kind, result_id
     FROM ingestion_idempotency WHERE scope = $1 AND idempotency_key = $2`,
    [input.scope, input.key]
  );
  const row = existing.rows[0];
  if (!row || row.input_hash !== input.inputHash || row.result_kind !== input.resultKind ||
      row.result_id !== input.resultId) {
    throw new IdempotencyConflictError(input.scope, input.key);
  }
  return "REUSED";
}

async function requirePrimaryEvidence(
  transaction: SqlExecutor,
  input: {
    primaryEvidenceId: string;
    sourceIdentityKey: string;
    merchantId: string;
    merchantProductId: string;
    sourceVersion: string;
    quoteContext?: QuoteContext;
  }
): Promise<EvidenceRow> {
  const expected = expectedIdentity(input);
  if (input.sourceIdentityKey !== expected.key ||
      input.primaryEvidenceId !== stableRecordId("evidence", expected.key)) {
    throw new Error("primary evidence identity is not canonical");
  }
  const result = await transaction.query<EvidenceRow>(
    "SELECT * FROM ingestion_evidence WHERE id = $1 FOR SHARE",
    [input.primaryEvidenceId]
  );
  const row = result.rows[0];
  if (row) validateEvidenceWrite(toStoredEvidence(row));
  if (!row || row.source_identity_key !== expected.key ||
      row.merchant_id !== input.merchantId ||
      row.merchant_product_id !== input.merchantProductId ||
      row.source_version !== input.sourceVersion ||
      !sameJson(row.quote_context, input.quoteContext ?? null)) {
    throw new Error("primary evidence provenance mismatch");
  }
  return row;
}

function validateEvidenceRefProjection(
  primaryEvidenceId: string,
  externalEvidenceRefs: string[],
  allEvidenceRefs: string[]
): void {
  requireEvidenceRefs(externalEvidenceRefs, "external evidence refs");
  requireEvidenceRefs(allEvidenceRefs, "evidence refs");
  const expected = new Set([...externalEvidenceRefs, primaryEvidenceId]);
  if (allEvidenceRefs.length !== expected.size || allEvidenceRefs.some((ref) => !expected.has(ref))) {
    throw new Error("evidence refs do not match explicit primary and external evidence refs");
  }
}

function validateOfferPublication(offer: PublishedOffer, idempotencyKey: string): void {
  requireOfferShape(offer);
  requireJsonSafe(offer);
  validateEvidenceRefProjection(
    offer.primaryEvidenceId,
    offer.externalEvidenceRefs,
    offer.evidenceRefs
  );
  const identity = productSourceIdentity(offer);
  const expectedId = stableRecordId("offer", identity.key);
  if (offer.sourceIdentityKey !== identity.key || offer.offerId !== expectedId ||
      idempotencyKey !== expectedId) {
    throw new Error("offer publication identity is not canonical");
  }
}

export function createIngestionOfferRepository(db: Database): WorkerOfferRepository {
  return {
    async upsert(offer, idempotencyKey) {
      validateOfferPublication(offer, idempotencyKey);
      await db.transaction(async (transaction) => {
        await requirePrimaryEvidence(transaction, offer);
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
             payload, primary_evidence_id, external_evidence_refs, checked_at, expires_at
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
          [
            offer.offerId,
            offer.sourceIdentityKey,
            offer.merchantId,
            offer.merchantProductId,
            offer.sourceVersion,
            JSON.stringify(offer),
            offer.primaryEvidenceId,
            offer.externalEvidenceRefs,
            offer.checkedAt,
            offer.expiresAt
          ]
        );
      });
    }
  };
}

async function latestPrice(
  transaction: SqlExecutor,
  quote: PublishedQuote,
  contextHash: string
): Promise<number | null> {
  const result = await transaction.query<{ delivered_price_cents: string }>(
    `SELECT delivered_price_cents::text FROM merchant_quote_staging
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

function priceAnomalyRecord(quote: PublishedQuote, previous: number): QuarantineRecord | null {
  const anomaly = detectPriceAnomaly(quote.deliveredPriceCents, previous);
  return anomaly
    ? {
      merchantId: quote.merchantId,
      merchantProductId: quote.merchantProductId,
      quoteContext: quote.quoteContext,
      primaryEvidenceId: quote.primaryEvidenceId,
      externalEvidenceRefs: quote.externalEvidenceRefs,
      evidenceRefs: quote.evidenceRefs,
      checkedAt: quote.checkedAt,
      ...anomaly
    }
    : null;
}

function validateQuotePublication(
  quote: PublishedQuote,
  publicationKey: string,
  quarantineKey: string
): void {
  requireQuoteShape(quote);
  requireJsonSafe(quote);
  validateEvidenceRefProjection(
    quote.primaryEvidenceId,
    quote.externalEvidenceRefs,
    quote.evidenceRefs
  );
  const canonicalContext = {
    zipCode: normalizeZipCode(quote.quoteContext.zipCode),
    memberships: normalizeMemberships(quote.quoteContext.memberships)
  };
  if (!sameJson(quote.quoteContext, canonicalContext)) {
    throw new Error("quote context is not canonical");
  }
  const identity = priceSourceIdentity({
    merchantId: quote.merchantId,
    merchantProductId: quote.merchantProductId,
    sourceVersion: quote.sourceVersion,
    ...canonicalContext
  });
  const quoteId = stableRecordId("quote", identity.key);
  const quarantineId = stableRecordId("quarantine", identity.key);
  if (quote.sourceIdentityKey !== identity.key || quote.quoteId !== quoteId ||
      publicationKey !== quoteId || quarantineKey !== quarantineId) {
    throw new Error("quote publication identity is not canonical");
  }
  const sum = quote.itemPriceCents + quote.shippingCents + quote.taxCents +
    quote.mandatoryFeeCents;
  if (!Number.isSafeInteger(sum) || quote.deliveredPriceCents !== sum) {
    throw new Error("delivered price does not match safe price component sum");
  }
}

export function createIngestionQuoteRepository(db: Database): QuoteRepository {
  return {
    async commit(input) {
      validateQuotePublication(input.quote, input.publicationKey, input.quarantineKey);
      return db.transaction(async (transaction) => {
        await requirePrimaryEvidence(transaction, input.quote);
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
        const inputHash = canonicalHash(input.quote);
        const existingPublication = await transaction.query<{
          input_hash: string;
          result_kind: "PUBLISHED" | "QUARANTINED";
          result_id: string;
        }>(
          `SELECT input_hash, result_kind, result_id FROM ingestion_idempotency
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
          if (existing.result_kind === "QUARANTINED" && existing.result_id === input.quarantineKey) {
            const persisted = await transaction.query<{
              reason: "PRICE_DROP_AT_LEAST_90_PERCENT";
              previous_price_cents: string;
              current_price_cents: string;
              primary_evidence_id: string;
              external_evidence_refs: string[];
              checked_at: Date;
            }>(
              `SELECT reason, previous_price_cents::text, current_price_cents::text,
                      primary_evidence_id, external_evidence_refs, checked_at
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
                primaryEvidenceId: row.primary_evidence_id,
                externalEvidenceRefs: row.external_evidence_refs,
                evidenceRefs: [...new Set([...row.external_evidence_refs, row.primary_evidence_id])],
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
              primaryEvidenceId: input.quote.primaryEvidenceId,
              externalEvidenceRefs: input.quote.externalEvidenceRefs,
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
               primary_evidence_id, external_evidence_refs, checked_at, expires_at
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
              input.quote.primaryEvidenceId,
              input.quote.externalEvidenceRefs,
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
    conflictEvidenceId?: string;
    externalEvidenceRefs: string[];
    payload: unknown;
  }
): Promise<void> {
  requireJsonSafe(input.payload);
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
       current_price_cents, payload, primary_evidence_id, conflict_evidence_id,
       external_evidence_refs, checked_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16)`,
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
      input.conflictEvidenceId ?? null,
      input.externalEvidenceRefs,
      input.record.checkedAt
    ]
  );
}

async function requireConflictEvidence(
  transaction: SqlExecutor,
  record: Extract<QuarantineRecord, { reason: "SOURCE_VERSION_CONFLICT" }>
): Promise<void> {
  const primary = await requirePrimaryEvidence(transaction, record);
  requireRawEvidence(record.rawEvidence);
  requireHttpsUrl(record.sourceUrl);
  requireMetadata(record.metadata);
  requireEvidenceRefs(record.externalEvidenceRefs, "external evidence refs");
  requireStrictTimestamp(record.checkedAt, "conflict checkedAt");
  if (record.expectedContentHash !== primary.content_hash) {
    throw new Error("conflict expected content hash does not match primary evidence");
  }
  if (record.actualContentHash !== sha256(record.rawEvidence)) {
    throw new Error("conflict content hash does not match raw content");
  }
  const expectedId = conflictEvidenceId(record.sourceIdentityKey, record.actualContentHash);
  if (record.conflictEvidenceId !== expectedId) {
    throw new Error("conflict evidence id is not canonical");
  }
  const result = await transaction.query<ConflictEvidenceRow>(
    "SELECT * FROM ingestion_conflict_evidence WHERE id = $1 FOR SHARE",
    [record.conflictEvidenceId]
  );
  const row = result.rows[0];
  if (!row || row.expected_evidence_id !== record.primaryEvidenceId ||
      row.source_identity_key !== record.sourceIdentityKey ||
      row.merchant_id !== record.merchantId ||
      row.merchant_product_id !== record.merchantProductId ||
      row.source_version !== record.sourceVersion ||
      !sameJson(row.quote_context, record.quoteContext) ||
      row.content_hash !== record.actualContentHash ||
      row.raw_content !== record.rawEvidence ||
      row.source_url !== record.sourceUrl ||
      row.source_type !== (record.metadata.sourceType || "unknown") ||
      !sameJson(row.metadata, record.metadata)) {
    throw new Error("conflict evidence provenance mismatch");
  }
}

export function createIngestionQuarantineRepository(db: Database): QuarantineRepository {
  return {
    async save(record, idempotencyKey) {
      if (record.reason !== "SOURCE_VERSION_CONFLICT") {
        throw new Error("price anomalies must be committed atomically through quote repository");
      }
      const { rawEvidence: _immutableConflictContent, ...quarantinePayload } = record;
      requireJsonSafe(quarantinePayload);
      validateEvidenceRefProjection(
        record.primaryEvidenceId,
        record.externalEvidenceRefs,
        record.evidenceRefs
      );
      const identity = priceSourceIdentity({
        merchantId: record.merchantId,
        merchantProductId: record.merchantProductId,
        sourceVersion: record.sourceVersion,
        zipCode: record.quoteContext.zipCode,
        memberships: record.quoteContext.memberships
      });
      if (record.sourceIdentityKey !== identity.key ||
          idempotencyKey !== stableRecordId("quarantine", identity.key)) {
        throw new Error("source conflict quarantine identity is not canonical");
      }
      await db.transaction(async (transaction) => {
        await requireConflictEvidence(transaction, record);
        const existing = await transaction.query<{ result_kind: string; result_id: string }>(
          `SELECT result_kind, result_id FROM ingestion_idempotency
           WHERE scope = 'source-conflict-quarantine' AND idempotency_key = $1`,
          [idempotencyKey]
        );
        if (existing.rows[0]) {
          if (existing.rows[0].result_kind !== "QUARANTINED" ||
              existing.rows[0].result_id !== idempotencyKey) {
            throw new IdempotencyConflictError("source-conflict-quarantine", idempotencyKey);
          }
          return;
        }
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
          sourceIdentityKey: record.sourceIdentityKey,
          sourceVersion: record.sourceVersion,
          record,
          primaryEvidenceId: record.primaryEvidenceId,
          conflictEvidenceId: record.conflictEvidenceId,
          externalEvidenceRefs: record.externalEvidenceRefs,
          payload: quarantinePayload
        });
      });
    }
  };
}

/** Durable staging only; promotion waits for a separate product-identity/matching decision. */
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
