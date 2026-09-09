import { describe, expect, it, vi } from "vitest";
import { WooProductSchema, WooSearchResultSchema } from "../../../packages/contracts/src/woocommerce.js";
import { createAffiliateLinkResolver } from "../src/affiliate-links.js";
import { createFindCheapBackend } from "../src/backend.js";
import { createUnavailableDealPort } from "../src/deal-client.js";
import { SearchProductsInputSchema, evaluateSearchProductRequirements, searchProducts } from "../src/search-products.js";
import type { ProductCardContent } from "../src/server.js";
import { createMemoryWatchStore } from "../src/watch-store.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

const emptyAwin = { search: async () => ({ source: "AWIN_PRODUCT_FEED" as const, coverage: "COMPLETE" as const,
  snapshotAt: "2026-09-08T22:00:00.000Z", products: [],
  diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 } }) };
const canonicalProductUrl = "https://ishowbeauty.com/products/coffee-capsules";
const original = product({ title: "Coffee Capsules", productType: "coffee", handle: "1001",
  variantDimensions: { "Capsule System": "Nespresso Original" }, merchantUrl: `${canonicalProductUrl}?variant=1001` });
const vertuo = { ...original, handle: "1002", variantDimensions: { "Capsule System": "Nespresso Vertuo" }, merchantUrl: `${canonicalProductUrl}?variant=1002` };

describe("selected capsule compatibility remains snapshot-bound", () => {
  it("also prevents an unknown-machine primary when generic coffee returns a capsule offer", async () => {
    const search = vi.fn(async () => searchResult([original]));
    const execution = await searchProducts(SearchProductsInputSchema.parse({ query: "coffee", productType: "coffee" }), { awin: emptyAwin, shopify: { search } });
    expect(execution.candidates).toHaveLength(1);
    expect(execution.candidates[0]?.coffeeCompatibility).toMatchObject({ status: "UNKNOWN" });
    expect(execution.candidateFunnel).toMatchObject({ requirementsMatchedUnique: 1, recommendableUnique: 0 });
    expect(execution.sourcePassDiagnostics[0]?.sourceQueries?.shopify).toBe("coffee");
  });

  it("does not infer the user's machine from a selected product variant", async () => {
    const inspect = vi.fn(async () => ({ productTitle: original.title, canonicalProductUrl, variants: [original] }));
    const replay = await connectReplay(async () => searchResult([original]), { awin: emptyAwin, selectedProducts: { inspect } });
    try {
      const first = (await replay.client.callTool({ name: "search_products", arguments: { query: "coffee capsules", productType: "coffee capsules", responseLocale: "zh-CN" } })).structuredContent as ProductCardContent;
      const inspected = await replay.client.callTool({ name: "inspect_selected_product", arguments: { renderId: first.renderId,
        position: 1, variantDimensions: { "Capsule System": "Nespresso Original" }, responseLocale: "zh-CN" } });
      expect(inspected.isError, JSON.stringify(inspected.content)).not.toBe(true);
      expect(inspected.structuredContent).toMatchObject({ status: "OK", updatedSnapshot: {
        products: [{ coffeeCompatibility: { status: "UNKNOWN" } }],
        recommendation: { state: "MATCHES_AVAILABLE", question: expect.stringContaining("完整型号") }
      } });
      const updated = (inspected.structuredContent as { updatedSnapshot: ProductCardContent }).updatedSnapshot;
      expect(updated.recommendation?.primarySelectionId).toBeUndefined();
      expect(inspect).toHaveBeenCalledOnce();
      const old = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: first.renderId } });
      expect((old.structuredContent as ProductCardContent).products).toEqual(first.products);
    } finally { await replay.close(); }
  });

  it("rejects an incompatible inspected sibling instead of reopening the original requirement", async () => {
    const inspect = vi.fn(async () => ({ productTitle: original.title, canonicalProductUrl, variants: [vertuo] }));
    const replay = await connectReplay(async () => searchResult([original]), { awin: emptyAwin, selectedProducts: { inspect } });
    try {
      const first = (await replay.client.callTool({ name: "search_products", arguments: { query: "coffee capsules", productType: "coffee capsules",
        requiredFeatures: ["Compatible with Nespresso Original"] } })).structuredContent as ProductCardContent;
      expect(first.recommendation?.state).toBe("READY");
      const inspected = await replay.client.callTool({ name: "inspect_selected_product", arguments: { renderId: first.renderId,
        position: 1, variantDimensions: { "Capsule System": "Nespresso Vertuo" } } });
      expect(inspected.isError, JSON.stringify(inspected.content)).not.toBe(true);
      expect(inspected.structuredContent).toMatchObject({ status: "NO_MATCHING_VARIANT", variants: [] });
      const old = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: first.renderId } });
      expect((old.structuredContent as ProductCardContent).products).toEqual(first.products);
    } finally { await replay.close(); }
  });

  it("does not erase unrelated or combined hard requirements when system compatibility is verified", () => {
    const request = SearchProductsInputSchema.parse({ query: "coffee capsules", productType: "coffee capsules",
      requiredFeatures: ["Compatible with Nespresso Original", "organic"] });
    const checked = evaluateSearchProductRequirements(original, request);
    expect(checked.matched).toContain("Compatible with Nespresso Original");
    expect(checked.unknown).toContain("organic");
    expect(checked.assessment.status).toBe("NEEDS_VERIFICATION");
    const combined = evaluateSearchProductRequirements(original, { ...request,
      requiredFeatures: ["Compatible with Nespresso Original and organic"] });
    expect(combined.unknown).toContain("Compatible with Nespresso Original and organic");
  });

  it("also rejects an incompatible Woo child within the locked original product family", async () => {
    const capsule = WooProductSchema.parse({ sourceKind: "WOOCOMMERCE_STORE_API", merchantId: "coffee-fixture",
      merchantName: "Synthetic Coffee", sourceHost: "coffee-fixture.example", productId: 10, parentProductId: 10, variationId: 11,
      title: "Coffee Capsules", category: "coffee", productType: "variation", condition: "NEW",
      attributes: [], variantDimensions: { "Capsule System": ["Nespresso Original", "Nespresso Vertuo"] },
      selectedAttributes: { "Capsule System": "Nespresso Original" }, merchantUrl: "https://coffee-fixture.example/product/capsules?variation_id=11", images: [],
      itemPrice: { amountCents: 1199, currency: "USD" }, availability: "IN_STOCK", availabilityScope: "VARIANT",
      priceEvidence: { amountMinor: "1199", currency: "USD", currencyMinorUnit: 2, scope: "VARIANT", taxBasis: "UNKNOWN" },
      rating: { value: 4.8, reviewCount: 25, scale: 5, productId: 10 }, checkedAt: original.checkedAt });
    const sibling = { ...capsule, variationId: 12, selectedAttributes: { "Capsule System": "Nespresso Vertuo" },
      merchantUrl: "https://coffee-fixture.example/product/capsules?variation_id=12" };
    const inspect = vi.fn(async () => ({ source: "WOOCOMMERCE_STORE_API" as const, registryVersion: "fixture-v1", status: "COMPLETE" as const,
      products: [sibling], checkedAt: original.checkedAt, truncated: false }));
    const lookup = vi.fn(async () => ({ source: "WOOCOMMERCE_STORE_API" as const, registryVersion: "fixture-v1", status: "FOUND" as const,
      product: capsule, checkedAt: original.checkedAt }));
    const wooResult = WooSearchResultSchema.parse({ source: "WOOCOMMERCE_STORE_API", schemaVersion: 1, registryVersion: "fixture-v1",
      requestId: "capsule-inspection", status: "COMPLETE", snapshotAt: original.checkedAt, products: [capsule],
      stores: [{ merchantId: capsule.merchantId, status: "COMPLETE", requests: 1, returned: 1 }],
      diagnostics: { eligibleStores: 1, plannedStores: 1, attemptedStores: 1, succeededStores: 1, failedStores: 0, skippedStores: 0,
        physicalRequests: 1, responseBytes: 100, cacheHits: 0, elapsedMs: 1, truncated: false, registryCoverageComplete: true } });
    const shopify = { search: async () => searchResult([]) };
    const backend = createFindCheapBackend({ catalog: { awin: emptyAwin, shopify, woocommerce: { search: async () => wooResult } },
      product: { affiliateLinks: createAffiliateLinkResolver(), woocommerceProducts: { inspect, lookup } }, deals: createUnavailableDealPort(),
      verifiedDeals: false, watches: createMemoryWatchStore() });
    const replay = await connectReplay(shopify.search, { backend });
    try {
      const first = (await replay.client.callTool({ name: "search_products", arguments: { query: "coffee capsules", productType: "coffee capsules",
        requiredFeatures: ["Compatible with Nespresso Original"] } })).structuredContent as ProductCardContent;
      expect(first.products).toHaveLength(1);
      const result = await replay.client.callTool({ name: "inspect_selected_product", arguments: { renderId: first.renderId,
        position: 1, variantDimensions: { "Capsule System": "Nespresso Vertuo" } } });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ status: "NO_MATCHING_VARIANT", variants: [] });
      expect(inspect.mock.calls).toHaveLength(1);
      expect(lookup).not.toHaveBeenCalled();
      const old = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: first.renderId } });
      expect((old.structuredContent as ProductCardContent).products).toEqual(first.products);
    } finally { await replay.close(); }
  });
});
