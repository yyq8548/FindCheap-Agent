import { describe, expect, it, vi } from "vitest";

import { createAwinShopifyQuoteResolver } from "../src/awin-shopify-quote.js";
import type { ShopifyCartQuoteError } from "../src/shopify-cart-quote.js";

const seed = {
  merchantId: "20282",
  merchant: "Amazonliss (US)",
  merchantProductId: "141003",
  title: "B24 Molecular Peptides – pH maintenace shampoo 5.07 Fl Oz",
  sourceHost: "www.nutreecosmetics.com",
  merchantUrl: "https://www.nutreecosmetics.com/products/b24-molecular-peptides-ph-maintenace-shampoo-5-07-fl-oz",
  itemPrice: { amountCents: 1_599, currency: "USD" as const },
  availability: "IN_STOCK" as const,
  checkedAt: "2026-08-21T23:32:40.000Z"
};

describe("Awin Shopify quote resolver", () => {
  it("binds the stable Awin product path to one Shopify variant across an approved redirect", async () => {
    const fetchProduct = vi.fn(async () => ({
      response: new Response(JSON.stringify({
        title: seed.title,
        handle: "b24-molecular-peptides-ph-maintenace-shampoo-5-07-fl-oz",
        options: [{ name: "Title", position: 1, values: ["Default Title"] }],
        variants: [{ id: 44_128_515_064_053, title: "Default Title", available: true, price: 1_599, sku: null }]
      }), { status: 200 }),
      finalUrl: "https://bondoxhair.com/products/b24-molecular-peptides-ph-maintenace-shampoo-5-07-fl-oz.js"
    }));
    const resolver = createAwinShopifyQuoteResolver({
      fetchProduct,
      clock: { now: () => new Date("2026-08-24T23:45:00.000Z") }
    });

    await expect(resolver.resolve(seed)).resolves.toMatchObject({
      handle: "44128515064053",
      sourceHost: "bondoxhair.com",
      merchantUrl: "https://bondoxhair.com/products/b24-molecular-peptides-ph-maintenace-shampoo-5-07-fl-oz?variant=44128515064053",
      itemPrice: { amountCents: 1_599, currency: "USD" },
      availability: "IN_STOCK"
    });
    expect(fetchProduct).toHaveBeenCalledWith(
      "https://www.nutreecosmetics.com/products/b24-molecular-peptides-ph-maintenace-shampoo-5-07-fl-oz.js",
      expect.arrayContaining(["www.nutreecosmetics.com", "bondoxhair.com"])
    );
  });

  it("fails closed when multiple variants cannot be bound to the selected feed item", async () => {
    const resolver = createAwinShopifyQuoteResolver({
      fetchProduct: async () => ({
        response: new Response(JSON.stringify({
          title: seed.title,
          handle: "b24-molecular-peptides-ph-maintenace-shampoo-5-07-fl-oz",
          variants: [
            { id: 1, title: "Small", available: true, price: 1_499 },
            { id: 2, title: "Large", available: true, price: 1_699 }
          ]
        }), { status: 200 }),
        finalUrl: "https://bondoxhair.com/products/b24-molecular-peptides-ph-maintenace-shampoo-5-07-fl-oz.js"
      })
    });

    await expect(resolver.resolve(seed)).rejects.toMatchObject({
      code: "VARIANT_REJECTED"
    } satisfies Partial<ShopifyCartQuoteError>);
  });
});
