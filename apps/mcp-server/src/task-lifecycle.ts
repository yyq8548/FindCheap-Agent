import { z } from "zod";
import { TaskIdSchema } from "./task-state-store.js";
import { watchStopIntent, type WatchStore } from "./watch-store.js";

export type TaskLifecycleStatus = "ACTIVE" | "ARCHIVED" | "UNKNOWN";
export type TaskLifecycleReader = { status(taskId: string): Promise<TaskLifecycleStatus>; close?(): void };
export type TaskMetadataRpc = (method: "thread/read" | "thread/list", params: Record<string, unknown>) => Promise<unknown>;
const sourceKinds = ["cli", "vscode", "exec", "appServer", "subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther", "unknown"];
const ReadSchema = z.object({ thread: z.object({ id: TaskIdSchema, cwd: z.string().min(1).max(4096), ephemeral: z.boolean() }) });
const ListSchema = z.object({ data: z.array(z.object({ id: TaskIdSchema })).max(100), nextCursor: z.string().max(4096).nullish() });

/** Only positive official metadata establishes a lifecycle state. Missing data
 * is not a deletion receipt and can never authorize erasing local history. */
export function createTaskLifecycleReader(rpc: TaskMetadataRpc, now = Date.now): TaskLifecycleReader {
  const cache = new Map<string, { expires: number; status: TaskLifecycleStatus }>();
  const pending = new Map<string, Promise<TaskLifecycleStatus>>();
  async function read(id: string): Promise<TaskLifecycleStatus> {
    try {
      TaskIdSchema.parse(id);
      const { thread } = ReadSchema.parse(await rpc("thread/read", { threadId: id, includeTurns: false }));
      if (thread.id !== id || thread.ephemeral) return "UNKNOWN";
      for (const archived of [true, false]) {
        let cursor: string | undefined;
        for (let page = 0; page < 5; page++) {
          const result = ListSchema.parse(await rpc("thread/list", { cwd: thread.cwd, archived, limit: 100,
            useStateDbOnly: true, sourceKinds, ...(cursor === undefined ? {} : { cursor }) }));
          if (result.data.some(row => row.id === id)) return archived ? "ARCHIVED" : "ACTIVE";
          if (!result.nextCursor) break;
          if (result.nextCursor === cursor) return "UNKNOWN";
          cursor = result.nextCursor;
          if (page === 4) return "UNKNOWN";
        }
      }
    } catch { /* Unavailable host, missing records and schema drift all fail closed. */ }
    return "UNKNOWN";
  }
  return { async status(id) {
    const previous = cache.get(id);
    if (previous !== undefined && previous.expires > now()) return previous.status;
    let request = pending.get(id);
    if (request === undefined) {
      request = read(id).then(status => {
        cache.set(id, { expires: now() + 10_000, status });
        if (cache.size > 500) cache.delete(cache.keys().next().value!);
        return status;
      }).finally(() => pending.delete(id));
      pending.set(id, request);
    }
    return request;
  } };
}

export async function pauseTaskWatches(store: WatchStore, changedAt: string): Promise<void> {
  for (const watch of await store.list()) {
    if (watch.status !== "ACTIVE") continue;
    const stopIntent = watchStopIntent(watch, "PAUSED", changedAt);
    await store.save({ ...watch, status: "PAUSED", updatedAt: changedAt,
      ...(stopIntent === undefined ? {} : { stopIntent }) });
  }
}
