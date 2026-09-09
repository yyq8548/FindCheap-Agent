import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createUnavailableAwinPort } from "../../../packages/awin-feed/src/index.js";
import { WooProductSchema, WooSearchResultSchema } from "../../../packages/contracts/src/woocommerce.js";
import { parseStoredSearchRequest, SearchProductsInputSchema, StoredSearchProductsInputSchema } from "../src/search-products.js";
import { createWooProductAnchor } from "../src/woo-product-identity.js";
import { createTaskStateStore } from "../src/task-state-store.js";
import { createFindCheapBackend } from "../src/backend.js";
import { createAffiliateLinkResolver } from "../src/affiliate-links.js";
import { createUnavailableDealPort } from "../src/deal-client.js";
import { createMemoryWatchStore } from "../src/watch-store.js";
import type { ProductCardContent } from "../src/server.js";
import { connectReplay, searchResult, REPLAY_NOW } from "./fixtures/conversation-replay-support.js";
it('Woo server-owned anchors remain readable through the persisted snapshot request codec', () => {
  const woo = WooProductSchema.parse({ sourceKind: 'WOOCOMMERCE_STORE_API', merchantId: 'anchor-shop', merchantName: 'Anchor Shop',
    sourceHost: 'anchor-shop.example', productId: 1000, productType: 'simple', title: 'Firm', category: 'serum', condition: 'NEW',
    attributes: [], variantDimensions: {}, selectedAttributes: {}, merchantUrl: 'https://anchor-shop.example/product/firm', images: [],
    itemPrice: { amountCents: 4800, currency: 'USD' }, priceEvidence: { amountMinor: '4800', currency: 'USD', currencyMinorUnit: 2,
      scope: 'PRODUCT', taxBasis: 'UNKNOWN' }, availability: 'IN_STOCK', availabilityScope: 'PRODUCT', checkedAt: REPLAY_NOW.toISOString() });
  const request = parseStoredSearchRequest({ query: 'Firm', wooAnchor: createWooProductAnchor(woo) });
  expect(StoredSearchProductsInputSchema.safeParse(request).success).toBe(true);
  expect(SearchProductsInputSchema.safeParse(request).success).toBe(false);
  for (const invalid of [{ extra: true }, { productId: -1 }, { selectedAttributes: { flavor: 5 } }, { variationId: "bad" }]) {
    expect(StoredSearchProductsInputSchema.safeParse({ ...request, wooAnchor: { ...request.wooAnchor, ...invalid } }).success).toBe(false);
  }
});

it('real Woo URL search snapshot can be rendered after server recreation using the same trusted task metadata', async () => {
  const woo = WooProductSchema.parse({ sourceKind: 'WOOCOMMERCE_STORE_API', merchantId: 'anchor-shop', merchantName: 'Anchor Shop',
    sourceHost: 'anchor-shop.example', productId: 1000, productType: 'simple', title: 'Firm', category: 'serum', condition: 'NEW',
    attributes: [], variantDimensions: {}, selectedAttributes: {}, merchantUrl: 'https://anchor-shop.example/product/firm', images: [],
    itemPrice: { amountCents: 4800, currency: 'USD' }, priceEvidence: { amountMinor: '4800', currency: 'USD', currencyMinorUnit: 2,
      scope: 'PRODUCT', taxBasis: 'UNKNOWN' }, availability: 'IN_STOCK', availabilityScope: 'PRODUCT', checkedAt: REPLAY_NOW.toISOString() });
  const wooSearch = vi.fn(async () => WooSearchResultSchema.parse({ source: 'WOOCOMMERCE_STORE_API', schemaVersion: 1,
    registryVersion: 'anchor-fixture', requestId: 'anchor-restart', status: 'COMPLETE', snapshotAt: REPLAY_NOW.toISOString(), products: [woo],
    stores: [{ merchantId: 'anchor-shop', status: 'COMPLETE', requests: 1, returned: 1 }], diagnostics: {
      eligibleStores: 1, plannedStores: 1, attemptedStores: 1, succeededStores: 1, failedStores: 0, skippedStores: 0,
      physicalRequests: 1, responseBytes: 1000, cacheHits: 0, elapsedMs: 1, truncated: false, registryCoverageComplete: true } }));
  const backend = createFindCheapBackend({ catalog: { shopify: { search: async () => searchResult([]) },
    awin: createUnavailableAwinPort(), woocommerce: { search: wooSearch } },
    product: { affiliateLinks: createAffiliateLinkResolver() }, deals: createUnavailableDealPort(), verifiedDeals: false, watches: createMemoryWatchStore() });
  const state = createTaskStateStore(':memory:');
  const threadId = randomUUID();
  const first = await connectReplay(async () => searchResult([]), { backend, taskState: state }, undefined, 'codex-mcp-client');
  let originalCards: ProductCardContent;
  try {
    const response = await first.client.callTool({ name: 'search_products', arguments: { query: woo.merchantUrl }, _meta: { threadId } });
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
    originalCards = response.structuredContent as ProductCardContent;
    expect(originalCards.products).toHaveLength(1);
  } finally { await first.close(); }
  const saved = state.load(threadId);
  const snapshots = saved.data.renderSnapshots as Array<[string, { request: Record<string, unknown> }]>;
  expect(snapshots[0]![1].request).toHaveProperty('wooAnchor');
  const second = await connectReplay(async () => searchResult([]), { backend, taskState: state }, undefined, 'codex-mcp-client');
  try {
    const restored = await second.client.callTool({ name: 'render_product_cards', arguments: { renderId: originalCards!.renderId }, _meta: { threadId } });
    expect(restored.isError, JSON.stringify(restored.content)).not.toBe(true);
    expect((restored.structuredContent as ProductCardContent).products).toEqual(originalCards!.products);
    const foreign = await second.client.callTool({ name: "render_product_cards", arguments: { renderId: originalCards!.renderId }, _meta: { threadId: randomUUID() } });
    expect(foreign.isError).toBe(true);
  } finally { await second.close(); state.close(); }
});
