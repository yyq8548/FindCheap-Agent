import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createTaskStateStore, TASK_HISTORY_TTL_MS } from "../src/task-state-store.js";

const directories: string[] = [];
function database() { const directory = mkdtempSync(join(tmpdir(), "findcheap-state-test-")); directories.push(directory); return join(directory, "state.sqlite"); }
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("durable task state", () => {
  it("restores exact references across connections and isolates tasks", () => {
    const path = database(), id = randomUUID(), other = randomUUID();
    const first = createTaskStateStore(path);
    const revision = first.save(id, 0, { references: ["immutable-render", "immutable-selection"] });
    first.close();
    const second = createTaskStateStore(path);
    try {
      expect(second.load(id)).toMatchObject({ revision, data: { references: ["immutable-render", "immutable-selection"] } });
      expect(second.load(other)).toMatchObject({ revision: 0, data: {} });
    } finally { second.close(); }
  });
  it("rejects stale concurrent commits and cannot resurrect a cleared task", () => {
    const path = database(), id = randomUUID();
    const first = createTaskStateStore(path), second = createTaskStateStore(path);
    try {
      first.save(id, 0, { a: 1 });
      expect(() => second.save(id, 0, { a: 2 })).toThrow("TASK_STATE_CONFLICT");
      const revision = first.clear(id);
      expect(() => second.save(id, 1, { resurrected: true })).toThrow("TASK_STATE_CONFLICT");
      expect(second.load(id)).toMatchObject({ revision, data: {} });
    } finally { first.close(); second.close(); }
  });
  it("retains a revision tombstone after expiry and rejects corrupted data", () => {
    const path = database(), id = randomUUID(); let now = 1_000_000;
    const store = createTaskStateStore(path, () => now);
    try {
      store.save(id, 0, { a: 1 });
      now += TASK_HISTORY_TTL_MS + 1;
      expect(store.load(id)).toMatchObject({ data: {}, revision: 2 });
      expect(() => store.save(id, 1, { a: 2 })).toThrow("TASK_STATE_CONFLICT");
      store.save(id, 2, { a: 3 });
      const corrupt = new DatabaseSync(path);
      try { corrupt.prepare("UPDATE task_state SET payload = ? WHERE task_id = ?").run('{"a":4}', id); }
      finally { corrupt.close(); }
      expect(() => store.load(id)).toThrow("TASK_STATE_CORRUPT");
    } finally { store.close(); }
  });
  it("rejects invalid task IDs and oversized state without changing the saved revision", () => {
    const store = createTaskStateStore(database()), id = randomUUID();
    try {
      expect(() => store.load("../../other-user")).toThrow("TASK_SCOPE_UNAVAILABLE");
      expect(() => store.save(id, 0, { bytes: "x".repeat(8 * 1024 * 1024) })).toThrow("TASK_STATE_LIMIT");
      expect(store.load(id).revision).toBe(0);
    } finally { store.close(); }
  });
});
