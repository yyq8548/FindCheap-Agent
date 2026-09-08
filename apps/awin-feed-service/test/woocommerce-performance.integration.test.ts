import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { FINDCHEAP_VERSION } from "../../../config/version.js";
import { WooSearchInputSchema, type WooSearchResult } from "../../../packages/contracts/src/woocommerce.js";
import { createPinnedRequest } from "../../../packages/network-safety/src/safe-fetch.js";
import { SearchRun } from "../../mcp-server/src/search-run.js";
import { DEFAULT_WOO_REGISTRY } from "../src/woocommerce-registry.js";
import { createWooCommerceController } from "../src/woocommerce.js";

type Mode = "SOURCE_OFF" | "COLD" | "WARM";
type Sample = {
  query: string; mode: Mode; repetition: number; measured: boolean; elapsedMs?: number;
  sourceStatus: WooSearchResult["status"] | "DISABLED" | "ERROR" | "SKIPPED";
  actualGets: number; physicalRequests: number; responseBytes: number; sourceCacheHits: number;
  searchRunCacheHits: number; sourceCalls: number; searchRunReadTimeouts: number;
  sourceStoreTimeouts: number; products: number; snapshotAt?: string; errorName?: string;
};

// This is a bounded opt-in probe of the source-call segment, not a production load test.
describe.skipIf(process.env.FINDCHEAP_WOO_PERFORMANCE !== "1")("Woo source performance evidence", () => {
  it("separates source-off, cold cross-store reads, and warm service cache", async () => {
    const beganAt = new Date().toISOString();
    const stores = DEFAULT_WOO_REGISTRY.stores.filter(store => ["root-science", "burrow-press", "scrub-daddy"].includes(store.merchantId));
    const transport = createPinnedRequest();
    let actualGets = 0;
    const controller = createWooCommerceController({ version: DEFAULT_WOO_REGISTRY.version, stores }, {
      request: async (url, init, addresses) => {
        if (actualGets >= 12) throw new Error("request blocked: performance probe has a 12 GET total cap");
        actualGets += 1;
        return transport(url, init, addresses);
      }
    });
    const samples: Sample[] = [];

    async function sample(query: string, mode: Mode, repetition: number): Promise<Sample> {
      const beforeGets = actualGets;
      const began = performance.now();
      // Each observation gets a new execution ledger. Warmth belongs to the service cache only.
      const run = new SearchRun();
      let result: WooSearchResult | undefined;
      let errorName: string | undefined;
      try {
        if (mode !== "SOURCE_OFF") {
          const input = WooSearchInputSchema.parse({ query, limit: 12, budgetMs: 8000 });
          result = await run.read("WOOCOMMERCE", JSON.stringify(input), async signal => {
            const result = await controller.search(input, { signal });
            run.recordWooRead(result.diagnostics);
            return result;
          });
        }
      } catch (error) { errorName = error instanceof Error ? error.name : "UnknownError"; }
      const diagnostics = run.diagnostics();
      return {
        query, mode, repetition, measured: true, elapsedMs: Math.round((performance.now() - began) * 1000) / 1000,
        sourceStatus: errorName === undefined ? result?.status ?? "DISABLED" : "ERROR", actualGets: actualGets - beforeGets,
        physicalRequests: result?.diagnostics.physicalRequests ?? 0, responseBytes: result?.diagnostics.responseBytes ?? 0,
        sourceCacheHits: result?.diagnostics.cacheHits ?? 0, searchRunCacheHits: diagnostics.cacheHits,
        sourceCalls: diagnostics.woocommerceRequests ?? 0, searchRunReadTimeouts: diagnostics.readTimeouts,
        sourceStoreTimeouts: result?.stores.filter(store => store.reason === "TIMEOUT").length ?? 0,
        products: result?.products.length ?? 0,
        ...(result === undefined ? {} : { snapshotAt: result.snapshotAt }), ...(errorName === undefined ? {} : { errorName })
      };
    }

    for (const query of ["firm", "mother", "original"]) {
      samples.push(await sample(query, "SOURCE_OFF", 0));
      const cold = await sample(query, "COLD", 0);
      samples.push(cold);
      for (let repetition = 1; repetition <= 3; repetition += 1) {
        samples.push(await sample(query, "SOURCE_OFF", repetition));
        if (cold.sourceStatus === "COMPLETE") samples.push(await sample(query, "WARM", repetition));
        else samples.push({ query, mode: "WARM", repetition, measured: false, sourceStatus: "SKIPPED", actualGets: 0,
          physicalRequests: 0, responseBytes: 0, sourceCacheHits: 0, searchRunCacheHits: 0, sourceCalls: 0,
          searchRunReadTimeouts: 0, sourceStoreTimeouts: 0, products: 0 });
      }
    }
    const summary = (["SOURCE_OFF", "COLD", "WARM"] as const).map(mode => {
      const rows = samples.filter(sample => sample.mode === mode && sample.measured);
      const elapsed = rows.map(sample => sample.elapsedMs!).sort((a, b) => a - b);
      const percentile = (fraction: number) => elapsed[Math.max(0, Math.ceil(elapsed.length * fraction) - 1)] ?? null;
      return { mode, plannedSamples: mode === "SOURCE_OFF" ? 12 : mode === "COLD" ? 3 : 9, measuredSamples: rows.length,
        medianMs: percentile(0.5), observedP95Ms: percentile(0.95), maximumMs: elapsed.at(-1) ?? null,
        actualGets: rows.reduce((sum, row) => sum + row.actualGets, 0),
        sourceStoreTimeouts: rows.reduce((sum, row) => sum + row.sourceStoreTimeouts, 0),
        searchRunReadTimeouts: rows.reduce((sum, row) => sum + row.searchRunReadTimeouts, 0),
        incompleteSamples: rows.filter(row => !["COMPLETE", "DISABLED"].includes(row.sourceStatus)).length };
    });
    const report = { formatVersion: 1, beganAt, endedAt: new Date().toISOString(), runtimeVersion: FINDCHEAP_VERSION,
      node: process.version, platform: process.platform, arch: process.arch, registryVersion: DEFAULT_WOO_REGISTRY.version,
      merchants: stores.map(store => ({ merchantId: store.merchantId, origin: store.origin })), actualGets,
      scope: "SearchRun through the in-process source aggregation controller; excludes ingress HTTP, peer sources, model reasoning, ranking, UI and native host. Source-off is the skipped optional-source branch, not a full shopping search baseline.",
      warning: "Three cold and nine warm observations are not a reliable production p95 estimate. Do not combine cold and warm samples or infer the 2-second end-to-end incremental SLO passed.", summary, samples };
    if (process.env.FINDCHEAP_WOO_PERFORMANCE_OUTPUT !== undefined) {
      await writeFile(process.env.FINDCHEAP_WOO_PERFORMANCE_OUTPUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
    process.stdout.write(`WOO_PERFORMANCE_SUMMARY ${JSON.stringify({ beganAt, endedAt: report.endedAt, actualGets, summary })}\n`);
    expect(stores).toHaveLength(3);
    expect(actualGets).toBeLessThanOrEqual(12);
    expect(samples.filter(row => row.mode === "COLD" && row.sourceStatus === "COMPLETE")).toHaveLength(3);
    expect(samples.filter(row => row.mode === "WARM" && row.sourceStatus === "COMPLETE")).toHaveLength(9);
    for (const row of samples.filter(row => row.mode === "WARM")) {
      expect(row.actualGets).toBe(0); expect(row.physicalRequests).toBe(0);
      expect(row.sourceCacheHits).toBe(1); expect(row.searchRunCacheHits).toBe(0);
      expect(row.snapshotAt).toBe(samples.find(cold => cold.mode === "COLD" && cold.query === row.query)?.snapshotAt);
    }
    for (const row of samples.filter(row => row.mode === "SOURCE_OFF")) expect(row.sourceCalls).toBe(0);
  }, 35_000);
});
