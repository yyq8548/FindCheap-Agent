import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { createShoppingServer, type ProductCardContent } from "../src/server.js";
import { parseWebProductDocument } from "../src/generic-official-store-search.js";
import { SearchProductsInputSchema, evaluateRecoveredProducts } from "../src/search-products.js";
import { textSearchRecovery } from "../src/text-search-recovery.js";
import { WEB_SEARCH_LIMITS, WebRecoverySessions, readWebCandidates, webProductUrl, createWebProductPagePort } from "../src/web-product-recovery.js";
import { safeFetchWithProvenance } from "../../../packages/network-safety/src/safe-fetch.js";
import { product, searchResult } from "./fixtures/conversation-replay-support.js";

const url = "https://example-retailer.com/products/shampoo";
const request = SearchProductsInputSchema.parse({ query: "shampoo", productType: "shampoo", responseLocale: "zh-CN",
  requiredFeatures: ["suitable for oily scalp", "anti-dandruff"] });
const webProduct = () => product({ sourceKind: "WEB_PRODUCT_PAGE", sourceHost: "example-retailer.com", merchantUrl: url,
  title: "Anti-dandruff shampoo", productType: "shampoo", description: "For oily scalp.",
  merchantTrust: { level: "UNKNOWN", verification: "UNVERIFIED", evidence: [] }, recommendationTier: "GENERAL_UNVERIFIED" });
const offer = { price: "12.50", priceCurrency: "USD", availability: "https://schema.org/InStock", url };
const document = (overrides: Record<string, unknown> = {}) => `<script type="application/ld+json">${JSON.stringify({
  "@type": "Product", name: "Anti-dandruff shampoo", description: "For oily scalp.", url, offers: offer, ...overrides
})}</script>`;

describe("bounded web recovery safety", () => {
  it.each(["http://example.com/products/a", "https://127.0.0.1/products/a", "https://user:secret@example.com/products/a",
    "https://example.com/checkout", "https://example.com/collections/shampoo", "https://google.com/search?q=shampoo",
    "https://example.com/products/a?token=private", "https://example.com/products/a?color=red&color=blue",
    "https://example.com/products/%252e%252e/checkout", "https://example.com/products/a#secret"])("rejects unsafe URL %s", value => {
    expect(() => webProductUrl(value)).toThrow();
  });
  it("extracts same-page facts without granting trust", () => {
    expect(parseWebProductDocument(document(), url, new Date())).toMatchObject({ sourceKind: "WEB_PRODUCT_PAGE",
      itemPrice: { amountCents: 1250, currency: "USD" }, merchantTrust: { level: "UNKNOWN", verification: "UNVERIFIED" } });
  });
  it.each([{ url: "https://example-retailer.com/products/other" }, { offers: { ...offer, priceCurrency: "EUR" } },
    { offers: [offer, { ...offer, price: "1.00" }] }, { offers: { ...offer, url: "https://other.com/products/a" } }])("rejects ambiguous offer %j", overrides => {
    expect(() => parseWebProductDocument(document(overrides), url, new Date())).toThrow();
  });
  it("rejects a mismatching canonical and unproven variant size", () => {
    expect(() => parseWebProductDocument(`<link rel="canonical" href="/products/other">${document()}`, url, new Date())).toThrow();
    expect(() => parseWebProductDocument(document(), url, new Date(), "M")).toThrow();
  });
  it("binds a selected variant offer even when the canonical identifies its base PDP", () => {
    const selected = `${url}?variant=42`;
    const html = `<link rel="canonical" href="${url}">${document({ offers: [
      { ...offer, url: `${url}?variant=1`, price: "1.00" }, { ...offer, url: selected, price: "14.00" }
    ] })}`;
    expect(parseWebProductDocument(html, selected, new Date())).toMatchObject({ merchantUrl: selected, itemPrice: { amountCents: 1400 } });
    expect(() => parseWebProductDocument(html, `${url}?variant=2`, new Date())).toThrow();
  });
  it("accepts a single same-page Product with canonical binding but no redundant Product.url", () => {
    expect(parseWebProductDocument(`<link rel="canonical" href="${url}">${document({ url: undefined })}`, url, new Date())).toMatchObject({ itemPrice: { amountCents: 1250 } });
    expect(() => parseWebProductDocument(document({ url: undefined }), url, new Date())).toThrow();
  });
  it("rejects competing Product blocks instead of selecting an arbitrary price", () => {
    expect(() => parseWebProductDocument(document() + document({ offers: { ...offer, price: "1.00" } }), url, new Date())).toThrow();
  });
  it("performs bounded safe HTTP reads and never follows redirects", async () => {
    const requestHttp = vi.fn(async () => new Response(document(), { headers: { "content-type": "text/html" } }));
    const port = createWebProductPagePort((input, policy) => safeFetchWithProvenance(input, { ...policy,
      resolve: async () => [{ address: "93.184.216.34", family: 4 }], request: requestHttp }));
    expect(await port.read(url, request, new AbortController().signal)).toMatchObject({ itemPrice: { amountCents: 1250 } });
    requestHttp.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "/products/other" } }));
    requestHttp.mockClear();
    await expect(port.read(url, request, new AbortController().signal)).rejects.toThrow();
    expect(requestHttp).toHaveBeenCalledTimes(1);
    requestHttp.mockImplementation(async () => new Response("x".repeat(1024 * 1024 + 1), { headers: { "content-type": "text/html" } }));
    await expect(port.read(url, request, new AbortController().signal)).rejects.toThrow();
    const privatePort = createWebProductPagePort((input, policy) => safeFetchWithProvenance(input, { ...policy,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }], request: requestHttp }));
    requestHttp.mockClear();
    await expect(privatePort.read(url, request, new AbortController().signal)).rejects.toThrow();
    expect(requestHttp).not.toHaveBeenCalled();
  });
  it("requires consent, binds tokens, consumes once, and expires without renewal", async () => {
    let time = 1;
    const sessions = new WebRecoverySessions(() => time);
    expect(await sessions.begin("denied", async () => false)).toBeUndefined();
    const approve = vi.fn(async () => true);
    expect(await sessions.begin("denied", approve)).toBeUndefined();
    expect(approve).not.toHaveBeenCalled();
    const lease = (await sessions.begin("accepted", approve))!;
    expect(sessions.consume("other", lease.token)).toBeUndefined();
    expect(sessions.consume("accepted", "invented")).toBeUndefined();
    expect(sessions.consume("accepted", lease.token)).toBe(WEB_SEARCH_LIMITS.durationMs);
    expect(sessions.consume("accepted", lease.token)).toBeUndefined();
    const expired = (await sessions.begin("expired", approve))!;
    time += 60_001;
    expect(sessions.consume("expired", expired.token)).toBeUndefined();
    expect(await sessions.begin("expired", approve)).toBeUndefined();
  });
  it("does not allow concurrent approval races", async () => {
    const sessions = new WebRecoverySessions();
    let accept!: (value: boolean) => void;
    const pending = sessions.begin("parent", () => new Promise(resolve => { accept = resolve; }));
    expect(await sessions.begin("parent", async () => true)).toBeUndefined();
    accept(true); expect(await pending).toBeDefined();
  });
  it("limits pages, deduplicates merchants and bounds an adapter ignoring abort", async () => {
    const read = vi.fn(async () => webProduct());
    const result = await readWebCandidates([url, url], request, { read }, 1000);
    expect(result).toMatchObject({ rejected: 1, unavailable: 0 }); expect(read).toHaveBeenCalledTimes(1);
    await expect(readWebCandidates(Array(6).fill(url), request, { read }, 1000)).rejects.toThrow("WEB_PAGE_LIMIT");
    const start = Date.now();
    expect(await readWebCandidates([url], request, { read: () => new Promise(() => {}) }, 10)).toMatchObject({ products: [], unavailable: 1 });
    expect(Date.now() - start).toBeLessThan(500);
  });
  it("keeps exact constraints and distinguishes unverified merchant from no fit", () => {
    const execution = evaluateRecoveredProducts(request, [webProduct()], false);
    expect(execution.candidates).toHaveLength(1);
    expect(textSearchRecovery(execution)).toMatchObject({ action: "VERIFY_MERCHANT", qualified: 1, recommendable: 0 });
    expect(evaluateRecoveredProducts(request, [{ ...webProduct(), title: "Running shoes", productType: "shoes" }], false).candidates).toHaveLength(0);
    expect(evaluateRecoveredProducts(request, [{ ...webProduct(), description: "Not suitable for oily scalp." }], false).candidates).toHaveLength(0);
    expect(evaluateRecoveredProducts({ ...request, brand: "Required", brandMode: "REQUIRED" }, [webProduct()], false).candidates).toHaveLength(0);
    expect(evaluateRecoveredProducts({ ...request, maxItemPriceCents: 1 }, [webProduct()], false).candidates).toHaveLength(0);
    expect(evaluateRecoveredProducts({ ...request, conditionPreference: "NEW" }, [{ ...webProduct(), condition: "UNKNOWN" }], false).candidates).toHaveLength(0);
    expect(evaluateRecoveredProducts(request, [{ ...webProduct(), merchantTrust: { level: "RISKY", verification: "INDEPENDENT", evidence: [] } }], false).candidates).toHaveLength(0);
    expect(textSearchRecovery(evaluateRecoveredProducts(request, [], true))).toMatchObject({ action: "REPORT_INCOMPLETE" });
  });
});

async function connect(consent: boolean | undefined) {
  const read = vi.fn(async (value: string) => ({ ...webProduct(), sourceHost: new URL(value).hostname,
    merchantUrl: value, merchantId: `web-${new URL(value).hostname}`, merchant: new URL(value).hostname }));
  const search = vi.fn(async () => searchResult([product({ title: "Daily shampoo", productType: "shampoo", description: "Gentle cleansing." })]));
  const server = createShoppingServer({ search }, undefined, { webProducts: { read }, awin: { search: async () => ({
    source: "AWIN_PRODUCT_FEED", coverage: "COMPLETE", snapshotAt: new Date().toISOString(), products: [],
    diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 } }) } });
  const client = new Client({ name: "web-recovery-test", version: "1" }, { capabilities: consent === undefined ? {} : { elicitation: { form: {} } } });
  const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: consent === true } }));
  if (consent !== undefined) client.setRequestHandler(ElicitRequestSchema, approve);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  const initial = await client.callTool({ name: "search_products", arguments: request });
  return { client, read, search, approve, parent: initial.structuredContent as ProductCardContent,
    close: async () => { await client.close(); await server.close(); } };
}

describe("MCP recovery contract", () => {
  it("compares recovered products from the same new snapshot and rejects mixed IDs", async () => {
    const replay = await connect(true);
    try {
      const begin = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: replay.parent.renderId } });
      const result = await replay.client.callTool({ name: "complete_web_search", arguments: { renderId: replay.parent.renderId,
        webSessionId: (begin.structuredContent as { webSessionId: string }).webSessionId,
        urls: [url, "https://another-retailer.com/products/shampoo"] } });
      const content = result.structuredContent as ProductCardContent;
      expect(content.products).toHaveLength(2);
      const selected = content.products.map(product => product.selectionId);
      const comparison = await replay.client.callTool({ name: "compare_selected_products", arguments: {
        renderId: content.renderId, selectionIds: selected, responseLocale: "zh-CN" } });
      expect(comparison.isError).not.toBe(true);
      expect(JSON.stringify(comparison.structuredContent)).toContain("MERCHANT_CHECKOUT_ONLY");
      const mixed = await replay.client.callTool({ name: "compare_selected_products", arguments: {
        renderId: content.renderId, selectionIds: [selected[0], replay.parent.products[0]!.selectionId] } });
      expect(mixed.structuredContent).toMatchObject({ status: "CROSS_SNAPSHOT_UNSUPPORTED", entries: [] });
    } finally { await replay.close(); }
  });
  it.each([false, undefined])("fails closed without real host approval: %s", async consent => {
    const replay = await connect(consent);
    try {
      const result = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: replay.parent.renderId } });
      expect(result.structuredContent).toMatchObject({ status: consent === undefined ? "PERMISSION_UNAVAILABLE" : "NOT_AUTHORIZED" });
      expect(replay.read).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });
  it("round-trips URLs into new native cards while preserving old references", async () => {
    const replay = await connect(true);
    try {
      const begin = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: replay.parent.renderId } });
      expect(begin.isError).not.toBe(true); expect(begin.structuredContent).toMatchObject({ status: "READY" });
      const args = { renderId: replay.parent.renderId, webSessionId: (begin.structuredContent as { webSessionId: string }).webSessionId, urls: [url] };
      const forged = await replay.client.callTool({ name: "complete_web_search", arguments: { ...args, itemPrice: 1, trusted: true } });
      expect(forged.isError).toBe(true); expect(replay.read).not.toHaveBeenCalled();
      const before = replay.search.mock.calls.length;
      const result = await replay.client.callTool({ name: "complete_web_search", arguments: args });
      expect(result.isError).not.toBe(true);
      const content = result.structuredContent as ProductCardContent;
      expect(content).toMatchObject({ sources: { awin: "SKIPPED", shopify: "SKIPPED", web: "COMPLETE" },
        requirementsSummary: { requiredFeatures: request.requiredFeatures }, recovery: { action: "VERIFY_MERCHANT", qualified: 1 } });
      expect(content.renderId).not.toBe(replay.parent.renderId);
      expect(content.products[0]).toMatchObject({ sourceKind: "WEB_PRODUCT_PAGE", itemPrice: { amountCents: 3641 },
        quoteCapability: "MERCHANT_CHECKOUT_ONLY", selectionId: expect.any(String) });
      expect(replay.search.mock.calls.length).toBe(before);
      expect((await replay.client.callTool({ name: "complete_web_search", arguments: args })).isError).toBe(true);
      expect((await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: content.renderId } })).isError).toBe(true);
      const old = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: replay.parent.renderId } });
      expect(old.structuredContent).toEqual(replay.parent);
      expect(replay.approve).toHaveBeenCalledTimes(1); expect(replay.read).toHaveBeenCalledTimes(1);
    } finally { await replay.close(); }
  });
});
