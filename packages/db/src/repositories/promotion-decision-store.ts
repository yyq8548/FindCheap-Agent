import { canonicalHash } from "../../../ingestion-contracts/src/index.js";
import type { SqlExecutor } from "../client.js";
import type {
  DecisionWrite,
  ExistingDecisionRow,
  PromotionResult
} from "./promotion-types.js";

export async function existingDecision(
  transaction: SqlExecutor,
  entityKind: "OFFER" | "QUOTE",
  sourceIdentityKey: string,
  decisionVersion: number,
  inputHash: string
): Promise<PromotionResult | undefined> {
  const result = await transaction.query<ExistingDecisionRow>(
    `SELECT id, input_hash, status, canonical_product_id, promoted_offer_id, promoted_quote_id,
            offer_promotion_decision_id, offer_revision::text
     FROM merchant_promotion_decisions
     WHERE entity_kind = $1 AND source_identity_key = $2 AND decision_version = $3`,
    [entityKind, sourceIdentityKey, decisionVersion]
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  if (row.input_hash !== inputHash) throw new Error("promotion decision idempotency conflict");
  return {
    decisionId: row.id,
    status: row.status,
    ...(row.canonical_product_id === null ? {} : { canonicalProductId: row.canonical_product_id }),
    ...(row.promoted_offer_id === null ? {} : { offerId: row.promoted_offer_id }),
    ...(row.promoted_quote_id === null ? {} : { quoteId: row.promoted_quote_id }),
    ...(row.offer_promotion_decision_id === null
      ? {}
      : { offerPromotionDecisionId: row.offer_promotion_decision_id }),
    ...(row.offer_revision === null ? {} : { offerRevision: Number(row.offer_revision) })
  };
}

export async function insertDecision(
  transaction: SqlExecutor,
  write: DecisionWrite
): Promise<string> {
  const id = decisionRecordId(write.entityKind, write.sourceIdentityKey, write.decisionVersion);
  await transaction.query(
    `INSERT INTO merchant_promotion_decisions (
       id, input_hash, entity_kind, source_identity_key, decision_version,
       staging_record_id, merchant_id, merchant_product_id, source_version, status,
       canonical_product_id, promoted_offer_id, promoted_quote_id, primary_evidence_id,
       offer_promotion_decision_id, offer_revision,
       source_url, source_type, source_content_hash, source_captured_at,
       external_evidence_refs, match_basis, match_evidence, reason, questions,
       candidate_product_ids, zip_code, memberships, context_hash, staged_checked_at,
       staged_expires_at, staged_record_hash, decided_by, promoted_quote_snapshot
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       $15, $16, $17, $18, $19, $20, $21::jsonb, $22, $23::jsonb, $24, $25::jsonb,
       $26::jsonb, $27, $28::jsonb, $29, $30, $31, $32, $33, $34::jsonb
     )`,
    [id, write.inputHash, write.entityKind, write.sourceIdentityKey,
      write.decisionVersion, write.stagingRecordId, write.merchantId,
      write.merchantProductId, write.sourceVersion, write.status,
      write.canonicalProductId ?? null, write.offerId ?? null, write.quoteId ?? null,
      write.evidence.id, write.offerPromotionDecisionId ?? null, write.offerRevision ?? null,
      write.evidence.source_url, write.evidence.source_type,
      write.evidence.content_hash, write.evidence.captured_at,
      JSON.stringify(write.externalEvidenceRefs), write.matchBasis ?? null,
      JSON.stringify(write.matchEvidence), write.reason, JSON.stringify(write.questions),
      JSON.stringify(write.candidateProductIds), write.zipCode ?? null,
      write.memberships === undefined ? null : JSON.stringify(write.memberships),
      write.contextHash ?? null, write.stagedCheckedAt, write.stagedExpiresAt,
      write.stagedRecordHash, write.decidedBy,
      write.quoteSnapshot === undefined ? null : JSON.stringify(write.quoteSnapshot)]
  );
  return id;
}

export function decisionRecordId(
  entityKind: "OFFER" | "QUOTE",
  sourceIdentityKey: string,
  decisionVersion: number
): string {
  return canonicalHash({
    kind: "merchant-promotion-decision",
    entityKind,
    sourceIdentityKey,
    decisionVersion
  });
}
