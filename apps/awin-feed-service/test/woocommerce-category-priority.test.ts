import { describe, expect, it, vi } from "vitest";
import { WooSearchInputSchema } from "../../../packages/contracts/src/woocommerce.js";
import { createWooCommerceController } from "../src/woocommerce.js";
import { DEFAULT_WOO_REGISTRY, WooRegistrySchema, type WooMerchant } from "../src/woocommerce-registry.js";
import { planWooMerchants } from "../src/woocommerce-routing.js";

function store(merchantId: string, categories: string[], brands: string[] = []): WooMerchant {
  return { merchantId, name: merchantId, origin: `https://${merchantId}.example`, apiPath: "/wp-json/wc/store/v1",
    productPathPrefixes: ["/product/"], aliases: [], imageHosts: [], brands, categories, currency: "USD",
    reviewedAt: "2026-09-09", evidenceUrl: `https://${merchantId}.example`, enabled: true,
    capabilities: { search: true, variations: false } };
}
function controller(stores: WooMerchant[], status = 200) {
  const request = vi.fn(async () => Response.json([], { status, headers: { "x-wp-totalpages": "1" } }));
  return { request, service: createWooCommerceController(WooRegistrySchema.parse({ version: "category-priority", stores }), {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }], request
  }) };
}
const input = (productType = "lip balm", query = "Glossier Balm Dotcom Espresso") => WooSearchInputSchema.parse({ query, productType });
const coffeeIds = ["1zpresso", "espresso-vivace", "lamarzocco-home-usa"];
const actualCoffeeStores = coffeeIds.map(id => DEFAULT_WOO_REGISTRY.stores.find(store => store.merchantId === id)!);

describe("explicit product category governs Woo merchant eligibility", () => {
  it.each(["lip balm", "dress", "headphone"])("does not let Espresso override the explicit %s category for the three observed coffee stores", async productType => {
    expect(actualCoffeeStores.map(store => store.categories)).toEqual([
      ["coffee", "grinder", "espresso", "manual grinder"], ["coffee", "beans", "espresso"], ["coffee", "espresso", "portafilter"]
    ]);
    const source = controller([...actualCoffeeStores, store("compatible", [productType]), store("unknown", ["gifts"])]);
    const result = await source.service.search(input(productType));
    expect(result.stores.map(store => store.merchantId)).toEqual(["compatible", "unknown"]);
    expect(result.diagnostics).toMatchObject({ eligibleStores: 5, plannedStores: 2, physicalRequests: 2,
      routing: { matchedStores: 1, relevantPlanned: 1, explorationPlanned: 1 } });
    expect(source.request).toHaveBeenCalledTimes(2);
  });

  it("keeps explicit parent categories and a mixed merchant with a compatible category", () => {
    const stores = [store("lip", ["lip balm"]), store("skin", ["skincare"]), store("makeup", ["makeup"]),
      store("cosmetics", ["cosmetics"]), store("mixed", ["coffee", "lip balm", "unmapped"]), store("conflict", ["coffee"])];
    const plan = planWooMerchants(stores, input());
    expect(new Set(plan.stores.map(store => store.merchantId))).toEqual(new Set(["lip", "skin", "makeup", "cosmetics", "mixed"]));
    expect(plan.routing).toMatchObject({ relevantPlanned: 5, explorationPlanned: 0 });
  });

  it.each(["toner pad", "toner pads", "爽肤棉片"])("protects the observed medicube category %s without guessing from bare pads", async productType => {
    const source = controller([...actualCoffeeStores, store("skincare", ["skincare"]), store("unknown", ["gifts"])]);
    const result = await source.service.search(input(productType, "medicube Zero Pore Pad 70 pads 155g"));
    expect(result.stores.map(store => store.merchantId)).toEqual(["skincare", "unknown"]);
    expect(result.diagnostics.routing).toMatchObject({ relevantPlanned: 1, explorationPlanned: 1 });
  });

  it.each([["lip balm", "serum"], ["headphone", "amplifier"], ["dress", "shirt"]])(
    "keeps same-domain %s / %s as uncertain instead of asserting a conflict", (requested, offered) => {
      const plan = planWooMerchants([store("related", [offered!])], input(requested));
      expect(plan.stores.map(store => store.merchantId)).toEqual(["related"]);
      expect(plan.routing).toMatchObject({ relevantPlanned: 0, explorationPlanned: 1 });
    });

  it("treats shoes and boots as compatible without using the query color as another category", () => {
    const plan = planWooMerchants([store("shoes", ["footwear"]), store("coffee", ["coffee"])], input("boot", "Espresso boots"));
    expect(plan.stores.map(store => store.merchantId)).toEqual(["shoes"]);
    expect(plan.routing).toMatchObject({ relevantPlanned: 1, explorationPlanned: 0 });
  });

  it("limits empty, broad and incompletely understood metadata to two exploratory stores", async () => {
    const unknown = [[], ["beauty"], ["Home"], ["gifts"], ["accessories"], ["coffee", "unmapped"]];
    const source = controller([...unknown.map((categories, id) => store(`unknown-${id}`, categories)), store("conflict", ["book"])]);
    const result = await source.service.search(input());
    expect(result.stores).toHaveLength(2);
    expect(result.stores.every(store => store.merchantId.startsWith("unknown-"))).toBe(true);
    expect(result.diagnostics).toMatchObject({ plannedStores: 2, physicalRequests: 2,
      routing: { relevantPlanned: 0, explorationPlanned: 2 } });
    expect(result.status).toBe("COMPLETE");
  });

  it("does not rescue conflicting metadata with a brand or preferred-host match", () => {
    const plan = planWooMerchants([store("coffee", ["coffee"], ["Glossier"]), store("lip", ["lip balm"])],
      { ...input(), brand: "Glossier", preferredMerchantHost: "coffee.example" });
    expect(plan.stores.map(store => store.merchantId)).toEqual(["lip"]);
  });

  it.each([undefined, "unmapped collection"])("preserves the old query route when productType is %s", productType => {
    const plan = planWooMerchants(actualCoffeeStores, WooSearchInputSchema.parse({ query: "Espresso", productType }));
    expect(new Set(plan.stores.map(store => store.merchantId))).toEqual(new Set(coffeeIds));
  });

  it.each(["grinder", "manual grinder", "espresso", "beans", "pedal", "quilt", "notebook", "capsules", "coffee cup", "pads"])(
    "does not turn the ambiguous or unmodelled bare merchant label %s into a hard conflict", category => {
      const plan = planWooMerchants([store("ambiguous", [category])], input());
      expect(plan.stores.map(store => store.merchantId)).toEqual(["ambiguous"]);
      expect(plan.routing).toMatchObject({ relevantPlanned: 0, explorationPlanned: 1 });
    });

  it("uses only the merchant's explicit coffee categories to interpret ambiguous coffee labels", () => {
    const stores = [store("context", ["coffee", "grinder", "espresso", "beans"]),
      store("brand-only", ["grinder", "espresso"], ["Coffee"]), store("mixed-unknown", ["coffee", "grinder", "unknown line"])];
    const plan = planWooMerchants(stores, input());
    expect(new Set(plan.stores.map(store => store.merchantId))).toEqual(new Set(["brand-only", "mixed-unknown"]));
    expect(plan.routing).toMatchObject({ relevantPlanned: 0, explorationPlanned: 2 });
  });

  it("keeps an already registry-bound direct product URL despite conflicting store summary metadata", async () => {
    const source = controller([store("coffee", ["coffee"]), store("lip", ["lip balm"])]);
    const result = await source.service.search({ ...input(), productUrl: "https://coffee.example/product/balm" });
    expect(result.stores.map(store => store.merchantId)).toEqual(["coffee"]);
    expect(result.status).toBe("COMPLETE");
    expect(source.request).toHaveBeenCalledOnce();
    await expect(source.service.search({ ...input(), productUrl: "https://unregistered.example/product/balm" }))
      .rejects.toMatchObject({ reason: "SECURITY_REJECTED" });
    expect(source.request).toHaveBeenCalledOnce();
  });

  it("completes a deliberately empty all-conflict plan without merchant reads or an empty continuation", async () => {
    const source = controller([store("books", ["book"]), store("coffee", ["coffee"])]);
    const result = await source.service.search(input("wig", "Fascination"));
    expect(result).toMatchObject({ status: "COMPLETE", products: [], stores: [], diagnostics: {
      eligibleStores: 2, plannedStores: 0, attemptedStores: 0, physicalRequests: 0, failedStores: 0,
      registryCoverageComplete: false, routing: { matchedStores: 0, relevantPlanned: 0, explorationPlanned: 0 }
    } });
    expect(result.continuation).toBeUndefined();
    expect(source.request).not.toHaveBeenCalled();
  });

  it("does not hide an unavailable compatible store behind the category exclusion of available stores", async () => {
    const source = controller([store("lip", ["lip balm"]), store("coffee", ["coffee"])], 403);
    const first = await source.service.search(input());
    expect(first.status).toBe("UNAVAILABLE");
    expect(first.stores).toMatchObject([{ merchantId: "lip", reason: "ACCESS_DENIED" }]);
    expect(source.request).toHaveBeenCalledOnce();
    const next = await source.service.search(input());
    expect(next.status).toBe("UNAVAILABLE");
    expect(next.stores).toMatchObject([{ merchantId: "lip", status: "SKIPPED" }]);
    expect(source.request).toHaveBeenCalledOnce();
  });

  it("preserves the not-configured state separately from a deliberate empty category plan", async () => {
    const source = controller([]);
    expect((await source.service.search(input())).status).toBe("NOT_CONFIGURED");
    expect(source.request).not.toHaveBeenCalled();
  });

  it("keeps each pass at six stores and two unknowns while continuation visits new candidates", async () => {
    const stores = [...Array.from({ length: 8 }, (_, id) => store(`compatible-${id}`, ["lip balm"])),
      ...Array.from({ length: 6 }, (_, id) => store(`unknown-${id}`, ["gifts"])), store("coffee", ["coffee"])];
    const source = controller(stores);
    const first = await source.service.search(input());
    const second = await source.service.search({ ...input(), continuation: first.continuation! });
    expect(first.stores).toHaveLength(6);
    expect(first.diagnostics.routing).toMatchObject({ relevantPlanned: 6, explorationPlanned: 0 });
    expect(second.diagnostics.routing).toMatchObject({ relevantPlanned: 2, explorationPlanned: 2 });
    expect(second.stores).toHaveLength(4);
    expect(new Set([...first.stores, ...second.stores].map(store => store.merchantId)).size).toBe(10);
    expect(source.request).toHaveBeenCalledTimes(10);
  });
});
