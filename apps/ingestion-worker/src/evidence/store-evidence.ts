import { createHash } from "node:crypto";
import { stableRecordId, type SourceIdentity } from "../jobs/refresh-identity.js";

export type EvidenceWrite = {
  id: string;
  sourceIdentityKey: string;
  merchantId: string;
  merchantProductId: string;
  sourceVersion: string;
  quoteContext?: { zipCode: string; memberships: string[] };
  sourceUrl: string;
  sourceType: string;
  contentHash: string;
  rawContent: string;
  capturedAt: string;
  metadata: Record<string, string>;
};

export type StoredEvidence = EvidenceWrite & { id: string };

export type EvidenceSaveResult =
  | { status: "STORED" | "REUSED"; record: StoredEvidence }
  | {
    status: "CONFLICT";
    evidenceId: string;
    expectedContentHash: string;
    actualContentHash: string;
  };

export interface EvidenceRepository {
  /** Saves at most one record for an idempotency key and returns the existing record on retry. */
  save(write: EvidenceWrite): Promise<EvidenceSaveResult>;
}

export class SourceVersionConflictError extends Error {
  constructor(
    readonly evidenceId: string,
    readonly expectedContentHash: string,
    readonly actualContentHash: string
  ) {
    super("SOURCE_VERSION_CONFLICT");
    this.name = "SourceVersionConflictError";
  }
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function storeEvidence(
  repository: EvidenceRepository,
  input: {
    sourceIdentity: SourceIdentity;
    sourceUrl: string;
    sourceType: string;
    rawContent: string;
    capturedAt: string;
    metadata: Record<string, string>;
  }
): Promise<StoredEvidence> {
  if (input.rawContent.length === 0) throw new Error("raw evidence must not be empty");
  const contentHash = sha256(input.rawContent);
  const write: EvidenceWrite = {
    id: stableRecordId("evidence", input.sourceIdentity.key),
    sourceIdentityKey: input.sourceIdentity.key,
    merchantId: input.sourceIdentity.merchantId,
    merchantProductId: input.sourceIdentity.merchantProductId,
    sourceVersion: input.sourceIdentity.sourceVersion,
    sourceUrl: input.sourceUrl,
    sourceType: input.sourceType,
    contentHash,
    rawContent: input.rawContent,
    capturedAt: input.capturedAt,
    metadata: input.metadata,
    ...(input.sourceIdentity.quoteContext
      ? { quoteContext: input.sourceIdentity.quoteContext }
      : {})
  };
  const result = await repository.save(write);
  if (result.status === "CONFLICT") {
    throw new SourceVersionConflictError(
      result.evidenceId,
      result.expectedContentHash,
      result.actualContentHash
    );
  }
  return result.record;
}
