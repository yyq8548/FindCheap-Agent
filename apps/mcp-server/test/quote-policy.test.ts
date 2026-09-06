import type { lookup } from "node:dns/promises";
import type { request as httpsRequest } from "node:https";
import type { IncomingMessage, RequestOptions } from "node:http";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createPinnedShopifyCartRequest, createShopifyCartQuotePort, ShopifyCartQuoteError } from "../src/shopify-cart-quote.js";
import { issueQuoteAuthorization, type QuoteAuthorization } from "../src/quote-authorization.js";

const selected = {
  merchantId: "fixture-merchant", sourceHost: "shop.example", handle: "456",
  title: "Fixture Product", merchantUrl: "https://shop.example/products/fixture?variant=456"
};

describe("production Cart quote policy", () => {
  it("rejects a tokenless quote without current authorization before DNS or HTTP", async () => {
    const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);
    const requestImpl = vi.fn(() => {
      throw new Error("NETWORK_FORBIDDEN_IN_QUOTE_POLICY_TEST");
    });
    const port = createShopifyCartQuotePort({ SHOPIFY_CART_QUOTE_MODE: "tokenless" }, {
      resolve: resolve as unknown as typeof lookup,
      requestImpl: requestImpl as unknown as typeof httpsRequest
    });

    const outcome = await port.quote({
      merchantId: "fixture-merchant",
      sourceHost: "shop.example",
      handle: "456",
      title: "Fixture Product",
      merchantUrl: "https://shop.example/products/fixture?variant=456"
    }, "33433").then(
      () => "QUOTE_RETURNED",
      (error: unknown) => error instanceof ShopifyCartQuoteError ? error.code : String(error)
    );

    expect({ outcome, dnsCalls: resolve.mock.calls.length, httpCalls: requestImpl.mock.calls.length }).toEqual({
      outcome: "QUOTE_POLICY_UNVERIFIED",
      dnsCalls: 0,
      httpCalls: 0
    });
  });

  it.each(["forged", "serialized", "expired", "cancelled", "foreign merchant", "foreign ZIP", "review expired"])(
    "rejects %s authority before a Cart request", async (kind) => {
      const request = vi.fn(async () => { throw new Error("NETWORK_FORBIDDEN_IN_QUOTE_POLICY_TEST"); });
      const controller = new AbortController();
      let elapsed = 0;
      let authorization = issueQuoteAuthorization([selected], "33433", controller.signal, () => elapsed);
      if (kind === "forged") authorization = { approved: true } as unknown as QuoteAuthorization;
      if (kind === "serialized") authorization = JSON.parse(JSON.stringify(authorization)) as QuoteAuthorization;
      if (kind === "expired") elapsed = 5_000;
      if (kind === "cancelled") controller.abort();
      const port = createShopifyCartQuotePort({ SHOPIFY_CART_QUOTE_MODE: "tokenless" }, {
        request,
        clock: { now: () => new Date(kind === "review expired" ? "2027-07-01T00:00:00.000Z" : "2026-09-06T12:00:00.000Z") }
      });
      await expect(port.quote(
        kind === "foreign merchant" ? { ...selected, merchantId: "different-merchant" } : selected,
        kind === "foreign ZIP" ? "10001" : "33433", authorization
      )).rejects.toMatchObject({ code: "QUOTE_POLICY_UNVERIFIED" });
      expect(request).not.toHaveBeenCalled();
    }
  );

  it("consumes each authorized batch target once, including a failed first Cart", async () => {
    const second = { ...selected, merchantId: "second-merchant", handle: "457", merchantUrl: "https://shop.example/products/second?variant=457" };
    const request = vi.fn(async () => { throw new Error("fixture merchant unavailable"); });
    const port = createShopifyCartQuotePort({ SHOPIFY_CART_QUOTE_MODE: "tokenless" }, { request });
    const authorization = issueQuoteAuthorization([selected, second], "33433", new AbortController().signal);
    await expect(port.quote(selected, "33433", authorization)).rejects.toMatchObject({ code: "MERCHANT_CART_UNAVAILABLE" });
    await expect(port.quote(selected, "33433", authorization)).rejects.toMatchObject({ code: "QUOTE_POLICY_UNVERIFIED" });
    await expect(port.quote(second, "33433", authorization)).rejects.toMatchObject({ code: "MERCHANT_CART_UNAVAILABLE" });
    await expect(port.quote(second, "33433", authorization)).rejects.toMatchObject({ code: "QUOTE_POLICY_UNVERIFIED" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not dispatch HTTPS when the caller cancels during pending DNS", async () => {
    const controller = new AbortController();
    let releaseDns!: (value: Array<{ address: string; family: number }>) => void;
    const dns = new Promise<Array<{ address: string; family: number }>>(resolve => { releaseDns = resolve; });
    const resolve = vi.fn(() => dns);
    const requestImpl = vi.fn(() => { throw new Error("NETWORK_FORBIDDEN_IN_QUOTE_POLICY_TEST"); });
    const request = createPinnedShopifyCartRequest({ resolve: resolve as unknown as typeof lookup,
      requestImpl: requestImpl as unknown as typeof httpsRequest });
    const outcome = request({ url: "https://shop.example/api/2026-07/graphql.json", query: "fixture",
      variables: {}, timeoutMs: 500, signal: controller.signal }).catch((error: unknown) => error);
    controller.abort();
    releaseDns([{ address: "93.184.216.34", family: 4 }]);
    expect(await outcome).toBeInstanceOf(Error);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(requestImpl).not.toHaveBeenCalled();
  });

  it("bounds a response body stall and never sends a second mutation", async () => {
    let requestSignal: AbortSignal | undefined;
    const requestImpl = vi.fn((options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      requestSignal = options.signal;
      return Object.assign(new EventEmitter(), { end() {
        callback(Object.assign(new EventEmitter(), { statusCode: 200, headers: {
          "content-type": "application/json", "x-shopify-api-version": "2026-07"
        }, destroy: vi.fn() }) as unknown as IncomingMessage);
      } });
    });
    const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);
    const port = createShopifyCartQuotePort({ SHOPIFY_CART_QUOTE_MODE: "tokenless", SHOPIFY_CART_QUOTE_TIMEOUT_MS: "500" }, {
      resolve: resolve as unknown as typeof lookup, requestImpl: requestImpl as unknown as typeof httpsRequest
    });
    const permit = issueQuoteAuthorization([selected], "33433", new AbortController().signal);
    await expect(port.quote(selected, "33433", permit)).rejects.toMatchObject({ code: "QUOTE_TIMEOUT" });
    expect(requestImpl).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(true);
  });
});
