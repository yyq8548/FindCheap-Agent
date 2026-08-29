import type {
  RawMerchantOffer,
  RawPriceQuote
} from "../../merchant-sdk/src/index.js";
import type { QuarantineRecord } from "./quarantine.js";

export type PublishedOffer = RawMerchantOffer & {
  offerId: string;
  sourceIdentityKey: string;
  sourceVersion: string;
  primaryEvidenceId: string;
  externalEvidenceRefs: string[];
  evidenceRefs: string[];
};

export type PublishedQuote = RawPriceQuote & {
  quoteId: string;
  merchantId: string;
  sourceIdentityKey: string;
  sourceVersion: string;
  quoteContext: { zipCode: string; memberships: string[] };
  primaryEvidenceId: string;
  externalEvidenceRefs: string[];
  deliveredPriceCents: number;
  evidenceRefs: string[];
};

export interface OfferRepository {
  upsert(offer: PublishedOffer, idempotencyKey: string): Promise<void>;
}

export interface QuoteRepository {
  commit(input: {
    quote: PublishedQuote;
    publicationKey: string;
    quarantineKey: string;
  }): Promise<
    | { status: "PUBLISHED" }
    | { status: "QUARANTINED"; quarantine: QuarantineRecord }
  >;
}
