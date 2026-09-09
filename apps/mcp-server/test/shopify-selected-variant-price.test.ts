import { describe, expect, it, vi } from "vitest";
import { createShopifySelectedProductInspector } from "../src/shopify-selected-product.js";
import type { ShopifyProduct } from "../src/shopify-client.js";

// Reduced public Glossier response captured 2026-09-09. Expected USD 16 is the
// current variant's one-time price; selling-plan USD 14.40 is not its item price.
const selected: ShopifyProduct = {
  merchantId: "shopify-62791647477", merchant: "Glossier", sourceHost: "www.glossier.com", brand: "Glossier",
  merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT", evidence: ["reviewed official merchant"] },
  handle: "46731565826293", title: "Balm Dotcom", gtins: [], variantDimensions: { Flavor: "Espresso" },
  matchStatus: "DISCOVERY_MATCH", matchEvidence: [], condition: "NEW", availability: "IN_STOCK",
  itemPrice: { amountCents: 1600, currency: "USD" },
  merchantUrl: "https://www.glossier.com/products/balm-dotcom?variant=46731565826293",
  checkedAt: "2026-09-09T19:49:55.596Z"
};
const product = { id: 9150866882805, handle: "balm-dotcom", title: "Balm Dotcom", vendor: "Glossier",
  options: [{ name: "Flavor", position: 1, values: ["Espresso"] }],
  variants: [{ id: 46731565826293, title: "Espresso", options: ["Espresso"], available: true,
    price: 1600, sku: "BDC-467-00-00", requires_selling_plan: false,
    selling_plan_allocations: [{ price: 1440, selling_plan_id: 4531093749 }] }] };
const pixel = { id: "46731565826293", sku: "BDC-467-00-00", title: "Espresso",
  price: { amount: 16, currencyCode: "USD" },
  product: { id: "9150866882805", url: "/products/balm-dotcom" } };
const script = (data: unknown) => `<script>(function(){var wpmLoader=function(){};wpmLoader({initData: ${JSON.stringify(data)}});})();</script>`;
const parentOffer = '<script type="application/ld+json">{"@type":"Product","name":"Balm Dotcom","offers":{"price":"16","priceCurrency":"USD"}}</script>';
async function inspect(html = script({ productVariants: [pixel] }), json: unknown = product, target = selected) {
  const fetchProduct = vi.fn(async (url: string) => ({ finalUrl: url,
    response: url.endsWith(".js") ? Response.json(json) : new Response(html) }));
  const result = await createShopifySelectedProductInspector({ fetchProduct }).inspect(target, target.variantDimensions);
  return { result, fetchProduct };
}

describe("selected variant prices from current Shopify Web Pixels data", () => {
  it("uses the exact Glossier variant USD amount, SKU and stock without borrowing the parent or subscription price", async () => {
    const { result, fetchProduct } = await inspect(parentOffer + script({ productVariants: [pixel] }));
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]).toMatchObject({ handle: "46731565826293", sku: "BDC-467-00-00",
      variantDimensions: { Flavor: "Espresso" }, availability: "IN_STOCK", availabilityScope: "SELECTED_VARIANT",
      itemPrice: { amountCents: 1600, currency: "USD" } });
    expect(fetchProduct).toHaveBeenCalledTimes(2);
  });

  it("supports the independently observed Allbirds size 5 variant at USD 105", async () => {
    const target = { ...selected, sourceHost: "www.allbirds.com", handle: "41243609661520",
      variantDimensions: { Size: "5" }, merchantUrl: "https://www.allbirds.com/products/womens-wool-cruiser-natural-grey?variant=41243609661520" };
    const json = { ...product, id: 7199653101648, handle: "womens-wool-cruiser-natural-grey",
      options: [{ name: "Size", position: 1, values: ["5"] }],
      variants: [{ id: 41243609661520, sku: "A11724W050", title: "5", options: ["5"], available: true, price: 10500 }] };
    const evidence = { ...pixel, id: "41243609661520", sku: "A11724W050", price: { amount: 105, currencyCode: "USD" },
      product: { id: "7199653101648", url: "/products/womens-wool-cruiser-natural-grey" } };
    expect((await inspect(script({ productVariants: [evidence] }), json, target)).result.variants[0]?.itemPrice)
      .toEqual({ amountCents: 10500, currency: "USD" });
  });

  it.each([
    ["foreign product", { ...pixel, product: { ...pixel.product, id: "999" } }],
    ["foreign path", { ...pixel, product: { ...pixel.product, url: "/products/another-balm" } }],
    ["foreign host", { ...pixel, product: { ...pixel.product, url: "https://unrelated.example/products/balm-dotcom" } }],
    ["wrong SKU", { ...pixel, sku: "ANOTHER" }],
    ["missing SKU", { ...pixel, sku: undefined }],
    ["foreign variant", { ...pixel, id: "46731565826294" }],
    ["non-USD", { ...pixel, price: { amount: 16, currencyCode: "CAD" } }],
    ["different amount", { ...pixel, price: { amount: 14.4, currencyCode: "USD" } }],
    ["fractional cents", { ...pixel, price: { amount: 16.001, currencyCode: "USD" } }]
  ])("keeps %s evidence unknown despite a USD parent offer", async (_name, evidence) => {
    expect((await inspect(parentOffer + script({ productVariants: [evidence] }))).result.variants[0]?.itemPrice).toBeUndefined();
  });

  it("does not borrow global currency, cart items or recommendation data", async () => {
    const html = parentOffer + script({ shop: { paymentSettings: { currencyCode: "USD" } },
      cart: { productVariants: [pixel] }, recommendations: { productVariants: [pixel] } });
    expect((await inspect(html)).result.variants[0]?.itemPrice).toBeUndefined();
  });

  it("rejects multiple initialization scripts, even when their prices agree", async () => {
    expect((await inspect(script({ productVariants: [pixel] }).repeat(2))).result.variants[0]?.itemPrice).toBeUndefined();
  });

  it("rejects duplicate variant records instead of choosing a favorable price", async () => {
    expect((await inspect(script({ productVariants: [pixel, { ...pixel, price: { amount: 20, currencyCode: "USD" } }] })))
      .result.variants[0]?.itemPrice).toBeUndefined();
  });

  it("does not parse executable expressions as JSON", async () => {
    const html = '<script>var wpmLoader=function(){};wpmLoader({initData: {productVariants: [evil()]}});</script>';
    expect((await inspect(html)).result.variants[0]?.itemPrice).toBeUndefined();
  });

  it("requires initData to be the direct Web Pixels configuration, not another analytics object", async () => {
    const json = JSON.stringify({ productVariants: [pixel] });
    const html = `<script>var wpmLoader=function(){};wpmLoader({other: {initData: ${json}}});</script>`;
    expect((await inspect(html)).result.variants[0]?.itemPrice).toBeUndefined();
    const unrelated = `<script>var wpmLoader=function(){};wpmLoader({});analytics({initData: ${json}});</script>`;
    expect((await inspect(unrelated)).result.variants[0]?.itemPrice).toBeUndefined();
  });

  it("rejects duplicate JSON keys, without letting the last amount silently win", async () => {
    const html = script({ productVariants: [pixel] }).replace('"amount":16', '"amount":20,"amount":16');
    expect((await inspect(html)).result.variants[0]?.itemPrice).toBeUndefined();
  });

  it.each(["comment", "template", "unused function", "conditional", "after return"])("ignores a call in %s", async kind => {
    const call = `wpmLoader({initData: ${JSON.stringify({ productVariants: [pixel] })}});`;
    const body = kind === "comment" ? `/* ${call} */` : kind === "template" ? `const example = \`${call}\`;`
      : kind === "unused function" ? `function unused(){${call}}` : kind === "conditional" ? `if(false){${call}}`
        : `return;${call}`;
    const html = `<script>(function(){var wpmLoader=function(){};${body}})();</script>`;
    expect((await inspect(html)).result.variants[0]?.itemPrice).toBeUndefined();
  });

  it("reads the first configuration in the observed five-argument loader, requiring literal arguments", async () => {
    const configuration = `{initData:${JSON.stringify({ productVariants: [pixel] })}}`;
    const html = `<script>(function(){var wpmLoader=function(){}();wpmLoader(${configuration},"https://www.glossier.com/cdn","version",{modern:"file.js",legacy:"old.js"},{events:"[]"});})();</script>`;
    expect((await inspect(html)).result.variants[0]?.itemPrice).toEqual({ amountCents: 1600, currency: "USD" });
    expect((await inspect(html.replace('events:"[]"', 'events:loadEvents()'))).result.variants[0]?.itemPrice).toBeUndefined();
  });

  it.each(['type="application/json"', 'type="module"', 'src="/loader.js"', 'type="text/javascript" src="/loader.js"'])("rejects unverified script position %s", async attributes => {
    expect((await inspect(script({ productVariants: [pixel] }).replace("<script>", `<script ${attributes}>`)))
      .result.variants[0]?.itemPrice).toBeUndefined();
  });

  it("accepts an explicit classic JavaScript MIME without a source URL", async () => {
    expect((await inspect(script({ productVariants: [pixel] }).replace("<script>", '<script type="text/javascript">')))
      .result.variants[0]?.itemPrice).toEqual({ amountCents: 1600, currency: "USD" });
  });

  it.each(["comment", "unclosed comment", "template", "nested template", "template raw script"])("rejects a script in HTML %s", async context => {
    const value = script({ productVariants: [pixel] });
    const html = context === "comment" ? `<!-- ${value} -->` : context === "unclosed comment" ? `<!-- ${value}`
      : context === "template" ? `<template>${value}</template>` : context === "nested template" ? `<template><template></template>${value}</template>`
        : `<template><script>const value="</template>";</script>${value}</template>`;
    expect((await inspect(html)).result.variants[0]?.itemPrice).toBeUndefined();
  });

  it.each(["textarea", "title", "xmp", "iframe", "noscript", "style"])("ignores script-shaped raw text in %s", async tag => {
    expect((await inspect(`<${tag}>${script({ productVariants: [pixel] })}</${tag}>`)).result.variants[0]?.itemPrice).toBeUndefined();
  });

  it("does not treat script-shaped attribute text as a DOM script", async () => {
    const html = `<div data-example='${script({ productVariants: [pixel] })}'></div>`;
    expect((await inspect(html)).result.variants[0]?.itemPrice).toBeUndefined();
  });

  it("requires the current product ID and preserves an explicit non-USD product", async () => {
    expect((await inspect(undefined, { ...product, id: undefined })).result.variants[0]?.itemPrice).toBeUndefined();
    const nonUsd = await inspect(undefined, { ...product, currency: "CAD" });
    expect(nonUsd.result.variants[0]?.itemPrice).toBeUndefined();
    expect(nonUsd.fetchProduct).toHaveBeenCalledTimes(1);
  });

  it("does not favor Web Pixels over a contradictory exact variant USD offer", async () => {
    const offer = { "@type": "Product", name: "Balm Dotcom", offers: { price: 17, priceCurrency: "USD",
      url: selected.merchantUrl, availability: "https://schema.org/InStock" } };
    expect((await inspect(`<script type="application/ld+json">${JSON.stringify(offer)}</script>` + script({ productVariants: [pixel] })))
      .result.variants[0]?.itemPrice).toBeUndefined();
  });
});
