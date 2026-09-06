import { describe, expect, it } from "vitest";
import type { DealPort } from "../src/deal-client.js";
import type { ShopifyPort, ShopifyProduct, ShopifySearchResult } from "../src/shopify-client.js";
import { evaluateWatch } from "../src/watch-service.js";
import { createMemoryWatchStore } from "../src/watch-store.js";

const checkedAt = "2026-09-06T12:00:00.000Z";
const now = new Date(checkedAt);
const product: ShopifyProduct = {
  merchantId: "reviewed-store",
  merchant: "Reviewed Store",
  sourceHost: "reviewed-store.example",
  merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT", evidence: ["test-only reviewed merchant"] },
  handle: "123456789",
  title: "Black Lace Dress",
  gtins: ["1234567890123"],
  variantDimensions: { Color: "Black", Size: "M" },
  matchStatus: "EXACT",
  matchEvidence: ["GTIN exact"],
  condition: "NEW",
  itemPrice: { amountCents: 10_000, currency: "USD" },
  availability: "UNKNOWN",
  merchantUrl: "https://reviewed-store.example/products/black-lace-dress",
  checkedAt
};

function searchResult(products: ShopifyProduct[]): ShopifySearchResult {
  return {
    source: "SHOPIFY_GLOBAL_CATALOG", coverage: "COMPLETE", merchantsQueried: 1, merchantsSucceeded: 1,
    comparison: { status: "SAME_PRODUCT", evidence: ["GTIN exact"], merchantCount: 1, offerCount: products.length },
    diagnostics: {
      apiDurationMs: 1, cacheStatus: "MISS", chromeFallbackEligible: false, queryAttempts: 1,
      fallbackQueryUsed: false, catalogProductsReturned: products.length, catalogVariantsReturned: products.length,
      catalogZeroResultAttempts: 0, outOfStockProductsExcluded: 0, identityProductsExcluded: 0,
      irrelevantProductsExcluded: 0, conditionProductsExcluded: 0, priceProductsExcluded: 0,
      trustedMerchantProductsReturned: products.length, unverifiedMerchantProductsReturned: 0,
      unverifiedMerchantProductsExcluded: 0, riskyMerchantProductsExcluded: 0,
      merchantTrustRegistryVersion: "test-only", merchantsFailed: 0, coveragePercent: 100,
      failedMerchantIds: [], timedOutMerchantIds: [], registryVersion: "test-only", searchTimeoutMs: 1_000,
      selectionPolicy: "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_PRICE"
    },
    questions: [], products
  };
}

const noDeals: DealPort = { search: async () => { throw new Error("NETWORK_FORBIDDEN_IN_WATCH_TEST"); } };

describe("restock watch evidence", () => {
  it("does not call UNKNOWN inventory a restock baseline", async () => {
    const store = createMemoryWatchStore();
    const watch = await store.create({
      query: "Black Lace Dress", condition: "RESTOCKED", identity: { gtin: "1234567890123" },
      conditionPreference: "ANY", membershipIds: [], intervalMinutes: 60
    }, checkedAt);
    let observedProduct = product;
    const source: ShopifyPort = { search: async () => searchResult([observedProduct]) };
    await evaluateWatch(watch, store, source, noDeals, undefined, now);
    observedProduct = { ...product, availability: "IN_STOCK" };
    const result = await evaluateWatch((await store.get(watch.watchId))!, store, source, noDeals, undefined, now);

    expect(result.status).toBe("NOT_TRIGGERED");
  });

  it.each([
    ["merchant", { merchantId: "another-reviewed-store" }],
    ["source host", { sourceHost: "another-store.example" }],
    ["variant", { handle: "987654321" }],
    ["size", { variantDimensions: { Color: "Black", Size: "L" } }],
    ["condition", { condition: "USED" }]
  ] satisfies Array<[string, Partial<ShopifyProduct>]>)(
    "does not combine a different %s with the prior out-of-stock observation", async (_name, changed) => {
    const store = createMemoryWatchStore();
    const watch = await store.create({
      query: "Black Lace Dress", condition: "RESTOCKED", identity: { gtin: "1234567890123" },
      conditionPreference: "ANY", membershipIds: [], intervalMinutes: 60
    }, checkedAt);
    let observedProduct: ShopifyProduct = { ...product, availability: "OUT_OF_STOCK" };
    const source: ShopifyPort = { search: async () => searchResult([observedProduct]) };
    await evaluateWatch(watch, store, source, noDeals, undefined, now);
    observedProduct = { ...product, ...changed, availability: "IN_STOCK" };

    const result = await evaluateWatch((await store.get(watch.watchId))!, store, source, noDeals, undefined, now);

    expect(result.status).toBe("NOT_TRIGGERED");
  });

  it.each(["UNKNOWN", "empty", "failure", "future", "stale", "product-level inventory"])(
    "keeps reliable prior evidence when the next source observation is %s", async (caseName) => {
    const store = createMemoryWatchStore();
    const watch = await store.create({
      query: "Black Lace Dress", condition: "RESTOCKED", identity: { gtin: "1234567890123" },
      conditionPreference: "ANY", membershipIds: [], intervalMinutes: 60
    }, checkedAt);
    let observations: ShopifyProduct[] = [{ ...product, availability: "OUT_OF_STOCK" }];
    let fail = false;
    const source: ShopifyPort = { search: async () => {
      if (fail) throw new Error("SOURCE_UNAVAILABLE");
      return searchResult(observations);
    } };
    const baseline = await evaluateWatch(watch, store, source, noDeals, undefined, now);
    const later = new Date("2026-09-06T13:00:00.000Z");
    observations = caseName === "empty" ? [] : [{
      ...product, availability: caseName === "UNKNOWN" ? "UNKNOWN" : "OUT_OF_STOCK",
      checkedAt: caseName === "future" ? "2026-09-06T13:01:00.000Z"
        : caseName === "stale" ? checkedAt : later.toISOString(),
      ...(caseName === "product-level inventory" ? { availabilityScope: "PRODUCT_COLOR" as const } : {})
    }];
    fail = caseName === "failure";
    const unavailable = await evaluateWatch(baseline.watch, store, source, noDeals, undefined, later);

    expect(unavailable.status).toBe("DATA_SOURCE_UNAVAILABLE");
    expect((await store.get(watch.watchId))!.lastObservation).toEqual(baseline.observation);

    fail = false;
    observations = [{ ...product, availability: "IN_STOCK", checkedAt: later.toISOString() }];
    const restocked = await evaluateWatch((await store.get(watch.watchId))!, store, source, noDeals, undefined, later);
    expect(restocked.status).toBe("TRIGGERED");
  });

  it.each([
    ["legacy without stable keys", { availability: "OUT_OF_STOCK", checkedAt }],
    ["UNKNOWN", { ...product, availability: "UNKNOWN" }],
    ["invalid timestamp", { ...product, availability: "OUT_OF_STOCK", checkedAt: "invalid" }],
    ["future timestamp", { ...product, availability: "OUT_OF_STOCK", checkedAt: "2026-09-06T12:01:00.000Z" }],
    ["later than current observation", { ...product, availability: "OUT_OF_STOCK", checkedAt: "2026-09-06T11:59:30.000Z" }, "DATA_SOURCE_UNAVAILABLE"],
    ["missing variant dimensions", { ...product, availability: "OUT_OF_STOCK", variantDimensions: undefined }],
    ["empty variant ID", { ...product, availability: "OUT_OF_STOCK", handle: "" }]
  ])("rejects inventory with unreliable or later saved evidence: %s", async (_name, previous, expectedStatus = "NOT_TRIGGERED") => {
    const store = createMemoryWatchStore();
    const watch = await store.create({
      query: "Black Lace Dress", condition: "RESTOCKED", identity: { gtin: "1234567890123" },
      conditionPreference: "ANY", membershipIds: [], intervalMinutes: 60
    }, checkedAt);
    await store.save({ ...watch, lastObservation: previous as Record<string, unknown> });
    const source: ShopifyPort = { search: async () => searchResult([{
      ...product, availability: "IN_STOCK", checkedAt: "2026-09-06T11:59:00.000Z"
    }]) };

    const result = await evaluateWatch((await store.get(watch.watchId))!, store, source, noDeals, undefined, now);

    expect(result.status).toBe(expectedStatus);
  });

  it("does not report restock on a first in-stock observation", async () => {
    const store = createMemoryWatchStore();
    const watch = await store.create({
      query: "Black Lace Dress", condition: "RESTOCKED", identity: { gtin: "1234567890123" },
      conditionPreference: "ANY", membershipIds: [], intervalMinutes: 60
    }, checkedAt);
    const source: ShopifyPort = { search: async () => searchResult([{ ...product, availability: "IN_STOCK" }]) };

    const result = await evaluateWatch(watch, store, source, noDeals, undefined, now);

    expect(result.status).toBe("NOT_TRIGGERED");
  });

  it.each(["IN_STOCK", "OUT_OF_STOCK"] as const)(
    "keeps the tracked offer when an unrelated in-stock offer precedes its %s observation", async (availability) => {
      const store = createMemoryWatchStore();
      const watch = await store.create({
        query: "Black Lace Dress", condition: "RESTOCKED", identity: { gtin: "1234567890123" },
        conditionPreference: "ANY", membershipIds: [], intervalMinutes: 60
      }, checkedAt);
      let observations: ShopifyProduct[] = [{ ...product, availability: "OUT_OF_STOCK" }];
      const source: ShopifyPort = { search: async () => searchResult(observations) };
      const baseline = await evaluateWatch(watch, store, source, noDeals, undefined, now);
      observations = [
        { ...product, merchantId: "another-store", sourceHost: "another-store.example", availability: "IN_STOCK" },
        { ...product, availability }
      ];

      const result = await evaluateWatch(baseline.watch, store, source, noDeals, undefined, now);

      expect(result.status).toBe(availability === "IN_STOCK" ? "TRIGGERED" : "NOT_TRIGGERED");
      expect(result.observation).toMatchObject({ merchantId: "reviewed-store", availability });
    }
  );

  it.each(["IN_STOCK", "OUT_OF_STOCK"] as const)(
    "does not rewind a reliable %s observation using delayed inventory", async (availability) => {
      const store = createMemoryWatchStore();
      const watch = await store.create({
        query: "Black Lace Dress", condition: "RESTOCKED", identity: { gtin: "1234567890123" },
        conditionPreference: "ANY", membershipIds: [], intervalMinutes: 60
      }, checkedAt);
      let observedProduct: ShopifyProduct = { ...product, availability };
      const source: ShopifyPort = { search: async () => searchResult([observedProduct]) };
      const baseline = await evaluateWatch(watch, store, source, noDeals, undefined, now);
      observedProduct = { ...product, availability: "OUT_OF_STOCK", checkedAt: "2026-09-06T11:59:00.000Z" };
      const later = new Date("2026-09-06T12:10:00.000Z");

      const delayed = await evaluateWatch(baseline.watch, store, source, noDeals, undefined, later);

      expect(delayed.status).toBe("DATA_SOURCE_UNAVAILABLE");
      expect((await store.get(watch.watchId))!.lastObservation).toEqual(baseline.observation);
      observedProduct = { ...product, availability: "IN_STOCK", checkedAt: "2026-09-06T11:59:30.000Z" };
      const result = await evaluateWatch((await store.get(watch.watchId))!, store, source, noDeals, undefined, later);
      expect(result.status).toBe("DATA_SOURCE_UNAVAILABLE");
    }
  );
});
