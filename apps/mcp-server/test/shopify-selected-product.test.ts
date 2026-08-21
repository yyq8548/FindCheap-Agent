import { describe, expect, it, vi } from "vitest";

import {
  createShopifySelectedProductInspector,
  type ProductJsonFetch
} from "../src/shopify-selected-product.js";
import type { ShopifyProduct } from "../src/shopify-client.js";

const selected: ShopifyProduct = {
  merchantId: "shopify-11236098",
  merchant: "DÔEN",
  sourceHost: "www.shopdoen.com",
  merchantTrust: {
    level: "OFFICIAL",
    verification: "INDEPENDENT",
    evidence: ["independently reviewed official domain"]
  },
  handle: "42677111750769",
  title: "Nevita Dress — Noir La Maddalena Gingham",
  brand: "DÔEN",
  gtins: [],
  variantDimensions: { Size: "XXS" },
  matchStatus: "DISCOVERY_MATCH",
  matchEvidence: ["matched query terms"],
  condition: "UNKNOWN",
  itemPrice: { amountCents: 24_800, currency: "USD" },
  availability: "IN_STOCK",
  merchantUrl: "https://www.shopdoen.com/products/nevita-dress-noir-la-maddalena-gingham?variant=42677111750769&_gsid=abc",
  checkedAt: "2026-08-21T00:00:00.000Z"
};

const productJson = {
  id: 123,
  title: "Nevita Dress — Noir La Maddalena Gingham",
  handle: "nevita-dress-noir-la-maddalena-gingham",
  vendor: "DÔEN",
  options: [
    { name: "Product Color", position: 1, values: ["NOIR LA MADDALENA GINGHAM"] },
    { name: "Size", position: 2, values: ["XXS", "S"] }
  ],
  variants: [
    {
      id: 42677111750769,
      title: "XXS",
      available: true,
      price: 24_800,
      sku: "NEVITA-XXS",
      options: ["NOIR LA MADDALENA GINGHAM", "XXS"]
    },
    {
      id: 42677111816305,
      title: "S",
      available: true,
      price: 24_800,
      sku: "NEVITA-S",
      options: ["NOIR LA MADDALENA GINGHAM", "S"]
    }
  ]
};

describe("selected Shopify product inspection", () => {
  it("uses the exact prior product path and returns only the requested sibling variant", async () => {
    const fetchProduct = vi.fn<ProductJsonFetch>(async () => ({
      response: new Response(JSON.stringify(productJson), {
        status: 200,
        headers: { "content-type": "application/json" }
      }),
      finalUrl: "https://www.shopdoen.com/products/nevita-dress-noir-la-maddalena-gingham.js"
    }));
    const inspector = createShopifySelectedProductInspector({
      fetchProduct,
      clock: { now: () => new Date("2026-08-21T00:05:00.000Z") }
    });

    const result = await inspector.inspect(selected, { Size: "S" });

    expect(fetchProduct).toHaveBeenCalledWith(
      "https://www.shopdoen.com/products/nevita-dress-noir-la-maddalena-gingham.js",
      "www.shopdoen.com"
    );
    expect(result).toEqual({
      productTitle: "Nevita Dress — Noir La Maddalena Gingham",
      canonicalProductUrl: "https://www.shopdoen.com/products/nevita-dress-noir-la-maddalena-gingham",
      variants: [expect.objectContaining({
        handle: "42677111816305",
        sku: "NEVITA-S",
        variantDimensions: {
          "Product Color": "NOIR LA MADDALENA GINGHAM",
          Size: "S"
        },
        availability: "IN_STOCK",
        itemPrice: { amountCents: 24_800, currency: "USD" },
        merchantUrl: "https://www.shopdoen.com/products/nevita-dress-noir-la-maddalena-gingham?variant=42677111816305",
        checkedAt: "2026-08-21T00:05:00.000Z"
      })]
    });
  });

  it("fails closed when the exact source variant is absent from the product document", async () => {
    const fetchProduct: ProductJsonFetch = async () => ({
      response: new Response(JSON.stringify({ ...productJson, variants: productJson.variants.slice(1) })),
      finalUrl: "https://www.shopdoen.com/products/nevita-dress-noir-la-maddalena-gingham.js"
    });
    const inspector = createShopifySelectedProductInspector({ fetchProduct });

    await expect(inspector.inspect(selected, { Size: "S" }))
      .rejects.toThrow("selected variant identity was not present");
  });

  it("rejects a redirect away from the exact product JSON path", async () => {
    const fetchProduct: ProductJsonFetch = async () => ({
      response: new Response(JSON.stringify(productJson)),
      finalUrl: "https://www.shopdoen.com/products/other-dress.js"
    });
    const inspector = createShopifySelectedProductInspector({ fetchProduct });

    await expect(inspector.inspect(selected, { Size: "S" }))
      .rejects.toThrow("selected product path changed");
  });
});
