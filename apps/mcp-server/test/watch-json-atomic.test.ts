import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import type * as FileSystem from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createJsonWatchStore, WatchStateConflictError } from "../src/watch-store.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof FileSystem>();
  return { ...actual, rm: vi.fn(actual.rm), rename: vi.fn(actual.rename) };
});
const now = "2026-09-06T12:00:00.000Z";
const spec = { query: "Private Dress Query", condition: "RESTOCKED" as const, identity: { gtin: "1234567890123" },
  conditionPreference: "ANY" as const, membershipIds: [], intervalMinutes: 60 };
const directories: string[] = [];
afterEach(async () => {
  vi.mocked(rm).mockReset(); vi.mocked(rename).mockReset();
  const actual = await vi.importActual<typeof FileSystem>("node:fs/promises");
  vi.mocked(rm).mockImplementation(actual.rm); vi.mocked(rename).mockImplementation(actual.rename);
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "findcheap-watch-atomic-"));
  directories.push(directory);
  return { directory, first: createJsonWatchStore(directory), second: createJsonWatchStore(directory) };
}

describe("atomic JSON Watch persistence", () => {
  it("deduplicates concurrent creation without extending the deadline", async () => {
    const { first, second } = await fixture();
    const [a, b] = await Promise.all([first.create(spec, now), second.create(spec, now)]);
    expect(a.watchId).toBe(b.watchId);
    expect(a.spec.expiresAt).toBe("2026-10-06T12:00:00.000Z");
    expect(await first.list()).toHaveLength(1);
  });

  it("allows only one concurrent cross-record Automation binding and reserves it after deletion", async () => {
    const { first, second } = await fixture();
    const a = await first.create(spec, now);
    const b = await second.create({ ...spec, query: "Other private query" }, now);
    const binding = { automationId: "synthetic-automation", schedulingState: "BOUND" as const };
    const results = await Promise.allSettled([first.save({ ...a, ...binding }), second.save({ ...b, ...binding })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const winner = (await first.list()).find(record => record.automationId !== undefined)!;
    const loser = winner.watchId === a.watchId ? b : a;
    expect(await first.delete(winner.watchId)).toBe(true);
    await expect(second.save({ ...loser, ...binding })).rejects.toBeInstanceOf(WatchStateConflictError);
    expect(await second.listPendingStops()).toMatchObject([{ watchId: winner.watchId, automationId: binding.automationId,
      reason: "DELETED", status: "STOP_REQUIRED" }]);
    await expect(first.save(winner)).rejects.toBeInstanceOf(WatchStateConflictError);
  });

  it("commits a data-free tombstone before unlink, survives unlink failure, and retries cleanup", async () => {
    const { first, second, directory } = await fixture();
    const created = await first.create(spec, now);
    const bound = await first.save({ ...created, automationId: "test-stop", schedulingState: "BOUND",
      lastObservation: { title: "Private product", merchantUrl: "https://private.example/products/test", zipCode: "33433" } });
    const actual = await vi.importActual<typeof FileSystem>("node:fs/promises");
    const target = join(directory, `${bound.watchId}.json`);
    let failed = false;
    vi.mocked(rm).mockImplementation(async (path, options) => {
      if (path === target && !failed) { failed = true; throw Object.assign(new Error("SYNTHETIC_UNLINK_FAILURE"), { code: "EACCES" }); }
      return actual.rm(path, options);
    });
    await expect(first.delete(bound.watchId)).rejects.toThrow("SYNTHETIC_UNLINK_FAILURE");
    expect(await readFile(target, "utf8")).toContain("Private product");
    expect(await second.get(bound.watchId)).toBeUndefined();
    expect(await second.list()).toEqual([]);
    await expect(second.save(bound)).rejects.toBeInstanceOf(WatchStateConflictError);
    const tombstone = JSON.parse(await readFile(join(directory, `${bound.watchId}.deleted.json`), "utf8")) as Record<string, unknown>;
    expect(Object.keys(tombstone).sort()).toEqual(["deletedAt", "stopIntent", "watchId"]);
    expect(Object.keys(tombstone.stopIntent as object).sort()).toEqual(["automationId", "reason", "requestedAt", "status", "watchId"]);
    expect(JSON.stringify(tombstone)).not.toMatch(/Private|merchantUrl|zipCode|spec|lastObservation/u);
    const pending = await second.listPendingStops();
    expect(pending).toHaveLength(1);
    expect(await second.delete(bound.watchId)).toBe(true);
    await expect(readFile(target, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await first.listPendingStops()).toEqual(pending);
  });

  it("preserves the old complete record if atomic publication fails", async () => {
    const { first, second, directory } = await fixture();
    const created = await first.create(spec, now);
    vi.mocked(rename).mockRejectedValueOnce(new Error("SYNTHETIC_RENAME_FAILURE"));
    await expect(first.save({ ...created, status: "PAUSED" })).rejects.toThrow("SYNTHETIC_RENAME_FAILURE");
    expect(await second.get(created.watchId)).toEqual(created);
    expect(await readdir(directory)).toEqual([`${created.watchId}.json`]);
    expect(await second.save({ ...created, status: "PAUSED" })).toMatchObject({ revision: 1, status: "PAUSED" });
  });

  it("reads a legacy revisionless file unchanged and allows exactly one update", async () => {
    const { first, directory } = await fixture();
    const created = await first.create(spec, now);
    const { revision: _revision, spec: createdSpec, ...rest } = created;
    const { expiresAt: _expiresAt, ...legacySpec } = createdSpec;
    const legacy = { ...rest, spec: legacySpec };
    const path = join(directory, `${created.watchId}.json`);
    const original = JSON.stringify(legacy);
    await writeFile(path, original);
    const loaded = (await first.get(created.watchId))!;
    expect(loaded.revision).toBeUndefined();
    expect(loaded.spec.expiresAt).toBeUndefined();
    expect(await readFile(path, "utf8")).toBe(original);
    expect(await first.save({ ...loaded, status: "PAUSED" })).toMatchObject({ revision: 1 });
    await expect(first.save(loaded)).rejects.toBeInstanceOf(WatchStateConflictError);
  });

  it.each(["corrupt", "oversized", "wrong-id"])("fails closed on a %s record", async kind => {
    const { first, directory } = await fixture();
    const created = await first.create(spec, now);
    const value = kind === "corrupt" ? "{" : kind === "oversized" ? " ".repeat(256 * 1024 + 1)
      : JSON.stringify({ ...created, watchId: "2e71d6f0-1f08-4f92-885c-ed42eb6f841e" });
    await writeFile(join(directory, `${created.watchId}.json`), value);
    await expect(first.get(created.watchId)).rejects.toThrow();
    await expect(first.create({ ...spec, query: "Different query" }, now)).rejects.toThrow();
  });

  it("does not steal an existing lock and bounds its wait", async () => {
    const { first, directory } = await fixture();
    const created = await first.create(spec, now);
    const path = join(directory, ".watch-store.lock");
    await writeFile(path, "unknown-owner");
    await expect(first.save({ ...created, status: "PAUSED" })).rejects.toThrow("WATCH_STORE_BUSY");
    expect(await readFile(path, "utf8")).toBe("unknown-owner");
    expect(await first.get(created.watchId)).toEqual(created);
  });
});
