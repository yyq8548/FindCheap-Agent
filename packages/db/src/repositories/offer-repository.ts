import type { Database, SqlExecutor } from "../client.js";
import type { StoredCoupon, StoredEvidence, StoredMerchantOffer, StoredPriceQuote } from "../schema.js";

type PriceQuoteRow = {
  id: string;
  offer_id: string;
  zip_code: string;
  membership_context: { memberships: string[] };
  status: StoredPriceQuote["status"];
  delivered_price_cents: number;
  line_items: StoredPriceQuote["lineItems"];
  eligibility_conditions: string[];
  evidence_refs: string[];
  checked_at: Date;
  expires_at: Date;
};

export interface OfferRepository {
  saveOffer(input: StoredMerchantOffer): Promise<void>;
  saveEvidence(input: StoredEvidence): Promise<void>;
  saveCoupon(input: StoredCoupon): Promise<void>;
  saveQuote(input: StoredPriceQuote): Promise<void>;
  findComparableOffers(
    productId: string,
    context: { zipCode: string; memberships: string[] },
    now: Date
  ): Promise<StoredPriceQuote[]>;
}

export function createOfferRepository(db: Database): OfferRepository {
  return {
    async saveOffer(input) {
      await db.transaction(async (transaction) => {
        const evidenceRefs = unique(input.evidenceRefs);
        const savedOffer = await transaction.query<{ id: string }>(
          `INSERT INTO merchant_offers (
            id, merchant_id, merchant_product_id, product_id, seller_name, condition,
            match_status, inventory_status, merchant_url, evidence_refs, match_evidence, checked_at, expires_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
          ON CONFLICT (merchant_id, merchant_product_id) DO UPDATE SET
            product_id = EXCLUDED.product_id,
            seller_name = EXCLUDED.seller_name,
            condition = EXCLUDED.condition,
            match_status = EXCLUDED.match_status,
            inventory_status = EXCLUDED.inventory_status,
            merchant_url = EXCLUDED.merchant_url,
            evidence_refs = EXCLUDED.evidence_refs,
            match_evidence = EXCLUDED.match_evidence,
            checked_at = EXCLUDED.checked_at,
            expires_at = EXCLUDED.expires_at
          WHERE EXCLUDED.checked_at >= merchant_offers.checked_at
          RETURNING id`,
          [
            input.offerId,
            input.merchantId,
            input.merchantProductId,
            input.productId ?? null,
            input.sellerName,
            input.condition,
            input.matchStatus,
            input.inventoryStatus,
            input.merchantUrl,
            evidenceRefs,
            JSON.stringify(input.matchEvidence),
            input.checkedAt,
            input.expiresAt
          ]
        );
        const persistedOfferId = savedOffer.rows[0]?.id;
        if (!persistedOfferId) return;
        await replaceEvidenceRefs(transaction, "offer_evidence", "offer_id", persistedOfferId, evidenceRefs);
      });
    },
    async saveEvidence(input) {
      await db.query(
        `INSERT INTO evidence (id, merchant_id, source_url, source_type, content_hash, captured_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           merchant_id = EXCLUDED.merchant_id,
           source_url = EXCLUDED.source_url,
           source_type = EXCLUDED.source_type,
           content_hash = EXCLUDED.content_hash,
           captured_at = EXCLUDED.captured_at,
           metadata = EXCLUDED.metadata
         WHERE EXCLUDED.captured_at >= evidence.captured_at`,
        [
          input.evidenceId,
          input.merchantId,
          input.sourceUrl,
          input.sourceType,
          input.contentHash,
          input.capturedAt,
          JSON.stringify(input.metadata)
        ]
      );
    },
    async saveCoupon(input) {
      await db.transaction(async (transaction) => {
        const evidenceRefs = unique(input.evidenceRefs);
        await transaction.query(
          `INSERT INTO coupons (
            id, merchant_id, code, discount_rule, eligibility, stacking_rule,
            verification_status, evidence_refs, valid_from, valid_to
          ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10)
          ON CONFLICT (id) DO UPDATE SET
            merchant_id = EXCLUDED.merchant_id,
            code = EXCLUDED.code,
            discount_rule = EXCLUDED.discount_rule,
            eligibility = EXCLUDED.eligibility,
            stacking_rule = EXCLUDED.stacking_rule,
            verification_status = EXCLUDED.verification_status,
            evidence_refs = EXCLUDED.evidence_refs,
            valid_from = EXCLUDED.valid_from,
            valid_to = EXCLUDED.valid_to`,
          [
            input.couponId,
            input.merchantId,
            input.code ?? null,
            JSON.stringify(input.discountRule),
            JSON.stringify(input.eligibility),
            input.stackingRule,
            input.verificationStatus,
            evidenceRefs,
            input.validFrom,
            input.validTo
          ]
        );
        await replaceEvidenceRefs(transaction, "coupon_evidence", "coupon_id", input.couponId, evidenceRefs);
      });
    },
    async saveQuote(input) {
      await db.transaction(async (transaction) => {
        const evidenceRefs = unique(input.evidenceRefs);
        const membershipContext = { memberships: unique(input.membershipContext.memberships).sort() };
        const savedQuote = await transaction.query<{ id: string }>(
          `INSERT INTO price_quotes (
            id, offer_id, zip_code, membership_context, status, delivered_price_cents,
            line_items, eligibility_conditions, evidence_refs, checked_at, expires_at
          ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)
          ON CONFLICT (id) DO UPDATE SET
            offer_id = EXCLUDED.offer_id,
            zip_code = EXCLUDED.zip_code,
            membership_context = EXCLUDED.membership_context,
            status = EXCLUDED.status,
            delivered_price_cents = EXCLUDED.delivered_price_cents,
            line_items = EXCLUDED.line_items,
            eligibility_conditions = EXCLUDED.eligibility_conditions,
            evidence_refs = EXCLUDED.evidence_refs,
            checked_at = EXCLUDED.checked_at,
            expires_at = EXCLUDED.expires_at
          WHERE EXCLUDED.checked_at >= price_quotes.checked_at
          RETURNING id`,
          [
            input.quoteId,
            input.offerId,
            input.zipCode,
            JSON.stringify(membershipContext),
            input.status,
            input.deliveredPrice.amountCents,
            JSON.stringify(input.lineItems),
            JSON.stringify(input.eligibilityConditions),
            evidenceRefs,
            input.checkedAt,
            input.expiresAt
          ]
        );
        if (!savedQuote.rows[0]) return;
        await replaceEvidenceRefs(transaction, "quote_evidence", "quote_id", input.quoteId, evidenceRefs);
      });
    },
    async findComparableOffers(productId, context, now) {
      const memberships = unique(context.memberships).sort();
      const result = await db.query<PriceQuoteRow>(
        `SELECT q.*
         FROM price_quotes q
         INNER JOIN merchant_offers o ON o.id = q.offer_id
         WHERE o.product_id = $1
           AND q.zip_code = $2
           AND COALESCE(
             (
               SELECT jsonb_agg(member ORDER BY member)
               FROM (
                 SELECT DISTINCT jsonb_array_elements_text(
                   COALESCE(q.membership_context->'memberships', '[]'::jsonb)
                 ) AS member
               ) AS canonical_members
             ),
             '[]'::jsonb
           ) = to_jsonb($3::text[])
           AND q.expires_at > $4
         ORDER BY q.expires_at DESC, q.id ASC`,
        [productId, context.zipCode, memberships, now]
      );
      return result.rows.map(toStoredPriceQuote);
    }
  };
}

async function replaceEvidenceRefs(
  transaction: SqlExecutor,
  table: "offer_evidence" | "quote_evidence" | "coupon_evidence",
  foreignKey: "offer_id" | "quote_id" | "coupon_id",
  recordId: string,
  evidenceRefs: string[]
): Promise<void> {
  const distinctEvidenceRefs = unique(evidenceRefs);
  await transaction.query(`DELETE FROM ${table} WHERE ${foreignKey} = $1`, [recordId]);
  if (distinctEvidenceRefs.length > 0) {
    await transaction.query(
      `INSERT INTO ${table} (${foreignKey}, evidence_id)
       SELECT $1, refs.evidence_id FROM unnest($2::text[]) AS refs(evidence_id)`,
      [recordId, distinctEvidenceRefs]
    );
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function toStoredPriceQuote(row: PriceQuoteRow): StoredPriceQuote {
  return {
    quoteId: row.id,
    offerId: row.offer_id,
    zipCode: row.zip_code,
    membershipContext: row.membership_context,
    status: row.status,
    deliveredPrice: { amountCents: row.delivered_price_cents, currency: "USD" },
    lineItems: row.line_items,
    eligibilityConditions: row.eligibility_conditions,
    evidenceRefs: row.evidence_refs,
    checkedAt: row.checked_at,
    expiresAt: row.expires_at
  };
}
