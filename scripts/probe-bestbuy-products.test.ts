import { describe, expect, it } from "vitest";

import {
  parseBestBuyProbeArguments,
  runBestBuyProbe
} from "./probe-bestbuy-products.js";

describe("Best Buy product probe", () => {
  it("parses bounded query and SKU inputs", () => {
    expect(parseBestBuyProbeArguments(["--", "--query", "Sony headphones", "--limit", "5"]))
      .toEqual({ kind: "query", value: "Sony headphones", limit: 5 });
    expect(parseBestBuyProbeArguments(["--sku", "6568600"]))
      .toEqual({ kind: "sku", value: "6568600" });
    expect(() => parseBestBuyProbeArguments(["--query", "x", "--limit", "100"]))
      .toThrow(/Usage/u);
    expect(() => parseBestBuyProbeArguments(["--sku", "1?apiKey=evil"]))
      .toThrow(/Usage/u);
  });

  it("outputs only sanitized product fields, never raw evidence", async () => {
    const result = await runBestBuyProbe({
      async capture() {
        return {
          records: [{
            merchantProductId: "6568600",
            title: "Sony Headphones",
            brand: "Sony",
            gtins: ["027242923232"],
            rawOffer: {
              price: 349.99,
              priceCurrency: "USD",
              availability: "IN_STOCK",
              url: "https://api.bestbuy.com/click/example/6568600/pdp"
            }
          }],
          rawBody: "secret raw evidence",
          sourceUrl: "https://api.bestbuy.com/v1/products/6568600.json",
          checkedAt: "2026-08-14T02:00:00.000Z"
        };
      }
    }, { kind: "sku", value: "6568600" });

    expect(result).not.toHaveProperty("rawBody");
    expect(JSON.stringify(result)).not.toContain("secret raw evidence");
  });
});
