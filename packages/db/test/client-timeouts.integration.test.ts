import { describe, expect, it } from "vitest";

import { createDatabase } from "../src/client.js";

const databaseUrl = process.env.DATABASE_URL ??
  "postgresql://shopping:local-only@127.0.0.1:5432/shopping";

describe("database resource bounds", () => {
  it("cancels a slow statement at the server boundary", async () => {
    const db = createDatabase(databaseUrl, {
      statementTimeoutMs: 50,
      queryTimeoutMs: 500,
      connectionTimeoutMs: 500
    });
    try {
      await db.connect();
      const startedAt = Date.now();
      await expect(db.query("SELECT pg_sleep(0.2)")).rejects.toThrow(/statement timeout/i);
      expect(Date.now() - startedAt).toBeLessThan(500);
    } finally {
      await db.close();
    }
  });

  it("cancels a slow client query before an unbounded wait", async () => {
    const db = createDatabase(databaseUrl, {
      statementTimeoutMs: 500,
      queryTimeoutMs: 50,
      connectionTimeoutMs: 500
    });
    try {
      await db.connect();
      const startedAt = Date.now();
      await expect(db.query("SELECT pg_sleep(0.2)")).rejects.toThrow(/query read timeout/i);
      expect(Date.now() - startedAt).toBeLessThan(500);
    } finally {
      await db.close();
    }
  });
});
