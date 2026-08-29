import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/client.js";
import { runMigrations } from "../src/migrate.js";
import { createOfferRepository } from "./support/offer-repository.js";
import { createProductRepository } from "./support/product-repository.js";
import type { StoredCoupon, StoredEvidence, StoredMerchantOffer, StoredPriceQuote } from "./support/schema.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://shopping:local-only@127.0.0.1:5432/shopping";
const admin = createDatabase(databaseUrl);
let db: ReturnType<typeof createDatabase>;
let products: ReturnType<typeof createProductRepository>;
let offers: ReturnType<typeof createOfferRepository>;
let schema: string;
const now = new Date("2026-08-13T12:00:00.000Z");
const promotionDecisionId = "a".repeat(64);

const product = {
  productId: "product-1",
  brand: "Acme",
  manufacturerPartNumber: "MODEL-1",
  gtins: ["12345678"],
  title: "Acme Model 1",
  categoryPath: ["Home", "Widgets"],
  attributes: [],
  variantDimensions: { color: "black" }
};

const offer: StoredMerchantOffer = {
  offerId: "offer-1",
  merchantId: "merchant-1",
  merchantProductId: "sku-1",
  productId: "product-1",
  sellerName: "Acme Store",
  condition: "NEW",
  matchStatus: "EXACT",
  inventoryStatus: "IN_STOCK",
  merchantUrl: "https://merchant.example/products/sku-1",
  evidenceRefs: ["evidence-1"],
  matchEvidence: [{ type: "GTIN", gtin: "12345678", source: "MERCHANT_PAGE" }],
  checkedAt: now,
  expiresAt: new Date(now.getTime() + 10 * 60_000)
};

const fixtureQuote = (overrides: Partial<StoredPriceQuote> = {}): StoredPriceQuote => ({
  quoteId: "quote-1",
  offerId: "offer-1",
  zipCode: "10001",
  membershipContext: { memberships: [] },
  status: "VERIFIED",
  deliveredPrice: { amountCents: 1299, currency: "USD" as const },
  lineItems: [{ kind: "ITEM", amount: { amountCents: 1299, currency: "USD" as const }, label: "Item" }],
  eligibilityConditions: [],
  evidenceRefs: ["evidence-1"],
  checkedAt: now,
  expiresAt: new Date(now.getTime() + 5 * 60_000),
  ...overrides
});

describe("commerce repositories", () => {
  beforeAll(async () => {
    await admin.connect();
  });

  beforeEach(async () => {
    schema = `commerce_repository_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const isolated = new URL(databaseUrl);
    isolated.searchParams.set("options", `-csearch_path=${schema}`);
    db = createDatabase(isolated.toString());
    await db.connect();
    await runMigrations(db);
    products = createProductRepository(db);
    offers = createOfferRepository(db);
    await products.upsert(product);
    await offers.saveEvidence({
      evidenceId: "evidence-1",
      merchantId: "merchant-1",
      sourceUrl: "https://merchant.example/products/sku-1",
      sourceType: "MERCHANT_PAGE",
      contentHash: "sha256:abc",
      capturedAt: now,
      metadata: { selector: "#price" }
    } satisfies StoredEvidence);
    await offers.saveOffer(offer);
    await db.query(
      `INSERT INTO merchant_promotion_decisions (
         id, input_hash, entity_kind, source_identity_key, decision_version,
         staging_record_id, merchant_id, merchant_product_id, source_version,
         status, canonical_product_id, promoted_offer_id, offer_revision,
         primary_evidence_id, source_url, source_type, source_content_hash,
         source_captured_at, external_evidence_refs, match_basis, match_evidence,
         reason, questions, candidate_product_ids, staged_checked_at,
         staged_expires_at, staged_record_hash, decided_by, decided_at
       ) VALUES (
         $1, $2, 'OFFER', $3, 1, $4, $5, $6, 'fixture-v1',
         'EXACT_PROMOTED', $7, $8, 1, $9, $10, 'feed', 'sha256:abc',
         $11, '[]'::jsonb, 'GTIN', '[{"type":"GTIN"}]'::jsonb,
         'fixture exact promotion', '[]'::jsonb, '["product-1"]'::jsonb,
         $11, $12, $13, 'test:commerce-repository', $11
       )`,
      [
        promotionDecisionId,
        "b".repeat(64),
        "c".repeat(64),
        "d".repeat(64),
        offer.merchantId,
        offer.merchantProductId,
        product.productId,
        offer.offerId,
        "evidence-1",
        offer.merchantUrl,
        now,
        offer.expiresAt,
        "e".repeat(64)
      ]
    );
    await db.query(
      `INSERT INTO merchant_offer_current_promotions (
         offer_id, promotion_decision_id, revision, canonical_product_id,
         source_identity_key, source_version, promoted_checked_at
       ) VALUES ($1, $2, 1, $3, $4, 'fixture-v1', $5)`,
      [offer.offerId, promotionDecisionId, product.productId, "c".repeat(64), now]
    );
  });

  afterEach(async () => {
    await db.close();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });

  afterAll(async () => {
    await admin.close();
  });

  it("stores quote evidence and returns only unexpired offers", async () => {
    await offers.saveQuote(fixtureQuote({ quoteId: "q1", expiresAt: new Date(now.getTime() + 5 * 60_000) }));
    await offers.saveQuote(fixtureQuote({
      quoteId: "q2",
      checkedAt: new Date(now.getTime() - 10 * 60_000),
      expiresAt: new Date(now.getTime() - 60_000)
    }));
    await bindQuotesToCurrentPromotion("q1", "q2");
    await offers.saveQuote(fixtureQuote({ quoteId: "legacy-unbound" }));

    const rows = await offers.findComparableOffers(
      "product-1",
      { zipCode: "10001", memberships: [] },
      now
    );

    expect(rows.map((row) => row.quoteId)).toEqual(["q1"]);
    expect(rows[0]?.evidenceRefs).toEqual(["evidence-1"]);
    const junction = await db.query<{ quote_id: string; evidence_id: string }>(
      "SELECT quote_id, evidence_id FROM quote_evidence WHERE quote_id = $1 ORDER BY evidence_id",
      ["q1"]
    );
    expect(junction.rows).toEqual([{ quote_id: "q1", evidence_id: "evidence-1" }]);
  });

  it("filters quotes by ZIP and order-independent membership context", async () => {
    await Promise.all([
      offers.saveQuote(fixtureQuote({ quoteId: "fl-regular", zipCode: "33433" })),
      offers.saveQuote(fixtureQuote({
        quoteId: "fl-member",
        zipCode: "33433",
        membershipContext: { memberships: ["prime", "costco"] }
      })),
      offers.saveQuote(fixtureQuote({ quoteId: "ny-regular", zipCode: "10001" })),
      offers.saveQuote(fixtureQuote({
        quoteId: "ny-member",
        zipCode: "10001",
        membershipContext: { memberships: ["costco"] }
      }))
    ]);
    await bindQuotesToCurrentPromotion("fl-regular", "fl-member", "ny-regular", "ny-member");

    const floridaMember = await offers.findComparableOffers(
      "product-1",
      { zipCode: "33433", memberships: ["costco", "prime", "costco"] },
      now
    );
    const newYorkRegular = await offers.findComparableOffers(
      "product-1",
      { zipCode: "10001", memberships: [] },
      now
    );

    expect(floridaMember.map((row) => row.quoteId)).toEqual(["fl-member"]);
    expect(newYorkRegular.map((row) => row.quoteId)).toEqual(["ny-regular"]);
  });

  it("matches mixed-case and non-ASCII membership IDs as an unordered set", async () => {
    const memberships = ["Member-A", "\u{10000}-club", "\uE000-club"];
    await offers.saveQuote(fixtureQuote({
      quoteId: "unicode-member",
      membershipContext: { memberships }
    }));
    await bindQuotesToCurrentPromotion("unicode-member");

    const rows = await offers.findComparableOffers(
      "product-1",
      { zipCode: "10001", memberships: ["\uE000-club", "Member-A", "\u{10000}-club"] },
      now
    );

    expect(rows.map((row) => row.quoteId)).toEqual(["unicode-member"]);
    expect(rows[0]?.membershipContext.memberships).toEqual(["Member-A", "\u{10000}-club", "\uE000-club"]);
  });

  it("does not let a mutable offer reassignment carry an old reviewed quote", async () => {
    await offers.saveQuote(fixtureQuote({ quoteId: "revision-bound" }));
    await bindQuotesToCurrentPromotion("revision-bound");
    await products.upsert({
      ...product,
      productId: "product-2",
      manufacturerPartNumber: "MODEL-2",
      gtins: ["87654321"],
      title: "Acme Model 2"
    });
    await offers.saveOffer({
      ...offer,
      productId: "product-2",
      checkedAt: new Date(now.getTime() + 1_000),
      expiresAt: new Date(now.getTime() + 10 * 60_000 + 1_000)
    });

    await expect(offers.findComparableOffers(
      "product-2",
      { zipCode: "10001", memberships: [] },
      now
    )).resolves.toEqual([]);
  });

  it("upserts canonical products and merchant offers", async () => {
    await products.upsert({ ...product, title: "Acme Model 1 Updated" });
    await offers.saveOffer({ ...offer, sellerName: "Acme Outlet" });

    const result = await db.query<{ title: string; seller_name: string }>(
      "SELECT p.title, o.seller_name FROM products p JOIN merchant_offers o ON o.product_id = p.id WHERE p.id = $1",
      [product.productId]
    );

    expect(result.rows).toEqual([{ title: "Acme Model 1 Updated", seller_name: "Acme Outlet" }]);
  });

  it("keeps the persisted offer ID when refreshing a natural key", async () => {
    await offers.saveQuote(fixtureQuote({ quoteId: "linked-quote" }));
    await offers.saveEvidence({
      evidenceId: "evidence-2",
      merchantId: "merchant-1",
      sourceUrl: "https://merchant.example/products/sku-1?refresh=1",
      sourceType: "MERCHANT_PAGE",
      contentHash: "sha256:def",
      capturedAt: now,
      metadata: { selector: "#inventory" }
    } satisfies StoredEvidence);

    await offers.saveOffer({
      ...offer,
      offerId: "offer-2",
      sellerName: "Acme Outlet",
      evidenceRefs: ["evidence-2"]
    });

    const result = await db.query<{
      id: string;
      seller_name: string;
      quote_id: string;
      evidence_ids: string[];
    }>(
      `SELECT o.id, o.seller_name, q.id AS quote_id,
              array_agg(oe.evidence_id ORDER BY oe.evidence_id) AS evidence_ids
       FROM merchant_offers o
       INNER JOIN price_quotes q ON q.offer_id = o.id
       INNER JOIN offer_evidence oe ON oe.offer_id = o.id
       WHERE o.merchant_id = $1 AND o.merchant_product_id = $2
       GROUP BY o.id, o.seller_name, q.id`,
      [offer.merchantId, offer.merchantProductId]
    );

    expect(result.rows).toEqual([{
      id: "offer-1",
      seller_name: "Acme Outlet",
      quote_id: "linked-quote",
      evidence_ids: ["evidence-2"]
    }]);
  });

  it("persists coupons with their expiry and evidence references", async () => {
    await offers.saveCoupon({
      couponId: "coupon-1",
      merchantId: "merchant-1",
      code: "SAVE10",
      discountRule: { type: "PERCENT", value: 10 },
      eligibility: { minimumCents: 1000 },
      stackingRule: "NOT_STACKABLE_WITH_MEMBERSHIP",
      verificationStatus: "VERIFIED",
      evidenceRefs: ["evidence-1"],
      validFrom: now,
      validTo: new Date(now.getTime() + 60 * 60_000)
    } satisfies StoredCoupon);

    const result = await db.query<{ code: string; evidence_refs: string[] }>(
      "SELECT code, evidence_refs FROM coupons WHERE id = $1",
      ["coupon-1"]
    );

    expect(result.rows).toEqual([{ code: "SAVE10", evidence_refs: ["evidence-1"] }]);
  });

  it("deduplicates quote evidence junction references", async () => {
    await offers.saveQuote(fixtureQuote({ evidenceRefs: ["evidence-1", "evidence-1"] }));

    const result = await db.query<{ evidence_id: string }>(
      "SELECT evidence_id FROM quote_evidence WHERE quote_id = $1",
      ["quote-1"]
    );
    expect(result.rows).toEqual([{ evidence_id: "evidence-1" }]);
  });

  it("rolls back a quote when its evidence reference is unknown", async () => {
    await expect(
      offers.saveQuote(fixtureQuote({ quoteId: "unknown-evidence", evidenceRefs: ["missing"] }))
    ).rejects.toThrow();

    const quoteRows = await db.query<{ id: string }>(
      "SELECT id FROM price_quotes WHERE id = $1",
      ["unknown-evidence"]
    );
    const junctionRows = await db.query<{ quote_id: string }>(
      "SELECT quote_id FROM quote_evidence WHERE quote_id = $1",
      ["unknown-evidence"]
    );
    expect(quoteRows.rows).toEqual([]);
    expect(junctionRows.rows).toEqual([]);
  });

  it("does not let older offer, quote, or evidence refreshes regress newer state", async () => {
    const newer = new Date(now.getTime() + 60_000);
    const older = new Date(now.getTime() - 60_000);
    await offers.saveEvidence({
      evidenceId: "evidence-2",
      merchantId: "merchant-1",
      sourceUrl: "https://merchant.example/new",
      sourceType: "MERCHANT_PAGE",
      contentHash: "sha256:new",
      capturedAt: newer,
      metadata: { version: "new" }
    });

    await offers.saveOffer({
      ...offer,
      sellerName: "New Seller",
      evidenceRefs: ["evidence-2"],
      checkedAt: newer,
      expiresAt: new Date(newer.getTime() + 10 * 60_000)
    });
    await offers.saveQuote(fixtureQuote({
      deliveredPrice: { amountCents: 1099, currency: "USD" },
      evidenceRefs: ["evidence-2"],
      checkedAt: newer,
      expiresAt: new Date(newer.getTime() + 5 * 60_000)
    }));

    await offers.saveEvidence({
      evidenceId: "evidence-2",
      merchantId: "merchant-1",
      sourceUrl: "https://merchant.example/old",
      sourceType: "RETAILER_FEED",
      contentHash: "sha256:old",
      capturedAt: older,
      metadata: { version: "old" }
    });
    await offers.saveOffer({
      ...offer,
      sellerName: "Old Seller",
      evidenceRefs: ["evidence-1"],
      checkedAt: older,
      expiresAt: new Date(older.getTime() + 10 * 60_000)
    });
    await offers.saveQuote(fixtureQuote({
      deliveredPrice: { amountCents: 1599, currency: "USD" },
      evidenceRefs: ["evidence-1"],
      checkedAt: older,
      expiresAt: new Date(older.getTime() + 5 * 60_000)
    }));

    const state = await db.query<{
      seller_name: string;
      delivered_price_cents: string;
      source_url: string;
      content_hash: string;
      metadata: { version: string };
      offer_evidence: string[];
      quote_evidence: string[];
    }>(
      `SELECT o.seller_name, q.delivered_price_cents, e.source_url, e.content_hash, e.metadata,
              array_agg(DISTINCT oe.evidence_id ORDER BY oe.evidence_id) AS offer_evidence,
              array_agg(DISTINCT qe.evidence_id ORDER BY qe.evidence_id) AS quote_evidence
       FROM merchant_offers o
       JOIN price_quotes q ON q.offer_id = o.id
       JOIN evidence e ON e.id = $1
       JOIN offer_evidence oe ON oe.offer_id = o.id
       JOIN quote_evidence qe ON qe.quote_id = q.id
       WHERE o.id = $2 AND q.id = $3
       GROUP BY o.seller_name, q.delivered_price_cents, e.source_url, e.content_hash, e.metadata`,
      ["evidence-2", "offer-1", "quote-1"]
    );

    expect(state.rows).toEqual([{
      seller_name: "New Seller",
      delivered_price_cents: "1099",
      source_url: "https://merchant.example/new",
      content_hash: "sha256:new",
      metadata: { version: "new" },
      offer_evidence: ["evidence-2"],
      quote_evidence: ["evidence-2"]
    }]);
  });
});

async function bindQuotesToCurrentPromotion(...quoteIds: string[]): Promise<void> {
  await db.query(
    `UPDATE price_quotes
     SET offer_promotion_decision_id = $1, offer_revision = 1
     WHERE id = ANY($2::text[])`,
    [promotionDecisionId, quoteIds]
  );
}
