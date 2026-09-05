import { describe, expect, it, vi } from "vitest";
import { SearchProductsInputSchema, searchProducts } from "../src/search-products.js";
import { searchDiagnostics } from "../src/search-diagnostics.js";
import { createOfficialShopifySearchPort, parseOfficialStructuredProduct } from "../src/shopify-official-store-search.js";
import { createShopifySelectedProductInspector } from "../src/shopify-selected-product.js";
import { evaluateProductRequirements } from "../src/product-requirements.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";
import type { ProductCardContent } from "../src/server.js";
import type { OfficialShopifySearchPort } from "../src/shopify-official-store-search.js";

const awin = { search: async () => ({ source: "AWIN_PRODUCT_FEED" as const, coverage: "COMPLETE" as const,
  snapshotAt: "2026-09-05T00:00:00.000Z", products: [],
  diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 } }) };
const target = "https://ishowbeauty.com/products/fixture-shoe";
const offer = (id: string, price = 325) => ({ "@type": "Offer", price, priceCurrency: "USD",
  availability: "https://schema.org/InStock", url: `${target}?variant=${id}` });
const html = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

describe("text search reliability", () => {
  it.each([false, true])("reads exact variant USD offers from Product JSON-LD (graph: %s)", graph => {
    const data = { "@type": "Product", name: "Ballet flats", offers: [offer("1005"), offer("1007", 340)] };
    const parsed = parseOfficialStructuredProduct(html(graph ? { "@graph": [data] } : data), "ishowbeauty.com", "fixture-shoe");
    expect(parsed.variants.map(v => [v.variantId, v.amountCents])).toEqual([["1005", 32500], ["1007", 34000]]);
  });

  it.each([
    { ...offer("1007"), url: target },
    { ...offer("1007"), url: `${target}?variant=1007&variant=1008` },
    { ...offer("1007"), url: "https://another.example/products/fixture-shoe?variant=1007" },
    { ...offer("1007"), url: "https://ishowbeauty.com/products/different-shoe?variant=1007" },
    { ...offer("1007"), priceCurrency: "AUD" },
    { "@type": "AggregateOffer", lowPrice: 10, highPrice: 340, priceCurrency: "USD", url: target }
  ])("does not turn unrelated or aggregate prices into a selected variant quote: %j", unsafe => {
    expect(() => parseOfficialStructuredProduct(html({ "@type": "Product", name: "Ballet flats", offers: unsafe }),
      "ishowbeauty.com", "fixture-shoe")).toThrow();
  });

  it("keeps the selected US 7 price from its own offer, not the first or old variant", async () => {
    const selected = product({ handle: "1005", title: "Ballet flats", productType: "ballet flats", checkoutPlatform: "SHOPIFY",
      merchantUrl: `${target}?variant=1005`, variantDimensions: { Size: "US 5" } });
    const json = { handle: "fixture-shoe", title: "Ballet flats", options: [{ name: "Size", position: 1, values: ["US 5", "US 7"] }],
      variants: [5, 7].map(size => ({ id: `100${size}`, title: `US ${size}`, options: [`US ${size}`], price: 1, available: true })) };
    const inspector = createShopifySelectedProductInspector({ fetchProduct: async url => ({ finalUrl: url,
      response: new Response(url.endsWith(".js") ? JSON.stringify(json)
        : html({ "@type": "Product", name: "Ballet flats", offers: [offer("1005", 10), offer("1007", 340)] })) }) });
    const result = await inspector.inspect(selected, {}, { requirements: { requiredFeatures: ["US 7"], requiredSize: "US 7" } });
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]).toMatchObject({ handle: "1007", itemPrice: { amountCents: 34000, currency: "USD" }, variantDimensions: { Size: "US 7" } });
  });

  it.each([false, true])("applies the requested color and size before choosing the official variant (JSON-LD: %s)", async structured => {
    const base = "https://skims.com/products/soft-lounge-long-slip-dress";
    const json = { title: "Soft Lounge Long Slip Dress", handle: "soft-lounge-long-slip-dress", vendor: "SKIMS",
      options: [{ name: "Color", position: 1, values: ["Black", "Heather Grey"] }, { name: "Size", position: 2, values: ["XS", "M"] }],
      variants: [{ id: 1001, title: "Black XS", options: ["Black", "XS"], available: true, price: 8800 },
        { id: 1002, title: "Heather Grey M", options: ["Heather Grey", "M"], available: true, price: 6100 }] };
    const group = { "@type": "ProductGroup", name: json.title, hasVariant: json.variants.map(v => ({ name: v.title,
      color: v.options[0], size: v.options[1], offers: { ...offer(String(v.id)), price: v.price / 100, url: `${base}?variant=${v.id}` } })) };
    const port = createOfficialShopifySearchPort({ fetchDocument: async url => ({ finalUrl: url,
      response: structured ? new Response(url.endsWith(".js") ? "missing" : html(group), { status: url.endsWith(".js") ? 404 : 200 })
        : new Response(JSON.stringify(json)) }) });
    const result = await port.search({ seed: { merchantId: "official-skims.com", merchant: "SKIMS", brand: "SKIMS",
      sourceHost: "skims.com", merchantUrl: "https://skims.com" }, query: json.title, limit: 2, sourcePageUrl: base,
      requiredColor: "Heather Gray", requiredSize: "M" });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ handle: "1002", variantDimensions: { Color: "Heather Grey", Size: "M" }, itemPrice: { amountCents: 6100 } });
  });

  it("accepts an inclusive price ceiling but does not accept missing or foreign-currency prices", () => {
    const requirements = { requiredFeatures: [], excludedFeatures: [], preferences: [], maxItemPriceCents: 3000 };
    for (const [amountCents, currency, expected] of [[3000, "USD", "SATISFIED"], [3001, "USD", "CONFLICT"], [2900, "AUD", "NEEDS_VERIFICATION"]] as const) {
      expect(evaluateProductRequirements({ title: "Wig", itemPrice: { amountCents, currency } }, requirements).assessment.status).toBe(expected);
    }
  });

  it("treats missing price under an explicit ceiling as unverified and replenishes", async () => {
    const { itemPrice: _price, ...unpriced } = product();
    const search = vi.fn(async () => searchResult([unpriced]));
    const execution = await searchProducts(SearchProductsInputSchema.parse({ query: "wig", limit: 1, maxItemPriceCents: 3000 }),
      { awin, shopify: { search } });
    expect(execution.searchPasses).toBe(2);
    expect(execution.candidates[0]).toMatchObject({ presentationGroup: "RESEARCH_ONLY", requirementAssessment: { status: "NEEDS_VERIFICATION" } });
    expect(searchDiagnostics(execution, "MATCH_FOUND").requirementFunnel).toMatchObject({ satisfiedReturned: 0, awaitingVerification: 1 });
  });

  it("does not stop after unverified merchants fill every slot", async () => {
    const untrusted = product({ merchantTrust: { level: "UNKNOWN", verification: "UNVERIFIED", evidence: [] } });
    const search = vi.fn(async () => searchResult([untrusted]));
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "wig", limit: 1 }), { awin, shopify: { search } });
    expect(result.searchPasses).toBe(2);
    expect(result.candidates[0]?.shopifyProduct?.merchantTrust.verification).toBe("UNVERIFIED");
  });

  it("passes color to official retrieval and keeps the full product name in fallback", async () => {
    const search = vi.fn<OfficialShopifySearchPort["search"]>(async () => []);
    await searchProducts(SearchProductsInputSchema.parse({ query: "Soft Lounge Long Slip Dress", brand: "SKIMS", productType: "dress",
      comparisonMode: "SAME_PRODUCT", requiredFeatures: ["Heather Grey"] }),
      { awin, shopify: { search: async () => searchResult([]) }, officialShopify: { search } });
    expect(search.mock.calls.map(([input]) => input.query)).toEqual(["Soft Lounge Long Slip Dress Heather Grey", "Soft Lounge Long Slip Dress"]);
    expect(search.mock.calls.every(([input]) => input.requiredColor === "Heather Grey")).toBe(true);
  });

  it("checks compound and Chinese color constraints against the selected variant", () => {
    for (const required of ["Heather Grey", "灰色"]) {
      const result = evaluateProductRequirements({ title: "Dress in Heather Grey and Black", variantDimensions: { Color: "Black" } },
        { requiredFeatures: [required], excludedFeatures: [], preferences: [] });
      expect(result.assessment).toMatchObject({ status: "CONFLICT", entries: [{ source: "VARIANT", status: "CONTRADICTED" }] });
    }
  });

  it.each(["zh-CN", "en-US"] as const)("does not ask stale catalog questions after official recovery: %s", async locale => {
    const dress = product({ title: "Soft Lounge Long Slip Dress", productType: "dress", brand: "SKIMS", merchant: "SKIMS",
      merchantId: "official-skims.com", sourceHost: "skims.com", merchantUrl: "https://skims.com/products/soft-lounge-long-slip-dress",
      merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT", evidence: ["reviewed domain"] } });
    const officialSearch = vi.fn(async () => [dress]);
    const replay = await connectReplay(async () => ({ ...searchResult([]), questions: ["Only similar products were found. Provide an exact model."] }),
      { awin, officialShopify: { search: officialSearch } });
    try {
      const result = (await replay.client.callTool({ name: "search_products", arguments: { query: "Soft Lounge Long Slip Dress",
        brand: "SKIMS", productType: "dress", comparisonMode: "SAME_PRODUCT", responseLocale: locale } })).structuredContent as ProductCardContent;
      expect(result.recommendation?.state).toBe("READY");
      expect(result.questions).toEqual([]);
      expect(officialSearch).toHaveBeenCalledOnce();
    } finally { await replay.close(); }
  });
});
