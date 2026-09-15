import { describe, expect, it } from "vitest";

import type { AwinProduct, AwinProductPort } from "../../../packages/awin-feed/src/index.js";
import { WooProductSchema, WooSearchResultSchema } from "../../../packages/contracts/src/woocommerce.js";
import { createAffiliateLinkResolver } from "../src/affiliate-links.js";
import { createFindCheapBackend } from "../src/backend.js";
import { createUnavailableDealPort } from "../src/deal-client.js";
import { evaluateRecoveredProducts, SearchProductsInputSchema } from "../src/search-products.js";
import type { ProductCardContent } from "../src/server.js";
import { createMemoryWatchStore } from "../src/watch-store.js";
import { connectReplay, product, REPLAY_NOW, searchResult } from "./fixtures/conversation-replay-support.js";

function awinProduct(quantity: string): AwinProduct {
  return {
    merchantId: "50707",
    merchant: "Ishow Hair",
    merchantProductId: `awin-${quantity.replace(/\D/gu, "")}`,
    title: `Daily Toner Pads ${quantity}`,
    category: "toner pads",
    requirementEvidence: "Also available in a 70 pads value jar.",
    matchStatus: "DISCOVERY_MATCH",
    matchEvidence: ["synthetic category fixture"],
    condition: "UNKNOWN",
    itemPrice: { amountCents: 2_000, currency: "USD" },
    availability: "IN_STOCK",
    merchantUrl: `https://ishowbeauty.com/products/pads-${quantity.replace(/\D/gu, "")}`,
    affiliateUrl: "https://www.awin1.com/pclick.php?p=1&a=3047955&m=50707",
    checkedAt: REPLAY_NOW.toISOString(),
  };
}

function wooProduct(quantity: string) {
  return WooProductSchema.parse({
    sourceKind: "WOOCOMMERCE_STORE_API",
    merchantId: "woo-pads",
    merchantName: "Woo Pads Fixture",
    sourceHost: "www.shoprootscience.com",
    productId: Number(quantity.replace(/\D/gu, "")) + 100,
    title: "Daily Toner Pads",
    description: "Also available in a 70 pads value jar.",
    productType: "simple",
    category: "toner pads",
    condition: "NEW",
    attributes: [],
    variantDimensions: { Quantity: [quantity, "70 pads"] },
    selectedAttributes: { Quantity: quantity },
    merchantUrl: `https://www.shoprootscience.com/shop/pads-${quantity.replace(/\D/gu, "")}`,
    images: [],
    itemPrice: { amountCents: 2_100, currency: "USD" },
    priceEvidence: { amountMinor: "2100", currency: "USD", currencyMinorUnit: 2, scope: "PRODUCT", taxBasis: "UNKNOWN" },
    availability: "IN_STOCK",
    availabilityScope: "PRODUCT",
    checkedAt: REPLAY_NOW.toISOString(),
  });
}

async function publicSearch(quantity: string) {
  const awin = awinProduct(quantity);
  const woo = wooProduct(quantity);
  const shopify = { search: async () => searchResult([product({
    merchantId: "shopify-pads",
    merchant: "Shopify Pads Fixture",
    sourceHost: "www.bestbuy.com",
    handle: `shopify-${quantity.replace(/\D/gu, "")}`,
    title: "Daily Toner Pads",
    productType: "toner pads",
    description: "Also available in a 70 pads value jar.",
    variantDimensions: { Quantity: quantity },
    merchantUrl: `https://www.bestbuy.com/site/pads-${quantity.replace(/\D/gu, "")}/123.p`,
  })]) };
  const awinPort: AwinProductPort = { search: async () => ({
      source: "AWIN_PRODUCT_FEED",
      coverage: "COMPLETE",
      snapshotAt: REPLAY_NOW.toISOString(),
      products: [awin],
      diagnostics: { feedRows: 1, validRows: 1, rejectedRows: 0, queryMatches: 1, priceProductsExcluded: 0 },
    }) };
  const wooPort = { search: async () => WooSearchResultSchema.parse({
      source: "WOOCOMMERCE_STORE_API",
      schemaVersion: 1,
      registryVersion: "fixture-v1",
      requestId: `pads-${quantity}`,
      status: "COMPLETE",
      snapshotAt: REPLAY_NOW.toISOString(),
      products: [woo],
      stores: [{ merchantId: "woo-pads", status: "COMPLETE", requests: 1, returned: 1 }],
      diagnostics: {
        eligibleStores: 1,
        plannedStores: 1,
        attemptedStores: 1,
        succeededStores: 1,
        failedStores: 0,
        skippedStores: 0,
        physicalRequests: 1,
        responseBytes: 1_000,
        cacheHits: 0,
        elapsedMs: 1,
        truncated: false,
        registryCoverageComplete: true,
      },
    }) };
  const backend = createFindCheapBackend({
    catalog: { awin: awinPort, shopify, woocommerce: wooPort },
    product: { affiliateLinks: createAffiliateLinkResolver() },
    deals: createUnavailableDealPort(),
    verifiedDeals: false,
    watches: createMemoryWatchStore(),
  });
  const replay = await connectReplay(shopify.search, { backend });
  try {
    return (await replay.client.callTool({
      name: "search_products",
      arguments: { query: "toner pads", productType: "toner pads", requiredFeatures: ["70 pads"], limit: 3 },
    })).structuredContent as ProductCardContent;
  } finally {
    await replay.close();
  }
}

describe("public source requirement parity", () => {
  it("rejects the same wrong selected quantity from Shopify, Awin and Woo", async () => {
    const snapshot = await publicSearch("8 pads");
    expect(snapshot.sources).toMatchObject({ awin: "COMPLETE", shopify: "COMPLETE", woocommerce: "COMPLETE" });
    expect(snapshot.products).toEqual([]);
    expect(snapshot.recommendation?.state).not.toBe("READY");
  });

  it("keeps correctly bound quantities eligible across all three sources", async () => {
    const snapshot = await publicSearch("70 pads");
    expect(snapshot.products).toHaveLength(3);
    expect(snapshot.products.every((item) => item.requirementAssessment?.status === "SATISFIED")).toBe(true);
    expect(snapshot.recommendation?.state).toBe("READY");
  });

  it("does not let web recovery reintroduce an offer rejected by the shared requirement", () => {
    const request = SearchProductsInputSchema.parse({
      query: "toner pads",
      productType: "toner pads",
      requiredFeatures: ["70 pads"],
    });
    const recovered = evaluateRecoveredProducts(request, [product({
      sourceKind: "WEB_PRODUCT_PAGE",
      title: "Daily Toner Pads 8 pads",
      productType: "toner pads",
      description: "Also available in a 70 pads value jar.",
      variantDimensions: { Quantity: "8 pads" },
    })], false);
    expect(recovered.candidates).toEqual([]);
    expect(recovered.featureProductsExcluded).toBe(1);
  });

  it("re-evaluates a changed selected variant before comparison or recommendation", async () => {
    const selected = product({
      handle: "7070",
      title: "Daily Toner Pads",
      productType: "toner pads",
      description: "Also available in an 8 pads travel pack.",
      variantDimensions: { Quantity: "70 pads" },
      checkoutPlatform: "SHOPIFY",
    });
    const changed = { ...selected, handle: "8008", description: "Also available in a 70 pads value jar.",
      variantDimensions: { Quantity: "8 pads" } };
    const peer = product({
      merchantId: "pads-peer",
      handle: "7171",
      title: "Daily Toner Pads Value Jar",
      productType: "toner pads",
      variantDimensions: { Quantity: "70 pads" },
      merchantUrl: "https://ishowbeauty.com/products/pads-peer?variant=7171",
    });
    const replay = await connectReplay(async () => searchResult([selected, peer]), {
      selectedProducts: { inspect: async () => ({
        productTitle: selected.title,
        canonicalProductUrl: selected.merchantUrl,
        variants: [changed],
      }) },
    });
    try {
      const initialResponse = await replay.client.callTool({
        name: "search_products",
        arguments: { query: "toner pads", productType: "toner pads", requiredFeatures: ["70 pads"] },
      });
      expect(initialResponse.isError, JSON.stringify(initialResponse.content)).not.toBe(true);
      const initial = initialResponse.structuredContent as ProductCardContent;
      expect(initial.recommendation?.state).toBe("READY");
      const selectedCard = initial.products.find((item) => item.handle === selected.handle)!;
      const inspected = await replay.client.callTool({
        name: "inspect_selected_shopify_product",
        arguments: { renderId: initial.renderId, selectionId: selectedCard.selectionId,
          variantDimensions: { Quantity: "8 pads" } },
      });
      expect(inspected.isError).not.toBe(true);
      const updated = (inspected.structuredContent as { updatedSnapshot: ProductCardContent }).updatedSnapshot;
      expect(updated.products).toHaveLength(2);
      expect(updated.products.find((item) => item.handle === changed.handle)).toMatchObject({
        presentationGroup: "RESEARCH_ONLY",
        requirementAssessment: { status: "CONFLICT", entries: [{ status: "CONTRADICTED", source: "VARIANT" }] },
      });
      expect(updated.recommendation?.primarySelectionId).toBe(
        updated.products.find((item) => item.handle === peer.handle)?.selectionId,
      );
      const compared = await replay.client.callTool({
        name: "compare_selected_products",
        arguments: { renderId: updated.renderId, selectionIds: updated.products.map((item) => item.selectionId) },
      });
      const comparison = compared.structuredContent as { status: string; entries: Array<{ requirementAssessment?: { status: string } }> };
      expect(comparison.status).toBe("OK");
      expect(comparison.entries.map((item) => item.requirementAssessment?.status).sort()).toEqual(["CONFLICT", "SATISFIED"]);
    } finally {
      await replay.close();
    }
  });
});
