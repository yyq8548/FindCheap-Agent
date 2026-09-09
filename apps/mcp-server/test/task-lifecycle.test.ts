import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createTaskLifecycleReader, pauseTaskWatches } from "../src/task-lifecycle.js";
import { createMemoryWatchStore } from "../src/watch-store.js";

describe("official task metadata lifecycle", () => {
  it("uses metadata-only scoped official queries, including exec tasks", async () => {
    const id = randomUUID();
    const rpc = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "thread/read") return { thread: { id, cwd: "C:/isolated-test", ephemeral: false } };
      return { data: params.archived === true ? [{ id }] : [], nextCursor: null };
    });
    const reader = createTaskLifecycleReader(rpc);
    expect(await reader.status(id)).toBe("ARCHIVED");
    expect(rpc).toHaveBeenCalledWith("thread/read", { threadId: id, includeTurns: false });
    expect(rpc).toHaveBeenCalledWith("thread/list", expect.objectContaining({ cwd: "C:/isolated-test", useStateDbOnly: true,
      sourceKinds: expect.arrayContaining(["exec"]), archived: true }));
  });
  it("never treats a read failure, empty index or truncated pagination as deletion", async () => {
    const id = randomUUID();
    expect(await createTaskLifecycleReader(async () => { throw new Error("thread not loaded"); }).status(id)).toBe("UNKNOWN");
    expect(await createTaskLifecycleReader(async method => method === "thread/read" ? { thread: { id, cwd: "C:/test", ephemeral: false } }
      : { data: [], nextCursor: "more" }).status(id)).toBe("UNKNOWN");
  });
  it("pauses only associated watches, persists stop intent, and never resumes automatically", async () => {
    const own = createMemoryWatchStore(), other = createMemoryWatchStore();
    const spec = { query: "sample", condition: "RESTOCKED" as const, intervalMinutes: 60, membershipIds: [] };
    const first = await own.create(spec, "2026-09-09T10:00:00.000Z");
    await own.save({ ...first, automationId: "qa-only", schedulingState: "BOUND" });
    await other.create(spec, "2026-09-09T10:00:00.000Z");
    await pauseTaskWatches(own, "2026-09-09T11:00:00.000Z");
    expect(await own.get(first.watchId)).toMatchObject({ status: "PAUSED", stopIntent: { automationId: "qa-only", status: "STOP_REQUIRED" } });
    expect((await other.list())[0]?.status).toBe("ACTIVE");
    const paused = await own.get(first.watchId);
    await pauseTaskWatches(own, "2026-09-09T12:00:00.000Z");
    expect(await own.get(first.watchId)).toEqual(paused);
  });
});
