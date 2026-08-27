import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { CompareDeps } from "../src/compare-products.js";

const bearerToken = "price-history-test-token-12345678901234567890";
const compareDeps: CompareDeps = {
  offers: { search: async () => ({ status: "NEEDS_CLARIFICATION", questions: ["not used"] }) },
  quoteExactOffer: async () => undefined,
  clock: { now: () => new Date("2026-08-26T12:00:00.000Z") }
};

describe("price-history API", () => {
  it("returns a bounded evidence series for an exact merchant product context", async () => {
    const lookup = vi.fn(async () => [{
      amountCents: 12_345,
      currency: "USD" as const,
      basis: "DELIVERED_TOTAL" as const,
      observedAt: "2026-08-20T12:00:00.000Z"
    }]);
    const app = buildApp({
      ...compareDeps,
      priceHistory: { record: async () => "RECORDED", lookup }
    }, { bearerToken });
    const response = await app.inject({
      method: "POST",
      url: "/v1/price-history",
      headers: { authorization: `Bearer ${bearerToken}` },
      payload: {
        merchantId: "merchant-1",
        merchantProductId: "variant-1",
        basis: "DELIVERED_TOTAL",
        zipCode: "33433",
        membershipIds: ["member-b", "member-a", "member-a"]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "OK", observations: [{
      amountCents: 12_345,
      currency: "USD",
      basis: "DELIVERED_TOTAL",
      observedAt: "2026-08-20T12:00:00.000Z"
    }] });
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: "merchant-1",
      merchantProductId: "variant-1",
      zipCode: "33433",
      membershipIds: ["member-a", "member-b"]
    }), expect.any(Date));
    await app.close();
  });

  it("fails closed for malformed delivered-total context", async () => {
    const app = buildApp({
      ...compareDeps,
      priceHistory: { record: async () => "RECORDED", lookup: async () => [] }
    }, { bearerToken });
    const response = await app.inject({
      method: "POST",
      url: "/v1/price-history",
      headers: { authorization: `Bearer ${bearerToken}` },
      payload: {
        merchantId: "merchant-1",
        merchantProductId: "variant-1",
        basis: "DELIVERED_TOTAL",
        membershipIds: []
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "VALIDATION_ERROR" });
    await app.close();
  });

  it("records a current verified price observation without exposing raw context", async () => {
    const record = vi.fn(async () => "RECORDED" as const);
    const app = buildApp({
      ...compareDeps,
      priceHistory: { record, lookup: async () => [] }
    }, { bearerToken });
    const response = await app.inject({
      method: "POST",
      url: "/v1/price-observations",
      headers: { authorization: `Bearer ${bearerToken}` },
      payload: {
        merchantId: "merchant-1",
        merchantProductId: "variant-1",
        basis: "ITEM_PRICE",
        amountCents: 12_345,
        currency: "USD",
        sourceKind: "SHOPIFY_GLOBAL_CATALOG",
        observedAt: new Date().toISOString(),
        membershipIds: []
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ status: "RECORDED" });
    expect(record).toHaveBeenCalledOnce();
    await app.close();
  });
});
