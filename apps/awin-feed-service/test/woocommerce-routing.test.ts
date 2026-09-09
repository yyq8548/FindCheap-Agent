import { describe, expect, it } from "vitest";
import { createWooCommerceController } from "../src/woocommerce.js";
import { WooRegistrySchema } from "../src/woocommerce-registry.js";
import { WooSearchInputSchema } from "../../../packages/contracts/src/woocommerce.js";

const store = (merchantId: string, brands: string[] = [], categories: string[] = []) => ({
  merchantId, name: merchantId, origin: `https://${merchantId}.example`, brands, categories, productPathPrefixes: ["/"],
  currency: "USD", reviewedAt: "2026-09-08", evidenceUrl: `https://${merchantId}.example/`, enabled: true,
  capabilities: { search: true, variations: false }
});
const controller = (stores: ReturnType<typeof store>[]) => createWooCommerceController(WooRegistrySchema.parse({ version: "routing", stores }), {
  resolve: async () => [{ address: "8.8.8.8", family: 4 }],
  request: async () => new Response("[]", { headers: { "content-type": "application/json" } })
});
const fillers = () => Array.from({ length: 199 }, (_, i) => store(`store-${i}`));

describe("Woo merchant selection with 200 reviewed stores", () => {
  it("prioritizes a known official host without granting access to an unknown hinted host", async () => {
    const stores = [...fillers(), store("z-official")];
    const service = controller(stores);
    const result = await service.search(WooSearchInputSchema.parse({ query: "pencil", preferredMerchantHost: "z-official.example" }));
    expect(result.stores[0]?.merchantId).toBe("z-official");
    expect(result.diagnostics).toMatchObject({ plannedStores: 3, routing: { relevantPlanned: 1, explorationPlanned: 2 } });
    const unknown = await service.search(WooSearchInputSchema.parse({ query: "pencil", preferredMerchantHost: "unlisted.example" }));
    expect(unknown.stores.every(entry => stores.some(store => store.merchantId === entry.merchantId))).toBe(true);
    expect(unknown.diagnostics).toMatchObject({ plannedStores: 2, routing: { matchedStores: 0, explorationPlanned: 2 } });
  });
  it("prioritizes an explicitly requested brand over many generic category labels", async () => {
    const generic = Array.from({ length: 7 }, (_, i) => store(`a-generic-${i}`, [], ["manual", "coffee", "grinder", "espresso", "travel"]));
    const result = await controller([...generic, store("z-grinder", ["1Zpresso"], ["grinder"])]).search(WooSearchInputSchema.parse({ query: "manual coffee grinder espresso travel", brand: "1Zpresso" }));
    expect(result.stores[0]?.merchantId).toBe("z-grinder");
    expect(result.diagnostics.plannedStores).toBe(6);
  });

  it.each([
    { query: "手摇磨豆机", category: "grinder" },
    { query: "双肩包", category: "backpack" },
    { query: "headphones", category: "headphone" }
  ])("routes $query to a reviewed category without changing product matching", async ({ query, category }) => {
    const result = await controller([...fillers(), store("z-specialist", [], [category])]).search(WooSearchInputSchema.parse({ query }));
    expect(result.stores[0]?.merchantId).toBe("z-specialist");
    expect(result.diagnostics).toMatchObject({ eligibleStores: 200, plannedStores: 3, physicalRequests: 3, registryCoverageComplete: false,
      routing: { relevantPlanned: 1, explorationPlanned: 2 } });
  });

  it("normalizes punctuation, case and accents for a reviewed brand phrase", async () => {
    const result = await controller([...fillers(), store("z-cycle", ["René Herse"], ["bicycle"])]).search(WooSearchInputSchema.parse({ query: "RENE-HERSE Barlow Pass" }));
    expect(result.stores[0]?.merchantId).toBe("z-cycle");
  });

  it("does not match a short brand inside an unrelated word", async () => {
    const coffee = Array.from({ length: 6 }, (_, i) => store(`z-coffee-${i}`, [], ["coffee"]));
    const result = await controller([store("a-pine", ["Pine"]), ...coffee]).search(WooSearchInputSchema.parse({ query: "pineapple coffee" }));
    expect(result.stores.map(s => s.merchantId)).not.toContain("a-pine");
  });

  it("uses deterministic query-specific ties while preserving complementary bounded passes", async () => {
    const stores = [...fillers(), store("z-last")];
    const firstInput = WooSearchInputSchema.parse({ query: "unmapped-alpha-123" });
    const service = controller(stores);
    const first = await service.search(firstInput);
    const repeated = await controller(stores).search(firstInput);
    const other = await service.search(WooSearchInputSchema.parse({ query: "unmapped-beta-456" }));
    expect(first.stores.map(s => s.merchantId)).toEqual(repeated.stores.map(s => s.merchantId));
    expect(first.stores.map(s => s.merchantId)).not.toEqual(other.stores.map(s => s.merchantId));
    const next = await service.search({ ...firstInput, continuation: first.continuation! });
    expect(new Set([...first.stores, ...next.stores].map(s => s.merchantId)).size).toBe(4);
    expect(next.continuation?.attemptedMerchantIds).toHaveLength(4);
    expect(next.diagnostics.registryCoverageComplete).toBe(false);
  });
});
