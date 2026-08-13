import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  price = 10_700
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
    expiresAt
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
    await expect(db.query("TRUNCATE merchant_promotion_decisions")).rejects.toThrow(/append-only/i);
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
});
