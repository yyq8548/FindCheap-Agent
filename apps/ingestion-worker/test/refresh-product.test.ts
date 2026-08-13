import { describe, expect, it, vi } from "vitest";
import { Job, type MinimalQueue } from "bullmq";
import type {
  MerchantAdapter,
  RawMerchantOffer,
  RawPriceQuote,
  RefreshResult
} from "../../../packages/merchant-sdk/src/index.js";
import {
  PRODUCT_REFRESH_QUEUE,
  PRICE_REFRESH_QUEUE,
  enqueueProductRefresh,
  refreshIdempotencyKey,
  refreshJobId,
  refreshJobOptions,
  refreshWorkerOptions
} from "../src/queues.js";
import {
  refreshProduct,
  type RefreshProductDeps
} from "../src/jobs/refresh-product.js";
import type { EvidenceWrite, StoredEvidence } from "../src/evidence/store-evidence.js";
import {
  refreshPrice,
  type RefreshPriceDeps
} from "../src/jobs/refresh-price.js";

const now = new Date("2026-08-13T18:00:00.000Z");
const productJob = {
  merchantId: "merchant-a",
  merchantProductId: "sku-1",
  sourceVersion: "v1"
};
const priceJob = {
  ...productJob,
  zipCode: "10001",
  memberships: []
};

function refreshResult(overrides: Partial<RefreshResult> = {}): RefreshResult {
  return {
    merchantProductId: "sku-1",
    sourceUrl: "https://merchant.example/products/sku-1",
    rawEvidence: "raw merchant evidence",
    metadata: { sourceType: "api" },
    checkedAt: "2026-08-13T17:59:00.000Z",
    ...overrides
  };
}

function offer(overrides: Partial<RawMerchantOffer> = {}): RawMerchantOffer {
  return {
    merchantId: "merchant-a",
    merchantProductId: "sku-1",
    title: "Product",
    gtins: [],
    variantDimensions: {},
    currency: "USD",
    merchantUrl: "https://merchant.example/products/sku-1",
    evidenceRefs: ["adapter-evidence"],
    checkedAt: "2026-08-13T17:59:00.000Z",
    expiresAt: "2026-08-13T18:10:00.000Z",
    sellerName: "Merchant A",
    condition: "NEW",
    inventoryStatus: "IN_STOCK",
    itemPriceCents: 1_000,
    ...overrides
  };
}

function quote(overrides: Partial<RawPriceQuote> = {}): RawPriceQuote {
  return {
    merchantProductId: "sku-1",
    itemPriceCents: 1_000,
    shippingCents: 0,
    taxCents: 0,
    mandatoryFeeCents: 0,
    currency: "USD",
    status: "VERIFIED",
    conditions: [],
    evidenceRefs: ["adapter-evidence"],
    checkedAt: "2026-08-13T17:59:00.000Z",
    expiresAt: "2026-08-13T18:10:00.000Z",
    ...overrides
  };
}

function adapter(
  refresh = refreshResult(),
  merchantOffer: RawMerchantOffer | null = offer(),
  priceQuote = quote()
): MerchantAdapter {
  return {
    merchantId: "merchant-a",
    searchProducts: vi.fn(async () => []),
    getOffer: vi.fn(async () => merchantOffer),
    quoteDeliveredPrice: vi.fn(async () => priceQuote),
    getCoupons: vi.fn(async () => []),
    buildAffiliateLink: vi.fn(async (input) => ({
      url: input.merchantUrl,
      kind: "NORMAL" as const
    })),
    refreshProduct: vi.fn(async () => refresh),
    healthCheck: vi.fn(async () => ({
      status: "healthy" as const,
      source: "api" as const,
      checkedAt: now.toISOString()
    })),
    evidence: vi.fn(async () => [])
  };
}

function baseControls() {
  return {
    flags: {
      isMerchantEnabled: vi.fn(() => true),
      isSourceEnabled: vi.fn(() => true)
    },
    killSwitch: { isActive: vi.fn(() => false) },
    circuitBreaker: { isOpen: vi.fn(() => false) }
  };
}

function productDeps(merchantAdapter = adapter()) {
  const evidenceByKey = new Map<string, { id: string }>();
  const offersByKey = new Map<string, unknown>();
  const evidenceSave = vi.fn(async (write: EvidenceWrite): Promise<StoredEvidence> => {
    const existing = evidenceByKey.get(write.idempotencyKey);
    if (existing) return { ...write, ...existing };
    const saved = { ...write, id: `evidence-${evidenceByKey.size + 1}` };
    evidenceByKey.set(write.idempotencyKey, saved);
    return saved;
  });
  const offerUpsert = vi.fn(async (record: unknown, idempotencyKey: string) => {
    if (!offersByKey.has(idempotencyKey)) offersByKey.set(idempotencyKey, record);
  });
  const deps: RefreshProductDeps = {
    ...baseControls(),
    adapters: { get: vi.fn(() => merchantAdapter) },
    evidence: { save: evidenceSave },
    offers: { upsert: offerUpsert },
    clock: { now: () => new Date(now) },
    freshness: { ttlMs: 15 * 60_000, maxFutureSkewMs: 30_000 }
  };
  return { deps, evidenceByKey, offersByKey, evidenceSave, offerUpsert };
}

function priceDeps(previousPriceCents = 10_000, currentQuote = quote()) {
  const merchantAdapter = adapter(refreshResult(), offer(), currentQuote);
  const evidenceByKey = new Map<string, { id: string }>();
  const quotesByKey = new Map<string, unknown>();
  const evidenceSave = vi.fn(async (write: EvidenceWrite): Promise<StoredEvidence> => {
    const existing = evidenceByKey.get(write.idempotencyKey);
    if (existing) return { ...write, ...existing };
    const saved = { ...write, id: `evidence-${evidenceByKey.size + 1}` };
    evidenceByKey.set(write.idempotencyKey, saved);
    return saved;
  });
  const quoteSave = vi.fn(async (record: unknown, idempotencyKey: string) => {
    if (!quotesByKey.has(idempotencyKey)) quotesByKey.set(idempotencyKey, record);
  });
  const quarantineSave = vi.fn(async () => undefined);
  const deps: RefreshPriceDeps = {
    ...baseControls(),
    adapters: { get: vi.fn(() => merchantAdapter) },
    evidence: { save: evidenceSave },
    quotes: {
      previousDeliveredPriceCents: vi.fn(async () => previousPriceCents),
      save: quoteSave
    },
    quarantine: { save: quarantineSave },
    clock: { now: () => new Date(now) },
    freshness: { ttlMs: 15 * 60_000, maxFutureSkewMs: 30_000 }
  };
  return {
    deps,
    merchantAdapter,
    evidenceByKey,
    quotesByKey,
    evidenceSave,
    quoteSave,
    quarantineSave
  };
}

describe("refreshProduct", () => {
  it("stores evidence before publishing an offer", async () => {
    const { deps, evidenceSave, offerUpsert } = productDeps();

    await expect(refreshProduct(productJob, deps)).resolves.toMatchObject({ status: "PUBLISHED" });

    expect(evidenceSave).toHaveBeenCalledBefore(offerUpsert);
  });

  it("does not publish when durable evidence storage fails", async () => {
    const { deps, offerUpsert } = productDeps();
    vi.mocked(deps.evidence.save).mockRejectedValueOnce(new Error("evidence unavailable"));

    await expect(refreshProduct(productJob, deps)).rejects.toThrow("evidence unavailable");
    expect(offerUpsert).not.toHaveBeenCalled();
  });

  it("rejects empty evidence before publication", async () => {
    const { deps, offerUpsert } = productDeps(adapter(refreshResult({ rawEvidence: "" })));

    await expect(refreshProduct(productJob, deps)).rejects.toThrow(/evidence/i);
    expect(offerUpsert).not.toHaveBeenCalled();
  });

  it("uses stable idempotency keys so a retry does not duplicate evidence or offers", async () => {
    const { deps, evidenceByKey, offersByKey } = productDeps();

    await refreshProduct(productJob, deps);
    await refreshProduct(productJob, deps);

    expect(evidenceByKey.size).toBe(1);
    expect(offersByKey.size).toBe(1);
  });

  it.each([
    ["stale", { expiresAt: "2026-08-13T17:59:30.000Z" }],
    ["invalid", { expiresAt: "not-a-date" }],
    ["future-skewed", { checkedAt: "2026-08-13T18:01:00.000Z", expiresAt: "2026-08-13T18:10:00.000Z" }],
    ["excessive TTL", { checkedAt: "2026-08-13T17:59:00.000Z", expiresAt: "2026-08-13T19:00:00.000Z" }]
  ])("fails closed for %s offer freshness", async (_case, overrides) => {
    const { deps, offerUpsert } = productDeps(adapter(refreshResult(), offer(overrides)));

    await expect(refreshProduct(productJob, deps)).rejects.toThrow(/freshness/i);
    expect(offerUpsert).not.toHaveBeenCalled();
  });

  it("checks feature flags and kill switch before any adapter call", async () => {
    const merchantAdapter = adapter();
    const disabled = productDeps(merchantAdapter).deps;
    vi.mocked(disabled.flags.isMerchantEnabled).mockReturnValue(false);

    await expect(refreshProduct(productJob, disabled)).resolves.toEqual({ status: "DISABLED" });
    expect(merchantAdapter.refreshProduct).not.toHaveBeenCalled();

    const killed = productDeps(merchantAdapter).deps;
    vi.mocked(killed.killSwitch.isActive).mockReturnValue(true);
    await expect(refreshProduct(productJob, killed)).resolves.toEqual({ status: "KILL_SWITCHED" });
    expect(merchantAdapter.refreshProduct).not.toHaveBeenCalled();

    const circuitOpen = productDeps(merchantAdapter).deps;
    vi.mocked(circuitOpen.circuitBreaker.isOpen).mockReturnValue(true);
    await expect(refreshProduct(productJob, circuitOpen)).resolves.toEqual({ status: "CIRCUIT_OPEN" });
    expect(merchantAdapter.refreshProduct).not.toHaveBeenCalled();
  });
});

describe("refreshPrice", () => {
  it("quarantines an exact 90 percent price drop and saves no quote", async () => {
    const { deps, evidenceSave, quoteSave, quarantineSave } = priceDeps(10_000, quote({ itemPriceCents: 1_000 }));

    await expect(refreshPrice(priceJob, deps)).resolves.toMatchObject({ status: "QUARANTINED" });

    expect(quoteSave).not.toHaveBeenCalled();
    expect(evidenceSave).toHaveBeenCalledBefore(quarantineSave);
    expect(quarantineSave).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "PRICE_DROP_AT_LEAST_90_PERCENT",
        evidenceRefs: expect.arrayContaining(["evidence-1"])
      }),
      "merchant-a:sku-1:v1:quarantine"
    );
  });

  it.each([0, -1])("does not divide by a non-positive historical price (%s)", async (history) => {
    const { deps, quoteSave, quarantineSave } = priceDeps(history, quote({ itemPriceCents: 0 }));

    await expect(refreshPrice(priceJob, deps)).resolves.toMatchObject({ status: "PUBLISHED" });
    expect(quarantineSave).not.toHaveBeenCalled();
    expect(quoteSave).toHaveBeenCalledOnce();
  });

  it("rejects negative price components", async () => {
    const { deps, quoteSave } = priceDeps(10_000, quote({ shippingCents: -1 }));

    await expect(refreshPrice(priceJob, deps)).rejects.toThrow(/non-negative/i);
    expect(quoteSave).not.toHaveBeenCalled();
  });

  it.each([
    ["stale", { expiresAt: "2026-08-13T17:59:30.000Z" }],
    ["invalid", { checkedAt: "invalid" }],
    ["future-skewed", { checkedAt: "2026-08-13T18:01:00.000Z", expiresAt: "2026-08-13T18:10:00.000Z" }]
  ])("fails closed for %s quote freshness", async (_case, overrides) => {
    const { deps, evidenceSave, quoteSave } = priceDeps(10_000, quote(overrides));

    await expect(refreshPrice(priceJob, deps)).rejects.toThrow(/freshness/i);
    expect(evidenceSave).not.toHaveBeenCalled();
    expect(quoteSave).not.toHaveBeenCalled();
  });

  it("stores evidence before publishing a valid quote", async () => {
    const { deps, evidenceSave, quoteSave } = priceDeps(1_000, quote());

    await refreshPrice(priceJob, deps);

    expect(evidenceSave).toHaveBeenCalledBefore(quoteSave);
  });

  it("uses stable idempotency keys so a retry does not duplicate evidence or quotes", async () => {
    const { deps, evidenceByKey, quotesByKey } = priceDeps(1_000, quote({ itemPriceCents: 1_000 }));

    await refreshPrice(priceJob, deps);
    await refreshPrice(priceJob, deps);

    expect(evidenceByKey.size).toBe(1);
    expect(quotesByKey.size).toBe(1);
  });
});

describe("refresh queue policy", () => {
  it("uses named queues, exact deduplication IDs, retries, and bounded workers", () => {
    expect(PRODUCT_REFRESH_QUEUE).toBe("merchant-product-refresh");
    expect(PRICE_REFRESH_QUEUE).toBe("merchant-price-refresh");
    const logicalKey = "merchant-a:sku-1:v1";
    const bullJobId = refreshJobId(productJob);
    expect(refreshIdempotencyKey(productJob)).toBe(logicalKey);
    expect(Buffer.from(bullJobId, "base64url").toString("utf8")).toBe(logicalKey);
    expect(bullJobId).not.toContain(":");
    expect(refreshJobId({ ...productJob })).toBe(bullJobId);
    expect(refreshJobOptions(productJob)).toEqual({
      jobId: bullJobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: 1_000
    });
    expect(refreshWorkerOptions({ host: "redis", port: 6379 })).toEqual({
      connection: { host: "redis", port: 6379 },
      concurrency: 20,
      limiter: { max: 100, duration: 60_000 }
    });
  });

  it("places the logical idempotency key in job data and uses encoded BullMQ ID", async () => {
    const add = vi.fn(async () => undefined);

    await enqueueProductRefresh({ add }, productJob);

    expect(add).toHaveBeenCalledWith(
      "refresh",
      { ...productJob, idempotencyKey: "merchant-a:sku-1:v1" },
      expect.objectContaining({ jobId: refreshJobId(productJob) })
    );
  });

  it("produces options accepted by BullMQ without opening a Redis connection", () => {
    const options = refreshJobOptions(productJob);
    const queue = {
      name: PRODUCT_REFRESH_QUEUE,
      qualifiedName: `bull:${PRODUCT_REFRESH_QUEUE}`,
      toKey: (type: string) => `bull:${PRODUCT_REFRESH_QUEUE}:${type}`,
      backend: {}
    } as unknown as MinimalQueue;
    const bullJob = new Job(queue, "refresh", productJob, options, options.jobId);

    expect(() => bullJob.toFlowEntry()).not.toThrow();
  });
});
