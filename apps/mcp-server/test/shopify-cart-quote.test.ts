import { describe, expect, it, vi } from "vitest";
import type { lookup } from "node:dns/promises";
import type { request as httpsRequest } from "node:https";

import {
  createShopifyCartQuotePort,
  type ShopifyCartRequest
} from "../src/shopify-cart-quote.js";
import type { ShopifyProduct } from "../src/shopify-client.js";

const product: ShopifyProduct = {
  merchantId: "shopify-123",
  merchant: "Fixture Shop",
  sourceHost: "shop.example",
  handle: "456",
  title: "Fixture Product — Blue",
  gtins: [],
  variantDimensions: { Color: "Blue" },
  matchStatus: "EXACT",
  matchEvidence: ["Shopify Universal Product ID exact"],
  condition: "UNKNOWN",
  itemPrice: { amountCents: 10_000, currency: "USD" },
  availability: "IN_STOCK",
  merchantUrl: "https://shop.example/products/fixture?variant=456",
  checkedAt: "2026-08-20T12:00:00.000Z"
};

const money = (amount: string) => ({ amount, currencyCode: "USD" });

function createResponse() {
  return {
    data: {
      cartCreate: {
        cart: {
          id: "gid://shopify/Cart/cart-key",
          cost: {
            subtotalAmount: money("100.00"),
            totalAmount: money("100.00"),
            totalAmountEstimated: true
          },
          deliveryGroups: {
            nodes: [{
              id: "gid://shopify/CartDeliveryGroup/group-1",
              deliveryOptions: [
                { handle: "express", title: "Express", estimatedCost: money("12.00") },
                { handle: "standard", title: "Standard", estimatedCost: money("5.00") }
              ],
              selectedDeliveryOption: null
            }]
          }
        },
        userErrors: [],
        warnings: []
      }
    }
  };
}

function updateResponse() {
  return {
    data: {
      cartSelectedDeliveryOptionsUpdate: {
        cart: {
          id: "gid://shopify/Cart/cart-key",
          cost: {
            subtotalAmount: money("100.00"),
            totalAmount: money("112.25"),
            totalAmountEstimated: true
          },
          deliveryGroups: {
            nodes: [{
              id: "gid://shopify/CartDeliveryGroup/group-1",
              deliveryOptions: [
                { handle: "standard", title: "Standard", estimatedCost: money("5.00") }
              ],
              selectedDeliveryOption: {
                handle: "standard",
                title: "Standard",
                estimatedCost: money("5.00")
              }
            }]
          }
        },
        userErrors: [],
        warnings: []
      }
    }
  };
}

describe("Shopify tokenless Cart quote", () => {
  it("creates one exact-variant cart, selects cheapest shipping, and returns bounded estimate", async () => {
    const requests: ShopifyCartRequest[] = [];
    const request = vi.fn(async (input: ShopifyCartRequest) => {
      requests.push(input);
      return requests.length === 1 ? createResponse() : updateResponse();
    });
    const port = createShopifyCartQuotePort(
      { SHOPIFY_CART_QUOTE_MODE: "tokenless", SHOPIFY_CART_QUOTE_TIMEOUT_MS: "2500" },
      { request, clock: { now: () => new Date("2026-08-20T12:01:00.000Z") } }
    );

    await expect(port.quote(product, "33433-1234")).resolves.toEqual({
      status: "ESTIMATED",
      subtotal: { amountCents: 10_000, currency: "USD" },
      shipping: { amountCents: 500, currency: "USD", label: "Standard" },
      deliveredPrice: { amountCents: 11_225, currency: "USD" },
      totalEstimated: true,
      checkedAt: "2026-08-20T12:01:00.000Z",
      expiresAt: "2026-08-20T12:11:00.000Z"
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      url: "https://shop.example/api/2026-07/graphql.json",
      timeoutMs: 2500,
      variables: {
        input: {
          lines: [{ merchandiseId: "gid://shopify/ProductVariant/456", quantity: 1 }],
          buyerIdentity: {
            countryCode: "US",
            deliveryAddressPreferences: [{
              deliveryAddress: { country: "US", zip: "33433-1234" },
              oneTimeUse: true
            }]
          }
        }
      }
    });
    expect(requests[1]?.variables).toMatchObject({
      cartId: "gid://shopify/Cart/cart-key",
      selectedDeliveryOptions: [{
        deliveryGroupId: "gid://shopify/CartDeliveryGroup/group-1",
        deliveryOptionHandle: "standard"
      }]
    });
  });

  it("fails closed before network for invalid identity, host, ZIP, or disabled mode", async () => {
    const request = vi.fn();
    const enabled = createShopifyCartQuotePort(
      { SHOPIFY_CART_QUOTE_MODE: "tokenless" },
      { request }
    );
    const disabled = createShopifyCartQuotePort({}, { request });

    await expect(enabled.quote({ ...product, handle: "not-numeric" }, "33433"))
      .rejects.toThrow("variant identity");
    await expect(enabled.quote({ ...product, sourceHost: "other.example" }, "33433"))
      .rejects.toThrow("merchant host");
    await expect(enabled.quote(product, "3343"))
      .rejects.toThrow("ZIP");
    await expect(disabled.quote(product, "33433"))
      .rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects incomplete delivery and malformed totals instead of inventing components", async () => {
    const noDelivery = createShopifyCartQuotePort(
      { SHOPIFY_CART_QUOTE_MODE: "tokenless" },
      { request: async () => ({
        ...createResponse(),
        data: {
          cartCreate: {
            ...createResponse().data.cartCreate,
            cart: {
              ...createResponse().data.cartCreate.cart,
              deliveryGroups: { nodes: [] }
            }
          }
        }
      }) }
    );
    await expect(noDelivery.quote(product, "33433")).rejects.toThrow("delivery option");

    let call = 0;
    const invalidTotal = createShopifyCartQuotePort(
      { SHOPIFY_CART_QUOTE_MODE: "tokenless" },
      { request: async () => {
        call += 1;
        if (call === 1) return createResponse();
        const response = updateResponse();
        response.data.cartSelectedDeliveryOptionsUpdate.cart.cost.totalAmount.amount = "NaN";
        return response;
      } }
    );
    await expect(invalidTotal.quote(product, "33433")).rejects.toThrow("response");

    let changedCall = 0;
    const changedDelivery = createShopifyCartQuotePort(
      { SHOPIFY_CART_QUOTE_MODE: "tokenless" },
      { request: async () => {
        changedCall += 1;
        if (changedCall === 1) return createResponse();
        const response = updateResponse();
        response.data.cartSelectedDeliveryOptionsUpdate.cart.deliveryGroups.nodes[0]!.selectedDeliveryOption!.handle = "express";
        return response;
      } }
    );
    await expect(changedDelivery.quote(product, "33433")).rejects.toThrow("selected delivery option changed");
  });

  it("rejects every DNS set containing a private address before sending Cart data", async () => {
    const requestImpl = vi.fn();
    const resolve = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 as const },
      { address: "127.0.0.1", family: 4 as const }
    ]);
    const port = createShopifyCartQuotePort(
      { SHOPIFY_CART_QUOTE_MODE: "tokenless" },
      {
        resolve: resolve as unknown as typeof lookup,
        requestImpl: requestImpl as unknown as typeof httpsRequest
      }
    );

    await expect(port.quote(product, "33433")).rejects.toThrow("DNS is unsafe");
    expect(resolve).toHaveBeenCalledWith("shop.example", { all: true, verbatim: true });
    expect(requestImpl).not.toHaveBeenCalled();
  });
});
