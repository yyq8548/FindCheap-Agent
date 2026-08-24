import { createHash } from "node:crypto";

import type { SourceIdentity } from "./refresh-identity.js";

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
    conflictEvidenceId: string;
    expectedContentHash: string;
    actualContentHash: string;
  };

export interface EvidenceRepository {
  save(write: EvidenceWrite): Promise<EvidenceSaveResult>;
}

export type StoreEvidenceInput = {
  sourceIdentity: SourceIdentity;
  sourceUrl: string;
  sourceType: string;
  rawContent: string;
  capturedAt: string;
  metadata: Record<string, string>;
};

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
