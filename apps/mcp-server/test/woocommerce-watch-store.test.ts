import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJsonWatchStore, createMemoryWatchStore, WatchSpecSchema, WatchStateConflictError } from "../src/watch-store.js";

const now = "2026-09-08T12:00:00.000Z";
const selectedProduct = {
  sourceKind: "WOOCOMMERCE_STORE_API" as const,
  merchantId: "reviewed-woo", merchant: "Reviewed Woo", sourceHost: "reviewed-woo.example",
  productId: 123, productType: "simple" as const,
  title: "Exact Keyboard", merchantUrl: "https://reviewed-woo.example/product/exact-keyboard/",
  condition: "NEW" as const, variantDimensions: { Color: "Black" }, selectedAt: now
};
const wooSpec = { query: "Exact Keyboard", condition: "PRICE_BELOW" as const, threshold: 5000,
  priceBasis: "ITEM_PRICE" as const, conditionPreference: "NEW" as const,
  membershipIds: [], intervalMinutes: 60, selectedProduct };
const legacySpec = { query: "Other Keyboard", condition: "PRICE_BELOW" as const, threshold: 5000,
  priceBasis: "ITEM_PRICE" as const, conditionPreference: "NEW" as const,
  identity: { modelNumber: "keyboard-123" }, membershipIds: [], intervalMinutes: 60 };
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "findcheap-woo-watch-"));
  directories.push(directory);
  return { directory, store: createJsonWatchStore(directory) };
}

describe("Woo Watch persistence", () => {
  it("keeps Woo records and deletion intents outside the legacy file scan across restart", async () => {
    const { directory, store } = await fixture();
    const woo = await store.create(wooSpec, now);
    const legacy = await store.create(legacySpec, now);
    const bound = await store.save({ ...woo, schedulingState: "BOUND", automationId: "woo-test-automation" });
    const files = await readdir(directory);
    expect(files.sort()).toEqual([`${woo.watchId}.woocommerce-v1.json`, `${legacy.watchId}.json`].sort());
    expect(files.filter(name => /^[0-9a-f-]{36}\.json$/u.test(name))).toEqual([`${legacy.watchId}.json`]);
    const restarted = createJsonWatchStore(directory);
    expect(await restarted.get(woo.watchId)).toEqual(bound);
    expect(await restarted.list()).toHaveLength(2);
    expect(await restarted.delete(woo.watchId)).toBe(true);
    const after = createJsonWatchStore(directory);
    expect(await after.get(woo.watchId)).toBeUndefined();
    expect(await after.list()).toEqual([legacy]);
    expect(await after.listPendingStops()).toEqual([{
      watchId: woo.watchId, automationId: "woo-test-automation", reason: "DELETED",
      requestedAt: expect.any(String), status: "STOP_REQUIRED"
    }]);
    const tombstone = JSON.parse(await readFile(join(directory, `${woo.watchId}.woocommerce-v1.deleted.json`), "utf8"));
    expect(Object.keys(tombstone).sort()).toEqual(["deletedAt", "stopIntent", "watchId"]);
    expect(JSON.stringify(tombstone)).not.toMatch(/Exact Keyboard|reviewed-woo|selectedProduct/u);
    expect((await readdir(directory)).filter(name => /^[0-9a-f-]{36}\.deleted\.json$/u.test(name))).toEqual([]);
    await expect(after.save(bound)).rejects.toBeInstanceOf(WatchStateConflictError);
    await expect(after.save({ ...legacy, schedulingState: "BOUND", automationId: "woo-test-automation" }))
      .rejects.toBeInstanceOf(WatchStateConflictError);
  });

  it("deduplicates concurrent Woo creation and does not extend a repeated selection deadline", async () => {
    const { directory, store } = await fixture();
    const second = createJsonWatchStore(directory);
    const [first, concurrent] = await Promise.all([store.create(wooSpec, now), second.create(wooSpec, now)]);
    expect(first.watchId).toBe(concurrent.watchId);
    const later = "2026-09-09T12:00:00.000Z";
    const repeated = await second.create({ ...wooSpec, selectedProduct: { ...selectedProduct, selectedAt: later } }, later);
    expect(repeated.watchId).toBe(first.watchId);
    expect(repeated.spec.expiresAt).toBe("2026-10-08T12:00:00.000Z");
    expect(await store.list()).toHaveLength(1);
  });

  it.each(["memory", "json"])("never retargets an existing Woo rule through save in %s", async kind => {
    const store = kind === "memory" ? createMemoryWatchStore() : (await fixture()).store;
    const created = await store.create(wooSpec, now);
    await expect(store.save({ ...created, spec: { ...created.spec, selectedProduct: { ...selectedProduct, productId: 456 } } }))
      .rejects.toBeInstanceOf(WatchStateConflictError);
    await expect(store.save({ ...created, spec: legacySpec })).rejects.toBeInstanceOf(WatchStateConflictError);
    const legacy = await store.create(legacySpec, now);
    await expect(store.save({ ...legacy, spec: wooSpec })).rejects.toBeInstanceOf(WatchStateConflictError);
  });

  it.each(["misfiled Woo", "misfiled legacy", "duplicate ID", "cross-source tombstone"])(
    "rejects %s rather than mixing target namespaces", async mode => {
      const { directory, store } = await fixture();
      const woo = await store.create(wooSpec, now);
      const wooPath = join(directory, `${woo.watchId}.woocommerce-v1.json`);
      const legacyPath = join(directory, `${woo.watchId}.json`);
      if (mode === "misfiled Woo") {
        await rm(wooPath);
        await writeFile(legacyPath, JSON.stringify(woo));
      } else if (mode === "misfiled legacy") {
        await writeFile(wooPath, JSON.stringify({ ...woo, spec: legacySpec }));
      } else if (mode === "duplicate ID") {
        await writeFile(legacyPath, JSON.stringify({ ...woo, spec: legacySpec }));
      } else {
        await writeFile(join(directory, `${woo.watchId}.deleted.json`), JSON.stringify({ watchId: woo.watchId, deletedAt: now }));
      }
      await expect(store.get(woo.watchId)).rejects.toThrow("WATCH_STORE_RECORD_INVALID");
      await expect(store.list()).rejects.toThrow("WATCH_STORE_RECORD_INVALID");
    });

  it("enforces the same capacity across Woo and legacy files", async () => {
    const { directory, store } = await fixture();
    const woo = await store.create(wooSpec, now);
    await Promise.all(Array.from({ length: 499 }, async () => {
      const watchId = randomUUID();
      await writeFile(join(directory, `${watchId}.json`), JSON.stringify({ ...woo, watchId, spec: legacySpec }));
    }));
    expect(await store.list()).toHaveLength(500);
    await expect(store.create({ ...wooSpec, query: "Another Keyboard" }, now)).rejects.toThrow("watch limit reached");
    await expect(store.create({ ...legacySpec, query: "Another Keyboard" }, now)).rejects.toThrow("watch limit reached");
  }, 30_000);

  it("rejects an unselected variable parent and inconsistent variant targets", () => {
    expect(WatchSpecSchema.safeParse({ ...wooSpec, selectedProduct: { ...selectedProduct, productType: "variable" } }).success).toBe(false);
    expect(WatchSpecSchema.safeParse({ ...wooSpec, selectedProduct: { ...selectedProduct, productType: "variation" } }).success).toBe(false);
    expect(WatchSpecSchema.safeParse({ ...wooSpec, selectedProduct: { ...selectedProduct, variationId: 456 } }).success).toBe(false);
  });

  it.each(["memory", "json"])("atomically keeps initial source evidence without consuming a price alert in %s", async kind => {
    const disk = kind === "json" ? await fixture() : undefined;
    const store = disk?.store ?? createMemoryWatchStore();
    const initial = { checkedAt: now, data: { sourceKind: "WOOCOMMERCE_STORE_API", productId: 123,
      availability: "OUT_OF_STOCK", checkedAt: now, itemPrice: { amountCents: 4999, currency: "USD" } } };
    const created = await store.create(wooSpec, now, initial);
    expect(created).toMatchObject({ revision: 0, lastCheckedAt: now, lastObservation: initial.data });
    expect(created.wasSatisfied).toBeUndefined();
    initial.data.itemPrice.amountCents = 1;
    expect((await store.get(created.watchId))?.lastObservation?.["itemPrice"]).toEqual({ amountCents: 4999, currency: "USD" });
    if (disk !== undefined) {
      const raw = JSON.parse(await readFile(join(disk.directory, `${created.watchId}.woocommerce-v1.json`), "utf8"));
      expect(raw).toMatchObject({ revision: 0, lastCheckedAt: now, lastObservation: { availability: "OUT_OF_STOCK", checkedAt: now } });
    }
  });

  it.each(["memory", "json"])("does not overwrite an existing observation on duplicate creation in %s", async kind => {
    const store = kind === "json" ? (await fixture()).store : createMemoryWatchStore();
    const created = await store.create(wooSpec, now, { checkedAt: now, data: { availability: "OUT_OF_STOCK", checkedAt: now } });
    const later = "2026-09-08T13:00:00.000Z";
    const repeated = await store.create(wooSpec, later, { checkedAt: later, data: { availability: "IN_STOCK", checkedAt: later } });
    expect(repeated).toEqual(created);
    expect(await store.list()).toEqual([created]);
  });
});
