import { describe, expect, it, vi } from "vitest";

import type { QueryResultRow } from "pg";

import type { SqlExecutor } from "../src/client.js";
import { assertProductIdentityKeysReady } from "../src/product-identity-backfill.js";

describe("product identity key preflight", () => {
  it("does not query products when no enabled merchant can use Brand+MPN", async () => {
    const query = vi.fn();
    const db: SqlExecutor = {
      async query<Row extends QueryResultRow = QueryResultRow>() {
        query();
        return { rows: [] as Row[] };
      }
    };

    await expect(assertProductIdentityKeysReady(db, false)).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it("fails closed with an explicit apply command when legacy rows remain", async () => {
    const query = vi.fn();
    const db: SqlExecutor = {
      async query<Row extends QueryResultRow = QueryResultRow>() {
        query();
        return { rows: [{ missing_count: "3" }] as unknown as Row[] };
      }
    };

    await expect(assertProductIdentityKeysReady(db, true)).rejects.toEqual(
      expect.objectContaining({
        name: "ProductIdentityBackfillRequiredError",
        missingCount: 3,
        message: expect.stringMatching(
          /backfill required.*pnpm products:backfill-identity-keys -- --apply/i
        )
      })
    );
  });
});
