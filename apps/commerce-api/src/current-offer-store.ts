import { z } from "zod";

import {
  CanonicalProductSchema,
  HttpsUrlSchema,
  PriceQuoteSchema,
  type CanonicalProduct,
  type PriceQuote
} from "../../../packages/contracts/src/index.js";
import type { Database } from "../../../packages/db/src/client.js";
import { normalizeGtin, normalizeToken } from "../../../packages/product-identity/src/index.js";
import { quoteContextKey } from "../../../packages/ingestion-contracts/src/index.js";
import type {
  ComparableOffer,
  ContextualQuoteSet,
  CurrentOfferRepository,
  QuoteContext
} from "./compare-products.js";

const MAX_PRODUCTS = 1;
const MAX_OFFERS_PER_PRODUCT = 50;

const ProductRowSchema = z.object({
  id: z.string().min(1),
  brand: z.string().min(1),
  manufacturer_part_number: z.string().nullable(),
  gtins: z.array(z.string()),
  title: z.string().min(1),
  category_path: z.array(z.string()),
  attributes: z.array(z.unknown()),
  variant_dimensions: z.record(z.string(), z.string())
}).strict();

const OfferRowSchema = z.object({
  offer_id: z.string().min(1),
  merchant_id: z.string().min(1),
  promotion_decision_id: z.string().min(1),
  revision: z.union([z.string(), z.number().int().positive()]),
  seller_name: z.string().min(1),
  merchant_url: HttpsUrlSchema
}).strict();

const QuoteRowSchema = z.object({
  context_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  memberships: z.array(z.string()),
  promoted_quote_id: z.string().min(1),
  primary_evidence_id: z.string().min(1),
  staged_checked_at: z.coerce.date(),
  staged_expires_at: z.coerce.date(),
  promoted_quote_snapshot: PriceQuoteSchema
}).strict();

type ProductRow = z.infer<typeof ProductRowSchema>;
type OfferRow = z.infer<typeof OfferRowSchema>;
type QuoteRow = z.infer<typeof QuoteRowSchema>;

export type CurrentOfferStore = CurrentOfferRepository & {
  quoteExactOffer(
    candidate: ComparableOffer,
    context: QuoteContext
  ): Promise<ContextualQuoteSet | undefined>;
};

export function createCurrentOfferStore(
  db: Database,
  enabledMerchantIds: ReadonlySet<string>
): CurrentOfferStore {
  const merchantIds = [...enabledMerchantIds].sort();
  return {
    async search(query, now) {
      if (merchantIds.length === 0) return noStrongIdentity();
      const normalized = normalizeQuery(query);
      const gtin = normalizeGtin(query);
      const products = await db.query<ProductRow>(
        `SELECT DISTINCT p.id, p.brand, p.manufacturer_part_number, p.gtins, p.title,
                p.category_path, p.attributes, p.variant_dimensions
         FROM products p
         JOIN merchant_offers o ON o.product_id = p.id
         JOIN merchant_offer_current_promotions current_promotion ON current_promotion.offer_id = o.id
         JOIN merchant_promotion_decisions offer_decision
           ON offer_decision.id = current_promotion.promotion_decision_id
          AND offer_decision.promoted_offer_id = o.id
          AND offer_decision.offer_revision = current_promotion.revision
          AND offer_decision.canonical_product_id = p.id
          AND offer_decision.status = 'EXACT_PROMOTED'
          AND offer_decision.entity_kind = 'OFFER'
         WHERE o.match_status = 'EXACT'
           AND o.inventory_status = 'IN_STOCK'
           AND o.merchant_id = ANY($1::text[])
           AND current_promotion.canonical_product_id = p.id
           AND current_promotion.promoted_checked_at = o.checked_at
           AND o.checked_at <= $2 AND o.expires_at > $2
           AND (
             p.id = $3
             OR ($4::text IS NOT NULL AND $4 = ANY(p.gtins))
             OR (p.identity_brand_key IS NOT NULL AND p.identity_mpn_key IS NOT NULL
                 AND p.identity_brand_key || p.identity_mpn_key = $5)
             OR regexp_replace(
                  lower(p.title || COALESCE((
                    SELECT ' ' || string_agg(variant.value, ' ' ORDER BY variant.key)
                    FROM jsonb_each_text(p.variant_dimensions) AS variant(key, value)
                  ), '')),
                  '[^[:alnum:]]+', '', 'g'
                ) = $5
           )
         ORDER BY p.id
         LIMIT $6`,
        [merchantIds, now, query.trim(), gtin ?? null, normalized, MAX_PRODUCTS + 1]
      );
      const productRows = products.rows.map((row) => ProductRowSchema.parse(row));
      if (productRows.length !== 1) {
        return {
          status: "NEEDS_CLARIFICATION",
          questions: [productRows.length === 0
            ? "Please provide an exact model number or GTIN for a currently available product."
            : "Multiple products match. Please provide the exact model, variant, or GTIN."]
        };
      }
      const product = canonicalProduct(productRows[0] as ProductRow);
      const offers = await db.query<OfferRow>(
        `SELECT o.id AS offer_id, o.merchant_id, o.seller_name, o.merchant_url,
                current_promotion.promotion_decision_id,
                current_promotion.revision::text
         FROM merchant_offers o
         JOIN merchant_offer_current_promotions current_promotion ON current_promotion.offer_id = o.id
         JOIN merchant_promotion_decisions offer_decision
           ON offer_decision.id = current_promotion.promotion_decision_id
          AND offer_decision.promoted_offer_id = o.id
          AND offer_decision.offer_revision = current_promotion.revision
          AND offer_decision.canonical_product_id = o.product_id
          AND offer_decision.status = 'EXACT_PROMOTED'
          AND offer_decision.entity_kind = 'OFFER'
         WHERE o.product_id = $1
           AND o.merchant_id = ANY($2::text[])
           AND o.match_status = 'EXACT'
           AND o.inventory_status = 'IN_STOCK'
           AND current_promotion.canonical_product_id = o.product_id
           AND current_promotion.promoted_checked_at = o.checked_at
           AND o.checked_at <= $3 AND o.expires_at > $3
         ORDER BY o.id COLLATE "C"
         LIMIT $4`,
        [product.productId, merchantIds, now, MAX_OFFERS_PER_PRODUCT + 1]
      );
      const offerRows = offers.rows.map((row) => OfferRowSchema.parse(row));
      if (offerRows.length > MAX_OFFERS_PER_PRODUCT) {
        return {
          status: "NEEDS_CLARIFICATION",
          questions: ["Too many current offers match this product; comparison is temporarily unavailable."]
        };
      }
      return {
        status: "RESOLVED",
        product,
        candidates: offerRows.map((row) => comparableOffer(row, product))
      };
    },

    async quoteExactOffer(candidate, context) {
      if (!enabledMerchantIds.has(candidate.merchantId)) return undefined;
      const regularMemberships: string[] = [];
      const requestedMemberships = [...new Set(context.memberships)].sort();
      const contexts = [regularMemberships, ...(requestedMemberships.length === 0 ? [] : [requestedMemberships])];
      const hashes = contexts.map((memberships) => quoteContextKey({
        zipCode: context.zipCode,
        memberships
      }));
      const result = await db.query<QuoteRow>(
        `SELECT DISTINCT ON (quote_decision.context_hash)
                quote_decision.context_hash,
                quote_decision.memberships,
                quote_decision.promoted_quote_id,
                quote_decision.primary_evidence_id,
                quote_decision.staged_checked_at,
                quote_decision.staged_expires_at,
                quote_decision.promoted_quote_snapshot
         FROM merchant_promotion_decisions quote_decision
         JOIN price_quotes q ON q.id = quote_decision.promoted_quote_id
         JOIN merchant_offer_current_promotions current_promotion
           ON current_promotion.offer_id = quote_decision.promoted_offer_id
          AND current_promotion.promotion_decision_id = $5
          AND current_promotion.revision = $6
          AND current_promotion.canonical_product_id = $7
          AND quote_decision.offer_promotion_decision_id = $5
          AND quote_decision.offer_revision = $6
          AND quote_decision.status = 'QUOTE_PROMOTED'
          AND quote_decision.entity_kind = 'QUOTE'
          AND quote_decision.canonical_product_id = current_promotion.canonical_product_id
         JOIN merchant_offers o ON o.id = quote_decision.promoted_offer_id
         WHERE quote_decision.promoted_offer_id = $1
           AND quote_decision.merchant_id = $8
           AND quote_decision.zip_code = $2
           AND quote_decision.context_hash = ANY($3::text[])
           AND quote_decision.staged_checked_at <= $4
           AND quote_decision.staged_expires_at > $4
           AND quote_decision.promoted_quote_snapshot IS NOT NULL
           AND o.match_status = 'EXACT'
           AND o.inventory_status = 'IN_STOCK'
           AND o.merchant_id = $8
           AND o.product_id = current_promotion.canonical_product_id
           AND o.checked_at = current_promotion.promoted_checked_at
           AND o.checked_at <= $4 AND o.expires_at > $4
         ORDER BY quote_decision.context_hash,
                  quote_decision.staged_checked_at DESC,
                  quote_decision.id COLLATE "C" DESC`,
        [candidate.offerId, context.zipCode, hashes, context.now,
          candidate.promotionDecisionId, candidate.offerRevision,
          candidate.canonicalProductId, candidate.merchantId]
      );
      const byHash = new Map<string, { memberships: string[]; quote: PriceQuote }>();
      for (const raw of result.rows) {
        const row = QuoteRowSchema.parse(raw);
        const expected = contexts.find((memberships) =>
          quoteContextKey({ zipCode: context.zipCode, memberships }) === row.context_hash
        );
        if (expected === undefined || !sameStrings(row.memberships, expected)) {
          continue;
        }
        if (!isConsistentSnapshot(row, candidate.offerId, context.now)) continue;
        byHash.set(row.context_hash, { memberships: expected, quote: row.promoted_quote_snapshot });
      }
      const regular = byHash.get(hashes[0] as string)?.quote;
      if (regular === undefined) return undefined;
      const member = hashes[1] === undefined ? undefined : byHash.get(hashes[1]);
      return {
        regularQuote: regular,
        ...(member === undefined
          ? {}
          : {
              memberQuote: {
                programId: member.memberships.join("+"),
                programName: member.memberships.join(", "),
                memberships: member.memberships,
                quote: member.quote
              }
            })
      };
    }
  };
}

function normalizeQuery(query: string): string {
  return normalizeToken(query);
}

function canonicalProduct(row: ProductRow): CanonicalProduct {
  return CanonicalProductSchema.parse({
    productId: row.id,
    brand: row.brand,
    ...(row.manufacturer_part_number === null ? {} : { manufacturerPartNumber: row.manufacturer_part_number }),
    gtins: row.gtins,
    title: row.title,
    categoryPath: row.category_path,
    attributes: row.attributes,
    variantDimensions: row.variant_dimensions
  });
}

function comparableOffer(row: OfferRow, product: CanonicalProduct): ComparableOffer {
  const offerRevision = Number(row.revision);
  if (!Number.isSafeInteger(offerRevision) || offerRevision < 1) {
    throw new Error("stored offer revision is invalid");
  }
  return {
    offerId: row.offer_id,
    merchantId: row.merchant_id,
    canonicalProductId: product.productId,
    promotionDecisionId: row.promotion_decision_id,
    offerRevision,
    sellerName: row.seller_name,
    merchantUrl: row.merchant_url,
    product: {
      brand: product.brand,
      ...(product.manufacturerPartNumber === undefined ? {} : { mpn: product.manufacturerPartNumber }),
      gtins: product.gtins,
      title: product.title,
      variantDimensions: product.variantDimensions,
      coreSimilarity: 1
    }
  };
}

function noStrongIdentity() {
  return {
    status: "NEEDS_CLARIFICATION" as const,
    questions: ["Please provide an exact model number or GTIN for a currently available product."]
  };
}

function isConsistentSnapshot(row: QuoteRow, offerId: string, now: Date): boolean {
  const quote = row.promoted_quote_snapshot;
  const total = quote.lineItems.reduce((sum, item) => sum + item.amount.amountCents, 0);
  return quote.offerId === offerId &&
    quote.quoteId === row.promoted_quote_id &&
    Date.parse(quote.checkedAt) === row.staged_checked_at.getTime() &&
    Date.parse(quote.expiresAt) === row.staged_expires_at.getTime() &&
    quote.evidenceRefs.includes(row.primary_evidence_id) &&
    total === quote.deliveredPrice.amountCents &&
    Date.parse(quote.checkedAt) <= now.getTime() &&
    Date.parse(quote.expiresAt) > now.getTime();
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
