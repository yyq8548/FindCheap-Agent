import { afterEach, describe, expect, it, vi } from "vitest";
import { createUnavailableAwinPort } from "../../../packages/awin-feed/src/index.js";
import { WooSearchInputSchema, WooSearchResultSchema, type WooSearchInput } from "../../../packages/contracts/src/woocommerce.js";
import { SearchProductsInputSchema, searchProducts, type SearchProductsInput } from "../src/search-products.js";
import { mergeSearchRequirements } from "../src/search-requirements-context.js";
import { createWooCommercePortFromEnvironment } from "../src/woocommerce-client.js";
import { enforceVisualEvidenceAuthority } from "../src/visual-product-discovery.js";
import { searchResult } from "./fixtures/conversation-replay-support.js";

afterEach(() => vi.unstubAllGlobals());

// Public search workflow and production HTTP client/DTO. Synthetic empty
// responses prove transport behavior, not a native image or shopping outcome.
async function transmitted(input: SearchProductsInput) {
  const before = structuredClone(input);
  const requests: WooSearchInput[] = [];
  const accidentalNetwork = vi.fn(() => { throw new Error("NETWORK_FORBIDDEN"); });
  vi.stubGlobal("fetch", accidentalNetwork);
  const woocommerce = createWooCommercePortFromEnvironment({ WOOCOMMERCE_API_BASE_URL: "https://source.example" }, {
    fetch: async (url, options) => {
      expect(String(url)).toBe("https://source.example/v1/woocommerce/search");
      expect(options).toMatchObject({ method: "POST", redirect: "error" });
      requests.push(WooSearchInputSchema.parse(JSON.parse(String(options?.body))));
      return Response.json(WooSearchResultSchema.parse({ source: "WOOCOMMERCE_STORE_API", schemaVersion: 1,
        registryVersion: "visual-type-fixture", requestId: `request-${requests.length}`, status: "COMPLETE",
        snapshotAt: "2026-09-09T23:00:00.000Z", products: [], stores: [], diagnostics: {
          eligibleStores: 0, plannedStores: 0, attemptedStores: 0, succeededStores: 0, failedStores: 0,
          skippedStores: 0, physicalRequests: 0, responseBytes: 0, cacheHits: 0, elapsedMs: 1,
          truncated: false, registryCoverageComplete: true
        } }));
    }
  })!;
  const result = await searchProducts(input, { woocommerce, awin: createUnavailableAwinPort(),
    shopify: { search: async () => searchResult([]) } });
  expect(result.searchPasses).toBe(2);
  expect(requests).toHaveLength(2);
  expect(requests.map(request => request.limit)).toEqual([12, 24]);
  expect(input).toEqual(before);
  expect(result.resolvedRequest).toBeUndefined();
  expect(accidentalNetwork).not.toHaveBeenCalled();
  return requests;
}

function visualInput() {
  const parsed = SearchProductsInputSchema.parse({ query: "Espresso lip balm", maxItemPriceCents: 2000,
    requiredFeatures: ["brown"], visualInput: { productType: "lip balm", colors: ["brown"],
      brand: "Observed Fixture", hardClues: ["brown tube"] } });
  return { ...parsed, visualInput: enforceVisualEvidenceAuthority(parsed.visualInput!) };
}

describe("Woo visual routing type at the public search and HTTP boundary", () => {
  it.each(["NEW_PRODUCT", "CONTINUE_PREVIOUS_PRODUCT"] as const)("preserves nested visual category for %s without promoting identity", async contextMode => {
    const previous = visualInput();
    const input = contextMode === "NEW_PRODUCT" ? previous : mergeSearchRequirements(
      SearchProductsInputSchema.parse({ query: previous.query, contextMode, maxItemPriceCents: 1800 }), previous);
    expect(input.productType).toBeUndefined();
    expect(input.brand).toBeUndefined();
    const requests = await transmitted(input);
    for (const request of requests) {
      expect(request.productType).toBe("lip balm");
      expect(request.brand).toBeUndefined();
      expect(request.productUrl).toBeUndefined();
      expect(request.maxItemPriceCents).toBe(contextMode === "NEW_PRODUCT" ? 2000 : 1800);
    }
  });

  it("keeps the explicit top-level category ahead of a different observed type", async () => {
    const input = { ...visualInput(), productType: "cosmetics" };
    expect(input.visualInput.productType).toBe("lip balm");
    const requests = await transmitted(input);
    expect(requests.map(request => request.productType)).toEqual(["cosmetics", "cosmetics"]);
  });

  it("preserves the ordinary typed text category on both passes", async () => {
    const requests = await transmitted(SearchProductsInputSchema.parse({ query: "Espresso", productType: "lip balm" }));
    expect(requests.map(request => request.productType)).toEqual(["lip balm", "lip balm"]);
  });

  it("keeps type absent when neither input supplies it instead of guessing from query", async () => {
    const requests = await transmitted(SearchProductsInputSchema.parse({ query: "espresso coffee" }));
    expect(requests.every(request => request.productType === undefined)).toBe(true);
  });
});
