import { chown, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { runAwinFeedMain } from "./main.js";

const NODE_UID = 1_000;
const NODE_GID = 1_000;

async function runContainer(): Promise<void> {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    if (process.setgroups === undefined || process.setgid === undefined || process.setuid === undefined) {
      throw new Error("container privilege drop is unavailable");
    }
    const dataDirectory = dirname(process.env.AWIN_FEED_DATA_PATH ?? "/data/current.csv.gz");
    await mkdir(dataDirectory, { recursive: true });
    await chown(dataDirectory, NODE_UID, NODE_GID);
    process.setgroups([]);
    process.setgid(NODE_GID);
    process.setuid(NODE_UID);
  }
  await runAwinFeedMain();
}

void runContainer().catch(() => {
  console.error("Awin Feed service failed to start");
  process.exitCode = 1;
});
