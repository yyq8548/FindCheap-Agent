import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import { parseAwinFeedServiceEnvironment } from "../src/environment.js";
import { createAwinFeedController, createAwinFeedHttpServer } from "../src/service.js";
import { feedStatePaths, loadFeedCacheManifest } from "../src/source-cache.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

it("keeps validated source cache metadata after an aggregate failure across retries and restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "awin-aggregate-recovery-"));
  directories.push(directory);
  const dataPath = join(directory, "current.csv.gz");
  const environment = parseAwinFeedServiceEnvironment({
    AWIN_SOURCE_FEED_LIST_URL: "https://ui.awin.com/private/feedList",
    AWIN_FEED_API_TOKEN: "t".repeat(32), AWIN_FEED_DATA_PATH: dataPath
  });
  let changed = false;
  let downloads = 0;
  const dependencies = {
    now: () => new Date(changed ? "2026-09-09T02:00:00Z" : "2026-09-09T01:00:00Z"),
    fetch: async (input: string | URL | Request) => {
      if (String(input).includes("feedList")) return new Response(feedList(changed));
      downloads += 1;
      const sku = String(input).endsWith("b.gz") && !changed ? "sku-b" : "sku-a";
      return new Response(new Uint8Array(archive([sku], changed && String(input).endsWith("b.gz") ? { "sku-a": "9.99" } : {})));
    }
  };
  const controller = createAwinFeedController(environment, dependencies);
  await controller.refresh();
  const published = await readFile(dataPath);
  const originalTime = controller.getState().lastSuccessfulRefreshAt;
  changed = true;
  await expect(controller.refresh()).rejects.toThrow();
  const metadata = await loadFeedCacheManifest(feedStatePaths(dataPath).manifestPath);
  expect(metadata.sources.map(entry => entry.importedAt)).toEqual([
    "2026-09-09T01:30:00.000Z", "2026-09-09T01:30:00.000Z"
  ]);
  expect(downloads).toBe(4);
  await expect(controller.refresh()).rejects.toThrow();
  expect(downloads).toBe(4);
  const restored = createAwinFeedController(environment, dependencies);
  await restored.loadExisting();
  await expect(restored.refresh()).rejects.toThrow();
  expect(downloads).toBe(4);
  expect(await readFile(dataPath)).toEqual(published);
  expect(restored.getState().lastSuccessfulRefreshAt).toBe(originalTime);
  expect(restored.search({ query: "keratin", limit: 3 })?.products).toHaveLength(2);
});

it("publishes only unambiguous products, exposes the filtering denominator after restart, and recomputes on change", async () => {
  const directory = await mkdtemp(join(tmpdir(), "awin-conflict-publish-"));
  directories.push(directory);
  const environment = parseAwinFeedServiceEnvironment({
    AWIN_SOURCE_FEED_LIST_URL: "https://ui.awin.com/private/feedList",
    AWIN_FEED_API_TOKEN: "t".repeat(32), AWIN_FEED_DATA_PATH: join(directory, "current.csv.gz")
  });
  let changed = false;
  const dependencies = {
    fetch: async (input: string | URL | Request) => {
      if (String(input).includes("feedList")) return new Response(feedList(changed));
      const id = String(input).endsWith("a.gz") ? "a" : "b";
      return new Response(new Uint8Array(archive(
        [changed ? `unique-${id}` : "overlap", changed ? `copy-${id}` : "duplicate", `keep-${id}`],
        !changed && id === "b" ? { overlap: "9.99" } : {}
      )));
    }
  };
  const controller = createAwinFeedController(environment, dependencies);
  await controller.refresh();
  const restored = createAwinFeedController(environment, dependencies);
  await restored.loadExisting();
  const server = createAwinFeedHttpServer(restored, environment.apiToken);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server not listening");
    const health = await (await fetch(`http://127.0.0.1:${address.port}/health`)).json();
    expect(health).toMatchObject({ feedRows: 3, sourceFeeds: 2, excludedSourceFeeds: 0,
      productCoverage: { inputRows: 6, excludedProductGroups: 1, excludedProductRows: 2, deduplicatedProductRows: 1 } });
    expect(restored.search({ query: "keratin", limit: 3 })?.products.map(product => product.merchantProductId).sort()).toEqual(["duplicate", "keep-a", "keep-b"]);
    changed = true;
    await restored.refresh();
    expect(restored.getState().snapshot).toMatchObject({ feedRows: 6,
      productCoverage: { inputRows: 6, excludedProductGroups: 0, excludedProductRows: 0, deduplicatedProductRows: 0 } });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

function feedList(changed: boolean): string {
  return [
    "Advertiser ID,Advertiser Name,Primary Region,Membership Status,Feed ID,Feed Name,Language,Vertical,Last Imported,URL",
    ...["a", "b"].map(id => `20282,Amazonliss,US,Joined,${id},Default,English,General,2026-09-09 ${changed ? "01:30:00" : "00:30:00"},https://productdata.awin.com/private/${id}.gz`)
  ].join("\r\n");
}

function archive(skus: string[], prices: Record<string, string> = {}): Buffer {
  const headers = "aw_deep_link,product_name,merchant_product_id,merchant_image_url,description,merchant_category,search_price,merchant_name,merchant_id,category_name,currency,merchant_deep_link,in_stock";
  return gzipSync([headers, ...skus.map(sku => `https://www.awin1.com/pclick.php?p=1&a=3047955&m=20282,Keratin mask ${sku},${sku},https://cdn.shopify.com/image.jpg,Mask,Products,${prices[sku] ?? "19.99"},Amazonliss,20282,Products,USD,https://www.nutreecosmetics.com/products/${sku},1`)].join("\r\n"));
}
