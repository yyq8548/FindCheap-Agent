import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TaskScope } from "../src/task-scope.js";
import type { TaskStateStore } from "../src/task-state-store.js";

function memoryStore(): TaskStateStore {
  const records = new Map<string, { revision: number; data: Record<string, unknown> }>();
  return { load: id => structuredClone(records.get(id) ?? { revision: 0, data: {} }),
    save(id, expected, data) {
      if ((records.get(id)?.revision ?? 0) !== expected) throw new Error("TASK_STATE_CONFLICT");
      records.set(id, { revision: expected + 1, data: structuredClone(data) }); return expected + 1;
    }, revision: id => records.get(id)?.revision ?? 0,
    clear(id, retained = {}) { const revision = (records.get(id)?.revision ?? 0) + 1; records.set(id, { revision, data: structuredClone(retained) }); return revision; }, close() {} };
}
const extra = (threadId: string) => ({ _meta: { threadId } });
const codec = { encode: (value: Map<string, string>) => [...value], decode: (value: unknown) => new Map(value as [string, string][]) };
describe("trusted task execution scope", () => {
  it("restores maps in a new coordinator but never uses model IDs or an untrusted client", async () => {
    const store = memoryStore(), id = randomUUID();
    const first = new TaskScope({ store, trustedHost: () => true });
    const original = first.resource("selections", () => new Map<string, string>(), codec);
    await first.run(extra(id), async () => { original.set("ref", "product"); });
    const next = new TaskScope({ store, trustedHost: () => true });
    const restored = next.resource("selections", () => new Map<string, string>(), codec);
    await next.run(extra(id), async () => { expect(restored.get("ref")).toBe("product"); });
    await next.run({ threadId: id }, async () => { expect(restored.size).toBe(0); });
    const untrusted = new TaskScope({ store, trustedHost: () => false });
    const empty = untrusted.resource("selections", () => new Map<string, string>(), codec);
    await untrusted.run(extra(id), async () => { expect(empty.size).toBe(0); });
  });
  it("allows simultaneous tasks and same-task UI changes without leaking state", async () => {
    const scope = new TaskScope({ store: memoryStore(), trustedHost: () => true });
    const values = scope.resource("selection", () => new Map<string, string>(), codec);
    const a = randomUUID(), b = randomUUID(); let release!: () => void;
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    const pending = scope.run(extra(a), async () => {
      values.set("selected", "old"); started();
      await new Promise<void>(resolve => { release = resolve; });
      expect(values.get("selected")).toBe("new");
    });
    await ready;
    await scope.run(extra(b), async () => { expect(values.size).toBe(0); values.set("selected", "other task"); });
    await scope.run(extra(a), async () => { values.set("selected", "new"); });
    release(); await pending;
  });
  it("rejects in-flight writes after another process clears the task", async () => {
    const store = memoryStore(), scope = new TaskScope({ store, trustedHost: () => true }), id = randomUUID();
    const values = scope.resource("selection", () => new Map<string, string>(), codec);
    await expect(scope.run(extra(id), async () => { values.set("selected", "old"); store.clear(id); })).rejects.toThrow("TASK_STATE_CONFLICT");
    await scope.run(extra(id), async () => { expect(values.size).toBe(0); });
  });
  it("does not let an awaiting operation restore history after same-process erasure", async () => {
    const scope = new TaskScope({ store: memoryStore(), trustedHost: () => true }), id = randomUUID();
    const values = scope.resource("selection", () => new Map<string, string>(), codec);
    let resume!: () => void, started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const pending = scope.run(extra(id), async () => {
      values.set("old", "observation"); started();
      await new Promise<void>(resolve => { resume = resolve; });
      values.set("resurrected", "observation");
    });
    const rejected = expect(pending).rejects.toThrow("TASK_STATE_CONFLICT");
    await ready;
    await scope.run(extra(id), async () => { scope.clear(); });
    resume(); await rejected;
    await scope.run(extra(id), async () => { expect(values.size).toBe(0); });
  });
  it("rechecks a resource before using data cleared by another process and preserves archive state", async () => {
    const store = memoryStore(), scope = new TaskScope({ store, trustedHost: () => true }), id = randomUUID();
    const values = scope.resource("selection", () => new Map<string, string>(), codec);
    const lifecycle = scope.resource("lifecycle", () => new Map<string, string>(), codec);
    await scope.run(extra(id), async () => { values.set("old", "price"); lifecycle.set("archived", "true"); });
    await scope.run(extra(id), async () => { scope.clear(["lifecycle"]); expect(values.size).toBe(0); expect(lifecycle.get("archived")).toBe("true"); });
    await expect(scope.run(extra(id), async () => { store.clear(id); expect(() => values.get("old")).toThrow("TASK_STATE_CONFLICT"); })).rejects.toThrow("TASK_STATE_CONFLICT");
  });
});
