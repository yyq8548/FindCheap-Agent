import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { createTaskStateStore } from "../src/task-state-store.js";
import { createMemoryWatchStore } from "../src/watch-store.js";
import type { TaskLifecycleStatus } from "../src/task-lifecycle.js";
import { connectReplay, REPLAY_NOW, searchResult } from "./fixtures/conversation-replay-support.js";

it("isolates Watch ownership and seals confirmed archives without resuming after unarchive", async () => {
  const directory = mkdtempSync(join(tmpdir(), "findcheap-lifecycle-test-"));
  const state = createTaskStateStore(join(directory, "state.sqlite"));
  const id = randomUUID(), other = randomUUID();
  const own = createMemoryWatchStore(), foreign = createMemoryWatchStore();
  const record = await own.create({ query: "Black Lace Dress", condition: "RESTOCKED", identity: { gtin: "1234567890123" },
    conditionPreference: "ANY", membershipIds: [], intervalMinutes: 60 }, REPLAY_NOW.toISOString());
  await own.save({ ...record, automationId: "isolated-test-schedule", schedulingState: "BOUND" });
  let status: TaskLifecycleStatus = "ACTIVE";
  const search = vi.fn(async () => searchResult([]));
  const harness = await connectReplay(search, { taskState: state, taskWatches: task => task === id ? own : foreign,
    taskLifecycle: { status: async () => status } }, undefined, "codex-mcp-client");
  const call = (name: string, args = {}, threadId = id) => harness.client.callTool({ name, arguments: args, _meta: { threadId } });
  try {
    expect((await call("list_watches", {}, other)).structuredContent).toMatchObject({ watches: [] });
    expect(JSON.stringify(await call("check_watch", { watchId: record.watchId }, other))).toContain("NOT_FOUND");
    status = "ARCHIVED";
    expect((await call("list_watches")).structuredContent).toMatchObject({ watches: [{ status: "PAUSED", stopIntent: { status: "STOP_REQUIRED" } }] });
    expect(JSON.stringify(await call("search_products", { query: "coffee" }))).toContain("TASK_ARCHIVED");
    expect((await call("clear_shopping_history")).structuredContent).toMatchObject({ status: "CLEARED" });
    status = "UNKNOWN";
    expect(JSON.stringify(await call("search_products", { query: "coffee" }))).toContain("TASK_ARCHIVED");
    expect(JSON.stringify(await call("pause_watch", { watchId: record.watchId, paused: false }))).toContain("TASK_HOST_STATE_UNAVAILABLE");
    status = "ACTIVE";
    expect((await call("get_shopping_history")).structuredContent).toMatchObject({ status: "HISTORICAL", searches: [] });
    expect(await own.get(record.watchId)).toMatchObject({ status: "PAUSED" });
    expect(search).not.toHaveBeenCalled();
  } finally { await harness.close(); state.close(); rmSync(directory, { recursive: true, force: true }); }
});

it("lets an explicit current-task history clear recover corrupt storage without erasing another task", async () => {
  const directory = mkdtempSync(join(tmpdir(), "findcheap-clear-test-")), path = join(directory, "state.sqlite");
  const state = createTaskStateStore(path), id = randomUUID(), other = randomUUID();
  state.save(id, 0, { old: "history" }); state.save(other, 0, { retained: "other task" });
  const database = new DatabaseSync(path);
  database.prepare("UPDATE task_state SET digest = 'bad' WHERE task_id = ?").run(id); database.close();
  const harness = await connectReplay(async () => searchResult([]), { taskState: state }, undefined, "codex-mcp-client");
  try {
    const failed = await harness.client.callTool({ name: "get_shopping_history", arguments: {}, _meta: { threadId: id } });
    expect(JSON.stringify(failed)).toContain("TASK_STATE_UNAVAILABLE");
    const cleared = await harness.client.callTool({ name: "clear_shopping_history", arguments: {}, _meta: { threadId: id } });
    expect(cleared.structuredContent, JSON.stringify(cleared)).toMatchObject({ status: "CLEARED" });
    expect(state.load(other).data).toEqual({ retained: "other task" });
    expect(state.load(id).data).not.toHaveProperty("old");
  } finally { await harness.close(); state.close(); rmSync(directory, { recursive: true, force: true }); }
});
