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
  product_type: "Dresses",
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
