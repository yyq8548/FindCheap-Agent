import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShoppingServer } from "../src/server.js";
import { createMemoryWatchStore, type WatchStore } from "../src/watch-store.js";

const checkedAt = "2026-09-06T12:00:00.000Z";
const spec = { query: "Black Lace Dress", condition: "RESTOCKED" as const, identity: { gtin: "1234567890123" },
  conditionPreference: "ANY" as const, membershipIds: [], intervalMinutes: 60 };
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

async function harness(store: WatchStore = createMemoryWatchStore()) {
  const search = vi.fn(async () => { throw new Error("NO_SOURCE_CALL_EXPECTED"); });
  const server = createShoppingServer({ search }, undefined, { watches: store, now: () => new Date(checkedAt) });
  const client = new Client({ name: "watch-local-lifecycle", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  cleanup.push(async () => { await client.close(); await server.close(); });
  return { store, search, call: (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) };
}

describe("Watch local lifecycle and unverified scheduler handoff", () => {
  it("returns the same undelivered event for recovery without re-alerting or acknowledging delivery", async () => {
    const { store, search, call } = await harness();
    const created = await store.create(spec, checkedAt);
    const completionEventId = randomUUID();
    const completionNotification = { eventId: completionEventId, createdAt: checkedAt,
      status: "DELIVERY_UNCONFIRMED" as const, message: "Black Lace Dress was observed in stock.",
      observation: { availability: "IN_STOCK", checkedAt } };
    const saved = await store.save({ ...created, status: "COMPLETED", completionEventId, completionNotification });
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await call("check_watch", { watchId: saved.watchId });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ status: "COMPLETED", completionEventId, completionNotification });
      expect(JSON.stringify(result.content)).not.toContain(completionNotification.message);
    }
    const listed = await call("list_watches");
    expect(listed.structuredContent).toMatchObject({ watches: [{ completionEventId, notificationStatus: "DELIVERY_UNCONFIRMED" }] });
    expect(JSON.stringify(listed)).not.toContain(completionNotification.message);
    expect(await store.get(saved.watchId)).toEqual(saved);
    await call("delete_watch", { watchId: saved.watchId });
    expect(JSON.stringify(await call("check_watch", { watchId: saved.watchId }))).not.toContain(completionNotification.message);
    expect(search).not.toHaveBeenCalled();
  });

  it("exposes one completed event without rechecking, rebinding or resuming", async () => {
    const { store, search, call } = await harness();
    const created = await store.create(spec, checkedAt);
    const completionEventId = randomUUID();
    const stopIntent = { watchId: created.watchId, automationId: "completed-host-id", reason: "RESTOCKED" as const,
      requestedAt: checkedAt, status: "STOP_REQUIRED" as const };
    const completed = await store.save({ ...created, status: "COMPLETED", completionEventId, automationId: stopIntent.automationId,
      schedulingState: "BOUND", stopIntent });
    for (let attempt = 0; attempt < 2; attempt++) expect((await call("check_watch", { watchId: created.watchId })).structuredContent)
      .toMatchObject({ status: "COMPLETED", completionEventId, stopIntent });
    expect((await call("list_watches")).structuredContent).toMatchObject({
      watches: [{ status: "COMPLETED", monitoringStatus: "COMPLETED", completionEventId, stopIntent }], pendingStops: [stopIntent]
    });
    expect((await call("pause_watch", { watchId: created.watchId, paused: false })).structuredContent)
      .toMatchObject({ status: "COMPLETED", stopIntent });
    expect((await call("bind_watch_automation", { watchId: created.watchId, automationId: stopIntent.automationId })).structuredContent)
      .toMatchObject({ status: "COMPLETED", stopIntent });
    expect(await store.get(created.watchId)).toEqual(completed);
    expect(search).not.toHaveBeenCalled();
  });
  it("keeps deleted stop handoffs observable and prevents reuse without leaking shopping data", async () => {
    const { store, search, call } = await harness();
    const created = await store.create(spec, checkedAt);
    await store.save({ ...created, automationId: "deleted-host-id", schedulingState: "BOUND" });
    const removed = await call("delete_watch", { watchId: created.watchId });
    expect(removed.structuredContent).toMatchObject({ status: "DELETED", deleted: true,
      stopIntent: { watchId: created.watchId, automationId: "deleted-host-id", reason: "DELETED", status: "STOP_REQUIRED" } });
    const repeated = await call("delete_watch", { watchId: created.watchId });
    expect(repeated.structuredContent).toEqual(removed.structuredContent);
    const check = await call("check_watch", { watchId: created.watchId });
    expect(check.structuredContent).toMatchObject({ status: "NOT_FOUND", stopIntent: expect.any(Object) });
    const list = await call("list_watches");
    expect(list.structuredContent).toMatchObject({ watches: [], pendingStops: [expect.objectContaining({ reason: "DELETED" })] });
    expect(JSON.stringify([removed, repeated, check, list])).not.toContain(spec.query);
    expect(await store.get(created.watchId)).toBeUndefined();
    const fresh = await store.create(spec, checkedAt);
    expect((await call("bind_watch_automation", { watchId: fresh.watchId, automationId: "deleted-host-id" })).structuredContent)
      .toMatchObject({ status: "AUTOMATION_ALREADY_BOUND" });
    expect(search).not.toHaveBeenCalled();
  });
  it("rejects explicit mismatched Automation IDs without any local mutation", async () => {
    const { store, call } = await harness();
    const created = await store.create(spec, checkedAt);
    const bound = await store.save({ ...created, automationId: "actual-recorded-id", schedulingState: "BOUND" });
    for (const name of ["pause_watch", "delete_watch"]) {
      const result = await call(name, { watchId: created.watchId, automationId: "different-id", ...(name === "pause_watch" ? { paused: true } : {}) });
      expect(result.structuredContent).toMatchObject({ status: "AUTOMATION_SYNC_REQUIRED", automationId: "actual-recorded-id" });
      expect(JSON.stringify(result.content)).toContain("binding mismatch");
      expect(await store.get(created.watchId)).toEqual(bound);
      expect(await store.listPendingStops()).toEqual([]);
    }
  });
  it("allows ordinary unbound pause/resume while leaving scheduling pending", async () => {
    const { store, call, search } = await harness();
    const created = await store.create(spec, checkedAt);
    expect((await call("pause_watch", { watchId: created.watchId, paused: true })).structuredContent).toMatchObject({ status: "PAUSED" });
    expect((await call("pause_watch", { watchId: created.watchId, paused: false })).structuredContent).toMatchObject({ status: "ACTIVE" });
    expect(await store.get(created.watchId)).toMatchObject({ status: "ACTIVE", schedulingState: "PENDING" });
    expect((await call("check_watch", { watchId: created.watchId })).structuredContent).toMatchObject({ status: "NOT_SCHEDULED" });
    expect(await store.listPendingStops()).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });
  it("locally pauses or deletes unbound legacy rules but refuses resume without reconciliation", async () => {
    const { store, call, search } = await harness();
    const created = await store.create(spec, checkedAt);
    const { schedulingState: _schedulingState, ...legacy } = created;
    await store.save(legacy);
    expect((await call("pause_watch", { watchId: created.watchId, paused: true })).structuredContent).toMatchObject({ status: "PAUSED" });
    const paused = await store.get(created.watchId);
    expect((await call("pause_watch", { watchId: created.watchId, paused: false })).structuredContent).toMatchObject({ status: "AUTOMATION_SYNC_REQUIRED" });
    expect(await store.get(created.watchId)).toEqual(paused);
    expect((await call("delete_watch", { watchId: created.watchId })).structuredContent).toMatchObject({ status: "DELETED", deleted: true });
    expect(await store.get(created.watchId)).toBeUndefined();
    expect(search).not.toHaveBeenCalled();
  });
  it("binding a locally paused rule requests a stop and does not count as host acknowledgement", async () => {
    const { store, call } = await harness();
    const created = await store.create(spec, checkedAt);
    await store.save({ ...created, status: "PAUSED" });
    const bound = await call("bind_watch_automation", { watchId: created.watchId, automationId: "existing-host-id" });
    expect(bound.structuredContent).toMatchObject({ status: "PAUSED", stopIntent: { reason: "PAUSED", status: "STOP_REQUIRED" } });
    expect(JSON.stringify(bound.content)).toContain("unverified");
    const unchanged = await store.get(created.watchId);
    expect((await call("bind_watch_automation", { watchId: created.watchId, automationId: "existing-host-id" })).structuredContent)
      .toMatchObject({ status: "AUTOMATION_SYNC_REQUIRED", stopIntent: unchanged!.stopIntent });
    expect(await store.get(created.watchId)).toEqual(unchanged);
  });
  it("expires a bound rule before attempted resume and retains its pending stop", async () => {
    const { store, search, call } = await harness();
    const created = await store.create({ ...spec, expiresAt: checkedAt }, "2026-09-05T12:00:00.000Z");
    await store.save({ ...created, automationId: "expired-host-id", schedulingState: "BOUND" });
    const resumed = await call("pause_watch", { watchId: created.watchId, paused: false });
    expect(resumed.structuredContent).toMatchObject({ status: "EXPIRED", stopIntent: { reason: "EXPIRED", status: "STOP_REQUIRED" } });
    const expired = await store.get(created.watchId);
    expect((await call("pause_watch", { watchId: created.watchId, paused: false })).structuredContent).toEqual(resumed.structuredContent);
    expect(await store.get(created.watchId)).toEqual(expired);
    expect(search).not.toHaveBeenCalled();
  });
  it("pauses a bound Watch locally without requiring an Automation acknowledgement and refuses pending-stop resume", async () => {
    const { store, search, call } = await harness();
    const created = await store.create(spec, checkedAt);
    const bound = await store.save({ ...created, automationId: "synthetic-host-id", schedulingState: "BOUND" });
    const paused = await call("pause_watch", { watchId: created.watchId, paused: true });
    expect(paused.structuredContent).toMatchObject({ status: "PAUSED", stopIntent: {
      watchId: created.watchId, automationId: "synthetic-host-id", reason: "PAUSED", status: "STOP_REQUIRED"
    } });
    expect(JSON.stringify(paused.content)).toContain("unverified");
    const saved = await store.get(created.watchId);
    expect(saved).toMatchObject({ status: "PAUSED", revision: bound.revision! + 1 });
    const resumed = await call("pause_watch", { watchId: created.watchId, paused: false, automationId: "synthetic-host-id" });
    expect(resumed.structuredContent).toMatchObject({ status: "AUTOMATION_SYNC_REQUIRED", stopIntent: saved!.stopIntent });
    expect(await store.get(created.watchId)).toEqual(saved);
    expect(search).not.toHaveBeenCalled();
  });
});
