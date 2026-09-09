import { describe, expect, it } from "vitest";
import { WooSearchInputSchema } from "../../../packages/contracts/src/woocommerce.js";
import { createWooCommerceController } from "../src/woocommerce.js";
import { WooRegistrySchema, type WooMerchant } from "../src/woocommerce-registry.js";
import { rankWooMerchants } from "../src/woocommerce-routing.js";

function store(merchantId: string, categories: string[], brands: string[] = []): WooMerchant {
  return { merchantId, name: merchantId, origin: `https://${merchantId}.example`, apiPath: "/wp-json/wc/store/v1",
    productPathPrefixes: ["/product/"], imageHosts: [], aliases: [], brands, categories, currency: "USD",
    reviewedAt: "2026-09-08", evidenceUrl: `https://${merchantId}.example/`, enabled: true,
    capabilities: { search: true, variations: false } };
}

describe("Woo form routing within a thousand-store access registry", () => {
  it.each(["coffee capsules", "coffee pods", "胶囊咖啡"])("uses verified capsule categories for %s ahead of broad coffee labels", productType => {
    const generic = Array.from({ length: 999 }, (_, id) => store(`generic-${id}`, ["coffee", "espresso", "coffee beans"]));
    const capsuleStore = store("capsule-specialist", ["coffee pods"]);
    const input = WooSearchInputSchema.parse({ query: "coffee", productType });
    expect(rankWooMerchants([...generic, capsuleStore], input)[0]?.merchantId).toBe("capsule-specialist");
  });

  it("never treats cleaning or supplement capsules as a verified coffee form", () => {
    const stores = [store("cleaning", ["cleaning", "capsules"]), store("vitamins", ["supplements", "capsules"]),
      store("coffee-roaster", ["coffee"]), store("coffee-capsules", ["coffee capsules"])];
    const ordered = rankWooMerchants(stores, WooSearchInputSchema.parse({ query: "coffee", productType: "coffee capsules" }));
    expect(ordered.slice(0, 2).map(item => item.merchantId)).toEqual(["coffee-capsules", "coffee-roaster"]);
  });

  it("keeps explicit brand and approved origin hints ahead of category preferences", () => {
    const requested = store("requested-brand", ["coffee"], ["Requested Brand"]);
    const capsule = store("capsule-specialist", ["coffee capsules"]);
    const branded = WooSearchInputSchema.parse({ query: "coffee", productType: "coffee capsules", brand: "Requested Brand" });
    expect(rankWooMerchants([capsule, requested], branded)[0]?.merchantId).toBe("requested-brand");
    expect(rankWooMerchants([capsule, requested], { ...branded, brand: undefined,
      preferredMerchantHost: "requested-brand.example" })[0]?.merchantId).toBe("requested-brand");
  });

  it.each([
    ["连衣裙", "dress"], ["防晒霜", "sunscreen"], ["猫粮", "cat food"],
    ["充电器", "charger"], ["瑜伽垫", "yoga mat"], ["保温杯", "insulated bottle"]
  ])("routes common category %s using explicit catalog category %s", (query, category) => {
    const stores = Array.from({ length: 999 }, (_, id) => store(`unrelated-${id}`, ["book"]));
    stores.push(store("category-specialist", [category]));
    expect(rankWooMerchants(stores, WooSearchInputSchema.parse({ query }))[0]?.merchantId).toBe("category-specialist");
  });

  it("keeps six shops per pass and excludes previous shops when the registry grows to one thousand", async () => {
    const stores = Array.from({ length: 1000 }, (_, id) => store(`store-${id}`, ["coffee"]));
    let reads = 0;
    const controller = createWooCommerceController(WooRegistrySchema.parse({ version: "thousand-store-test", stores }), {
      resolve: async () => [{ address: "8.8.8.8", family: 4 }],
      request: async () => { reads += 1; return Response.json([]); }
    });
    const input = WooSearchInputSchema.parse({ query: "coffee", productType: "coffee capsules" });
    const first = await controller.search(input);
    expect(first.diagnostics).toMatchObject({ eligibleStores: 1000, plannedStores: 6, attemptedStores: 6 });
    expect(first.continuation).toBeDefined();
    const next = await controller.search({ ...input, continuation: first.continuation });
    expect(next.diagnostics).toMatchObject({ eligibleStores: 1000, plannedStores: 6, attemptedStores: 6 });
    expect(new Set([...first.stores, ...next.stores].map(item => item.merchantId)).size).toBe(12);
    expect(reads).toBe(12);
    expect(next.continuation).toBeUndefined();
  });
});
