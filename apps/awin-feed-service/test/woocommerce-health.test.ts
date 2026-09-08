import { describe, expect, it, vi } from "vitest";
import { createWooCommerceController } from "../src/woocommerce.js";
import { WooRegistrySchema } from "../src/woocommerce-registry.js";
import { WooSearchInputSchema } from "../../../packages/contracts/src/woocommerce.js";

const registry = (count = 8) => WooRegistrySchema.parse({ version: "health", stores: Array.from({ length: count }, (_, i) => ({
  merchantId: `store-${i}`, name: `Store ${i}`, origin: `https://store${i}.example`, productPathPrefixes: ["/"], currency: "USD",
  reviewedAt: "2026-09-08", evidenceUrl: `https://store${i}.example`, enabled: true, capabilities: { search: true, variations: false }
})) });
const resolve = async () => [{ address: "8.8.8.8", family: 4 }];
const input = WooSearchInputSchema.parse({ query: "desk" });
const raw = { id: 10, name: "Desk", type: "simple", permalink: "/product/desk", prices: { price: "1099", currency_code: "USD", currency_minor_unit: 2 } };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

describe("Woo bounded merchant health and query isolation", () => {
  it("fills six healthy slots before selection and uses remaining healthy merchants on continuation", async () => {
    const request = vi.fn(async (url: URL) => url.hostname === "store0.example" ? new Response("Denied", { status: 403 }) : json([]));
    const service = createWooCommerceController(registry(), { resolve, request });
    expect((await service.search({ ...input, productUrl: "https://store0.example/product/desk" })).stores[0]?.reason).toBe("ACCESS_DENIED");
    const first = await service.search(input);
    expect(first.diagnostics).toMatchObject({ eligibleStores: 8, plannedStores: 6, physicalRequests: 6, registryCoverageComplete: false });
    expect(first.stores.some(s => s.merchantId === "store-0")).toBe(false);
    const second = await service.search({ ...input, continuation: first.continuation! });
    expect(second.diagnostics).toMatchObject({ plannedStores: 1, physicalRequests: 1 });
    expect(second.stores[0]?.merchantId).not.toBe("store-0");
    expect(request.mock.calls.filter(([url]) => url.hostname === "store0.example")).toHaveLength(1);
  });

  it("suppresses only the malformed search and allows an independent specific query and exact lookup", async () => {
    const request = vi.fn(async (url: URL) => url.searchParams.get("search") === "broad" ? json([{ invalid: true }]) : json(url.pathname.endsWith("/10") ? raw : [raw]));
    const service = createWooCommerceController(registry(1), { resolve, request });
    const broad = { ...input, query: "broad" };
    expect((await service.search(broad)).stores[0]?.reason).toBe("INVALID_RESPONSE");
    expect((await service.search(broad)).diagnostics.physicalRequests).toBe(0);
    expect((await service.search({ ...input, query: "exact model" })).products).toHaveLength(1);
    expect((await service.lookup({ merchantId: "store-0", productId: 10 })).status).toBe("FOUND");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("permits a later independent recheck after the malformed-search cooldown, without an in-call retry", async () => {
    let time = 0; let valid = false;
    const request = vi.fn(async () => valid ? json([raw]) : json([{ invalid: true }]));
    const service = createWooCommerceController(registry(1), { resolve, request, now: () => time });
    expect((await service.search(input)).stores[0]?.reason).toBe("INVALID_RESPONSE");
    valid = true; time = 299_999;
    expect((await service.search(input)).diagnostics.physicalRequests).toBe(0);
    time = 300_001;
    expect((await service.search(input)).products).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not quarantine other products after one malformed exact product", async () => {
    const request = vi.fn(async (url: URL) => json(url.pathname.endsWith("/11") ? { ...raw, id: 11 } : { invalid: true }));
    const service = createWooCommerceController(registry(1), { resolve, request });
    expect((await service.lookup({ merchantId: "store-0", productId: 10 })).status).toBe("UNAVAILABLE");
    expect((await service.lookup({ merchantId: "store-0", productId: 11 })).status).toBe("FOUND");
  });

  it.each([403, 302])("preserves access/security quarantine across different queries and elapsed time: %s", async status => {
    let time = 0;
    const request = vi.fn(async () => new Response(null, { status, headers: status === 302 ? { location: "https://evil.example" } : {} }));
    const service = createWooCommerceController(registry(1), { resolve, request, now: () => time });
    expect((await service.search(input)).status).toBe("UNAVAILABLE");
    time = 86_400_000;
    expect((await service.search({ ...input, query: "new model" })).status).toBe("UNAVAILABLE");
    expect((await service.lookup({ merchantId: "store-0", productId: 10 })).status).toBe("UNAVAILABLE");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not serve cached merchant choices after one of those merchants becomes unavailable", async () => {
    const access: { deniedHost?: string } = {};
    const request = vi.fn(async (url: URL) => url.hostname === access.deniedHost ? new Response("Denied", { status: 403 }) : json([]));
    const stores = registry();
    const service = createWooCommerceController(stores, { resolve, request });
    const first = await service.search(input);
    const deniedId = first.stores[0]!.merchantId;
    access.deniedHost = new URL(stores.stores.find(s => s.merchantId === deniedId)!.origin).hostname;
    await service.lookup({ merchantId: deniedId, productId: 10 });
    const second = await service.search(input);
    expect(second.diagnostics).toMatchObject({ plannedStores: 6, physicalRequests: 6, cacheHits: 0 });
    expect(second.stores.some(s => s.merchantId === deniedId)).toBe(false);
  });

  it("does not let an older successful read erase a concurrent access denial", async () => {
    let release!: () => void;
    const pending = new Promise<void>(done => { release = done; });
    let started!: () => void;
    const entered = new Promise<void>(done => { started = done; });
    const request = vi.fn(async (url: URL) => {
      if (url.searchParams.get("search") === "slow success") { started(); await pending; return json([raw]); }
      return new Response("Denied", { status: 403 });
    });
    const service = createWooCommerceController(registry(1), { resolve, request });
    const slow = service.search({ ...input, query: "slow success" });
    await entered;
    await service.search({ ...input, query: "denied" });
    release(); await slow;
    const later = await service.search({ ...input, query: "another query" });
    expect(later.stores[0]?.reason).toBe("CIRCUIT_OPEN");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("respects a concurrent Retry-After before retrying an older transient failure", async () => {
    let time = 0;
    let release!: () => void;
    const pending = new Promise<void>(done => { release = done; });
    let started!: () => void;
    const entered = new Promise<void>(done => { started = done; });
    const request = vi.fn(async (url: URL) => {
      if (url.searchParams.get("search") === "slow failure") { started(); await pending; return new Response(null, { status: 503 }); }
      return new Response(null, { status: 429, headers: { "retry-after": "600" } });
    });
    const service = createWooCommerceController(registry(1), { resolve, request, now: () => time });
    const slow = service.search({ ...input, query: "slow failure" });
    await entered;
    await service.search({ ...input, query: "rate limited" });
    release(); await slow;
    time = 300_001;
    expect((await service.search({ ...input, query: "later" })).stores[0]?.reason).toBe("CIRCUIT_OPEN");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each(["search", "inspect"] as const)("preserves later variant-page refusal health after partial %s", async operation => {
    for (const status of [429, 403, 302]) {
      let time = 0;
      const stores = registry(1); stores.stores[0]!.capabilities.variations = true;
      const parent = { ...raw, type: "variable", variations: [{ id: 11, attributes: [{ name: "Size", value: "M" }] }] };
      const child = { ...raw, id: 11, type: "variation", parent: 10 };
      const request = vi.fn(async (url: URL) => {
        if (url.searchParams.get("type") === "variation") return url.searchParams.get("page") === "2"
          ? new Response(null, { status, headers: { "retry-after": "600", location: "https://evil.example" } })
          : new Response(JSON.stringify([child]), { headers: { "content-type": "application/json", "x-wp-totalpages": "2" } });
        return json(url.pathname.endsWith("/10") ? parent : [parent]);
      });
      const service = createWooCommerceController(stores, { resolve, request, now: () => time });
      const result = operation === "search" ? await service.search(input) : await service.inspect({ merchantId: "store-0", productId: 10 }, {});
      expect(result.status).toBe("PARTIAL");
      expect(result.products).toHaveLength(1);
      time = 300_001;
      expect((await service.search({ ...input, query: "another model" })).diagnostics.physicalRequests).toBe(0);
      expect((await service.lookup({ merchantId: "store-0", productId: 10 })).status).toBe("UNAVAILABLE");
      expect(request).toHaveBeenCalledTimes(3);
    }
  });

  it("stops an older workflow before its next page after concurrent denial", async () => {
    let release!: () => void; const pending = new Promise<void>(done => { release = done; });
    let started!: () => void; const entered = new Promise<void>(done => { started = done; });
    const request = vi.fn(async (url: URL) => {
      if (url.searchParams.get("search") === "slow") {
        started(); await pending;
        return new Response("[]", { headers: { "content-type": "application/json", "x-wp-totalpages": "2" } });
      }
      return new Response(null, { status: 403 });
    });
    const service = createWooCommerceController(registry(1), { resolve, request });
    const slow = service.search({ ...input, query: "slow" }); await entered;
    await service.search({ ...input, query: "denied" }); release();
    expect((await slow).diagnostics.physicalRequests).toBe(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("checks quarantine after queued DNS and before issuing an exact read", async () => {
    let release!: () => void; const pending = new Promise<void>(done => { release = done; });
    let started!: () => void; const entered = new Promise<void>(done => { started = done; });
    let resolutions = 0;
    const delayedResolve = async () => { if (++resolutions === 1) { started(); await pending; } return resolve(); };
    const request = vi.fn(async () => new Response(null, { status: 403 }));
    const service = createWooCommerceController(registry(1), { resolve: delayedResolve, request });
    const lookup = service.lookup({ merchantId: "store-0", productId: 10 }); await entered;
    await service.search(input); release();
    expect((await lookup).status).toBe("UNAVAILABLE");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
