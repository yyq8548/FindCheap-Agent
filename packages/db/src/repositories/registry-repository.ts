import {
  ManagedMerchantTrustRecordSchema,
  ManagedMerchantTrustRegistrySchema,
  OfficialStorefrontRecordSchema,
  OfficialStorefrontRegistrySchema,
  type ManagedMerchantTrustRecord,
  type ManagedMerchantTrustRegistry,
  type OfficialStorefrontRecord,
  type OfficialStorefrontRegistry
} from "../../../contracts/src/index.js";
import type { Database, SqlExecutor } from "../client.js";

export type RegistryCandidateKind = "OFFICIAL_STOREFRONT" | "MERCHANT_TRUST";
export type RegistryCandidateSource = "AWIN_JOINED_FEED" | "SHOPIFY_CATALOG" | "SEARCH_OBSERVATION" | "MANUAL";
export type RegistryCandidateStatus = "CANDIDATE" | "APPROVED" | "SUSPENDED" | "REJECTED";
export type RegistryEvidenceKind =
  | "TECHNICAL_STOREFRONT"
  | "BRAND_DOMAIN"
  | "AUTHORIZED_RETAILER"
  | "BUSINESS_IDENTITY"
  | "POLICY_AND_SUPPORT"
  | "MANUAL_REVIEW";
export type RegistryEvidenceResult = "PASS" | "FAIL" | "UNKNOWN";

export type RegistryCandidate = {
  kind: RegistryCandidateKind;
  key: string;
  source: RegistryCandidateSource;
  sourceReference?: string;
  payload: Record<string, unknown>;
  status: RegistryCandidateStatus;
};

export type PublishedRegistrySnapshot = {
  version: string;
  officialStorefronts: OfficialStorefrontRegistry;
  merchantTrust: ManagedMerchantTrustRegistry;
};

export async function upsertRegistryCandidate(
  executor: SqlExecutor,
  candidate: Omit<RegistryCandidate, "status"> & { status?: RegistryCandidateStatus }
): Promise<void> {
  await executor.query(
    `INSERT INTO registry_candidates (
       candidate_kind, candidate_key, source_kind, source_reference, payload, status
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (candidate_kind, candidate_key) DO UPDATE SET
       source_kind = CASE
         WHEN registry_candidates.status = 'APPROVED' THEN registry_candidates.source_kind
         ELSE EXCLUDED.source_kind
       END,
       source_reference = CASE
         WHEN registry_candidates.status = 'APPROVED' THEN registry_candidates.source_reference
         ELSE EXCLUDED.source_reference
       END,
       payload = CASE
         WHEN registry_candidates.status = 'APPROVED' THEN registry_candidates.payload
         ELSE EXCLUDED.payload
       END,
       updated_at = now()`,
    [
      candidate.kind,
      candidate.key,
      candidate.source,
      candidate.sourceReference ?? null,
      JSON.stringify(candidate.payload),
      candidate.status ?? "CANDIDATE"
    ]
  );
}

export async function recordRegistryEvidence(
  executor: SqlExecutor,
  evidence: {
    kind: RegistryCandidateKind;
    key: string;
    evidenceKind: RegistryEvidenceKind;
    evidenceUrl: string;
    result: RegistryEvidenceResult;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  await executor.query(
    `INSERT INTO registry_evidence (
       candidate_kind, candidate_key, evidence_kind, evidence_url, result, details
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (candidate_kind, candidate_key, evidence_kind, evidence_url) DO UPDATE SET
       result = EXCLUDED.result,
       details = EXCLUDED.details,
       checked_at = now()`,
    [
      evidence.kind,
      evidence.key,
      evidence.evidenceKind,
      evidence.evidenceUrl,
      evidence.result,
      JSON.stringify(evidence.details ?? {})
    ]
  );
}

export async function reviewRegistryCandidate(
  executor: SqlExecutor,
  review: {
    kind: RegistryCandidateKind;
    key: string;
    status: Exclude<RegistryCandidateStatus, "CANDIDATE">;
    record?: OfficialStorefrontRecord | ManagedMerchantTrustRecord;
    note: string;
  }
): Promise<void> {
  const record = review.status === "APPROVED"
    ? parseApprovedRecord(review.kind, review.record)
    : review.record;
  if (record !== undefined) {
    const recordKey = review.kind === "OFFICIAL_STOREFRONT"
      ? (record as OfficialStorefrontRecord).officialHost
      : (record as ManagedMerchantTrustRecord).host;
    if (recordKey !== review.key) throw new Error("reviewed registry record does not match candidate key");
  }
  if (review.status === "APPROVED") {
    const evidence = await executor.query<{ evidence_kind: RegistryEvidenceKind }>(
      `SELECT evidence_kind
       FROM registry_evidence
       WHERE candidate_kind = $1 AND candidate_key = $2 AND result = 'PASS'`,
      [review.kind, review.key]
    );
    const acceptedKinds = decisiveEvidenceKinds(review.kind, record!);
    if (!evidence.rows.some((row) => acceptedKinds.has(row.evidence_kind))) {
      throw new Error("approved registry candidate requires decisive passed evidence");
    }
  }
  const result = await executor.query<{ candidate_key: string }>(
    `UPDATE registry_candidates SET
       status = $3,
       payload = COALESCE($4::jsonb, payload),
       review_note = $5,
       reviewed_at = now(),
       updated_at = now()
     WHERE candidate_kind = $1 AND candidate_key = $2
     RETURNING candidate_key`,
    [review.kind, review.key, review.status, record === undefined ? null : JSON.stringify(record), review.note]
  );
  if (result.rows.length !== 1) throw new Error("registry candidate not found");
}

export async function listRegistryCandidates(
  executor: SqlExecutor,
  options: { status?: RegistryCandidateStatus; limit?: number } = {}
): Promise<RegistryCandidate[]> {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 2_000) throw new Error("registry candidate limit is invalid");
  const result = await executor.query<{
    candidate_kind: RegistryCandidateKind;
    candidate_key: string;
    source_kind: RegistryCandidateSource;
    source_reference: string | null;
    payload: Record<string, unknown>;
    status: RegistryCandidateStatus;
  }>(
    `SELECT candidate_kind, candidate_key, source_kind, source_reference, payload, status
     FROM registry_candidates
     WHERE ($1::text IS NULL OR status = $1)
     ORDER BY updated_at DESC, candidate_kind, candidate_key
     LIMIT $2`,
    [options.status ?? null, limit]
  );
  return result.rows.map((row) => ({
    kind: row.candidate_kind,
    key: row.candidate_key,
    source: row.source_kind,
    ...(row.source_reference === null ? {} : { sourceReference: row.source_reference }),
    payload: row.payload,
    status: row.status
  }));
}

export async function publishApprovedRegistrySnapshot(
  database: Database,
  version: string
): Promise<PublishedRegistrySnapshot> {
  return database.transaction(async (transaction) => {
    const rows = await transaction.query<{
      candidate_kind: RegistryCandidateKind;
      payload: Record<string, unknown>;
    }>(
      `SELECT candidate_kind, payload
       FROM registry_candidates
       WHERE status = 'APPROVED'
       ORDER BY candidate_kind, candidate_key`
    );
    const officialStorefronts = OfficialStorefrontRegistrySchema.parse({
      version: `${version}-official`,
      stores: rows.rows
        .filter((row) => row.candidate_kind === "OFFICIAL_STOREFRONT")
        .map((row) => OfficialStorefrontRecordSchema.parse(row.payload))
    });
    const merchantTrust = ManagedMerchantTrustRegistrySchema.parse({
      version: `${version}-trust`,
      merchants: rows.rows
        .filter((row) => row.candidate_kind === "MERCHANT_TRUST")
        .map((row) => ManagedMerchantTrustRecordSchema.parse(row.payload))
    });
    const snapshot = { version, officialStorefronts, merchantTrust };
    await transaction.query(
      `INSERT INTO registry_releases (version, official_storefronts, merchant_trust)
       VALUES ($1, $2::jsonb, $3::jsonb)`,
      [version, JSON.stringify(officialStorefronts), JSON.stringify(merchantTrust)]
    );
    return snapshot;
  });
}

export async function loadLatestPublishedRegistrySnapshot(
  executor: SqlExecutor
): Promise<PublishedRegistrySnapshot | undefined> {
  const result = await executor.query<{
    version: string;
    official_storefronts: unknown;
    merchant_trust: unknown;
  }>(
    `SELECT version, official_storefronts, merchant_trust
     FROM registry_releases
     ORDER BY published_at DESC, id DESC
     LIMIT 1`
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return {
    version: row.version,
    officialStorefronts: OfficialStorefrontRegistrySchema.parse(row.official_storefronts),
    merchantTrust: ManagedMerchantTrustRegistrySchema.parse(row.merchant_trust)
  };
}

function parseApprovedRecord(
  kind: RegistryCandidateKind,
  record: OfficialStorefrontRecord | ManagedMerchantTrustRecord | undefined
): OfficialStorefrontRecord | ManagedMerchantTrustRecord {
  if (record === undefined) throw new Error("approved registry candidate requires a reviewed record");
  return kind === "OFFICIAL_STOREFRONT"
    ? OfficialStorefrontRecordSchema.parse(record)
    : ManagedMerchantTrustRecordSchema.parse(record);
}

function decisiveEvidenceKinds(
  kind: RegistryCandidateKind,
  record: OfficialStorefrontRecord | ManagedMerchantTrustRecord
): ReadonlySet<RegistryEvidenceKind> {
  if (kind === "OFFICIAL_STOREFRONT") return new Set(["BRAND_DOMAIN", "MANUAL_REVIEW"]);
  const level = (record as ManagedMerchantTrustRecord).level;
  if (level === "OFFICIAL") return new Set(["BRAND_DOMAIN", "MANUAL_REVIEW"]);
  if (level === "AUTHORIZED_RETAILER") return new Set(["AUTHORIZED_RETAILER", "MANUAL_REVIEW"]);
  return new Set(["BUSINESS_IDENTITY", "MANUAL_REVIEW"]);
}
