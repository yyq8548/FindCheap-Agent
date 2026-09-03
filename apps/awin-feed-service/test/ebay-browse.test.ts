import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  createEbayBrowseController,
  parseEbayBrowseEnvironment
} from "../src/ebay-browse.js";
import { createAwinFeedHttpServer, type AwinFeedController } from "../src/service.js";

const now = () => new Date("2026-08-26T12:00:00.000Z");

describe("eBay Browse gateway", () => {
  it("is disabled by default and requires server-side credentials when enabled", () => {
    expect(parseEbayBrowseEnvironment({})).toBeUndefined();
    expect(() => parseEbayBrowseEnvironment({ EBAY_BROWSE_ENABLED: "true" }))
      .toThrow("EBAY_CLIENT_ID");
  });

  it("uses isolated Sandbox endpoints without EPN tracking", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchRequest = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init: init ?? {} });
      if (url.includes("/oauth2/token")) return jsonResponse({ access_token: "sandbox-token", expires_in: 7200 });
      return jsonResponse({
        total: 1,
        itemSummaries: [{
          itemId: "v1|sandbox|0",
          title: "Sandbox headphones",
          price: { value: "10.00", currency: "USD" },
          itemWebUrl: "https://www.sandbox.ebay.com/itm/110552106822",
          itemAffiliateWebUrl: "https://www.ebay.com/itm/110552106822?campid=5339000012",
          seller: { username: "sandbox_seller" }
        }]
      });
    });
    const environment = parseEbayBrowseEnvironment({
      EBAY_BROWSE_ENABLED: "true",
      EBAY_ENVIRONMENT: "SANDBOX",
      EBAY_CLIENT_ID: "sandbox-client-id",
      EBAY_CLIENT_SECRET: "sandbox-client-secret"
    })!;
    const result = await createEbayBrowseController(environment, { fetch: fetchRequest, now })
      .search({ query: "headphones", limit: 1 });

    expect(requests[0]?.url).toBe("https://api.sandbox.ebay.com/identity/v1/oauth2/token");
    expect(requests[1]?.url).toContain("https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search");
    expect(requests[1]?.init.headers).not.toHaveProperty("x-ebay-c-enduserctx");
    expect(result).toMatchObject({
      environment: "SANDBOX",
      products: [{
        environment: "SANDBOX",
        merchantUrl: "https://www.sandbox.ebay.com/itm/110552106822",
        matchEvidence: ["eBay Sandbox fixed-price listing returned by Browse API"]
      }]
    });
    expect(result.products[0]).not.toHaveProperty("affiliateUrl");
  });

  it("accepts Sandbox listings when eBay omits the seller username", async () => {
    const fetchRequest = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/oauth2/token")) {
        return jsonResponse({ access_token: "sandbox-token", expires_in: 7200 });
      }
      return jsonResponse({
        total: 1,
        itemSummaries: [{
          itemId: "v1|110590166373|0",
          title: "Apple Earpods",
          price: { value: "49.00", currency: "USD" },
          itemWebUrl: "https://sandbox.ebay.com/itm/Apple-Earpods/110590166373",
          seller: { feedbackScore: 500 },
          categories: [{ categoryName: "Headphones" }]
        }]
      });
    });
    const environment = parseEbayBrowseEnvironment({
      EBAY_BROWSE_ENABLED: "true",
      EBAY_ENVIRONMENT: "SANDBOX",
      EBAY_CLIENT_ID: "sandbox-client-id",
      EBAY_CLIENT_SECRET: "sandbox-client-secret"
    })!;

    const result = await createEbayBrowseController(environment, { fetch: fetchRequest, now })
      .search({ query: "headphones", limit: 1 });

    expect(result.diagnostics).toMatchObject({ validItems: 1, rejectedItems: 0 });
    expect(result.products[0]).toMatchObject({
      sellerName: "eBay Sandbox seller",
      sellerFeedbackScore: 500
    });
  });

  it("still rejects Production listings without a seller username", async () => {
    const fetchRequest = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/oauth2/token")) {
        return jsonResponse({ access_token: "production-token", expires_in: 7200 });
      }
      return jsonResponse({
        total: 1,
        itemSummaries: [{
          itemId: "v1|123456789|0",
          title: "Production headphones",
          price: { value: "49.00", currency: "USD" },
          itemWebUrl: "https://www.ebay.com/itm/123456789",
          seller: { feedbackScore: 500 }
        }]
      });
    });
    const environment = parseEbayBrowseEnvironment({
      EBAY_BROWSE_ENABLED: "true",
      EBAY_CLIENT_ID: "client-id-123",
      EBAY_CLIENT_SECRET: "client-secret-123",
      EBAY_EPN_CAMPAIGN_ID: "5339000012"
    })!;

    const result = await createEbayBrowseController(environment, { fetch: fetchRequest, now })
      .search({ query: "headphones", limit: 1 });

    expect(result.diagnostics).toMatchObject({ validItems: 0, rejectedItems: 1 });
    expect(result.products).toEqual([]);
  });

  it("uses one cached OAuth token and returns normalized EPN listings", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchRequest = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init: init ?? {} });
      if (url.includes("/oauth2/token")) {
        return jsonResponse({ access_token: "access-token", expires_in: 7200 });
      }
      return jsonResponse({
        total: 1,
        itemSummaries: [{
          itemId: "v1|123456789|0",
          title: "Sony WH-1000XM5 Headphones",
          price: { value: "299.99", currency: "USD" },
          itemWebUrl: "https://www.ebay.com/itm/123456789",
          itemAffiliateWebUrl: "https://www.ebay.com/itm/123456789?campid=5339000012",
          image: { imageUrl: "https://i.ebayimg.com/images/g/test/s-l1600.jpg" },
          seller: { username: "audio_store", feedbackPercentage: "99.8", feedbackScore: 4200 },
          condition: "Certified Refurbished",
          categories: [{ categoryName: "Headphones" }],
          localizedAspects: [{ name: "Color", value: "Black" }]
        }]
      });
    });
    const environment = parseEbayBrowseEnvironment({
      EBAY_BROWSE_ENABLED: "true",
      EBAY_CLIENT_ID: "client-id-123",
      EBAY_CLIENT_SECRET: "client-secret-123",
      EBAY_EPN_CAMPAIGN_ID: "5339000012"
    })!;
    const controller = createEbayBrowseController(environment, { fetch: fetchRequest, now });

    const first = await controller.search({ query: "Sony headphones", limit: 3, zipCode: "10001" });
    const second = await controller.search({ query: "Sony headphones", limit: 3, zipCode: "10001" });

    expect(second).toEqual(first);
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    expect(requests[0]?.init.headers).toMatchObject({ authorization: expect.stringMatching(/^Basic /u) });
    expect(requests[1]?.url).toContain("buyingOptions%3A%7BFIXED_PRICE%7D");
    expect(requests[1]?.init.headers).toMatchObject({
      authorization: "Bearer access-token",
      "x-ebay-c-marketplace-id": "EBAY_US",
      "x-ebay-c-enduserctx": expect.stringContaining("affiliateCampaignId=5339000012")
    });
    expect(first.products[0]).toMatchObject({
      environment: "PRODUCTION",
      productRef: expect.stringMatching(/^ebay-[a-f0-9]{32}$/u),
      sellerName: "audio_store",
      sellerFeedbackPercentage: 99.8,
      condition: "REFURBISHED",
      itemPrice: { amountCents: 29_999, currency: "USD" },
      affiliateUrl: expect.stringContaining("campid=5339000012")
    });
  });

  it("exposes the public eBay route without exposing credentials", async () => {
    const ebay = { search: vi.fn(async () => ({
      source: "EBAY_BROWSE" as const,
      environment: "PRODUCTION" as const,
      coverage: "COMPLETE" as const,
      snapshotAt: "2026-08-26T12:00:00.000Z",
      diagnostics: { queryMatches: 0, itemsReturned: 0, validItems: 0, rejectedItems: 0 },
      products: []
    })) };
    const awin = {
      loadExisting: async () => {},
      refresh: async () => {},
      getState: () => ({}),
      search: () => undefined,
      getImageSource: () => undefined
    } satisfies AwinFeedController;
    const server = createAwinFeedHttpServer(awin, "a".repeat(32), { ebay });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind TCP");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/ebay/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "headphones", limit: 3 })
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ source: "EBAY_BROWSE" });
      expect(ebay.search).toHaveBeenCalledWith({ query: "headphones", limit: 3 });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
