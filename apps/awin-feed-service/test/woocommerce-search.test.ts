import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { createWooCommerceController } from "../src/woocommerce.js";
import { WooRegistrySchema } from "../src/woocommerce-registry.js";
import { WooSearchInputSchema } from "../../../packages/contracts/src/woocommerce.js";

function registry(count = 2) {
  return WooRegistrySchema.parse({ version: "test", stores: Array.from({ length: count }, (_, index) => ({
    merchantId: `store-${index}`, name: `Store ${index}`, origin: `https://store${index}.example`, productPathPrefixes: ["/"],
    currency: "USD", reviewedAt: "2026-09-08", evidenceUrl: `https://store${index}.example`, enabled: true, capabilities: { search: true, variations: true }
  })) });
}
const resolve = async () => [{ address: "8.8.8.8", family: 4 }];
function product(host: string, price = "1099") { return { id: 10, parent: 0, name: "Desk", type: "simple", permalink: `https://${host}/product/desk`, is_in_stock: true, prices: { price, currency_code: "USD", currency_minor_unit: 2 } }; }
function response(body: unknown, totalPages = 1) { return new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "x-wp-totalpages": String(totalPages) } }); }
const input = WooSearchInputSchema.parse({ query: "desk", limit: 12 });
describe("Woo bounded independent aggregation", () => {
  it("does not claim complete coverage when no stores are configured", async () => {
    const request = vi.fn();
    const result = await createWooCommerceController(registry(0), { resolve, request }).search(input);
    expect(result.status).toBe("NOT_CONFIGURED");
    expect(result.diagnostics.registryCoverageComplete).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
  it("starts unbranded multi-store reads, scopes same numeric IDs and keeps one-store failure partial", async () => {
    const request = vi.fn(async (url: URL) => url.hostname === "store0.example" ? new Response("Denied", { status: 403 }) : response([product(url.hostname)]));
    const result = await createWooCommerceController(registry(), { resolve, request }).search(input);
    expect(request).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("PARTIAL");
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ merchantId: "store-1", productId: 10, itemPrice: { amountCents: 1099 } });
    expect(result.diagnostics).toMatchObject({ plannedStores: 2, attemptedStores: 2, physicalRequests: 2, failedStores: 1 });
  });
  it("does not call all-failure or cancelled coverage a successful empty result", async () => {
    const controller = createWooCommerceController(registry(), { resolve, request: async () => new Response("Denied", { status: 403 }) });
    expect((await controller.search(input)).status).toBe("UNAVAILABLE");
    const abort = new AbortController(); abort.abort();
    await expect(controller.search(input, { signal: abort.signal })).rejects.toBeDefined();
  });
  it("uses bounded search cache while lookup always observes current upstream prices", async () => {
    let amount = "1099";
    const request = vi.fn(async (url: URL) => response(url.pathname.endsWith("/10") ? product(url.hostname, amount) : [product(url.hostname, amount)]));
    const controller = createWooCommerceController(registry(1), { resolve, request });
    const first = await controller.search(input);
    amount = "1599";
    expect((await controller.search(input)).products[0]?.itemPrice?.amountCents).toBe(1099);
    expect(request).toHaveBeenCalledTimes(1);
    expect((await controller.lookup({ merchantId: "store-0", productId: 10 })).product?.itemPrice?.amountCents).toBe(1599);
    expect((await controller.search(input)).snapshotAt).toBe(first.snapshotAt);
  });
  it("caps selected stores and pages and continues only within validated registry", async () => {
    const request = vi.fn(async () => response([], 10));
    const controller = createWooCommerceController(registry(8), { resolve, request });
    const result = await controller.search(input);
    expect(result.diagnostics).toMatchObject({ plannedStores: 6, physicalRequests: 12, truncated: true, registryCoverageComplete: false });
    expect(result.status).toBe("PARTIAL");
    const next = await controller.search({ ...input, continuation: result.continuation! });
    expect(next.diagnostics.plannedStores).toBe(2);
    await expect(controller.search({ ...input, continuation: { registryVersion: "foreign", attemptedMerchantIds: [] } })).rejects.toMatchObject({ reason: "SECURITY_REJECTED" });
  });
  it("respects Retry-After cooldown without hidden retry and bounds retry amplification", async () => {
    const request = vi.fn(async () => new Response("slow", { status: 429, headers: { "retry-after": "60" } }));
    const controller = createWooCommerceController(registry(1), { resolve, request });
    expect((await controller.search(input)).stores[0]?.reason).toBe("RATE_LIMITED");
    expect((await controller.search(input)).stores[0]?.reason).toBe("CIRCUIT_OPEN");
    expect(request).toHaveBeenCalledTimes(1);
    expect((await controller.lookup({ merchantId: "store-0", productId: 10 })).status).toBe("UNAVAILABLE");
    expect((await controller.inspect({ merchantId: "store-0", productId: 10 }, {})).status).toBe("UNAVAILABLE");
    expect(request).toHaveBeenCalledTimes(1);
    const failing = vi.fn(async () => new Response("failed", { status: 503 }));
    const failed = await createWooCommerceController(registry(6), { resolve, request: failing }).search(input);
    expect(failed.status).toBe("UNAVAILABLE");
    expect(failing).toHaveBeenCalledTimes(8);
  });
  it("enforces total physical requests while expanding variants", async () => {
    const request = vi.fn(async (url: URL) => response(url.searchParams.get("type") === "variation" ? [] : Array.from({ length: 20 }, (_, index) => ({ ...product(url.hostname), id: 10 + index, type: "variable" }))));
    const result = await createWooCommerceController(registry(6), { resolve, request }).search(input);
    expect(request).toHaveBeenCalledTimes(18);
    expect(result.diagnostics.physicalRequests).toBe(18);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.stores.some((store) => store.reason === "BUDGET_EXHAUSTED")).toBe(true);
  });
  it("locks URL variant parameters and rejects conflicting explicit selection", async () => {
    const parent = { ...product("store0.example"), type: "variable", variations: [{ id: 11, attributes: [{ name: "Color", value: "Red" }] }, { id: 12, attributes: [{ name: "Color", value: "Blue" }] }] };
    const request = vi.fn(async (url: URL) => response(url.searchParams.get("type") === "variation" ? [11, 12].map((id) => ({ ...product(url.hostname), id, parent: 10, type: "variation" })) : [parent]));
    const controller = createWooCommerceController(registry(1), { resolve, request });
    const result = await controller.search({ ...input, productUrl: "https://store0.example/product/desk?variation_id=12&attribute_color=Blue" });
    expect(result.products.map((product) => product.variationId)).toEqual([12]);
    await expect(controller.search({ ...input, requirements: { color: "Red" }, productUrl: "https://store0.example/product/desk?attribute_color=Blue" })).rejects.toMatchObject({ reason: "SECURITY_REJECTED" });
    await expect(controller.search({ ...input, productUrl: "https://store0.example/product/desk?add-to-cart=10" })).rejects.toMatchObject({ reason: "SECURITY_REJECTED" });
    await expect(controller.search({ ...input, productUrl: "https://store0.example/product/desk?attribute_color=Blue&attribute_colour=Red" })).rejects.toMatchObject({ reason: "SECURITY_REJECTED" });
  });
  it("bounds concurrent stores and cancels a transport that ignores the caller signal", async () => {
    let active = 0; let maximum = 0;
    const request = vi.fn(async (url: URL) => { active += 1; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; return response([product(url.hostname)]); });
    const controller = createWooCommerceController(registry(6), { resolve, request });
    expect((await controller.search(input)).status).toBe("COMPLETE");
    expect(maximum).toBe(3);
    const hanging = createWooCommerceController(registry(1), { resolve, request: async () => new Promise<Response>(() => {}) });
    const started = Date.now();
    const result = await hanging.search({ ...input, budgetMs: 100 });
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.stores[0]?.reason).toBe("TIMEOUT");
    expect(Date.now() - started).toBeLessThan(1_000);
  });
  it("limits same-merchant concurrency across independent requests", async () => {
    let active = 0; let maximum = 0;
    const request = async (url: URL) => { active += 1; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 10)); active -= 1; return response([product(url.hostname)]); };
    const controller = createWooCommerceController(registry(1), { resolve, request });
    await Promise.all(["desk", "table", "chair", "bench"].map((query) => controller.search({ ...input, query })));
    expect(maximum).toBe(2);
  });
  it("retains earlier verified variants if a later page fails", async () => {
    const parent = { ...product("store0.example"), type: "variable", variations: [{ id: 11, attributes: [{ name: "Color", value: "Red" }] }] };
    const request = async (url: URL) => url.searchParams.get("page") === "2" ? new Response("Error", { status: 503 }) : response(url.searchParams.get("type") === "variation" ? [{ ...product(url.hostname), id: 11, parent: 10, type: "variation" }] : parent, 2);
    const result = await createWooCommerceController(registry(1), { resolve, request }).inspect({ merchantId: "store-0", productId: 10 }, { color: "Red" });
    expect(result.status).toBe("PARTIAL");
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.variationId).toBe(11);
  });
  it("requires an issued, merchant-bound image reference", async () => {
    const request = vi.fn(async (url: URL) => response([{ ...product(url.hostname), images: [{ id: 1, src: `https://${url.hostname}/image.png` }] }]));
    const controller = createWooCommerceController(registry(), { resolve, request });
    const result = await controller.search(input);
    const image = result.products[0]!.images[0]!;
    await expect(controller.image("store-1", image.id)).rejects.toMatchObject({ reason: "SECURITY_REJECTED" });
    await expect(controller.image("store-0", "https://evil.example/a.png")).rejects.toMatchObject({ reason: "SECURITY_REJECTED" });
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("Woo recorded real merchant contracts", () => {
  it("uses the Walnut child price 28500, never parent starting price 25000", async () => {
    const parent = JSON.parse(await readFile(new URL("fixtures/woocommerce-live/lamarzocco-parent.json", import.meta.url), "utf8")) as { body: unknown };
    const children = JSON.parse(await readFile(new URL("fixtures/woocommerce-live/lamarzocco-price-variants.json", import.meta.url), "utf8")) as { body: unknown };
    const stores = registry(1); stores.stores[0]!.origin = "https://home.lamarzoccousa.com";
    const controller = createWooCommerceController(stores, { resolve, request: async (url) => response(url.pathname.endsWith("/355289") ? parent.body : children.body) });
    const result = await controller.inspect({ merchantId: "store-0", productId: 355289 }, { attributes: { option: "Walnut" } });
    expect(result.status).toBe("COMPLETE");
    expect(result.parent?.itemPrice).toBeUndefined();
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ variationId: 355292, itemPrice: { amountCents: 28500 }, selectedAttributes: { option: "Walnut" } });
  });
});
