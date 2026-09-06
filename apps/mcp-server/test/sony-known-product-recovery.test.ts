import { describe, expect, it, vi } from "vitest";
import { createShopifyGlobalCatalogPort } from "../src/shopify-global-catalog-client.js";
import { createShopifySelectedProductInspector } from "../src/shopify-selected-product.js";
import { SearchProductsInputSchema, searchProducts } from "../src/search-products.js";
import { connectReplay } from "./fixtures/conversation-replay-support.js";
import { SearchRun } from "../src/search-run.js";

// Synthetic contract fixtures following the observed Catalog shape, not live
// merchant stock, price or authorization evidence. No business gates are mocked.
const profile = "https://agent.example/profile.json";
const title = "Sony WH-1000XM6 Wireless Noise-Canceling Headphones";
const request = { query: "Sony WH-1000XM6", brand: "Sony", brandMode: "REQUIRED", productType: "headphones",
  requiredFeatures: ["Black"], conditionPreference: "NEW", comparisonMode: "SAME_PRODUCT",
  contextMode: "NEW_PRODUCT", allowAlternatives: false, selectionMode: "MERCHANT_DIVERSE", limit: 8, responseLocale: "zh-CN" };
const awin = { search: async () => ({ source: "AWIN_PRODUCT_FEED" as const, coverage: "COMPLETE" as const,
  snapshotAt: new Date().toISOString(), products: [],
  diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 } }) };

function ports(options: { vendor?: string; host?: string; condition?: string; color?: string; model?: string;
  count?: number; failure?: boolean; noSku?: boolean; usedSibling?: boolean } = {}) {
  const host = options.host ?? "bhphotovideo.com";
  const items = Array.from({ length: options.count ?? 1 }, (_, index) => {
    const handle = `fixture-sony-${index}`;
    const id = String(1000 + index);
    const productTitle = options.model === undefined ? title : title.replace("WH-1000XM6", options.model);
    return { handle, id, productTitle, url: `https://${host}/products/${handle}?variant=${id}` };
  });
  const catalog = createShopifyGlobalCatalogPort({ SHOPIFY_AGENT_PROFILE_URL: profile }, {
    fetch: async () => Response.json({ jsonrpc: "2.0", id: 1, result: { structuredContent: {
      ucp: { status: "success", version: "2026-04-08" }, products: items.map(item => ({
        id: `gid://shopify/p/${item.id}`, title: item.productTitle,
        variants: [{ id: `gid://shopify/ProductVariant/${item.id}`, title: item.productTitle, url: item.url,
          price: { amount: 39999, currency: "USD" }, availability: { available: true }, condition: [options.condition ?? "new"],
          options: [{ name: "Color", label: options.color ?? "Black" }],
          seller: { id: "gid://shopify/Shop/123", name: "Fixture Retailer", url: `https://${host}` } }]
      }))
    } } })
  });
  const fetchProduct = vi.fn(async (url: string) => {
    if (options.failure) throw new Error("FIXTURE_UNAVAILABLE");
    const item = items.find(item => url === `https://${host}/products/${item.handle}.js`);
    if (!item) throw new Error("UNEXPECTED_FIXTURE_REQUEST");
    return { finalUrl: url, response: Response.json({ handle: item.handle, title: item.productTitle,
      ...(options.vendor === "MISSING" ? {} : { vendor: options.vendor ?? "Sony" }), currency: "USD",
      options: [{ name: "Color", position: 1, values: [options.color ?? "Black"] }],
      variants: [...(options.usedSibling ? [{ id: "9999", title: "Black / Used", options: ["Black"],
        sku: "WH-1000XM6", available: true, price: 19999 }] : []),
        { id: item.id, title: options.color ?? "Black", options: [options.color ?? "Black"],
        ...(options.noSku ? {} : { sku: options.model ?? "WH-1000XM6" }), available: true, price: 39999 }]
    }) };
  });
  return { awin, shopify: catalog, selectedProducts: createShopifySelectedProductInspector({ fetchProduct }), fetchProduct };
}

describe("Sony known-product acceptance regression", () => {
  it("completes missing brand evidence even when black/new already match", async () => {
    const source = ports();
    const result = await searchProducts(SearchProductsInputSchema.parse(request), source);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ identityStatus: "EXACT", presentationGroup: "TRUSTED_MATCH",
      shopifyProduct: { brand: "Sony", condition: "NEW", variantDimensions: { Color: "Black" },
        itemPrice: { amountCents: 39999, currency: "USD" } } });
    expect(result.brandProductsExcluded).toBe(0);
    expect(source.fetchProduct).toHaveBeenCalledOnce();
  });

  it.each([{ vendor: "MISSING" }, { vendor: "Other Brand" }, { condition: "refurbished" },
    { condition: "unknown" }, { color: "Silver" }, { model: "WH-1000XM5" }, { failure: true }])(
    "does not weaken the original request on incomplete or conflicting evidence: %j", async options => {
      const result = await searchProducts(SearchProductsInputSchema.parse(request), ports(options));
      expect(result.candidates).toHaveLength(0);
    });

  it("does not promote an unknown merchant after recovering brand", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse(request), ports({ host: "unknown-audio.example" }));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ presentationGroup: "RESEARCH_ONLY",
      shopifyProduct: { brand: "Sony", merchantTrust: { verification: "UNVERIFIED" } } });
    expect(result.candidateFunnel?.recommendableUnique).toBe(0);
  });

  it("does not convert title-only identity into an exact match", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse(request), ports({ noSku: true }));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.identityStatus).toBe("DISCOVERY_MATCH");
  });

  it("keeps brand-only inspection on the original new variant, not a cheaper used sibling", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse(request), ports({ usedSibling: true }));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.shopifyProduct).toMatchObject({ handle: "1000", condition: "NEW",
      itemPrice: { amountCents: 39999 } });
  });

  it("caps inspection at four distinct products and never repeats it on continuation", async () => {
    const source = ports({ count: 6 });
    const input = { ...SearchProductsInputSchema.parse(request), searchRun: new SearchRun() };
    const result = await searchProducts(input, source);
    await searchProducts(input, source);
    expect(source.fetchProduct).toHaveBeenCalledTimes(4);
    expect(result.searchRun?.diagnostics().variantRequests).toBe(4);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it("returns a real card through the public MCP seam without requesting web consent", async () => {
    const source = ports();
    const consent = vi.fn(async () => ({ action: "decline" as const }));
    const replay = await connectReplay(source.shopify.search, { awin, selectedProducts: source.selectedProducts }, consent);
    try {
      const result = await replay.client.callTool({ name: "search_products", arguments: request });
      expect(result.structuredContent).toMatchObject({ products: [expect.objectContaining({ brand: "Sony" })],
        recommendation: { state: "READY" } });
      expect(consent).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("rejects late brand evidence after cancellation and cannot restart the same flow", async () => {
    const source = ports();
    const original = source.fetchProduct.getMockImplementation()!;
    let notifyStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { notifyStarted = resolve; });
    const delayed = new Promise<void>(resolve => { release = resolve; });
    source.fetchProduct.mockImplementationOnce(async url => {
      notifyStarted(); await delayed; return original(url);
    });
    const controller = new AbortController();
    const searchRun = new SearchRun();
    const input = { ...SearchProductsInputSchema.parse(request), searchRun };
    const pending = searchRun.withRequestSignal(controller.signal, () => searchProducts(input, source));
    const rejected = expect(pending).rejects.toThrow("SEARCH_CANCELLED");
    await started;
    controller.abort(); release();
    await rejected;
    await expect(searchRun.withRequestSignal(new AbortController().signal, () => searchProducts(input, source)))
      .rejects.toThrow("SEARCH_CANCELLED");
    expect(source.fetchProduct).toHaveBeenCalledOnce();
  });
});
