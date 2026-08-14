import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../../../apps/commerce-api/src/app.js";
import { createCurrentOfferStore } from "../../../apps/commerce-api/src/current-offer-store.js";

import type { PublishedQuote } from "../../../apps/ingestion-worker/src/jobs/refresh-price.js";
import type { PublishedOffer } from "../../../apps/ingestion-worker/src/jobs/refresh-product.js";
import { sha256 } from "../../../apps/ingestion-worker/src/evidence/store-evidence.js";
import {
  priceSourceIdentity,
  productSourceIdentity,
  stableRecordId
} from "../../../apps/ingestion-worker/src/jobs/refresh-identity.js";
import { createDatabase } from "../src/client.js";
import { runMigrations } from "../src/migrate.js";
import {
  createIngestionEvidenceRepository,
  createIngestionOfferRepository,
  createIngestionQuoteRepository
} from "../src/repositories/ingestion-repository.js";
import { createOfferRepository } from "../src/repositories/offer-repository.js";
import { createProductRepository } from "../src/repositories/product-repository.js";
import { createPromotionRepository } from "../src/repositories/promotion-repository.js";

const databaseUrl = process.env.DATABASE_URL ??
  "postgresql://shopping:local-only@127.0.0.1:5432/shopping";
const admin = createDatabase(databaseUrl);
const schema = `promotion_test_${randomUUID().replaceAll("-", "")}`;
let db: ReturnType<typeof createDatabase>;
let evidence: ReturnType<typeof createIngestionEvidenceRepository>;
let productStaging: ReturnType<typeof createIngestionOfferRepository>;
let quoteStaging: ReturnType<typeof createIngestionQuoteRepository>;
let promotions: ReturnType<typeof createPromotionRepository>;
const checkedAt = "2026-08-13T18:00:00.000Z";
const expiresAt = "2026-08-13T20:00:00.000Z";

function productEvidence(merchantId: string, sku: string, version: string) {
  const identity = productSourceIdentity({ merchantId, merchantProductId: sku, sourceVersion: version });
  const rawContent = JSON.stringify({ merchantId, sku, version });
  return {
    id: stableRecordId("evidence", identity.key),
    sourceIdentityKey: identity.key,
    merchantId,
    merchantProductId: sku,
    sourceVersion: version,
    sourceUrl: `https://${merchantId}.example/products/${sku}`,
    sourceType: "feed",
    contentHash: sha256(rawContent),
    rawContent,
    capturedAt: checkedAt,
    metadata: { sourceType: "feed", sourceCheckedAt: checkedAt }
  };
}

function stagedOffer(
  primaryEvidenceId: string,
  merchantId: string,
  sku: string,
  version: string,
  overrides: Partial<PublishedOffer> = {}
): PublishedOffer {
  const identity = productSourceIdentity({ merchantId, merchantProductId: sku, sourceVersion: version });
  return {
    offerId: stableRecordId("offer", identity.key),
    sourceIdentityKey: identity.key,
    sourceVersion: version,
    merchantId,
    merchantProductId: sku,
    title: "Acme Model 1",
    brand: "ＡＣＭＥ",
    mpn: "MODEL－1",
    gtins: ["1234 5678"],
    variantDimensions: { color: "black" },
    currency: "USD",
    merchantUrl: `https://${merchantId}.example/products/${sku}`,
    primaryEvidenceId,
    externalEvidenceRefs: ["opaque-adapter-ref"],
    evidenceRefs: ["opaque-adapter-ref", primaryEvidenceId],
    checkedAt,
    expiresAt,
    sellerName: "Merchant",
    condition: "NEW",
    inventoryStatus: "IN_STOCK",
    itemPriceCents: 10_000,
    ...overrides
  };
}

async function stageProduct(
  merchantId: string,
  sku: string,
  version = "v1",
  overrides: Partial<PublishedOffer> = {}
): Promise<PublishedOffer> {
  const write = productEvidence(merchantId, sku, version);
  const saved = await evidence.save(write);
  if (saved.status === "CONFLICT") throw new Error("fixture conflict");
  const offer = stagedOffer(saved.record.id, merchantId, sku, version, overrides);
  await productStaging.upsert(offer, offer.offerId);
  return offer;
}

async function stageQuote(
  merchantId: string,
  sku: string,
  version: string,
  memberships: string[],
  price = 10_700,
  overrides: Partial<PublishedQuote> = {}
): Promise<PublishedQuote> {
  const quoteContext = { zipCode: "10001", memberships: [...new Set(memberships)].sort() };
  const identity = priceSourceIdentity({
    merchantId,
    merchantProductId: sku,
    sourceVersion: version,
    ...quoteContext
  });
  const rawContent = JSON.stringify({ merchantId, sku, version, memberships, price });
  const saved = await evidence.save({
    id: stableRecordId("evidence", identity.key),
    sourceIdentityKey: identity.key,
    merchantId,
    merchantProductId: sku,
    sourceVersion: version,
    quoteContext,
    sourceUrl: `https://${merchantId}.example/quotes/${sku}`,
    sourceType: "api",
    contentHash: sha256(rawContent),
    rawContent,
    capturedAt: checkedAt,
    metadata: { sourceType: "api", sourceCheckedAt: checkedAt }
  });
  if (saved.status === "CONFLICT") throw new Error("fixture conflict");
  const quote: PublishedQuote = {
    quoteId: stableRecordId("quote", identity.key),
    merchantId,
    merchantProductId: sku,
    sourceIdentityKey: identity.key,
    sourceVersion: version,
    quoteContext,
    itemPriceCents: price - 700,
    shippingCents: 100,
    taxCents: 500,
    mandatoryFeeCents: 100,
    deliveredPriceCents: price,
    currency: "USD",
    status: "VERIFIED",
    conditions: memberships.map((membership) => `membership:${membership}`),
    primaryEvidenceId: saved.record.id,
    externalEvidenceRefs: ["opaque-quote-ref"],
    evidenceRefs: ["opaque-quote-ref", saved.record.id],
    checkedAt,
    expiresAt,
    ...overrides
  };
  const outcome = await quoteStaging.commit({
    quote,
    publicationKey: quote.quoteId,
    quarantineKey: stableRecordId("quarantine", identity.key)
  });
  if (outcome.status !== "PUBLISHED") throw new Error("fixture quote quarantined");
  return quote;
}

describe("merchant staging promotion", () => {
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const isolated = new URL(databaseUrl);
    isolated.searchParams.set("options", `-csearch_path=${schema}`);
    db = createDatabase(isolated.toString());
    await db.connect();
    await runMigrations(db);
    evidence = createIngestionEvidenceRepository(db);
    productStaging = createIngestionOfferRepository(db);
    quoteStaging = createIngestionQuoteRepository(db);
    promotions = createPromotionRepository(db, {
      now: () => new Date("2026-08-13T18:30:00.000Z")
    });
    await createProductRepository(db).upsert({
      productId: "canonical-1",
      brand: "Acme",
      manufacturerPartNumber: "Model-1",
      gtins: ["12345678"],
      title: "Acme Model 1",
      categoryPath: ["Widgets"],
      attributes: [],
      variantDimensions: { color: "black" }
    });
  });

  afterAll(async () => {
    await db.close();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.close();
  });

  it("promotes exact data transactionally and reuses concurrent reruns", async () => {
    const staged = await stageProduct("merchant-a", "sku-1");
    const [left, right] = await Promise.all([
      promotions.promoteProduct(staged.offerId),
      promotions.promoteProduct(staged.offerId)
    ]);
    expect(left).toEqual(right);
    expect(left).toMatchObject({ status: "EXACT_PROMOTED", canonicalProductId: "canonical-1" });

    const rows = await db.query<{
      decision_count: string;
      offer_count: string;
      match_status: string;
      product_id: string;
      refs: string[];
    }>(
      `SELECT
         (SELECT count(*)::text FROM merchant_promotion_decisions
          WHERE source_identity_key = $1) AS decision_count,
         (SELECT count(*)::text FROM merchant_offers
          WHERE merchant_id = 'merchant-a' AND merchant_product_id = 'sku-1') AS offer_count,
         o.match_status, o.product_id, o.evidence_refs AS refs
       FROM merchant_offers o WHERE o.id = $2`,
      [staged.sourceIdentityKey, left.offerId]
    );
    expect(rows.rows).toEqual([{
      decision_count: "1",
      offer_count: "1",
      match_status: "EXACT",
      product_id: "canonical-1",
      refs: [staged.primaryEvidenceId]
    }]);
  });

  it("keeps quote contexts isolated and Commerce returns only exact fresh context", async () => {
    const regular = await stageQuote("merchant-a", "sku-1", "regular-v1", [], 10_700);
    const member = await stageQuote("merchant-a", "sku-1", "member-v1", ["club"], 9_700);
    await promotions.promoteQuote(regular.quoteId);
    await promotions.promoteQuote(member.quoteId);

    const commerce = createOfferRepository(db);
    const regularRows = await commerce.findComparableOffers(
      "canonical-1",
      { zipCode: "10001", memberships: [] },
      new Date("2026-08-13T18:30:00.000Z")
    );
    const memberRows = await commerce.findComparableOffers(
      "canonical-1",
      { zipCode: "10001", memberships: ["club"] },
      new Date("2026-08-13T18:30:00.000Z")
    );
    expect(regularRows).toHaveLength(1);
    expect(regularRows[0]?.deliveredPrice.amountCents).toBe(10_700);
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]?.deliveredPrice.amountCents).toBe(9_700);
    expect(memberRows[0]?.lineItems.map((line) => line.kind)).not.toContain("COUPON");

    const store = createCurrentOfferStore(db, new Set(["merchant-a"]));
    const app = buildApp({
      offers: store,
      quoteExactOffer: store.quoteExactOffer,
      clock: { now: () => new Date("2026-08-13T18:30:00.000Z") }
    }, { bearerToken: "a".repeat(32) });
    const response = await app.inject({
      method: "POST",
      url: "/v1/comparisons",
      headers: { authorization: `Bearer ${"a".repeat(32)}` },
      payload: { query: "Acme Model-1", zipCode: "10001", memberships: ["club"] }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      productId: "canonical-1",
      exactOffers: [{
        regularQuote: { deliveredPrice: { amountCents: 10_700 } },
        memberQuote: {
          programId: "club",
          eligible: true,
          quote: { deliveredPrice: { amountCents: 9_700 } }
        },
        rankingQuote: { deliveredPrice: { amountCents: 9_700 } }
      }],
      similarOffers: []
    });
    const search = await store.search("Acme Model-1", new Date("2026-08-13T18:30:00.000Z"));
    if (search.status !== "RESOLVED") throw new Error("fixture product did not resolve");
    const candidate = search.candidates[0];
    if (candidate === undefined) throw new Error("fixture offer missing");
    await expect(store.quoteExactOffer(candidate, {
      zipCode: "10002",
      memberships: ["club"],
      now: new Date("2026-08-13T18:30:00.000Z")
    })).resolves.toBeUndefined();
    await expect(store.quoteExactOffer(candidate, {
      zipCode: "10001",
      memberships: ["other-club"],
      now: new Date("2026-08-13T18:30:00.000Z")
    })).resolves.toMatchObject({ regularQuote: { deliveredPrice: { amountCents: 10_700 } } });
    expect((await store.quoteExactOffer(candidate, {
      zipCode: "10001",
      memberships: ["other-club"],
      now: new Date("2026-08-13T18:30:00.000Z")
    }))?.memberQuote).toBeUndefined();
    await db.query(
      `UPDATE price_quotes SET delivered_price_cents = 1,
         line_items = '[{"kind":"ITEM","amount":{"amountCents":1,"currency":"USD"},"label":"tampered"}]'::jsonb
       WHERE id = $1`,
      [(await db.query<{ id: string }>(
        "SELECT promoted_quote_id AS id FROM merchant_promotion_decisions WHERE source_identity_key = $1 AND status = 'QUOTE_PROMOTED'",
        [regular.sourceIdentityKey]
      )).rows[0]?.id]
    );
    await expect(store.quoteExactOffer(candidate, {
      zipCode: "10001",
      memberships: [],
      now: new Date("2026-08-13T18:30:00.000Z")
    })).resolves.toMatchObject({
      regularQuote: { deliveredPrice: { amountCents: 10_700 } }
    });
    await app.close();
  });

  it("requires strong identity instead of comparing a weak title substring", async () => {
    await createProductRepository(db).upsert({
      productId: "canonical-ambiguous",
      brand: "Acme",
      manufacturerPartNumber: "Model-2",
      gtins: ["22223333"],
      title: "Acme Model 2",
      categoryPath: ["Widgets"],
      attributes: [],
      variantDimensions: { color: "black" }
    });
    const staged = await stageProduct("merchant-ambiguous-query", "sku-ambiguous-query", "v1", {
      title: "Acme Model 2",
      brand: "Acme",
      mpn: "Model-2",
      gtins: ["22223333"]
    });
    await promotions.promoteProduct(staged.offerId);

    await expect(
      createCurrentOfferStore(db, new Set(["merchant-ambiguous-query"]))
        .search("Acme Model", new Date("2026-08-13T18:30:00.000Z"))
    ).resolves.toEqual({
      status: "NEEDS_CLARIFICATION",
      questions: ["Please provide an exact model number or GTIN for a currently available product."]
    });
  });

  it("keeps quote-before-offer pending then promotes it after exact identity", async () => {
    const quote = await stageQuote("merchant-pending", "sku-pending", "price-v1", [], 5_000);
    await expect(promotions.promoteQuote(quote.quoteId)).resolves.toMatchObject({
      status: "PENDING_EXACT_OFFER"
    });
    expect((await db.query("SELECT id FROM price_quotes WHERE id <> ALL($1::text[])", [
      (await db.query<{ id: string }>("SELECT id FROM price_quotes")).rows.map((row) => row.id)
    ])).rows).toEqual([]);

    const offer = await stageProduct("merchant-pending", "sku-pending");
    await promotions.promoteProduct(offer.offerId);
    const drained = await promotions.promotePendingQuotes("merchant-pending", "sku-pending");
    expect(drained).toHaveLength(1);
    expect(drained[0]).toMatchObject({ status: "QUOTE_PROMOTED" });
    const history = await db.query<{ status: string }>(
      `SELECT status FROM merchant_promotion_decisions
       WHERE entity_kind = 'QUOTE' AND source_identity_key = $1 ORDER BY decision_version`,
      [quote.sourceIdentityKey]
    );
    expect(history.rows).toEqual([
      { status: "PENDING_EXACT_OFFER" },
      { status: "QUOTE_PROMOTED" }
    ]);
  });

  it("keeps a quote pending when it predates the current exact offer revision", async () => {
    const offer = await stageProduct("merchant-compatibility", "sku-compatibility", "offer-v1", {
      checkedAt: "2026-08-13T18:10:00.000Z"
    });
    await promotions.promoteProduct(offer.offerId);
    const olderQuote = await stageQuote(
      "merchant-compatibility",
      "sku-compatibility",
      "quote-older",
      [],
      5_000,
      { checkedAt: "2026-08-13T18:05:00.000Z" }
    );

    await expect(promotions.promoteQuote(olderQuote.quoteId)).resolves.toMatchObject({
      status: "PENDING_EXACT_OFFER"
    });
    await expect(
      promotions.promotePendingQuotes("merchant-compatibility", "sku-compatibility")
    ).resolves.toEqual([]);
    await expect(db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM price_quotes q JOIN merchant_offers o ON o.id = q.offer_id WHERE o.merchant_id = 'merchant-compatibility'"
    )).resolves.toEqual({ rows: [{ count: "0" }] });
  });

  it("never records an older quote as a promotion of a newer Commerce row", async () => {
    const offer = await stageProduct("merchant-quote-order", "sku-quote-order", "offer-v1");
    await promotions.promoteProduct(offer.offerId);
    const newer = await stageQuote(
      "merchant-quote-order",
      "sku-quote-order",
      "quote-newer",
      [],
      8_000,
      { checkedAt: "2026-08-13T18:10:00.000Z" }
    );
    await promotions.promoteQuote(newer.quoteId);
    const older = await stageQuote(
      "merchant-quote-order",
      "sku-quote-order",
      "quote-older",
      [],
      9_000,
      { checkedAt: "2026-08-13T18:05:00.000Z" }
    );

    await expect(promotions.promoteQuote(older.quoteId)).rejects.toThrow(/older quote staging/i);
    await expect(db.query<{ delivered_price_cents: string }>(
      `SELECT q.delivered_price_cents::text
       FROM price_quotes q JOIN merchant_offers o ON o.id = q.offer_id
       WHERE o.merchant_id = 'merchant-quote-order'`
    )).resolves.toEqual({ rows: [{ delivered_price_cents: "8000" }] });
  });

  it("records ambiguous identity without exposing an exact Commerce offer", async () => {
    await createProductRepository(db).upsert({
      productId: "canonical-duplicate",
      brand: "Acme Duplicate",
      gtins: ["12345678"],
      title: "Duplicate seed",
      categoryPath: ["Widgets"],
      attributes: [],
      variantDimensions: { color: "black" }
    });
    const staged = await stageProduct("merchant-ambiguous", "sku-ambiguous");
    await expect(promotions.promoteProduct(staged.offerId)).resolves.toMatchObject({
      status: "AMBIGUOUS"
    });
    const result = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM merchant_offers
       WHERE merchant_id = 'merchant-ambiguous'`
    );
    expect(result.rows).toEqual([{ count: "0" }]);
  });

  it("keeps source-version decisions immutable while a later source refreshes one offer", async () => {
    await createProductRepository(db).upsert({
      productId: "canonical-versioned",
      brand: "Versioned",
      manufacturerPartNumber: "V-1",
      gtins: ["87654321"],
      title: "Versioned Model",
      categoryPath: ["Widgets"],
      attributes: [],
      variantDimensions: { color: "black" }
    });
    const first = await stageProduct("merchant-versioned", "sku-versioned", "v1", {
      title: "Versioned Model",
      brand: "Versioned",
      mpn: "V-1",
      gtins: ["87654321"],
      checkedAt: "2026-08-13T18:01:00.000Z",
      expiresAt: "2026-08-13T20:01:00.000Z"
    });
    const firstResult = await promotions.promoteProduct(first.offerId);
    const second = await stageProduct("merchant-versioned", "sku-versioned", "v2", {
      title: "Versioned Model",
      brand: "Versioned",
      mpn: "V-1",
      gtins: ["87654321"],
      checkedAt: "2026-08-13T18:02:00.000Z",
      expiresAt: "2026-08-13T20:02:00.000Z",
      inventoryStatus: "OUT_OF_STOCK"
    });
    const secondResult = await promotions.promoteProduct(second.offerId);

    expect(secondResult.offerId).toBe(firstResult.offerId);
    const history = await db.query<{
      source_version: string;
      staged_record_hash: string;
      inventory_status: string;
    }>(
      `SELECT d.source_version, d.staged_record_hash, o.inventory_status
       FROM merchant_promotion_decisions d
       JOIN merchant_offers o ON o.id = d.promoted_offer_id
       WHERE d.entity_kind = 'OFFER' AND d.merchant_id = 'merchant-versioned'
       ORDER BY d.source_version`
    );
    expect(history.rows.map((row) => row.source_version)).toEqual(["v1", "v2"]);
    expect(new Set(history.rows.map((row) => row.staged_record_hash)).size).toBe(2);
    expect(history.rows.every((row) => row.inventory_status === "OUT_OF_STOCK")).toBe(true);
    await expect(db.query(
      "UPDATE merchant_promotion_decisions SET reason = 'mutated' WHERE id = $1",
      [firstResult.decisionId]
    )).rejects.toThrow(/append-only/i);
    await expect(db.query("TRUNCATE merchant_promotion_decisions")).rejects.toThrow();
  });

  it("rejects cross-merchant evidence and rolls back core evidence and decisions", async () => {
    const hostile = productEvidence("merchant-hostile", "sku-hostile", "v1");
    await evidence.save(hostile);
    const staged = await stageProduct("merchant-safe", "sku-safe", "v1", {
      externalEvidenceRefs: [hostile.id],
      evidenceRefs: [hostile.id, productEvidence("merchant-safe", "sku-safe", "v1").id]
    });
    // Rewrite the staging fixture atomically through its original insert contract.
    await db.query(
      `UPDATE merchant_product_staging SET payload = $2::jsonb, external_evidence_refs = $3
       WHERE id = $1`,
      [staged.offerId, JSON.stringify(staged), staged.externalEvidenceRefs]
    );

    await expect(promotions.promoteProduct(staged.offerId)).rejects.toThrow(/cross-merchant/i);
    const result = await db.query<{ decisions: string; core_evidence: string }>(
      `SELECT
         (SELECT count(*)::text FROM merchant_promotion_decisions
          WHERE source_identity_key = $1) AS decisions,
         (SELECT count(*)::text FROM evidence WHERE id = $2) AS core_evidence`,
      [staged.sourceIdentityKey, staged.primaryEvidenceId]
    );
    expect(result.rows).toEqual([{ decisions: "0", core_evidence: "0" }]);
  });

  it("does not stage or promote a quarantined price anomaly", async () => {
    const offer = await stageProduct("merchant-anomaly", "sku-anomaly");
    await promotions.promoteProduct(offer.offerId);
    const baseline = await stageQuote("merchant-anomaly", "sku-anomaly", "baseline", [], 10_000);
    await promotions.promoteQuote(baseline.quoteId);

    const identity = priceSourceIdentity({
      merchantId: "merchant-anomaly",
      merchantProductId: "sku-anomaly",
      sourceVersion: "drop",
      zipCode: "10001",
      memberships: []
    });
    const saved = await evidence.save({
      id: stableRecordId("evidence", identity.key),
      sourceIdentityKey: identity.key,
      merchantId: "merchant-anomaly",
      merchantProductId: "sku-anomaly",
      sourceVersion: "drop",
      quoteContext: { zipCode: "10001", memberships: [] },
      sourceUrl: "https://merchant-anomaly.example/quotes/sku-anomaly",
      sourceType: "api",
      contentHash: sha256("drop"),
      rawContent: "drop",
      capturedAt: checkedAt,
      metadata: { sourceType: "api" }
    });
    if (saved.status === "CONFLICT") throw new Error("fixture conflict");
    const dropped: PublishedQuote = {
      ...(await stageQuote("merchant-anomaly", "unused", "shape", [], 1_000)),
      quoteId: stableRecordId("quote", identity.key),
      merchantId: "merchant-anomaly",
      merchantProductId: "sku-anomaly",
      sourceIdentityKey: identity.key,
      sourceVersion: "drop",
      quoteContext: { zipCode: "10001", memberships: [] },
      itemPriceCents: 1_000,
      shippingCents: 0,
      taxCents: 0,
      mandatoryFeeCents: 0,
      deliveredPriceCents: 1_000,
      primaryEvidenceId: saved.record.id,
      externalEvidenceRefs: ["opaque"],
      evidenceRefs: ["opaque", saved.record.id]
    };
    const outcome = await quoteStaging.commit({
      quote: dropped,
      publicationKey: dropped.quoteId,
      quarantineKey: stableRecordId("quarantine", identity.key)
    });
    expect(outcome.status).toBe("QUARANTINED");
    await expect(promotions.promoteQuote(dropped.quoteId)).rejects.toThrow(/not found/i);
  });

  it("binds quotes to the exact offer revision and excludes them after reviewed reassignment", async () => {
    const products = createProductRepository(db);
    await products.upsert({
      productId: "revision-a",
      brand: "Revision",
      manufacturerPartNumber: "A-1",
      gtins: ["11112222"],
      title: "Revision A",
      categoryPath: ["Widgets"],
      attributes: [],
      variantDimensions: { color: "black" }
    });
    await products.upsert({
      productId: "revision-b",
      brand: "Revision",
      manufacturerPartNumber: "B-1",
      gtins: ["33334444"],
      title: "Revision B",
      categoryPath: ["Widgets"],
      attributes: [],
      variantDimensions: { color: "black" }
    });
    const first = await stageProduct("merchant-revision", "sku-revision", "product-a", {
      title: "Revision A",
      brand: "Revision",
      mpn: "A-1",
      gtins: ["11112222"],
      checkedAt: "2026-08-13T18:01:00.000Z"
    });
    const firstPromotion = await promotions.promoteProduct(first.offerId);
    const oldQuote = await stageQuote(
      "merchant-revision",
      "sku-revision",
      "quote-a",
      [],
      4_000,
      { checkedAt: "2026-08-13T18:02:00.000Z" }
    );
    await promotions.promoteQuote(oldQuote.quoteId);

    const currentStore = createCurrentOfferStore(db, new Set(["merchant-revision"]));
    const beforeReassignment = await currentStore.search(
      "Revision A-1",
      new Date("2026-08-13T18:30:00.000Z")
    );
    if (beforeReassignment.status !== "RESOLVED") throw new Error("original product did not resolve");
    const oldCandidate = beforeReassignment.candidates[0];
    if (oldCandidate === undefined) throw new Error("original offer missing");

    const reassigned = await stageProduct("merchant-revision", "sku-revision", "product-b", {
      title: "Revision B",
      brand: "Revision",
      mpn: "B-1",
      gtins: ["33334444"],
      checkedAt: "2026-08-13T18:10:00.000Z"
    });
    await expect(promotions.promoteProduct(reassigned.offerId, {
      decisionVersion: 2,
      decidedBy: "reviewer@example.com",
      expectedCurrentOfferPromotionDecisionId: firstPromotion.decisionId
    })).resolves.toMatchObject({ status: "EXACT_PROMOTED", canonicalProductId: "revision-b" });

    const commerce = createOfferRepository(db);
    await expect(commerce.findComparableOffers(
      "revision-b",
      { zipCode: "10001", memberships: [] },
      new Date("2026-08-13T18:30:00.000Z")
    )).resolves.toEqual([]);
    const oldBinding = await db.query<{ offer_revision: string; current_revision: string }>(
      `SELECT q.offer_revision::text, c.revision::text AS current_revision
       FROM price_quotes q JOIN merchant_offer_current_promotions c ON c.offer_id = q.offer_id
       WHERE q.id = $1`,
      [(await db.query<{ id: string }>(
        "SELECT promoted_quote_id AS id FROM merchant_promotion_decisions WHERE source_identity_key = $1 AND status = 'QUOTE_PROMOTED'",
        [oldQuote.sourceIdentityKey]
      )).rows[0]?.id]
    );
    expect(oldBinding.rows).toEqual([{ offer_revision: "1", current_revision: "2" }]);
    const currentSearch = await currentStore.search(
      "Revision B-1",
      new Date("2026-08-13T18:30:00.000Z")
    );
    if (currentSearch.status !== "RESOLVED") throw new Error("reassigned product did not resolve");
    const currentCandidate = currentSearch.candidates[0];
    if (currentCandidate === undefined) throw new Error("reassigned offer missing");
    await expect(currentStore.quoteExactOffer(currentCandidate, {
      zipCode: "10001",
      memberships: [],
      now: new Date("2026-08-13T18:30:00.000Z")
    })).resolves.toBeUndefined();
    await expect(currentStore.quoteExactOffer(oldCandidate, {
      zipCode: "10001",
      memberships: [],
      now: new Date("2026-08-13T18:30:00.000Z")
    })).resolves.toBeUndefined();
  });

  it("replays committed product and quote decisions after expiry but rejects changed input", async () => {
    await createProductRepository(db).upsert({
      productId: "replay-product",
      brand: "Replay",
      manufacturerPartNumber: "R-1",
      gtins: ["55556666"],
      title: "Replay Product",
      categoryPath: ["Widgets"],
      attributes: [],
      variantDimensions: { color: "black" }
    });
    const staged = await stageProduct("merchant-replay", "sku-replay", "product-v1", {
      title: "Replay Product",
      brand: "Replay",
      mpn: "R-1",
      gtins: ["55556666"]
    });
    const productResult = await promotions.promoteProduct(staged.offerId);
    const quote = await stageQuote("merchant-replay", "sku-replay", "quote-v1", [], 6_000);
    const quoteResult = await promotions.promoteQuote(quote.quoteId);
    const expiredClock = createPromotionRepository(db, {
      now: () => new Date("2026-08-13T21:00:00.000Z")
    });
    await expect(
      createCurrentOfferStore(db, new Set(["merchant-replay"]))
        .search("Replay R-1", new Date("2026-08-13T21:00:00.000Z"))
    ).resolves.toMatchObject({ status: "NEEDS_CLARIFICATION" });
    await expect(expiredClock.promoteProduct(staged.offerId)).resolves.toEqual(productResult);
    await expect(expiredClock.promoteQuote(quote.quoteId)).resolves.toEqual(quoteResult);

    await db.query(
      `UPDATE merchant_product_staging
       SET payload = jsonb_set(payload, '{title}', '"changed after commit"'::jsonb)
       WHERE id = $1`,
      [staged.offerId]
    );
    await expect(expiredClock.promoteProduct(staged.offerId)).rejects.toThrow(/idempotency conflict/i);
  });

  it("never lets an older reviewed reassignment overwrite a newer offer", async () => {
    const products = createProductRepository(db);
    await products.upsert({
      productId: "stale-current",
      brand: "Stale",
      gtins: ["77778888"],
      title: "Current Product",
      categoryPath: ["Widgets"],
      attributes: [],
      variantDimensions: {}
    });
    await products.upsert({
      productId: "stale-old",
      brand: "Stale",
      gtins: ["99990000"],
      title: "Older Product",
      categoryPath: ["Widgets"],
      attributes: [],
      variantDimensions: {}
    });
    const current = await stageProduct("merchant-stale", "sku-stale", "current", {
      title: "Current Product",
      brand: "Stale",
      gtins: ["77778888"],
      variantDimensions: {},
      checkedAt: "2026-08-13T18:20:00.000Z",
      inventoryStatus: "IN_STOCK"
    });
    await promotions.promoteProduct(current.offerId);
    const stale = await stageProduct("merchant-stale", "sku-stale", "older", {
      title: "Older Product",
      brand: "Stale",
      gtins: ["99990000"],
      variantDimensions: {},
      checkedAt: "2026-08-13T18:10:00.000Z",
      inventoryStatus: "OUT_OF_STOCK"
    });
    await expect(promotions.promoteProduct(stale.offerId, {
      decisionVersion: 2,
      decidedBy: "reviewer@example.com"
    })).resolves.toMatchObject({ status: "NEEDS_CLARIFICATION" });
    await expect(db.query<{ product_id: string; inventory_status: string; checked_at: Date }>(
      "SELECT product_id, inventory_status, checked_at FROM merchant_offers WHERE merchant_id = 'merchant-stale'"
    )).resolves.toEqual({ rows: [{
      product_id: "stale-current",
      inventory_status: "IN_STOCK",
      checked_at: new Date("2026-08-13T18:20:00.000Z")
    }] });
  });

  it("rejects a reviewed reassignment made against a stale offer revision", async () => {
    const products = createProductRepository(db);
    await products.upsert({
      productId: "review-a",
      brand: "Review",
      gtins: ["22223333"],
      title: "Review A",
      categoryPath: ["Widgets"],
      attributes: [],
      variantDimensions: {}
    });
    await products.upsert({
      productId: "review-b",
      brand: "Review",
      gtins: ["44445555"],
      title: "Review B",
      categoryPath: ["Widgets"],
      attributes: [],
      variantDimensions: {}
    });
    const first = await stageProduct("merchant-review", "sku-review", "v1", {
      title: "Review A",
      brand: "Review",
      gtins: ["22223333"],
      variantDimensions: {},
      checkedAt: "2026-08-13T18:01:00.000Z"
    });
    const firstDecision = await promotions.promoteProduct(first.offerId);
    const refresh = await stageProduct("merchant-review", "sku-review", "v2", {
      title: "Review A",
      brand: "Review",
      gtins: ["22223333"],
      variantDimensions: {},
      checkedAt: "2026-08-13T18:02:00.000Z"
    });
    const currentDecision = await promotions.promoteProduct(refresh.offerId);
    const reviewed = await stageProduct("merchant-review", "sku-review", "v3", {
      title: "Review B",
      brand: "Review",
      gtins: ["44445555"],
      variantDimensions: {},
      checkedAt: "2026-08-13T18:03:00.000Z"
    });

    await expect(promotions.promoteProduct(reviewed.offerId, {
      decisionVersion: 2,
      decidedBy: "reviewer@example.com",
      expectedCurrentOfferPromotionDecisionId: firstDecision.decisionId
    })).resolves.toMatchObject({ status: "NEEDS_CLARIFICATION" });
    expect(firstDecision.decisionId).not.toBe(currentDecision.decisionId);
    await expect(db.query<{ product_id: string }>(
      "SELECT product_id FROM merchant_offers WHERE merchant_id = 'merchant-review'"
    )).resolves.toEqual({ rows: [{ product_id: "review-a" }] });
  });

  it("requires the reviewed offer revision for canonical reassignment", async () => {
    const products = createProductRepository(db);
    await products.upsert({
      productId: "token-a",
      brand: "Token",
      gtins: ["12121212"],
      title: "Token A",
      categoryPath: ["Widgets"],
      attributes: [],
      variantDimensions: {}
    });
    await products.upsert({
      productId: "token-b",
      brand: "Token",
      gtins: ["34343434"],
      title: "Token B",
      categoryPath: ["Widgets"],
      attributes: [],
      variantDimensions: {}
    });
    const first = await stageProduct("merchant-token", "sku-token", "v1", {
      title: "Token A",
      brand: "Token",
      gtins: ["12121212"],
      variantDimensions: {},
      checkedAt: "2026-08-13T18:01:00.000Z"
    });
    await promotions.promoteProduct(first.offerId);
    const reassignment = await stageProduct("merchant-token", "sku-token", "v2", {
      title: "Token B",
      brand: "Token",
      gtins: ["34343434"],
      variantDimensions: {},
      checkedAt: "2026-08-13T18:02:00.000Z"
    });

    await expect(promotions.promoteProduct(reassignment.offerId, {
      decisionVersion: 2,
      decidedBy: "reviewer@example.com"
    })).resolves.toMatchObject({ status: "NEEDS_CLARIFICATION" });
    await expect(db.query<{ product_id: string }>(
      "SELECT product_id FROM merchant_offers WHERE merchant_id = 'merchant-token'"
    )).resolves.toEqual({ rows: [{ product_id: "token-a" }] });
  });

  it("cannot bypass reviewed reassignment through the mutable offer repository", async () => {
    const products = createProductRepository(db);
    await products.upsert({
      productId: "baseline-a",
      brand: "Baseline",
      gtins: ["56565656"],
      title: "Baseline A",
      categoryPath: ["Widgets"],
      attributes: [],
      variantDimensions: {}
    });
    await products.upsert({
      productId: "baseline-b",
      brand: "Baseline",
      gtins: ["78787878"],
      title: "Baseline B",
      categoryPath: ["Widgets"],
      attributes: [],
      variantDimensions: {}
    });
    const first = await stageProduct("merchant-baseline", "sku-baseline", "v1", {
      title: "Baseline A",
      brand: "Baseline",
      gtins: ["56565656"],
      variantDimensions: {},
      checkedAt: "2026-08-13T18:01:00.000Z"
    });
    const firstPromotion = await promotions.promoteProduct(first.offerId);
    const mutableOffers = createOfferRepository(db);
    await mutableOffers.saveOffer({
      offerId: "ignored-on-merchant-sku-conflict",
      merchantId: "merchant-baseline",
      merchantProductId: "sku-baseline",
      productId: "baseline-b",
      sellerName: "Merchant",
      condition: "NEW",
      matchStatus: "EXACT",
      inventoryStatus: "IN_STOCK",
      merchantUrl: "https://merchant-baseline.example/products/sku-baseline",
      evidenceRefs: [first.primaryEvidenceId],
      matchEvidence: [{ type: "GTIN", gtin: "78787878", source: "RETAILER_FEED" }],
      checkedAt: new Date("2026-08-13T18:02:00.000Z"),
      expiresAt: new Date(expiresAt)
    });
    const second = await stageProduct("merchant-baseline", "sku-baseline", "v2", {
      title: "Baseline B",
      brand: "Baseline",
      gtins: ["78787878"],
      variantDimensions: {},
      checkedAt: "2026-08-13T18:03:00.000Z"
    });

    await expect(promotions.promoteProduct(second.offerId)).resolves.toMatchObject({
      status: "NEEDS_CLARIFICATION"
    });
    await expect(db.query<{ canonical_product_id: string; promotion_decision_id: string }>(
      `SELECT canonical_product_id, promotion_decision_id
       FROM merchant_offer_current_promotions
       WHERE offer_id = $1`,
      [firstPromotion.offerId]
    )).resolves.toEqual({ rows: [{
      canonical_product_id: "baseline-a",
      promotion_decision_id: firstPromotion.decisionId
    }] });
  });

  it("does not bind a quote when mutable offer identity differs from its reviewed revision", async () => {
    const products = createProductRepository(db);
    await products.upsert({
      productId: "mutable-a",
      brand: "Mutable",
      gtins: ["66667777"],
      title: "Mutable A",
      categoryPath: ["Widgets"],
      attributes: [],
      variantDimensions: {}
    });
    await products.upsert({
      productId: "mutable-b",
      brand: "Mutable",
      gtins: ["88889999"],
      title: "Mutable B",
      categoryPath: ["Widgets"],
      attributes: [],
      variantDimensions: {}
    });
    const offer = await stageProduct("merchant-mutable", "sku-mutable", "offer", {
      title: "Mutable A",
      brand: "Mutable",
      gtins: ["66667777"],
      variantDimensions: {}
    });
    await promotions.promoteProduct(offer.offerId);
    await db.query(
      "UPDATE merchant_offers SET product_id = 'mutable-b' WHERE merchant_id = 'merchant-mutable'"
    );
    const quote = await stageQuote("merchant-mutable", "sku-mutable", "quote", [], 7_000);

    await expect(promotions.promoteQuote(quote.quoteId)).resolves.toMatchObject({
      status: "PENDING_EXACT_OFFER"
    });
  });
});
