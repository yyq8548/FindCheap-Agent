import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJsonWatchStore } from "../src/watch-store.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("JSON watch store", () => {
  it("persists, deduplicates, updates, and deletes watches across instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-watch-"));
    directories.push(directory);
    const first = createJsonWatchStore(directory);
    const spec = { query: "AirPods Pro", condition: "PRICE_BELOW" as const, threshold: 17_000, membershipIds: [], intervalMinutes: 60 };
    const created = await first.create(spec, "2026-08-18T12:00:00.000Z");
    const duplicate = await first.create(spec, "2026-08-18T12:01:00.000Z");
    expect(duplicate.watchId).toBe(created.watchId);

    const second = createJsonWatchStore(directory);
    expect(await second.get(created.watchId)).toEqual(created);
    await second.save({ ...created, status: "PAUSED", updatedAt: "2026-08-18T12:02:00.000Z" });
    expect((await first.list())[0]?.status).toBe("PAUSED");
    expect(await second.delete(created.watchId)).toBe(true);
    expect(await first.get(created.watchId)).toBeUndefined();
  });
});
