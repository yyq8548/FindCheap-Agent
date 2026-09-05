import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createOfficialCatalogPort } from "../src/official-catalog.js";
import type { ShopifyProduct } from "../src/shopify-client.js";
import type { OfficialShopifySearchPort } from "../src/shopify-official-store-search.js";
import { replaceManagedOfficialStorefronts } from "../src/merchant-trust.js";

const now = Date.parse("2026-09-05T00:00:00Z");
const product: ShopifyProduct = {
  merchantId: "official-www.shopdoen.com", merchant: "DÔEN", sourceHost: "www.shopdoen.com",
  merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT", evidence: [] },
  handle: "10001", title: "Blue scoop neck floral dress", productType: "dress", brand: "DÔEN",
  description: "Blue cotton floral mini dress with short sleeves", gtins: [], variantDimensions: {},
  matchStatus: "DISCOVERY_MATCH", matchEvidence: [], condition: "UNKNOWN",
  itemPrice: { amountCents: 20000, currency: "USD" }, availability: "IN_STOCK",
  merchantUrl: "https://www.shopdoen.com/products/example-dress?variant=10001", checkedAt: new Date(now).toISOString()
};
const setup = async (products = [product]) => {
  const path = join(await mkdtemp(join(tmpdir(), "official-catalog-test-")), "catalog.json");
  const search = vi.fn<OfficialShopifySearchPort["search"]>(async () => products);
  let time = now;
  const create = () => createOfficialCatalogPort({ path, official: { search }, now: () => time });
  return { path, search, create, advance: (ms: number) => { time += ms; } };
};

describe("reviewed official catalog", () => {
  it("does not serve a source after its approval is removed", async () => {
    const host = "reviewed-fixture.example";
    replaceManagedOfficialStorefronts([{ brand: "Reviewed fixture", aliases: [], officialHost: host,
      platform: "SHOPIFY", productPathPrefixes: ["/products/"], imageHosts: [], evidenceUrl: `https://${host}/`,
      reviewedAt: "2026-09-05", status: "APPROVED" }]);
    try {
      const fixture = await setup([{ ...product, sourceHost: host, merchantUrl: `https://${host}/products/example-dress` }]);
      const catalog = fixture.create();
      await catalog.refreshSources([{ host, queries: ["dress"] }]);
      expect((await catalog.search({ query: "dress", limit: 12 })).products).toHaveLength(1);
      replaceManagedOfficialStorefronts([]);
      expect((await catalog.search({ query: "dress", limit: 12 })).products).toHaveLength(0);
    } finally { replaceManagedOfficialStorefronts([]); }
  });

  it("bounds persisted file bytes and product rows during recovery", async () => {
    const fixture = await setup();
    await writeFile(fixture.path, Buffer.alloc(8 * 1024 * 1024 + 1));
    expect((await fixture.create().search({ query: "dress", limit: 12 })).diagnostics.status).toBe("CACHE_UNAVAILABLE");
    await writeFile(fixture.path, JSON.stringify({ version: 1, products: Array.from({ length: 2001 }, () => product), sources: {} }));
    expect((await fixture.create().search({ query: "dress", limit: 12 })).products).toHaveLength(0);
  });

  it("blocks a concurrent importer and honors already-aborted cache searches", async () => {
    const fixture = await setup();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    fixture.search.mockImplementationOnce(async () => { await pending; return [product]; });
    const first = fixture.create().refreshSources([{ host: "www.shopdoen.com", queries: ["dress"] }]);
    await vi.waitFor(() => expect(fixture.search).toHaveBeenCalledOnce());
    try {
      await expect(fixture.create().refreshSources([{ host: "www.shopdoen.com", queries: ["dress"] }])).rejects.toMatchObject({ code: "EEXIST" });
    } finally { release(); await first; }
    await expect(fixture.create().search({ query: "dress", limit: 12, signal: AbortSignal.abort() })).rejects.toThrow();
  });
  it("independently discovers a reviewed source, persists and searches without a brand", async () => {
    const fixture = await setup();
    const catalog = fixture.create();
    await catalog.refreshSources([{ host: "www.shopdoen.com", queries: ["dress", "top"] }]);
    expect(fixture.search).toHaveBeenCalledWith(expect.objectContaining({ query: "dress", limit: 12 }));
    expect(fixture.search.mock.calls[0]?.[0]).not.toHaveProperty("sourcePageUrl");
    const result = await fixture.create().search({ query: "blue floral dress", limit: 12 });
    expect(result.products).toHaveLength(1);
    expect(result.diagnostics.status).toBe("FRESH");
    expect(result.diagnostics.coveredQueries).toBe(1);
  });

  it("persists per-source retry bounds and advances discovery cursor after the interval", async () => {
    const fixture = await setup();
    const plan = [{ host: "www.shopdoen.com", queries: ["dress", "top"] }];
    await fixture.create().refreshSources(plan);
    await fixture.create().refreshSources(plan);
    expect(fixture.search).toHaveBeenCalledTimes(1);
    fixture.advance(6 * 60 * 60 * 1000);
    await fixture.create().refreshSources(plan);
    expect(fixture.search).toHaveBeenLastCalledWith(expect.objectContaining({ query: "top" }));
  });

  it("retains last success on refresh failure and exposes stale products without stale prices", async () => {
    const fixture = await setup([{ ...product, availableSizes: ["S", "M"], availabilityScope: "PRODUCT_COLOR" }]);
    await fixture.create().refreshSources([{ host: "www.shopdoen.com", queries: ["dress"] }]);
    fixture.advance(25 * 60 * 60 * 1000);
    fixture.search.mockRejectedValueOnce(new Error("upstream unavailable"));
    await fixture.create().refreshSources([{ host: "www.shopdoen.com", queries: ["dress"] }]);
    const result = await fixture.create().search({ query: "dress", limit: 12 });
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.itemPrice).toBeUndefined();
    expect(result.products[0]?.availableSizes).toBeUndefined();
    expect(result.products[0]?.availability).toBe("UNKNOWN");
    expect(result.diagnostics.status).toBe("STALE");
    fixture.advance(7 * 24 * 60 * 60 * 1000);
    expect((await fixture.create().search({ query: "dress", limit: 12 })).products).toHaveLength(0);
  });

  it("rejects unreviewed hosts and forged cross-host products before import", async () => {
    const fixture = await setup([{ ...product, merchantUrl: "https://evil.example/products/fake" }]);
    await expect(fixture.create().refreshSources([{ host: "evil.example", queries: ["dress"] }])).rejects.toThrow("OFFICIAL_SOURCE_NOT_APPROVED");
    expect(fixture.search).not.toHaveBeenCalled();
    await fixture.create().refreshSources([{ host: "www.shopdoen.com", queries: ["dress"] }]);
    expect((await fixture.create().search({ query: "dress", limit: 12 })).products).toHaveLength(0);
  });

  it("refuses oversized plans and corrupt restoration while keeping a live last-good snapshot", async () => {
    const fixture = await setup();
    const catalog = fixture.create();
    await expect(catalog.importUrls(Array.from({ length: 21 }, () => product.merchantUrl))).rejects.toThrow();
    await catalog.refreshSources([{ host: "www.shopdoen.com", queries: ["dress"] }]);
    await catalog.search({ query: "dress", limit: 12 });
    const snapshot = await readFile(fixture.path, "utf8");
    await writeFile(fixture.path, "invalid", "utf8");
    fixture.advance(60_001);
    expect((await catalog.search({ query: "dress", limit: 12 })).products).toHaveLength(1);
    expect((await fixture.create().search({ query: "dress", limit: 12 })).diagnostics.status).toBe("CACHE_UNAVAILABLE");
    await writeFile(fixture.path, snapshot, "utf8");
  });
});
