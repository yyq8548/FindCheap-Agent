import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { WooProductSchema } from "../../../packages/contracts/src/woocommerce.js";
import { WooRegistrySchema } from "../src/woocommerce-registry.js";
import { normalizeWooProduct, type WooRawProduct } from "../src/woocommerce-store.js";

// Synthetic contradictory observations, never current merchant or availability evidence.
const store = WooRegistrySchema.parse({ version: "selection-test", stores: [{ merchantId: "a", name: "A",
  origin: "https://shop.example", productPathPrefixes: ["/product/"], currency: "USD", reviewedAt: "2026-09-08",
  evidenceUrl: "https://shop.example", enabled: true, capabilities: { search: true, variations: true } }] }).stores[0]!;
const at = "2026-09-08T12:00:00.000Z";
const raw: WooRawProduct = { id: 100, name: "Coffee Capsules", type: "variable", permalink: "/product/coffee/",
  prices: { price: "1099", currency_code: "USD", currency_minor_unit: 2 }, is_in_stock: true };
const parent: WooRawProduct = { ...raw, attributes: [{ name: "Capsule System", taxonomy: "pa_capsule-system", has_variations: true }],
  variations: [{ id: 101, attributes: [{ name: "Capsule System", value: "Nespresso Original" }] }] };
const child: WooRawProduct = { ...raw, id: 101, parent: 100, type: "variation", attributes: [] };
const normalized = () => normalizeWooProduct(child, store, at, parent)!;
const taxonomyFixtures = JSON.parse(readFileSync(new URL("./fixtures/woocommerce-live/taxonomy-bindings.json", import.meta.url), "utf8")) as {
  stores: Array<{ store: typeof store; parent: WooRawProduct; child: WooRawProduct; observedAt: string;
    expected: { productId: number; variationId: number; itemPrice: { amountCents: number; currency: "USD" }; merchantUrl: string; selectedAttributes: Record<string, string> } }>;
};

describe("Woo immutable selected product and link binding", () => {
  it.each([
    "variation_id=102", "p=999", "attribute_capsule-system=Nespresso+Vertuo", "attribute_pa_grind=Whole+Bean",
    "attribute_capsule-system=Nespresso+Original&attribute_pa_capsule-system=Nespresso+Vertuo"
  ])("rejects a contradictory or unproved link: %s", query => {
    const merchantUrl = `https://shop.example/product/coffee/?${query}`;
    expect(normalizeWooProduct({ ...child, permalink: merchantUrl }, store, at, parent)).toBeUndefined();
    expect(WooProductSchema.safeParse({ ...normalized(), merchantUrl }).success).toBe(false);
  });
  it.each(["variation_id=101", "p=100&variation_id=101", "attribute_pa_capsule-system=Nespresso+Original", "attribute_capsule-system=nespresso-original&variation_id=101"])("keeps a fully bound link: %s", query => {
    const merchantUrl = `https://shop.example/product/coffee/?${query}`;
    expect(normalizeWooProduct({ ...child, permalink: merchantUrl }, store, at, parent)?.merchantUrl).toBe(merchantUrl);
    expect(WooProductSchema.safeParse({ ...normalized(), merchantUrl }).success).toBe(true);
  });
  it("rejects a selected-child URL on a simple product", () => {
    expect(normalizeWooProduct({ ...raw, type: "simple", permalink: "/product/coffee/?variation_id=101" }, store, at)).toBeUndefined();
  });
  it("binds a plain WordPress product URL to the actual product ID", () => {
    const rootStore = { ...store, productPathPrefixes: ["/"] };
    expect(normalizeWooProduct({ ...raw, type: "simple", permalink: "/?p=999" }, rootStore, at)).toBeUndefined();
    expect(normalizeWooProduct({ ...raw, type: "simple", permalink: "/?p=100" }, rootStore, at)?.productId).toBe(100);
  });
  it.each(["Capsule System", "capsule system", "pa_capsule-system", "attribute_pa_capsule-system"])("does not overwrite conflicting duplicate child dimensions: %s", name => {
    expect(normalizeWooProduct({ ...child, attributes: [{ name, value: "Nespresso Vertuo" }, { name: "Capsule System", value: "Nespresso Original" }] }, store, at, parent)).toBeUndefined();
  });
  it("retains equal duplicate observations without creating contradictory selections", () => {
    expect(normalizeWooProduct({ ...child, attributes: [{ name: "Capsule System", value: "Nespresso Original" }, { name: "capsule system", value: "Nespresso Original" }] }, store, at, parent)?.itemPrice?.amountCents).toBe(1099);
  });
  it("rejects conflicting normalized selected keys from an untrusted DTO", () => {
    expect(WooProductSchema.safeParse({ ...normalized(), selectedAttributes: { "capsule system": "Nespresso Original", "pa_capsule-system": "Nespresso Vertuo" } }).success).toBe(false);
  });
  it("requires source proof for a taxonomy name that differs from its display name", () => {
    const weightParent = { ...parent, attributes: [{ name: "Weight", taxonomy: "pa_select-weight", has_variations: true }],
      variations: [{ id: 101, attributes: [{ name: "Weight", value: "10-lbs" }] }] };
    const weightChild = { ...child, permalink: "/product/coffee/?attribute_pa_select-weight=10-lbs" };
    expect(normalizeWooProduct(weightChild, store, at, weightParent)).toMatchObject({ selectedAttributes: { weight: "10-lbs", "select-weight": "10-lbs" }, itemPrice: { amountCents: 1099 } });
    expect(normalizeWooProduct(weightChild, store, at, { ...weightParent, attributes: [{ name: "Weight", has_variations: true }] })).toBeUndefined();
  });
  it.each(taxonomyFixtures.stores)("preserves observed taxonomy mapping for $store.merchantId", fixture => {
    const product = normalizeWooProduct(fixture.child, fixture.store, fixture.observedAt, fixture.parent)!;
    expect(product).toMatchObject(fixture.expected);
    expect(WooProductSchema.safeParse(product).success).toBe(true);
    if (fixture.parent.attributes?.some(attribute => typeof attribute.taxonomy === "string")) {
      const noMetadata = { ...fixture.parent, attributes: fixture.parent.attributes?.map(attribute => ({ ...attribute, taxonomy: undefined })) };
      expect(normalizeWooProduct(fixture.child, fixture.store, fixture.observedAt, noMetadata)).toBeUndefined();
    }
  });
});
