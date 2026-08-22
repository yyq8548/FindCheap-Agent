import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseAwinFeedServiceEnvironment } from "../src/environment.js";
import { createAwinFeedController, createAwinFeedHttpServer } from "../src/service.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Awin Feed service", () => {
  it("uses Railway PORT when the service-specific port is absent", () => {
    const environment = parseAwinFeedServiceEnvironment({
      AWIN_SOURCE_FEED_URL: "https://productdata.awin.com/feed.csv.gz",
      AWIN_FEED_API_TOKEN: "a".repeat(32),
      PORT: "8080"
    });

    expect(environment.port).toBe(8080);
  });

  it("requires an allowlisted HTTPS Awin source and a strong API token", () => {
    expect(() => parseAwinFeedServiceEnvironment({
      AWIN_SOURCE_FEED_URL: "https://evil.example/feed.csv.gz",
      AWIN_FEED_API_TOKEN: "x".repeat(32)
    })).toThrow("allowed host");
    expect(() => parseAwinFeedServiceEnvironment({
      AWIN_SOURCE_FEED_URL: "https://productdata.awin.com/feed.csv.gz",
      AWIN_FEED_API_TOKEN: "short"
    })).toThrow("32 through 512");
  });

  it("downloads, validates, and atomically persists an approved Feed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-awin-service-"));
    directories.push(directory);
    const dataPath = join(directory, "current.csv.gz");
    const archive = fixtureArchive();
    const fetchRequest = vi.fn(async () => new Response(responseBody(archive), {
      status: 200,
      headers: { "content-type": "application/gzip", "content-length": String(archive.byteLength) }
    }));
    const environment = parseAwinFeedServiceEnvironment({
      AWIN_SOURCE_FEED_URL: "https://productdata.awin.com/private/feed.csv.gz",
      AWIN_FEED_API_TOKEN: "t".repeat(32),
      AWIN_FEED_DATA_PATH: dataPath
    });
    const controller = createAwinFeedController(environment, {
      fetch: fetchRequest,
      now: () => new Date("2026-08-22T01:00:00.000Z")
    });

    await controller.refresh();

    expect(fetchRequest).toHaveBeenCalledWith(environment.sourceUrl, expect.objectContaining({
      redirect: "error",
      signal: expect.any(AbortSignal)
    }));
    expect(controller.getState()).toMatchObject({
      snapshot: { snapshotAt: "2026-08-22T01:00:00.000Z", feedRows: 1 },
      lastRefreshAt: "2026-08-22T01:00:00.000Z"
    });
    expect(await readFile(dataPath)).toEqual(Buffer.from(archive));
  });

  it("serves only authenticated snapshots and exposes bounded health metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-awin-http-"));
    directories.push(directory);
    const token = "s".repeat(32);
    const archive = fixtureArchive();
    const environment = parseAwinFeedServiceEnvironment({
      AWIN_SOURCE_FEED_URL: "https://productdata.awin.com/private/feed.csv.gz",
      AWIN_FEED_API_TOKEN: token,
      AWIN_FEED_DATA_PATH: join(directory, "current.csv.gz")
    });
    const controller = createAwinFeedController(environment, {
      fetch: async () => new Response(responseBody(archive), { status: 200 }),
      now: () => new Date("2026-08-22T01:00:00.000Z")
    });
    await controller.refresh();
    const server = createAwinFeedHttpServer(controller, token);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind TCP");
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      expect((await fetch(`${origin}/v1/feed`)).status).toBe(401);
      const feed = await fetch(`${origin}/v1/feed`, { headers: { authorization: `Bearer ${token}` } });
      expect(feed.status).toBe(200);
      expect(feed.headers.get("x-feed-row-count")).toBe("1");
      expect(feed.headers.get("x-feed-snapshot-at")).toBe("2026-08-22T01:00:00.000Z");
      expect(Buffer.from(await feed.arrayBuffer())).toEqual(Buffer.from(archive));
      expect(await (await fetch(`${origin}/health`)).json()).toMatchObject({
        status: "ok",
        feedStatus: "ready",
        feedRows: 1
      });
      expect(await (await fetch(`${origin}/ready`)).json()).toMatchObject({
        feedStatus: "ready",
        feedRows: 1
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("keeps liveness healthy while reporting a missing Feed as not ready", async () => {
    const environment = parseAwinFeedServiceEnvironment({
      AWIN_SOURCE_FEED_URL: "https://productdata.awin.com/private/feed.csv.gz",
      AWIN_FEED_API_TOKEN: "u".repeat(32)
    });
    const controller = createAwinFeedController(environment);
    const server = createAwinFeedHttpServer(controller, environment.apiToken);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind TCP");
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      const health = await fetch(`${origin}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok", feedStatus: "unavailable" });
      const ready = await fetch(`${origin}/ready`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toEqual({ feedStatus: "unavailable" });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("reports a bounded refresh failure code without exposing the source URL", async () => {
    const environment = parseAwinFeedServiceEnvironment({
      AWIN_SOURCE_FEED_URL: "https://productdata.awin.com/private/feed.csv.gz",
      AWIN_FEED_API_TOKEN: "v".repeat(32)
    });
    const controller = createAwinFeedController(environment, {
      fetch: async () => new Response(null, { status: 403 }),
      now: () => new Date("2026-08-22T02:00:00.000Z")
    });

    await expect(controller.refresh()).rejects.toThrow("HTTP 403");

    expect(controller.getState()).toMatchObject({
      lastErrorAt: "2026-08-22T02:00:00.000Z",
      lastErrorCode: "SOURCE_HTTP_ERROR"
    });
    expect(JSON.stringify(controller.getState())).not.toContain(environment.sourceUrl);
  });
});

function fixtureArchive(): Buffer {
  const header = [
    "aw_deep_link", "product_name", "merchant_product_id", "merchant_image_url", "description",
    "merchant_category", "search_price", "merchant_name", "merchant_id", "category_name", "currency",
    "merchant_deep_link", "in_stock"
  ];
  const row = [
    "https://www.awin1.com/pclick.php?p=1&a=3047955&m=20282", "Amazonliss Keratin Mask", "sku-1",
    "https://cdn.shopify.com/image.jpg", "Keratin repair mask", "Hair Care", "19.99", "Amazonliss (US)",
    "20282", "Haircare", "USD", "https://www.nutreecosmetics.com/products/keratin-mask", "1"
  ];
  return gzipSync([header, row].map((values) => values.join(",")).join("\r\n"));
}

function responseBody(value: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(value.byteLength);
  new Uint8Array(output).set(value);
  return output;
}
