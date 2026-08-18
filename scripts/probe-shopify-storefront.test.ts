import { describe, expect, it } from "vitest";

import {
  parseShopifyProbeArguments,
  runShopifyProbe
} from "./probe-shopify-storefront.js";

describe("Shopify Storefront product probe", () => {
  it("parses bounded query and handle inputs", () => {
    expect(parseShopifyProbeArguments(["--", "--query", "coffee pods", "--limit", "5"]))
      .toEqual({ kind: "query", value: "coffee pods", limit: 5 });
    expect(parseShopifyProbeArguments(["--handle", "valhalla-java-single-serve-pods"]))
      .toEqual({ kind: "handle", value: "valhalla-java-single-serve-pods" });
    expect(() => parseShopifyProbeArguments(["--query", "x", "--limit", "100"]))
      .toThrow(/Usage/u);
    expect(() => parseShopifyProbeArguments(["--handle", "../admin"]))
      .toThrow(/Usage/u);
  });

  it("outputs sanitized product fields without raw evidence", async () => {
    const result = await runShopifyProbe({
      async capture() {
        return {
          records: [{
            merchantProductId: "coffee",
            title: "Coffee",
            gtins: [],
            rawOffer: {
              price: "12.00",
              priceCurrency: "USD",
              availability: "IN_STOCK",
              url: "https://deathwishcoffee.com/products/coffee"
            }
          }],
          rawBody: "untrusted raw evidence",
          sourceUrl: "https://deathwishcoffee.com/api/2026-07/graphql.json",
          checkedAt: "2026-08-18T01:00:00.000Z"
        };
      }
    }, { kind: "query", value: "coffee", limit: 5 });

    expect(result).not.toHaveProperty("rawBody");
    expect(JSON.stringify(result)).not.toContain("untrusted raw evidence");
  });
});
