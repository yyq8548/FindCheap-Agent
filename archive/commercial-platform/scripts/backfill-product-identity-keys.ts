import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabase } from "../packages/db/src/client.js";
import {
  backfillProductIdentityKeys,
  DEFAULT_PRODUCT_IDENTITY_BACKFILL_BATCH_SIZE,
  MAX_PRODUCT_IDENTITY_BACKFILL_BATCH_SIZE,
  type ProductIdentityBackfillOptions
} from "../packages/db/src/product-identity-backfill.js";

export function parseProductIdentityBackfillArgs(args: readonly string[]): Required<ProductIdentityBackfillOptions> {
  let apply = false;
  let batchSize = DEFAULT_PRODUCT_IDENTITY_BACKFILL_BATCH_SIZE;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--" && index === 0) continue;
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (argument === "--batch-size") {
      const value = args[index + 1];
      if (value === undefined) throw new Error("--batch-size requires a value");
      batchSize = parseBatchSize(value);
      index += 1;
      continue;
    }
    if (argument?.startsWith("--batch-size=")) {
      batchSize = parseBatchSize(argument.slice("--batch-size=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${argument ?? ""}`);
  }

  return { apply, batchSize };
}

function parseBatchSize(value: string): number {
  const batchSize = Number(value);
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_PRODUCT_IDENTITY_BACKFILL_BATCH_SIZE
  ) {
    throw new Error(
      `Product identity backfill batch size must be between 1 and ${MAX_PRODUCT_IDENTITY_BACKFILL_BATCH_SIZE}`
    );
  }
  return batchSize;
}

async function main(): Promise<void> {
  const options = parseProductIdentityBackfillArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL ??
    "postgresql://shopping:local-only@127.0.0.1:5432/shopping";
  const db = createDatabase(connectionString);
  try {
    await db.connect();
    const result = await backfillProductIdentityKeys(db, options);
    console.log(JSON.stringify(result));
    if (result.dryRun) {
      console.log("Dry run only. Re-run with --apply to update product identity keys.");
    }
  } finally {
    await db.close();
  }
}

const entryPath = process.argv[1];
if (entryPath && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  await main();
}
