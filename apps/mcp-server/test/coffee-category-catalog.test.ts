import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createShopifyGlobalCatalogPort } from "../src/shopify-global-catalog-client.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/coffee-category/shopify-capsule-sample.json", import.meta.url), "utf8")) as {
  observedAt: string; response: unknown;
};

describe("coffee category through the real Shopify Catalog adapter", () => {
  it("retains real USD capsule offers whose optional category field is absent", async () => {
    const port = createShopifyGlobalCatalogPort({ SHOPIFY_AGENT_PROFILE_URL: "https://example.com/profile.json" }, {
      fetch: async () => Response.json(fixture.response), clock: { now: () => new Date(fixture.observedAt) }
    });
    const result = await port.search({ query: "coffee capsules", limit: 12 });
    expect(result.products.map(product => product.title)).toEqual(expect.arrayContaining([
      "Midtown Roast Coffee Capsules", "French Roast OneCUP™ Coffee Pods", "INTENSE ESPRESSO COFFEE CAPSULES"
    ]));
    expect(result.products).toHaveLength(6);
    expect(result.products.every(product => product.itemPrice?.currency === "USD")).toBe(true);
    expect(result.products.find(product => product.title === "Midtown Roast Coffee Capsules")).toMatchObject({
      itemPrice: { amountCents: 1199, currency: "USD" }, matchStatus: "DISCOVERY_MATCH", checkedAt: fixture.observedAt
    });
    expect(result.diagnostics).toMatchObject({ catalogProductsReturned: 10, catalogVariantsReturned: 10, identityProductsExcluded: 0 });
  });
});
