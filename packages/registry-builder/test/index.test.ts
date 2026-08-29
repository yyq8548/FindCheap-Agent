import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

import { createAwinFeedIndex } from "../../awin-feed/src/index.js";
import { collectAwinMerchantCandidates, probeTechnicalStorefront } from "../src/index.js";

describe("registry builder", () => {
  it("collects joined Awin merchants as deduplicated candidates without granting trust", () => {
    const index = createAwinFeedIndex(fixtureArchive(), "2026-08-29T00:00:00.000Z");

    expect(collectAwinMerchantCandidates(index)).toEqual([{
      host: "merchant.example",
      merchantNames: ["Candidate Merchant"],
      merchantIds: ["12345"],
      sampleProductUrls: [
        "https://www.merchant.example/products/one",
        "https://merchant.example/products/two"
      ]
    }]);
  });

  it("records technical signals but does not infer brand ownership or trust", async () => {
    const fetchPage = vi.fn(async () => ({
      response: new Response(
        '<html><script type="application/ld+json">{"@type":"Product"}</script><img src="https://cdn.shopify.com/a.jpg"></html>',
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
      ),
      finalUrl: "https://www.merchant.example/"
    }));

    await expect(probeTechnicalStorefront("merchant.example", fetchPage)).resolves.toEqual({
      evidenceUrl: "https://merchant.example/",
      result: "PASS",
      details: {
        status: 200,
        finalUrl: "https://www.merchant.example/",
        contentType: "text/html",
        shopifySignal: true,
        productJsonLdSignal: true
      }
    });
  });

  it("fails closed when a probe cannot complete", async () => {
    const fetchPage = vi.fn(async () => { throw new Error("blocked"); });
    await expect(probeTechnicalStorefront("merchant.example", fetchPage)).resolves.toEqual({
      evidenceUrl: "https://merchant.example/",
      result: "FAIL",
      details: { reason: "NETWORK_OR_POLICY" }
    });
  });
});

function fixtureArchive(): Buffer {
  const header = [
    "aw_deep_link", "product_name", "merchant_product_id", "merchant_image_url", "description",
    "merchant_category", "search_price", "merchant_name", "merchant_id", "category_name", "currency",
    "merchant_deep_link", "in_stock"
  ];
  const products: Array<[string, string]> = [
    ["one", "https://www.merchant.example/products/one"],
    ["two", "https://merchant.example/products/two"]
  ];
  const rows = products.map(([id, url]) => [
    `https://www.awin1.com/pclick.php?p=1&a=3047955&m=12345`, `Product ${id}`, id,
    "https://cdn.shopify.com/image.jpg", "Product", "Products", "10.00", "Candidate Merchant",
    "12345", "Products", "USD", url, "1"
  ]);
  return gzipSync([header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n"));
}

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
