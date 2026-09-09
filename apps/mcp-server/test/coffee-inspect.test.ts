import { describe, expect, it, vi } from "vitest";
import type { ProductCardContent } from "../src/server.js";
import { createShopifySelectedProductInspector, type ProductJsonFetch } from "../src/shopify-selected-product.js";
import { connectReplay, product, REPLAY_NOW, searchResult } from "./fixtures/conversation-replay-support.js";

// Synthetic merchant/variants test the registered MCP and real JSON inspector.
// These are not live merchant facts, prices, shipping evidence or host approval.
const canonicalUrl = "https://coffee-fixture.example/products/whole-bean-coffee";
const selected = product({ merchantId: "coffee-fixture", merchant: "Synthetic Coffee", sourceHost: "coffee-fixture.example",
  handle: "1001", title: "Whole Bean Coffee", productType: "coffee", brand: "Synthetic Coffee",
  variantDimensions: { Grind: "Select a grind" }, itemPrice: { amountCents: 250, currency: "USD" },
  merchantUrl: `${canonicalUrl}?variant=1001` });
const productJson = { currency: "USD", title: "Whole Bean Coffee", handle: "whole-bean-coffee", vendor: "Synthetic Coffee",
  description: "Synthetic parent has whole bean and ground options; only the selected Grind identifies the offer.",
  options: [{ name: "Grind", position: 1, values: ["Select a grind", "Whole Bean", "Ground"] }],
  variants: [
    { id: 1001, title: "Select a grind", available: true, price: 250, options: ["Select a grind"] },
    { id: 1002, title: "Whole Bean", available: true, price: 275, options: ["Whole Bean"] },
    { id: 1003, title: "Ground", available: true, price: 300, options: ["Ground"] }
  ] };

describe.each(["Grind", "Coffee product form", "Ground or whole bean"])("coffee form eligibility after registered Shopify inspection: %s", dimension => {
  it.each(["UNKNOWN", "WHOLE_BEAN", "GROUND"] as const)("keeps the %s form verdict through the derived snapshot", async form => {
    const source = vi.fn(async () => searchResult([{ ...structuredClone(selected), variantDimensions: { [dimension]: "Select a grind" } }]));
    const fetchProduct = vi.fn<ProductJsonFetch>(async (url, allowedHost) => {
      expect(url).toBe(`${canonicalUrl}.js`);
      expect(allowedHost).toBe("coffee-fixture.example");
      return { finalUrl: url, response: Response.json({ ...productJson, options: productJson.options.map(option => ({ ...option, name: dimension })) }) };
    });
    const inspector = createShopifySelectedProductInspector({ fetchProduct, clock: { now: () => REPLAY_NOW } });
    const replay = await connectReplay(source, { selectedProducts: inspector });
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: {
        query: "whole bean coffee", productType: "whole bean coffee", maxItemPriceCents: 500, limit: 1,
        contextMode: "NEW_PRODUCT", responseLocale: "en-US" } });
      expect(first.isError, JSON.stringify(first.content)).not.toBe(true);
      const initial = first.structuredContent as ProductCardContent;
      expect(initial.products).toHaveLength(1);
      expect(initial.products[0]).toMatchObject({ handle: "1001", requestIdentityStatus: "NEEDS_VERIFICATION" });
      expect(initial.recommendation?.primarySelectionId).toBeUndefined();
      source.mockClear();

      const inspected = await replay.client.callTool({ name: "inspect_selected_product", arguments: {
        renderId: initial.renderId, selectionId: initial.products[0]!.selectionId,
        ...(form === "UNKNOWN" ? {} : { variantDimensions: { [dimension]: form === "WHOLE_BEAN" ? "Whole Bean" : "Ground" } }) } });
      expect(inspected.isError, JSON.stringify(inspected.content)).not.toBe(true);
      expect(fetchProduct).toHaveBeenCalledTimes(1);
      expect(source).not.toHaveBeenCalled();
      const result = inspected.structuredContent as { status: string; variants: unknown[]; updatedSnapshot?: ProductCardContent };
      if (form === "GROUND") {
        expect(result.status).toBe("NO_MATCHING_VARIANT");
        expect(result.variants).toEqual([]);
        expect(result.updatedSnapshot).toBeUndefined();
      } else {
        expect(result.status).toBe("OK");
        const next = result.updatedSnapshot!;
        expect(next.products).toHaveLength(1);
        expect(next.requirementsSummary).toMatchObject({ productType: "whole bean coffee", maxItemPriceCents: 500 });
        if (form === "UNKNOWN") {
          expect(next.products[0]).toMatchObject({ handle: "1001", requestIdentityStatus: "NEEDS_VERIFICATION",
            itemPrice: { amountCents: 250, currency: "USD" } });
          expect(next.recommendation?.state).not.toBe("READY");
          expect(next.recommendation?.primarySelectionId).toBeUndefined();
        } else {
          expect(next.products[0]).toMatchObject({ handle: "1002", requestIdentityStatus: "CONFIRMED",
            variantDimensions: { [dimension]: "Whole Bean" }, itemPrice: { amountCents: 275, currency: "USD" } });
          expect(next.recommendation).toMatchObject({ state: "READY", primarySelectionId: next.products[0]!.selectionId });
        }
      }
      const original = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: initial.renderId } });
      expect((original.structuredContent as ProductCardContent).products).toEqual(initial.products);
    } finally { await replay.close(); }
  });
});
