import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startAwinFeedRuntime, type AwinFeedRuntime } from "./runtime.js";

export async function runAwinFeedMain(): Promise<AwinFeedRuntime> {
  const runtime = await startAwinFeedRuntime();
  let shutdown: Promise<void> | undefined;
  const close = (): void => {
    shutdown ??= runtime.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  return runtime;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  void runAwinFeedMain().catch(() => {
    console.error("Awin Feed service failed to start");
    process.exitCode = 1;
  });
}
