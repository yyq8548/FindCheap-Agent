import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAwinFeedPort, parseAwinCsv } from "../src/awin-feed-client.js";

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
});

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
