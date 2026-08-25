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
