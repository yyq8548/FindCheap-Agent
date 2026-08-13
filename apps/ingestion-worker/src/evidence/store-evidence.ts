import { createHash } from "node:crypto";

export type EvidenceWrite = {
  idempotencyKey: string;
  merchantId: string;
  sourceUrl: string;
  sourceType: string;
  contentHash: string;
  rawContent: string;
  capturedAt: string;
  metadata: Record<string, string>;
};

export type StoredEvidence = EvidenceWrite & { id: string };

export interface EvidenceRepository {
  /** Saves at most one record for an idempotency key and returns the existing record on retry. */
  save(write: EvidenceWrite): Promise<StoredEvidence>;
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function storeEvidence(
  repository: EvidenceRepository,
  input: {
    jobIdempotencyKey: string;
    merchantId: string;
    sourceUrl: string;
    sourceType: string;
    rawContent: string;
    capturedAt: string;
    metadata: Record<string, string>;
  }
): Promise<StoredEvidence> {
  if (input.rawContent.length === 0) throw new Error("raw evidence must not be empty");
  const contentHash = sha256(input.rawContent);
  return repository.save({
    idempotencyKey: `${input.jobIdempotencyKey}:evidence:${contentHash}`,
    merchantId: input.merchantId,
    sourceUrl: input.sourceUrl,
    sourceType: input.sourceType,
    contentHash,
    rawContent: input.rawContent,
    capturedAt: input.capturedAt,
    metadata: input.metadata
  });
}
