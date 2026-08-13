import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "./client.js";

const advisoryLockKey = 1_734_760_031;
const defaultMigrationsDir = fileURLToPath(new URL("../../../infra/migrations/", import.meta.url));

export type MigrationResult = { applied: string[]; skipped: string[] };

export async function runMigrations(
  db: Database,
  migrationsDir = defaultMigrationsDir
): Promise<MigrationResult> {
  const filenames = (await readdir(migrationsDir))
    .filter((filename) => /^\d+_[a-z0-9_-]+\.sql$/i.test(filename))
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const migrations = await Promise.all(
    filenames.map(async (filename) => {
      const sql = await readFile(resolve(migrationsDir, filename), "utf8");
      const portableSql = sql.replaceAll("\r\n", "\n");
      return {
        filename,
        sql,
        checksum: createHash("sha256").update(portableSql).digest("hex")
      };
    })
  );

  return db.transaction(async (transaction) => {
    await transaction.query("SELECT pg_advisory_xact_lock($1)", [advisoryLockKey]);
    await transaction.query(
      `CREATE TABLE IF NOT EXISTS commerce_schema_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`
    );
    const ledger = await transaction.query<{ filename: string; checksum: string }>(
      "SELECT filename, checksum FROM commerce_schema_migrations"
    );
    const appliedChecksums = new Map(ledger.rows.map((row) => [row.filename, row.checksum]));
    const result: MigrationResult = { applied: [], skipped: [] };

    for (const migration of migrations) {
      const appliedChecksum = appliedChecksums.get(migration.filename);
      if (appliedChecksum !== undefined) {
        if (appliedChecksum !== migration.checksum) {
          throw new Error(`Migration checksum mismatch: ${migration.filename}`);
        }
        result.skipped.push(migration.filename);
        continue;
      }

      await transaction.query(migration.sql);
      await transaction.query(
        "INSERT INTO commerce_schema_migrations (filename, checksum) VALUES ($1, $2)",
        [migration.filename, migration.checksum]
      );
      result.applied.push(migration.filename);
    }

    return result;
  });
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL ?? "postgresql://shopping:local-only@127.0.0.1:5432/shopping";
  const db = createDatabase(connectionString);
  try {
    await db.connect();
    const result = await runMigrations(db);
    for (const filename of result.applied) console.log(`Applied ${filename}`);
    for (const filename of result.skipped) console.log(`Already applied ${filename}`);
  } finally {
    await db.close();
  }
}

const entryPath = process.argv[1];
if (entryPath && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  await main();
}
