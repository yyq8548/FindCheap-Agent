import { describe, expect, it } from "vitest";
import { createWooCommerceController } from "../src/woocommerce.js";
import { WooRegistrySchema } from "../src/woocommerce-registry.js";
import { WooSearchInputSchema } from "../../../packages/contracts/src/woocommerce.js";

const registry = WooRegistrySchema.parse({ version: "failure-details", stores: [{ merchantId: "test", name: "Test",
  origin: "https://shop.example", productPathPrefixes: ["/product/"], currency: "USD", reviewedAt: "2026-09-09",
  evidenceUrl: "https://shop.example", enabled: true, capabilities: { search: true, variations: true } }] });

describe("bounded Woo failure diagnostics", () => {
  it.each([
    ["text/html", "<html>private response</html>", "CONTENT_TYPE"],
    ["application/json", "{broken private response", "JSON_SYNTAX"],
    ["application/json", '[{"id":"private response"}]', "PRODUCT_SCHEMA"],
    ["application/json", JSON.stringify(Array(1001).fill(null)), "JSON_STRUCTURE_LIMIT"]
  ])("preserves INVALID_RESPONSE while explaining %s / %s", async (contentType, body, detail) => {
    const service = createWooCommerceController(registry, { resolve: async () => [{ address: "8.8.8.8", family: 4 }],
      request: async () => new Response(body, { headers: { "content-type": contentType } }) });
    const result = await service.search(WooSearchInputSchema.parse({ query: "coffee" }));
    expect(result.stores).toMatchObject([{ status: "UNAVAILABLE", reason: "INVALID_RESPONSE", failureDetail: detail }]);
    expect(result.diagnostics).toMatchObject({ failedStores: 1, attemptedStores: 1, physicalRequests: 1 });
    expect(JSON.stringify(result)).not.toContain("private response");
  });
});
