import { describe, expect, it, vi } from "vitest";

import type { FetchPolicy, SafeFetchInput } from "../../../apps/ingestion-worker/src/network/safe-fetch.js";
import {
  createFeedReader,
  parseMappedRecords,
  type SafeFetcher
} from "../src/configured/feed-reader.js";
import { createHttpReader } from "../src/configured/http-reader.js";
import { createJsonLdReader, parseProductJsonLd } from "../src/configured/jsonld-reader.js";

const allowedHosts = ["data.shop.example"];
const publicResolve: FetchPolicy["resolve"] = async () => [
  { address: "93.184.216.34", family: 4 }
];

function fetcher(body: string, contentType = "application/json") {
  return vi.fn<SafeFetcher>(async (_input: SafeFetchInput, _policy: FetchPolicy) =>
    new Response(body, { headers: { "content-type": contentType } })
  );
}

const fields = {
  merchantProductId: "id",
  title: "name",
  brand: "manufacturer.name",
  gtins: "identifiers.gtins",
  mpn: "identifiers.mpn",
  imageUrl: "media.primary",
  offer: {
    price: "pricing.amount",
    priceCurrency: "pricing.currency",
    availability: "stock.status",
    url: "links.product"
  }
} as const;

describe("configured source readers", () => {
  it("reads a configured feed and emits only declared fields", async () => {
    const safeFetcher = fetcher(
      JSON.stringify({
        payload: {
          products: [
            {
              id: "sku-1",
              name: "Camera",
              manufacturer: { name: "Acme", internalCode: "secret" },
              identifiers: { gtins: ["0012345678905"], mpn: "CAM-1" },
              media: { primary: "https://images.shop.example/cam.jpg" },
              pricing: { amount: 199.99, currency: "USD", cost: 20 },
              stock: { status: "InStock", warehouse: "A" },
              links: { product: "https://data.shop.example/p/sku-1" },
              internalMargin: 0.9
            }
          ]
        }
      })
    );
    const reader = createFeedReader(
      {
        host: "data.shop.example",
        resourcePath: "/feeds/products.json",
        allowedHosts,
        recordsPath: "payload.products",
        fields
      },
      { safeFetch: safeFetcher, resolve: publicResolve }
    );

    await expect(reader.read()).resolves.toEqual([
      {
        merchantProductId: "sku-1",
        title: "Camera",
        brand: "Acme",
        gtins: ["0012345678905"],
        mpn: "CAM-1",
        imageUrl: "https://images.shop.example/cam.jpg",
        rawOffer: {
          price: 199.99,
          priceCurrency: "USD",
          availability: "InStock",
          url: "https://data.shop.example/p/sku-1"
        }
      }
    ]);
    expect(safeFetcher).toHaveBeenCalledWith(
      { url: "https://data.shop.example/feeds/products.json" },
      expect.objectContaining({ allowedHosts })
    );
  });

  it("requires an explicit safe config path and declared field paths", () => {
    expect(() =>
      createFeedReader(
        {
          host: "data.shop.example",
          resourcePath: "https://evil.example/feed",
          allowedHosts,
          recordsPath: "payload.products",
          fields
        },
        { safeFetch: fetcher("{}"), resolve: publicResolve }
      )
    ).toThrow(/resourcePath/i);

    expect(() =>
      parseMappedRecords('{"products":[]}', "products", {
        ...fields,
        title: "__proto__.polluted"
      })
    ).toThrow(/field path/i);
  });

  it("rejects malformed feed records rather than coercing them", () => {
    expect(() =>
      parseMappedRecords(
        JSON.stringify({ products: [{ id: "sku-1", name: null }] }),
        "products",
        fields
      )
    ).toThrow(/record/i);
  });

  it("parses Product JSON-LD in arrays and @graph while ignoring malformed and unrelated nodes", () => {
    const document = `
      <script type="application/ld+json">
        [
          {"@type":"BreadcrumbList","name":"ignore"},
          {"@graph":[
            {"@type":["Thing","Product"],"sku":"sku-2","name":"Laptop",
             "brand":{"name":"BrandCo"},"gtin13":"1234567890123","mpn":"L-2",
             "image":["https://images.shop.example/laptop.jpg"],
             "offers":[{"price":"999.00","priceCurrency":"USD","availability":"https://schema.org/InStock","url":"https://data.shop.example/p/sku-2","internal":"drop"}]},
            {"@type":"Product","name":"Missing SKU"}
          ]}
        ]
      </script>
      <script type="application/ld+json">not valid JSON</script>
      <script>window.secret = {"@type":"Product","sku":"bad"}</script>`;

    expect(parseProductJsonLd(document)).toEqual([
      {
        merchantProductId: "sku-2",
        title: "Laptop",
        brand: "BrandCo",
        gtins: ["1234567890123"],
        mpn: "L-2",
        imageUrl: "https://images.shop.example/laptop.jpg",
        rawOffer: {
          price: "999.00",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
          url: "https://data.shop.example/p/sku-2"
        }
      }
    ]);
  });

  it("reads JSON-LD without executing page JavaScript", async () => {
    const safeFetcher = fetcher(
      '<script type="application/ld+json">{"@type":"Product","sku":"sku-3","name":"Shoes"}</script><script>throw new Error("must not execute")</script>',
      "text/html"
    );
    const reader = createJsonLdReader(
      {
        host: "data.shop.example",
        resourcePath: "/p/sku-3",
        allowedHosts
      },
      { safeFetch: safeFetcher, resolve: publicResolve }
    );

    await expect(reader.read()).resolves.toEqual([
      { merchantProductId: "sku-3", title: "Shoes", gtins: [] }
    ]);
  });

  it("uses the HTTP reader only for explicitly mapped public JSON", async () => {
    const safeFetcher = fetcher(
      JSON.stringify({ result: { product: { code: "sku-4", label: "Chair", hidden: "drop" } } })
    );
    const reader = createHttpReader(
      {
        host: "data.shop.example",
        resourcePath: "/public/product/sku-4",
        allowedHosts,
        recordsPath: "result.product",
        fields: { merchantProductId: "code", title: "label" }
      },
      { safeFetch: safeFetcher, resolve: publicResolve }
    );

    await expect(reader.read()).resolves.toEqual([
      { merchantProductId: "sku-4", title: "Chair", gtins: [] }
    ]);
  });
});
