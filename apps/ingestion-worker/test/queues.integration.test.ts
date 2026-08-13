import { randomUUID } from "node:crypto";

import { QueueEvents } from "bullmq";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { MerchantAdapter } from "../../../packages/merchant-sdk/src/index.js";
import type {
  EvidenceRepository,
  EvidenceWrite,
  StoredEvidence
} from "../src/evidence/store-evidence.js";
import { refreshProduct, type PublishedOffer } from "../src/jobs/refresh-product.js";
import {
  createRefreshQueues,
  createRefreshWorkers,
  enqueueProductRefresh,
  PRODUCT_REFRESH_QUEUE,
  refreshIdempotencyKey,
  refreshJobId
} from "../src/queues.js";

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379/0");
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || "6379"),
  db: Number(redisUrl.pathname.slice(1) || "0"),
  maxRetriesPerRequest: null
};
const prefix = `merchant-integration-${randomUUID()}`;
const queueEvents = new QueueEvents(PRODUCT_REFRESH_QUEUE, { connection, prefix });
const queues = createRefreshQueues(connection, { prefix });

const sourceVersion = "redis-integration-v1";
const refreshJob = {
  merchantId: "integration-shop",
  merchantProductId: "sku-redis-1",
  sourceVersion
};

function inMemoryEvidenceRepository() {
  const records = new Map<string, StoredEvidence>();
  const save = vi.fn<EvidenceRepository["save"]>(async (write: EvidenceWrite) => {
    const existing = records.get(write.sourceIdentityKey);
    if (existing !== undefined) return { status: "REUSED", record: existing };
    records.set(write.sourceIdentityKey, write);
    return { status: "STORED", record: write };
  });
  return { records, save };
}

describe("BullMQ refresh integration", () => {
  let workers: ReturnType<typeof createRefreshWorkers>;

  beforeAll(async () => {
    await Promise.all([queueEvents.waitUntilReady(), queues.product.waitUntilReady(), queues.price.waitUntilReady()]);
  });

  afterAll(async () => {
    await Promise.all([workers?.product.close(), workers?.price.close()]);
    await Promise.all([queues.product.close(), queues.price.close(), queueEvents.close()]);
  });

  it("retries transient failure, deduplicates the stable job ID, and publishes once", async () => {
    const now = new Date();
    const checkedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 300_000).toISOString();
    const evidence = inMemoryEvidenceRepository();
    const publications = new Map<string, PublishedOffer>();
    let publicationAttempts = 0;
    const upsert = vi.fn(async (offer: PublishedOffer, idempotencyKey: string) => {
      publicationAttempts += 1;
      if (publicationAttempts === 1) throw new Error("injected transient publication failure");
      if (!publications.has(idempotencyKey)) publications.set(idempotencyKey, offer);
    });
    const adapter = {
      merchantId: refreshJob.merchantId,
      async refreshOffer(input: { merchantProductId: string; sourceVersion: string }) {
        return {
          merchantProductId: input.merchantProductId,
          sourceVersion: input.sourceVersion,
          sourceUrl: "https://integration-shop.example/products/sku-redis-1",
          rawEvidence: "redis integration evidence",
          metadata: { sourceType: "http" },
          checkedAt,
          offer: {
            merchantId: refreshJob.merchantId,
            merchantProductId: input.merchantProductId,
            title: "Redis Integration Product",
            gtins: [],
            variantDimensions: {},
            currency: "USD" as const,
            merchantUrl: "https://integration-shop.example/products/sku-redis-1",
            evidenceRefs: ["source-ref"],
            checkedAt,
            expiresAt,
            sellerName: "Integration Shop",
            condition: "NEW" as const,
            inventoryStatus: "IN_STOCK" as const,
            itemPriceCents: 1_999
          }
        };
      }
    } as unknown as MerchantAdapter;
    let attempts = 0;
    workers = createRefreshWorkers(connection, {
      product: async (job) => {
        attempts += 1;
        return refreshProduct(job.data, {
          adapters: { get: () => adapter },
          evidence: { save: evidence.save },
          offers: { upsert },
          flags: { isMerchantEnabled: () => true, isSourceEnabled: () => true },
          killSwitch: { isActive: () => false },
          circuitBreaker: { isOpen: () => false },
          clock: { now: () => now },
          freshness: {
            ttlMs: 600_000,
            maxFutureSkewMs: 5_000,
            evidenceMaxAgeMs: 600_000,
            maxEvidenceToEntitySkewMs: 5_000
          }
        });
      },
      price: async () => ({ status: "DISABLED" })
    }, { prefix, concurrency: 1 });
    await Promise.all([workers.product.waitUntilReady(), workers.price.waitUntilReady()]);

    const logicalKey = refreshIdempotencyKey(refreshJob);
    const jobId = refreshJobId(refreshJob);
    expect(Buffer.from(jobId, "base64url").toString("hex")).toBe(logicalKey);

    await Promise.all([
      enqueueProductRefresh(queues.product, refreshJob),
      enqueueProductRefresh(queues.product, { ...refreshJob })
    ]);
    const job = await queues.product.getJob(jobId);
    expect(job).not.toBeUndefined();
    await expect(job!.waitUntilFinished(queueEvents, 10_000)).resolves.toMatchObject({
      status: "PUBLISHED"
    });

    expect(attempts).toBe(2);
    expect(evidence.save).toHaveBeenCalledTimes(2);
    expect(evidence.records).toHaveLength(1);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(publications).toHaveLength(1);
    expect(await queues.product.getJobCounts("failed", "active", "waiting", "delayed"))
      .toEqual({ failed: 0, active: 0, waiting: 0, delayed: 0 });
  }, 15_000);
});
