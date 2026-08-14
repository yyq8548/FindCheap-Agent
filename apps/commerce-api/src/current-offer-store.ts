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
import { quoteContextKey } from "../../ingestion-worker/src/jobs/refresh-identity.js";
import type {
  ComparableOffer,
  ContextualQuoteSet,
  CurrentOfferRepository,
  QuoteContext
} from "./compare-products.js";

const MAX_PRODUCTS = 2;

const OfferRowSchema = z.object({
  product_id: z.string().min(1),
  brand: z.string().min(1),
  manufacturer_part_number: z.string().nullable(),
  gtins: z.array(z.string()),
  title: z.string().min(1),
  category_path: z.array(z.string()),
  attributes: z.array(z.unknown()),
  variant_dimensions: z.record(z.string(), z.string()),
  offer_id: z.string().min(1),
  merchant_id: z.string().min(1),
  seller_name: z.string().min(1),
  merchant_url: HttpsUrlSchema
}).strict();

const QuoteRowSchema = z.object({
  context_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  memberships: z.array(z.string()),
  promoted_quote_snapshot: PriceQuoteSchema
}).strict();

type OfferRow = z.infer<typeof OfferRowSchema>;
type QuoteRow = z.infer<typeof QuoteRowSchema>;

export type CurrentOfferStore = CurrentOfferRepository & {
  quoteExactOffer(
    candidate: ComparableOffer,
    context: QuoteContext
  ): Promise<ContextualQuoteSet | undefined>;
};

export function createCurrentOfferStore(db: Database): CurrentOfferStore {
  return {
    async search(query, now) {
      const normalized = normalizeQuery(query);
      const gtins = extractGtins(query);
      const result = await db.query<OfferRow>(
        `WITH matched_products AS (
           SELECT p.id, p.brand, p.manufacturer_part_number, p.gtins, p.title,
                  p.category_path, p.attributes, p.variant_dimensions
           FROM products p
           WHERE p.id = $1
              OR (cardinality($2::text[]) > 0 AND p.gtins && $2::text[])
              OR (p.identity_mpn_key IS NOT NULL AND length(p.identity_mpn_key) >= 3
                  AND position(p.identity_mpn_key in $3) > 0)
              OR lower(p.title) = lower($1)
              OR position(lower($1) in lower(p.title)) > 0
           ORDER BY p.id COLLATE "C"
           LIMIT $4
         )
         SELECT p.id AS product_id, p.brand, p.manufacturer_part_number, p.gtins,
                p.title, p.category_path, p.attributes, p.variant_dimensions,
                o.id AS offer_id, o.merchant_id, o.seller_name, o.merchant_url
         FROM matched_products p
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
           AND current_promotion.canonical_product_id = p.id
           AND current_promotion.promoted_checked_at = o.checked_at
           AND o.checked_at <= $5 AND o.expires_at > $5
         ORDER BY p.id COLLATE "C", o.id COLLATE "C"`,
        [query.trim(), gtins, normalized, MAX_PRODUCTS + 1, now]
      );
      const rows = result.rows.map((row) => OfferRowSchema.parse(row));
      const productIds = [...new Set(rows.map((row) => row.product_id))];
      if (productIds.length !== 1) {
        return {
          status: "NEEDS_CLARIFICATION",
          questions: [productIds.length === 0
            ? "Please provide an exact model number or GTIN for a currently available product."
            : "Multiple products match. Please provide the exact model, variant, or GTIN."]
        };
      }
      const product = canonicalProduct(rows[0] as OfferRow);
      return {
        status: "RESOLVED",
        product,
        candidates: rows.map((row) => comparableOffer(row, product))
      };
    },

    async quoteExactOffer(candidate, context) {
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
                quote_decision.promoted_quote_snapshot
         FROM merchant_promotion_decisions quote_decision
         JOIN price_quotes q ON q.id = quote_decision.promoted_quote_id
         JOIN merchant_offer_current_promotions current_promotion
           ON current_promotion.offer_id = quote_decision.promoted_offer_id
          AND quote_decision.offer_promotion_decision_id = current_promotion.promotion_decision_id
          AND quote_decision.offer_revision = current_promotion.revision
          AND quote_decision.status = 'QUOTE_PROMOTED'
          AND quote_decision.entity_kind = 'QUOTE'
          AND quote_decision.canonical_product_id = current_promotion.canonical_product_id
         JOIN merchant_offers o ON o.id = quote_decision.promoted_offer_id
         WHERE quote_decision.promoted_offer_id = $1
           AND quote_decision.zip_code = $2
           AND quote_decision.context_hash = ANY($3::text[])
           AND quote_decision.staged_checked_at <= $4
           AND quote_decision.staged_expires_at > $4
           AND quote_decision.promoted_quote_snapshot IS NOT NULL
           AND o.match_status = 'EXACT'
           AND o.inventory_status = 'IN_STOCK'
           AND o.product_id = current_promotion.canonical_product_id
           AND o.checked_at = current_promotion.promoted_checked_at
           AND o.checked_at <= $4 AND o.expires_at > $4
         ORDER BY quote_decision.context_hash,
                  quote_decision.staged_checked_at DESC,
                  quote_decision.id COLLATE "C" DESC`,
        [candidate.offerId, context.zipCode, hashes, context.now]
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
        if (!isConsistentSnapshot(row.promoted_quote_snapshot, candidate.offerId, context.now)) continue;
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

function extractGtins(query: string): string[] {
  return [...new Set(
    query.match(/\d(?:[ -]?\d){7,13}/gu)?.flatMap((value) => normalizeGtin(value) ?? []) ?? []
  )];
}

function canonicalProduct(row: OfferRow): CanonicalProduct {
  return CanonicalProductSchema.parse({
    productId: row.product_id,
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
  return {
    offerId: row.offer_id,
    merchantId: row.merchant_id,
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

function isConsistentSnapshot(quote: PriceQuote, offerId: string, now: Date): boolean {
  const total = quote.lineItems.reduce((sum, item) => sum + item.amount.amountCents, 0);
  return quote.offerId === offerId &&
    total === quote.deliveredPrice.amountCents &&
    Date.parse(quote.checkedAt) <= now.getTime() &&
    Date.parse(quote.expiresAt) > now.getTime();
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
