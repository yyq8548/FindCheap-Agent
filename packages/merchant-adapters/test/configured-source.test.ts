import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { SafeFetcher } from "../src/configured/feed-reader.js";
import {
  createConfiguredSource,
  type ConfiguredSourceDriverDependencies
} from "../src/configured/configured-source.js";
import type { MerchantSourceConfigInput } from "../src/configured/source-config.js";

const NOW = "2026-08-13T12:00:00.000Z";
const rawBody = JSON.stringify({
  products: [{
    id: "sku-1",
    name: "Camera",
    gtins: ["0012345678905"],
    price: "199.99",
    currency: "USD",
    stock: "InStock",
    url: "https://shop.example/p/sku-1"
  }]
});

const recordMapping = {
  recordsPath: "products",
  fields: {
    merchantProductId: "id",
    title: "name",
    gtins: "gtins",
    offer: {
      price: "price",
      priceCurrency: "currency",
      availability: "stock",
      url: "url"
    }
  }
} as const;

function config(overrides: Partial<MerchantSourceConfigInput> = {}): MerchantSourceConfigInput {
  return {
    merchantId: "fixture-shop",
    allowedHosts: ["shop.example"],
    source: {
      type: "feed",
      host: "shop.example",
      resourcePath: "/feed.json",
      ...recordMapping
    },
    ttlSeconds: { product: 900, price: 900, inventory: 300, coupon: 900 },
    seller: { name: "Fixture Shop", condition: "NEW" },
    ...overrides
  };
}

function auditedCandidate() {
  return {
    id: "fixture-shop",
    name: "Fixture Shop",
    segment: "general" as const,
    auditState: "approved" as const,
    legalReview: "approved" as const,
    affiliateStatus: "normal_link_only" as const,
    provenSource: "feed" as const,
    allowedHosts: ["shop.example"],
    identityCompleteness: 0.95,
    weightedScore: 90,
    enabled: true
  };
}

function response(body: string, url: string): Response {
  return new class extends Response {
    override get url(): string { return url; }
  }(body, { headers: { "content-type": "application/json" } });
}

function dependencies(safeFetch: SafeFetcher): ConfiguredSourceDriverDependencies {
  return {
    safeFetch,
    clock: { now: () => new Date(NOW) }
  };
}

describe("production configured source", () => {
  it("captures parsed records and the exact evidence envelope from one primary fetch", async () => {
    const safeFetch = vi.fn<SafeFetcher>(async () =>
      response(rawBody, "https://shop.example/final/feed.json")
    );
    const source = createConfiguredSource(config(), auditedCandidate(), dependencies(safeFetch));

    const snapshot = await source.capture({ operation: "refreshOffer", merchantProductId: "sku-1" });

    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({
      merchantId: "fixture-shop",
      sourceType: "feed",
      sourceUrl: "https://shop.example/final/feed.json",
      rawEvidence: rawBody,
      checkedAt: NOW,
      metadata: {
        sourceType: "feed",
        sourceVersion: createHash("sha256").update(rawBody).digest("hex")
      },
      records: [{ merchantProductId: "sku-1", title: "Camera" }]
    });
  });

  it("fails closed without audited quote and coupon endpoints", async () => {
    const safeFetch = vi.fn<SafeFetcher>();
    const source = createConfiguredSource(config(), auditedCandidate(), dependencies(safeFetch));

    await expect(source.capture({
      operation: "quote",
      merchantProductId: "sku-1",
      zipCode: "10001",
      memberships: []
    })).rejects.toThrow(/quote.*unavailable/i);
    await expect(source.capture({
      operation: "coupons",
      merchantProductId: "sku-1",
      memberships: []
    })).rejects.toThrow(/coupon.*unavailable/i);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("uses only canonical quote placeholders and maps every delivered-price component from one response", async () => {
    const quoteBody = JSON.stringify({
      products: [{ ...JSON.parse(rawBody).products[0] }],
      delivered: {
        item: 19_999,
        shipping: 500,
        tax: 1_640,
        fees: 25,
        status: "VERIFIED",
        conditions: ["Member price"]
      }
    });
    const safeFetch = vi.fn<SafeFetcher>(async () =>
      response(quoteBody, "https://shop.example/quotes/final")
    );
    const source = createConfiguredSource(config({
      ...config(),
      quoteEndpoint: {
        audited: true,
        host: "shop.example",
        resourcePath: "/quotes/{merchantProductId}?zip={zipCode}&memberships={memberships}",
        ...recordMapping,
        quote: {
          itemPriceCents: "delivered.item",
          shippingCents: "delivered.shipping",
          taxCents: "delivered.tax",
          mandatoryFeeCents: "delivered.fees",
          status: "delivered.status",
          conditions: "delivered.conditions"
        }
      }
    }), auditedCandidate(), dependencies(safeFetch));

    const snapshot = await source.capture({
      operation: "quote",
      merchantProductId: "sku-1",
      zipCode: "10001-0001",
      memberships: ["student", "plus", "plus"]
    });

    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(safeFetch).toHaveBeenCalledWith(
      { url: "https://shop.example/quotes/sku-1?zip=10001-0001&memberships=plus%2Cstudent" },
      expect.objectContaining({ allowedHosts: ["shop.example"] })
    );
    expect(snapshot.rawEvidence).toBe(quoteBody);
    expect(snapshot.quote).toEqual({
      itemPriceCents: 19_999,
      shippingCents: 500,
      taxCents: 1_640,
      mandatoryFeeCents: 25,
      status: "VERIFIED",
      conditions: ["Member price"]
    });
  });

  it("does not invent zero-valued delivered-price components when a declared field is absent", async () => {
    const incompleteBody = JSON.stringify({
      products: [JSON.parse(rawBody).products[0]],
      delivered: {
        item: 19_999,
        tax: 1_640,
        fees: 25,
        status: "VERIFIED",
        conditions: []
      }
    });
    const source = createConfiguredSource(config({
      ...config(),
      quoteEndpoint: {
        audited: true,
        host: "shop.example",
        resourcePath: "/quotes/{merchantProductId}?zip={zipCode}",
        ...recordMapping,
        quote: {
          itemPriceCents: "delivered.item",
          shippingCents: "delivered.shipping",
          taxCents: "delivered.tax",
          mandatoryFeeCents: "delivered.fees",
          status: "delivered.status",
          conditions: "delivered.conditions"
        }
      }
    }), auditedCandidate(), dependencies(vi.fn<SafeFetcher>(async () =>
      response(incompleteBody, "https://shop.example/quotes/final")
    )));

    await expect(source.capture({
      operation: "quote",
      merchantProductId: "sku-1",
      zipCode: "10001",
      memberships: []
    })).rejects.toThrow();
  });

  it("maps only explicitly declared coupon fields from one audited endpoint response", async () => {
    const couponBody = JSON.stringify({
      products: [JSON.parse(rawBody).products[0]],
      coupons: [{
        id: "save-5",
        code: "SAVE5",
        amount: 500,
        status: "VERIFIED",
        eligibility: ["membership:plus"],
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-31T23:59:59.000Z",
        internalCampaignCost: 123
      }]
    });
    const safeFetch = vi.fn<SafeFetcher>(async () =>
      response(couponBody, "https://shop.example/coupons/final")
    );
    const source = createConfiguredSource(config({
      ...config(),
      couponEndpoint: {
        audited: true,
        host: "shop.example",
        resourcePath: "/coupons/{merchantProductId}?memberships={memberships}",
        ...recordMapping,
        couponsPath: "coupons",
        coupon: {
          couponId: "id",
          code: "code",
          amountCents: "amount",
          verificationStatus: "status",
          eligibility: "eligibility",
          validFrom: "from",
          validTo: "to"
        }
      }
    }), auditedCandidate(), dependencies(safeFetch));

    const snapshot = await source.capture({
      operation: "coupons",
      merchantProductId: "sku-1",
      memberships: ["student", "plus"]
    });

    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(snapshot.rawEvidence).toBe(couponBody);
    expect(snapshot.coupons).toEqual([{
      couponId: "save-5",
      code: "SAVE5",
      amountCents: 500,
      verificationStatus: "VERIFIED",
      eligibility: ["membership:plus"],
      validFrom: "2026-08-01T00:00:00.000Z",
      validTo: "2026-08-31T23:59:59.000Z"
    }]);
  });

  it("rejects endpoint hosts outside catalog allowlisting and unsupported API sources", () => {
    expect(() => createConfiguredSource(config({
      ...config(),
      couponEndpoint: {
        audited: true,
        host: "evil.example",
        resourcePath: "/coupons/{merchantProductId}",
        ...recordMapping,
        couponsPath: "coupons",
        coupon: {
          couponId: "id",
          amountCents: "amount",
          verificationStatus: "status",
          eligibility: "eligibility",
          validFrom: "from",
          validTo: "to"
        }
      }
    }), auditedCandidate(), dependencies(vi.fn<SafeFetcher>()))).toThrow(/host/i);

    expect(() => createConfiguredSource({
      ...config(),
      source: { type: "api", host: "shop.example", resourcePath: "/api" }
    } as unknown as MerchantSourceConfigInput, auditedCandidate(), dependencies(vi.fn<SafeFetcher>())))
      .toThrow();

    expect(() => createConfiguredSource(config({
      ...config(),
      source: {
        type: "feed",
        host: "shop.example",
        resourcePath: "/feed.json?api_key=inline-secret",
        ...recordMapping
      }
    }), auditedCandidate(), dependencies(vi.fn<SafeFetcher>()))).toThrow(/credentials/i);
  });
});
