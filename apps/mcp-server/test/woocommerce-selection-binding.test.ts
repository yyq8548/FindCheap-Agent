import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createUnavailableAwinPort } from "../../../packages/awin-feed/src/index.js";
import { WooSearchResultSchema } from "../../../packages/contracts/src/woocommerce.js";
import { WooRegistrySchema } from "../../awin-feed-service/src/woocommerce-registry.js";
import { normalizeWooProduct, type WooRawProduct } from "../../awin-feed-service/src/woocommerce-store.js";
import { createFindCheapBackend } from "../src/backend.js";
import { createAffiliateLinkResolver } from "../src/affiliate-links.js";
import { createUnavailableDealPort } from "../src/deal-client.js";
import { createMemoryWatchStore } from "../src/watch-store.js";
import { replaceManagedMerchantTrustRecords, resetManagedMerchantTrustRecords } from "../src/merchant-trust.js";
import type { ProductCardContent } from "../src/server.js";
import { connectReplay, REPLAY_NOW, searchResult } from "./fixtures/conversation-replay-support.js";
import { matchesWooProductUrl } from "../src/woocommerce-product.js";

// Explicit synthetic upstream contradictions exercise the registered MCP path.
// The merchant, prices and trust below are fixture facts, not live acceptance.
const store = WooRegistrySchema.parse({ version: "binding-test", stores: [{ merchantId: "synthetic-coffee", name: "Synthetic Coffee",
  origin: "https://synthetic-coffee.example", productPathPrefixes: ["/product/"], currency: "USD", reviewedAt: "2026-09-08",
  evidenceUrl: "https://synthetic-coffee.example/about/", enabled: true, capabilities: { search: true, variations: true } }] }).stores[0]!;
const parent: WooRawProduct = { id: 100, name: "Coffee Capsules", type: "variable", permalink: "/product/coffee/",
  prices: { price: "1099", currency_code: "USD", currency_minor_unit: 2 }, is_in_stock: true,
  images: [{ id: 1, src: "https://synthetic-coffee.example/coffee.jpg" }], categories: [{ name: "coffee" }],
  attributes: [{ name: "Capsule System", has_variations: true }], variations: [{ id: 101, attributes: [{ name: "Capsule System", value: "Nespresso Original" }] }] };
const child: WooRawProduct = { ...parent, id: 101, parent: 100, type: "variation", attributes: [] };
const saved = JSON.parse(readFileSync(new URL("../../awin-feed-service/test/fixtures/woocommerce-live/taxonomy-bindings.json", import.meta.url), "utf8")) as {
  stores: Array<{ store: typeof store; parent: WooRawProduct; child: WooRawProduct; observedAt: string }>;
};
afterEach(() => resetManagedMerchantTrustRecords());

describe("Woo variant-link evidence survives the registered MCP recommendation path", () => {
  it("retains actual custom display-name selections when searching their exact URL", () => {
    for (const fixture of saved.stores) {
      const normalized = normalizeWooProduct(fixture.child, fixture.store, fixture.observedAt, fixture.parent)!;
      expect(matchesWooProductUrl(normalized, normalized.merchantUrl)).toBe(true);
    }
  });
  it.each(saved.stores)("supports saved $store.merchantId product URLs through MCP", async fixture => {
    const product = normalizeWooProduct(fixture.child, fixture.store, fixture.observedAt, fixture.parent)!;
    // Trust is injected for this workflow assertion, not granted by the saved catalog.
    replaceManagedMerchantTrustRecords([{ host: new URL(product.merchantUrl).hostname.replace(/^www\./u, ""), level: "ESTABLISHED_RETAILER",
      evidenceUrl: fixture.store.evidenceUrl, reviewedAt: fixture.store.reviewedAt, status: "APPROVED" }]);
    const shopify = { search: async () => searchResult([]) };
    const woocommerce = { search: async () => WooSearchResultSchema.parse({ source: "WOOCOMMERCE_STORE_API", schemaVersion: 1,
      registryVersion: "saved-binding-test", requestId: "saved-binding-test", status: "COMPLETE", snapshotAt: product.checkedAt, products: [product],
      stores: [{ merchantId: product.merchantId, status: "COMPLETE", requests: 1, returned: 1 }],
      diagnostics: { eligibleStores: 1, plannedStores: 1, attemptedStores: 1, succeededStores: 1, failedStores: 0, skippedStores: 0,
        physicalRequests: 1, responseBytes: 1000, cacheHits: 0, elapsedMs: 1, truncated: false, registryCoverageComplete: true } }) };
    const backend = createFindCheapBackend({ catalog: { shopify, woocommerce, awin: createUnavailableAwinPort() },
      product: { affiliateLinks: createAffiliateLinkResolver() }, deals: createUnavailableDealPort(), watches: createMemoryWatchStore(), verifiedDeals: false });
    const replay = await connectReplay(shopify.search, { backend, now: () => new Date(product.checkedAt) });
    try {
      const response = await replay.client.callTool({ name: "search_products", arguments: { query: product.merchantUrl, contextMode: "NEW_PRODUCT", limit: 1 } });
      expect(response.isError).not.toBe(true);
      const snapshot = response.structuredContent as ProductCardContent;
      expect(snapshot.products).toHaveLength(1);
      expect(snapshot.products[0]).toMatchObject({ merchantUrl: product.merchantUrl, itemPrice: product.itemPrice });
      expect(snapshot.recommendation?.primarySelectionId, JSON.stringify({ recommendation: snapshot.recommendation, product: snapshot.products[0] })).toBe(snapshot.products[0]!.selectionId);
    } finally { await replay.close(); }
  });
  it.each([
    { name: "bound Original", raw: child, parent, expectedCards: 1, primary: true },
    { name: "explicitly purchasable Original", raw: { ...child, is_purchasable: true }, parent, expectedCards: 1, primary: true },
    { name: "in stock but explicitly non-purchasable", raw: { ...child, is_purchasable: false }, parent, expectedCards: 0, primary: false },
    { name: "another child URL", raw: { ...child, permalink: "/product/coffee/?variation_id=102" }, parent, expectedCards: 0, primary: false },
    { name: "another product ID URL", raw: { ...child, permalink: "/product/coffee/?p=999" }, parent, expectedCards: 0, primary: false },
    { name: "Vertuo link with Original facts", raw: { ...child, permalink: "/product/coffee/?attribute_capsule-system=Nespresso+Vertuo" }, parent, expectedCards: 0, primary: false },
    { name: "overwritten child selection", raw: { ...child, attributes: [{ name: "Capsule System", value: "Nespresso Vertuo" }, { name: "capsule system", value: "Nespresso Original" }] }, parent, expectedCards: 0, primary: false },
    { name: "missing mandatory system", raw: child, parent: { ...parent, variations: [{ id: 101, attributes: [] }] }, expectedCards: 0, primary: false },
    { name: "unknown user's machine", raw: child, parent, expectedCards: 1, primary: false, unknownRequest: true }
  ])("$name", async fixture => {
    replaceManagedMerchantTrustRecords([{ host: "synthetic-coffee.example", level: "ESTABLISHED_RETAILER",
      evidenceUrl: store.evidenceUrl, reviewedAt: store.reviewedAt, status: "APPROVED" }]);
    const product = normalizeWooProduct(fixture.raw, store, REPLAY_NOW.toISOString(), fixture.parent);
    const products = product === undefined ? [] : [product];
    const shopify = { search: async () => searchResult([]) };
    const woocommerce = { search: async () => WooSearchResultSchema.parse({ source: "WOOCOMMERCE_STORE_API", schemaVersion: 1,
      registryVersion: "binding-test", requestId: "binding-test", status: "COMPLETE", snapshotAt: REPLAY_NOW.toISOString(), products,
      stores: [{ merchantId: store.merchantId, status: "COMPLETE", requests: 1, returned: products.length }],
      diagnostics: { eligibleStores: 1, plannedStores: 1, attemptedStores: 1, succeededStores: 1, failedStores: 0, skippedStores: 0,
        physicalRequests: 1, responseBytes: 1000, cacheHits: 0, elapsedMs: 1, truncated: false, registryCoverageComplete: true } }) };
    const backend = createFindCheapBackend({ catalog: { shopify, woocommerce, awin: createUnavailableAwinPort() },
      product: { affiliateLinks: createAffiliateLinkResolver() }, deals: createUnavailableDealPort(), watches: createMemoryWatchStore(), verifiedDeals: false });
    const replay = await connectReplay(shopify.search, { backend });
    try {
      const response = await replay.client.callTool({ name: "search_products", arguments: { query: "coffee capsules", productType: "coffee capsules",
        ...(fixture.unknownRequest === true ? {} : { requiredFeatures: ["Compatible with Nespresso Original"] }), contextMode: "NEW_PRODUCT", limit: 3, maxItemPriceCents: 1500 } });
      expect(response.isError).not.toBe(true);
      const snapshot = response.structuredContent as ProductCardContent;
      expect(snapshot.products).toHaveLength(fixture.expectedCards);
      expect(snapshot.recommendation?.primarySelectionId !== undefined).toBe(fixture.primary);
      if (fixture.primary) expect(snapshot.recommendation?.state).toBe("READY");
      if (fixture.unknownRequest) expect(snapshot.recommendation?.question).toBeDefined();
    } finally { await replay.close(); }
  });
});
