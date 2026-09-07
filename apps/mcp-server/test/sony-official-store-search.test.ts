import { describe, expect, it, vi } from "vitest";

import { createSonyOfficialDocumentFetch, createSonyOfficialSearchPort } from "../src/sony-official-store-search.js";
import { safeFetchWithProvenance } from "../../../packages/network-safety/src/safe-fetch.js";
import { resolveVerifiedOfficialStorefront } from "../src/merchant-trust.js";
import type { OfficialShopifyFetch, OfficialShopifySearchInput } from "../src/shopify-official-store-search.js";
import { classifyShopifyCandidate } from "../src/shopify-match.js";
import { createOfficialShopifySearchPort } from "../src/shopify-official-store-search.js";
import { connectReplay, searchResult } from "./fixtures/conversation-replay-support.js";

const host = "electronics.sony.com";
const path = "/audio/headphones/headband/p/";
const apiHost = "api.cqiypyix22-sonyelect1-p1-public.model-t.cc.commerce.ondemand.com";

// Minimal source-owned fields captured from Sony's public FULL response on 2026-09-06.
function option(code: string, color: string, price = 398) {
  return { code, url: path + code, priceData: { currencyIso: "USD", value: price },
    stock: { status: "instock", stockLevelStatus: "inStock" },
    variants: [{ variant: "SNAClassification/1.0/VariantType.color", value: `#212028 | ${color}` }] };
}
function detail(code = "wh1000xm6-b", color = "Black") {
  const selected = option(code, color);
  return { code, name: "WH1000XM6/B", gwModel: "WH-1000XM6", superModelName: "WH-1000XM6",
    baseProduct: "wh-1000xm6_base", canonicalUrl: path + code, url: path + code,
    summary: `<p>WH-1000XM6 Best Wireless Noise Canceling Headphones | ${color}</p>`,
    description: "Sony wireless headphones.", price: { currencyIso: "USD", value: 398 },
    stock: { status: "instock", stockLevelStatus: "inStock" }, purchasable: true, notSellable: false,
    baseOptions: [{ options: [option("wh1000xm6-l", "Midnight Blue"), option("wh1000xm6-b", "Black")], selected,
      variantType: "SNAProductVariant" }],
    images: [{ imageType: "PRIMARY", format: "zoom", url: "https://d1ncau8tqf99kp.cloudfront.net/converted/152005_original.webp" }] };
}
function input(overrides: Partial<OfficialShopifySearchInput> = {}): OfficialShopifySearchInput {
  return { seed: { ...resolveVerifiedOfficialStorefront("Sony")!, sourceHost: host, merchantId: "official-sony",
    merchant: "Sony", merchantUrl: `https://${host}/` }, query: "Sony WH-1000XM6 black", limit: 6,
    requiredColor: "black", ...overrides };
}
function source(products = [detail("wh1000xm6-l", "Midnight Blue"), detail()]) {
  return vi.fn<OfficialShopifyFetch>(async (value) => {
    const url = new URL(value);
    expect(url.hostname).toBe(apiHost);
    const data = url.pathname.endsWith("/search")
      ? { products: [{ code: "wh1000xm6-l", url: path + "wh1000xm6-l", name: "WH1000XM6/L" }] }
      : products.find(product => url.pathname.endsWith("/" + product.code));
    return { response: Response.json(data ?? {}, { status: data === undefined ? 404 : 200 }), finalUrl: value };
  });
}
const directInput = () => input({ sourcePageUrl: `https://${host}${path}wh1000xm6-b` });
const directSource = (value: unknown) => vi.fn<OfficialShopifyFetch>(async url => ({ response: Response.json(value), finalUrl: url }));

describe("Sony public official product reads", () => {
  it.each([false, true])("filters unrelated search observations before URL hydration; matching unsafe URL=%s", async matching => {
    const fetchOriginal = source();
    const fetchDocument: OfficialShopifyFetch = async (...args) => {
      if (new URL(args[0]).pathname.endsWith("/search")) return { finalUrl: args[0], response: Response.json({ products: [
        { code: "wh1000xm6-b", url: path + "wh1000xm6-b" },
        { code: matching ? "wh1000xm6-l" : "fdaep15", url: "/imaging/cameras/p/fdaep15" }
      ] }) };
      return fetchOriginal(...args);
    };
    const pending = createSonyOfficialSearchPort({ fetchDocument }).search(input());
    if (matching) await expect(pending).rejects.toThrow("SONY_PRODUCT_URL_INVALID");
    else await expect(pending).resolves.toMatchObject([{ sku: "wh1000xm6-b" }]);
  });
  it.each(["unavailable", "in-stock", "foreign", "selected", "visible"])("handles incomplete legacy sibling metadata: %s", async mode => {
    const product = detail();
    const legacy = { code: mode === "foreign" ? "wh1000xm5-ples" : mode === "selected" ? product.code : "wh1000xm6-ples",
      url: path + (mode === "foreign" ? "wh1000xm5-ples" : mode === "selected" ? product.code : "wh1000xm6-ples"),
      priceData: { currencyIso: "USD", value: 399.99 },
      stock: { status: mode === "in-stock" ? "instock" : "outofstock", hideSimilarProducts: mode !== "visible" } };
    const payload = { ...product, baseOptions: [{ ...product.baseOptions[0],
      options: [...product.baseOptions[0]!.options, legacy] }] };
    const pending = createSonyOfficialSearchPort({ fetchDocument: directSource(payload) }).search(directInput());
    if (mode === "unavailable") await expect(pending).resolves.toMatchObject([{ sku: product.code,
      itemPrice: { amountCents: 39800 }, variantDimensions: { Color: "Black" } }]);
    else await expect(pending).rejects.toThrow();
  });
  it("routes the existing official factory to Sony and returns one exact recommended official card through MCP", async () => {
    const fetchDocument = source();
    const officialShopify = createOfficialShopifySearchPort({ fetchDocument });
    const replay = await connectReplay(async () => searchResult([]), { officialShopify });
    try {
      const result = await replay.client.callTool({ name: "search_products", arguments: {
        query: "Sony WH-1000XM6", brand: "Sony", brandMode: "REQUIRED", productType: "headphones",
        requiredFeatures: ["Black"], conditionPreference: "NEW", comparisonMode: "SAME_PRODUCT",
        contextMode: "NEW_PRODUCT", allowAlternatives: false, limit: 8, responseLocale: "zh-CN"
      } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ products: [{ condition: "NEW", matchStatus: "EXACT",
        merchantUrl: `https://${host}${path}wh1000xm6-b`, presentationGroup: "OFFICIAL_STORE", itemPrice: { amountCents: 39800 } }],
        recommendation: { state: "READY" } });
      expect(result._meta?.["findcheap/searchTrace"]).toMatchObject({ officialStore: { status: "COMPLETE", productsReturned: 1 } });
    } finally { await replay.close(); }
  });
  it("reads the requested Black SKU when search returns another color; model evidence is not invented from the query", async () => {
    const fetchDocument = source();
    const [product] = await createSonyOfficialSearchPort({ fetchDocument }).search(input());
    expect(product).toMatchObject({ brand: "Sony", sku: "wh1000xm6-b", mpn: "WH-1000XM6",
      variantDimensions: { Color: "Black" }, condition: "NEW", availability: "IN_STOCK",
      merchantUrl: `https://${host}${path}wh1000xm6-b`, itemPrice: { amountCents: 39800, currency: "USD" },
      checkoutPlatform: "MERCHANT", merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT" } });
    expect(fetchDocument.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/occ/v2/sna/products/search", "/occ/v2/sna/products/wh1000xm6-l", "/occ/v2/sna/products/wh1000xm6-b"
    ]);
  });

  it("uses separately supplied source MPN for exact identity while retaining the variant SKU", async () => {
    const [product] = await createSonyOfficialSearchPort({ fetchDocument: source() }).search(input());
    expect(classifyShopifyCandidate("Sony WH-1000XM6 black", product!)).toMatchObject({ status: "EXACT" });
    expect(classifyShopifyCandidate("Sony WH-1000XM5 black", product!).status).not.toBe("EXACT");
  });

  it("does not expose an irrelevant direct product as a public match status", async () => {
    await expect(createSonyOfficialSearchPort({ fetchDocument: directSource(detail()) }).search({ ...directInput(),
      query: "dress" })).resolves.toEqual([]);
  });

  it("rejects conflicting source model evidence instead of replacing it from the request", async () => {
    const product = detail();
    product.gwModel = "WH-1000XM5";
    await expect(createSonyOfficialSearchPort({ fetchDocument: source([product]) }).search(input({
      sourcePageUrl: `https://${host}${path}wh1000xm6-b`
    }))).rejects.toThrow();
  });

  it("rejects a coherent but wrong model family even on a direct product URL", async () => {
    const product = JSON.parse(JSON.stringify(detail()).replaceAll("wh1000xm6", "wh1000xm5").replaceAll("WH1000XM6", "WH1000XM5")) as ReturnType<typeof detail>;
    product.summary = "Sony WH-1000XM5 headphones Black";
    await expect(createSonyOfficialSearchPort({ fetchDocument: directSource(product) }).search(input({
      sourcePageUrl: `https://${host}${path}wh1000xm5-b`
    }))).rejects.toThrow("SONY_MODEL_IDENTITY_INVALID");
  });

  it("does not turn source in-stock but non-purchasable into a confirmed out-of-stock observation", async () => {
    const product = detail();
    product.purchasable = false;
    const [found] = await createSonyOfficialSearchPort({ fetchDocument: source([product]) }).search(input({
      sourcePageUrl: `https://${host}${path}wh1000xm6-b`
    }));
    expect(found?.availability).toBe("UNKNOWN");
  });

  it("accepts an explicitly empty optional FULL description and skips wrong-model search hits before hydration", async () => {
    const product = detail(); product.description = "";
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async url => ({ finalUrl: url, response: Response.json(new URL(url).pathname.endsWith("/search")
      ? { products: [{ code: "wh1000xm6-b", url: path + "wh1000xm6-b" },
        { code: "wf1000xm6-b", url: path + "wf1000xm6-b" }, { code: "hac1000xm6c-b", url: path + "hac1000xm6c-b" }] }
      : new URL(url).pathname.endsWith("/wh1000xm6-b") ? product : { unrelated: true }) }));
    const found = await createSonyOfficialSearchPort({ fetchDocument }).search(input());
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ condition: "NEW", sku: "wh1000xm6-b" });
    expect(fetchDocument).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["refurbished boolean", { isRefurbished: true }, "REFURBISHED"],
    ["explicit unknown", { condition: "UNKNOWN" }, "UNKNOWN"],
    ["refurbished schema", { itemCondition: "https://schema.org/RefurbishedCondition" }, "REFURBISHED"],
    ["used label", { summary: "Used Sony WH-1000XM6 | Black" }, "USED"],
    ["damaged label", { summary: "Damaged Sony WH-1000XM6 Headphones | Black" }, "UNKNOWN"],
    ["parts label", { summary: "For Parts Sony WH-1000XM6 Headphones | Black" }, "UNKNOWN"],
    ["like-new label", { summary: "Like New Sony WH-1000XM6 Headphones | Black" }, "USED"],
    ["open box", { summary: "Sony WH-1000XM6 | Black | Open Box" }, "OPEN_BOX"],
    ["conflict", { condition: "NEW", summary: "Refurbished Sony WH-1000XM6 | Black" }, "UNKNOWN"]
  ])("honors %s before the reviewed Sony default-new policy", async (_label, change, expected) => {
    const [product] = await createSonyOfficialSearchPort({ fetchDocument: directSource({ ...detail(), ...change as object }) }).search(directInput());
    expect(product?.condition).toBe(expected);
  });

  it("rejects credential-bearing storefront seeds before reading", async () => {
    const fetchDocument = directSource(detail()); const request = directInput();
    request.seed.merchantUrl = "https://user@electronics.sony.com/";
    await expect(createSonyOfficialSearchPort({ fetchDocument }).search(request)).rejects.toThrow();
    expect(fetchDocument).not.toHaveBeenCalled();
  });

  it.each(["code", "selected", "canonical", "currency", "stock", "price", "base", "missing-summary"])("rejects invalid %s facts bound to the selected offer", async kind => {
    const product = detail();
    if (kind === "code") product.code = "wh1000xm5-b";
    if (kind === "selected") product.baseOptions[0]!.selected.code = "wh1000xm6-l";
    if (kind === "canonical") product.canonicalUrl = "https://other.example/audio/headphones/headband/p/wh1000xm6-b";
    if (kind === "currency") product.price.currencyIso = "EUR";
    if (kind === "stock") product.stock.stockLevelStatus = "outOfStock";
    if (kind === "price") product.price.value = 199;
    if (kind === "base") product.baseProduct = "wh-1000xm5_base";
    if (kind === "missing-summary") product.summary = "";
    await expect(createSonyOfficialSearchPort({ fetchDocument: directSource(product) }).search(directInput())).rejects.toThrow();
  });

  it("never replaces an explicitly linked color or invents missing model fields", async () => {
    const request = input({ sourcePageUrl: `https://${host}${path}wh1000xm6-l` });
    await expect(createSonyOfficialSearchPort({ fetchDocument: source() }).search(request)).resolves.toEqual([]);
    const { gwModel: _model, superModelName: _name, ...withoutModel } = detail();
    const [product] = await createSonyOfficialSearchPort({ fetchDocument: directSource(withoutModel) }).search(directInput());
    expect(product).not.toHaveProperty("mpn");
    expect(classifyShopifyCandidate("Sony WH-1000XM6 black", product!).status).not.toBe("EXACT");
  });

  it("rejects unavailable reads instead of returning a successful empty source", async () => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async url => ({ response: new Response("", { status: 503 }), finalUrl: url }));
    await expect(createSonyOfficialSearchPort({ fetchDocument }).search(input())).rejects.toThrow("SONY_SOURCE_UNAVAILABLE");
  });

  it("rejects oversized streamed responses", async () => {
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async url => ({ finalUrl: url,
      response: new Response(" ".repeat(512 * 1024 + 1), { headers: { "content-type": "application/json" } }) }));
    await expect(createSonyOfficialSearchPort({ fetchDocument }).search(input())).rejects.toThrow("SONY_RESPONSE_TOO_LARGE");
  });

  it("does not dispatch after pre-cancellation or accept an ignored-cancellation late provider", async () => {
    const fetchDocument = directSource(detail());
    await expect(createSonyOfficialSearchPort({ fetchDocument }).search(input({ signal: AbortSignal.abort() }))).rejects.toThrow();
    expect(fetchDocument).not.toHaveBeenCalled();
    const controller = new AbortController();
    let finish!: (value: Awaited<ReturnType<OfficialShopifyFetch>>) => void;
    const late = vi.fn<OfficialShopifyFetch>(() => new Promise(resolve => { finish = resolve; }));
    const pending = createSonyOfficialSearchPort({ fetchDocument: late }).search(input({ signal: controller.signal }));
    controller.abort();
    finish({ response: Response.json({ products: [{ code: "wh1000xm6-b", url: path + "wh1000xm6-b" }] }), finalUrl: late.mock.calls[0]![0] });
    await expect(pending).rejects.toThrow();
    expect(late).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("bounds source calls, concurrency and total bytes (oversized batch: %s)", async oversized => {
    const products = [1, 2, 3].flatMap(model => [detail(`wh1000xm6-l`, "Midnight Blue"), detail()].map(product =>
      JSON.parse(JSON.stringify(product).replaceAll("1000xm6", `1000xm${model}`).replaceAll("1000XM6", `1000XM${model}`)) as ReturnType<typeof detail>));
    let active = 0; let peak = 0;
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async url => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      const data = new URL(url).pathname.endsWith("/search") ? { products: products.filter(p => p.code.endsWith("-l")) }
        : products.find(p => new URL(url).pathname.endsWith("/" + p.code));
      return { response: Response.json({ ...data, ...(oversized ? { padding: "x".repeat(400_000) } : {}) }), finalUrl: url };
    });
    const pending = createSonyOfficialSearchPort({ fetchDocument }).search(input({ query: "headphones", limit: 12 }));
    if (oversized) await expect(pending).rejects.toThrow("SONY_READ_BUDGET_EXHAUSTED");
    else await expect(pending).resolves.toHaveLength(3);
    expect(fetchDocument.mock.calls.length).toBeLessThanOrEqual(7);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it.each(["direct", "factory", "native"])("stops streaming at the aggregate limit and cancels sibling reads through %s", async route => {
    const products = [1, 2, 3].flatMap(model => [detail("wh1000xm6-l", "Midnight Blue"), detail()].map(product =>
      JSON.parse(JSON.stringify(product).replaceAll("1000xm6", `1000xm${model}`).replaceAll("1000XM6", `1000XM${model}`)) as ReturnType<typeof detail>));
    let delivered = 0; let cancelled = 0;
    const signals: Array<AbortSignal | undefined> = [];
    const fetchDocument = vi.fn<OfficialShopifyFetch>(async (url, _host, signal) => {
      signals.push(signal);
      const data = new URL(url).pathname.endsWith("/search") ? { products: products.filter(p => p.code.endsWith("-l")) }
        : { ...products.find(p => new URL(url).pathname.endsWith("/" + p.code)), padding: "x".repeat(499_000) };
      const bytes = Buffer.from(JSON.stringify(data)); let offset = 0;
      return { finalUrl: url, response: new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset === bytes.byteLength) { controller.close(); return; }
          const chunk = bytes.subarray(offset, Math.min(bytes.byteLength, offset + 4096));
          offset += chunk.byteLength; delivered += chunk.byteLength; controller.enqueue(chunk);
        }, cancel() { cancelled++; }
      }, { highWaterMark: 0 }), { headers: { "content-type": "application/json" } }) };
    });
    const nativeFetch = () => createSonyOfficialDocumentFetch((request, policy) => safeFetchWithProvenance(request, { ...policy,
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async (url, init) => (await fetchDocument(url.href, apiHost, init.signal ?? undefined)).response }));
    const port = route === "native" ? createSonyOfficialSearchPort({ fetchDocument: nativeFetch() })
      : route === "direct" ? createSonyOfficialSearchPort({ fetchDocument }) : createOfficialShopifySearchPort({ fetchDocument });
    await expect(port.search(input({ query: "headphones", limit: 12 }))).rejects.toThrow("SONY_READ_BUDGET_EXHAUSTED");
    // At most one already-delivered chunk per concurrent reader can cross the processed-byte cap.
    expect(delivered).toBeLessThanOrEqual(2 * 1024 * 1024 + 8192);
    expect(cancelled).toBeGreaterThan(0);
    expect(signals.every(signal => signal?.aborted === true)).toBe(true);
    const callsAtFailure = fetchDocument.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetchDocument).toHaveBeenCalledTimes(callsAtFailure);
  });

  it("reuses scoped documents without double-counting global network requests or bytes", async () => {
    const fetchDocument = source(); const port = createOfficialShopifySearchPort({ fetchDocument });
    const deltas: Array<{ requests?: number; bytes?: number; cacheHits?: number }> = [];
    const request = input({ cacheScope: {}, onRead: delta => deltas.push(delta) });
    expect(await port.search(request)).toHaveLength(1);
    const bytes = deltas.reduce((sum, delta) => sum + (delta.bytes ?? 0), 0);
    expect(bytes).toBe(3149);
    expect(await port.search(request)).toHaveLength(1);
    expect(fetchDocument).toHaveBeenCalledTimes(3);
    expect(deltas.reduce((sum, delta) => sum + (delta.bytes ?? 0), 0)).toBe(bytes);
    expect(deltas.reduce((sum, delta) => sum + (delta.requests ?? 0), 0)).toBe(3);
    expect(deltas.reduce((sum, delta) => sum + (delta.cacheHits ?? 0), 0)).toBe(3);
  });

  it("enforces the fixed-host policy, private-IP rejection, one HTTP hop and 512KiB through real safeFetch", async () => {
    const url = `https://${apiHost}/occ/v2/sna/products/wh1000xm6-b?fields=FULL&lang=en&curr=USD`;
    const requestHttp = vi.fn(async () => Response.json(detail()));
    const transport = createSonyOfficialDocumentFetch((request, policy) => safeFetchWithProvenance(request, { ...policy,
      resolve: async () => [{ address: "93.184.216.34", family: 4 }], request: requestHttp }));
    const observed: Array<{ requests?: number; bytes?: number }> = [];
    const found = await transport(url, apiHost, undefined, delta => observed.push(delta));
    expect(await found.response.json()).toMatchObject({ code: "wh1000xm6-b" });
    expect(observed.reduce((sum, delta) => sum + (delta.requests ?? 0), 0)).toBe(1);
    expect(observed.reduce((sum, delta) => sum + (delta.bytes ?? 0), 0)).toBeGreaterThan(0);
    requestHttp.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "/occ/v2/sna/products/wh1000xm6-l" } }));
    requestHttp.mockClear();
    await expect(transport(url, apiHost)).rejects.toThrow();
    expect(requestHttp).toHaveBeenCalledTimes(1);
    requestHttp.mockImplementation(async () => new Response("x".repeat(512 * 1024 + 1)));
    await expect(transport(url, apiHost)).rejects.toThrow();
    const privateTransport = createSonyOfficialDocumentFetch((request, policy) => safeFetchWithProvenance(request, { ...policy,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }], request: requestHttp }));
    requestHttp.mockClear();
    await expect(privateTransport(url, apiHost)).rejects.toThrow();
    await expect(transport(url.replace("/products/", "/orders/"), apiHost)).rejects.toThrow();
    await expect(transport(url.replace(apiHost, "other.example"), "other.example")).rejects.toThrow();
    expect(requestHttp).not.toHaveBeenCalled();
  });
});
