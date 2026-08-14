import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublishedQuote } from "../../../apps/ingestion-worker/src/jobs/refresh-price.js";
import type { PublishedOffer } from "../../../apps/ingestion-worker/src/jobs/refresh-product.js";
import { sha256 } from "../../../apps/ingestion-worker/src/evidence/store-evidence.js";
import {
  canonicalHash,
  priceSourceIdentity,
  productSourceIdentity,
  quoteContextKey,
  stableRecordId
} from "../../../apps/ingestion-worker/src/jobs/refresh-identity.js";
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
const purgeOwnerRole = `purge_owner_${randomUUID().replaceAll("-", "")}`;
const retentionRole = `retention_${randomUUID().replaceAll("-", "")}`;
const retentionLoginRole = `retention_login_${randomUUID().replaceAll("-", "")}`;
const retentionPassword = randomUUID();
let db: ReturnType<typeof createDatabase>;
let retentionDb: ReturnType<typeof createDatabase>;
let evidence: ReturnType<typeof createIngestionEvidenceRepository>;
let offers: ReturnType<typeof createIngestionOfferRepository>;
let quotes: ReturnType<typeof createIngestionQuoteRepository>;
let quarantine: ReturnType<typeof createIngestionPersistence>["quarantine"];
const now = "2026-08-13T18:00:00.000Z";
const later = "2026-08-13T18:10:00.000Z";

function evidenceWrite(overrides: Partial<Parameters<typeof evidence.save>[0]> = {}) {
  const merchantId = overrides.merchantId ?? "merchant-a";
  const merchantProductId = overrides.merchantProductId ?? "sku-1";
  const sourceVersion = overrides.sourceVersion ?? "v1";
  const quoteContext = overrides.quoteContext;
  const identity = quoteContext
    ? priceSourceIdentity({ merchantId, merchantProductId, sourceVersion, ...quoteContext })
    : productSourceIdentity({ merchantId, merchantProductId, sourceVersion });
  const rawContent = overrides.rawContent ?? "raw evidence";
  return {
    id: stableRecordId("evidence", identity.key),
    sourceIdentityKey: identity.key,
    merchantId,
    merchantProductId,
    sourceVersion,
    sourceUrl: "https://merchant.example/products/sku-1",
    sourceType: "api",
    contentHash: sha256(rawContent),
    rawContent,
    capturedAt: now,
    metadata: { sourceType: "api", sourceCheckedAt: now },
    ...overrides
  };
}

function publishedOffer(evidenceId: string, overrides: Partial<PublishedOffer> = {}): PublishedOffer {
  const merchantId = overrides.merchantId ?? "merchant-a";
  const merchantProductId = overrides.merchantProductId ?? "sku-1";
  const sourceVersion = overrides.sourceVersion ?? "v1";
  const sourceIdentityKey = productSourceIdentity({ merchantId, merchantProductId, sourceVersion }).key;
  return {
    offerId: stableRecordId("offer", sourceIdentityKey),
    sourceIdentityKey,
    sourceVersion,
    merchantId,
    merchantProductId,
    title: "Product",
    gtins: [],
    variantDimensions: {},
    currency: "USD",
    merchantUrl: "https://merchant.example/products/sku-1",
    primaryEvidenceId: evidenceId,
    externalEvidenceRefs: ["adapter-ref"],
    evidenceRefs: ["adapter-ref", evidenceId],
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
  const sourceIdentityKey = priceSourceIdentity({
    merchantId: "merchant-a",
    merchantProductId: "sku-1",
    sourceVersion: version,
    ...context
  }).key;
  return {
    quoteId: stableRecordId("quote", sourceIdentityKey),
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
    primaryEvidenceId: evidenceId,
    externalEvidenceRefs: ["adapter-ref"],
    evidenceRefs: ["adapter-ref", evidenceId],
    checkedAt: now,
    expiresAt: later
  };
}

async function saveQuoteEvidence(quote: PublishedQuote): Promise<string> {
  const write = evidenceWrite({
    sourceVersion: quote.sourceVersion,
    quoteContext: quote.quoteContext,
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
    await adminDb.transaction(async (bootstrap) => {
      const admin = await bootstrap.query<{ rolsuper: boolean }>(
        "SELECT rolsuper FROM pg_roles WHERE rolname = session_user"
      );
      if (admin.rows[0]?.rolsuper !== true) throw new Error("bootstrap must be superuser");
      await bootstrap.query(
        `CREATE ROLE "${purgeOwnerRole}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`
      );
      await bootstrap.query(
        `CREATE ROLE "${retentionRole}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`
      );
      await bootstrap.query(
        `CREATE ROLE "${retentionLoginRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT PASSWORD '${retentionPassword}'`
      );
      await bootstrap.query(
        `GRANT USAGE, CREATE ON SCHEMA "${schemaName}" TO "${purgeOwnerRole}"`
      );
      await bootstrap.query(
        `GRANT SELECT, DELETE ON
           "${schemaName}".ingestion_evidence,
           "${schemaName}".ingestion_conflict_evidence,
           "${schemaName}".ingestion_idempotency,
           "${schemaName}".merchant_product_staging,
           "${schemaName}".merchant_quote_staging,
           "${schemaName}".merchant_ingestion_quarantine
         TO "${purgeOwnerRole}"`
      );
      await bootstrap.query(
        `GRANT INSERT ON "${schemaName}".ingestion_purge_audit TO "${purgeOwnerRole}"`
      );
      await bootstrap.query(
        `GRANT USAGE, SELECT ON SEQUENCE "${schemaName}".ingestion_purge_audit_purge_id_seq
         TO "${purgeOwnerRole}"`
      );
      await bootstrap.query(
        `ALTER FUNCTION "${schemaName}".purge_ingestion_evidence(text,text,text)
         OWNER TO "${purgeOwnerRole}"`
      );
      await bootstrap.query(
        `REVOKE CREATE ON SCHEMA "${schemaName}" FROM "${purgeOwnerRole}"`
      );
      await bootstrap.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO "${retentionRole}"`);
      await bootstrap.query(
        `GRANT EXECUTE ON FUNCTION "${schemaName}".purge_ingestion_evidence(text,text,text)
         TO "${retentionRole}"`
      );
      await bootstrap.query(`GRANT "${retentionRole}" TO "${retentionLoginRole}"`);
    });
    const retentionUrl = new URL(databaseUrl);
    retentionUrl.username = retentionLoginRole;
    retentionUrl.password = retentionPassword;
    retentionUrl.searchParams.set("options", `-csearch_path=${schemaName}`);
    retentionDb = createDatabase(retentionUrl.toString());
    await retentionDb.connect();
    evidence = createIngestionEvidenceRepository(db);
    offers = createIngestionOfferRepository(db);
    quotes = createIngestionQuoteRepository(db);
    quarantine = createIngestionPersistence(db).quarantine;
  });

  afterAll(async () => {
    await retentionDb.close();
    await db.close();
    await adminDb.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await adminDb.query(`REVOKE "${retentionRole}" FROM "${retentionLoginRole}"`);
    await adminDb.query(`DROP OWNED BY "${retentionLoginRole}"`);
    await adminDb.query(`DROP ROLE "${retentionLoginRole}"`);
    await adminDb.query(`DROP OWNED BY "${retentionRole}"`);
    await adminDb.query(`DROP ROLE "${retentionRole}"`);
    await adminDb.query(`DROP OWNED BY "${purgeOwnerRole}"`);
    await adminDb.query(`DROP ROLE "${purgeOwnerRole}"`);
    await adminDb.close();
  });

  it("rejects owner TRUNCATE of primary and conflict evidence, including CASCADE", async () => {
    const write = evidenceWrite({ sourceVersion: "truncate-v1" });
    await evidence.save(write);
    await evidence.save({
      ...write,
      rawContent: "truncate conflict",
      contentHash: sha256("truncate conflict")
    });

    await expect(db.query("TRUNCATE ingestion_conflict_evidence CASCADE"))
      .rejects.toThrow(/immutable/i);
    await expect(db.query("TRUNCATE ingestion_evidence CASCADE"))
      .rejects.toThrow(/immutable/i);
  });

  it("persists immutable raw evidence, reuses retries, and reports source-version conflict", async () => {
    const write = evidenceWrite();
    await expect(evidence.save(write)).resolves.toMatchObject({ status: "STORED" });
    await expect(evidence.save(write)).resolves.toMatchObject({ status: "REUSED" });
    await expect(evidence.save({
      ...write,
      contentHash: sha256("changed"),
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
    await expect(retentionDb.query("DELETE FROM ingestion_evidence WHERE id = $1", [write.id]))
      .rejects.toThrow(/permission denied/i);
    await expect(retentionDb.query("TRUNCATE ingestion_evidence"))
      .rejects.toThrow(/permission denied/i);
    const security = await db.query<{
      prosecdef: boolean;
      config: string[];
      public_execute: boolean;
      function_owner: string;
    }>(
      `SELECT p.prosecdef, p.proconfig AS config, pg_get_userbyid(p.proowner) AS function_owner,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = $1 AND p.proname = 'purge_ingestion_evidence'`,
      [schemaName]
    );
    expect(security.rows[0]).toMatchObject({
      prosecdef: true,
      public_execute: false,
      function_owner: purgeOwnerRole
    });
    expect(security.rows[0]?.config).toEqual([
      `search_path=pg_catalog, ${schemaName}, pg_temp`
    ]);
    const roles = await adminDb.query<{
      role: string;
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
    }>(
      `SELECT rolname AS role, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole
       FROM pg_roles WHERE rolname IN ($1, $2) ORDER BY rolname`,
      [purgeOwnerRole, retentionRole]
    );
    expect(roles.rows).toEqual(expect.arrayContaining([
      {
        role: purgeOwnerRole,
        rolcanlogin: false,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false
      },
      {
        role: retentionRole,
        rolcanlogin: false,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false
      }
    ]));
    const evidenceRelation = `"${schemaName}".ingestion_evidence`;
    const auditRelation = `"${schemaName}".ingestion_purge_audit`;
    const privileges = await adminDb.query<{
      owner_schema_usage: boolean;
      owner_schema_create: boolean;
      owner_evidence_select: boolean;
      owner_evidence_delete: boolean;
      owner_evidence_insert: boolean;
      owner_evidence_update: boolean;
      owner_evidence_truncate: boolean;
      owner_audit_insert: boolean;
      owner_audit_select: boolean;
      owner_audit_delete: boolean;
      owner_audit_truncate: boolean;
      retention_schema_usage: boolean;
      retention_schema_create: boolean;
      retention_evidence_delete: boolean;
      retention_evidence_truncate: boolean;
      retention_execute: boolean;
      owner_membership: string;
      login_membership: string;
    }>(
      `SELECT
         has_schema_privilege($1, $3, 'USAGE') AS owner_schema_usage,
         has_schema_privilege($1, $3, 'CREATE') AS owner_schema_create,
         has_table_privilege($1, $4, 'SELECT') AS owner_evidence_select,
         has_table_privilege($1, $4, 'DELETE') AS owner_evidence_delete,
         has_table_privilege($1, $4, 'INSERT') AS owner_evidence_insert,
         has_table_privilege($1, $4, 'UPDATE') AS owner_evidence_update,
         has_table_privilege($1, $4, 'TRUNCATE') AS owner_evidence_truncate,
         has_table_privilege($1, $5, 'INSERT') AS owner_audit_insert,
         has_table_privilege($1, $5, 'SELECT') AS owner_audit_select,
         has_table_privilege($1, $5, 'DELETE') AS owner_audit_delete,
         has_table_privilege($1, $5, 'TRUNCATE') AS owner_audit_truncate,
         has_schema_privilege($2, $3, 'USAGE') AS retention_schema_usage,
         has_schema_privilege($2, $3, 'CREATE') AS retention_schema_create,
         has_table_privilege($2, $4, 'DELETE') AS retention_evidence_delete,
         has_table_privilege($2, $4, 'TRUNCATE') AS retention_evidence_truncate,
         has_function_privilege($2, $6, 'EXECUTE') AS retention_execute,
         (SELECT count(*)::text FROM pg_auth_members m
          JOIN pg_roles parent ON parent.oid = m.roleid
          JOIN pg_roles member ON member.oid = m.member
          WHERE parent.rolname = $1 AND member.rolname = $2) AS owner_membership,
         (SELECT count(*)::text FROM pg_auth_members m
          JOIN pg_roles parent ON parent.oid = m.roleid
          JOIN pg_roles member ON member.oid = m.member
          WHERE parent.rolname = $2 AND member.rolname = $7) AS login_membership`,
      [
        purgeOwnerRole,
        retentionRole,
        schemaName,
        evidenceRelation,
        auditRelation,
        `"${schemaName}".purge_ingestion_evidence(text,text,text)`,
        retentionLoginRole
      ]
    );
    expect(privileges.rows).toEqual([{
      owner_schema_usage: true,
      owner_schema_create: false,
      owner_evidence_select: true,
      owner_evidence_delete: true,
      owner_evidence_insert: false,
      owner_evidence_update: false,
      owner_evidence_truncate: false,
      owner_audit_insert: true,
      owner_audit_select: false,
      owner_audit_delete: false,
      owner_audit_truncate: false,
      retention_schema_usage: true,
      retention_schema_create: false,
      retention_evidence_delete: false,
      retention_evidence_truncate: false,
      retention_execute: true,
      owner_membership: "0",
      login_membership: "1"
    }]);
    await retentionDb.query("CREATE TEMP TABLE ingestion_evidence (id text)");
    await retentionDb.query("INSERT INTO ingestion_evidence VALUES ($1)", [write.id]);
    await expect(retentionDb.query<{ purged: boolean }>(
      `SELECT "${schemaName}".purge_ingestion_evidence($1, $2, $3) AS purged`,
      [write.id, "integration-test", "isolated schema cleanup exercise"]
    )).resolves.toEqual({ rows: [{ purged: true }] });
    const audit = await db.query<{
      requested_actor: string;
      authenticated_role: string;
      function_owner: string;
      purge_reason: string;
    }>(
      `SELECT requested_actor, authenticated_role, function_owner, purge_reason
       FROM ingestion_purge_audit WHERE evidence_id = $1`,
      [write.id]
    );
    expect(audit.rows).toEqual([{
      requested_actor: "integration-test",
      authenticated_role: retentionLoginRole,
      function_owner: purgeOwnerRole,
      purge_reason: "isolated schema cleanup exercise"
    }]);
    await expect(db.query("UPDATE ingestion_purge_audit SET purge_reason = 'x'"))
      .rejects.toThrow(/append-only/i);
    await expect(db.query("DELETE FROM ingestion_purge_audit"))
      .rejects.toThrow(/append-only/i);
    await expect(db.query("TRUNCATE ingestion_purge_audit"))
      .rejects.toThrow(/append-only/i);
  });

  it("independently rejects tampered evidence hashes, ids, and source identities", async () => {
    const write = evidenceWrite({ sourceVersion: "tamper-v1" });
    await expect(evidence.save({ ...write, contentHash: canonicalHash("not the raw bytes") }))
      .rejects.toThrow(/content hash/i);
    await expect(evidence.save({ ...write, id: canonicalHash("forged evidence id") }))
      .rejects.toThrow(/evidence id/i);
    await expect(evidence.save({ ...write, sourceIdentityKey: canonicalHash("forged source") }))
      .rejects.toThrow(/source identity/i);
    const count = await db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM ingestion_evidence WHERE source_version = 'tamper-v1'"
    );
    expect(count.rows).toEqual([{ count: "0" }]);
  });

  it("stages product and ledger atomically with retry and rollback", async () => {
    const stored = await evidence.save(evidenceWrite());
    if (stored.status === "CONFLICT") throw new Error("fixture conflict");
    const hostileExternal = evidenceWrite({
      merchantId: "merchant-b",
      merchantProductId: "other-sku"
    });
    await evidence.save(hostileExternal);
    const offer = publishedOffer(stored.record.id, {
      externalEvidenceRefs: [hostileExternal.id],
      evidenceRefs: [hostileExternal.id, stored.record.id]
    });
    const key = offer.offerId;

    await Promise.all([offers.upsert(offer, key), offers.upsert(offer, key)]);
    const count = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM merchant_product_staging");
    expect(count.rows).toEqual([{ count: "1" }]);
    const refs = await db.query<{ primary_evidence_id: string; external_evidence_refs: string[] }>(
      `SELECT primary_evidence_id, external_evidence_refs
       FROM merchant_product_staging WHERE id = $1`,
      [offer.offerId]
    );
    expect(refs.rows).toEqual([{
      primary_evidence_id: stored.record.id,
      external_evidence_refs: [hostileExternal.id]
    }]);

    const wrongPrimary = evidenceWrite({
      merchantId: "merchant-b",
      merchantProductId: "sku-1",
      sourceVersion: "cross-v2"
    });
    await evidence.save(wrongPrimary);
    const crossMerchant = publishedOffer(wrongPrimary.id, { sourceVersion: "cross-v2" });
    await expect(offers.upsert(crossMerchant, crossMerchant.offerId))
      .rejects.toThrow(/primary evidence/i);
    const crossLedger = await db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM ingestion_idempotency WHERE idempotency_key = $1",
      [crossMerchant.offerId]
    );
    expect(crossLedger.rows).toEqual([{ count: "0" }]);

    const missing = publishedOffer(canonicalHash("missing"), {
      offerId: canonicalHash("missing-offer"),
      sourceIdentityKey: canonicalHash("missing-source")
    });
    const missingKey = missing.offerId;
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
    const context = { zipCode: "10001", memberships: [] };
    const write = evidenceWrite({ sourceVersion: "conflict-v1", quoteContext: context });
    await evidence.save(write);
    const conflictRaw = "conflicting raw payload";
    const conflict = await evidence.save({
      ...write,
      contentHash: sha256(conflictRaw),
      rawContent: conflictRaw
    });
    if (conflict.status !== "CONFLICT") throw new Error("expected fixture conflict");
    const quarantineKey = stableRecordId("quarantine", write.sourceIdentityKey);
    const record = {
      reason: "SOURCE_VERSION_CONFLICT" as const,
      merchantId: write.merchantId,
      merchantProductId: write.merchantProductId,
      sourceIdentityKey: write.sourceIdentityKey,
      sourceVersion: write.sourceVersion,
      sourceUrl: write.sourceUrl,
      rawEvidence: conflictRaw,
      metadata: write.metadata,
      quoteContext: context,
      primaryEvidenceId: write.id,
      conflictEvidenceId: conflict.conflictEvidenceId,
      externalEvidenceRefs: ["adapter-ref"],
      evidenceRefs: [write.id],
      checkedAt: now,
      expectedContentHash: write.contentHash,
      actualContentHash: sha256(conflictRaw)
    };
    record.evidenceRefs = ["adapter-ref", write.id];

    await quarantine.save(record, quarantineKey);
    await quarantine.save(record, quarantineKey);

    const secondRaw = "a second conflicting raw payload";
    const secondConflict = await evidence.save({
      ...write,
      contentHash: sha256(secondRaw),
      rawContent: secondRaw
    });
    if (secondConflict.status !== "CONFLICT") throw new Error("expected second conflict");
    await expect(quarantine.save({
      ...record,
      rawEvidence: secondRaw,
      conflictEvidenceId: secondConflict.conflictEvidenceId,
      actualContentHash: sha256(secondRaw)
    }, quarantineKey)).resolves.toBeUndefined();

    const result = await db.query<{
      count: string;
      conflict_evidence_id: string;
      raw_content: string;
    }>(
      `SELECT (count(*) OVER ())::text AS count, q.conflict_evidence_id, c.raw_content
       FROM merchant_ingestion_quarantine q
       JOIN ingestion_conflict_evidence c ON c.id = q.conflict_evidence_id
       WHERE q.id = $1`,
      [quarantineKey]
    );
    expect(result.rows).toEqual([{
      count: "1",
      conflict_evidence_id: conflict.conflictEvidenceId,
      raw_content: conflictRaw
    }]);
    await expect(db.query("UPDATE ingestion_conflict_evidence SET raw_content = 'x'"))
      .rejects.toThrow(/immutable/i);
    const conflictCount = await db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM ingestion_conflict_evidence WHERE source_identity_key = $1",
      [write.sourceIdentityKey]
    );
    expect(conflictCount.rows).toEqual([{ count: "2" }]);
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
      quote.primaryEvidenceId = await saveQuoteEvidence(quote);
      quote.evidenceRefs = [...quote.externalEvidenceRefs, quote.primaryEvidenceId];
      await expect(quotes.commit({
        quote,
        publicationKey: quote.quoteId,
        quarantineKey: stableRecordId("quarantine", quote.sourceIdentityKey)
      })).resolves.toEqual({ status: "PUBLISHED" });
    }

    const drop = publishedQuote("", contexts[0]!, 1_000, "drop");
    drop.primaryEvidenceId = await saveQuoteEvidence(drop);
    drop.evidenceRefs = [...drop.externalEvidenceRefs, drop.primaryEvidenceId];
    const quarantineKey = stableRecordId("quarantine", drop.sourceIdentityKey);
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
      quarantineKey: stableRecordId("quarantine", quote.sourceIdentityKey)
    })).rejects.toThrow();

    const result = await db.query<{ quote_count: string; ledger_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM merchant_quote_staging WHERE id = $1) AS quote_count,
         (SELECT count(*)::text FROM ingestion_idempotency WHERE idempotency_key = $1) AS ledger_count`,
      [publicationKey]
    );
    expect(result.rows).toEqual([{ quote_count: "0", ledger_count: "0" }]);
  });

  it("rejects quote evidence from a different canonical context before ledger claim", async () => {
    const quote = publishedQuote("", { zipCode: "10001", memberships: [] }, 1000, "context-v1");
    const wrongEvidence = evidenceWrite({
      sourceVersion: quote.sourceVersion,
      quoteContext: { zipCode: "10001", memberships: ["member"] }
    });
    await evidence.save(wrongEvidence);
    quote.primaryEvidenceId = wrongEvidence.id;
    quote.evidenceRefs = [...quote.externalEvidenceRefs, wrongEvidence.id];

    await expect(quotes.commit({
      quote,
      publicationKey: quote.quoteId,
      quarantineKey: stableRecordId("quarantine", quote.sourceIdentityKey)
    })).rejects.toThrow(/primary evidence/i);
    const ledger = await db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM ingestion_idempotency WHERE idempotency_key = $1",
      [quote.quoteId]
    );
    expect(ledger.rows).toEqual([{ count: "0" }]);
  });
});
