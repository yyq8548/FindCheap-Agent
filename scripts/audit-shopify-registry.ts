import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SHOPIFY_PILOTS,
  type ShopifyPilot
} from "../apps/mcp-server/src/shopify-client.js";
import { SHOPIFY_REGISTRY } from "../apps/mcp-server/src/shopify-registry.js";
import { createShopifyStorefrontReader } from "../packages/merchant-adapters/src/configured/shopify-storefront-reader.js";

const MINIMUM_MERCHANTS = 20;
const MAX_PROBE_DURATION_MS = 3_000;
const MAX_P95_DURATION_MS = 2_500;

type Probe = (pilot: ShopifyPilot) => Promise<{ productCount: number; durationMs: number }>;

export async function auditShopifyRegistry(probe: Probe): Promise<{
  decision: "PASS" | "FAIL";
  registryVersion: string;
  merchantCount: number;
  passed: number;
  failed: number;
  coveragePercent: number;
  p95DurationMs: number;
  qualityFailures: string[];
  qualityGate: {
    minimumMerchants: number;
    maxProbeDurationMs: number;
    maxP95DurationMs: number;
  };
  results: Array<{
    merchantId: string;
    merchant: string;
    host: string;
    query: string;
    status: "PASS" | "FAIL";
    productCount: number;
    durationMs: number;
    reason?: string;
  }>;
}> {
  const results = await Promise.all(SHOPIFY_PILOTS.map(async (pilot) => {
    try {
      const { productCount, durationMs } = await probe(pilot);
      if (productCount < 1) {
        return result(pilot, "FAIL", 0, durationMs, "NO_PRODUCTS");
      }
      if (durationMs > MAX_PROBE_DURATION_MS) {
        return result(pilot, "FAIL", productCount, durationMs, "PROBE_LATENCY_EXCEEDED");
      }
      return result(pilot, "PASS", productCount, durationMs);
    } catch (error) {
      return result(pilot, "FAIL", 0, 0, error instanceof Error ? error.message.slice(0, 200) : "PROBE_FAILED");
    }
  }));
  const passed = results.filter((entry) => entry.status === "PASS").length;
  const durations = results.map((entry) => entry.durationMs).sort((left, right) => left - right);
  const p95DurationMs = durations[Math.ceil(durations.length * 0.95) - 1] ?? 0;
  const qualityFailures = [
    ...(SHOPIFY_PILOTS.length < MINIMUM_MERCHANTS ? ["MINIMUM_MERCHANTS"] : []),
    ...(p95DurationMs > MAX_P95_DURATION_MS ? ["P95_LATENCY_EXCEEDED"] : [])
  ];
  return {
    decision: passed === SHOPIFY_PILOTS.length && qualityFailures.length === 0 ? "PASS" : "FAIL",
    registryVersion: SHOPIFY_REGISTRY.version,
    merchantCount: SHOPIFY_PILOTS.length,
    passed,
    failed: SHOPIFY_PILOTS.length - passed,
    coveragePercent: Math.round(passed / SHOPIFY_PILOTS.length * 100),
    p95DurationMs,
    qualityFailures,
    qualityGate: {
      minimumMerchants: MINIMUM_MERCHANTS,
      maxProbeDurationMs: MAX_PROBE_DURATION_MS,
      maxP95DurationMs: MAX_P95_DURATION_MS
    },
    results
  };
}

function result(
  pilot: ShopifyPilot,
  status: "PASS" | "FAIL",
  productCount: number,
  durationMs: number,
  reason?: string
) {
  return {
    merchantId: pilot.merchantId,
    merchant: pilot.merchant,
    host: pilot.apiHost,
    query: pilot.probeQuery,
    status,
    productCount,
    durationMs,
    ...(reason === undefined ? {} : { reason })
  };
}

async function main(): Promise<void> {
  const report = await auditShopifyRegistry(async (pilot) => {
    const startedAt = performance.now();
    const reader = createShopifyStorefrontReader([...pilot.allowedHosts], {
      host: pilot.apiHost,
      apiVersion: pilot.apiVersion
    });
    const snapshot = await reader.capture({ operation: "search", query: pilot.probeQuery, limit: 1 });
    return {
      productCount: snapshot.records.length,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt))
    };
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.decision === "FAIL") process.exitCode = 1;
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Shopify registry audit failed");
    process.exitCode = 1;
  });
}
