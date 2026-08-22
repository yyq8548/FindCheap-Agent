import { once } from "node:events";

import { parseAwinFeedServiceEnvironment } from "./environment.js";
import { createAwinFeedController, createAwinFeedHttpServer } from "./service.js";

export type AwinFeedRuntime = {
  close(): Promise<void>;
};

export async function startAwinFeedRuntime(
  input: Readonly<Record<string, string | undefined>> = process.env
): Promise<AwinFeedRuntime> {
  const environment = parseAwinFeedServiceEnvironment(input);
  const controller = createAwinFeedController(environment);
  await controller.loadExisting();
  await controller.refresh().catch(() => {});
  const server = createAwinFeedHttpServer(controller, environment.apiToken);
  server.listen(environment.port, environment.host);
  await once(server, "listening");
  const timer = setInterval(() => {
    void controller.refresh().catch(() => {});
  }, environment.refreshIntervalMs);
  timer.unref();
  return {
    async close() {
      clearInterval(timer);
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  };
}
