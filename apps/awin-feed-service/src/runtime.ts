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

type RuntimeDependencies = {
  fetch?: typeof fetch;
  now?: () => Date;
  clock?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  writeLog?: (message: string) => void;
};

export async function startAwinFeedRuntime(
  input: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: RuntimeDependencies = {}
): Promise<AwinFeedRuntime> {
  const environment = parseAwinFeedServiceEnvironment(input);
  const writeLog = dependencies.writeLog ?? ((message: string) => process.stderr.write(`${message}\n`));
  const random = dependencies.random ?? Math.random;
  const controller = createAwinFeedController(environment, {
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
    ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }),
    ...(dependencies.sleep === undefined ? {} : { sleep: dependencies.sleep }),
    random,
    log: (event) => writeLog(`[awin-feed-source] ${JSON.stringify(event)}`)
  });
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
  let closed = false;
  let quickRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let quickRetryNumber = 0;
  let activeRuntimeRefresh: Promise<void> | undefined;
  let staleAlerted = false;
  const scheduleQuickRetry = (): void => {
    if (closed || quickRetryTimer !== undefined) return;
    const delay = quickRetryDelayMs(quickRetryNumber, random);
    quickRetryNumber = Math.min(quickRetryNumber + 1, 3);
    quickRetryTimer = setTimeout(() => {
      quickRetryTimer = undefined;
      void refreshFeed();
    }, delay);
    quickRetryTimer.unref();
  };
  const refreshFeed = (): Promise<void> => {
    if (closed) return Promise.resolve();
    if (activeRuntimeRefresh !== undefined) return activeRuntimeRefresh;
    const refresh = (async () => {
      try {
        await controller.refresh();
        if ((controller.getState().snapshot?.staleSourceFeeds ?? 0) === 0) {
          quickRetryNumber = 0;
          if (quickRetryTimer !== undefined) clearTimeout(quickRetryTimer);
          quickRetryTimer = undefined;
        } else {
          scheduleQuickRetry();
        }
      } catch (error) {
        logFeedRefreshFailure(controller, error, writeLog);
        scheduleQuickRetry();
      }
    })();
    activeRuntimeRefresh = refresh.finally(() => {
      activeRuntimeRefresh = undefined;
    });
    return activeRuntimeRefresh;
  };
  void refreshFeed();
  void offers?.refresh().catch(() => {});
  void refreshRegistries().catch(() => {});
  const timer = setInterval(() => {
    void refreshFeed();
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
  const checkSnapshotAge = (): void => {
    const lastSuccess = controller.getState().lastSuccessfulRefreshAt;
    const currentTime = dependencies.now?.().getTime() ?? Date.now();
    const stale = lastSuccess === undefined || currentTime - Date.parse(lastSuccess) > environment.staleAfterMs;
    if (stale && !staleAlerted) {
      staleAlerted = true;
      writeLog(`[awin-feed-alert] ${JSON.stringify({
        event: "awin_feed_snapshot_stale",
        staleAfterMs: environment.staleAfterMs,
        consecutiveRefreshFailures: controller.getState().consecutiveRefreshFailures ?? 0
      })}`);
    } else if (!stale) {
      staleAlerted = false;
    }
  };
  checkSnapshotAge();
  const staleTimer = setInterval(checkSnapshotAge, 60_000);
  staleTimer.unref();
  return {
    async close() {
      closed = true;
      clearInterval(timer);
      clearInterval(staleTimer);
      if (quickRetryTimer !== undefined) clearTimeout(quickRetryTimer);
      if (offersTimer !== undefined) clearInterval(offersTimer);
      if (registryTimer !== undefined) clearInterval(registryTimer);
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      } finally {
        await activeRuntimeRefresh;
        await registryDatabase?.close();
      }
    }
  };
}

export function quickRetryDelayMs(attempt: number, random: () => number = Math.random): number {
  const boundedAttempt = Math.max(0, Math.min(3, Math.floor(attempt)));
  const baseMinutes = [1, 2, 5, 10][boundedAttempt]!;
  return Math.min(10 * 60_000, Math.round(baseMinutes * 60_000 * (1 + random() * 0.2)));
}

function logFeedRefreshFailure(
  controller: ReturnType<typeof createAwinFeedController>,
  error: unknown,
  writeLog: (message: string) => void
): void {
  const state = controller.getState();
  writeLog(`[awin-feed-refresh] ${JSON.stringify({
    event: "awin_feed_refresh_failed",
    code: state.lastErrorCode ?? "OTHER",
    detailCode: state.lastErrorDetailCode ?? "OTHER",
    consecutiveRefreshFailures: state.consecutiveRefreshFailures ?? 0,
    errorType: error instanceof Error ? error.name : "unknown"
  })}`);
}
