import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { createWooCommerceController } from "../src/woocommerce.js";
import { DEFAULT_WOO_REGISTRY, wooMerchantForUrl } from "../src/woocommerce-registry.js";
import { createWooStoreReader, normalizeWooProduct, type WooRawProduct } from "../src/woocommerce-store.js";
import type { WooProduct } from "../../../packages/contracts/src/woocommerce.js";

type SavedSample = { merchantId: string; observedAt: string; raw: WooRawProduct; parent?: WooRawProduct;
  expected: Pick<WooProduct, "productId" | "variationId" | "itemPrice" | "selectedAttributes" | "merchantUrl"> };
const samples = JSON.parse(await readFile(new URL("fixtures/woocommerce-expansion/accepted-samples.json", import.meta.url), "utf8")) as SavedSample[];
// Historical observations stay intact; wildcard children do not bind every purchase dimension.
const unboundSamples = new Set(["rockgeist", "warbonnet-outdoors"]);
// Keep the original 50-store acceptance evidence separate from later additions.
const originalRegistry = { ...DEFAULT_WOO_REGISTRY, stores: DEFAULT_WOO_REGISTRY.stores.slice(0, 50) };
const resolve = async () => [{ address: "8.8.8.8", family: 4 }];
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const budget = () => ({ signal: new AbortController().signal, requests: 0, bytes: 0, maxRequests: 1, maxBytes: 1024 * 1024 });

describe("reviewed 50-merchant Woo expansion", () => {
  it("admits 45 recorded additions while retaining the five existing stores and separate trust", () => {
    const stores = originalRegistry.stores;
    expect(stores).toHaveLength(50);
    expect(samples).toHaveLength(45);
    expect(new Set(stores.map(store => store.merchantId)).size).toBe(50);
    expect(stores.slice(0, 5).map(store => store.merchantId)).toEqual(["offerman-woodshop", "root-science", "lamarzocco-home-usa", "burrow-press", "scrub-daddy"]);
    expect(new Set(stores.slice(5).map(store => store.merchantId))).toEqual(new Set(samples.map(sample => sample.merchantId)));
    for (const store of stores) {
      expect(store.enabled && store.capabilities.search && store.currency === "USD" && Boolean(store.marketEvidence)).toBe(true);
      expect(store).not.toHaveProperty("trust");
      expect(store).not.toHaveProperty("affiliate");
    }
  });

  it("reads at most six distinct merchants per pass and never calls 50-store coverage complete", async () => {
    const request = vi.fn(async () => response([]));
    const controller = createWooCommerceController(originalRegistry, { resolve, request });
    const first = await controller.search({ query: "findcheapboundedcoverage", limit: 3, market: "US", currency: "USD" });
    expect(first.diagnostics).toMatchObject({ eligibleStores: 50, plannedStores: 6, physicalRequests: 6, registryCoverageComplete: false });
    expect(first.continuation?.attemptedMerchantIds).toHaveLength(6);
    const second = await controller.search({ query: "findcheapboundedcoverage", limit: 3, market: "US", currency: "USD", continuation: first.continuation! });
    expect(second.diagnostics).toMatchObject({ eligibleStores: 50, plannedStores: 6, physicalRequests: 6, registryCoverageComplete: false });
    expect(second.continuation).toBeUndefined();
    expect(new Set([...first.stores, ...second.stores].map(store => store.merchantId)).size).toBe(12);
    expect(request).toHaveBeenCalledTimes(12);
  });

  it("selects a newly admitted brand within the existing six-store budget", async () => {
    const request = vi.fn(async () => response([]));
    const result = await createWooCommerceController(originalRegistry, { resolve, request }).search({ query: "Seymour Duncan", limit: 3, market: "US", currency: "USD" });
    expect(result.stores.some(store => store.merchantId === "seymour-duncan")).toBe(true);
    expect(result.diagnostics.plannedStores).toBe(6);
  });

  it.each(samples)("replays $merchantId product identity, selected dimensions, USD price and approved images", async sample => {
    const store = originalRegistry.stores.find(store => store.merchantId === sample.merchantId)!;
    expect(store).toBeDefined();
    expect(wooMerchantForUrl(originalRegistry, sample.expected.merchantUrl)?.merchantId).toBe(sample.merchantId);
    const reader = createWooStoreReader({ resolve, request: async url => response(url.pathname.endsWith(`/${sample.raw.id}`) ? sample.raw : sample.parent) });
    const raw = await reader.product(store, sample.raw.id, budget());
    const parent = sample.parent === undefined ? undefined : await reader.product(store, sample.parent.id, budget());
    const product = normalizeWooProduct(raw, store, sample.observedAt, parent)!;
    const { itemPrice: historicalPrice, ...identity } = sample.expected;
    expect(product).toMatchObject(identity);
    if (unboundSamples.has(sample.merchantId)) {
      expect(historicalPrice).toBeDefined();
      expect(product.itemPrice).toBeUndefined();
      expect(product.availability).toBe("UNKNOWN");
      expect(product.priceEvidence.scope).toBe("UNKNOWN");
    } else expect(product.itemPrice).toEqual(historicalPrice);
    expect(product.images.length).toBeGreaterThan(0);
    expect(product.images.every(image => [new URL(store.origin).hostname, ...store.imageHosts].includes(new URL(image.url).hostname))).toBe(true);
    if (parent !== undefined) {
      expect(store.capabilities.variations).toBe(true);
      expect(normalizeWooProduct(parent, store, sample.observedAt)?.itemPrice).toBeUndefined();
      expect(product.priceEvidence.scope).toBe(unboundSamples.has(sample.merchantId) ? "UNKNOWN" : "VARIANT");
    }
  });
});
