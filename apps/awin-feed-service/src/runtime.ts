import { once } from "node:events";

import { parseAwinFeedServiceEnvironment } from "./environment.js";
import { createEbayBrowseController } from "./ebay-browse.js";
import { createAwinOffersController } from "./offers.js";
import { createAwinFeedController, createAwinFeedHttpServer } from "./service.js";

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
  await controller.loadExisting();
  await offers?.loadExisting();
  await controller.refresh().catch(() => {});
  await offers?.refresh().catch(() => {});
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
    void controller.refresh().catch(() => {});
  }, environment.refreshIntervalMs);
  timer.unref();
  const offersTimer = offers === undefined ? undefined : setInterval(() => {
    void offers.refresh().catch(() => {});
  }, environment.offers!.refreshIntervalMs);
  offersTimer?.unref();
  return {
    async close() {
      clearInterval(timer);
      if (offersTimer !== undefined) clearInterval(offersTimer);
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  };
}
