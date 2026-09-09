import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createJsonWatchStore } from "../src/watch-store.js";

describe("new task Watch kernel lock", () => {
  it("automatically releases a process-held lock on crash and serializes later writers", async () => {
    const directory = mkdtempSync(join(tmpdir(), "findcheap-watch-kernel-"));
    const child = spawn(process.execPath, ["--input-type=module", "-e",
      "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); db.exec('BEGIN IMMEDIATE'); process.stdout.write('READY'); process.stdin.once('data', () => process.exit(23));",
      join(directory, ".watch-store.sqlite")], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    const exited = new Promise<number | null>(resolve => child.once("exit", resolve));
    try {
      await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); });
      const first = createJsonWatchStore(directory, { kernelLock: true }), second = createJsonWatchStore(directory, { kernelLock: true });
      const spec = { query: "kernel lock sample", condition: "RESTOCKED" as const, intervalMinutes: 60, membershipIds: [] };
      await expect(first.create(spec, "2026-09-09T12:00:00.000Z")).rejects.toThrow("WATCH_STORE_BUSY");
      child.stdin.write("crash\n");
      expect(await exited).toBe(23);
      const created = await Promise.all([first.create(spec, "2026-09-09T12:00:00.000Z"), second.create(spec, "2026-09-09T12:00:00.000Z")]);
      expect(created[0]?.watchId).toBe(created[1]?.watchId);
      const writes = await Promise.allSettled(created.map((record, index) => (index === 0 ? first : second).save({ ...record, status: "PAUSED" })));
      expect(writes.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(writes.filter(result => result.status === "rejected")).toHaveLength(1);
    } finally { if (child.exitCode === null) child.kill(); await exited; rmSync(directory, { recursive: true, force: true }); }
  });
});
