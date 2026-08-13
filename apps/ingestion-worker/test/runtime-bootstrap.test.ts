import { describe, expect, it, vi } from "vitest";

import type { Database } from "../../../packages/db/src/client.js";
import type { GateApprovedMerchantConfig } from "../../../scripts/validate-enabled-merchants.js";
import type { ConfiguredSource } from "../../../packages/merchant-adapters/src/configured/configured-adapter.js";
import { parseMerchantSourceConfig } from "../../../packages/merchant-adapters/src/configured/source-config.js";
import { startIngestionRuntime } from "../src/runtime/bootstrap.js";

const candidate = {
  id: "approved-shop",
  name: "Approved Shop",
  segment: "general" as const,
  auditState: "approved" as const,
  legalReview: "approved" as const,
  affiliateStatus: "normal_link_only" as const,
  provenSource: "feed" as const,
  allowedHosts: ["data.approved-shop.example"],
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
    host: "data.approved-shop.example",
    resourcePath: "/feed.json",
    recordsPath: "products",
    fields: { merchantProductId: "id", title: "title" }
  },
  ttlSeconds: { product: 900, price: 900, inventory: 300, coupon: 900 },
  seller: { name: "Approved Shop", condition: "NEW" }
}, candidate);
const entry: GateApprovedMerchantConfig = { merchantId: candidate.id, candidate, config };

function fakeDatabase(events: string[]): Database {
  return {
    async connect() { events.push("db.connect"); },
    async close() { events.push("db.close"); },
    async query() { return { rows: [] }; },
    async transaction(work) { return work({ query: async () => ({ rows: [] }) }); }
  };
}

function fakeSource(): ConfiguredSource {
  return {
    merchantId: candidate.id,
    sourceType: "feed",
    async capture() { throw new Error("test source must not capture during bootstrap"); },
    async health() { return "healthy"; }
  };
}

describe("ingestion runtime bootstrap", () => {
  it("stays disabled with zero configs and opens no PostgreSQL or Redis resource", async () => {
    const createDatabase = vi.fn(() => fakeDatabase([]));
    const createQueues = vi.fn();
    const createWorkers = vi.fn();
    const runtime = await startIngestionRuntime({
      environment: {},
      logger: { info: vi.fn() },
      factories: {
        loadConfigs: async () => [],
        createDatabase,
        createQueues,
        createWorkers
      }
    });

    expect(runtime.health()).toEqual({
      status: "disabled",
      enabledMerchants: [],
      workersRunning: false,
      queueFailures: 0,
      circuitOpen: []
    });
    expect(createDatabase).not.toHaveBeenCalled();
    expect(createQueues).not.toHaveBeenCalled();
    expect(createWorkers).not.toHaveBeenCalled();
    await expect(runtime.enqueueProduct({
      merchantId: "unknown",
      merchantProductId: "sku",
      sourceVersion: "v1"
    })).rejects.toThrow(/disabled/i);
    await runtime.close();
    expect(runtime.health().status).toBe("stopped");
  });

  it("enforces an operator minimum before any connection is opened", async () => {
    const createDatabase = vi.fn(() => fakeDatabase([]));
    await expect(startIngestionRuntime({
      environment: { MERCHANT_MINIMUM_ENABLED: "1" },
      factories: { loadConfigs: async () => [], createDatabase }
    })).rejects.toThrow(/requires 1, found 0/i);
    expect(createDatabase).not.toHaveBeenCalled();
  });

  it("boots an approved nonzero registry and closes workers, queues, then PostgreSQL", async () => {
    const events: string[] = [];
    const productAdd = vi.fn(async () => undefined);
    const priceAdd = vi.fn(async () => undefined);
    const queue = (name: string, add: typeof productAdd) => ({
      add,
      async waitUntilReady() { events.push(`${name}.ready`); },
      async close() { events.push(`${name}.close`); }
    });
    const worker = (name: string) => ({
      on: vi.fn(),
      async waitUntilReady() { events.push(`${name}.ready`); },
      async close() { events.push(`${name}.close`); }
    });
    const productQueue = queue("product.queue", productAdd);
    const priceQueue = queue("price.queue", priceAdd);
    const productWorker = worker("product.worker");
    const priceWorker = worker("price.worker");
    const db = fakeDatabase(events);

    const runtime = await startIngestionRuntime({
      environment: {
        DATABASE_URL: "postgresql://shopping:local-only@127.0.0.1:5432/shopping",
        REDIS_URL: "redis://127.0.0.1:6379/0"
      },
      logger: { info: vi.fn() },
      factories: {
        loadConfigs: async () => [entry],
        createDatabase: () => db,
        createSource: () => fakeSource(),
        createPersistence: () => ({
          evidence: { save: vi.fn() },
          offers: { upsert: vi.fn() },
          quotes: { commit: vi.fn() },
          quarantine: { save: vi.fn() }
        }),
        createQueues: () => ({ product: productQueue, price: priceQueue }) as never,
        createWorkers: () => ({ product: productWorker, price: priceWorker }) as never
      }
    });

    expect(runtime.health()).toMatchObject({
      status: "running",
      enabledMerchants: [candidate.id],
      workersRunning: true
    });
    await runtime.enqueueProduct({
      merchantId: candidate.id,
      merchantProductId: "sku-1",
      sourceVersion: "v1"
    });
    expect(productAdd).toHaveBeenCalledTimes(1);

    await Promise.all([runtime.close(), runtime.close()]);
    expect(runtime.health().status).toBe("stopped");
    expect(events.filter((event) => event.endsWith(".close"))).toEqual([
      "product.worker.close",
      "price.worker.close",
      "product.queue.close",
      "price.queue.close",
      "db.close"
    ]);
  });

  it("does not create a database when the shared gate loader fails", async () => {
    const createDatabase = vi.fn(() => fakeDatabase([]));
    await expect(startIngestionRuntime({
      environment: {},
      factories: {
        loadConfigs: async () => { throw new Error("CONFIG_INVALID"); },
        createDatabase
      }
    })).rejects.toThrow(/CONFIG_INVALID/u);
    expect(createDatabase).not.toHaveBeenCalled();
  });
});
