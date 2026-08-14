import { describe, expect, it, vi } from "vitest";

import type { Processor } from "bullmq";

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
const brandMpnEntry: GateApprovedMerchantConfig = {
  merchantId: candidate.id,
  candidate,
  config: parseMerchantSourceConfig({
    merchantId: candidate.id,
    allowedHosts: candidate.allowedHosts,
    source: {
      type: "feed",
      host: "data.approved-shop.example",
      resourcePath: "/feed.json",
      recordsPath: "products",
      fields: {
        merchantProductId: "id",
        title: "title",
        brand: "brand",
        mpn: "mpn"
      }
    },
    ttlSeconds: { product: 900, price: 900, inventory: 300, coupon: 900 },
    seller: { name: "Approved Shop", condition: "NEW" }
  }, candidate)
};

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

  it("never emits production database or Redis credentials in health logs", async () => {
    const info = vi.fn();
    const runtime = await startIngestionRuntime({
      environment: {
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://worker:database-secret@db.example/shopping?sslmode=verify-full",
        REDIS_URL: "rediss://worker:redis-secret@redis.example:6380/0"
      },
      logger: { info },
      factories: { loadConfigs: async () => [] }
    });

    expect(JSON.stringify(info.mock.calls)).not.toMatch(/database-secret|redis-secret/u);
    await runtime.close();
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

  it("fails before queues and workers when Brand+MPN identity keys need backfill", async () => {
    const events: string[] = [];
    const database = fakeDatabase(events);
    vi.spyOn(database, "query").mockResolvedValueOnce({
      rows: [{ missing_count: "2" }]
    } as never);
    const createQueues = vi.fn();
    const createWorkers = vi.fn();

    await expect(startIngestionRuntime({
      environment: {
        DATABASE_URL: "postgresql://shopping:local-only@127.0.0.1:5432/shopping",
        REDIS_URL: "redis://127.0.0.1:6379/0"
      },
      logger: { info: vi.fn() },
      factories: {
        loadConfigs: async () => [brandMpnEntry],
        createDatabase: () => database,
        createSource: () => fakeSource(),
        createQueues,
        createWorkers
      }
    })).rejects.toThrow(/backfill required.*--apply/i);

    expect(events).toEqual(["db.connect", "db.close"]);
    expect(createQueues).not.toHaveBeenCalled();
    expect(createWorkers).not.toHaveBeenCalled();
  });

  it("keeps an open circuit open when the worker short-circuits without a source call", async () => {
    const events: string[] = [];
    const capture = vi.fn(async () => { throw new Error("source unavailable"); });
    let productHandler: Processor;
    const queue = {
      add: vi.fn(async () => undefined),
      waitUntilReady: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined)
    };
    const worker = {
      on: vi.fn(),
      waitUntilReady: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined)
    };
    const runtime = await startIngestionRuntime({
      environment: {
        DATABASE_URL: "postgresql://shopping:local-only@127.0.0.1:5432/shopping",
        REDIS_URL: "redis://127.0.0.1:6379/0",
        INGESTION_CIRCUIT_FAILURE_THRESHOLD: "1"
      },
      logger: { info: vi.fn() },
      factories: {
        loadConfigs: async () => [entry],
        createDatabase: () => fakeDatabase(events),
        createSource: () => ({ ...fakeSource(), capture }),
        createPersistence: () => ({
          evidence: { save: vi.fn() },
          offers: { upsert: vi.fn() },
          quotes: { commit: vi.fn() },
          quarantine: { save: vi.fn() }
        }),
        createQueues: () => ({ product: queue, price: queue }) as never,
        createWorkers: (_connection, handlers) => {
          productHandler = handlers.product;
          return { product: worker, price: worker } as never;
        }
      }
    });
    const job = {
      data: { merchantId: candidate.id, merchantProductId: "sku-1", sourceVersion: "v1" }
    } as never;

    await expect(productHandler!(job)).rejects.toThrow(/source unavailable/i);
    await expect(productHandler!(job)).resolves.toEqual({ status: "CIRCUIT_OPEN" });
    await expect(productHandler!(job)).resolves.toEqual({ status: "CIRCUIT_OPEN" });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(runtime.health().circuitOpen).toEqual([candidate.id]);
    await runtime.close();
  });

  it("opens only for consecutive adapter source failures and resets after source staging succeeds", async () => {
    const events: string[] = [];
    const capture = vi.fn()
      .mockRejectedValueOnce(new Error("source-one"))
      .mockResolvedValueOnce({
        merchantId: candidate.id,
        sourceType: "feed",
        records: [],
        sourceUrl: "https://data.approved-shop.example/feed.json",
        rawEvidence: "not found evidence",
        metadata: { sourceType: "feed", sourceVersion: "success" },
        checkedAt: new Date().toISOString()
      })
      .mockRejectedValueOnce(new Error("source-two"))
      .mockRejectedValueOnce(new Error("source-three"));
    let productHandler: Processor;
    const queue = {
      add: vi.fn(async () => undefined),
      waitUntilReady: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined)
    };
    const worker = {
      on: vi.fn(),
      waitUntilReady: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined)
    };
    const runtime = await startIngestionRuntime({
      environment: {
        DATABASE_URL: "postgresql://shopping:local-only@127.0.0.1:5432/shopping",
        REDIS_URL: "redis://127.0.0.1:6379/0",
        INGESTION_CIRCUIT_FAILURE_THRESHOLD: "2"
      },
      logger: { info: vi.fn() },
      factories: {
        loadConfigs: async () => [entry],
        createDatabase: () => fakeDatabase(events),
        createSource: () => ({ ...fakeSource(), capture }),
        createPersistence: () => ({
          evidence: { save: vi.fn(async (write) => ({ status: "STORED" as const, record: write })) },
          offers: { upsert: vi.fn() },
          quotes: { commit: vi.fn() },
          quarantine: { save: vi.fn() }
        }),
        createPromotions: () => ({
          promoteProduct: vi.fn(),
          promoteQuote: vi.fn(),
          promotePendingQuotes: vi.fn()
        }),
        createQueues: () => ({ product: queue, price: queue }) as never,
        createWorkers: (_connection, handlers) => {
          productHandler = handlers.product;
          return { product: worker, price: worker } as never;
        }
      }
    });
    const jobs = ["one", "success", "two", "three"].map((sourceVersion) => ({
      data: { merchantId: candidate.id, merchantProductId: "sku-1", sourceVersion }
    } as never));
    await expect(productHandler!(jobs[0]!)).rejects.toThrow(/source-one/i);
    expect(runtime.health().circuitOpen).toEqual([]);
    await expect(productHandler!(jobs[1]!)).resolves.toEqual({ status: "NOT_FOUND" });
    await expect(productHandler!(jobs[2]!)).rejects.toThrow(/source-two/i);
    expect(runtime.health().circuitOpen).toEqual([]);
    await expect(productHandler!(jobs[3]!)).rejects.toThrow(/source-three/i);
    expect(runtime.health().circuitOpen).toEqual([candidate.id]);
    await runtime.close();
  });

  it("retries internal promotion failures without opening the merchant source circuit", async () => {
    const events: string[] = [];
    const now = new Date();
    const capture = vi.fn(async () => ({
      merchantId: candidate.id,
      sourceType: "feed" as const,
      records: [{
        merchantProductId: "sku-1",
        title: "Product",
        gtins: [],
        rawOffer: {
          price: "10.00",
          priceCurrency: "USD",
          availability: "InStock",
          url: "https://data.approved-shop.example/products/sku-1"
        }
      }],
      sourceUrl: "https://data.approved-shop.example/feed.json",
      rawEvidence: "source evidence",
      metadata: { sourceType: "feed", sourceVersion: "v1" },
      checkedAt: now.toISOString()
    }));
    let productHandler: Processor;
    const queue = { add: vi.fn(), waitUntilReady: vi.fn(), close: vi.fn() };
    const worker = { on: vi.fn(), waitUntilReady: vi.fn(), close: vi.fn() };
    const promoteProduct = vi.fn(async () => { throw new Error("promotion db unavailable"); });
    const runtime = await startIngestionRuntime({
      environment: {
        DATABASE_URL: "postgresql://shopping:local-only@127.0.0.1:5432/shopping",
        REDIS_URL: "redis://127.0.0.1:6379/0",
        INGESTION_CIRCUIT_FAILURE_THRESHOLD: "1"
      },
      clock: { now: () => now },
      logger: { info: vi.fn() },
      factories: {
        loadConfigs: async () => [entry],
        createDatabase: () => fakeDatabase(events),
        createSource: () => ({ ...fakeSource(), capture }),
        createPersistence: () => ({
          evidence: { save: vi.fn(async (write) => ({ status: "STORED" as const, record: write })) },
          offers: { upsert: vi.fn() },
          quotes: { commit: vi.fn() },
          quarantine: { save: vi.fn() }
        }),
        createPromotions: () => ({ promoteProduct, promoteQuote: vi.fn(), promotePendingQuotes: vi.fn() }),
        createQueues: () => ({ product: queue, price: queue }) as never,
        createWorkers: (_connection, handlers) => {
          productHandler = handlers.product;
          return { product: worker, price: worker } as never;
        }
      }
    });
    const job = { data: { merchantId: candidate.id, merchantProductId: "sku-1", sourceVersion: "v1" } } as never;
    await expect(productHandler!(job)).rejects.toThrow(/promotion db unavailable/i);
    expect(runtime.health().circuitOpen).toEqual([]);
    expect(promoteProduct).toHaveBeenCalledOnce();
    await runtime.close();
  });

  it("preserves the startup error while attempting every cleanup and attaching cleanup failures", async () => {
    const events: string[] = [];
    const primary = new Error("primary worker startup failure");
    const cleanupWorker = new Error("worker cleanup failure");
    const cleanupQueue = new Error("queue cleanup failure");
    const cleanupDatabase = new Error("database cleanup failure");
    const productQueue = {
      add: vi.fn(),
      waitUntilReady: vi.fn(async () => undefined),
      async close() { events.push("product.queue.close"); throw cleanupQueue; }
    };
    const priceQueue = {
      add: vi.fn(),
      waitUntilReady: vi.fn(async () => undefined),
      async close() { events.push("price.queue.close"); }
    };
    const productWorker = {
      on: vi.fn(),
      async waitUntilReady() { throw primary; },
      async close() { events.push("product.worker.close"); throw cleanupWorker; }
    };
    const priceWorker = {
      on: vi.fn(),
      waitUntilReady: vi.fn(async () => undefined),
      async close() { events.push("price.worker.close"); }
    };
    const database: Database = {
      connect: vi.fn(async () => undefined),
      async close() { events.push("db.close"); throw cleanupDatabase; },
      async query() { return { rows: [] }; },
      async transaction(work) { return work({ query: async () => ({ rows: [] }) }); }
    };

    let caught: unknown;
    try {
      await startIngestionRuntime({
        environment: {
          DATABASE_URL: "postgresql://shopping:local-only@127.0.0.1:5432/shopping",
          REDIS_URL: "redis://127.0.0.1:6379/0"
        },
        logger: { info: vi.fn() },
        factories: {
          loadConfigs: async () => [entry],
          createDatabase: () => database,
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
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(primary);
    expect((caught as Error).message).toBe("primary worker startup failure");
    expect((caught as Error).name).toBe("Error");
    expect((caught as Error).stack).toBe(primary.stack);
    expect((caught as Error & { cleanupErrors: unknown[] }).cleanupErrors).toEqual([
      cleanupWorker,
      cleanupQueue,
      cleanupDatabase
    ]);
    expect(events).toEqual([
      "product.worker.close",
      "price.worker.close",
      "product.queue.close",
      "price.queue.close",
      "db.close"
    ]);
  });
});
