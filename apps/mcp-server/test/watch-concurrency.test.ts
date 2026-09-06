import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJsonWatchStore, createMemoryWatchStore, WatchStateConflictError } from "../src/watch-store.js";

const now = "2026-09-06T12:00:00.000Z";
const spec = { query: "Black Lace Dress", condition: "RESTOCKED" as const, identity: { gtin: "1234567890123" },
  conditionPreference: "ANY" as const, membershipIds: [], intervalMinutes: 60 };
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("Watch optimistic persistence", () => {
  it.each(["memory", "json"])("creates a fresh explicit Watch after completion in %s without releasing its old Automation", async (kind) => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-watch-completed-"));
    directories.push(directory);
    const store = kind === "memory" ? createMemoryWatchStore() : createJsonWatchStore(directory);
    const created = await store.create(spec, now);
    await store.save({ ...created, status: "COMPLETED", automationId: "completed-automation", schedulingState: "BOUND",
      stopIntent: { watchId: created.watchId, automationId: "completed-automation", reason: "RESTOCKED", requestedAt: now, status: "STOP_REQUIRED" } });
    const fresh = await store.create(spec, now);
    expect(fresh.watchId).not.toBe(created.watchId);
    expect(fresh.status).toBe("ACTIVE");
    await expect(store.save({ ...fresh, automationId: "completed-automation", schedulingState: "BOUND" })).rejects.toBeInstanceOf(WatchStateConflictError);
  });
  it("commits exactly one save through two JSON instances sharing the same revision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-watch-cas-"));
    directories.push(directory);
    const a = createJsonWatchStore(directory);
    const b = createJsonWatchStore(directory);
    const created = await a.create(spec, now);
    const results = await Promise.allSettled([a.save({ ...created, status: "PAUSED" }), b.save({ ...created, lastCheckedAt: now })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")[0]).toMatchObject({ reason: new WatchStateConflictError() });
    expect(await b.get(created.watchId)).toMatchObject({ revision: 1 });
  });
  it("returns detached memory records and cannot recreate a deleted Watch", async () => {
    const store = createMemoryWatchStore();
    const created = await store.create(spec, now);
    created.spec.query = "Changed outside persistence";
    expect((await store.get(created.watchId))!.spec.query).toBe("Black Lace Dress");
    const listed = (await store.list())[0]!;
    listed.status = "PAUSED";
    expect((await store.get(created.watchId))!.status).toBe("ACTIVE");
    expect(await store.delete(created.watchId)).toBe(true);
    await expect(store.save(listed)).rejects.toBeInstanceOf(WatchStateConflictError);
    expect(await store.get(created.watchId)).toBeUndefined();
  });

  it("reserves an Automation identifier across concurrent memory binding and deletion", async () => {
    const store = createMemoryWatchStore();
    const a = await store.create(spec, now);
    const b = await store.create({ ...spec, query: "Other Dress" }, now);
    const binding = { automationId: "synthetic-automation", schedulingState: "BOUND" as const };
    const results = await Promise.allSettled([store.save({ ...a, ...binding }), store.save({ ...b, ...binding })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    await store.delete(a.watchId);
    await expect(store.save({ ...b, ...binding })).rejects.toBeInstanceOf(WatchStateConflictError);
    expect(await store.listPendingStops()).toMatchObject([{ watchId: a.watchId, automationId: binding.automationId,
      reason: "DELETED", status: "STOP_REQUIRED" }]);
    expect(await store.list()).toHaveLength(1);
  });

  it("does not revive terminal memory state or discard an unresolved stop", async () => {
    const store = createMemoryWatchStore();
    const created = await store.create(spec, now);
    const completed = await store.save({ ...created, status: "COMPLETED", completionEventId: randomUUID() });
    await expect(store.save({ ...completed, status: "ACTIVE" })).rejects.toBeInstanceOf(WatchStateConflictError);
    const { completionEventId: _eventId, ...lostEvent } = completed;
    await expect(store.save(lostEvent)).rejects.toBeInstanceOf(WatchStateConflictError);
    await expect(store.save({ ...completed, completionEventId: randomUUID() })).rejects.toBeInstanceOf(WatchStateConflictError);
    const bound = await store.create({ ...spec, query: "Other Dress" }, now);
    const paused = await store.save({ ...bound, status: "PAUSED", automationId: "test-stop", schedulingState: "BOUND",
      stopIntent: { watchId: bound.watchId, automationId: "test-stop", reason: "PAUSED", requestedAt: now, status: "STOP_REQUIRED" } });
    const { stopIntent: _stopIntent, ...lostStop } = paused;
    await expect(store.save(lostStop)).rejects.toBeInstanceOf(WatchStateConflictError);
    await expect(store.save({ ...paused, status: "ACTIVE" })).rejects.toBeInstanceOf(WatchStateConflictError);
  });
  it("commits only one memory update from the same revision, preserving pause", async () => {
    const store = createMemoryWatchStore();
    const created = await store.create(spec, now);
    const results = await Promise.allSettled([
      store.save({ ...created, status: "PAUSED" }),
      store.save({ ...created, lastCheckedAt: now })
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: "fulfilled", value: { revision: 1, status: "PAUSED" } });
    expect(await store.get(created.watchId)).toMatchObject({ revision: 1, status: "PAUSED" });
  });
});
