import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  runMerchantContractSuite,
  type EvidenceRecord,
  type RawCoupon
} from "../../merchant-sdk/src/index.js";
import {
  createConfiguredAdapter,
  type ConfiguredSource,
  type ConfiguredSourceRequest,
  type ConfiguredSourceSnapshot
} from "../src/configured/configured-adapter.js";
import { createFeedReader, type SourceReader } from "../src/configured/feed-reader.js";
import { createHttpReader } from "../src/configured/http-reader.js";
import { createJsonLdReader } from "../src/configured/jsonld-reader.js";
import type { MerchantSourceConfigInput } from "../src/configured/source-config.js";

const NOW = "2026-08-13T12:00:00.000Z";
const MERCHANT_ID = "fixture-shop";
const ALLOWED_HOSTS = ["shop.example"];
const fixtureUrl = (kind: "feed" | "jsonld" | "http") =>
  new URL(`./fixtures/${kind}/${kind === "jsonld" ? "product.html" : "products.json"}`, import.meta.url);

const sourceDetails = {
  feed: { resourcePath: "/feeds/products.json", contentType: "application/json" },
  jsonld: { resourcePath: "/products/sku-jsonld-1", contentType: "text/html" },
  http: { resourcePath: "/public/products.json", contentType: "application/json" }
} as const;

const productIds = {
  feed: "sku-feed-1",
  jsonld: "sku-jsonld-1",
  http: "sku-http-1"
} as const;

const searchQueries = {
  feed: "Acme",
  jsonld: "Northstar",
  http: "Contoso"
} as const;

const sourcePrices = {
  feed: { public: 12_999, member: 11_999, tax: 1_040 },
  jsonld: { public: 8_950, member: 7_950, tax: 716 },
  http: { public: 7_425, member: 6_425, tax: 594 }
} as const;

function fixtureConfig(source: "feed" | "jsonld" | "http"): MerchantSourceConfigInput {
  return {
    merchantId: MERCHANT_ID,
    enabled: true,
    killSwitch: false,
    allowedHosts: ALLOWED_HOSTS,
    source: { type: source, host: "shop.example", resourcePath: sourceDetails[source].resourcePath },
    ttlSeconds: { product: 900, price: 900, inventory: 300, coupon: 900 },
    seller: { name: "Fixture Shop", condition: "NEW" },
    affiliate: {
      template: "https://go.fixture-affiliate.example/click?campaign={campaignId}&product={merchantProductId}&url={merchantUrl}",
      affiliateHosts: ["go.fixture-affiliate.example"],
      affiliateOrigins: ["https://go.fixture-affiliate.example"]
    }
  };
}

async function fixtureReader(source: "feed" | "jsonld" | "http", body: string): Promise<SourceReader> {
  const safeFetch = vi.fn(async () =>
    new Response(body, { headers: { "content-type": sourceDetails[source].contentType } })
  );
  if (source === "feed") {
    return createFeedReader(
      {
        host: "shop.example",
        resourcePath: sourceDetails.feed.resourcePath,
        allowedHosts: ALLOWED_HOSTS,
        recordsPath: "products",
        fields: {
          merchantProductId: "id",
          title: "name",
          brand: "brand",
          gtins: "gtins",
          mpn: "mpn",
          offer: {
            price: "price",
            priceCurrency: "currency",
            availability: "availability",
            url: "url"
          }
        }
      },
      { safeFetch }
    );
  }
  if (source === "jsonld") {
    return createJsonLdReader(
      {
        host: "shop.example",
        resourcePath: sourceDetails.jsonld.resourcePath,
        allowedHosts: ALLOWED_HOSTS
      },
      { safeFetch }
    );
  }
  return createHttpReader(
    {
      host: "shop.example",
      resourcePath: sourceDetails.http.resourcePath,
      allowedHosts: ALLOWED_HOSTS,
      recordsPath: "result.items",
      fields: {
        merchantProductId: "code",
        title: "label",
        brand: "maker",
        gtins: "identifiers.gtin",
        mpn: "identifiers.mpn",
        offer: {
          price: "pricing.amount",
          priceCurrency: "pricing.currency",
          availability: "stock",
          url: "productUrl"
        }
      }
    },
    { safeFetch }
  );
}

function fixtureCoupons(productId: string): RawCoupon[] {
  return [
    {
      couponId: `${productId}-public`,
      code: "SAVE5",
      amountCents: 500,
      verificationStatus: "VERIFIED",
      eligibility: [],
      validFrom: "2026-08-01T00:00:00.000Z",
      validTo: "2026-08-31T23:59:59.000Z"
    },
    {
      couponId: `${productId}-member`,
      amountCents: 1000,
      verificationStatus: "VERIFIED",
      eligibility: ["membership:plus"],
      validFrom: "2026-08-01T00:00:00.000Z",
      validTo: "2026-08-31T23:59:59.000Z"
    },
    {
      couponId: `${productId}-unverified`,
      amountCents: 9000,
      verificationStatus: "UNVERIFIED",
      eligibility: [],
      validFrom: "2026-08-01T00:00:00.000Z",
      validTo: "2026-08-31T23:59:59.000Z"
    },
    {
      couponId: `${productId}-expired`,
      amountCents: 9999,
      verificationStatus: "EXPIRED",
      eligibility: [],
      validFrom: "2026-07-01T00:00:00.000Z",
      validTo: "2026-07-31T23:59:59.000Z"
    }
  ];
}

async function fixtureSource(source: "feed" | "jsonld" | "http") {
  const body = await readFile(fixtureUrl(source), "utf8");
  const reader = await fixtureReader(source, body);
  const capture = vi.fn(async (request: ConfiguredSourceRequest): Promise<ConfiguredSourceSnapshot> => {
    const records = await reader.read();
    const hasPlus = "memberships" in request && request.memberships.includes("plus");
    const quote = {
      itemPriceCents: hasPlus ? sourcePrices[source].member : sourcePrices[source].public,
      shippingCents: 0,
      taxCents: sourcePrices[source].tax,
      mandatoryFeeCents: 0,
      status: hasPlus ? "CONDITIONAL" as const : "VERIFIED" as const,
      conditions: hasPlus ? ["Requires plus membership"] : []
    };
    const coupons = fixtureCoupons(productIds[source]);
    return {
      records,
      sourceUrl: `https://shop.example${sourceDetails[source].resourcePath}`,
      rawEvidence: JSON.stringify({ sourceDocument: body, quote, coupons }),
      metadata: { sourceVersion: "fixture-v1", fixture: source },
      checkedAt: NOW,
      quote,
      coupons
    };
  });
  const configuredSource: ConfiguredSource = {
    capture,
    health: async () => "healthy"
  };
  return { configuredSource, capture };
}

async function fixtureAdapter(source: "feed" | "jsonld" | "http") {
  const fixture = await fixtureSource(source);
  const evidence: EvidenceRecord[] = [
    {
      id: "evidence-1",
      merchantId: MERCHANT_ID,
      sourceUrl: `https://shop.example${sourceDetails[source].resourcePath}`,
      sourceType: source,
      contentHash: "abc",
      capturedAt: NOW,
      metadata: { entityId: productIds[source] }
    }
  ];
  const find = vi.fn(async () => evidence);
  const sources: Partial<Record<typeof source, ConfiguredSource>> = {
    [source]: fixture.configuredSource
  };
  const adapter = createConfiguredAdapter(fixtureConfig(source), {
    catalog: { merchantId: MERCHANT_ID, allowedHosts: ALLOWED_HOSTS },
    sources,
    evidence: { find },
    redirectValidator: { isAllowed: async () => true },
    clock: { now: () => new Date(NOW) }
  });
  return { adapter, capture: fixture.capture, find };
}

describe("configured merchant adapter", () => {
  it.each(["feed", "jsonld", "http"] as const)("passes adapter contract for %s", async (source) => {
    const { adapter } = await fixtureAdapter(source);
    const productId = productIds[source];
    const report = await runMerchantContractSuite(
      () => adapter,
      {
        search: { query: `  ${searchQueries[source].toUpperCase()}  `, limit: 5 },
        offerRefresh: { merchantProductId: productId, sourceVersion: "fixture-v1" },
        priceRefresh: {
          merchantProductId: productId,
          zipCode: "10001",
          memberships: [],
          sourceVersion: "fixture-v1"
        },
        maxSourceEntitySkewMs: 0
      }
    );

    expect(report.failures).toEqual([]);
    const candidates = await adapter.searchProducts({ query: searchQueries[source], limit: 5 });
    expect(candidates).toContainEqual(expect.objectContaining({
        merchantId: MERCHANT_ID,
        merchantProductId: productId,
        currency: "USD",
        evidenceRefs: [`${MERCHANT_ID}:fixture-v1`]
    }));
  });

  it("normalizes search input, enforces limits, routes exact IDs, and reports missing IDs", async () => {
    const { adapter, capture } = await fixtureAdapter("feed");

    await expect(adapter.searchProducts({ query: "  charger ", limit: 1 })).resolves.toHaveLength(1);
    expect(capture).toHaveBeenLastCalledWith({ operation: "search", query: "charger", limit: 1 });
    await expect(adapter.searchProducts({ query: "x", limit: 0 })).rejects.toThrow(/limit/i);
    await expect(adapter.searchProducts({ query: " ", limit: 1 })).rejects.toThrow(/query/i);
    await expect(adapter.getOffer("sku-feed-1")).resolves.toMatchObject({ merchantProductId: "sku-feed-1" });
    await expect(adapter.getOffer("missing")).resolves.toBeNull();
    await expect(adapter.quoteDeliveredPrice({ merchantProductId: "missing", zipCode: "10001", memberships: [] }))
      .rejects.toThrow(/not found/i);
  });

  it("normalizes ZIP and membership context and exposes member prices conditionally", async () => {
    const { adapter, capture } = await fixtureAdapter("feed");

    const quote = await adapter.quoteDeliveredPrice({
      merchantProductId: "sku-feed-1",
      zipCode: " 10001 ",
      memberships: ["plus", "plus"]
    });
    expect(capture).toHaveBeenLastCalledWith({
      operation: "quote",
      merchantProductId: "sku-feed-1",
      zipCode: "10001",
      memberships: ["plus"]
    });
    expect(quote).toMatchObject({
      itemPriceCents: 11_999,
      status: "CONDITIONAL",
      conditions: ["Requires plus membership"]
    });

    const publicQuote = await adapter.quoteDeliveredPrice({
      merchantProductId: "sku-feed-1",
      zipCode: "10001",
      memberships: []
    });
    expect(publicQuote.itemPriceCents).toBe(12_999);
    await expect(adapter.quoteDeliveredPrice({
      merchantProductId: "sku-feed-1",
      zipCode: "not-a-zip",
      memberships: []
    })).rejects.toThrow(/ZIP/i);
  });

  it("returns only currently verified coupons for the supplied membership context", async () => {
    const { adapter } = await fixtureAdapter("feed");

    await expect(adapter.getCoupons({ merchantProductId: "sku-feed-1", memberships: [] }))
      .resolves.toMatchObject([{ couponId: "sku-feed-1-public" }]);
    await expect(adapter.getCoupons({ merchantProductId: "sku-feed-1", memberships: ["plus"] }))
      .resolves.toMatchObject([
        { couponId: "sku-feed-1-public" },
        { couponId: "sku-feed-1-member", eligibility: ["membership:plus"] }
      ]);
  });

  it("captures atomic offer and price envelopes with one source operation each", async () => {
    const { adapter, capture } = await fixtureAdapter("feed");
    capture.mockClear();

    const offer = await adapter.refreshOffer({ merchantProductId: "sku-feed-1", sourceVersion: "fixture-v1" });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(offer.offer?.evidenceRefs).toEqual(["fixture-shop:fixture-v1"]);
    capture.mockClear();
    const price = await adapter.refreshPrice({
      merchantProductId: "sku-feed-1",
      zipCode: "10001",
      memberships: ["plus"],
      sourceVersion: "fixture-v1"
    });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(price.quote).toMatchObject({ itemPriceCents: 11_999, status: "CONDITIONAL" });
    await expect(adapter.refreshOffer({ merchantProductId: "sku-feed-1", sourceVersion: "wrong" }))
      .rejects.toThrow(/source version/i);
  });

  it("derives a deterministic source version from evidence when metadata omits one", async () => {
    const fixture = await fixtureSource("feed");
    const source: ConfiguredSource = {
      capture: async (request) => {
        const snapshot = await fixture.configuredSource.capture(request);
        const { sourceVersion: _sourceVersion, ...metadata } = snapshot.metadata;
        return { ...snapshot, metadata };
      },
      health: fixture.configuredSource.health
    };
    const adapter = createConfiguredAdapter(fixtureConfig("feed"), {
      catalog: { merchantId: MERCHANT_ID, allowedHosts: ALLOWED_HOSTS },
      sources: { feed: source },
      evidence: { find: async () => [] },
      redirectValidator: { isAllowed: async () => true },
      clock: { now: () => new Date(NOW) }
    });

    const first = await adapter.refreshProduct("sku-feed-1");
    const second = await adapter.refreshProduct("sku-feed-1");
    expect(first.sourceVersion).toMatch(/^[a-f0-9]{64}$/u);
    expect(second.sourceVersion).toBe(first.sourceVersion);
  });

  it("builds approved affiliate URLs and falls back only to canonical merchant URLs", async () => {
    const fixture = await fixtureSource("feed");
    const redirectValidator = { isAllowed: vi.fn(async () => true) };
    const adapter = createConfiguredAdapter(fixtureConfig("feed"), {
      catalog: { merchantId: MERCHANT_ID, allowedHosts: ALLOWED_HOSTS },
      sources: { feed: fixture.configuredSource },
      evidence: { find: async () => [] },
      redirectValidator,
      clock: { now: () => new Date(NOW) }
    });

    const affiliate = await adapter.buildAffiliateLink({
      merchantProductId: "sku-feed-1",
      merchantUrl: "https://shop.example/products/sku-feed-1",
      campaignId: "summer_26"
    });
    expect(affiliate.kind).toBe("AFFILIATE");
    expect(affiliate.url).toContain("campaign=summer_26");
    expect(affiliate.url).toContain("url=https%3A%2F%2Fshop.example%2Fproducts%2Fsku-feed-1");

    redirectValidator.isAllowed.mockResolvedValueOnce(false);
    await expect(adapter.buildAffiliateLink({
      merchantProductId: "sku-feed-1",
      merchantUrl: "https://shop.example/products/sku-feed-1",
      campaignId: "summer_26"
    })).resolves.toEqual({ url: "https://shop.example/products/sku-feed-1", kind: "NORMAL" });

    redirectValidator.isAllowed.mockRejectedValueOnce(new Error("validator offline"));
    await expect(adapter.buildAffiliateLink({
      merchantProductId: "sku-feed-1",
      merchantUrl: "https://shop.example/products/sku-feed-1",
      campaignId: "summer_26"
    })).resolves.toEqual({ url: "https://shop.example/products/sku-feed-1", kind: "NORMAL" });
  });

  it.each([
    "http://shop.example/products/sku-feed-1",
    "https://evil.example/products/sku-feed-1",
    "https://user@shop.example/products/sku-feed-1",
    "https://shop.example:8443/products/sku-feed-1"
  ])("rejects unsafe caller merchant URL %s", async (merchantUrl) => {
    const { adapter } = await fixtureAdapter("feed");
    await expect(adapter.buildAffiliateLink({
      merchantProductId: "sku-feed-1",
      merchantUrl,
      campaignId: "summer_26"
    })).rejects.toThrow(/merchant URL/i);
  });

  it("rejects malicious templates and campaigns before redirect validation", async () => {
    const fixture = await fixtureSource("feed");
    expect(() => createConfiguredAdapter(
      {
        ...fixtureConfig("feed"),
        affiliate: {
          template: "https://{campaignId}.fixture-affiliate.example/click",
          affiliateHosts: ["fixture-affiliate.example"],
          affiliateOrigins: ["https://fixture-affiliate.example"]
        }
      },
      {
        catalog: { merchantId: MERCHANT_ID, allowedHosts: ALLOWED_HOSTS },
        sources: { feed: fixture.configuredSource },
        evidence: { find: async () => [] },
        redirectValidator: { isAllowed: async () => true },
        clock: { now: () => new Date(NOW) }
      }
    )).toThrow(/template/i);

    const { adapter } = await fixtureAdapter("feed");
    await expect(adapter.buildAffiliateLink({
      merchantProductId: "sku-feed-1",
      merchantUrl: "https://shop.example/products/sku-feed-1",
      campaignId: "summer&next=https://evil.example"
    })).rejects.toThrow(/campaign/i);
  });

  it("requires catalog-aligned source hosts and supports normal-link-only fallback", async () => {
    const fixture = await fixtureSource("feed");
    expect(() => createConfiguredAdapter(
      { ...fixtureConfig("feed"), allowedHosts: ["shop.example", "other.example"] },
      {
        catalog: { merchantId: MERCHANT_ID, allowedHosts: ALLOWED_HOSTS },
        sources: { feed: fixture.configuredSource },
        evidence: { find: async () => [] },
        redirectValidator: { isAllowed: async () => true },
        clock: { now: () => new Date(NOW) }
      }
    )).toThrow(/catalog/i);

    const noAffiliate = { ...fixtureConfig("feed"), affiliate: undefined };
    const adapter = createConfiguredAdapter(noAffiliate, {
      catalog: { merchantId: MERCHANT_ID, allowedHosts: ALLOWED_HOSTS },
      sources: { feed: fixture.configuredSource },
      evidence: { find: async () => [] },
      redirectValidator: { isAllowed: async () => true },
      clock: { now: () => new Date(NOW) }
    });
    await expect(adapter.buildAffiliateLink({
      merchantProductId: "sku-feed-1",
      merchantUrl: "https://shop.example/products/sku-feed-1",
      campaignId: "normal"
    })).resolves.toEqual({ url: "https://shop.example/products/sku-feed-1", kind: "NORMAL" });
  });

  it("rejects unbounded or unsupported source configuration", async () => {
    const fixture = await fixtureSource("feed");
    const deps = {
      catalog: { merchantId: MERCHANT_ID, allowedHosts: ALLOWED_HOSTS },
      sources: { feed: fixture.configuredSource },
      evidence: { find: async () => [] },
      redirectValidator: { isAllowed: async () => true },
      clock: { now: () => new Date(NOW) }
    };
    expect(() => createConfiguredAdapter({
      ...fixtureConfig("feed"),
      source: { type: "crawl4ai", host: "shop.example", resourcePath: "/products" }
    } as unknown as MerchantSourceConfigInput, deps)).toThrow();
    expect(() => createConfiguredAdapter({
      ...fixtureConfig("feed"),
      source: { type: "feed", host: "shop.example", resourcePath: "https://evil.example/feed" }
    }, deps)).toThrow(/resourcePath/i);
    expect(() => createConfiguredAdapter({
      ...fixtureConfig("feed"),
      ttlSeconds: { product: 1, price: 1, inventory: 1, coupon: 1 }
    }, deps)).toThrow();
  });

  it("scopes evidence by merchant and entity and reflects configured health", async () => {
    const { adapter, find } = await fixtureAdapter("http");
    await expect(adapter.evidence("sku-http-1")).resolves.toHaveLength(1);
    expect(find).toHaveBeenCalledWith(MERCHANT_ID, "sku-http-1");
    await expect(adapter.healthCheck()).resolves.toEqual({
      status: "healthy",
      source: "http",
      checkedAt: NOW
    });

    const fixture = await fixtureSource("feed");
    const disabled = createConfiguredAdapter({ ...fixtureConfig("feed"), enabled: false }, {
      catalog: { merchantId: MERCHANT_ID, allowedHosts: ALLOWED_HOSTS },
      sources: { feed: fixture.configuredSource },
      evidence: { find: async () => [] },
      redirectValidator: { isAllowed: async () => true },
      clock: { now: () => new Date(NOW) }
    });
    await expect(disabled.healthCheck()).resolves.toMatchObject({ status: "disabled", source: "feed" });
  });
});
