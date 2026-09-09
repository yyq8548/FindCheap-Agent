import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createWooCommerceController } from "../src/woocommerce.js";
import { DEFAULT_WOO_REGISTRY, wooMerchantForUrl } from "../src/woocommerce-registry.js";
import { createWooStoreReader, normalizeWooProduct, type WooRawProduct } from "../src/woocommerce-store.js";
import { WooSearchInputSchema, type WooProduct } from "../../../packages/contracts/src/woocommerce.js";

const resolve = async () => [{ address: "8.8.8.8", family: 4 }];
const request = () => vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } }));
type SavedSample = { merchantId: string; observedAt: string; raw: WooRawProduct; parent?: WooRawProduct;
  expected: Pick<WooProduct, "productId" | "variationId" | "itemPrice" | "selectedAttributes" | "merchantUrl"> };
const samples = JSON.parse(await readFile(new URL("fixtures/woocommerce-expansion-200/accepted-samples.json", import.meta.url), "utf8")) as SavedSample[];
// Preserve the original 200-store cohort and its recorded observations across later expansions.
const originalRegistry = { ...DEFAULT_WOO_REGISTRY, stores: DEFAULT_WOO_REGISTRY.stores.slice(0, 200) };
const unboundSamples = new Set(["gap-antenna", "kristin-dunn-books", "maple-city-roasters", "max200",
  "richardsons-candy-kitchen", "rising-star-coffee", "suttons-shoes", "uzzi"]);

describe("reviewed 200-merchant Woo expansion", () => {
  it("loads exactly 200 distinct enabled USD stores without granting trust or affiliate approval", () => {
    expect(originalRegistry.stores).toHaveLength(200);
    expect(samples).toHaveLength(150);
    expect(new Set(originalRegistry.stores.slice(50).map(store => store.merchantId))).toEqual(new Set(samples.map(sample => sample.merchantId)));
    const hosts = originalRegistry.stores.flatMap(store => [new URL(store.origin).hostname, ...store.aliases]);
    expect(new Set(hosts).size).toBe(hosts.length);
    for (const store of originalRegistry.stores) {
      expect(store.enabled && store.capabilities.search && store.currency === "USD" && Boolean(store.marketEvidence)).toBe(true);
      expect(store).not.toHaveProperty("trust");
      expect(store).not.toHaveProperty("affiliate");
    }
  });

  it("keeps two complementary six-store passes and never labels 200-store coverage complete", async () => {
    const send = request();
    const controller = createWooCommerceController(originalRegistry, { resolve, request: send });
    const input = WooSearchInputSchema.parse({ query: "bounded-200-store-coverage" });
    const first = await controller.search(input);
    const second = await controller.search({ ...input, continuation: first.continuation! });
    for (const result of [first, second]) {
      expect(result.diagnostics).toMatchObject({ eligibleStores: 200, plannedStores: 6, physicalRequests: 6, registryCoverageComplete: false });
    }
    expect(new Set([...first.stores, ...second.stores].map(store => store.merchantId)).size).toBe(12);
    expect(second.continuation).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(12);
  });

  it.each([
    { query: "General Pencil charcoal", id: "general-pencil" },
    { query: "Restoration Games Thunder Road", id: "restoration-games" }
  ])("routes the real newly admitted $id brand within six merchants", async ({ query, id }) => {
    const result = await createWooCommerceController(originalRegistry, { resolve, request: request() }).search(WooSearchInputSchema.parse({ query }));
    expect(result.stores[0]?.merchantId).toBe(id);
    expect(result.diagnostics.plannedStores).toBe(6);
  });

  it.each(samples)("replays $merchantId observed identity, USD price, selected attributes and approved images", async sample => {
    const store = DEFAULT_WOO_REGISTRY.stores.find(store => store.merchantId === sample.merchantId)!;
    expect(store).toBeDefined();
    expect(wooMerchantForUrl(DEFAULT_WOO_REGISTRY, sample.expected.merchantUrl)?.merchantId).toBe(sample.merchantId);
    const reader = createWooStoreReader({ resolve, request: async url => new Response(JSON.stringify(url.pathname.endsWith(`/${sample.raw.id}`) ? sample.raw : sample.parent), { headers: { "content-type": "application/json" } }) });
    const budget = () => ({ signal: new AbortController().signal, requests: 0, bytes: 0, maxRequests: 1, maxBytes: 1024 * 1024 });
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
    } else {
      expect(product.itemPrice).toEqual(historicalPrice);
      expect(product.itemPrice!.amountCents).toBeGreaterThan(0);
    }
    expect(product.images.length).toBeGreaterThan(0);
    expect(product.images.every(image => [new URL(store.origin).hostname, ...store.imageHosts].includes(new URL(image.url).hostname))).toBe(true);
    if (parent !== undefined) {
      expect(store.capabilities.variations).toBe(true);
      expect(normalizeWooProduct(parent, store, sample.observedAt)?.itemPrice).toBeUndefined();
      expect(product.priceEvidence.scope).toBe(unboundSamples.has(sample.merchantId) ? "UNKNOWN" : "VARIANT");
    }
  });
});
