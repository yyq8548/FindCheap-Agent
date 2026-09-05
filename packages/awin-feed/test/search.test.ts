import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { createAwinFeedIndex, searchAwinFeedIndex, parseAwinSearchInput } from "../src/index.js";

describe("Awin product search", () => {
  it("filters short and curly conflicts before the result limit and carries bounded length evidence", () => {
    const index = createAwinFeedIndex(fixtureArchive(), "2026-09-04T00:00:00.000Z");
    const seed = index.products.find(product => product.merchantProductId === "wig")!;
    const short = Array.from({ length: 30 }, (_, i) => ({ ...seed, merchantProductId: String(i),
      title: "Short straight hair wig", searchText: "short straight hair wig length: 10 inches", itemPrice: { amountCents: 100, currency: "USD" as const } }));
    const long = { ...seed, merchantProductId: "long", title: "Straight human hair wig", searchText: "straight human hair wig length: 40 inches " + "x".repeat(1400) };
    const original = [long, ...short];
    const result = searchAwinFeedIndex({ ...index, products: original }, {
      query: "long straight wig", productType: "wig", requiredFeatures: ["long hair", "straight hair"], limit: 1
    });
    expect(result.supportsRequirements).toBe(true);
    expect(result.products.map(product => product.merchantProductId)).toEqual(["long"]);
    expect(result.products[0]?.requirementEvidence).toContain("length: 40 inches");
    expect(result.products[0]?.requirementEvidence).toHaveLength(1200);
    expect(original[0]).toBe(long); expect(original).toHaveLength(31);
    expect(result.products[0]).not.toHaveProperty("searchText");
  });

  it("accepts old search contracts but rejects oversized typed constraints", () => {
    expect(parseAwinSearchInput({ query: "wig", limit: 8 })).toEqual({ query: "wig", limit: 8 });
    expect(() => parseAwinSearchInput({ query: "wig", limit: 8, requiredFeatures: Array.from({ length: 11 }, () => "long hair") })).toThrow();
  });

  it("matches whole tokens and English plurals without matching wiggle", () => {
    const index = createAwinFeedIndex(fixtureArchive(), "2026-09-04T00:00:00.000Z");
    const result = searchAwinFeedIndex(index, { query: "wig", limit: 8 });

    expect(result.diagnostics.queryMatches).toBe(2);
    expect(result.products.map((product) => product.merchantProductId)).toEqual(["tape", "wig"]);
    expect(result.products.map((product) => product.merchantProductId)).not.toContain("adult");
  });
});

function fixtureArchive(): Buffer {
  const header = [
    "aw_deep_link", "product_name", "merchant_product_id", "merchant_image_url", "description",
    "merchant_category", "search_price", "merchant_name", "merchant_id", "category_name", "currency",
    "merchant_deep_link", "in_stock"
  ];
  const sourceRows: Array<[string, string, string, string, string, string]> = [
    ["Wig Tape", "tape", "12.90", "Ishow Hair", "50707", "Hair Accessories > Wigs"],
    ["Human Hair Wigs", "wig", "36.41", "Ishow Hair", "50707", "Wigs"],
    ["Realistic Dildo Sex Machine with Wiggle-Vibration", "adult", "39.99", "Other", "34719", "Uncategorized"]
  ];
  const rows = sourceRows.map(([title, id, price, merchant, merchantId, category]) => [
    `https://www.awin1.com/pclick.php?p=1&a=3047955&m=${merchantId}`,
    title,
    id,
    "https://cdn.shopify.com/image.jpg",
    title,
    category,
    price,
    merchant,
    merchantId,
    category,
    "USD",
    `https://merchant.example/products/${id}`,
    "1"
  ]);
  return gzipSync([header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n"));
}

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
