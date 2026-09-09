import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUnavailableAwinPort } from "../../../packages/awin-feed/src/index.js";
import { WooLookupResultSchema, WooSearchResultSchema } from "../../../packages/contracts/src/woocommerce.js";
import { createAffiliateLinkResolver } from "../src/affiliate-links.js";
import { createFindCheapBackend } from "../src/backend.js";
import { assessCoffeeCategory } from "../src/coffee-category.js";
import { createUnavailableDealPort } from "../src/deal-client.js";
import { replaceManagedMerchantTrustRecords, resetManagedMerchantTrustRecords } from "../src/merchant-trust.js";
import type { ProductCardContent } from "../src/server.js";
import { classifyShopifyCandidate } from "../src/shopify-match.js";
import { createMemoryWatchStore } from "../src/watch-store.js";
import type { WooCommerceCatalogPort } from "../src/woocommerce-client.js";
import { connectReplay, searchResult } from "./fixtures/conversation-replay-support.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/coffee-category/woo-cup-form-sample.json", import.meta.url), "utf8")) as {
  observations: Array<{ result: unknown }>;
};
const products = fixture.observations.map(row => WooLookupResultSchema.parse(row.result).product!);
afterEach(() => { resetManagedMerchantTrustRecords(); vi.unstubAllGlobals(); });

describe("saved real roast/brew cup observations", () => {
  it.each(products)("recognizes the primary title without a coffee category: $title", product => {
    expect(product.category).toBe("");
    const facts = { title: product.title, productType: product.category, variantDimensions: product.selectedAttributes };
    // Deliberately omit the saved description, merchant identity and URL.
    expect(assessCoffeeCategory("PODS", facts).status).toBe("MATCHED");
    expect(assessCoffeeCategory("COFFEE", facts).status).toBe("MATCHED");
    expect(classifyShopifyCandidate("coffee capsules", facts).status).toBe("DISCOVERY_MATCH");
  });

  it("preserves both real Woo offers through MCP and never derives the user's machine from the 32-pod count", async () => {
    // Synthetic test trust only isolates the form/compatibility gate. These records
    // do not assert that either merchant was admitted to the real trust registry.
    replaceManagedMerchantTrustRecords(products.map(product => ({ host: product.sourceHost, level: "ESTABLISHED_RETAILER",
      evidenceUrl: product.merchantUrl, reviewedAt: "2026-09-09", status: "APPROVED" })));
    const search = vi.fn<WooCommerceCatalogPort["search"]>(async () => WooSearchResultSchema.parse({
      source: "WOOCOMMERCE_STORE_API", schemaVersion: 1, registryVersion: "saved-cup-replay", requestId: "saved-cup-replay",
      status: "COMPLETE", snapshotAt: products[0]!.checkedAt, products: structuredClone(products),
      stores: products.map(product => ({ merchantId: product.merchantId, status: "COMPLETE", requests: 0, returned: 1 })),
      diagnostics: { eligibleStores: 2, plannedStores: 2, attemptedStores: 0, succeededStores: 2, failedStores: 0, skippedStores: 0,
        physicalRequests: 0, responseBytes: 0, cacheHits: 1, elapsedMs: 0, truncated: false, registryCoverageComplete: true }
    }));
    const shopify = { search: async () => searchResult([]) };
    const backend = createFindCheapBackend({ catalog: { awin: createUnavailableAwinPort(), shopify, woocommerce: { search } },
      product: { affiliateLinks: createAffiliateLinkResolver() }, deals: createUnavailableDealPort(), verifiedDeals: false,
      watches: createMemoryWatchStore() });
    const replay = await connectReplay(shopify.search, { backend, now: () => new Date(products[1]!.checkedAt) });
    try {
      const response = await replay.client.callTool({ name: "search_products", arguments: { query: "coffee capsules",
        productType: "coffee capsules", maxItemPriceCents: 3000, contextMode: "NEW_PRODUCT", limit: 3, responseLocale: "zh-CN" } });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const initial = response.structuredContent as ProductCardContent;
      expect(initial.products).toHaveLength(2);
      for (const product of products) {
        const card = initial.products.find(candidate => candidate.merchantUrl === product.merchantUrl);
        expect(card).toMatchObject({ title: product.title, itemPrice: product.itemPrice, variantDimensions: product.selectedAttributes,
          coffeeCompatibility: { status: "UNKNOWN" } });
        expect(card?.requestIdentityStatus).not.toBe("NEEDS_VERIFICATION");
      }
      expect(initial.recommendation?.primarySelectionId).toBeUndefined();
      expect(initial.recommendation?.question).toContain("完整型号");
      expect(search.mock.calls.length).toBeLessThanOrEqual(2);
      search.mockClear();
      const next = await replay.client.callTool({ name: "search_products", arguments: { query: "coffee capsules",
        contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: initial.renderId,
        requiredFeatures: ["Compatible with Keurig K-Cup"], limit: 3 } });
      expect(next.isError, JSON.stringify(next.content)).not.toBe(true);
      const continued = next.structuredContent as ProductCardContent;
      expect(continued.goalId).toBe(initial.goalId);
      expect(continued.requirementsSummary?.maxItemPriceCents).toBe(3000);
      const meanMug = continued.products.find(card => card.merchantUrl === products[1]!.merchantUrl);
      expect(meanMug?.coffeeCompatibility).toMatchObject({ status: "MATCHED", requestedSystem: "KEURIG_K_CUP" });
      expect(continued.products.find(card => card.merchantUrl === products[0]!.merchantUrl)?.coffeeCompatibility?.status).not.toBe("MATCHED");
      expect(continued.recommendation?.primarySelectionId).toBe(meanMug?.selectionId);
      expect(search.mock.calls.length).toBeLessThanOrEqual(2);
      const original = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: initial.renderId } });
      expect((original.structuredContent as ProductCardContent).products).toEqual(initial.products);
    } finally { await replay.close(); }
  });
});

describe("synthetic cup-form counterexamples", () => {
  it.each(["Roast Tea K-Cups", "Brew Tea Single Serve Cups", "Roast Hot Chocolate K-Cups", "Brew Cocoa K-Cups",
    "Roast K-Cup Holder", "Brew Single Serve Cups Storage Rack", "Refillable Roast K-Cups", "Reusable Brew K-Cups",
    "Empty Roast Single Serve Cups", "Brew K-Cup Machine", "Roast Single Serve Cup Mug", "Brew Ceramic Cups",
    "Roast Coffee Cup", "Brew Single Serve Cups Gift Card"])("keeps explicit non-coffee evidence dominant: %s", title => {
    expect(assessCoffeeCategory("PODS", { title }).status).toBe("CONTRADICTED");
    expect(classifyShopifyCandidate("coffee capsules", { title }).status).toBe("IRRELEVANT");
  });
  it.each(["Single Serve Cups", "K-Cups", "OneCup", "House Roast", "Morning Brew"])("does not infer a coffee capsule from %s alone", title => {
    expect(assessCoffeeCategory("PODS", { title, description: "Coffee capsules roasted for brewing." }).status).not.toBe("MATCHED");
  });
  it("does not let the new title equivalence override a selected Ground child or exact different product", () => {
    expect(assessCoffeeCategory("PODS", { title: products[0]!.title, variantDimensions: { Grind: "Ground" } }).status).toBe("CONTRADICTED");
    expect(classifyShopifyCandidate("Acme Glacier Roast Coffee BB1234", { title: products[0]!.title, sku: "ZZ9999" }).status).not.toBe("EXACT");
  });
});
