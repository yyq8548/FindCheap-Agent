import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../../packages/db/src/client.js";
import { runMigrations } from "../../../packages/db/src/migrate.js";
import type { ConfiguredSource } from "../../../packages/merchant-adapters/src/configured/configured-adapter.js";
import { parseMerchantSourceConfig } from "../../../packages/merchant-adapters/src/configured/source-config.js";
import type { GateApprovedMerchantConfig } from "../../../scripts/validate-enabled-merchants.js";
import { createRefreshQueues, createRefreshWorkers } from "../src/queues.js";
import { startIngestionRuntime, type IngestionRuntime } from "../src/runtime/bootstrap.js";

const databaseUrl = process.env.DATABASE_URL ??
  "postgresql://shopping:local-only@127.0.0.1:5432/shopping";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379/0";
const schemaName = `worker_runtime_${randomUUID().replaceAll("-", "")}`;
const adminDb = createDatabase(databaseUrl);
let runtimeDb: Database;
let inspectDb: Database;
let isolatedDatabaseUrl: string;
let runtime: IngestionRuntime | undefined;

function approvedEntry(): GateApprovedMerchantConfig {
  const candidate = {
    id: "runtime-shop",
    name: "Runtime Shop",
    segment: "general" as const,
    auditState: "approved" as const,
    legalReview: "approved" as const,
    affiliateStatus: "normal_link_only" as const,
    provenSource: "feed" as const,
    allowedHosts: ["runtime-shop.example"],
    affiliateHosts: [],
    affiliateOrigins: [],
    identityCompleteness: 0.95,
    weightedScore: 90,
    enabled: true
  };
  const config = parseMerchantSourceConfig({
    merchantId: candidate.id,
    allowedHosts: candidate.allowedHosts,
    source: {
      type: "feed",
      host: "runtime-shop.example",
      resourcePath: "/products.json",
      recordsPath: "products",
      fields: { merchantProductId: "id", title: "title" }
    },
    ttlSeconds: { product: 900, price: 900, inventory: 300, coupon: 900 },
    seller: { name: "Runtime Shop", condition: "NEW" }
  }, candidate);
  return { merchantId: candidate.id, candidate, config };
}

function source(sourceVersion: string): ConfiguredSource {
  return {
    merchantId: "runtime-shop",
    sourceType: "feed",
    async capture() {
      const checkedAt = new Date().toISOString();
      return {
        merchantId: "runtime-shop",
        sourceType: "feed",
        records: [{
          merchantProductId: "sku-runtime-1",
          title: "Runtime Product",
          gtins: [],
          rawOffer: {
            price: "19.99",
            priceCurrency: "USD",
            availability: "InStock",
            url: "https://runtime-shop.example/products/sku-runtime-1"
          }
        }],
        sourceUrl: "https://runtime-shop.example/products.json",
        rawEvidence: `runtime evidence ${sourceVersion}`,
        metadata: { sourceType: "feed", sourceVersion },
        checkedAt
      };
    },
    async health() { return "healthy"; }
  };
}

async function waitForCount(table: string, expected: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await inspectDb.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
    if (Number(result.rows[0]?.count) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${table} count ${expected}`);
}

beforeAll(async () => {
  await adminDb.connect();
  await adminDb.query(`CREATE SCHEMA "${schemaName}"`);
  const isolated = new URL(databaseUrl);
  isolated.searchParams.set("options", `-csearch_path=${schemaName}`);
  isolatedDatabaseUrl = isolated.toString();
  runtimeDb = createDatabase(isolatedDatabaseUrl);
  inspectDb = createDatabase(isolatedDatabaseUrl);
  await Promise.all([runtimeDb.connect(), inspectDb.connect()]);
  await runMigrations(runtimeDb);
});

afterAll(async () => {
  await runtime?.close();
  await inspectDb.close();
  await adminDb.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminDb.close();
});

describe("production ingestion runtime integration", () => {
  it("runs an approved offer through real Redis and PostgreSQL exactly once", async () => {
    const entry = approvedEntry();
    const sourceVersion = `runtime-${randomUUID()}`;
    const prefix = `runtime-${randomUUID()}`;
    runtime = await startIngestionRuntime({
      environment: { DATABASE_URL: databaseUrl, REDIS_URL: redisUrl },
      logger: { info: () => undefined },
      factories: {
        loadConfigs: async () => [entry],
        createDatabase: () => runtimeDb,
        createSource: () => source(sourceVersion),
        createQueues: (connection) => createRefreshQueues(connection, { prefix }),
        createWorkers: (connection, handlers) =>
          createRefreshWorkers(connection, handlers, { prefix, concurrency: 1 })
      }
    });

    const job = {
      merchantId: entry.merchantId,
      merchantProductId: "sku-runtime-1",
      sourceVersion
    };
    await Promise.all([runtime.enqueueProduct(job), runtime.enqueueProduct({ ...job })]);
    await waitForCount("merchant_product_staging", 1);

    const counts = await Promise.all([
      inspectDb.query<{ count: string }>("SELECT count(*)::text AS count FROM ingestion_evidence"),
      inspectDb.query<{ count: string }>("SELECT count(*)::text AS count FROM merchant_product_staging"),
      inspectDb.query<{ count: string }>("SELECT count(*)::text AS count FROM ingestion_idempotency")
    ]);
    expect(counts.map((result) => Number(result.rows[0]?.count))).toEqual([1, 1, 1]);

    await runtime.close();
    expect(runtime.health()).toMatchObject({ status: "stopped", workersRunning: false });
  }, 15_000);
});
