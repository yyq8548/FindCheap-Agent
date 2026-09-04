import { once } from "node:events";

import { createDatabase, type Database } from "../../../packages/db/src/client.js";
import { parseAwinFeedServiceEnvironment } from "./environment.js";
import { createEbayBrowseController } from "./ebay-browse.js";
import { createAwinOffersController } from "./offers.js";
import { createAwinFeedController, createAwinFeedHttpServer } from "./service.js";
import { refreshServedRegistriesFromDatabase } from "./registry-database.js";

export type AwinFeedRuntime = {
  close(): Promise<void>;
};

export async function startAwinFeedRuntime(
  input: Readonly<Record<string, string | undefined>> = process.env
): Promise<AwinFeedRuntime> {
  const environment = parseAwinFeedServiceEnvironment(input);
  const controller = createAwinFeedController(environment);
  const offers = environment.offers === undefined ? undefined : createAwinOffersController(environment.offers);
  const ebay = environment.ebay === undefined ? undefined : createEbayBrowseController(environment.ebay);
  const registryDatabase: Database | undefined = environment.registryDatabase === undefined
    ? undefined
    : createDatabase(environment.registryDatabase.url, {
        statementTimeoutMs: 5_000,
        queryTimeoutMs: 6_000,
        connectionTimeoutMs: 5_000
      });
  const refreshRegistries = async (): Promise<void> => {
    if (registryDatabase === undefined) return;
    await refreshServedRegistriesFromDatabase(registryDatabase, {
      officialStorefronts: environment.officialStorefronts,
      merchantTrust: environment.merchantTrust
    });
  };
  await controller.loadExisting();
  await offers?.loadExisting();
  await controller.refresh().catch((error) => logFeedValidationFailure(controller, error));
  await offers?.refresh().catch(() => {});
  await refreshRegistries().catch(() => {});
  const server = createAwinFeedHttpServer(
    controller,
    environment.apiToken,
    {
      ...(offers === undefined ? {} : { offers }),
      ...(ebay === undefined ? {} : { ebay }),
      officialStorefronts: environment.officialStorefronts,
      merchantTrust: environment.merchantTrust
    }
  );
  server.listen(environment.port, environment.host);
  await once(server, "listening");
  const timer = setInterval(() => {
    void controller.refresh().catch((error) => logFeedValidationFailure(controller, error));
  }, environment.refreshIntervalMs);
  timer.unref();
  const offersTimer = offers === undefined ? undefined : setInterval(() => {
    void offers.refresh().catch(() => {});
  }, environment.offers!.refreshIntervalMs);
  offersTimer?.unref();
  const registryTimer = environment.registryDatabase === undefined ? undefined : setInterval(() => {
    void refreshRegistries().catch(() => {});
  }, environment.registryDatabase.refreshIntervalMs);
  registryTimer?.unref();
  return {
    async close() {
      clearInterval(timer);
      if (offersTimer !== undefined) clearInterval(offersTimer);
      if (registryTimer !== undefined) clearInterval(registryTimer);
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      } finally {
        await registryDatabase?.close();
      }
    }
  };
}

function logFeedValidationFailure(
  controller: ReturnType<typeof createAwinFeedController>,
  error: unknown
): void {
  if (controller.getState().lastErrorCode !== "FEED_INVALID") return;
  const message = error instanceof Error ? error.message : "unknown validation failure";
  process.stderr.write(`[awin-feed-refresh] FEED_INVALID: ${message}\n`);
}
