import { describe, expect, it, vi } from "vitest";

import { createGenericOfficialStoreSearchPort } from "../src/generic-official-store-search.js";
import type {
  OfficialShopifyFetch,
  OfficialShopifyStoreSeed
} from "../src/shopify-official-store-search.js";

const seed: OfficialShopifyStoreSeed = {
  merchantId: "official-freepeople.com",
  merchant: "Free People",
  sourceHost: "www.freepeople.com",
  merchantUrl: "https://www.freepeople.com/",
  brand: "Free People",
  officialHost: "freepeople.com",
  platform: "GENERIC_JSON_LD",
  productPathPrefixes: ["/shop/"],
  searchPathTemplate: "/search/?q={query}",
  imageHosts: ["images.urbndata.com"]
};

const productJsonLd = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Knot Your Type Wrap Cami",
  image: ["https://images.urbndata.com/is/image/FreePeople/106973258_011_oi"],
  description: "Jacquard satin wrap cami with a halter neckline and lace trim.",
  mpn: "106973258",
  sku: "106973258",
  brand: { "@type": "Brand", name: "Intimately" },
  offers: {
    "@type": "Offer",
    price: 68,
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
    url: "https://www.freepeople.com/shop/knot-your-type-wrap-cami/"
  }
};

describe("generic official storefront search", () => {
  it("discovers and verifies a non-Shopify Product JSON-LD page", async () => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => {
      if (url.includes("/search/")) {
        return {
          response: new Response('<a href="/shop/knot-your-type-wrap-cami/">Knot Your Type Wrap Cami</a>', {
            status: 200,
            headers: { "content-type": "text/html" }
          }),
          finalUrl: url
        };
      }
      return {
        response: new Response(`<script type="application/ld+json">${JSON.stringify(productJsonLd)}</script>`, {
          status: 200,
          headers: { "content-type": "text/html" }
        }),
        finalUrl: url
      };
    });
    const port = createGenericOfficialStoreSearchPort({
      fetchDocument,
      clock: { now: () => new Date("2026-08-28T20:00:00.000Z") },
      imageProxyOrigin: "https://findcheap-agent-production.up.railway.app"
    });

    const products = await port.search({ seed, query: "Knot Your Type Wrap Cami", limit: 1 });

    expect(products).toEqual([expect.objectContaining({
      merchantId: "official-freepeople.com",
      merchant: "Free People",
      sourceHost: "www.freepeople.com",
      title: "Knot Your Type Wrap Cami",
      brand: "Intimately",
      sku: "106973258",
      itemPrice: { amountCents: 6_800, currency: "USD" },
      availability: "IN_STOCK",
      checkoutPlatform: "MERCHANT",
      merchantUrl: "https://www.freepeople.com/shop/knot-your-type-wrap-cami/",
      checkedAt: "2026-08-28T20:00:00.000Z"
    })]);
    expect(products[0]?.handle).toMatch(/^official-[a-f0-9]{32}$/u);
    expect(products[0]?.imageUrl).toBe(
      "https://findcheap-agent-production.up.railway.app/v1/official-images?url=https%3A%2F%2Fimages.urbndata.com%2Fis%2Fimage%2FFreePeople%2F106973258_011_oi"
    );
  });

  it("rejects a Product offer that leaves the approved official host", async () => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({
      response: new Response(url.includes("/search/")
        ? '<a href="/shop/knot-your-type-wrap-cami/">Knot Your Type Wrap Cami</a>'
        : `<script type="application/ld+json">${JSON.stringify({
            ...productJsonLd,
            offers: { ...productJsonLd.offers, url: "https://evil.example/product" }
          })}</script>`, {
        status: 200,
        headers: { "content-type": "text/html" }
      }),
      finalUrl: url
    }));
    const port = createGenericOfficialStoreSearchPort({ fetchDocument });

    await expect(port.search({ seed, query: "Knot Your Type Wrap Cami", limit: 1 })).resolves.toEqual([]);
  });
});
