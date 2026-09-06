import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DealPort } from "../src/deal-client.js";
import type { ShopifyPort, ShopifyProduct, ShopifySearchResult } from "../src/shopify-client.js";
import { evaluateWatch } from "../src/watch-service.js";
import { createJsonWatchStore, createMemoryWatchStore, WatchStateConflictError } from "../src/watch-store.js";

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
const watchDirectories: string[] = [];
afterEach(async () => { for (const directory of watchDirectories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function restockBaseline(store = createMemoryWatchStore()) {
  const created = await store.create({ query: "Black Lace Dress", condition: "RESTOCKED", identity: { gtin: "1234567890123" },
    conditionPreference: "ANY", membershipIds: [], intervalMinutes: 60 }, checkedAt);
  const watch = await store.save({ ...created, automationId: "synthetic-restock", schedulingState: "BOUND" });
  return (await evaluateWatch(watch, store, { search: async () => searchResult([{ ...product, availability: "OUT_OF_STOCK" }]) },
    noDeals, undefined, now)).watch;
}

describe("restock watch evidence", () => {
  it("preserves one completion event and pending stop across JSON adapter restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-watch-event-"));
    watchDirectories.push(directory);
    const store = createJsonWatchStore(directory);
    const baseline = await restockBaseline(store);
    const search = vi.fn(async () => searchResult([{ ...product, availability: "IN_STOCK" as const }]));
    const first = await evaluateWatch(baseline, store, { search }, noDeals, undefined, now);
    const restarted = createJsonWatchStore(directory);
    const again = await evaluateWatch((await restarted.get(baseline.watchId))!, restarted, { search }, noDeals, undefined, now);
    expect(first.status).toBe("TRIGGERED");
    expect(again.status).toBe("COMPLETED");
    expect(again.watch).toEqual(first.watch);
    expect(await restarted.listPendingStops()).toEqual([first.watch.stopIntent]);
    expect(search).toHaveBeenCalledTimes(1);
  });
  it("commits only one notification event when two evaluations share a reliable baseline", async () => {
    const store = createMemoryWatchStore();
    const baseline = await restockBaseline(store);
    const source: ShopifyPort = { search: async () => searchResult([{ ...product, availability: "IN_STOCK" }]) };
    const results = await Promise.allSettled([
      evaluateWatch(baseline, store, source, noDeals, undefined, now),
      evaluateWatch(baseline, store, source, noDeals, undefined, now)
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "fulfilled")).toMatchObject({ value: { status: "TRIGGERED" } });
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: new WatchStateConflictError() });
    expect(await store.get(baseline.watchId)).toMatchObject({ status: "COMPLETED", revision: baseline.revision! + 1 });
  });
  it.each(["pause", "delete"])("does not trigger or restore state when %s commits while a source is in flight", async action => {
    const store = createMemoryWatchStore();
    const baseline = await restockBaseline(store);
    let release!: (value: ShopifySearchResult) => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const source: ShopifyPort = { search: () => { started(); return new Promise(resolve => { release = resolve; }); } };
    const pending = evaluateWatch(baseline, store, source, noDeals, undefined, now);
    await entered;
    if (action === "delete") await store.delete(baseline.watchId);
    else await store.save({ ...baseline, status: "PAUSED" });
    const stopped = await store.get(baseline.watchId);
    release(searchResult([{ ...product, availability: "IN_STOCK" }]));
    await expect(pending).rejects.toBeInstanceOf(WatchStateConflictError);
    expect(await store.get(baseline.watchId)).toEqual(stopped);
    if (stopped !== undefined) expect(stopped.completionEventId).toBeUndefined();
  });
  it("expires a bound rule once with a persistent stop request and no provider calls", async () => {
    const store = createMemoryWatchStore();
    const baseline = await restockBaseline(store);
    const search = vi.fn(async () => searchResult([product]));
    const expiredNow = new Date("2026-10-07T12:00:00.000Z");
    const expired = await evaluateWatch(baseline, store, { search }, noDeals, undefined, expiredNow);
    const again = await evaluateWatch(expired.watch, store, { search }, noDeals, undefined, expiredNow);
    expect(expired.status).toBe("EXPIRED");
    expect(expired.watch.stopIntent).toMatchObject({ reason: "EXPIRED", status: "STOP_REQUIRED" });
    expect(again.watch).toEqual(expired.watch);
    expect(search).not.toHaveBeenCalled();
  });
  it("completes after one verified restock, retains one event and stop request, and performs no later source work", async () => {
    const store = createMemoryWatchStore();
    const created = await store.create({ query: "Black Lace Dress", condition: "RESTOCKED", identity: { gtin: "1234567890123" },
      conditionPreference: "ANY", membershipIds: [], intervalMinutes: 60 }, checkedAt);
    const watch = await store.save({ ...created, automationId: "synthetic-restock", schedulingState: "BOUND" });
    let availability: "OUT_OF_STOCK" | "IN_STOCK" = "OUT_OF_STOCK";
    const search = vi.fn(async () => searchResult([{ ...product, availability }]));
    const baseline = await evaluateWatch(watch, store, { search }, noDeals, undefined, now);
    availability = "IN_STOCK";
    const triggered = await evaluateWatch(baseline.watch, store, { search }, noDeals, undefined, now);
    expect(triggered.status).toBe("TRIGGERED");
    expect(triggered.watch).toMatchObject({ status: "COMPLETED", completionEventId: expect.any(String),
      stopIntent: { watchId: watch.watchId, automationId: "synthetic-restock", reason: "RESTOCKED", status: "STOP_REQUIRED" } });
    const repeated = await evaluateWatch((await store.get(watch.watchId))!, store, { search }, noDeals, undefined, now);
    expect(repeated.status).toBe("COMPLETED");
    expect(repeated.watch.completionEventId).toBe(triggered.watch.completionEventId);
    expect(search).toHaveBeenCalledTimes(2);
  });
  it("keeps legacy delivered-total Watch data readable but never calls a recurring quote provider", async () => {
    const store = createMemoryWatchStore();
    const watch = await store.create({ query: "Black Lace Dress", condition: "PRICE_BELOW", threshold: 12000,
      priceBasis: "DELIVERED_TOTAL", zipCode: "33433", conditionPreference: "ANY", membershipIds: [], intervalMinutes: 60,
      selectedProduct: { sourceKind: "SHOPIFY_GLOBAL_CATALOG", merchantId: product.merchantId, merchant: product.merchant,
        sourceHost: product.sourceHost, variantId: product.handle, title: product.title, merchantUrl: product.merchantUrl,
        condition: product.condition, variantDimensions: product.variantDimensions, selectedAt: checkedAt }
    }, checkedAt);
    const quote = vi.fn(async () => { throw new Error("NO_RECURRING_QUOTE_CONSENT"); });
    const search = vi.fn(async () => searchResult([product]));
    const result = await evaluateWatch(watch, store, { search }, noDeals, { quote }, now);
    expect(quote).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(result.status).toBe("DATA_SOURCE_UNAVAILABLE");
    expect(result.message).toContain("RECURRING_QUOTE_AUTHORIZATION_UNAVAILABLE");
    expect(await store.get(watch.watchId)).toEqual(watch);
  });
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
