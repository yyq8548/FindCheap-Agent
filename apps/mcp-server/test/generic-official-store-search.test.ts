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
  it.each(["Blue", undefined])("locks bare PDP color from Product.color or offer URL (%s)", async (color) => {
    const product = { ...productJsonLd, ...(color === undefined ? {} : { color }), offers: [
      { ...productJsonLd.offers, url: "/shop/knot-your-type-wrap-cami/?color=blue&size=S", size: "S", availability: "http://schema.org/OutOfStock" },
      { ...productJsonLd.offers, url: "/shop/knot-your-type-wrap-cami/?color=red&size=L", size: "L" }
    ] };
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({ response: new Response(`<script type="application/ld+json">${JSON.stringify(product)}</script>`, { headers: { "content-type": "text/html" } }), finalUrl: url }));
    const [found] = await createGenericOfficialStoreSearchPort({ fetchDocument }).search({ seed, query: "cami", limit: 1,
      sourcePageUrl: productJsonLd.offers.url });
    expect(found).toMatchObject({ availability: "OUT_OF_STOCK", availableSizes: [], availabilityScope: "PRODUCT_COLOR",
      variantDimensions: { Color: "blue", Size: "S" } });
    expect(new URL(found!.merchantUrl).searchParams.get("color")).toBe("blue");
  });

  it("inherits verified product color for offers without color metadata", async () => {
    const product = { ...productJsonLd, color: "Blue", offers: [
      { ...productJsonLd.offers, size: "S", availability: "http://schema.org/OutOfStock" },
      { ...productJsonLd.offers, size: "L" }
    ] };
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({ response: new Response(`<script type="application/ld+json">${JSON.stringify(product)}</script>`, { headers: { "content-type": "text/html" } }), finalUrl: url }));
    const [found] = await createGenericOfficialStoreSearchPort({ fetchDocument }).search({ seed, query: "cami", limit: 1,
      sourcePageUrl: productJsonLd.offers.url });
    expect(found).toMatchObject({ availability: "IN_STOCK", availableSizes: ["L"], availabilityScope: "PRODUCT_COLOR",
      variantDimensions: { Color: "Blue", Size: "L" } });
  });

  it("does not summarize same-color stock or sizes without color evidence", async () => {
    const product = { ...productJsonLd, offers: [
      { ...productJsonLd.offers, size: "S", availability: "http://schema.org/OutOfStock" },
      { ...productJsonLd.offers, size: "L" }
    ] };
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({ response: new Response(`<script type="application/ld+json">${JSON.stringify(product)}</script>`, { headers: { "content-type": "text/html" } }), finalUrl: url }));
    const [found] = await createGenericOfficialStoreSearchPort({ fetchDocument }).search({ seed, query: "cami", limit: 1,
      sourcePageUrl: productJsonLd.offers.url });
    expect(found).toMatchObject({ availability: "IN_STOCK", availabilityScope: "SELECTED_VARIANT", variantDimensions: { Size: "L" } });
    expect(found).not.toHaveProperty("availableSizes");
    expect(found?.variantDimensions).not.toHaveProperty("Color");
  });

  it("rejects conflicting product and selected URL colors", async () => {
    const product = { ...productJsonLd, color: "Blue", offers: {
      ...productJsonLd.offers, url: "/shop/knot-your-type-wrap-cami/?color=red&size=L", size: "L"
    } };
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({ response: new Response(`<script type="application/ld+json">${JSON.stringify(product)}</script>`, { headers: { "content-type": "text/html" } }), finalUrl: url }));
    await expect(createGenericOfficialStoreSearchPort({ fetchDocument }).search({ seed, query: "cami", limit: 1,
      sourcePageUrl: "https://www.freepeople.com/shop/knot-your-type-wrap-cami/?color=red&size=L" })).rejects.toThrow("official direct product unavailable");
  });

  it("rejects an offer whose color field contradicts its selected URL", async () => {
    const product = { ...productJsonLd, color: "Blue", offers: {
      ...productJsonLd.offers, color: "Blue", url: "/shop/knot-your-type-wrap-cami/?color=red&size=L", size: "L"
    } };
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({ response: new Response(`<script type="application/ld+json">${JSON.stringify(product)}</script>`, { headers: { "content-type": "text/html" } }), finalUrl: url }));
    await expect(createGenericOfficialStoreSearchPort({ fetchDocument }).search({ seed, query: "cami", limit: 1,
      sourcePageUrl: productJsonLd.offers.url })).rejects.toThrow("official direct product unavailable");
  });

  it("does not mistake a shared bare product URL for a selected out-of-stock size", async () => {
    const product = { ...productJsonLd, offers: [
      { ...productJsonLd.offers, size: "XS", color: "Black", availability: "http://schema.org/OutOfStock" },
      { ...productJsonLd.offers, size: "S", color: "Black" }
    ] };
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({ response: new Response(`<script type="application/ld+json">${JSON.stringify(product)}</script>`, { headers: { "content-type": "text/html" } }), finalUrl: url }));
    const port = createGenericOfficialStoreSearchPort({ fetchDocument });
    const [found] = await port.search({ seed, query: "cami", limit: 1, sourcePageUrl: productJsonLd.offers.url });
    expect(found).toMatchObject({ availability: "IN_STOCK", availableSizes: ["S"], availabilityScope: "PRODUCT_COLOR", variantDimensions: { Size: "S" } });
    const [selected] = await port.search({ seed, query: "cami", limit: 1, sourcePageUrl: productJsonLd.offers.url, requiredSize: "XS" });
    expect(selected).toMatchObject({ availability: "OUT_OF_STOCK", availabilityScope: "SELECTED_VARIANT", variantDimensions: { Size: "XS" } });
  });
  it("rejects an offer for a different product on the same approved host", async () => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({ response: new Response(`<script type="application/ld+json">${JSON.stringify({ ...productJsonLd,
      offers: { ...productJsonLd.offers, url: "/shop/unrelated-shoes/" }
    })}</script>`, { headers: { "content-type": "text/html" } }), finalUrl: url }));
    await expect(createGenericOfficialStoreSearchPort({ fetchDocument }).search({ seed, query: "cami", limit: 1,
      sourcePageUrl: "https://www.freepeople.com/shop/knot-your-type-wrap-cami/" })).rejects.toThrow();
  });

  it("preserves an exact out-of-stock offer URL instead of substituting another size", async () => {
    const product = { ...productJsonLd, offers: [
      { ...productJsonLd.offers, url: "/shop/knot-your-type-wrap-cami/?color=black&size=XS", size: "XS", color: "black", availability: "http://schema.org/OutOfStock" },
      { ...productJsonLd.offers, url: "/shop/knot-your-type-wrap-cami/?color=black&size=S", size: "S", color: "black" }
    ] };
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({ response: new Response(`<script type="application/ld+json">${JSON.stringify(product)}</script>`, { headers: { "content-type": "text/html" } }), finalUrl: url }));
    const sourcePageUrl = "https://www.freepeople.com/shop/knot-your-type-wrap-cami/?color=black&size=XS";
    const [found] = await createGenericOfficialStoreSearchPort({ fetchDocument }).search({ seed, query: "cami", limit: 1, sourcePageUrl });
    expect(found).toMatchObject({ availability: "OUT_OF_STOCK", merchantUrl: sourcePageUrl, availabilityScope: "SELECTED_VARIANT" });
  });
  it("resolves relative public offers, preserves selected color and summarizes saleable sizes", async () => {
    const product = { ...productJsonLd, sku: "STYLEBLU", offers: [
      { ...productJsonLd.offers, url: "/shop/knot-your-type-wrap-cami/STYLEBLU000.html", size: "0", color: "Blue", availability: "http://schema.org/OutOfStock" },
      { ...productJsonLd.offers, url: "/shop/knot-your-type-wrap-cami/STYLEBLU010.html", size: "10", color: "Blue" }
    ] };
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({ response: new Response(`<script type="application/ld+json">${JSON.stringify(product)}</script>`, { headers: { "content-type": "text/html" } }), finalUrl: url }));
    const sourcePageUrl = "https://www.freepeople.com/shop/knot-your-type-wrap-cami/STYLEBLU.html?dwvar_STYLEBLU_color=BLU";
    const [found] = await createGenericOfficialStoreSearchPort({ fetchDocument }).search({ seed, query: "cami", limit: 1, sourcePageUrl });
    expect(found).toMatchObject({ availability: "IN_STOCK", availableSizes: ["10"], availabilityScope: "PRODUCT_COLOR" });
    expect(found?.merchantUrl).toBe(sourcePageUrl);
  });

  it("does not select an in-stock different color when the requested color has no stock", async () => {
    const product = { ...productJsonLd, offers: [
      { ...productJsonLd.offers, url: "/shop/knot-your-type-wrap-cami/?color=black&size=XS", size: "XS", color: "black", availability: "http://schema.org/OutOfStock" },
      { ...productJsonLd.offers, url: "/shop/knot-your-type-wrap-cami/?color=white&size=S", size: "S", color: "white" }
    ] };
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({ response: new Response(`<script type="application/ld+json">${JSON.stringify(product)}</script>`, { headers: { "content-type": "text/html" } }), finalUrl: url }));
    const [found] = await createGenericOfficialStoreSearchPort({ fetchDocument }).search({ seed, query: "cami", limit: 1,
      sourcePageUrl: "https://www.freepeople.com/shop/knot-your-type-wrap-cami/?color=black" });
    expect(found).toMatchObject({ availability: "OUT_OF_STOCK", availableSizes: [] });
    expect(new URL(found!.merchantUrl).searchParams.get("color")).toBe("black");
  });
  it("hydrates a verified generic direct URL without broad discovery", async () => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({
      response: new Response(`<script type="application/ld+json">${JSON.stringify(productJsonLd)}</script>`, { headers: { "content-type": "text/html" } }), finalUrl: url
    }));
    const products = await createGenericOfficialStoreSearchPort({ fetchDocument }).search({ seed, query: "cami", limit: 1,
      sourcePageUrl: "https://www.freepeople.com/shop/knot-your-type-wrap-cami/" });
    expect(fetchDocument).toHaveBeenCalledOnce();
    expect(products[0]?.title).toBe("Knot Your Type Wrap Cami");
  });

  it("does not silently drop requested generic-page variant selectors", async () => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({
      response: new Response(`<script type="application/ld+json">${JSON.stringify(productJsonLd)}</script>`, { headers: { "content-type": "text/html" } }), finalUrl: url
    }));
    await expect(createGenericOfficialStoreSearchPort({ fetchDocument }).search({ seed, query: "cami", limit: 1,
      sourcePageUrl: "https://www.freepeople.com/shop/knot-your-type-wrap-cami/?color=black" })).rejects.toThrow("official direct product unavailable");
  });

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
