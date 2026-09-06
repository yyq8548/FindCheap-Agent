import { describe, expect, it, vi } from "vitest";
import type { lookup } from "node:dns/promises";
import type { request as httpsRequest } from "node:https";
import type { IncomingMessage, RequestOptions } from "node:http";
import { EventEmitter } from "node:events";

import {
  createShopifyCartQuotePort,
  ShopifyCartQuoteError,
  type ShopifyCartRequest
} from "../src/shopify-cart-quote.js";
import type { ShopifyProduct } from "../src/shopify-client.js";
import { issueQuoteAuthorization } from "../src/quote-authorization.js";

const product: ShopifyProduct = {
  merchantId: "shopify-123",
  merchant: "Fixture Shop",
  sourceHost: "shop.example",
  merchantTrust: {
    level: "UNKNOWN",
    verification: "UNVERIFIED",
    evidence: ["no independent merchant trust evidence"]
  },
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
// Controlled offline authority fixture; this is not a real user's approval.
const authorization = (zip = "33433") => issueQuoteAuthorization([product], zip, new AbortController().signal);
const cartLines = () => ({
  nodes: [{ __typename: "CartLine", quantity: 1,
    merchandise: { __typename: "ProductVariant", id: "gid://shopify/ProductVariant/456" },
    sellingPlanAllocation: null, parentRelationship: null }],
  pageInfo: { hasNextPage: false }
});

function createResponse() {
  return {
    data: {
      cartCreate: {
        cart: {
          id: "gid://shopify/Cart/cart-key",
          lines: cartLines(),
          cost: {
            subtotalAmount: money("100.00"),
            totalAmount: money("100.00"),
            totalAmountEstimated: true,
            totalTaxAmount: null,
            totalTaxAmountEstimated: true
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

function updateResponse(tax: { amount: string; estimated: boolean } | null = null) {
  return {
    data: {
      cartSelectedDeliveryOptionsUpdate: {
        cart: {
          id: "gid://shopify/Cart/cart-key",
          lines: cartLines(),
          cost: {
            subtotalAmount: money("100.00"),
            totalAmount: money(tax === null ? "105.00" : "112.25"),
            totalAmountEstimated: true,
            totalTaxAmount: tax === null ? null : money(tax.amount),
            totalTaxAmountEstimated: tax?.estimated ?? true
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
  it("rejects changed merchandise before selecting delivery for the original item", async () => {
    const wrongItem = createResponse();
    wrongItem.data.cartCreate.cart.lines.nodes[0]!.merchandise.id = "gid://shopify/ProductVariant/999";
    const request = vi.fn(async () => request.mock.calls.length === 1 ? wrongItem : updateResponse());
    const port = createShopifyCartQuotePort({ SHOPIFY_CART_QUOTE_MODE: "tokenless" }, { request });

    await expect(port.quote(product, "33433", authorization())).rejects.toMatchObject({ code: "VARIANT_REJECTED" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(["variant=999", "variant=456&variant=456"])("rejects conflicting or ambiguous source variant %s before network", async query => {
    const request = vi.fn(async () => request.mock.calls.length === 1 ? createResponse() : updateResponse());
    const port = createShopifyCartQuotePort({ SHOPIFY_CART_QUOTE_MODE: "tokenless" }, { request });
    await expect(port.quote({ ...product, merchantUrl: `https://shop.example/products/fixture?${query}` },
      "33433", authorization())).rejects.toThrow("variant");
    expect(request).not.toHaveBeenCalled();
  });
  it.each(["expiry", "cancellation"])("does not select delivery after permission %s during cart creation", async kind => {
    const controller = new AbortController();
    let elapsed = 0;
    const permit = issueQuoteAuthorization([product], "33433", controller.signal, () => elapsed);
    const request = vi.fn(async () => {
      if (request.mock.calls.length === 1) {
        if (kind === "expiry") elapsed = 5_000;
        else controller.abort();
        return createResponse();
      }
      return updateResponse();
    });
    const port = createShopifyCartQuotePort({ SHOPIFY_CART_QUOTE_MODE: "tokenless" }, { request });
    await expect(port.quote(product, "33433", permit)).rejects.toMatchObject({ code: "QUOTE_TIMEOUT" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(["2026-10", undefined, "2026-07"])("accepts only the reviewed response API version: %s", async version => {
    let calls = 0;
    const requestImpl = vi.fn((_options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      const response = Object.assign(new EventEmitter(), { statusCode: 200,
        headers: { "content-type": "application/json", ...(version === undefined ? {} : { "x-shopify-api-version": version }) },
        destroy: vi.fn() });
      return Object.assign(new EventEmitter(), { end() {
        const body = ++calls === 1 ? createResponse() : updateResponse();
        queueMicrotask(() => {
          callback(response as unknown as IncomingMessage);
          response.emit("data", Buffer.from(JSON.stringify(body)));
          response.emit("end");
        });
      } });
    });
    const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);
    const port = createShopifyCartQuotePort({ SHOPIFY_CART_QUOTE_MODE: "tokenless" }, {
      resolve: resolve as unknown as typeof lookup, requestImpl: requestImpl as unknown as typeof httpsRequest
    });
    if (version === "2026-07") {
      await expect(port.quote(product, "33433", authorization())).resolves.toMatchObject({
        deliveredPrice: { amountCents: 11_198, currency: "USD" }
      });
      expect(requestImpl).toHaveBeenCalledTimes(2);
    } else {
      await expect(port.quote(product, "33433", authorization())).rejects.toMatchObject({ code: "MERCHANT_CART_UNAVAILABLE" });
      expect(requestImpl).toHaveBeenCalledTimes(1);
    }
  });
  it.each(["extra line", "quantity", "bundle", "selling plan", "parent line", "next page", "changed update"])(
    "rejects %s rather than labeling it as the selected one-unit item", async kind => {
      const created = createResponse();
      const updated = updateResponse();
      const cart = kind === "changed update" ? updated.data.cartSelectedDeliveryOptionsUpdate.cart : created.data.cartCreate.cart;
      const line = cart.lines.nodes[0]! as Record<string, unknown>;
      if (kind === "extra line") cart.lines.nodes.push({ ...cart.lines.nodes[0]! });
      if (kind === "quantity") line.quantity = 2;
      if (kind === "bundle") line.__typename = "ComponentizableCartLine";
      if (kind === "selling plan") line.sellingPlanAllocation = { __typename: "SellingPlanAllocation" };
      if (kind === "parent line") line.parentRelationship = { __typename: "CartLineParentRelationship" };
      if (kind === "next page") cart.lines.pageInfo.hasNextPage = true;
      if (kind === "changed update") cart.lines.nodes[0]!.merchandise.id = "gid://shopify/ProductVariant/999";
      let calls = 0;
      const request = vi.fn(async () => ++calls === 1 ? created : updated);
      const port = createShopifyCartQuotePort({ SHOPIFY_CART_QUOTE_MODE: "tokenless" }, { request });
      await expect(port.quote(product, "33433", authorization())).rejects.toMatchObject({ code: "VARIANT_REJECTED" });
      expect(request).toHaveBeenCalledTimes(kind === "changed update" ? 2 : 1);
    }
  );
  it("queries Shopify tax, selects cheapest shipping, and falls back to a labeled ZIP estimate", async () => {
    const requests: ShopifyCartRequest[] = [];
    const request = vi.fn(async (input: ShopifyCartRequest) => {
      requests.push(input);
      return requests.length === 1 ? createResponse() : updateResponse();
    });
    const port = createShopifyCartQuotePort(
      { SHOPIFY_CART_QUOTE_MODE: "tokenless", SHOPIFY_CART_QUOTE_TIMEOUT_MS: "2500" },
      { request, clock: { now: () => new Date("2026-08-20T12:01:00.000Z") } }
    );

    await expect(port.quote(product, "33433-1234", authorization("33433-1234"))).resolves.toEqual({
      status: "ESTIMATED",
      subtotal: { amountCents: 10_000, currency: "USD" },
      shipping: { amountCents: 500, currency: "USD", label: "Standard" },
      tax: {
        status: "ZIP_ESTIMATED",
        amount: { amountCents: 698, currency: "USD" },
        jurisdiction: "FL",
        rateBasisPoints: 698,
        source: "TAX_FOUNDATION_STATE_AVERAGE_2026"
      },
      deliveredPrice: { amountCents: 11_198, currency: "USD" },
      totalEstimated: true,
      checkedAt: "2026-08-20T12:01:00.000Z",
      expiresAt: "2026-08-20T12:11:00.000Z"
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.query).toContain("totalTaxAmount");
    expect(requests[0]?.query).toContain("totalTaxAmountEstimated");
    expect(requests[0]?.query).toContain("lines(first: 2)");
    expect(requests.every(entry => !/@defer|checkoutUrl|customerAccessToken|sellingPlanId|payment/iu.test(entry.query))).toBe(true);
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

  it("uses an explicitly returned Shopify tax amount instead of estimating from ZIP", async () => {
    let call = 0;
    const port = createShopifyCartQuotePort(
      { SHOPIFY_CART_QUOTE_MODE: "tokenless" },
      { request: async () => ++call === 1 ? createResponse() : updateResponse({ amount: "7.25", estimated: false }) }
    );

    await expect(port.quote(product, "33433", authorization())).resolves.toMatchObject({
      tax: {
        status: "SHOPIFY_REPORTED",
        amount: { amountCents: 725, currency: "USD" },
        shopifyEstimated: false,
        source: "SHOPIFY_CART"
      },
      deliveredPrice: { amountCents: 11_225, currency: "USD" }
    });
  });

  it("ignores additive provider fields while preserving validated Cart totals", async () => {
    let call = 0;
    const withAdditiveFields = (value: ReturnType<typeof createResponse> | ReturnType<typeof updateResponse>) => ({
      ...value,
      extensions: { requestId: "provider-only" },
      data: Object.fromEntries(Object.entries(value.data).map(([key, mutation]) => [key, {
        ...mutation,
        providerMetadata: { region: "US" },
        cart: mutation.cart === null ? null : {
          ...mutation.cart,
          buyerIdentity: { countryCode: "US" },
          cost: {
            ...mutation.cart.cost,
            providerEstimateVersion: 2,
            subtotalAmount: { ...mutation.cart.cost.subtotalAmount, formatted: "$100.00" }
          }
        }
      }]))
    });
    const port = createShopifyCartQuotePort(
      { SHOPIFY_CART_QUOTE_MODE: "tokenless" },
      {
        request: async () => withAdditiveFields(++call === 1 ? createResponse() : updateResponse())
      }
    );

    await expect(port.quote(product, "33433", authorization())).resolves.toMatchObject({
      subtotal: { amountCents: 10_000 },
      shipping: { amountCents: 500 },
      deliveredPrice: { amountCents: 11_198 }
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

  it("fails with FULL_ADDRESS_REQUIRED when ZIP-only delivery options are unavailable", async () => {
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
    await expect(noDelivery.quote(product, "33433", authorization())).rejects.toMatchObject({
      code: "FULL_ADDRESS_REQUIRED"
    });
  });

  it("rejects malformed totals instead of inventing components", async () => {

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
    await expect(invalidTotal.quote(product, "33433", authorization())).rejects.toMatchObject({
      code: "MERCHANT_CART_UNAVAILABLE"
    });

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
    await expect(changedDelivery.quote(product, "33433", authorization())).rejects.toMatchObject({
      code: "NO_DELIVERY_OPTIONS"
    });
  });

  it("classifies safe quote failures without exposing merchant error text", async () => {
    const cases = [
      {
        response: {
          data: {
            cartCreate: {
              cart: null,
              userErrors: [{ field: ["input", "buyerIdentity"], message: "City and street address are required for delivery" }],
              warnings: []
            }
          }
        },
        code: "FULL_ADDRESS_REQUIRED"
      },
      {
        response: {
          data: {
            cartCreate: {
              cart: null,
              userErrors: [{ field: ["input", "lines", "0", "merchandiseId"], message: "Variant is sold out" }],
              warnings: []
            }
          }
        },
        code: "VARIANT_REJECTED"
      },
      {
        response: {
          data: {
            cartCreate: {
              cart: null,
              userErrors: [{ field: null, message: "Internal merchant extension failed: private detail" }],
              warnings: []
            }
          }
        },
        code: "MERCHANT_CART_UNAVAILABLE"
      }
    ] as const;

    for (const testCase of cases) {
      const port = createShopifyCartQuotePort(
        { SHOPIFY_CART_QUOTE_MODE: "tokenless" },
        { request: async () => testCase.response }
      );
      const error = await port.quote(product, "33433", authorization()).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(ShopifyCartQuoteError);
      expect(error).toMatchObject({ code: testCase.code });
      expect(String(error)).not.toContain("private detail");
    }
  });

  it("classifies timeouts and sends ZIP-only delivery preferences", async () => {
    const timeout = createShopifyCartQuotePort(
      { SHOPIFY_CART_QUOTE_MODE: "tokenless" },
      { request: async () => {
        const error = new Error("request aborted");
        error.name = "AbortError";
        throw error;
      } }
    );
    await expect(timeout.quote(product, "33433", authorization())).rejects.toMatchObject({ code: "QUOTE_TIMEOUT" });

    const requests: ShopifyCartRequest[] = [];
    const zipOnly = createShopifyCartQuotePort(
      { SHOPIFY_CART_QUOTE_MODE: "tokenless" },
      { request: async (input) => {
        requests.push(input);
        return requests.length === 1 ? createResponse() : updateResponse();
      } }
    );
    await zipOnly.quote(product, "33433", authorization());
    expect(requests[0]?.variables).toMatchObject({
      input: {
        buyerIdentity: {
          deliveryAddressPreferences: [{
            deliveryAddress: {
              country: "US",
              zip: "33433"
            },
            oneTimeUse: true
          }]
        }
      }
    });
    expect(JSON.stringify(requests[0]?.variables)).not.toContain("address1");
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

    await expect(port.quote(product, "33433", authorization())).rejects.toMatchObject({
      code: "MERCHANT_CART_UNAVAILABLE"
    });
    expect(resolve).toHaveBeenCalledWith("shop.example", { all: true, verbatim: true });
    expect(requestImpl).not.toHaveBeenCalled();
  });
});
