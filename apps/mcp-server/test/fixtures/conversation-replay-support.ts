import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, vi } from "vitest";
import { createShoppingServer, type ShoppingServerDependencies, type ShopifyPort } from "../../src/server.js";
import type { ShopifyProduct, ShopifySearchResult } from "../../src/shopify-client.js";

export const REPLAY_NOW = new Date("2026-09-04T19:51:00.000Z");

// Synthetic provider evidence. These are not current merchant prices or a visual ground truth.
export function product(overrides: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    merchantId: "ishow", merchant: "Ishow Hair", sourceHost: "ishowbeauty.com",
    merchantTrust: { level: "ESTABLISHED_RETAILER", verification: "INDEPENDENT", evidence: ["synthetic reviewed merchant"] },
    recommendationTier: "TRUSTED_OR_AFFILIATE", handle: "fixture-short-wig", title: "Short human hair wig",
    productType: "wig", brand: "Ishow", gtins: [], variantDimensions: {}, matchStatus: "DISCOVERY_MATCH",
    matchEvidence: ["same product family"], condition: "NEW", itemPrice: { amountCents: 3_641, currency: "USD" },
    availability: "IN_STOCK", merchantUrl: "https://ishowbeauty.com/products/fixture-short-wig",
    checkedAt: REPLAY_NOW.toISOString(), checkoutPlatform: "MERCHANT", ...overrides
  };
}

export function searchResult(products: ShopifyProduct[]): ShopifySearchResult {
  return {
    source: "SHOPIFY_GLOBAL_CATALOG", coverage: "COMPLETE", merchantsQueried: 2, merchantsSucceeded: 2,
    comparison: { status: "DISCOVERY_ONLY", evidence: ["synthetic discovery evidence"], merchantCount: 2, offerCount: products.length },
    questions: [], products,
    diagnostics: {
      apiDurationMs: 1, cacheStatus: "MISS", chromeFallbackEligible: false, queryAttempts: 1, fallbackQueryUsed: false,
      catalogProductsReturned: products.length, catalogVariantsReturned: products.length,
      catalogZeroResultAttempts: products.length === 0 ? 1 : 0,
      outOfStockProductsExcluded: 0, identityProductsExcluded: 0, irrelevantProductsExcluded: 0,
      conditionProductsExcluded: 0, priceProductsExcluded: 0, trustedMerchantProductsReturned: products.length,
      unverifiedMerchantProductsReturned: 0, unverifiedMerchantProductsExcluded: 0, riskyMerchantProductsExcluded: 0,
      merchantTrustRegistryVersion: "fixture", merchantsFailed: 0, coveragePercent: 100,
      failedMerchantIds: [], timedOutMerchantIds: [], registryVersion: "fixture", searchTimeoutMs: 3_000,
      selectionPolicy: "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE"
    }
  };
}

export async function connectReplay(search: ShopifyPort["search"], dependencies: ShoppingServerDependencies = {}) {
  const network = vi.fn(async () => { throw new Error("NETWORK_FORBIDDEN_IN_CONVERSATION_REPLAY"); });
  vi.stubGlobal("fetch", network);
  const server = createShoppingServer({ search }, undefined, {
    now: () => REPLAY_NOW,
    visualCandidateImages: { load: async () => ({ data: Buffer.from("synthetic-image-not-model-input").toString("base64"), mimeType: "image/jpeg" }) },
    ...dependencies
  });
  const client = new Client({ name: "conversation-01a06df9-replay", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client, network,
    close: async () => {
      try { await client.close(); await server.close(); expect(network).not.toHaveBeenCalled(); }
      finally { vi.unstubAllGlobals(); }
    }
  };
}
