import { gzipSync } from "node:zlib";
import { createServer } from "node:net";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import { quickRetryDelayMs, startAwinFeedRuntime } from "../src/runtime.js";
import { feedStatePaths, recordSourceRequest, sourceFeedKeyHash } from "../src/source-cache.js";
import { createAwinFeedController } from "../src/service.js";
import { parseAwinFeedServiceEnvironment } from "../src/environment.js";

const directories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Awin Feed runtime", () => {
  it("reports no scheduled quick retry when an in-flight refresh settles during close", async () => {
    const directory = await mkdtemp(join(tmpdir(), "awin-runtime-close-"));
    directories.push(directory);
    let resolveSource!: (response: Response) => void;
    const response = new Promise<Response>(resolve => { resolveSource = resolve; });
    const settlements = refreshSettlements();
    const runtime = await startAwinFeedRuntime({
      AWIN_SOURCE_FEED_URL: "https://productdata.awin.com/private/feed.gz",
      AWIN_FEED_API_TOKEN: "t".repeat(32), AWIN_FEED_DATA_PATH: join(directory, "current.csv.gz"),
      AWIN_FEED_SERVICE_HOST: "127.0.0.1", AWIN_FEED_SERVICE_PORT: String(await availablePort()),
      AWIN_SOURCE_RETRY_ATTEMPTS: "0"
    }, { fetch: async () => response, writeLog: settlements.writeLog });
    const closing = runtime.close();
    resolveSource(new Response(null, { status: 503 }));
    await closing;
    expect(await settlements.next()).toMatchObject({ quickRetryScheduled: false, feedStatus: "unavailable", consecutiveRefreshFailures: 1 });
  });

  it.each([
    { failure: "invalid cached replacement", status: 200, retry: false },
    { failure: "temporary cached replacement failure", status: 503, retry: true }
  ])("applies the retry policy when refresh resolves with an old source cache: $failure", async ({ status, retry }) => {
    const directory = await mkdtemp(join(tmpdir(), "awin-runtime-stale-retry-"));
    directories.push(directory);
    const dataPath = join(directory, "current.csv.gz");
    let changed = false;
    let listRequests = 0;
    const input = {
      AWIN_SOURCE_FEED_LIST_URL: "https://ui.awin.com/private/feedList",
      AWIN_FEED_API_TOKEN: "t".repeat(32), AWIN_FEED_DATA_PATH: dataPath,
      AWIN_FEED_SERVICE_HOST: "127.0.0.1", AWIN_FEED_SERVICE_PORT: String(await availablePort()),
      AWIN_SOURCE_RETRY_ATTEMPTS: "0", AWIN_REFRESH_INTERVAL_MINUTES: "360"
    };
    const fetchRequest = async (url: string | URL | Request): Promise<Response> => {
      if (String(url).includes("feedList")) {
        listRequests += 1;
        return new Response([
          "Advertiser ID,Advertiser Name,Primary Region,Membership Status,Feed ID,Feed Name,Language,Vertical,Last Imported,URL",
          `20282,Amazonliss,US,Joined,a,Default,English,General,2026-09-09 ${changed ? "01:30:00" : "00:30:00"},https://productdata.awin.com/private/a.gz`
        ].join("\r\n"));
      }
      return changed ? new Response("invalid archive", { status }) : new Response(responseBody(fixtureArchive()));
    };
    await createAwinFeedController(parseAwinFeedServiceEnvironment(input), { fetch: fetchRequest }).refresh();
    changed = true;
    listRequests = 0;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const settlements = refreshSettlements();
    const runtime = await startAwinFeedRuntime(input, { fetch: fetchRequest, random: () => 0, writeLog: settlements.writeLog });
    try {
      expect(await settlements.next()).toMatchObject({ quickRetryScheduled: retry, consecutiveRefreshFailures: 1 });
      await vi.advanceTimersByTimeAsync(60_000);
      if (retry) expect(await settlements.next()).toMatchObject({ consecutiveRefreshFailures: 2 });
      expect(listRequests).toBe(retry ? 2 : 1);
    } finally {
      await runtime.close();
    }
  });

  it.each([
    { failure: "invalid archive", status: 200, retry: false },
    { failure: "local quota", status: 200, retry: false },
    { failure: "upstream 503", status: 503, retry: true },
    { failure: "upstream 429", status: 429, retry: true }
  ])("schedules compensating refresh only for temporary failures: $failure", async ({ failure, status, retry }) => {
    const directory = await mkdtemp(join(tmpdir(), "awin-runtime-retry-"));
    directories.push(directory);
    const dataPath = join(directory, "current.csv.gz");
    const currentTime = new Date("2026-09-09T01:00:00Z");
    if (failure === "local quota") {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await recordSourceRequest(feedStatePaths(dataPath).requestLedgerPath, sourceFeedKeyHash("direct:1"), currentTime);
      }
    }
    const port = await availablePort();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const logs: string[] = [];
    const settlements = refreshSettlements();
    const runtime = await startAwinFeedRuntime({
      AWIN_SOURCE_FEED_URL: "https://productdata.awin.com/private/feed.gz",
      AWIN_FEED_API_TOKEN: "t".repeat(32), AWIN_FEED_DATA_PATH: dataPath,
      AWIN_FEED_SERVICE_HOST: "127.0.0.1", AWIN_FEED_SERVICE_PORT: String(port),
      AWIN_SOURCE_RETRY_ATTEMPTS: "0", AWIN_REFRESH_INTERVAL_MINUTES: "360"
    }, {
      fetch: async () => new Response("invalid archive", { status }),
      now: () => currentTime, random: () => 0, writeLog: message => { logs.push(message); settlements.writeLog(message); }
    });
    const failures = (): number => logs.filter(message => message.includes("awin_feed_refresh_failed")).length;
    try {
      expect(await settlements.next()).toMatchObject({ quickRetryScheduled: retry, consecutiveRefreshFailures: 1 });
      await vi.advanceTimersByTimeAsync(60_000);
      if (retry) expect(await settlements.next()).toMatchObject({ consecutiveRefreshFailures: 2 });
      expect(failures()).toBe(retry ? 2 : 1);
    } finally {
      await runtime.close();
    }
  });

  it("listens before the initial source refresh completes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-awin-runtime-"));
    directories.push(directory);
    const port = await availablePort();
    const dataPath = join(directory, "current.csv.gz");
    await writeFile(dataPath, fixtureArchive());
    await utimes(dataPath, new Date("2026-08-25T00:00:00.000Z"), new Date("2026-08-25T00:00:00.000Z"));
    let resolveSource!: (response: Response) => void;
    const sourceResponse = new Promise<Response>((resolve) => { resolveSource = resolve; });
    const logs: string[] = [];
    const runtime = await startAwinFeedRuntime({
      AWIN_SOURCE_FEED_URL: "https://productdata.awin.com/private/feed.csv.gz",
      AWIN_FEED_API_TOKEN: "r".repeat(32),
      AWIN_FEED_DATA_PATH: dataPath,
      AWIN_FEED_SERVICE_HOST: "127.0.0.1",
      AWIN_FEED_SERVICE_PORT: String(port),
      AWIN_SOURCE_RETRY_BASE_DELAY_MS: "100"
    }, {
      fetch: async () => sourceResponse,
      now: () => new Date("2026-08-26T00:00:01.000Z"),
      writeLog: (message) => logs.push(message)
    });
    const origin = `http://127.0.0.1:${port}`;
    try {
      const health = await fetch(`${origin}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ feedStatus: "ready", feedRows: 1 });
      expect((await fetch(`${origin}/ready`)).status).toBe(200);
      expect(logs.some((message) => message.includes("awin_feed_snapshot_stale"))).toBe(true);

      resolveSource(new Response(responseBody(fixtureArchive()), { status: 200 }));
      await eventuallyReady(origin);
    } finally {
      await runtime.close();
    }
  });

  it("keeps compensating retries inside the 1 through 10 minute window", () => {
    expect(quickRetryDelayMs(0, () => 0)).toBe(60_000);
    expect(quickRetryDelayMs(1, () => 0.5)).toBe(132_000);
    expect(quickRetryDelayMs(2, () => 1)).toBe(360_000);
    expect(quickRetryDelayMs(3, () => 1)).toBe(600_000);
    expect(quickRetryDelayMs(99, () => 1)).toBe(600_000);
  });
});

function refreshSettlements(): { writeLog(message: string): void; next(): Promise<Record<string, unknown>> } {
  const ready: Array<Record<string, unknown>> = [];
  const waiting: Array<(event: Record<string, unknown>) => void> = [];
  return {
    writeLog(message) {
      if (!message.startsWith("[awin-feed-refresh] ")) return;
      const event = JSON.parse(message.slice("[awin-feed-refresh] ".length)) as Record<string, unknown>;
      if (event.event !== "awin_feed_refresh_settled") return;
      const resolve = waiting.shift();
      if (resolve === undefined) ready.push(event);
      else resolve(event);
    },
    next() {
      const event = ready.shift();
      return event === undefined ? new Promise(resolve => waiting.push(resolve)) : Promise.resolve(event);
    }
  };
}

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test server did not bind TCP");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function eventuallyReady(origin: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const ready = await fetch(`${origin}/ready`);
    if (ready.status === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("runtime did not publish the refreshed Feed");
}

function fixtureArchive(): Buffer {
  const header = [
    "aw_deep_link", "product_name", "merchant_product_id", "merchant_image_url", "description",
    "merchant_category", "search_price", "merchant_name", "merchant_id", "category_name", "currency",
    "merchant_deep_link", "in_stock"
  ];
  const row = [
    "https://www.awin1.com/pclick.php?p=1&a=3047955&m=20282", "Amazonliss Keratin Mask", "sku-1",
    "https://cdn.shopify.com/image.jpg", "Amazonliss Keratin Mask", "Products", "19.99",
    "Amazonliss (US)", "20282", "Products", "USD", "https://www.nutreecosmetics.com/products/sku-1", "1"
  ];
  return gzipSync([header, row].map((values) => values.map(csvCell).join(",")).join("\r\n"));
}

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function responseBody(value: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(value.byteLength);
  new Uint8Array(output).set(value);
  return output;
}
