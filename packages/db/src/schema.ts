import type {
  CanonicalProduct,
  CouponStackingPolicy,
  MerchantOffer,
  PriceQuote
} from "../../contracts/src/index.js";

export const tables = {
  products: "products",
  merchantOffers: "merchant_offers",
  evidence: "evidence",
  priceQuotes: "price_quotes",
  coupons: "coupons",
  ingestionEvidence: "ingestion_evidence",
  ingestionPurgeAudit: "ingestion_purge_audit",
  ingestionIdempotency: "ingestion_idempotency",
  merchantProductStaging: "merchant_product_staging",
  merchantQuoteStaging: "merchant_quote_staging",
  merchantIngestionQuarantine: "merchant_ingestion_quarantine",
  merchantPromotionDecisions: "merchant_promotion_decisions",
  merchantOfferCurrentPromotions: "merchant_offer_current_promotions"
} as const;

export type Timestamp = Date | string;
export type JsonObject = Record<string, unknown>;

export type StoredMerchantOffer = Omit<MerchantOffer, "checkedAt" | "expiresAt"> & {
  checkedAt: Timestamp;
  expiresAt: Timestamp;
};

export type StoredPriceQuote = Omit<PriceQuote, "checkedAt" | "expiresAt"> & {
  zipCode: string;
  membershipContext: { memberships: string[] };
  checkedAt: Timestamp;
  expiresAt: Timestamp;
};

export interface StoredEvidence {
  evidenceId: string;
  merchantId: string;
  sourceUrl: string;
  sourceType: string;
  contentHash: string;
  capturedAt: Timestamp;
  metadata: JsonObject;
}

export interface StoredCoupon {
  couponId: string;
  merchantId: string;
  code?: string;
  discountRule: JsonObject;
  eligibility: JsonObject;
  stackingRule: CouponStackingPolicy;
  verificationStatus: string;
  evidenceRefs: string[];
  validFrom: Timestamp;
  validTo: Timestamp;
}

export type { CanonicalProduct, PriceQuote };
