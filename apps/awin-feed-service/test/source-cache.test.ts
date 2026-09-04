import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { acquireRefreshLock, recordSourceRequest, sourceFeedKeyHash } from "../src/source-cache.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Awin source request ledger", () => {
  it("allows no more than five downloads for one Feed in a rolling hour", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-awin-ledger-"));
    directories.push(directory);
    const path = join(directory, "requests.json");
    const hash = sourceFeedKeyHash("20282:F102");
    const started = Date.parse("2026-08-25T01:00:00.000Z");

    for (let request = 0; request < 5; request += 1) {
      await expect(recordSourceRequest(path, hash, new Date(started + request * 1_000))).resolves.toBe(true);
    }
    await expect(recordSourceRequest(path, hash, new Date(started + 5_000))).resolves.toBe(false);
    await expect(recordSourceRequest(path, hash, new Date(started + 60 * 60 * 1_000 + 1))).resolves.toBe(true);
  });

  it("keeps a live refresh exclusive and reclaims an abandoned lease after one minute", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-awin-lock-"));
    directories.push(directory);
    const path = join(directory, "refresh.lock");
    const started = new Date("2026-08-25T01:00:00.000Z");
    await mkdir(directory, { recursive: true });
    await writeFile(path, JSON.stringify({ token: "abandoned", startedAt: started.toISOString() }));
    await utimes(path, started, started);

    await expect(acquireRefreshLock(path, new Date(started.getTime() + 59_000)))
      .rejects.toThrow("already running");
    const release = await acquireRefreshLock(path, new Date(started.getTime() + 60_001));
    await expect(acquireRefreshLock(path, new Date(started.getTime() + 60_002)))
      .rejects.toThrow("already running");
    await release();
  });
});
