import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseAwinFeedServiceEnvironment } from "../src/environment.js";
import { createAwinOffersController } from "../src/offers.js";
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
    expect(environment.offers).toBeUndefined();
  });

  it("enables the Awin Offers cache only when a publisher API token is configured", () => {
    const environment = parseAwinFeedServiceEnvironment({
      AWIN_SOURCE_FEED_URL: "https://productdata.awin.com/feed.csv.gz",
      AWIN_FEED_API_TOKEN: "a".repeat(32),
      AWIN_API_TOKEN: "b".repeat(40)
    });

    expect(environment.offers).toEqual({
      apiToken: "b".repeat(40),
      publisherId: "3047955",
      dataPath: "/data/offers.json",
      refreshIntervalMs: 3_600_000,
      sourceTimeoutMs: 15_000
    });
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

  it("accepts a Feed List as the only source and upgrades allowlisted download URLs to HTTPS", () => {
    const environment = parseAwinFeedServiceEnvironment({
      AWIN_SOURCE_FEED_LIST_URL: "https://ui.awin.com/private/feedList",
      AWIN_FEED_API_TOKEN: "l".repeat(32)
    });

    expect(environment.sourceUrls).toEqual([]);
    expect(environment.sourceFeedListUrl).toBe("https://ui.awin.com/private/feedList");
    expect(environment.sourceFeedRegion).toBe("US");
    expect(environment.sourceFeedLanguage).toBe("English");
  });

  it("discovers every joined US English Feed and ignores other visible advertisers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-awin-list-"));
    directories.push(directory);
    const dataPath = join(directory, "current.csv.gz");
    const feedListUrl = "https://ui.awin.com/private/feedList";
    const feeds = new Map<string, Buffer>([
      ["https://productdata.awin.com/private/20282-102.csv.gz", enhancedFixtureArchive()],
      ["https://productdata.awin.com/private/77777-200.csv.gz", minimalFixtureArchive({
        merchantId: "77777",
        merchantName: "New Merchant Legal LLC",
        merchantHost: "new-merchant.example",
        productName: "New Merchant Headphones",
        merchantProductId: "headphones-1"
      })],
      ["https://productdata.awin.com/private/77777-201.csv.gz", fixtureArchive({
        merchantId: "77777",
        merchantName: "New Merchant",
        merchantHost: "new-merchant.example",
        productName: "New Merchant Camera",
        merchantProductId: "camera-1"
      })]
    ]);
    const list = feedListCsv([
      ["20282", "Amazonliss (US)", "US", "active", "F102", "Default", "English", "General", "2026-08-25 01:00:00", "http://productdata.awin.com/private/20282-102.csv.gz"],
      ["77777", "New Merchant", "US", "Joined", "200", "Audio", "English", "Audio", "2026-08-25 02:00:00", "https://productdata.awin.com/private/77777-200.csv.gz"],
      ["77777", "New Merchant", "US", "Joined", "201", "Cameras", "English", "Cameras", "2026-08-25 03:00:00", "https://productdata.awin.com/private/77777-201.csv.gz"],
      ["77777", "New Merchant", "US", "Joined", "201", "Cameras", "English", "Cameras", "2026-08-24 03:00:00", "https://productdata.awin.com/private/obsolete.csv.gz"],
      ["88888", "Visible Merchant", "US", "Not Joined", "300", "Default", "English", "General", "2026-08-25 04:00:00", "https://productdata.awin.com/private/not-joined.csv.gz"],
      ["99998", "Canada Merchant", "CA", "Joined", "400", "Default", "English", "General", "2026-08-25 04:00:00", "https://productdata.awin.com/private/canada.csv.gz"],
      ["99999", "Spanish Merchant", "US", "Joined", "500", "Default", "Spanish", "General", "2026-08-25 04:00:00", "https://productdata.awin.com/private/spanish.csv.gz"]
    ]);
    const fetchRequest = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === feedListUrl) return new Response(list, { status: 200, headers: { "content-type": "text/csv" } });
      const archive = feeds.get(url);
      return archive === undefined
        ? new Response(null, { status: 404 })
        : new Response(responseBody(archive), { status: 200, headers: { "content-type": "application/gzip" } });
    });
    const environment = parseAwinFeedServiceEnvironment({
      AWIN_SOURCE_FEED_LIST_URL: feedListUrl,
      AWIN_SOURCE_FEED_URL: "https://productdata.awin.com/private/ignored-direct.csv.gz",
      AWIN_FEED_API_TOKEN: "f".repeat(32),
      AWIN_FEED_DATA_PATH: dataPath
    });
    const controller = createAwinFeedController(environment, {
      fetch: fetchRequest,
      now: () => new Date("2026-08-25T05:00:00.000Z")
    });

    await controller.refresh();

    expect(fetchRequest.mock.calls.map(([input]) => String(input))).toEqual([feedListUrl, ...feeds.keys()]);
    expect(controller.getState()).toMatchObject({
      snapshot: { feedRows: 3, sourceFeeds: 3 },
      lastRefreshAt: "2026-08-25T05:00:00.000Z"
    });
  });

  it("omits zero-price placeholders from Feed List snapshots", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-awin-zero-price-"));
    directories.push(directory);
    const feedListUrl = "https://ui.awin.com/private/feedList";
    const feedUrl = "https://productdata.awin.com/private/zero-price.csv.gz";
    const archive = enhancedFixtureArchive(["19.99 USD", "0.00 USD"]);
    const fetchRequest = vi.fn(async (input: string | URL | Request) => String(input) === feedListUrl
      ? new Response(feedListCsv([
          ["20282", "Amazonliss (US)", "US", "Joined", "F102", "Default", "English", "General", "2026-08-25 01:00:00", feedUrl]
        ]), { status: 200 })
      : new Response(responseBody(archive), { status: 200 }));
    const controller = createAwinFeedController(parseAwinFeedServiceEnvironment({
      AWIN_SOURCE_FEED_LIST_URL: feedListUrl,
      AWIN_FEED_API_TOKEN: "z".repeat(32),
      AWIN_FEED_DATA_PATH: join(directory, "current.csv.gz")
    }), { fetch: fetchRequest });

    await controller.refresh();

    expect(controller.getState()).toMatchObject({
      snapshot: { feedRows: 1, sourceFeeds: 1 }
    });
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

    expect(fetchRequest).toHaveBeenCalledWith(environment.sourceUrls[0], expect.objectContaining({
      redirect: "error",
      signal: expect.any(AbortSignal)
    }));
    expect(controller.getState()).toMatchObject({
      snapshot: { snapshotAt: "2026-08-22T01:00:00.000Z", feedRows: 1 },
      lastRefreshAt: "2026-08-22T01:00:00.000Z"
    });
    expect(await readFile(dataPath)).toEqual(Buffer.from(archive));
  });

  it("merges multiple approved merchant Feeds into one validated snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-awin-multi-"));
    directories.push(directory);
    const dataPath = join(directory, "current.csv.gz");
    const amazonliss = fixtureArchive();
    const gardepro = fixtureArchive({
      merchantId: "49085",
      merchantName: "GardePro",
      merchantHost: "gardeproshop.com",
      productName: "GardePro Trail Camera",
      merchantProductId: "gardepro-1"
    }, { brand_name: "GardePro" });
    const watches = fixtureArchive({
      merchantId: "116479",
      merchantName: "Watches Of USA",
      merchantHost: "watchesofusa.com",
      productName: "Citizen Watch",
      merchantProductId: "watch-1"
    });
    const cangyu = fixtureArchive({
      merchantId: "99013",
      merchantName: "Shenzhen Cangyu Technology Co., Ltd.",
      merchantHost: "simpleprojectus.com",
      productName: "SNFLEX Macerating Toilet",
      merchantProductId: "toilet-1"
    });
    const archives = new Map([
      ["amazonliss", amazonliss],
      ["gardepro", gardepro],
      ["watches", watches],
      ["cangyu", cangyu]
    ]);
    const fetchRequest = vi.fn(async (input: string | URL | Request) => {
      const key = [...archives.keys()].find((candidate) => String(input).includes(candidate));
      return new Response(responseBody(key === undefined ? amazonliss : archives.get(key)!), {
        status: 200,
        headers: { "content-type": "application/gzip" }
      });
    });
    const environment = parseAwinFeedServiceEnvironment({
      AWIN_SOURCE_FEED_URL: "https://productdata.awin.com/private/amazonliss.csv.gz",
      AWIN_SOURCE_FEED_URL_2: "https://productdata.awin.com/private/gardepro.csv.gz",
      AWIN_SOURCE_FEED_URL_3: "https://productdata.awin.com/private/watches.csv.gz",
      AWIN_SOURCE_FEED_URL_4: "https://productdata.awin.com/private/cangyu.csv.gz",
      AWIN_FEED_API_TOKEN: "m".repeat(32),
      AWIN_FEED_DATA_PATH: dataPath
    });
    const controller = createAwinFeedController(environment, {
      fetch: fetchRequest,
      now: () => new Date("2026-08-25T05:00:00.000Z")
    });

    await controller.refresh();

    expect(fetchRequest).toHaveBeenCalledTimes(4);
    expect(controller.getState()).toMatchObject({
      snapshot: { feedRows: 4, sourceFeeds: 4 },
      lastRefreshAt: "2026-08-25T05:00:00.000Z"
    });
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
    const offers = createAwinOffersController({
      apiToken: "o".repeat(40), publisherId: "3047955", dataPath: join(directory, "offers.json"),
      refreshIntervalMs: 3_600_000, sourceTimeoutMs: 15_000
    }, {
      fetch: async () => new Response(JSON.stringify([{ promotionId: 1, type: "voucher",
        advertiser: { id: 20282, name: "Amazonliss (US)", joined: true }, title: "Save ten percent",
        description: "Selected hair products", terms: "Online orders only", startDate: "2026-08-01T00:00:00",
        endDate: "2026-09-01T00:00:00", urlTracking: "https://www.awin1.com/cread.php?awinmid=20282&awinaffid=3047955",
        regions: { all: false, list: [{ countryCode: "US" }] }, voucher: { code: "SAVE10" } }]),
      { headers: { "content-type": "application/json" } }),
      now: () => new Date("2026-08-22T01:00:00.000Z")
    });
    await offers.refresh();
    const server = createAwinFeedHttpServer(controller, token, {
      offers,
      officialStorefronts: environment.officialStorefronts,
      merchantTrust: environment.merchantTrust
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind TCP");
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      expect((await fetch(`${origin}/v1/feed`)).status).toBe(401);
      const publicSearch = await fetch(`${origin}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "keratin mask", limit: 3 })
      });
      expect(publicSearch.status).toBe(200);
      expect(await publicSearch.json()).toMatchObject({
        source: "AWIN_PRODUCT_FEED",
        coverage: "COMPLETE",
        diagnostics: { feedRows: 1, validRows: 1, queryMatches: 1 },
        products: [{ merchantId: "20282", merchantProductId: "sku-1" }]
      });
      const feed = await fetch(`${origin}/v1/feed`, { headers: { authorization: `Bearer ${token}` } });
      expect(feed.status).toBe(200);
      expect(feed.headers.get("x-feed-row-count")).toBe("1");
      expect(feed.headers.get("x-feed-snapshot-at")).toBe("2026-08-22T01:00:00.000Z");
      expect(Buffer.from(await feed.arrayBuffer())).toEqual(Buffer.from(archive));
      expect(await (await fetch(`${origin}/health`)).json()).toMatchObject({
        status: "ok",
        feedStatus: "ready",
        feedRows: 1,
        offersStatus: "ready",
        offerRows: 1
      });
      const offerSearch = await fetch(`${origin}/v1/offers/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ merchant: "Amazonliss (US)", channel: "ONLINE" })
      });
      expect(offerSearch.status).toBe(200);
      expect(await offerSearch.json()).toMatchObject({ deals: [{ code: "SAVE10", verificationStatus: "VERIFIED" }] });
      expect(await (await fetch(`${origin}/ready`)).json()).toMatchObject({
        feedStatus: "ready",
        feedRows: 1
      });
      const registry = await fetch(`${origin}/v1/official-storefronts`);
      expect(registry.status).toBe(200);
      expect(await registry.json()).toMatchObject({
        version: "official-storefronts-2026-08-28",
        stores: expect.arrayContaining([expect.objectContaining({
          brand: "Free People",
          officialHost: "freepeople.com",
          platform: "GENERIC_JSON_LD"
        })])
      });
      const cachedRegistry = await fetch(`${origin}/v1/official-storefronts`, {
        headers: { "if-none-match": registry.headers.get("etag")! }
      });
      expect(cachedRegistry.status).toBe(304);
      const merchantTrust = await fetch(`${origin}/v1/merchant-trust`);
      expect(merchantTrust.status).toBe(200);
      expect(await merchantTrust.json()).toMatchObject({
        version: "merchant-trust-2026-08-28",
        merchants: expect.arrayContaining([expect.objectContaining({
          host: "bestbuy.com",
          level: "ESTABLISHED_RETAILER",
          status: "APPROVED"
        })])
      });
      const cachedMerchantTrust = await fetch(`${origin}/v1/merchant-trust`, {
        headers: { "if-none-match": `W/${merchantTrust.headers.get("etag")!}` }
      });
      expect(cachedMerchantTrust.status).toBe(304);
      expect((await fetch(`${origin}/v1/search`)).status).toBe(405);
      expect((await fetch(`${origin}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "x", limit: 3 })
      })).status).toBe(400);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("rate-limits public search without exposing the Feed token", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-awin-rate-"));
    directories.push(directory);
    const token = "z".repeat(32);
    const environment = parseAwinFeedServiceEnvironment({
      AWIN_SOURCE_FEED_URL: "https://productdata.awin.com/private/feed.csv.gz",
      AWIN_FEED_API_TOKEN: token,
      AWIN_FEED_DATA_PATH: join(directory, "current.csv.gz")
    });
    const controller = createAwinFeedController(environment, {
      fetch: async () => new Response(responseBody(fixtureArchive()), { status: 200 }),
      now: () => new Date("2026-08-25T05:30:00.000Z")
    });
    await controller.refresh();
    const server = createAwinFeedHttpServer(controller, token, {
      publicSearchLimitPerMinute: 1,
      now: () => Date.parse("2026-08-25T05:30:00.000Z")
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind TCP");
    const request = () => fetch(`http://127.0.0.1:${address.port}/v1/search`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.10"
      },
      body: JSON.stringify({ query: "keratin mask", limit: 3 })
    });
    try {
      expect((await request()).status).toBe(200);
      const limited = await request();
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("60");
      expect(await limited.json()).toEqual({ error: "RATE_LIMITED" });
      expect(JSON.stringify(await (await fetch(`http://127.0.0.1:${address.port}/health`)).json()))
        .not.toContain(token);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("proxies only image URLs present in the validated Feed snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-awin-image-"));
    directories.push(directory);
    const token = "i".repeat(32);
    const environment = parseAwinFeedServiceEnvironment({
      AWIN_SOURCE_FEED_URL: "https://productdata.awin.com/private/feed.csv.gz",
      AWIN_FEED_API_TOKEN: token,
      AWIN_FEED_DATA_PATH: join(directory, "current.csv.gz")
    });
    const controller = createAwinFeedController(environment, {
      fetch: async () => new Response(responseBody(fixtureArchive()), { status: 200 }),
      now: () => new Date("2026-08-25T05:30:00.000Z")
    });
    await controller.refresh();
    const imageFetch = vi.fn(async (url: string) => {
      expect([
        "https://cdn.shopify.com/image.jpg",
        "https://images.urbndata.com/is/image/FreePeople/106973258_011_oi"
      ]).toContain(url);
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" }
      });
    });
    const server = createAwinFeedHttpServer(controller, token, {
      imageFetch,
      officialStorefronts: environment.officialStorefronts
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind TCP");
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      const image = await fetch(`${origin}/v1/images?merchantId=20282&merchantProductId=sku-1`);
      expect(image.status).toBe(200);
      expect(image.headers.get("content-type")).toBe("image/jpeg");
      expect(image.headers.get("x-content-type-options")).toBe("nosniff");
      expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
      expect(imageFetch).toHaveBeenCalledOnce();

      const officialImageUrl = "https://images.urbndata.com/is/image/FreePeople/106973258_011_oi";
      const officialImage = await fetch(`${origin}/v1/official-images?url=${encodeURIComponent(officialImageUrl)}`);
      expect(officialImage.status).toBe(200);
      expect(imageFetch).toHaveBeenLastCalledWith(officialImageUrl);
      expect((await fetch(`${origin}/v1/official-images?url=${encodeURIComponent("https://evil.example/image.jpg")}`)).status).toBe(400);

      expect((await fetch(`${origin}/v1/images?merchantId=20282&merchantProductId=missing`)).status).toBe(404);
      expect((await fetch(`${origin}/v1/images?merchantId=bad&merchantProductId=sku-1`)).status).toBe(400);
      expect(imageFetch).toHaveBeenCalledTimes(2);
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
    for (const sourceUrl of environment.sourceUrls) {
      expect(JSON.stringify(controller.getState())).not.toContain(sourceUrl);
    }
  });
});

function fixtureArchive(overrides: {
  merchantId?: string;
  merchantName?: string;
  merchantHost?: string;
  productName?: string;
  merchantProductId?: string;
} = {}, extraFields: Record<string, string> = {}): Buffer {
  const merchantId = overrides.merchantId ?? "20282";
  const merchantName = overrides.merchantName ?? "Amazonliss (US)";
  const merchantHost = overrides.merchantHost ?? "www.nutreecosmetics.com";
  const productName = overrides.productName ?? "Amazonliss Keratin Mask";
  const merchantProductId = overrides.merchantProductId ?? "sku-1";
  const header = [
    "aw_deep_link", "product_name", "merchant_product_id", "merchant_image_url", "description",
    "merchant_category", "search_price", "merchant_name", "merchant_id", "category_name", "currency",
    "merchant_deep_link", "in_stock", ...Object.keys(extraFields)
  ];
  const row = [
    `https://www.awin1.com/pclick.php?p=1&a=3047955&m=${merchantId}`, productName, merchantProductId,
    "https://cdn.shopify.com/image.jpg", productName, "Products", "19.99", merchantName,
    merchantId, "Products", "USD", `https://${merchantHost}/products/${merchantProductId}`, "1",
    ...Object.values(extraFields)
  ];
  return gzipSync([header, row].map((values) => values.map(csvCell).join(",")).join("\r\n"));
}

function enhancedFixtureArchive(prices = ["19.99 USD"]): Buffer {
  const header = [
    "\uFEFFadvertiser_id", "advertiser_name", "id", "title", "description", "link", "image_link",
    "aw_deep_link", "google_product_category", "product_type", "gtin", "mpn", "brand",
    "availability", "price", "sale_price", "condition"
  ];
  const rows = prices.map((price, index) => {
    const id = `sku-${index + 1}`;
    return [
      "20282", "Amazonliss (US)", id, `Amazonliss Keratin Mask ${index + 1}`, "Amazonliss Keratin Mask",
      `https://www.nutreecosmetics.com/products/${id}`, "https://cdn.shopify.com/image.jpg",
      `https://www.awin1.com/cread.php?awinmid=20282&awinaffid=3047955&ued=https%3A%2F%2Fwww.nutreecosmetics.com%2Fproducts%2F${id}`, "Health & Beauty > Hair Care", "Hair Care",
      "", "", "Amazonliss", "in_stock", price, "", "new"
    ];
  });
  return gzipSync([header, ...rows].map((values) => values.map(csvCell).join(",")).join("\r\n"));
}

function minimalFixtureArchive(overrides: {
  merchantId: string;
  merchantName: string;
  merchantHost: string;
  productName: string;
  merchantProductId: string;
}): Buffer {
  const header = [
    "aw_deep_link", "product_name", "merchant_product_id", "description", "merchant_category",
    "search_price", "merchant_name", "merchant_id", "merchant_deep_link"
  ];
  const row = [
    `https://www.awin1.com/pclick.php?p=1&a=3047955&m=${overrides.merchantId}`,
    overrides.productName, overrides.merchantProductId, overrides.productName, "Products", "19.99",
    overrides.merchantName, overrides.merchantId,
    `https://${overrides.merchantHost}/products/${overrides.merchantProductId}`
  ];
  return gzipSync([header, row].map((values) => values.map(csvCell).join(",")).join("\r\n"));
}

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function feedListCsv(rows: string[][]): string {
  return [
    ["Advertiser ID", "Advertiser Name", "Primary Region", "Membership Status", "Feed ID", "Feed Name", "Language", "Vertical", "Last Imported", "URL"],
    ...rows
  ].map((values) => values.map(csvCell).join(",")).join("\r\n");
}

function responseBody(value: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(value.byteLength);
  new Uint8Array(output).set(value);
  return output;
}
