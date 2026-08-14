import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PublishedOffer } from "../../../apps/ingestion-worker/src/jobs/refresh-product.js";
import { sha256 } from "../../../apps/ingestion-worker/src/evidence/store-evidence.js";
import {
  productSourceIdentity,
  stableRecordId
} from "../../../apps/ingestion-worker/src/jobs/refresh-identity.js";
import { normalizeToken } from "../../product-identity/src/index.js";
import { createDatabase } from "../src/client.js";
import { runMigrations } from "../src/migrate.js";
import {
  assertProductIdentityKeysReady,
  backfillProductIdentityKeys
} from "../src/product-identity-backfill.js";
import {
  createIngestionEvidenceRepository,
  createIngestionOfferRepository
} from "../src/repositories/ingestion-repository.js";
import { createPromotionRepository } from "../src/repositories/promotion-repository.js";

const databaseUrl = process.env.DATABASE_URL ??
  "postgresql://shopping:local-only@127.0.0.1:5432/shopping";
const admin = createDatabase(databaseUrl);
const schema = `product_identity_backfill_${randomUUID().replaceAll("-", "")}`;
let db: ReturnType<typeof createDatabase>;
let legacyMigrationsDir: string;

describe("product identity key backfill", () => {
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const isolated = new URL(databaseUrl);
    isolated.searchParams.set("options", `-csearch_path=${schema}`);
    db = createDatabase(isolated.toString());
    await db.connect();
    legacyMigrationsDir = await mkdtemp(join(tmpdir(), "product-identity-legacy-migrations-"));
    const migrationsDir = fileURLToPath(new URL("../../../infra/migrations/", import.meta.url));
    await Promise.all(["0001_core.sql", "0002_ingestion_pipeline.sql"].map((filename) =>
      copyFile(join(migrationsDir, filename), join(legacyMigrationsDir, filename))
    ));
    await runMigrations(db, legacyMigrationsDir);

    await db.query(
      `INSERT INTO products (
        id, brand, manufacturer_part_number, gtins, title, category_path,
        attributes, variant_dimensions
      ) VALUES
        ('legacy-1', $1, $2, '{}', 'Legacy one', '{}', '[]', '{}'),
        ('legacy-2', 'Second Brand', ' Part / 2 ', '{}', 'Legacy two', '{}', '[]', '{}'),
        ('gtin-only', 'No MPN', NULL, '{}', 'No MPN', '{}', '[]', '{}')`,
      ["ＡＣＭＥ & Co.", " MODEL－１ "]
    );
    await copyFile(
      join(migrationsDir, "0003_merchant_promotion.sql"),
      join(legacyMigrationsDir, "0003_merchant_promotion.sql")
    );
    await runMigrations(db, legacyMigrationsDir);
    await runMigrations(db);
    await db.query(
      `UPDATE products SET identity_brand_key = '', identity_mpn_key = '' WHERE id = 'legacy-2';
       INSERT INTO products (
         id, brand, manufacturer_part_number, gtins, title, category_path,
         attributes, variant_dimensions, identity_brand_key, identity_mpn_key
       ) VALUES ('already-ready', 'Ready', '3', '{}', 'Ready', '{}', '[]', '{}', 'ready', '3')`
    );
  });

  afterAll(async () => {
    await db.close();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.close();
    await rm(legacyMigrationsDir, { recursive: true, force: true });
  });

  it("reports by default without writing, then applies exact normalizer output in bounded batches", async () => {
    await expect(assertProductIdentityKeysReady(db, true)).rejects.toThrow(/2 products/i);

    await expect(backfillProductIdentityKeys(db, { batchSize: 1 })).resolves.toEqual({
      dryRun: true,
      scanned: 2,
      updated: 0,
      remaining: 2
    });
    const afterDryRun = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM products
       WHERE manufacturer_part_number IS NOT NULL
         AND (NULLIF(btrim(identity_brand_key), '') IS NULL
           OR NULLIF(btrim(identity_mpn_key), '') IS NULL)`
    );
    expect(afterDryRun.rows).toEqual([{ count: "2" }]);

    await expect(backfillProductIdentityKeys(db, { apply: true, batchSize: 1 })).resolves.toEqual({
      dryRun: false,
      scanned: 2,
      updated: 2,
      remaining: 0
    });

    const rows = await db.query<{
      id: string;
      identity_brand_key: string | null;
      identity_mpn_key: string | null;
    }>(
      `SELECT id, identity_brand_key, identity_mpn_key
       FROM products ORDER BY id COLLATE "C"`
    );
    expect(rows.rows).toEqual([
      { id: "already-ready", identity_brand_key: "ready", identity_mpn_key: "3" },
      { id: "gtin-only", identity_brand_key: null, identity_mpn_key: null },
      {
        id: "legacy-1",
        identity_brand_key: normalizeToken("ＡＣＭＥ & Co."),
        identity_mpn_key: normalizeToken(" MODEL－１ ")
      },
      {
        id: "legacy-2",
        identity_brand_key: normalizeToken("Second Brand"),
        identity_mpn_key: normalizeToken(" Part / 2 ")
      }
    ]);
    await expect(assertProductIdentityKeysReady(db, true)).resolves.toBeUndefined();

    const merchantId = "legacy-merchant";
    const merchantProductId = "legacy-sku";
    const sourceVersion = "v1";
    const identity = productSourceIdentity({ merchantId, merchantProductId, sourceVersion });
    const rawContent = JSON.stringify({ merchantId, merchantProductId, sourceVersion });
    const evidence = await createIngestionEvidenceRepository(db).save({
      id: stableRecordId("evidence", identity.key),
      sourceIdentityKey: identity.key,
      merchantId,
      merchantProductId,
      sourceVersion,
      sourceUrl: "https://legacy-merchant.example/products/legacy-sku",
      sourceType: "feed",
      contentHash: sha256(rawContent),
      rawContent,
      capturedAt: "2026-08-13T18:00:00.000Z",
      metadata: { sourceType: "feed", sourceCheckedAt: "2026-08-13T18:00:00.000Z" }
    });
    if (evidence.status === "CONFLICT") throw new Error("fixture evidence conflict");

    const offer: PublishedOffer = {
      offerId: stableRecordId("offer", identity.key),
      sourceIdentityKey: identity.key,
      sourceVersion,
      merchantId,
      merchantProductId,
      title: "Legacy one",
      brand: "acme & co",
      mpn: "model-1",
      gtins: [],
      variantDimensions: {},
      currency: "USD",
      merchantUrl: "https://legacy-merchant.example/products/legacy-sku",
      primaryEvidenceId: evidence.record.id,
      externalEvidenceRefs: ["authorized-feed-record"],
      evidenceRefs: ["authorized-feed-record", evidence.record.id],
      checkedAt: "2026-08-13T18:00:00.000Z",
      expiresAt: "2026-08-13T20:00:00.000Z",
      sellerName: "Legacy Merchant",
      condition: "NEW",
      inventoryStatus: "IN_STOCK",
      itemPriceCents: 10_000
    };
    await createIngestionOfferRepository(db).upsert(offer, offer.offerId);

    await expect(createPromotionRepository(db, {
      now: () => new Date("2026-08-13T18:30:00.000Z")
    }).promoteProduct(offer.offerId)).resolves.toMatchObject({
      status: "EXACT_PROMOTED",
      canonicalProductId: "legacy-1"
    });
  });

  it("rolls back the whole batch when an identity cannot be normalized", async () => {
    await db.query(
      `INSERT INTO products (
        id, brand, manufacturer_part_number, gtins, title, category_path,
        attributes, variant_dimensions
      ) VALUES
        ('rollback-a-good', 'Good', 'Part 4', '{}', 'Good', '{}', '[]', '{}'),
        ('rollback-z-bad', '!!!', '---', '{}', 'Bad', '{}', '[]', '{}')`
    );

    await expect(backfillProductIdentityKeys(db, { apply: true, batchSize: 2 }))
      .rejects.toThrow(/cannot derive non-empty identity keys/i);
    const result = await db.query<{
      id: string;
      identity_brand_key: string | null;
      identity_mpn_key: string | null;
    }>(
      `SELECT id, identity_brand_key, identity_mpn_key FROM products
       WHERE id LIKE 'rollback-%' ORDER BY id COLLATE "C"`
    );
    expect(result.rows).toEqual([
      { id: "rollback-a-good", identity_brand_key: null, identity_mpn_key: null },
      { id: "rollback-z-bad", identity_brand_key: null, identity_mpn_key: null }
    ]);
  });
});
