import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

export const TASK_HISTORY_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
export const TaskIdSchema = z.string().uuid();
const RowSchema = z.object({ revision: z.number().int().positive(), version: z.literal(1),
  updated_at: z.number().int(), payload: z.string(), digest: z.string() });
const digest = (payload: string) => createHash("sha256").update(payload).digest("hex");
export type TaskStateRecord = { revision: number; data: Record<string, unknown> };
export type TaskStateStore = {
  load(taskId: string): TaskStateRecord;
  revision?(taskId: string): number;
  save(taskId: string, expectedRevision: number, data: Record<string, unknown>): number;
  clear(taskId: string, retained?: Record<string, unknown>): number;
  close(): void;
};

/** Local-user store. Revisions/tombstones prevent a late writer from restoring erased data. */
export function createTaskStateStore(path: string, now = Date.now): TaskStateStore {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;");
  db.exec(`CREATE TABLE IF NOT EXISTS task_state (
    task_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, version INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL
  )`);
  const get = db.prepare("SELECT revision, version, updated_at, payload, digest FROM task_state WHERE task_id = ?");
  const write = db.prepare(`INSERT INTO task_state VALUES (?, ?, 1, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET revision=excluded.revision, updated_at=excluded.updated_at,
    version=excluded.version, payload=excluded.payload, digest=excluded.digest`);
  const validId = (taskId: string) => { if (!TaskIdSchema.safeParse(taskId).success) throw new Error("TASK_SCOPE_UNAVAILABLE"); };
  const read = (taskId: string) => {
    validId(taskId);
    const raw = get.get(taskId);
    if (raw === undefined) return undefined;
    const parsed = RowSchema.safeParse(raw);
    if (!parsed.success || Buffer.byteLength(parsed.data.payload) > MAX_PAYLOAD_BYTES ||
      digest(parsed.data.payload) !== parsed.data.digest) throw new Error("TASK_STATE_CORRUPT");
    return parsed.data;
  };
  const transaction = <T>(run: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try { const result = run(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  const checkCapacity = () => {
    const count = db.prepare("SELECT COUNT(*) AS count FROM task_state").get()?.count;
    if (typeof count !== "number" || count >= 500) throw new Error("TASK_STATE_LIMIT");
  };
  const store: TaskStateStore = {
    revision(taskId) {
      validId(taskId);
      const value = db.prepare("SELECT revision FROM task_state WHERE task_id = ?").get(taskId)?.revision;
      if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value))) throw new Error("TASK_STATE_CORRUPT");
      return value as number | undefined ?? 0;
    },
    load(taskId) {
      return transaction(() => {
        const row = read(taskId);
        if (row === undefined) return { revision: 0, data: {} };
        if (row.payload !== "{}" && row.updated_at + TASK_HISTORY_TTL_MS <= now()) {
          write.run(taskId, row.revision + 1, now(), "{}", digest("{}"));
          return { revision: row.revision + 1, data: {} };
        }
        try { return { revision: row.revision, data: z.record(z.unknown()).parse(JSON.parse(row.payload)) }; }
        catch { throw new Error("TASK_STATE_CORRUPT"); }
      });
    },
    save(taskId, expectedRevision, data) {
      const payload = JSON.stringify(data);
      if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) throw new Error("TASK_STATE_LIMIT");
      return transaction(() => {
        const row = read(taskId);
        if ((row?.revision ?? 0) !== expectedRevision) throw new Error("TASK_STATE_CONFLICT");
        if (row === undefined) checkCapacity();
        const revision = expectedRevision + 1;
        write.run(taskId, revision, now(), payload, digest(payload));
        return revision;
      });
    },
    clear(taskId, retained = {}) {
      const payload = JSON.stringify(retained);
      if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) throw new Error("TASK_STATE_LIMIT");
      return transaction(() => {
        validId(taskId);
        // Explicit erasure can recover a corrupt payload without loading it.
        const row = get.get(taskId);
        if (row === undefined) checkCapacity();
        const revision = typeof row?.revision === "number" ? row.revision + 1 : 1;
        write.run(taskId, revision, now(), payload, digest(payload));
        return revision;
      });
    },
    close() { db.close(); }
  };
  return store;
}
