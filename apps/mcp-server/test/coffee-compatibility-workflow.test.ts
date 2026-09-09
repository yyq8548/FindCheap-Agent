import { describe, expect, it, vi } from "vitest";
import type { ProductCardContent } from "../src/server.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

// Explicitly synthetic merchant/variant observations test the registered MCP
// contract. They are not live product, delivery or native-host evidence.
const canonicalUrl = "https://coffee-fixture.example/products/coffee-capsules";
const capsules = [
  { id: "1001", system: "Nespresso Original", price: 1199 },
  { id: "1002", system: "Nespresso Vertuo", price: 1299 }
].map(({ id, system, price }) => product({ merchantId: "coffee-fixture", merchant: "Synthetic Coffee",
  sourceHost: "coffee-fixture.example", title: "Coffee Capsules", productType: "coffee", brand: "Synthetic Coffee",
  handle: id, variantDimensions: { "Capsule System": system }, itemPrice: { amountCents: price, currency: "USD" },
  merchantUrl: `${canonicalUrl}?variant=${id}` }));

describe("capsule compatibility through registered MCP continuation", () => {
  it("shows capsules while the system is unknown, then selects only the verified requested system", async () => {
    const source = vi.fn(async () => searchResult(structuredClone(capsules)));
    const replay = await connectReplay(source);
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: {
        query: "coffee capsules", productType: "coffee capsules", contextMode: "NEW_PRODUCT", maxItemPriceCents: 1500,
        responseLocale: "zh-CN", limit: 3, selectionMode: "MERCHANT_DIVERSE" } });
      expect(first.isError, JSON.stringify(first.content)).not.toBe(true);
      const initial = first.structuredContent as ProductCardContent;
      expect(initial.products).toHaveLength(2);
      expect(initial.products.every(card => card.presentationGroup === "TRUSTED_MATCH")).toBe(true);
      expect(initial.products.every(card => card.requestIdentityStatus !== "NEEDS_VERIFICATION")).toBe(true);
      expect(initial.recommendation).toMatchObject({ state: "MATCHES_AVAILABLE", question: expect.stringContaining("完整型号") });
      expect(initial.recommendation?.primarySelectionId).toBeUndefined();

      const next = await replay.client.callTool({ name: "search_products", arguments: {
        query: "coffee capsules", productType: "coffee capsules", contextMode: "CONTINUE_PREVIOUS_PRODUCT",
        parentRenderId: initial.renderId, requiredFeatures: ["Compatible with Nespresso Original"], responseLocale: "zh-CN", limit: 3 } });
      expect(next.isError, JSON.stringify(next.content)).not.toBe(true);
      const narrowed = next.structuredContent as ProductCardContent;
      expect(narrowed.goalId).toBe(initial.goalId);
      expect(narrowed.requirementsSummary).toMatchObject({ productType: "coffee capsules", maxItemPriceCents: 1500,
        requiredFeatures: ["Compatible with Nespresso Original"] });
      expect(narrowed.products).toHaveLength(1);
      expect(narrowed.products[0]).toMatchObject({ handle: "1001", variantDimensions: { "Capsule System": "Nespresso Original" },
        itemPrice: { amountCents: 1199, currency: "USD" } });
      expect(narrowed.recommendation).toMatchObject({ state: "READY", primarySelectionId: narrowed.products[0]!.selectionId });
      expect(narrowed.products[0]?.requiredFeatureLimitations).toEqual([]);
      const original = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: initial.renderId } });
      expect((original.structuredContent as ProductCardContent).products).toEqual(initial.products);
    } finally { await replay.close(); }
  });
});
