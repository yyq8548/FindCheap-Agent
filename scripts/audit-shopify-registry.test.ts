import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";

import { SHOPIFY_PILOTS } from "../apps/mcp-server/src/shopify-client.js";
import { auditShopifyRegistry } from "./audit-shopify-registry.js";

describe("Shopify registry technical audit", () => {
  it("passes only when every fixed merchant returns a public product", async () => {
    const probe = vi.fn(async () => ({ productCount: 1, durationMs: 100 }));

    const report = await auditShopifyRegistry(probe);

    expect(SHOPIFY_PILOTS).toHaveLength(45);
    expect(probe).toHaveBeenCalledTimes(45);
    expect(report).toMatchObject({
      decision: "PASS", merchantCount: 45, passed: 45, failed: 0,
      registryVersion: "v3", coveragePercent: 100, p95DurationMs: 100, qualityFailures: [],
      qualityGate: {
        minimumMerchants: 40,
        maxProbeDurationMs: 3_000,
        maxP95DurationMs: 2_500,
        maxProbeAttempts: 2
      }
    });
    expect(report.results.every((result) => result.status === "PASS")).toBe(true);
  });

  it("recovers one transient probe failure with one bounded retry", async () => {
    const attempts = new Map<string, number>();
    const report = await auditShopifyRegistry(async (pilot) => {
      const attempt = (attempts.get(pilot.merchantId) ?? 0) + 1;
      attempts.set(pilot.merchantId, attempt);
      if (pilot.merchantId === "tentree" && attempt === 1) throw new Error("request blocked");
      return { productCount: 1, durationMs: 100 };
    });

    expect(report.decision).toBe("PASS");
    expect(attempts.get("tentree")).toBe(2);
    expect([...attempts.values()].filter((attemptsForMerchant) => attemptsForMerchant === 2)).toHaveLength(1);
  });

  it("fails closed when one merchant errors or returns no products", async () => {
    const report = await auditShopifyRegistry(async (pilot) => {
      if (pilot.merchantId === "colourpop") throw new Error("HTTP 403");
      return { productCount: pilot.merchantId === "liquid-death" ? 0 : 1, durationMs: 100 };
    });

    expect(report).toMatchObject({ decision: "FAIL", merchantCount: 45, passed: 43, failed: 2 });
    expect(report.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ merchantId: "colourpop", status: "FAIL", reason: "HTTP 403" }),
      expect.objectContaining({ merchantId: "liquid-death", status: "FAIL", reason: "NO_PRODUCTS" })
    ]));
  });

  it("fails the release quality gate when a probe or p95 latency exceeds its budget", async () => {
    const report = await auditShopifyRegistry(async (pilot) => ({
      productCount: 1,
      durationMs: pilot.merchantId === "glossier" ? 3_001 : 2_600
    }));

    expect(report).toMatchObject({
      decision: "FAIL",
      passed: 44,
      failed: 1,
      p95DurationMs: 2_600,
      qualityFailures: ["P95_LATENCY_EXCEEDED"]
    });
    expect(report.results).toContainEqual(expect.objectContaining({
      merchantId: "glossier",
      status: "FAIL",
      reason: "PROBE_LATENCY_EXCEEDED"
    }));
  });

  it("runs the live audit on a schedule without making pull requests depend on merchant uptime", async () => {
    const workflow = await readFile(new URL("../.github/workflows/shopify-registry-audit.yml", import.meta.url), "utf8");

    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("pnpm merchants:shopify-registry-audit");
    expect(workflow).not.toContain("pull_request:");
  });
});
