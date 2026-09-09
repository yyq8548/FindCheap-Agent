import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { createAwinFeedIndex, mergeAwinFeedArchivesIsolatingConflicts, mergeAwinFeedArchivesStreaming } from "../src/index.js";

it("excludes all versions of cross-source keys, preserves other products and merchants, independent of order", async () => {
  const sources = [
    archive([row("20282", "overlap", "19.99"), row("20282", "keep-a", "3.00")]),
    archive([row("20282", "overlap", "9.99", "different", "0"), row("49085", "keep-b", "4.00")]),
    archive([row("20282", "overlap", "1.00")])
  ];
  for (const ordered of [sources, [...sources].reverse()]) {
    const merged = await mergeAwinFeedArchivesIsolatingConflicts(ordered);
    expect(merged).toMatchObject({ inputRows: 5, excludedProductGroups: 1, excludedProductRows: 3 });
    const index = createAwinFeedIndex(merged.archive, "2026-09-09T00:00:00Z");
    expect(index.products.map(product => `${product.merchantId}:${product.merchantProductId}`).sort()).toEqual([
      "20282:keep-a", "49085:keep-b"
    ]);
  }
  await expect(mergeAwinFeedArchivesStreaming(sources)).rejects.toThrow("duplicate");
});

it("retains one completely identical record and reports only the redundant rows as deduplicated", async () => {
  const same = row("20282", "overlap", "1.00");
  const merged = await mergeAwinFeedArchivesIsolatingConflicts([
    archive([same, row("20282", "keep", "2.00")]), archive([same])
  ]);
  expect(merged).toMatchObject({ inputRows: 3, excludedProductGroups: 0, excludedProductRows: 0, deduplicatedProductRows: 1 });
  expect(createAwinFeedIndex(merged.archive, "2026-09-09T00:00:00Z").products.map(product => product.merchantProductId).sort()).toEqual(["keep", "overlap"]);
});

it("isolates every version when three sources mix identical and conflicting records in any order", async () => {
  const same = row("20282", "overlap", "1.00");
  const conflict = row("20282", "overlap", "2.00");
  for (const records of [[same, same, conflict], [conflict, same, same], [same, conflict, same]]) {
    const merged = await mergeAwinFeedArchivesIsolatingConflicts(records.map((record, index) => archive([record, row("49085", `keep-${index}`, "3.00")])));
    const index = createAwinFeedIndex(merged.archive, "2026-09-09T00:00:00Z");
    expect(merged).toMatchObject({ inputRows: 6, excludedProductGroups: 1, excludedProductRows: 3, deduplicatedProductRows: 0 });
    expect(index.products.map(product => product.merchantProductId).sort()).toEqual(["keep-0", "keep-1", "keep-2"]);
    expect(merged.inputRows).toBe(index.feedRows + merged.excludedProductRows + merged.deduplicatedProductRows);
  }
});

it("deduplicates three fully identical sources without requiring unrelated survivors", async () => {
  const same = archive([row("20282", "same", "1.00")]);
  const merged = await mergeAwinFeedArchivesIsolatingConflicts([same, same, same]);
  expect(merged).toMatchObject({ inputRows: 3, excludedProductGroups: 0, excludedProductRows: 0, deduplicatedProductRows: 2 });
  expect(createAwinFeedIndex(merged.archive, "2026-09-09T00:00:00Z").feedRows).toBe(1);
});

it.each([
  ["image.jpg", "different.jpg"], ["Mask,Products", "Different description,Products"],
  ["Merchant 20282", "Different merchant label"], ["p=1&a=", "p=2&a="],
  ["Products,USD", "Different category,USD"], ["/products/overlap", "/products/different"]
])("treats a non-price evidence difference as a conflict: %s", async (before, after) => {
  const original = row("20282", "overlap", "1.00");
  const changed = original.replace(before, after);
  expect(changed).not.toBe(original);
  const merged = await mergeAwinFeedArchivesIsolatingConflicts([
    archive([original, row("49085", "keep", "2.00")]), archive([changed])
  ]);
  expect(merged).toMatchObject({ inputRows: 3, excludedProductGroups: 1, excludedProductRows: 2, deduplicatedProductRows: 0 });
});

it("rejects duplicates within one source even when a second source repeats the key", async () => {
  const repeated = row("20282", "same", "1");
  await expect(mergeAwinFeedArchivesIsolatingConflicts([
    archive([repeated, repeated]), archive([repeated, row("49085", "other", "2")])
  ])).rejects.toThrow("duplicate");
});

it("fails closed when all keys are isolated", async () => {
  await expect(mergeAwinFeedArchivesIsolatingConflicts([
    archive([row("20282", "same", "1")]), archive([row("20282", "same", "2")])
  ])).rejects.toThrow("no eligible products");
});

function archive(rows: string[]): Buffer {
  const header = "aw_deep_link,product_name,merchant_product_id,merchant_image_url,description,merchant_category,search_price,merchant_name,merchant_id,category_name,currency,merchant_deep_link,in_stock";
  return gzipSync([header, ...rows].join("\r\n"));
}

function row(merchant: string, sku: string, price: string, path = sku, stock = "1"): string {
  const domain = merchant === "20282" ? "www.nutreecosmetics.com" : "www.amazonliss.com";
  return `https://www.awin1.com/pclick.php?p=1&a=3047955&m=${merchant},Mask ${sku},${sku},https://cdn.shopify.com/image.jpg,Mask,Products,${price},Merchant ${merchant},${merchant},Products,USD,https://${domain}/products/${path},${stock}`;
}
