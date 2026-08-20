import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/client.js";
import { runMigrations } from "../src/migrate.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://shopping:local-only@127.0.0.1:5432/shopping";
const db = createDatabase(databaseUrl);
const filename = "9001_migration_runner_probe.sql";
let migrationsDir: string;

describe("migration runner", () => {
  beforeAll(async () => {
    await db.connect();
    migrationsDir = await mkdtemp(join(tmpdir(), "commerce-migrations-"));
    await db.query("DROP TABLE IF EXISTS migration_runner_probe");
    await db.query("CREATE TABLE IF NOT EXISTS commerce_schema_migrations (filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    await db.query("DELETE FROM commerce_schema_migrations WHERE filename = $1", [filename]);
  });

  afterAll(async () => {
    await db.query("DROP TABLE IF EXISTS migration_runner_probe");
    await db.query("DELETE FROM commerce_schema_migrations WHERE filename = $1", [filename]);
    await db.close();
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it("applies once, skips the second run, and safely rejects checksum drift", async () => {
    const migrationPath = join(migrationsDir, filename);
    await writeFile(migrationPath, "CREATE TABLE migration_runner_probe (id integer PRIMARY KEY);\n", "utf8");

    await expect(runMigrations(db, migrationsDir)).resolves.toEqual({ applied: [filename], skipped: [] });
    await expect(runMigrations(db, migrationsDir)).resolves.toEqual({ applied: [], skipped: [filename] });

    const before = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'migration_runner_probe' ORDER BY ordinal_position"
    );
    const ledgerBefore = await db.query<{ checksum: string }>(
      "SELECT checksum FROM commerce_schema_migrations WHERE filename = $1",
      [filename]
    );

    await writeFile(
      migrationPath,
      "CREATE TABLE migration_runner_probe (id integer PRIMARY KEY, drift text);\n",
      "utf8"
    );
    await expect(runMigrations(db, migrationsDir)).rejects.toThrow(/checksum mismatch/i);

    const after = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'migration_runner_probe' ORDER BY ordinal_position"
    );
    const ledgerAfter = await db.query<{ checksum: string }>(
      "SELECT checksum FROM commerce_schema_migrations WHERE filename = $1",
      [filename]
    );
    expect(before.rows).toEqual([{ column_name: "id" }]);
    expect(after.rows).toEqual(before.rows);
    expect(ledgerAfter.rows).toEqual(ledgerBefore.rows);
  });

  it("records the ingestion, offer-revision, quote-snapshot, and source-retirement migrations", async () => {
    await runMigrations(db);

    const result = await db.query<{ filename: string }>(
      `SELECT filename FROM commerce_schema_migrations
       WHERE filename = ANY($1::text[]) ORDER BY filename`,
      [[
        "0002_ingestion_pipeline.sql",
        "0004_offer_promotion_revisions.sql",
        "0005_promotion_quote_snapshots.sql",
        "0006_remove_retired_source_types.sql"
      ]]
    );

    expect(result.rows).toEqual([
      { filename: "0002_ingestion_pipeline.sql" },
      { filename: "0004_offer_promotion_revisions.sql" },
      { filename: "0005_promotion_quote_snapshots.sql" },
      { filename: "0006_remove_retired_source_types.sql" }
    ]);
  });
});
