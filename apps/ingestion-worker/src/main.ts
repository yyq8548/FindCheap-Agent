import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startIngestionRuntime, type IngestionRuntime } from "./runtime/bootstrap.js";

export async function runIngestionMain(): Promise<IngestionRuntime> {
  const runtime = await startIngestionRuntime();
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
  void runIngestionMain().catch(() => {
    // Startup errors are intentionally not serialized because connection URLs may contain secrets.
    console.error("ingestion worker failed to start");
    process.exitCode = 1;
  });
}
