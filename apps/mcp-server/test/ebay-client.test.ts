import { describe, expect, it, vi } from "vitest";

import { createEbayPortFromEnvironment } from "../src/ebay-client.js";

describe("eBay public search client", () => {
  it("is optional and rejects credential-bearing URLs", () => {
    expect(createEbayPortFromEnvironment({})).toBeUndefined();
    expect(() => createEbayPortFromEnvironment({
      EBAY_PRODUCT_SEARCH_URL: "https://user:secret@example.com/v1/ebay/search"
    })).toThrow("credential-free HTTPS");
  });

  it("validates the complete public response before returning it", async () => {
    const fetchRequest = vi.fn(async () => jsonResponse({
      source: "EBAY_BROWSE",
      coverage: "COMPLETE",
      snapshotAt: "2026-08-26T12:00:00.000Z",
      diagnostics: { queryMatches: 1, itemsReturned: 1, validItems: 1, rejectedItems: 0 },
      products: [{
        itemId: "v1|1|0",
        productRef: "ebay-0123456789abcdef0123456789abcdef",
        title: "Headphones",
        category: "Audio",
        attributes: [],
        sellerName: "seller_one",
        matchStatus: "DISCOVERY_MATCH",
        matchEvidence: ["live eBay fixed-price listing returned by Browse API"],
        condition: "NEW",
        imageUrl: "https://i.ebayimg.com/images/g/test/s-l1600.jpg",
        itemPrice: { amountCents: 9900, currency: "USD" },
        availability: "UNKNOWN",
        merchantUrl: "https://www.ebay.com/itm/1",
        affiliateUrl: "https://www.ebay.com/itm/1?campid=5339000012",
        checkedAt: "2026-08-26T12:00:00.000Z"
      }]
    }));
    const port = createEbayPortFromEnvironment({
      EBAY_PRODUCT_SEARCH_URL: "https://findcheap.example/v1/ebay/search"
    }, { fetch: fetchRequest })!;

    const result = await port.search({ query: "headphones", limit: 3 });

    expect(result.products[0]?.sellerName).toBe("seller_one");
    expect(fetchRequest).toHaveBeenCalledWith(
      "https://findcheap.example/v1/ebay/search",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ query: "headphones", limit: 3 }) })
    );
  });

  it("fails closed on unapproved eBay image hosts", async () => {
    const port = createEbayPortFromEnvironment({
      EBAY_PRODUCT_SEARCH_URL: "https://findcheap.example/v1/ebay/search"
    }, { fetch: async () => jsonResponse({
      source: "EBAY_BROWSE",
      coverage: "COMPLETE",
      snapshotAt: "2026-08-26T12:00:00.000Z",
      diagnostics: { queryMatches: 1, itemsReturned: 1, validItems: 1, rejectedItems: 0 },
      products: [{
        itemId: "1",
        productRef: "ebay-0123456789abcdef0123456789abcdef",
        title: "Headphones",
        category: "Audio",
        attributes: [],
        sellerName: "seller",
        matchStatus: "DISCOVERY_MATCH",
        matchEvidence: ["listing"],
        condition: "UNKNOWN",
        imageUrl: "https://evil.example/image.jpg",
        itemPrice: { amountCents: 100, currency: "USD" },
        availability: "UNKNOWN",
        merchantUrl: "https://www.ebay.com/itm/1",
        checkedAt: "2026-08-26T12:00:00.000Z"
      }]
    }) })!;

    await expect(port.search({ query: "headphones", limit: 1 }))
      .rejects.toThrow("invalid response");
  });

  it("marks an undeployed gateway as not configured", async () => {
    const port = createEbayPortFromEnvironment({
      EBAY_PRODUCT_SEARCH_URL: "https://findcheap.example/v1/ebay/search"
    }, { fetch: async () => new Response(null, { status: 404 }) })!;

    await expect(port.search({ query: "headphones", limit: 1 }))
      .rejects.toThrow("SOURCE_NOT_CONFIGURED");
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
