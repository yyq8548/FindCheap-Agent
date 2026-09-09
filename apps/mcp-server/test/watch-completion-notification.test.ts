import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJsonWatchStore, createMemoryWatchStore, WatchRecordSchema, WatchStateConflictError } from "../src/watch-store.js";

const now = "2026-09-09T15:00:00.000Z";
const spec = { query: "Exact restock product", condition: "RESTOCKED" as const,
  identity: { gtin: "1234567890123" }, conditionPreference: "NEW" as const, membershipIds: [], intervalMinutes: 60 };
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe.each(["memory", "json"])("%s completion notification persistence", kind => {
  async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-completion-notification-"));
    directories.push(directory);
    const store = kind === "json" ? createJsonWatchStore(directory) : createMemoryWatchStore();
    const created = await store.create(spec, now);
    const eventId = randomUUID();
    const notification = { eventId, createdAt: now, status: "DELIVERY_UNCONFIRMED" as const,
      message: "Exact restock product was observed in stock.",
      observation: { checkedAt: now, availability: "IN_STOCK", title: "Exact restock product" } };
    return { directory, store, created, notification,
      completed: { ...created, status: "COMPLETED" as const, completionEventId: eventId, completionNotification: notification } };
  }

  it("retains the original event for recovery and deletes its private payload with the Watch", async () => {
    const { directory, store, completed, notification } = await fixture();
    await store.save(completed);
    const reader = kind === "json" ? createJsonWatchStore(directory) : store;
    expect(await reader.get(completed.watchId)).toMatchObject({ completionNotification: notification });
    expect(await reader.delete(completed.watchId)).toBe(true);
    expect(await store.get(completed.watchId)).toBeUndefined();
    expect(JSON.stringify(await store.listPendingStops())).not.toContain(notification.message);
    await expect(store.save(completed)).rejects.toBeInstanceOf(WatchStateConflictError);
  });

  it("rejects deleting or replacing a committed event even with the current revision", async () => {
    const { store, completed } = await fixture();
    const saved = await store.save(completed);
    const { completionNotification: _notification, ...removed } = saved;
    await expect(store.save(removed)).rejects.toBeInstanceOf(WatchStateConflictError);
    await expect(store.save({ ...saved, completionNotification: { ...completed.completionNotification,
      message: "A different product is in stock." } })).rejects.toBeInstanceOf(WatchStateConflictError);
    expect(await store.get(saved.watchId)).toEqual(saved);
  });

  it("does not allow attaching an invented event to a legacy completion", async () => {
    const { store, completed } = await fixture();
    const { completionNotification, ...legacy } = completed;
    const saved = await store.save(legacy);
    await expect(store.save({ ...saved, completionNotification })).rejects.toBeInstanceOf(WatchStateConflictError);
    expect(await store.get(saved.watchId)).toEqual(saved);
  });

  it("rejects events outside their one-shot completion and event ID", async () => {
    const { completed } = await fixture();
    expect(WatchRecordSchema.safeParse(completed).success).toBe(true);
    expect(WatchRecordSchema.safeParse({ ...completed, status: "ACTIVE" }).success).toBe(false);
    expect(WatchRecordSchema.safeParse({ ...completed, spec: { ...spec, condition: "IN_STOCK" } }).success).toBe(false);
    expect(WatchRecordSchema.safeParse({ ...completed, completionEventId: randomUUID() }).success).toBe(false);
    expect(WatchRecordSchema.safeParse({ ...completed, completionNotification: {
      ...completed.completionNotification, status: "DELIVERED" } }).success).toBe(false);
  });
});
