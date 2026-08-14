import { describe, expect, it, vi } from "vitest";

import type { Database } from "../../../packages/db/src/client.js";
import { startCommerceRuntime } from "../src/runtime.js";

describe("Commerce API runtime", () => {
  it("does not create a database or listener when unconfigured", async () => {
    const createDb = vi.fn();
    const runtime = await startCommerceRuntime({}, createDb);
    expect(runtime.status).toBe("disabled");
    expect(createDb).not.toHaveBeenCalled();
    await runtime.close();
  });

  it("closes the database when startup connectivity fails", async () => {
    const close = vi.fn(async () => {});
    const db = {
      connect: vi.fn(async () => { throw new Error("connection failed"); }),
      close,
      query: vi.fn(),
      transaction: vi.fn()
    } as unknown as Database;
    await expect(startCommerceRuntime({
      DATABASE_URL: "postgresql://shopping:local-only@127.0.0.1:5432/shopping"
    }, () => db)).rejects.toThrow("connection failed");
    expect(close).toHaveBeenCalledOnce();
  });
});
