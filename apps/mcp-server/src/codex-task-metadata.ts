import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { createTaskLifecycleReader, type TaskLifecycleReader } from "./task-lifecycle.js";

function executable(): string | undefined {
  const name = process.platform === "win32" ? "codex.exe" : "codex";
  // The desktop's bundled executable matches the host version; prefer it to an alias.
  if (process.platform === "win32") {
    const root = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "OpenAI", "Codex", "bin");
    try {
      const matches = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory())
        .map(entry => join(root, entry.name, name)).filter(path => existsSync(path))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      if (matches[0]) return matches[0];
    } catch { /* Fall back to a real executable on PATH. */ }
  }
  return (process.env.PATH ?? "").split(delimiter).map(directory => join(directory, name)).find(path => existsSync(path));
}

/** Official app-server stdio only. No private database/IPC, chat history, tools,
 * mutation methods, automation acknowledgements or credentials are queried. */
export function createCodexTaskMetadataReader(): TaskLifecycleReader {
  let child: ChildProcessWithoutNullStreams | undefined;
  let ready: Promise<void> | undefined;
  let sequence = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  const close = () => {
    const previous = child; child = undefined; ready = undefined;
    previous?.kill();
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error("TASK_HOST_UNAVAILABLE")); }
    pending.clear();
  };
  const request = (method: string, params: Record<string, unknown>): Promise<unknown> => new Promise((resolve, reject) => {
    const process = child;
    if (process === undefined || pending.size >= 16) { reject(new Error("TASK_HOST_UNAVAILABLE")); return; }
    const id = ++sequence;
    const timer = setTimeout(close, 4_000);
    pending.set(id, { resolve, reject, timer });
    process.stdin.write(JSON.stringify({ id, method, params }) + "\n", error => { if (error && child === process) close(); });
  });
  const initialize = async () => {
    const path = executable();
    if (path === undefined) throw new Error("TASK_HOST_UNAVAILABLE");
    const process = spawn(path, ["app-server", "--stdio"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    child = process;
    process.stderr.resume();
    process.once("error", () => { if (child === process) close(); });
    process.once("exit", () => { if (child === process) close(); });
    const lines = createInterface({ input: process.stdout });
    lines.on("line", line => {
      if (child !== process) return;
      if (Buffer.byteLength(line) > 1024 * 1024) { close(); return; }
      try {
        const value = JSON.parse(line) as { id?: number; error?: unknown; result?: unknown };
        const waiter = value.id === undefined ? undefined : pending.get(value.id);
        if (waiter === undefined) return;
        clearTimeout(waiter.timer); pending.delete(value.id!);
        if (value.error !== undefined) waiter.reject(new Error("TASK_HOST_UNAVAILABLE"));
        else waiter.resolve(value.result);
      } catch { close(); }
    });
    await request("initialize", { clientInfo: { name: "findcheap-task-metadata", version: "1" }, capabilities: { experimentalApi: true } });
    process.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
  };
  const reader = createTaskLifecycleReader(async (method, params) => {
    ready ??= initialize().catch(error => { ready = undefined; throw error; });
    await ready;
    return request(method, params);
  });
  return { ...reader, close };
}
