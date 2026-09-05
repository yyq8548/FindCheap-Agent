import { describe, expect, it, vi } from "vitest";
import { createGenericOfficialStoreSearchPort } from "../src/generic-official-store-search.js";
import { VisualProductInputSchema, visualOfficialStoreDiscoveryQuery } from "../src/visual-product-discovery.js";
import type { OfficialShopifyFetch, OfficialShopifyStoreSeed } from "../src/shopify-official-store-search.js";

const seed: OfficialShopifyStoreSeed = { merchantId: "official-freepeople.com", merchant: "Free People",
  sourceHost: "www.freepeople.com", merchantUrl: "https://www.freepeople.com/", platform: "GENERIC_JSON_LD",
  productPathPrefixes: ["/shop/"], searchPathTemplate: "/search/?q={query}" };
const page = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const product = { "@type": "Product", name: "Example Top", sku: "STYLEBLU", offers: [
  { price: 50, priceCurrency: "USD", url: "/shop/example/STYLEBLU0XS.html", sku: "STYLEBLU0XS", size: "0XS", color: "Blue", availability: "https://schema.org/OutOfStock" },
  { price: 50, priceCurrency: "USD", url: "/shop/example/STYLEBLU00S.html", sku: "STYLEBLU00S", size: "00S", color: "Blue", availability: "https://schema.org/InStock" }
] };

describe("bounded official discovery pilot", () => {
  it("uses a visible primary color and camisole synonym without mutating observations", () => {
    const input = VisualProductInputSchema.parse({ productType: "top", observations: [
      { attribute: "COLOR", value: "pale blue gray and white", visibility: "VISIBLE", confidence: 0.95 },
      { attribute: "SLEEVE", value: "thin spaghetti straps", visibility: "VISIBLE", confidence: 0.95 },
      { attribute: "PATTERN", value: "vertical pinstripes", visibility: "VISIBLE", confidence: 0.95 }
    ] });
    const before = JSON.stringify(input);
    expect(visualOfficialStoreDiscoveryQuery(input)).toBe("blue cami");
    expect(JSON.stringify(input)).toBe(before);
  });
  it("retains strapless rather than losing it among color and length words", () => {
    expect(visualOfficialStoreDiscoveryQuery(VisualProductInputSchema.parse({ productType: "dress", observations: [
      { attribute: "COLOR", value: "dark chocolate brown", visibility: "VISIBLE", confidence: 0.95 },
      { attribute: "NECKLINE", value: "straight strapless neckline", visibility: "VISIBLE", confidence: 0.99 },
      { attribute: "LENGTH", value: "floor length maxi", visibility: "VISIBLE", confidence: 0.99 }
    ] }))).toBe("brown strapless dress");
  });
  it("does not promote uncertain or obscured clues into a compact query", () => {
    expect(visualOfficialStoreDiscoveryQuery(VisualProductInputSchema.parse({ productType: "top", observations: [
      { attribute: "COLOR", value: "blue", visibility: "VISIBLE", confidence: 0.2 },
      { attribute: "SLEEVE", value: "spaghetti straps", visibility: "OCCLUDED", confidence: 0.99 }
    ] }))).toBe("top");
  });
  it("retains official ItemList order without requiring query words in style names", async () => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async url => ({ finalUrl: url, response: new Response(
      url.includes("/search/") ? page({ "@type": "ItemList", itemListElement: [
        { "@type": "ListItem", position: 1, url: "https://evil.example/shop/example/STYLEBLU.html" },
        { "@type": "ListItem", position: 2, url: "https://www.freepeople.com/shop/example/STYLEBLU.html" }
      ] }) + '<a href="/shop/unrelated-swatches/">blue cami</a>' : page(product),
      { headers: { "content-type": "text/html" } }) }));
    const found = await createGenericOfficialStoreSearchPort({ fetchDocument }).search({ seed, query: "blue cami", limit: 1 });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ title: "Example Top", availability: "IN_STOCK", variantDimensions: { Size: "00S" } });
    expect(fetchDocument.mock.calls.map(([url]) => url)).toEqual([
      "https://www.freepeople.com/search/?q=blue%20cami", "https://www.freepeople.com/shop/example/STYLEBLU.html"
    ]);
  });
  it.each([undefined, "0XS"])("accepts source-proven alphabetic size SKUs while preserving explicit size %s", async requiredSize => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async url => ({ finalUrl: url,
      response: new Response(page(product), { headers: { "content-type": "text/html" } }) }));
    const [found] = await createGenericOfficialStoreSearchPort({ fetchDocument }).search({ seed, query: "top", limit: 1,
      sourcePageUrl: "https://www.freepeople.com/shop/example/STYLEBLU.html" + (requiredSize === undefined ? "?dwvar_STYLEBLU_color=BLU" : ""),
      ...(requiredSize === undefined ? {} : { requiredSize }) });
    expect(found?.availability).toBe(requiredSize === undefined ? "IN_STOCK" : "OUT_OF_STOCK");
    expect(found?.variantDimensions.Size).toBe(requiredSize ?? "00S");
  });
  it("bounds ranked discovery, deduplicates URLs and rejects unsafe locations", async () => {
    const links = [
      { position: 0, url: "http://www.freepeople.com/shop/insecure/" },
      { position: 1, url: "https://www.freepeople.com/account/not-a-product" },
      ...Array.from({ length: 8 }, (_, index) => ({ position: index + 2,
        url: `https://www.freepeople.com/shop/item-${index}/STYLEBLU.html` })),
      { position: 10, url: "https://www.freepeople.com/shop/item-0/STYLEBLU.html" }
    ].map(entry => ({ ...entry, position: entry.position + 1, "@type": "ListItem" })).reverse();
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async url => ({ finalUrl: url,
      response: new Response(page(url.includes("/search/")
        ? { "@type": "ItemList", itemListElement: links }
        : { ...product, offers: product.offers.map(offer => ({ ...offer,
          url: new URL(url).pathname.replace("STYLEBLU.html", `${offer.sku}.html`) })) }),
      { headers: { "content-type": "text/html" } }) }));
    const found = await createGenericOfficialStoreSearchPort({ fetchDocument }).search({ seed, query: "blue cami", limit: 20 });
    expect(found).toHaveLength(6);
    expect(fetchDocument.mock.calls.map(([url]) => url)).toEqual([
      "https://www.freepeople.com/search/?q=blue%20cami",
      ...Array.from({ length: 6 }, (_, index) => `https://www.freepeople.com/shop/item-${index}/STYLEBLU.html`)
    ]);
  });
  it("does not accept a different color SKU merely because its size is proven", async () => {
    const wrongColor = { ...product, offers: product.offers.map(offer => ({ ...offer,
      sku: offer.sku.replace("BLU", "RED"), url: offer.url.replace("BLU", "RED"), color: "Red" })) };
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async url => ({ finalUrl: url,
      response: new Response(page(wrongColor), { headers: { "content-type": "text/html" } }) }));
    await expect(createGenericOfficialStoreSearchPort({ fetchDocument }).search({ seed, query: "top", limit: 1,
      sourcePageUrl: "https://www.freepeople.com/shop/example/STYLEBLU.html?dwvar_STYLEBLU_color=BLU" })).rejects.toThrow();
  });
  it.each(["sku", "size"])("rejects alphabetic suffixes without matching offer %s proof", async field => {
    const malformed = { ...product, offers: product.offers.map(offer => ({ ...offer, [field]: "unrelated" })) };
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async url => ({ finalUrl: url,
      response: new Response(page(malformed), { headers: { "content-type": "text/html" } }) }));
    await expect(createGenericOfficialStoreSearchPort({ fetchDocument }).search({ seed, query: "top", limit: 1,
      sourcePageUrl: "https://www.freepeople.com/shop/example/STYLEBLU.html?dwvar_STYLEBLU_color=BLU" })).rejects.toThrow();
  });
});
