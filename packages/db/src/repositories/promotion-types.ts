import type {
  CanonicalProduct,
  MerchantOffer,
  PriceQuote
} from "../../../contracts/src/index.js";
import type {
  PublishedOffer,
  PublishedQuote
} from "../../../ingestion-contracts/src/index.js";

export type PromotionStatus =
  | "EXACT_PROMOTED"
  | "SIMILAR"
  | "NEEDS_CLARIFICATION"
  | "NO_MATCH"
  | "AMBIGUOUS"
  | "PENDING_EXACT_OFFER"
  | "QUOTE_PROMOTED";

export type PromotionResult = {
  decisionId: string;
  status: PromotionStatus;
  offerId?: string;
  quoteId?: string;
  offerPromotionDecisionId?: string;
  offerRevision?: number;
  canonicalProductId?: string;
};

export type PromotionOptions = {
  decisionVersion?: number;
  decidedBy?: string;
  expectedCurrentOfferPromotionDecisionId?: string;
};

export interface PromotionRepository {
  promoteProduct(stagingId: string, options?: PromotionOptions): Promise<PromotionResult>;
  promoteQuote(stagingId: string, options?: PromotionOptions): Promise<PromotionResult>;
  promotePendingQuotes(merchantId: string, merchantProductId: string): Promise<PromotionResult[]>;
}

export type ProductStagingRow = {
  id: string;
  source_identity_key: string;
  merchant_id: string;
  merchant_product_id: string;
  source_version: string;
  payload: PublishedOffer;
  primary_evidence_id: string;
  external_evidence_refs: string[];
  checked_at: Date;
  expires_at: Date;
};

export type QuoteStagingRow = {
  id: string;
  source_identity_key: string;
  merchant_id: string;
  merchant_product_id: string;
  source_version: string;
  zip_code: string;
  memberships: string[];
  context_hash: string;
  delivered_price_cents: string;
  payload: PublishedQuote;
  primary_evidence_id: string;
  external_evidence_refs: string[];
  checked_at: Date;
  expires_at: Date;
};

export type IngestionEvidenceRow = {
  id: string;
  source_identity_key: string;
  merchant_id: string;
  merchant_product_id: string;
  source_version: string;
  quote_context: { zipCode: string; memberships: string[] } | null;
  source_url: string;
  source_type: string;
  content_hash: string;
  captured_at: Date;
  metadata: Record<string, string>;
};

export type ProductRow = {
  id: string;
  brand: string;
  manufacturer_part_number: string | null;
  gtins: string[];
  title: string;
  category_path: string[];
  attributes: CanonicalProduct["attributes"];
  variant_dimensions: Record<string, string>;
};

export type ExistingDecisionRow = {
  id: string;
  input_hash: string;
  status: PromotionStatus;
  canonical_product_id: string | null;
  promoted_offer_id: string | null;
  promoted_quote_id: string | null;
  offer_promotion_decision_id: string | null;
  offer_revision: string | null;
};

export type DecisionWrite = {
  entityKind: "OFFER" | "QUOTE";
  sourceIdentityKey: string;
  decisionVersion: number;
  stagingRecordId: string;
  merchantId: string;
  merchantProductId: string;
  sourceVersion: string;
  status: PromotionStatus;
  canonicalProductId?: string;
  offerId?: string;
  quoteId?: string;
  offerPromotionDecisionId?: string;
  offerRevision?: number;
  evidence: IngestionEvidenceRow;
  externalEvidenceRefs: string[];
  matchBasis?: "GTIN" | "BRAND_MPN";
  matchEvidence: MerchantOffer["matchEvidence"];
  reason: string;
  questions: string[];
  candidateProductIds: string[];
  zipCode?: string;
  memberships?: string[];
  contextHash?: string;
  stagedCheckedAt: Date;
  stagedExpiresAt: Date;
  stagedRecordHash: string;
  decidedBy: string;
  inputHash: string;
  quoteSnapshot?: PriceQuote;
};
