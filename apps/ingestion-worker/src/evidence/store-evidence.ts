import {
  requireHttpsUrl,
  requireMetadata,
  requireRawEvidence,
  requireSourceType,
  requireStrictTimestamp
} from "../../../../packages/merchant-sdk/src/index.js";
import {
  sha256,
  type EvidenceRepository,
  type EvidenceWrite,
  type StoredEvidence,
  type StoreEvidenceInput
} from "../../../../packages/ingestion-contracts/src/index.js";
import { stableRecordId } from "../jobs/refresh-identity.js";

export type {
  EvidenceRepository,
  EvidenceSaveResult,
  EvidenceWrite,
  StoredEvidence
} from "../../../../packages/ingestion-contracts/src/index.js";

export class SourceVersionConflictError extends Error {
  constructor(
    readonly evidenceId: string,
    readonly conflictEvidenceId: string,
    readonly expectedContentHash: string,
    readonly actualContentHash: string
  ) {
    super("SOURCE_VERSION_CONFLICT");
    this.name = "SourceVersionConflictError";
  }
}

export { sha256 } from "../../../../packages/ingestion-contracts/src/index.js";

export async function storeEvidence(
  repository: EvidenceRepository,
  input: StoreEvidenceInput
): Promise<StoredEvidence> {
  requireHttpsUrl(input.sourceUrl);
  requireRawEvidence(input.rawContent);
  requireMetadata(input.metadata);
  requireSourceType(input.sourceType);
  requireStrictTimestamp(input.capturedAt, "capturedAt");
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
      result.conflictEvidenceId,
      result.expectedContentHash,
      result.actualContentHash
    );
  }
  return result.record;
}
