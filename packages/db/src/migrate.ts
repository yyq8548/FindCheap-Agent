import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./client.js";

const migrationPath = fileURLToPath(new URL("../../../infra/migrations/0001_core.sql", import.meta.url));
const connectionString = process.env.DATABASE_URL ?? "postgresql://shopping:local-only@127.0.0.1:5432/shopping";
const db = createDatabase(connectionString);

try {
  await db.connect();
  await db.query(await readFile(migrationPath, "utf8"));
  console.log("Applied 0001_core.sql");
} finally {
  await db.close();
}
