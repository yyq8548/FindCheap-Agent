import { normalizeToken } from "../../product-identity/src/index.js";
import type { Database, SqlExecutor } from "./client.js";

export const DEFAULT_PRODUCT_IDENTITY_BACKFILL_BATCH_SIZE = 100;
export const MAX_PRODUCT_IDENTITY_BACKFILL_BATCH_SIZE = 1_000;
export const PRODUCT_IDENTITY_BACKFILL_COMMAND =
  "pnpm products:backfill-identity-keys -- --apply";

type MissingCountRow = { missing_count: string };
type ProductIdentityRow = {
  id: string;
  brand: string;
  manufacturer_part_number: string;
  updated_at: string;
};

export type ProductIdentityBackfillOptions = {
  apply?: boolean;
  batchSize?: number;
};

export type ProductIdentityBackfillResult = {
  dryRun: boolean;
  scanned: number;
  updated: number;
  remaining: number;
};

export class ProductIdentityBackfillRequiredError extends Error {
  readonly missingCount: number;

  constructor(missingCount: number) {
    super(
      `Product identity key backfill required: ${missingCount} products with manufacturer part numbers ` +
      `have missing identity keys. Run "${PRODUCT_IDENTITY_BACKFILL_COMMAND}" before enabling Brand+MPN matching.`
    );
    this.name = "ProductIdentityBackfillRequiredError";
    this.missingCount = missingCount;
  }
}

export async function countProductsMissingIdentityKeys(db: SqlExecutor): Promise<number> {
  const result = await db.query<MissingCountRow>(
    `SELECT count(*)::text AS missing_count
     FROM products
     WHERE manufacturer_part_number IS NOT NULL
       AND (NULLIF(btrim(identity_brand_key), '') IS NULL
         OR NULLIF(btrim(identity_mpn_key), '') IS NULL)`
  );
  const value = Number(result.rows[0]?.missing_count ?? "0");
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid product identity backfill count returned by the database");
  }
  return value;
}

export async function assertProductIdentityKeysReady(
  db: SqlExecutor,
  brandMpnMatchingRequired: boolean
): Promise<void> {
  if (!brandMpnMatchingRequired) return;

  const missingCount = await countProductsMissingIdentityKeys(db);
  if (missingCount > 0) throw new ProductIdentityBackfillRequiredError(missingCount);
}

export async function backfillProductIdentityKeys(
  db: Database,
  options: ProductIdentityBackfillOptions = {}
): Promise<ProductIdentityBackfillResult> {
  const batchSize = options.batchSize ?? DEFAULT_PRODUCT_IDENTITY_BACKFILL_BATCH_SIZE;
  assertValidBatchSize(batchSize);

  const initialMissing = await countProductsMissingIdentityKeys(db);
  if (options.apply !== true) {
    return { dryRun: true, scanned: initialMissing, updated: 0, remaining: initialMissing };
  }

  let scanned = 0;
  let updated = 0;
  while (true) {
    const batch = await backfillBatch(db, batchSize);
    scanned += batch.scanned;
    updated += batch.updated;
    if (batch.scanned === 0) break;
  }

  const remaining = await countProductsMissingIdentityKeys(db);
  if (remaining > 0) {
    throw new Error(
      `Product identity key backfill stopped with ${remaining} products remaining; retry the apply command.`
    );
  }
  return { dryRun: false, scanned, updated, remaining };
}

export function assertValidBatchSize(batchSize: number): void {
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_PRODUCT_IDENTITY_BACKFILL_BATCH_SIZE
  ) {
    throw new Error(
      `Product identity backfill batch size must be between 1 and ${MAX_PRODUCT_IDENTITY_BACKFILL_BATCH_SIZE}`
    );
  }
}

async function backfillBatch(
  db: Database,
  batchSize: number
): Promise<{ scanned: number; updated: number }> {
  return db.transaction(async (transaction) => {
    const selected = await transaction.query<ProductIdentityRow>(
      `SELECT id, brand, manufacturer_part_number, updated_at::text AS updated_at
       FROM products
       WHERE manufacturer_part_number IS NOT NULL
         AND (NULLIF(btrim(identity_brand_key), '') IS NULL
           OR NULLIF(btrim(identity_mpn_key), '') IS NULL)
       ORDER BY id COLLATE "C"
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [batchSize]
    );

    let updated = 0;
    for (const product of selected.rows) {
      const brandKey = normalizeToken(product.brand);
      const mpnKey = normalizeToken(product.manufacturer_part_number);
      if (brandKey.length === 0 || mpnKey.length === 0) {
        throw new Error(`Cannot derive non-empty identity keys for product ${product.id}`);
      }

      const result = await transaction.query<{ id: string }>(
        `UPDATE products
         SET identity_brand_key = $2, identity_mpn_key = $3
         WHERE id = $1
           AND updated_at = $4::timestamptz
           AND brand = $5
           AND manufacturer_part_number = $6
           AND (NULLIF(btrim(identity_brand_key), '') IS NULL
             OR NULLIF(btrim(identity_mpn_key), '') IS NULL)
         RETURNING id`,
        [
          product.id,
          brandKey,
          mpnKey,
          product.updated_at,
          product.brand,
          product.manufacturer_part_number
        ]
      );
      if (result.rows.length !== 1) {
        throw new Error(`Product ${product.id} changed during identity backfill; retry the apply command`);
      }
      updated += result.rows.length;
    }

    return { scanned: selected.rows.length, updated };
  });
}
