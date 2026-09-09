import { describe, expect, it, vi } from "vitest";
import { createWooCommerceController } from "../../awin-feed-service/src/woocommerce.js";
import { WooRegistrySchema } from "../../awin-feed-service/src/woocommerce-registry.js";
import type { WooSearchResult } from "../../../packages/contracts/src/woocommerce.js";
import { createWooCommercePortFromEnvironment } from "../src/woocommerce-client.js";
import { SearchProductsInputSchema, searchProducts } from "../src/search-products.js";
import { SearchRun } from "../src/search-run.js";
import { searchDiagnostics } from "../src/search-diagnostics.js";
import { textSearchRecovery } from "../src/text-search-recovery.js";
import { searchResult } from "./fixtures/conversation-replay-support.js";

const registry = WooRegistrySchema.parse({ version: "bounded-fixture", stores: [{ merchantId: "desk-fixture", name: "Desk Fixture",
  origin: "https://desk.example", productPathPrefixes: ["/product/"], currency: "USD", reviewedAt: "2026-09-08",
  evidenceUrl: "https://desk.example", enabled: true, capabilities: { search: true, variations: true }, categories: ["desks"] }] });
const input = SearchProductsInputSchema.parse({ query: "desk", productType: "desk", maxItemPriceCents: 1_000 });
const emptyAwin = { search: async () => ({ source: "AWIN_PRODUCT_FEED" as const, coverage: "COMPLETE" as const,
  snapshotAt: "2026-09-09T00:00:00.000Z", products: [], diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 } }) };
function raw(id: number) { return { id, parent: 0, name: "Desk", type: "simple", permalink: `https://desk.example/product/desk-${id}`,
  is_in_stock: true, is_purchasable: true, has_options: false, prices: { price: "1500", currency_code: "USD", currency_minor_unit: 2 },
  images: [{ id: 1, src: "https://desk.example/desk.jpg" }] }; }
function response(body: unknown, pages = 1) { return new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "x-wp-totalpages": String(pages) } }); }
type Mode = "COMPLETE" | "PRODUCT_PAGE_LIMIT" | "VARIANT_PAGE_LIMIT" | "VARIANT_LIMIT" | "ACCESS_DENIED";
async function replay(mode: Mode, transform?: (result: WooSearchResult, pass: number) => void, run?: SearchRun) {
  const physical = vi.fn(async (url: URL) => {
    const page = Number(url.searchParams.get("page"));
    if (mode === "ACCESS_DENIED") return new Response("Forbidden", { status: 403 });
    if (mode === "PRODUCT_PAGE_LIMIT") return response(Array.from({ length: 20 }, (_, i) => raw(page * 20 + i + 1)), 4);
    if (mode === "VARIANT_PAGE_LIMIT" || mode === "VARIANT_LIMIT") {
      if (url.searchParams.get("type") !== "variation") return response([{ ...raw(100), type: "variable", has_options: true,
        attributes: [{ name: "Color", has_variations: true, terms: [{ name: "Red" }] }],
        variations: Array.from({ length: 40 }, (_, i) => ({ id: 101 + i, attributes: [{ name: "Color", value: "Red" }] })) }]);
      return response(Array.from({ length: 20 }, (_, i) => ({ ...raw(101 + (page - 1) * 20 + i), type: "variation", parent: 100,
        permalink: "https://desk.example/product/desk?attribute_color=Red", attributes: [{ name: "Color", value: "Red" }] })), mode === "VARIANT_PAGE_LIMIT" ? 3 : 2);
    }
    return response([]);
  });
  const controller = createWooCommerceController(registry, { resolve: async () => [{ address: "8.8.8.8", family: 4 }], request: physical });
  const outputs: WooSearchResult[] = [];
  const client = createWooCommercePortFromEnvironment({ WOOCOMMERCE_API_BASE_URL: "https://source.example" }, { fetch: async (url, init) => {
    expect(String(url)).toBe("https://source.example/v1/woocommerce/search");
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    const result = await controller.search(JSON.parse(String(init?.body)));
    transform?.(result, outputs.length + 1); outputs.push(result); return response(result);
  } })!;
  const execution = await searchProducts({ ...input, ...(run ? { searchRun: run } : {}) }, {
    awin: emptyAwin, shopify: { search: async () => searchResult([]) }, woocommerce: client
  });
  return { execution, outputs, physical };
}
function makeUnknown(result: WooSearchResult) {
  result.status = "PARTIAL"; result.stores[0]!.status = "PARTIAL";
  result.diagnostics.truncated = true; result.diagnostics.registryCoverageComplete = false;
}

describe("real Woo bounded reads through the strict client and search workflow", () => {
  it.each(["PRODUCT_PAGE_LIMIT", "VARIANT_PAGE_LIMIT", "VARIANT_LIMIT"] as const)("does not misreport a healthy %s as unavailable", async mode => {
    const { execution, outputs, physical } = await replay(mode);
    expect(execution.candidates).toHaveLength(0);
    expect(execution.searchPasses).toBe(2);
    expect(execution.sourceFailures ?? []).toEqual([]);
    expect(execution.searchRun?.diagnostics().budgetExhausted).toBe(false);
    expect(execution.chromeFallbackEligible).toBe(true);
    expect(textSearchRecovery(execution)).toMatchObject({ action: "REQUEST_WEB_SEARCH", reason: "NO_QUALIFIED_MATCH" });
    const diagnostics = searchDiagnostics(execution, "NO_CANDIDATES");
    expect(diagnostics.termination).toBe("BOUNDED_SEARCH_COMPLETE");
    expect(JSON.stringify(diagnostics)).toContain(mode);
    expect(outputs).toHaveLength(2);
    for (const result of outputs) {
      expect(result).toMatchObject({ status: "PARTIAL", diagnostics: { truncated: true, registryCoverageComplete: false } });
      expect(result.stores[0]).toMatchObject({ status: "PARTIAL", boundedReasons: expect.arrayContaining([mode]) });
      expect(result.stores[0]?.reason).toBeUndefined();
    }
    expect(physical).toHaveBeenCalledTimes(mode === "PRODUCT_PAGE_LIMIT" ? 4 : 6);
  });

  it("retains ordinary complete empty-search recovery", async () => {
    const { execution } = await replay("COMPLETE");
    expect(execution.chromeFallbackEligible).toBe(true);
    expect(textSearchRecovery(execution).reason).toBe("NO_QUALIFIED_MATCH");
  });

  it("keeps legacy unexplained PARTIAL closed", async () => {
    const { execution } = await replay("COMPLETE", makeUnknown);
    expect(execution.chromeFallbackEligible).toBe(false);
    expect(textSearchRecovery(execution)).toMatchObject({ action: "REPORT_INCOMPLETE", reason: "SOURCE_UNAVAILABLE" });
  });

  it("does not infer a known bound from unexplained aggregate PARTIAL with complete stores", async () => {
    const { execution } = await replay("COMPLETE", result => {
      result.status = "PARTIAL"; result.diagnostics.truncated = true; result.diagnostics.registryCoverageComplete = false;
    });
    expect(execution.chromeFallbackEligible).toBe(false);
    expect(textSearchRecovery(execution).reason).toBe("SOURCE_UNAVAILABLE");
  });

  it("does not let another known local failure excuse an unexplained partial store", async () => {
    const { execution } = await replay("COMPLETE", result => {
      makeUnknown(result);
      result.stores.push({ merchantId: "unsupported-fixture", status: "PARTIAL", reason: "UNSUPPORTED", requests: 1, returned: 0 });
    });
    expect(execution.sourceFailures).toContainEqual({ source: "WOOCOMMERCE", kind: "UNSUPPORTED", retryable: false, scope: "SOURCE" });
    expect(execution.chromeFallbackEligible).toBe(false);
  });

  it("retains an earlier unexplained pass even when the last pass completes", async () => {
    const { execution } = await replay("COMPLETE", (result, pass) => { if (pass === 1) makeUnknown(result); });
    expect(execution.sourceStatus.woocommerce).toBe("COMPLETE");
    expect(execution.chromeFallbackEligible).toBe(false);
    expect(textSearchRecovery(execution)).toMatchObject({ action: "REPORT_INCOMPLETE", reason: "SOURCE_UNAVAILABLE" });
    expect(searchDiagnostics(execution, "NO_CANDIDATES").termination).toBe("SOURCE_UNAVAILABLE");
  });

  it("allows a known source-local limitation alongside a healthy bounded store without claiming full coverage", async () => {
    const { execution } = await replay("PRODUCT_PAGE_LIMIT", result => {
      result.stores.push({ merchantId: "unsupported-fixture", status: "PARTIAL", reason: "UNSUPPORTED", requests: 1, returned: 0 });
    });
    expect(execution.chromeFallbackEligible).toBe(true);
    expect(textSearchRecovery(execution)).toMatchObject({ action: "REQUEST_WEB_SEARCH", reason: "SOURCE_UNAVAILABLE" });
    expect(execution.woocommerceResult?.diagnostics.registryCoverageComplete).toBe(false);
  });

  it("does not accept bounded metadata that disagrees with truncation", async () => {
    const { execution } = await replay("PRODUCT_PAGE_LIMIT", result => { result.diagnostics.truncated = false; });
    expect(execution.chromeFallbackEligible).toBe(false);
    expect(textSearchRecovery(execution).action).toBe("REPORT_INCOMPLETE");
  });

  it("rejects malformed bounded metadata at the actual client response boundary", async () => {
    const { execution } = await replay("PRODUCT_PAGE_LIMIT", result => { result.stores[0]!.boundedReasons = ["PRODUCT_PAGE_LIMIT", "PRODUCT_PAGE_LIMIT"]; });
    expect(execution.chromeFallbackEligible).toBe(false);
    expect(execution.sourceFailures?.some(failure => failure.kind === "SCHEMA_INVALID")).toBe(true);
  });

  it("retains source rejection after an actual HTTP 403 and does not retry the quarantined merchant", async () => {
    const { execution, physical } = await replay("ACCESS_DENIED");
    expect(physical).toHaveBeenCalledTimes(1);
    expect(execution.chromeFallbackEligible).toBe(false);
    expect(searchDiagnostics(execution, "NO_CANDIDATES").termination).toBe("SOURCE_REJECTED");
  });

  it("keeps real failure reasons dominant over bounded metadata", async () => {
    const { execution } = await replay("PRODUCT_PAGE_LIMIT", result => { result.stores[0]!.reason = "INVALID_RESPONSE"; });
    expect(execution.chromeFallbackEligible).toBe(false);
    expect(searchDiagnostics(execution, "NO_CANDIDATES").termination).toBe("SCHEMA_INVALID");
  });

  it("does not reopen host recovery after global budget exhaustion", async () => {
    const { execution } = await replay("PRODUCT_PAGE_LIMIT", undefined, new SearchRun({ maxCatalogRequests: 3 }));
    expect(execution.chromeFallbackEligible).toBe(false);
    expect(textSearchRecovery(execution)).toMatchObject({ action: "REPORT_INCOMPLETE", reason: "BUDGET_EXHAUSTED" });
  });
});
