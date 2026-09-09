import { once } from "node:events";
import { request as httpRequest, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAwinFeedController, createAwinFeedHttpServer } from "../src/service.js";
import { parseAwinFeedServiceEnvironment } from "../src/environment.js";
import type { WooCommerceController } from "../src/woocommerce.js";
import { WooSearchResultSchema, WooStoreResultSchema, type WooSearchResult } from "../../../packages/contracts/src/woocommerce.js";
import { z } from "zod";
import { createWooCommercePortFromEnvironment } from "../../mcp-server/src/woocommerce-client.js";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }))); });
async function start(woocommerce?: WooCommerceController) {
  const env = parseAwinFeedServiceEnvironment({ AWIN_SOURCE_FEED_URL: "https://productdata.awin.com/test.csv.gz", AWIN_FEED_API_TOKEN: "a".repeat(32) });
  const server = createAwinFeedHttpServer(createAwinFeedController(env), env.apiToken, { ...(woocommerce === undefined ? {} : { woocommerce }) });
  servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (address === null || typeof address === "string") throw new Error("listen failed");
  return `http://127.0.0.1:${address.port}`;
}
function controller(): WooCommerceController {
  return {
    search: vi.fn(), lookup: vi.fn(async () => ({ source: "WOOCOMMERCE_STORE_API" as const, registryVersion: "test", status: "NOT_FOUND" as const, checkedAt: "2026-09-08T12:00:00.000Z" })),
    inspect: vi.fn(async () => ({ source: "WOOCOMMERCE_STORE_API" as const, registryVersion: "test", status: "COMPLETE" as const, products: [], checkedAt: "2026-09-08T12:00:00.000Z", truncated: false })),
    image: vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }))
  };
}
async function post(base: string, path: string, body: unknown) { return fetch(`${base}/v1/woocommerce/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
describe("Woo service HTTP boundary", () => {
  it.each([undefined, "unknown"])("keeps the strict legacy store shape without a recognized coverage capability: %s", async capability => {
    const result = boundedResult();
    const woo = controller(); woo.search = vi.fn(async () => result);
    const base = await start(woo);
    const response = await fetch(`${base}/v1/woocommerce/search`, { method: "POST",
      headers: { "content-type": "application/json", ...(capability ? { "x-findcheap-woo-coverage": capability } : {}) }, body: JSON.stringify({ query: "coffee" }) });
    const body = await response.json();
    // v0.18.2 accepts these fields strictly; an optional additive field still breaks it.
    const legacy = WooSearchResultSchema.extend({ stores: z.array(WooStoreResultSchema.omit({ boundedReasons: true, failureDetail: true })).max(6),
      diagnostics: WooSearchResultSchema.shape.diagnostics.omit({ routing: true }) });
    expect(legacy.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ status: "PARTIAL", diagnostics: { truncated: true }, stores: [{ reason: "BUDGET_EXHAUSTED" }] });
    expect(result.stores[0]?.boundedReasons).toEqual(["PRODUCT_PAGE_LIMIT"]);
    expect(response.headers.get("vary")).toBe("x-findcheap-woo-coverage");
  });
  it("negotiates bounded reasons through the current client without poisoning the legacy representation", async () => {
    const result = boundedResult();
    const woo = controller(); woo.search = vi.fn(async () => result);
    const base = await start(woo);
    const port = createWooCommercePortFromEnvironment({ WOOCOMMERCE_API_BASE_URL: "https://source.example" }, {
      fetch: (url, init) => fetch(new URL(new URL(String(url)).pathname, base), init)
    })!;
    const current = await port.search({ query: "coffee", limit: 12, market: "US", currency: "USD" });
    expect(current.stores[0]).toMatchObject({ boundedReasons: ["PRODUCT_PAGE_LIMIT"], failureDetail: "REQUEST_LIMIT" });
    expect(current.diagnostics.routing).toMatchObject({ relevantPlanned: 1, explorationPlanned: 0 });
    const v1 = await fetch(`${base}/v1/woocommerce/search`, { method: "POST", headers: {
      "content-type": "application/json", "x-findcheap-woo-coverage": "1"
    }, body: JSON.stringify({ query: "coffee" }) });
    const v1Body = await v1.json();
    expect(v1Body.stores[0].boundedReasons).toEqual(["PRODUCT_PAGE_LIMIT"]);
    expect(v1Body.stores[0]).not.toHaveProperty("failureDetail");
    expect(v1Body.diagnostics).not.toHaveProperty("routing");
    const old = await post(base, "search", { query: "coffee" });
    expect((await old.json()).stores[0]).not.toHaveProperty("boundedReasons");
    expect((await port.search({ query: "coffee", limit: 12, market: "US", currency: "USD" })).stores[0]?.boundedReasons).toEqual(["PRODUCT_PAGE_LIMIT"]);
  });
  it("is absent by default and leaves existing endpoint methods intact", async () => {
    const base = await start();
    expect((await post(base, "search", { query: "desk" })).status).toBe(404);
    expect((await fetch(`${base}/v1/woocommerce/search`)).status).toBe(405);
    expect((await fetch(`${base}/v1/search`)).status).toBe(405);
    expect(parseAwinFeedServiceEnvironment({ AWIN_SOURCE_FEED_URL: "https://productdata.awin.com/test.csv.gz", AWIN_FEED_API_TOKEN: "a".repeat(32) })).not.toHaveProperty("woocommerce");
  });
  it("validates target and request bytes before invoking readers", async () => {
    const woo = controller(); const base = await start(woo);
    expect((await post(base, "products/lookup", { merchantId: "a", productId: 12 })).status).toBe(200);
    expect(woo.lookup).toHaveBeenCalledWith({ merchantId: "a", productId: 12 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect((await post(base, "products/lookup", { merchantId: "a", productId: 12, url: "https://evil.example" })).status).toBe(400);
    expect((await post(base, "search", { query: "a".repeat(5_000) })).status).toBe(413);
    expect(woo.search).not.toHaveBeenCalled();
    expect((await post(base, "products/variants", { target: { merchantId: "a", productId: 12 }, requirements: { color: "Black" } })).status).toBe(200);
    expect(woo.inspect).toHaveBeenCalledTimes(1);
  });
  it("serves only supported image MIME and rejects an arbitrary URL proxy", async () => {
    const woo = controller(); const base = await start(woo);
    expect((await fetch(`${base}/v1/woocommerce/images?merchantId=a&imageId=${"f".repeat(64)}`)).status).toBe(200);
    expect((await fetch(`${base}/v1/woocommerce/images?url=https://evil.example/a.png`)).status).toBe(400);
    woo.image = vi.fn(async () => new Response("<html>error</html>", { headers: { "content-type": "text/html" } }));
    expect((await fetch(`${base}/v1/woocommerce/images?merchantId=a&imageId=${"f".repeat(64)}`)).status).toBe(502);
  });
  it("cancels in-flight merchant work when the client disconnects", async () => {
    const woo = controller();
    let started!: () => void; const startRead = new Promise<void>((resolve) => { started = resolve; });
    let stopped!: () => void; const stopRead = new Promise<void>((resolve) => { stopped = resolve; });
    woo.search = vi.fn(async (_input, options) => { started(); return new Promise<WooSearchResult>((_resolve, reject) => { options!.signal!.addEventListener("abort", () => { stopped(); reject(new Error("aborted")); }, { once: true }); }); });
    const base = await start(woo);
    const request = httpRequest(`${base}/v1/woocommerce/search`, { method: "POST", headers: { "content-type": "application/json" } });
    request.on("error", () => {}); request.end(JSON.stringify({ query: "desk" }));
    await startRead; request.destroy(); await stopRead;
    expect(woo.search).toHaveBeenCalledTimes(1);
  });
});

function boundedResult(): WooSearchResult {
  return { source: "WOOCOMMERCE_STORE_API", schemaVersion: 1, registryVersion: "test", requestId: "bounded-test",
    status: "PARTIAL", snapshotAt: "2026-09-09T02:00:00.000Z", products: [],
    stores: [{ merchantId: "sample", status: "PARTIAL", reason: "BUDGET_EXHAUSTED", failureDetail: "REQUEST_LIMIT", boundedReasons: ["PRODUCT_PAGE_LIMIT"], requests: 2, returned: 0 }],
    diagnostics: { eligibleStores: 1000, plannedStores: 1, attemptedStores: 1, succeededStores: 0, failedStores: 1, skippedStores: 999, physicalRequests: 2,
      responseBytes: 2, cacheHits: 0, elapsedMs: 1, truncated: true, registryCoverageComplete: false,
      routing: { scope: "CURRENT_PASS", matchedStores: 1, relevantPlanned: 1, explorationPlanned: 0 } } };
}
