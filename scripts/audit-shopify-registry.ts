import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SHOPIFY_PILOTS,
  type ShopifyPilot
} from "../apps/mcp-server/src/shopify-client.js";
import { createShopifyStorefrontReader } from "../packages/merchant-adapters/src/configured/shopify-storefront-reader.js";

type Probe = (pilot: ShopifyPilot) => Promise<number>;

export async function auditShopifyRegistry(probe: Probe): Promise<{
  decision: "PASS" | "FAIL";
  merchantCount: number;
  passed: number;
  failed: number;
  results: Array<{
    merchantId: string;
    merchant: string;
    host: string;
    query: string;
    status: "PASS" | "FAIL";
    productCount: number;
    reason?: string;
  }>;
}> {
  const results = await Promise.all(SHOPIFY_PILOTS.map(async (pilot) => {
    try {
      const productCount = await probe(pilot);
      if (productCount < 1) {
        return result(pilot, "FAIL", 0, "NO_PRODUCTS");
      }
      return result(pilot, "PASS", productCount);
    } catch (error) {
      return result(pilot, "FAIL", 0, error instanceof Error ? error.message.slice(0, 200) : "PROBE_FAILED");
    }
  }));
  const passed = results.filter((entry) => entry.status === "PASS").length;
  return {
    decision: passed === SHOPIFY_PILOTS.length ? "PASS" : "FAIL",
    merchantCount: SHOPIFY_PILOTS.length,
    passed,
    failed: SHOPIFY_PILOTS.length - passed,
    results
  };
}

function result(
  pilot: ShopifyPilot,
  status: "PASS" | "FAIL",
  productCount: number,
  reason?: string
) {
  return {
    merchantId: pilot.merchantId,
    merchant: pilot.merchant,
    host: pilot.apiHost,
    query: pilot.probeQuery,
    status,
    productCount,
    ...(reason === undefined ? {} : { reason })
  };
}

async function main(): Promise<void> {
  const report = await auditShopifyRegistry(async (pilot) => {
    const reader = createShopifyStorefrontReader([...pilot.allowedHosts], {
      host: pilot.apiHost,
      apiVersion: pilot.apiVersion
    });
    const snapshot = await reader.capture({ operation: "search", query: pilot.probeQuery, limit: 1 });
    return snapshot.records.length;
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
