import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createShopifyStorefrontReader,
  type ShopifyStorefrontReader
} from "../packages/merchant-adapters/src/configured/shopify-storefront-reader.js";

const PILOT_HOST = "deathwishcoffee.com";

export type ShopifyProbeInput =
  | { kind: "query"; value: string; limit: number }
  | { kind: "handle"; value: string };

export function parseShopifyProbeArguments(arguments_: string[]): ShopifyProbeInput {
  const values = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  if (
    values.length === 2 &&
    values[0] === "--handle" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(values[1] ?? "") &&
    (values[1]?.length ?? 0) <= 200
  ) {
    return { kind: "handle", value: values[1]! };
  }
  if ((values.length === 2 || values.length === 4) && values[0] === "--query") {
    const query = values[1]?.trim() ?? "";
    let limit = 10;
    if (values.length === 4) {
      if (values[2] !== "--limit") throw new Error(usage());
      limit = Number(values[3]);
    }
    if (query.length < 2 || query.length > 300 || !Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new Error(usage());
    }
    return { kind: "query", value: query, limit };
  }
  throw new Error(usage());
}

export async function runShopifyProbe(
  reader: ShopifyStorefrontReader,
  input: ShopifyProbeInput
): Promise<Record<string, unknown>> {
  const snapshot = input.kind === "handle"
    ? await reader.capture({ operation: "get", merchantProductId: input.value })
    : await reader.capture({ operation: "search", query: input.value, limit: input.limit });
  return {
    source: "shopify-storefront",
    merchant: "Death Wish Coffee",
    sourceUrl: snapshot.sourceUrl,
    checkedAt: snapshot.checkedAt,
    products: snapshot.records
  };
}

function usage(): string {
  return "Usage: pnpm merchants:shopify-probe -- --query <text> [--limit 1-20] | --handle <product-handle>";
}

async function main(): Promise<void> {
  const reader = createShopifyStorefrontReader([PILOT_HOST, `www.${PILOT_HOST}`], {
    host: PILOT_HOST,
    apiVersion: "2026-07"
  });
  console.log(JSON.stringify(await runShopifyProbe(
    reader,
    parseShopifyProbeArguments(process.argv.slice(2))
  ), null, 2));
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Shopify Storefront probe failed");
    process.exitCode = 1;
  });
}
