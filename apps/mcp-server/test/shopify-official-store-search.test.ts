import { describe, expect, it, vi } from "vitest";

import {
  createOfficialShopifySearchPort,
  type OfficialShopifyFetch
} from "../src/shopify-official-store-search.js";
import type { ShopifyProduct } from "../src/shopify-client.js";

const seed: ShopifyProduct = {
  merchantId: "shopify-11236098",
  merchant: "DÔEN",
  sourceHost: "www.shopdoen.com",
  merchantTrust: {
    level: "OFFICIAL",
    verification: "INDEPENDENT",
    evidence: ["independently reviewed official domain"]
  },
  handle: "42677111750769",
  title: "Nevita Dress",
  brand: "DÔEN",
  gtins: [],
  variantDimensions: { Size: "XXS" },
  matchStatus: "DISCOVERY_MATCH",
  matchEvidence: ["catalog result"],
  condition: "UNKNOWN",
  itemPrice: { amountCents: 24_800, currency: "USD" },
  availability: "IN_STOCK",
  merchantUrl: "https://www.shopdoen.com/products/nevita-dress?variant=42677111750769",
  checkedAt: "2026-08-27T00:00:00.000Z"
};

const predictiveJson = {
  resources: {
    results: {
      products: [{
        title: "Cornella Dress -- Black",
        handle: "cornella-dress-black",
        url: "/products/cornella-dress-black",
        vendor: "DÔEN",
        type: "Dresses"
      }]
    }
  }
};

const productJson = {
  title: "Cornella Dress -- Black",
  handle: "cornella-dress-black",
  vendor: "DÔEN",
  product_type: "",
  type: "FALL 26",
  description: "A black lace mini dress with a tiered skirt.",
  featured_image: "//www.shopdoen.com/cdn/shop/files/cornella.jpg",
  options: [{ name: "Size", position: 1, values: ["XS", "S", "M"] }],
  variants: [
    { id: 472001, title: "XS", available: false, price: 59_800, sku: "COR-XS", options: ["XS"] },
    { id: 472002, title: "S", available: true, price: 59_800, sku: "COR-S", barcode: "123456789012", options: ["S"] },
    { id: 472003, title: "M", available: true, price: 59_800, sku: "COR-M", options: ["M"] }
  ]
};

describe("official Shopify storefront search", () => {
  it.each([true, false])("isolates ProductGroup size availability from other colors (color known: %s)", async (colorKnown) => {
    const target = "https://www.shopdoen.com/products/cornella-dress-black";
    const group = { "@type": "ProductGroup", name: "Example dress", hasVariant: [
      { name: "Black XS", size: "XS", ...(colorKnown ? { color: "Black" } : {}),
        offers: { availability: "https://schema.org/OutOfStock", price: 100, priceCurrency: "USD", url: `${target}?variant=1` } },
      { name: "White M", size: "M", color: "White",
        offers: { availability: "https://schema.org/InStock", price: 100, priceCurrency: "USD", url: `${target}?variant=2` } }
    ] };
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({ response: new Response(url.endsWith(".js")
      ? "not a Shopify JSON document" : `<script type="application/ld+json">${JSON.stringify(group)}</script>`), finalUrl: url }));
    const port = createOfficialShopifySearchPort({ fetchDocument });
    const [selected] = await port.search({ seed, query: "dress", limit: 1, sourcePageUrl: `${target}?variant=1` });
    expect(selected).toMatchObject({ handle: "1", availability: "OUT_OF_STOCK", availabilityScope: "SELECTED_VARIANT", variantDimensions: { Size: "XS" } });
    expect(selected?.availableSizes).toEqual(colorKnown ? [] : undefined);
    if (colorKnown) {
      const [sameColor] = await port.search({ seed, query: "dress", limit: 1, sourcePageUrl: target, requiredColor: "Black" });
      expect(sameColor).toMatchObject({ handle: "1", availability: "OUT_OF_STOCK", availableSizes: [], availabilityScope: "PRODUCT_COLOR" });
    }
  });
  it("reports same-color available sizes without treating the first unavailable XXS as the product", async () => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({ response: new Response(JSON.stringify(productJson)), finalUrl: url }));
    const [product] = await createOfficialShopifySearchPort({ fetchDocument }).search({ seed, query: "dress", limit: 1,
      sourcePageUrl: "https://www.shopdoen.com/products/cornella-dress-black" });
    expect(product).toMatchObject({ availabilityScope: "PRODUCT_COLOR", availableSizes: ["S", "M"], availability: "IN_STOCK" });
  });

  it("selects an explicitly required size and never substitutes another size", async () => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({ response: new Response(JSON.stringify(productJson)), finalUrl: url }));
    const port = createOfficialShopifySearchPort({ fetchDocument });
    const [product] = await port.search({ seed, query: "dress", limit: 1, requiredSize: "XS",
      sourcePageUrl: "https://www.shopdoen.com/products/cornella-dress-black" });
    expect(product).toMatchObject({ handle: "472001", availabilityScope: "SELECTED_VARIANT", availability: "OUT_OF_STOCK" });
    await expect(port.search({ seed, query: "dress", limit: 1, requiredSize: "XL",
      sourcePageUrl: "https://www.shopdoen.com/products/cornella-dress-black" })).rejects.toThrow();
  });
  it("reads an exact official product URL before discovery and retains the selected variant", async () => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({
      response: new Response(JSON.stringify(productJson)), finalUrl: url
    }));
    const port = createOfficialShopifySearchPort({ fetchDocument });
    const result = await port.search({ seed, query: "dress", limit: 6,
      sourcePageUrl: "https://www.shopdoen.com/products/cornella-dress-black?variant=472003" });
    expect(fetchDocument).toHaveBeenCalledTimes(1);
    expect(fetchDocument.mock.calls[0]?.[0]).toBe("https://www.shopdoen.com/products/cornella-dress-black.js");
    expect(result[0]).toMatchObject({ handle: "472003", variantDimensions: { Size: "M" } });
  });

  it("never replaces a missing explicitly requested variant with the first available variant", async () => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({ response: new Response(JSON.stringify(productJson)), finalUrl: url }));
    await expect(createOfficialShopifySearchPort({ fetchDocument }).search({ seed, query: "dress", limit: 6,
      sourcePageUrl: "https://www.shopdoen.com/products/cornella-dress-black?variant=999999"
    })).rejects.toThrow("official direct product unavailable");
  });

  it("does not start discovery when the parent search is already aborted", async () => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>();
    const signal = AbortSignal.abort(new Error("caller cancelled"));
    await expect(createOfficialShopifySearchPort({ fetchDocument }).search({ seed, query: "dress", limit: 6, signal })).rejects.toThrow();
    expect(fetchDocument).not.toHaveBeenCalled();
  });

  it("bounds cached product documents instead of loading an oversized direct response", async () => {
    const cancelled = vi.fn();
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({ response: new Response(new ReadableStream({
      start(stream) { stream.enqueue(new Uint8Array(1024 * 1024 + 1)); }, cancel: cancelled
    })), finalUrl: url }));
    await expect(createOfficialShopifySearchPort({ fetchDocument }).search({ seed, query: "dress", limit: 6, cacheScope: {},
      sourcePageUrl: "https://www.shopdoen.com/products/cornella-dress-black"
    })).rejects.toThrow("official direct product unavailable");
    expect(cancelled).toHaveBeenCalledTimes(2);
  });

  it.each([
    "https://evil.example/products/cornella-dress-black",
    "https://www.shopdoen.com:444/products/cornella-dress-black",
    "https://www.shopdoen.com/account/login",
    "https://www.shopdoen.com/products/cornella-dress-black?redirect=https://evil.example"
  ])("rejects an unsafe direct product URL without fetching: %s", async (sourcePageUrl) => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>();
    await expect(createOfficialShopifySearchPort({ fetchDocument }).search({
      seed, query: "dress", limit: 6, sourcePageUrl
    })).rejects.toThrow();
    expect(fetchDocument).not.toHaveBeenCalled();
  });

  it("reuses bounded sitemap and product reads only inside the same search scope", async () => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({
      response: new Response(url.endsWith("sitemap.xml") ? "<sitemapindex/>" : url.endsWith("sitemap-products.xml")
        ? "<urlset/>" : JSON.stringify(url.includes("search/suggest") ? predictiveJson : productJson)), finalUrl: url
    }));
    const port = createOfficialShopifySearchPort({ fetchDocument });
    const cacheScope = {};
    await port.search({ seed, query: "dress black", limit: 6, cacheScope });
    await port.search({ seed, query: "dress mini", limit: 6, cacheScope });
    expect(fetchDocument.mock.calls.filter(([url]) => url.endsWith("sitemap.xml"))).toHaveLength(1);
    expect(fetchDocument.mock.calls.filter(([url]) => url.endsWith("cornella-dress-black.js"))).toHaveLength(1);
    await port.search({ seed, query: "dress mini", limit: 6, cacheScope: {} });
    expect(fetchDocument.mock.calls.filter(([url]) => url.endsWith("cornella-dress-black.js"))).toHaveLength(2);
  });

  it("hydrates a predictive result into one stable in-stock variant", async () => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => ({
      response: new Response(JSON.stringify(url.includes("search/suggest") ? predictiveJson : productJson), {
        status: 200,
        headers: { "content-type": "application/json" }
      }),
      finalUrl: url
    }));
    const port = createOfficialShopifySearchPort({
      fetchDocument,
      clock: { now: () => new Date("2026-08-27T01:02:03.000Z") }
    });

    const products = await port.search({ seed, query: "women mini dress black lace", limit: 6 });

    expect(fetchDocument.mock.calls[0]?.[0]).toBe(
      "https://www.shopdoen.com/search/suggest.json?q=women+mini+dress+black+lace&resources%5Btype%5D=product&resources%5Blimit%5D=6"
    );
    expect(fetchDocument).toHaveBeenCalledWith(
      "https://www.shopdoen.com/products/cornella-dress-black.js",
      "www.shopdoen.com"
    );
    expect(products).toEqual([expect.objectContaining({
      merchantId: "shopify-11236098",
      merchant: "DÔEN",
      sourceHost: "www.shopdoen.com",
      handle: "472002",
      title: "Cornella Dress -- Black",
      brand: "DÔEN",
      productType: "Dresses",
      sku: "COR-S",
      gtins: ["123456789012"],
      variantDimensions: { Size: "S" },
      matchStatus: "DISCOVERY_MATCH",
      condition: "UNKNOWN",
      imageUrl: "https://www.shopdoen.com/cdn/shop/files/cornella.jpg",
      itemPrice: { amountCents: 59_800, currency: "USD" },
      availability: "IN_STOCK",
      merchantUrl: "https://www.shopdoen.com/products/cornella-dress-black?variant=472002",
      checkedAt: "2026-08-27T01:02:03.000Z"
    })]);
  });

  it("merges predictive and sitemap candidates before visual review", async () => {
    const henriettaJson = {
      ...productJson,
      title: "Henrietta Dress -- Black",
      handle: "henrietta-dress-black",
      description: "A black mini dress with a deep V neckline and vertical front ruffle.",
      variants: [{ id: 473001, title: "S", available: true, price: 49_800, sku: "HEN-S", options: ["S"] }]
    };
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => {
      if (url.includes("search/suggest")) {
        return {
          response: new Response(JSON.stringify({
            resources: { results: { products: [{ handle: "henrietta-dress-black", url: "/products/henrietta-dress-black" }] } }
          }), { status: 200 }),
          finalUrl: url
        };
      }
      if (url === "https://www.shopdoen.com/sitemap.xml") {
        return {
          response: new Response("<sitemapindex><sitemap><loc>https://www.shopdoen.com/sitemap-products.xml</loc></sitemap></sitemapindex>"),
          finalUrl: url
        };
      }
      if (url === "https://www.shopdoen.com/sitemap-products.xml") {
        return {
          response: new Response(`<urlset>
            <url><loc>https://www.shopdoen.com/products/henrietta-dress-black</loc><image:title>Henrietta Dress Black</image:title></url>
            <url><loc>https://www.shopdoen.com/products/cornella-dress-black</loc><image:title>Cornella Dress Black Lace Mini</image:title></url>
          </urlset>`),
          finalUrl: url
        };
      }
      const body = url.includes("cornella-dress-black.js") ? productJson : henriettaJson;
      return { response: new Response(JSON.stringify(body), { status: 200 }), finalUrl: url };
    });
    const port = createOfficialShopifySearchPort({
      fetchDocument,
      clock: { now: () => new Date("2026-08-27T01:02:03.000Z") }
    });

    const products = await port.search({ seed, query: "dress black lace mini boat neck", limit: 6 });

    expect(products.map((product) => product.title)).toEqual([
      "Henrietta Dress -- Black",
      "Cornella Dress -- Black"
    ]);
    expect(products[1]).toMatchObject({
      merchantUrl: "https://www.shopdoen.com/products/cornella-dress-black?variant=472002"
    });
  });

  it("does not spend the canonical product sitemap budget on locale duplicates", async () => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async url => {
      const body = url.includes("search/suggest") ? JSON.stringify({ resources: { results: { products: [] } } })
        : url === "https://www.shopdoen.com/sitemap.xml"
          ? `<sitemapindex>${["/en-ca/", "/en-cr/", "/en-co/", "/en-gb/", "/"].map(prefix =>
            `<sitemap><loc>https://www.shopdoen.com${prefix}sitemap_products_1.xml</loc></sitemap>`).join("")}</sitemapindex>`
          : url === "https://www.shopdoen.com/sitemap_products_1.xml"
            ? "<urlset><url><loc>https://www.shopdoen.com/products/cornella-dress-black</loc><image:title>Black lace mini dress</image:title></url></urlset>"
            : JSON.stringify(productJson);
      return { finalUrl: url, response: new Response(body) };
    });
    const products = await createOfficialShopifySearchPort({ fetchDocument }).search({ seed, query: "black lace mini dress", limit: 6 });
    expect(products.some(product => product.title === productJson.title)).toBe(true);
    expect(fetchDocument.mock.calls.some(([url]) => /\/en-[a-z]{2}\//u.test(url))).toBe(false);
    expect(fetchDocument.mock.calls.filter(([url]) => url.includes("sitemap_products"))).toHaveLength(1);
  });

  it("falls back to an official sitemap and ProductGroup JSON-LD for a headless Shopify store", async () => {
    const skimsSeed: ShopifyProduct = {
      ...seed,
      merchantId: "shopify-skims",
      merchant: "SKIMS",
      sourceHost: "skims.com",
      title: "VETTESE X SKIMS Sheer Modal Long Dress | Onyx",
      brand: "SKIMS",
      merchantUrl: "https://skims.com/products/vettese-x-skims-sheer-modal-long-dress-onyx?variant=1"
    };
    const targetUrl = "https://skims.com/products/soft-lounge-long-slip-dress-heather-grey";
    const productGroup = {
      "@context": "https://schema.org",
      "@type": "ProductGroup",
      name: "SOFT LOUNGE LONG SLIP DRESS | HEATHER GREY",
      brand: { "@type": "Brand", name: "SKIMS" },
      description: "A soft, body-hugging long slip dress.",
      hasVariant: [
        {
          "@type": "Product",
          name: "SOFT LOUNGE LONG SLIP DRESS | HEATHER GREY | S",
          gtin: "194378576600",
          mpn: "AP-DRS-0596-HEG-S",
          size: "S",
          image: "https://cdn.shopify.com/soft-lounge-grey.jpg",
          offers: {
            "@type": "Offer",
            availability: "https://schema.org/OutOfStock",
            price: 34,
            priceCurrency: "USD",
            url: `${targetUrl}?variant=34535377305732`
          }
        },
        {
          "@type": "Product",
          name: "SOFT LOUNGE LONG SLIP DRESS | HEATHER GREY | XL",
          gtin: "194378576677",
          mpn: "AP-DRS-0596-HEG-XL",
          size: "XL",
          image: "https://cdn.shopify.com/soft-lounge-grey.jpg",
          offers: {
            "@type": "Offer",
            availability: "https://schema.org/InStock",
            price: "34.00",
            priceCurrency: "USD",
            url: `${targetUrl}?variant=34535377404036`
          }
        }
      ]
    };
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url) => {
      if (url.includes("search/suggest")) {
        return { response: new Response("not found", { status: 404 }), finalUrl: url };
      }
      if (url === "https://skims.com/sitemap.xml") {
        return {
          response: new Response("<sitemapindex><sitemap><loc>https://skims.com/sitemap-products.xml</loc></sitemap></sitemapindex>"),
          finalUrl: url
        };
      }
      if (url === "https://skims.com/sitemap-products.xml") {
        return {
          response: new Response(`<urlset><url><loc>${targetUrl}</loc></url></urlset>`),
          finalUrl: url
        };
      }
      if (url === `${targetUrl}.js`) {
        return { response: new Response("not found", { status: 404 }), finalUrl: url };
      }
      return {
        response: new Response(`<html><script type="application/ld+json">${JSON.stringify(productGroup)}</script></html>`),
        finalUrl: url
      };
    });
    const port = createOfficialShopifySearchPort({
      fetchDocument,
      clock: { now: () => new Date("2026-08-27T01:02:03.000Z") }
    });

    const products = await port.search({
      seed: skimsSeed,
      query: "slip dress solid heather gray maxi soft lounge",
      limit: 6
    });

    expect(products).toEqual([expect.objectContaining({
      merchant: "SKIMS",
      sourceHost: "skims.com",
      handle: "34535377404036",
      title: "SOFT LOUNGE LONG SLIP DRESS | HEATHER GREY",
      brand: "SKIMS",
      sku: "AP-DRS-0596-HEG-XL",
      gtins: ["194378576677"],
      variantDimensions: { Size: "XL" },
      itemPrice: { amountCents: 3_400, currency: "USD" },
      availability: "IN_STOCK",
      merchantUrl: `${targetUrl}?variant=34535377404036`
    })]);
  });

  it("rejects a seed whose host is not independently verified as official", async () => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>();
    const port = createOfficialShopifySearchPort({ fetchDocument });

    await expect(port.search({
      seed: {
        ...seed,
        sourceHost: "doen-official.example",
        merchantUrl: "https://doen-official.example/products/nevita-dress",
        merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT", evidence: ["spoofed"] }
      },
      query: "black lace dress",
      limit: 3
    })).rejects.toThrow("official storefront was not independently verified");
    expect(fetchDocument).not.toHaveBeenCalled();
  });

  it("fails closed when Shopify redirects a product request to another path", async () => {
    const fetchDocument: OfficialShopifyFetch = async (url) => ({
      response: new Response(JSON.stringify(url.includes("search/suggest") ? predictiveJson : productJson)),
      finalUrl: url.includes("search/suggest")
        ? url
        : "https://www.shopdoen.com/products/another-dress.js"
    });
    const port = createOfficialShopifySearchPort({ fetchDocument });

    await expect(port.search({ seed, query: "black lace dress", limit: 3 }))
      .resolves.toEqual([]);
  });
});
