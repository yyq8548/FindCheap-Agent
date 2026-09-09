import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { WooProductSchema, WooSearchInputSchema, type WooProduct } from "../../../packages/contracts/src/woocommerce.js";
import { normalizedWooAttributeName, normalizedWooAttributeValue } from "../../../packages/contracts/src/woocommerce-product-url.js";
import { createWooCommerceController } from "../src/woocommerce.js";
import { DEFAULT_WOO_REGISTRY, WooMerchantSchema, WooRegistrySchema, wooMerchantForUrl, type WooMerchant } from "../src/woocommerce-registry.js";
import { rankWooMerchants } from "../src/woocommerce-routing.js";
import { normalizeWooProduct, type WooRawProduct } from "../src/woocommerce-store.js";

type AliasEvidence = { addedName: string; value: string; urlParameter: string; parentName: string; parentTaxonomy: string; historicalKey: string };
type SavedStore = {
  merchantId: string; entry: WooMerchant; admission: string;
  controller: { sample: WooProduct };
  exactProductRecords: { value: WooRawProduct; observedAt: string; provenance: string }[];
  normalizationEvolution?: { evidence: AliasEvidence[] };
  review: { decision: string; limitations: string[] };
};
type PortableLedger = {
  complete: boolean; storefrontCount: number; target: number;
  baseline: { entries: WooMerchant[] }; stores: SavedStore[];
  reserveStores?: SavedStore[]; rawCoverageGaps: unknown[];
};
const ledger = JSON.parse(await readFile(new URL("../../../docs/engineering/changes/2026-09-08-woocommerce-expansion-1000-evidence.json", import.meta.url), "utf8")) as PortableLedger;

describe("reviewed 1000-store Woo access registry", () => {
  it("preserves the frozen 200 stores with reviewed metadata corrections and 800 admitted additions", () => {
    expect(ledger.complete).toBe(true);
    expect(ledger.storefrontCount).toBe(1000);
    expect(ledger.stores).toHaveLength(800);
    expect(ledger.rawCoverageGaps).toEqual([]);
    expect(DEFAULT_WOO_REGISTRY.stores).toHaveLength(1003);
    // Preserve the September 8 evidence ledger; enumerate only the two approved
    // September 9 corrections, with every unrelated field still compared exactly.
    const reviewedBaseline = ledger.baseline.entries.map(store => {
      if (store.merchantId === "gr-research") return { ...store, brands: ["GR Research", "Verum", "Meze"],
        categories: ["audio", "speakers", "headphone", "headphones"], reviewedAt: "2026-09-09",
        marketEvidence: "https://gr-research.com/product/meze-109-pro/", evidenceUrl: "https://gr-research.com/wp-json/wc/store/v1/products/241330" };
      if (store.merchantId === "orleans-coffee") return { ...store, origin: "https://orleanscoffee.com", aliases: ["www.orleanscoffee.com"],
        reviewedAt: "2026-09-09", evidenceUrl: "https://orleanscoffee.com/wp-json/wc/store/v1/products/65480" };
      return store;
    });
    expect(DEFAULT_WOO_REGISTRY.stores.slice(0, 200)).toEqual(reviewedBaseline);
    expect(DEFAULT_WOO_REGISTRY.stores.slice(200, 1000)).toEqual(ledger.stores.map(store => store.entry));
    expect(WooRegistrySchema.parse(DEFAULT_WOO_REGISTRY)).toEqual(DEFAULT_WOO_REGISTRY);
    expect(Buffer.byteLength(JSON.stringify(DEFAULT_WOO_REGISTRY))).toBeLessThanOrEqual(2 * 1024 * 1024);
    const hosts = DEFAULT_WOO_REGISTRY.stores.map(store => new URL(store.origin).hostname.replace(/^www\./u, ""));
    expect(new Set(hosts).size).toBe(DEFAULT_WOO_REGISTRY.stores.length);
  });

  it("adds search access without implicit official, trusted, or affiliate status", () => {
    for (const store of ledger.stores) {
      expect(store.admission).toBe("SEARCH_SOURCE_ONLY_NO_NEW_TRUST");
      expect(store.review.decision).toBe("ADMIT");
      expect(store.entry).toMatchObject({ currency: "USD", enabled: true, capabilities: { search: true } });
      expect(store.entry.marketEvidence).toMatch(/^https:\/\//u);
      for (const field of ["trust", "official", "affiliate", "popularity"]) expect(store.entry).not.toHaveProperty(field);
      expect(WooMerchantSchema.parse(store.entry)).toEqual(store.entry);
    }
  });

  it.each(ledger.stores)("replays $merchantId exact included raw identity, price and complete selection", store => {
    const entry = WooMerchantSchema.parse(store.entry);
    // Historical DTOs remain immutable; current URL selection rules apply to the replayed result.
    const expected = store.controller.sample;
    const exact = store.exactProductRecords.find(record => record.value.id === (expected.variationId ?? expected.productId));
    const parent = expected.variationId === undefined ? undefined : store.exactProductRecords.find(record => record.value.id === expected.productId);
    expect(exact).toBeDefined();
    const actual = normalizeWooProduct(exact!.value, entry, exact!.observedAt, parent?.value);
    expect(actual).toBeDefined();
    expect(WooProductSchema.parse(actual)).toEqual(actual);
    expect(actual).toMatchObject({ merchantId: store.merchantId, productId: expected.productId, merchantUrl: expected.merchantUrl });
    expect(actual!.variationId).toBe(expected.variationId);
    expect(actual!.itemPrice).toEqual(expected.itemPrice);
    expect(actual!.itemPrice?.amountCents).toBeGreaterThan(0);
    expect(actual!.itemPrice?.currency).toBe("USD");
    const expectedAttributes = { ...expected.selectedAttributes };
    for (const proof of store.normalizationEvolution?.evidence ?? []) {
      expect(expected.selectedAttributes).not.toHaveProperty(proof.addedName);
      expect(parent?.value.attributes).toEqual(expect.arrayContaining([expect.objectContaining({ name: proof.parentName, taxonomy: proof.parentTaxonomy })]));
      expect(normalizedWooAttributeName(proof.parentName)).toBe(normalizedWooAttributeName(proof.historicalKey));
      expect(normalizedWooAttributeName(proof.parentTaxonomy)).toBe(normalizedWooAttributeName(proof.addedName));
      expect(normalizedWooAttributeName(proof.urlParameter)).toBe(normalizedWooAttributeName(proof.addedName));
      expect(normalizedWooAttributeValue(expected.selectedAttributes[proof.historicalKey]!)).toBe(normalizedWooAttributeValue(proof.value));
      const parameter = new URL(expected.merchantUrl).searchParams.get(proof.urlParameter);
      expect(parameter).not.toBeNull();
      expect(normalizedWooAttributeValue(parameter!)).toBe(normalizedWooAttributeValue(proof.value));
      expectedAttributes[proof.addedName] = proof.value;
    }
    expect(actual!.selectedAttributes).toEqual(expectedAttributes);
    expect(actual!.images.length).toBeGreaterThan(0);
    expect(actual!.images.every(image => [new URL(entry.origin).hostname, ...entry.imageHosts].includes(new URL(image.url).hostname))).toBe(true);
    expect(wooMerchantForUrl({ version: "exact-raw-test", stores: [entry] }, actual!.merchantUrl)?.merchantId).toBe(store.merchantId);
    if (parent) {
      expect(actual!.priceEvidence.scope).toBe("VARIANT");
      expect(normalizeWooProduct(parent.value, entry, parent.observedAt)?.itemPrice).toBeUndefined();
    }
  });

  it.each([
    { query: "coffee capsules", productType: "coffee capsules", expected: ["bostonsbestcoffee-com", "meanmugcoffeeco-com"] },
    { query: "coffee grinder", productType: "coffee grinder", expected: ["1zpresso", "barbarossacoffee-com"] },
    { query: "充电器", productType: "charger", expected: ["iottie-com"] },
    { query: "防晒霜", productType: "sunscreen", expected: ["vanity2go-com", "georgialouise-com"] },
    { query: "床上用品", productType: "bedding", expected: ["elfinview-com", "savannahfinelinens-com"] },
    { query: "玩具", productType: "toys", expected: ["craftwarehouse-com", "aandjtoys-com"] }
  ])("routes actual admitted relevant stores within six for $query", ({ query, productType, expected }) => {
    const first = rankWooMerchants(DEFAULT_WOO_REGISTRY.stores, WooSearchInputSchema.parse({ query, productType })).slice(0, 6).map(store => store.merchantId);
    expect(first).toEqual(expect.arrayContaining(expected));
  });

  it("keeps unmapped exploration bounded without claiming 1000-store search coverage", async () => {
    const request = vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } }));
    const controller = createWooCommerceController(DEFAULT_WOO_REGISTRY, { resolve: async () => [{ address: "8.8.8.8", family: 4 }], request });
    const input = WooSearchInputSchema.parse({ query: "bounded-1000-store-contract" });
    const first = await controller.search(input);
    const second = await controller.search({ ...input, continuation: first.continuation! });
    for (const result of [first, second]) expect(result.diagnostics).toMatchObject({ eligibleStores: DEFAULT_WOO_REGISTRY.stores.length, plannedStores: 2, physicalRequests: 2, registryCoverageComplete: false });
    expect(new Set([...first.stores, ...second.stores].map(store => store.merchantId)).size).toBe(4);
    expect(second.continuation?.attemptedMerchantIds).toHaveLength(4);
    expect(request).toHaveBeenCalledTimes(4);
  });
});
