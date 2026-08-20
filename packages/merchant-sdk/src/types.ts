export type SearchProductsInput = { query: string; limit: number };

export type MerchantProductCandidate = {
  merchantId: string;
  merchantProductId: string;
  title: string;
  brand?: string;
  mpn?: string;
  gtins: string[];
  variantDimensions: Record<string, string>;
  currency: "USD";
  merchantUrl: string;
  evidenceRefs: string[];
  checkedAt: string;
  expiresAt: string;
};

export type RawMerchantOffer = MerchantProductCandidate & {
  sellerName: string;
  condition: "NEW" | "REFURBISHED" | "USED";
  inventoryStatus: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  itemPriceCents: number;
};

export type QuoteDeliveredPriceInput = {
  merchantProductId: string;
  zipCode: string;
  memberships: string[];
};

export type RawPriceQuote = {
  merchantProductId: string;
  itemPriceCents: number;
  shippingCents: number;
  taxCents: number;
  mandatoryFeeCents: number;
  currency: "USD";
  status: "VERIFIED" | "ESTIMATED" | "CONDITIONAL";
  conditions: string[];
  evidenceRefs: string[];
  checkedAt: string;
  expiresAt: string;
};

export type CouponQuery = { merchantProductId: string; memberships: string[] };

export type RawCoupon = {
  couponId: string;
  code?: string;
  amountCents: number;
  verificationStatus: "VERIFIED" | "UNVERIFIED" | "EXPIRED";
  eligibility: string[];
  validFrom: string;
  validTo: string;
};

export type AffiliateLinkInput = {
  merchantProductId: string;
  merchantUrl: string;
  campaignId: string;
};

export type AffiliateLinkResult = { url: string; kind: "AFFILIATE" | "NORMAL" };

export type RefreshResult = {
  merchantProductId: string;
  sourceVersion: string;
  sourceUrl: string;
  rawEvidence: string;
  metadata: Record<string, string>;
  checkedAt: string;
};

export type RefreshOfferInput = { merchantProductId: string; sourceVersion: string };

/** Offer and its supporting raw evidence captured as one adapter operation. */
export type RefreshOfferResult = RefreshResult & { offer: RawMerchantOffer | null };

export type RefreshPriceInput = QuoteDeliveredPriceInput & { sourceVersion: string };

/** Quote and its supporting raw evidence captured as one adapter operation. */
export type RefreshPriceResult = {
  merchantProductId: string;
  sourceVersion: string;
  sourceUrl: string;
  rawEvidence: string;
  metadata: Record<string, string>;
  checkedAt: string;
  quote: RawPriceQuote;
};

export type EvidenceRecord = {
  id: string;
  merchantId: string;
  sourceUrl: string;
  sourceType: string;
  contentHash: string;
  capturedAt: string;
  metadata: Record<string, string>;
};

export interface MerchantAdapter {
  readonly merchantId: string;
  searchProducts(input: SearchProductsInput): Promise<MerchantProductCandidate[]>;
  getOffer(merchantProductId: string): Promise<RawMerchantOffer | null>;
  quoteDeliveredPrice(input: QuoteDeliveredPriceInput): Promise<RawPriceQuote>;
  getCoupons(input: CouponQuery): Promise<RawCoupon[]>;
  buildAffiliateLink(input: AffiliateLinkInput): Promise<AffiliateLinkResult>;
  refreshProduct(merchantProductId: string): Promise<RefreshResult>;
  refreshOffer(input: RefreshOfferInput): Promise<RefreshOfferResult>;
  refreshPrice(input: RefreshPriceInput): Promise<RefreshPriceResult>;
  healthCheck(): Promise<MerchantHealth>;
  evidence(entityId: string): Promise<EvidenceRecord[]>;
}

export type MerchantHealth = {
  status: "healthy" | "degraded" | "disabled";
  source: "feed" | "api" | "jsonld" | "http";
  checkedAt: string;
};
