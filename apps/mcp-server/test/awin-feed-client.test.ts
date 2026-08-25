import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAwinFeedPort, parseAwinCsv } from "../../../packages/awin-feed/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Awin Product Feed", () => {
  it("parses quoted commas, escaped quotes, and embedded newlines", () => {
    const parsed = parseAwinCsv('name,description\r\n"Mask, 8 oz","Line 1\nLine ""2"""\r\n');

    expect(parsed.records).toEqual([{ name: "Mask, 8 oz", description: 'Line 1\nLine "2"' }]);
  });

  it("returns only approved Amazonliss rows as discovery affiliate results", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-awin-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "feed.csv.gz");
    const header = [
      "aw_deep_link", "product_name", "merchant_product_id", "merchant_image_url", "description",
      "merchant_category", "search_price", "merchant_name", "merchant_id", "category_name", "currency",
      "merchant_deep_link", "in_stock"
    ];
    const rows = [
      [
        "https://www.awin1.com/pclick.php?p=1&a=3047955&m=20282", "Amazonliss Keratin Mask", "sku-1",
        "https://cdn.shopify.com/image.jpg", "Keratin repair mask", "Hair Care", "19.99", "Amazonliss (US)",
        "20282", "Haircare", "USD", "https://www.nutreecosmetics.com/products/keratin-mask", "1"
      ],
      [
        "https://www.awin1.com/pclick.php?p=2&a=999&m=20282", "Tampered Keratin Mask", "sku-2", "",
        "Tampered", "Hair Care", "9.99", "Amazonliss (US)", "20282", "Haircare", "USD",
        "https://www.nutreecosmetics.com/products/tampered", "1"
      ]
    ];
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    await writeFile(path, gzipSync(csv));
    const timestamp = new Date("2026-08-21T23:32:40.000Z");
    await utimes(path, timestamp, timestamp);

    const result = await createAwinFeedPort({ AWIN_PRODUCT_FEED_PATH: path }).search({
      query: "keratin mask",
      limit: 3,
      maxItemPriceCents: 2_000
    });

    expect(result).toMatchObject({
      source: "AWIN_PRODUCT_FEED",
      coverage: "COMPLETE",
      snapshotAt: timestamp.toISOString(),
      diagnostics: { feedRows: 2, validRows: 1, rejectedRows: 1, queryMatches: 1 },
      products: [{
        merchantId: "20282",
        merchantProductId: "sku-1",
        matchStatus: "DISCOVERY_MATCH",
        condition: "UNKNOWN",
        itemPrice: { amountCents: 1_999, currency: "USD" },
        availability: "IN_STOCK",
        affiliateUrl: "https://www.awin1.com/pclick.php?p=1&a=3047955&m=20282"
      }]
    });
  });

  it("accepts approved GardePro rows and rejects mismatched affiliate links", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-awin-gardepro-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "feed.csv.gz");
    const header = [
      "aw_deep_link", "product_name", "merchant_product_id", "merchant_image_url", "description",
      "merchant_category", "search_price", "merchant_name", "merchant_id", "category_name", "currency",
      "merchant_deep_link", "in_stock"
    ];
    const rows = [
      [
        "https://www.awin1.com/pclick.php?p=3&a=3047955&m=49085", "GardePro Trail Camera", "tc-1",
        "https://images.example/trail-camera.jpg", "Wildlife hunting camera", "Trail Cameras", "59.99",
        "GardePro", "49085", "Cameras", "USD", "https://gardeproshop.com/products/tc-1", "1"
      ],
      [
        "https://www.awin1.com/pclick.php?p=4&a=3047955&m=20282", "Mismatched Trail Camera", "tc-2",
        "", "Invalid relationship", "Trail Cameras", "39.99", "GardePro", "49085", "Cameras", "USD",
        "https://gardeproshop.com/products/tc-2", "1"
      ]
    ];
    await writeFile(path, gzipSync([header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")));

    const result = await createAwinFeedPort({ AWIN_PRODUCT_FEED_PATH: path }).search({
      query: "GardePro trail camera",
      limit: 3
    });

    expect(result).toMatchObject({
      diagnostics: { feedRows: 2, validRows: 1, rejectedRows: 1, queryMatches: 1 },
      products: [{
        merchantId: "49085",
        merchant: "GardePro",
        merchantProductId: "tc-1",
        affiliateUrl: "https://www.awin1.com/pclick.php?p=3&a=3047955&m=49085"
      }]
    });
  });

  it("accepts approved Watches Of USA rows and rejects a mismatched merchant host", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-awin-watches-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "feed.csv.gz");
    const header = [
      "aw_deep_link", "product_name", "merchant_product_id", "merchant_image_url", "description",
      "merchant_category", "search_price", "merchant_name", "merchant_id", "category_name", "currency",
      "merchant_deep_link", "in_stock", "brand_name", "product_model", "product_GTIN"
    ];
    const rows = [
      [
        "https://www.awin1.com/pclick.php?p=5&a=3047955&m=116479", "Citizen Eco-Drive Watch", "watch-1",
        "https://images.example/citizen-watch.jpg", "Stainless steel wristwatch", "Watches", "199.99",
        "Watches Of USA", "116479", "Watches", "USD", "https://watchesofusa.com/products/watch-1", "1",
        "Citizen", "Eco-Drive", "0123456789012"
      ],
      [
        "https://www.awin1.com/pclick.php?p=6&a=3047955&m=116479", "Invalid Host Watch", "watch-2", "",
        "Invalid merchant host", "Watches", "99.99", "Watches Of USA", "116479", "Watches", "USD",
        "https://example.com/products/watch-2", "1", "Example", "Model 2", ""
      ]
    ];
    await writeFile(path, gzipSync([header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")));

    const result = await createAwinFeedPort({ AWIN_PRODUCT_FEED_PATH: path }).search({
      query: "Citizen 手表",
      limit: 3
    });

    expect(result).toMatchObject({
      diagnostics: { feedRows: 2, validRows: 1, rejectedRows: 1, queryMatches: 1 },
      products: [{
        merchantId: "116479",
        merchant: "Watches Of USA",
        merchantProductId: "watch-1",
        affiliateUrl: "https://www.awin1.com/pclick.php?p=5&a=3047955&m=116479"
      }]
    });
  });

  it("reads an authenticated remote Feed service before the local fallback", async () => {
    const archive = gzipSync([
      [
        "aw_deep_link", "product_name", "merchant_product_id", "merchant_image_url", "description",
        "merchant_category", "search_price", "merchant_name", "merchant_id", "category_name", "currency",
        "merchant_deep_link", "in_stock"
      ],
      [
        "https://www.awin1.com/pclick.php?p=1&a=3047955&m=20282", "Amazonliss Keratin Mask", "sku-1", "",
        "Keratin repair mask", "Hair Care", "19.99", "Amazonliss (US)", "20282", "Haircare", "USD",
        "https://www.nutreecosmetics.com/products/keratin-mask", "1"
      ]
    ].map((row) => row.map(csvCell).join(",")).join("\r\n"));
    const fetchRequest = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: `Bearer ${"r".repeat(32)}` });
      return new Response(archive, {
        status: 200,
        headers: {
          "content-type": "application/gzip",
          "x-feed-snapshot-at": "2026-08-22T01:00:00.000Z"
        }
      });
    });
    const port = createAwinFeedPort({
      AWIN_PRODUCT_FEED_URL: "https://feed.findcheap.example/v1/feed",
      AWIN_PRODUCT_FEED_TOKEN: "r".repeat(32)
    }, { fetch: fetchRequest });

    const result = await port.search({ query: "keratin mask", limit: 3 });

    expect(fetchRequest).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      snapshotAt: "2026-08-22T01:00:00.000Z",
      diagnostics: { feedRows: 1, validRows: 1 },
      products: [{ merchantProductId: "sku-1" }]
    });
  });

  it("uses the public Railway search API without shipping a Feed token", async () => {
    const publicResult = {
      source: "AWIN_PRODUCT_FEED",
      coverage: "COMPLETE",
      snapshotAt: "2026-08-25T05:30:00.000Z",
      diagnostics: {
        feedRows: 61,
        validRows: 61,
        rejectedRows: 0,
        queryMatches: 23,
        priceProductsExcluded: 0
      },
      products: [{
        merchantId: "49085",
        merchant: "GardePro",
        merchantProductId: "tc-1",
        title: "GardePro Trail Camera",
        category: "Trail Cameras",
        matchStatus: "DISCOVERY_MATCH",
        matchEvidence: ["Awin merchant_product_id present"],
        condition: "UNKNOWN",
        imageUrl: "https://images.example/trail-camera.jpg",
        itemPrice: { amountCents: 5_999, currency: "USD" },
        availability: "IN_STOCK",
        merchantUrl: "https://gardeproshop.com/products/tc-1",
        affiliateUrl: "https://www.awin1.com/pclick.php?p=3&a=3047955&m=49085",
        checkedAt: "2026-08-25T05:30:00.000Z"
      }]
    };
    const fetchRequest = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init).toMatchObject({
        method: "POST",
        redirect: "error",
        headers: { accept: "application/json", "content-type": "application/json" }
      });
      expect(JSON.parse(String(init?.body))).toEqual({ query: "GardePro trail camera", limit: 3 });
      expect(JSON.stringify(init?.headers)).not.toContain("Bearer");
      return new Response(JSON.stringify(publicResult), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    const port = createAwinFeedPort({
      AWIN_PRODUCT_SEARCH_URL: "https://findcheap.example/v1/search",
      AWIN_PRODUCT_FEED_URL: "https://feed.findcheap.example/v1/feed",
      AWIN_PRODUCT_FEED_TOKEN: "r".repeat(32)
    }, { fetch: fetchRequest });

    const result = await port.search({ query: "GardePro trail camera", limit: 3 });

    expect(fetchRequest).toHaveBeenCalledOnce();
    expect(result).toEqual(publicResult);
  });

  it("rejects tampered products returned by the public search API", async () => {
    const response = {
      source: "AWIN_PRODUCT_FEED",
      coverage: "COMPLETE",
      snapshotAt: "2026-08-25T05:30:00.000Z",
      diagnostics: {
        feedRows: 1,
        validRows: 1,
        rejectedRows: 0,
        queryMatches: 1,
        priceProductsExcluded: 0
      },
      products: [{
        merchantId: "49085",
        merchant: "GardePro",
        merchantProductId: "tc-1",
        title: "GardePro Trail Camera",
        category: "Trail Cameras",
        matchStatus: "DISCOVERY_MATCH",
        matchEvidence: ["Awin merchant_product_id present"],
        condition: "UNKNOWN",
        itemPrice: { amountCents: 5_999, currency: "USD" },
        availability: "IN_STOCK",
        merchantUrl: "https://gardeproshop.com/products/tc-1",
        affiliateUrl: "https://www.awin1.com/pclick.php?p=3&a=attacker&m=49085",
        checkedAt: "2026-08-25T05:30:00.000Z"
      }]
    };
    const port = createAwinFeedPort({
      AWIN_PRODUCT_SEARCH_URL: "https://findcheap.example/v1/search"
    }, {
      fetch: async () => new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    });

    await expect(port.search({ query: "GardePro trail camera", limit: 3 }))
      .rejects.toThrow("affiliate relationship");
  });
});

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
