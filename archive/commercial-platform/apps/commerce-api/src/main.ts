import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startCommerceRuntime, type CommerceRuntime } from "./runtime.js";

export async function runCommerceMain(): Promise<CommerceRuntime> {
  const runtime = await startCommerceRuntime();
  if (runtime.status === "disabled") {
    console.log(JSON.stringify({
      event: "commerce.disabled",
      status: "disabled",
      reason: "database_not_configured",
      enabledMerchants: 0,
      acceptingRequests: false
    }));
    return runtime;
  }
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
  void runCommerceMain().catch((error: unknown) => {
    const code = typeof error === "object" && error !== null && "code" in error &&
      typeof error.code === "string" ? error.code : "UNKNOWN";
    console.error(JSON.stringify({ event: "commerce.start_failed", code }));
    process.exitCode = 1;
  });
}
