import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublishedQuote } from "../../../apps/ingestion-worker/src/jobs/refresh-price.js";
import type { PublishedOffer } from "../../../apps/ingestion-worker/src/jobs/refresh-product.js";
import { canonicalHash, quoteContextKey } from "../../../apps/ingestion-worker/src/jobs/refresh-identity.js";
import { createDatabase } from "../src/client.js";
import { runMigrations } from "../src/migrate.js";
import {
  createIngestionEvidenceRepository,
  createIngestionOfferRepository,
  createIngestionPersistence,
  createIngestionQuoteRepository
} from "../src/repositories/ingestion-repository.js";

const databaseUrl = process.env.DATABASE_URL ??
  "postgresql://shopping:local-only@127.0.0.1:5432/shopping";
const adminDb = createDatabase(databaseUrl);
const schemaName = `ingestion_test_${randomUUID().replaceAll("-", "")}`;
let db: ReturnType<typeof createDatabase>;
let evidence: ReturnType<typeof createIngestionEvidenceRepository>;
let offers: ReturnType<typeof createIngestionOfferRepository>;
let quotes: ReturnType<typeof createIngestionQuoteRepository>;
let quarantine: ReturnType<typeof createIngestionPersistence>["quarantine"];
const now = "2026-08-13T18:00:00.000Z";
const later = "2026-08-13T18:10:00.000Z";

function evidenceWrite(overrides: Partial<Parameters<typeof evidence.save>[0]> = {}) {
  const sourceIdentityKey = overrides.sourceIdentityKey ?? canonicalHash({ source: "one" });
  return {
    id: canonicalHash({ kind: "evidence", sourceIdentityKey }),
    sourceIdentityKey,
    merchantId: "merchant-a",
    merchantProductId: "sku-1",
    sourceVersion: "v1",
    sourceUrl: "https://merchant.example/products/sku-1",
    sourceType: "api",
    contentHash: canonicalHash("raw"),
    rawContent: "raw evidence",
    capturedAt: now,
    metadata: { sourceCheckedAt: now },
    ...overrides
  };
}

function publishedOffer(evidenceId: string, overrides: Partial<PublishedOffer> = {}): PublishedOffer {
  const sourceIdentityKey = overrides.sourceIdentityKey ?? canonicalHash({ source: "one" });
  return {
    offerId: canonicalHash({ kind: "offer", sourceIdentityKey }),
    sourceIdentityKey,
    sourceVersion: "v1",
    merchantId: "merchant-a",
    merchantProductId: "sku-1",
    title: "Product",
    gtins: [],
    variantDimensions: {},
    currency: "USD",
    merchantUrl: "https://merchant.example/products/sku-1",
    evidenceRefs: [evidenceId],
    checkedAt: now,
    expiresAt: later,
    sellerName: "Merchant A",
    condition: "NEW",
    inventoryStatus: "IN_STOCK",
    itemPriceCents: 1_000,
    ...overrides
  };
}

function publishedQuote(
  evidenceId: string,
  context: { zipCode: string; memberships: string[] },
  price: number,
  version: string
): PublishedQuote {
  const sourceIdentityKey = canonicalHash({ context, version });
  return {
    quoteId: canonicalHash({ kind: "quote", sourceIdentityKey }),
    merchantId: "merchant-a",
    merchantProductId: "sku-1",
    sourceIdentityKey,
    sourceVersion: version,
    quoteContext: context,
    itemPriceCents: price,
    shippingCents: 0,
    taxCents: 0,
    mandatoryFeeCents: 0,
    deliveredPriceCents: price,
    currency: "USD",
    status: "VERIFIED",
    conditions: [],
    evidenceRefs: [evidenceId],
    checkedAt: now,
    expiresAt: later
  };
}

async function saveQuoteEvidence(quote: PublishedQuote): Promise<string> {
  const write = evidenceWrite({
    id: canonicalHash({ kind: "evidence", sourceIdentityKey: quote.sourceIdentityKey }),
    sourceIdentityKey: quote.sourceIdentityKey,
    sourceVersion: quote.sourceVersion,
    quoteContext: quote.quoteContext,
    contentHash: canonicalHash({ price: quote.deliveredPriceCents, version: quote.sourceVersion }),
    rawContent: JSON.stringify({ price: quote.deliveredPriceCents })
  });
  const result = await evidence.save(write);
  if (result.status === "CONFLICT") throw new Error("fixture conflict");
  return result.record.id;
}

describe("ingestion repository", () => {
  beforeAll(async () => {
    await adminDb.connect();
    await adminDb.query(`CREATE SCHEMA "${schemaName}"`);
    const isolatedUrl = new URL(databaseUrl);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schemaName}`);
    db = createDatabase(isolatedUrl.toString());
    await db.connect();
    await runMigrations(db);
    evidence = createIngestionEvidenceRepository(db);
    offers = createIngestionOfferRepository(db);
    quotes = createIngestionQuoteRepository(db);
    quarantine = createIngestionPersistence(db).quarantine;
  });

  afterAll(async () => {
    await db.close();
    await adminDb.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await adminDb.close();
  });

  it("persists immutable raw evidence, reuses retries, and reports source-version conflict", async () => {
    const write = evidenceWrite();
    await expect(evidence.save(write)).resolves.toMatchObject({ status: "STORED" });
    await expect(evidence.save(write)).resolves.toMatchObject({ status: "REUSED" });
    await expect(evidence.save({
      ...write,
      contentHash: canonicalHash("changed"),
      rawContent: "changed"
    })).resolves.toMatchObject({ status: "CONFLICT" });

    const stored = await db.query<{ raw_content: string }>(
      "SELECT raw_content FROM ingestion_evidence WHERE id = $1",
      [write.id]
    );
    expect(stored.rows).toEqual([{ raw_content: "raw evidence" }]);
    await expect(db.query("UPDATE ingestion_evidence SET raw_content = $1 WHERE id = $2", [
      "mutated",
      write.id
    ])).rejects.toThrow(/immutable/i);
    await expect(db.query("DELETE FROM ingestion_evidence WHERE id = $1", [write.id]))
      .rejects.toThrow(/audited purge/i);
    await expect(db.query(
      "SELECT purge_ingestion_evidence($1, $2, $3)",
      [write.id, "", "missing operator"]
    )).rejects.toThrow(/actor and reason/i);
    await expect(db.query<{ purged: boolean }>(
      "SELECT purge_ingestion_evidence($1, $2, $3) AS purged",
      [write.id, "integration-test", "isolated schema cleanup exercise"]
    )).resolves.toEqual({ rows: [{ purged: true }] });
    const audit = await db.query<{ purged_by: string; purge_reason: string }>(
      "SELECT purged_by, purge_reason FROM ingestion_purge_audit WHERE evidence_id = $1",
      [write.id]
    );
    expect(audit.rows).toEqual([{
      purged_by: "integration-test",
      purge_reason: "isolated schema cleanup exercise"
    }]);
  });

  it("stages product and ledger atomically with retry and rollback", async () => {
    const stored = await evidence.save(evidenceWrite());
    if (stored.status === "CONFLICT") throw new Error("fixture conflict");
    const offer = publishedOffer(stored.record.id);
    const key = canonicalHash({ publication: offer.offerId });

    await Promise.all([offers.upsert(offer, key), offers.upsert(offer, key)]);
    const count = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM merchant_product_staging");
    expect(count.rows).toEqual([{ count: "1" }]);

    const missing = publishedOffer(canonicalHash("missing"), {
      offerId: canonicalHash("missing-offer"),
      sourceIdentityKey: canonicalHash("missing-source")
    });
    const missingKey = canonicalHash("missing-key");
    await expect(offers.upsert(missing, missingKey)).rejects.toThrow();
    const ledger = await db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM ingestion_idempotency WHERE idempotency_key = $1",
      [missingKey]
    );
    expect(ledger.rows).toEqual([{ count: "0" }]);

    await expect(offers.upsert({ ...offer, sellerName: "Changed" }, key)).rejects.toThrow(
      /idempotency conflict/i
    );
  });

  it("durably quarantines conflicting source-version raw content", async () => {
    const write = evidenceWrite({ sourceIdentityKey: canonicalHash("conflict-source") });
    await evidence.save(write);
    const quarantineKey = canonicalHash({ quarantine: write.sourceIdentityKey });
    const record = {
      reason: "SOURCE_VERSION_CONFLICT" as const,
      merchantId: write.merchantId,
      merchantProductId: write.merchantProductId,
      sourceIdentityKey: write.sourceIdentityKey,
      sourceVersion: write.sourceVersion,
      sourceUrl: write.sourceUrl,
      rawEvidence: "conflicting raw payload",
      metadata: { sourceType: "api" },
      quoteContext: { zipCode: "10001", memberships: [] },
      evidenceRefs: [write.id],
      checkedAt: now,
      expectedContentHash: write.contentHash,
      actualContentHash: canonicalHash("conflicting raw payload")
    };

    await quarantine.save(record, quarantineKey);
    await quarantine.save(record, quarantineKey);

    const result = await db.query<{ count: string; payload: { rawEvidence: string } }>(
      `SELECT (count(*) OVER ())::text AS count, payload
       FROM merchant_ingestion_quarantine WHERE id = $1`,
      [quarantineKey]
    );
    expect(result.rows).toEqual([{
      count: "1",
      payload: expect.objectContaining({ rawEvidence: "conflicting raw payload" })
    }]);
  });

  it("isolates ZIP and membership price history and atomically quarantines a 90 percent drop", async () => {
    const contexts = [
      { zipCode: "10001", memberships: [] },
      { zipCode: "10001", memberships: ["member"] },
      { zipCode: "33433", memberships: [] }
    ];
    for (const [index, context] of contexts.entries()) {
      const basePrices = [10_000, 500, 400];
      const quote = publishedQuote("", context, basePrices[index]!, `base-${index}`);
      quote.evidenceRefs = [await saveQuoteEvidence(quote)];
      await expect(quotes.commit({
        quote,
        publicationKey: quote.quoteId,
        quarantineKey: canonicalHash({ quarantine: quote.sourceIdentityKey })
      })).resolves.toEqual({ status: "PUBLISHED" });
    }

    const drop = publishedQuote("", contexts[0]!, 1_000, "drop");
    drop.evidenceRefs = [await saveQuoteEvidence(drop)];
    const quarantineKey = canonicalHash({ quarantine: drop.sourceIdentityKey });
    await expect(quotes.commit({
      quote: drop,
      publicationKey: drop.quoteId,
      quarantineKey
    })).resolves.toMatchObject({ status: "QUARANTINED" });
    await expect(quotes.commit({
      quote: drop,
      publicationKey: drop.quoteId,
      quarantineKey
    })).resolves.toMatchObject({ status: "QUARANTINED" });

    const rows = await db.query<{ quote_count: string; quarantine_count: string; contexts: string }>(
      `SELECT
         (SELECT count(*)::text FROM merchant_quote_staging) AS quote_count,
         (SELECT count(*)::text FROM merchant_ingestion_quarantine
          WHERE reason = 'PRICE_DROP_AT_LEAST_90_PERCENT') AS quarantine_count,
         (SELECT count(DISTINCT context_hash)::text FROM merchant_quote_staging) AS contexts`
    );
    expect(rows.rows).toEqual([{ quote_count: "3", quarantine_count: "1", contexts: "3" }]);
    expect(contexts.map(quoteContextKey)).toHaveLength(3);
  });

  it("rolls back quote publication and its ledger when evidence is missing", async () => {
    const quote = publishedQuote(canonicalHash("missing"), { zipCode: "10001", memberships: [] }, 1000, "missing");
    const publicationKey = quote.quoteId;

    await expect(quotes.commit({
      quote,
      publicationKey,
      quarantineKey: canonicalHash({ quarantine: quote.sourceIdentityKey })
    })).rejects.toThrow();

    const result = await db.query<{ quote_count: string; ledger_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM merchant_quote_staging WHERE id = $1) AS quote_count,
         (SELECT count(*)::text FROM ingestion_idempotency WHERE idempotency_key = $1) AS ledger_count`,
      [publicationKey]
    );
    expect(result.rows).toEqual([{ quote_count: "0", ledger_count: "0" }]);
  });
});
