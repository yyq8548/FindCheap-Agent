import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";

import { SHOPIFY_PILOTS } from "../apps/mcp-server/src/shopify-client.js";
import { auditShopifyRegistry } from "./audit-shopify-registry.js";

describe("Shopify registry technical audit", () => {
  it("passes only when every fixed merchant returns a public product", async () => {
    const probe = vi.fn(async () => 1);

    const report = await auditShopifyRegistry(probe);

    expect(SHOPIFY_PILOTS).toHaveLength(10);
    expect(probe).toHaveBeenCalledTimes(10);
    expect(report).toMatchObject({ decision: "PASS", merchantCount: 10, passed: 10, failed: 0 });
    expect(report.results.every((result) => result.status === "PASS")).toBe(true);
  });

  it("fails closed when one merchant errors or returns no products", async () => {
    const report = await auditShopifyRegistry(async (pilot) => {
      if (pilot.merchantId === "colourpop") throw new Error("HTTP 403");
      return pilot.merchantId === "liquid-death" ? 0 : 1;
    });

    expect(report).toMatchObject({ decision: "FAIL", merchantCount: 10, passed: 8, failed: 2 });
    expect(report.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ merchantId: "colourpop", status: "FAIL", reason: "HTTP 403" }),
      expect.objectContaining({ merchantId: "liquid-death", status: "FAIL", reason: "NO_PRODUCTS" })
    ]));
  });

  it("runs the live audit on a schedule without making pull requests depend on merchant uptime", async () => {
    const workflow = await readFile(new URL("../.github/workflows/shopify-registry-audit.yml", import.meta.url), "utf8");

    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("pnpm merchants:shopify-registry-audit");
    expect(workflow).not.toContain("pull_request:");
  });
});
