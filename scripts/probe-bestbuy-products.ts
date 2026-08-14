import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createBestBuyProductsReader,
  type BestBuyProductsReader
} from "../packages/merchant-adapters/src/configured/bestbuy-products-reader.js";

export type BestBuyProbeInput =
  | { kind: "query"; value: string; limit: number }
  | { kind: "sku"; value: string };

export function parseBestBuyProbeArguments(arguments_: string[]): BestBuyProbeInput {
  const values = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  if (values.length === 2 && values[0] === "--sku" && /^\d{1,20}$/u.test(values[1] ?? "")) {
    return { kind: "sku", value: values[1]! };
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

export async function runBestBuyProbe(
  reader: BestBuyProductsReader,
  input: BestBuyProbeInput
): Promise<unknown> {
  const snapshot = input.kind === "sku"
    ? await reader.capture({ operation: "get", merchantProductId: input.value })
    : await reader.capture({ operation: "search", query: input.value, limit: input.limit });
  return {
    source: "bestbuy-products",
    sourceUrl: snapshot.sourceUrl,
    checkedAt: snapshot.checkedAt,
    products: snapshot.records
  };
}

function usage(): string {
  return "Usage: pnpm merchants:bestbuy-probe -- --query <text> [--limit 1-20] | --sku <digits>";
}

async function main(): Promise<void> {
  const apiKey = process.env.BEST_BUY_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("BEST_BUY_API_KEY is required");
  }
  const reader = createBestBuyProductsReader(["api.bestbuy.com"], { apiKey });
  console.log(JSON.stringify(await runBestBuyProbe(
    reader,
    parseBestBuyProbeArguments(process.argv.slice(2))
  ), null, 2));
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Best Buy probe failed");
    process.exitCode = 1;
  });
}
