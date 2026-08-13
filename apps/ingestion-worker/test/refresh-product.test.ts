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
  enqueuePriceRefresh,
  refreshIdempotencyKey,
  refreshJobId,
  refreshJobOptions,
  refreshWorkerOptions
} from "../src/queues.js";
import {
  refreshProduct,
  type RefreshProductDeps
} from "../src/jobs/refresh-product.js";
import type {
  EvidenceSaveResult,
  EvidenceWrite,
  StoredEvidence
} from "../src/evidence/store-evidence.js";
import {
  refreshPrice,
  type RefreshPriceDeps
} from "../src/jobs/refresh-price.js";
import {
  canonicalizePriceRefreshJob,
  canonicalizeProductRefreshJob,
  quoteContextKey
} from "../src/jobs/refresh-identity.js";
import { detectPriceAnomaly } from "../src/quality/quarantine.js";

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
    sourceVersion: "v1",
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
    refreshPrice: vi.fn(async (input) => ({
      merchantProductId: input.merchantProductId,
      sourceVersion: input.sourceVersion,
      sourceUrl: refresh.sourceUrl,
      rawEvidence: refresh.rawEvidence,
      metadata: refresh.metadata,
      checkedAt: refresh.checkedAt,
      quote: priceQuote
    })),
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
  const evidenceByKey = new Map<string, StoredEvidence>();
  const offersByKey = new Map<string, unknown>();
  const evidenceSave = vi.fn(async (write: EvidenceWrite): Promise<EvidenceSaveResult> => {
    const existing = evidenceByKey.get(write.sourceIdentityKey);
    if (existing) {
      return existing.contentHash === write.contentHash
        ? { status: "REUSED", record: existing }
        : {
          status: "CONFLICT",
          evidenceId: existing.id,
          expectedContentHash: existing.contentHash,
          actualContentHash: write.contentHash
        };
    }
    evidenceByKey.set(write.sourceIdentityKey, write);
    return { status: "STORED", record: write };
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
    freshness: {
      ttlMs: 15 * 60_000,
      maxFutureSkewMs: 30_000,
      evidenceMaxAgeMs: 15 * 60_000,
      maxEvidenceToEntitySkewMs: 30_000
    }
  };
  return { deps, evidenceByKey, offersByKey, evidenceSave, offerUpsert };
}

function priceDeps(previousPriceCents = 10_000, currentQuote = quote()) {
  const merchantAdapter = adapter(refreshResult(), offer(), currentQuote);
  const evidenceByKey = new Map<string, StoredEvidence>();
  const quotesByKey = new Map<string, unknown>();
  const evidenceSave = vi.fn(async (write: EvidenceWrite) => {
    const existing = evidenceByKey.get(write.sourceIdentityKey);
    if (existing) {
      return existing.contentHash === write.contentHash
        ? { status: "REUSED" as const, record: existing }
        : {
          status: "CONFLICT" as const,
          evidenceId: existing.id,
          expectedContentHash: existing.contentHash,
          actualContentHash: write.contentHash
        };
    }
    evidenceByKey.set(write.sourceIdentityKey, write);
    return { status: "STORED" as const, record: write };
  });
  const quarantineSave = vi.fn(async (
    _record: Parameters<RefreshPriceDeps["quarantine"]["save"]>[0],
    _idempotencyKey: string
  ) => undefined);
  const quoteCommit = vi.fn(async (input: Parameters<RefreshPriceDeps["quotes"]["commit"]>[0]) => {
    if (quotesByKey.has(input.publicationKey)) return { status: "PUBLISHED" as const };
    const anomaly = detectPriceAnomaly(input.quote.deliveredPriceCents, previousPriceCents);
    if (anomaly) {
      const quarantine = {
        merchantId: input.quote.merchantId,
        merchantProductId: input.quote.merchantProductId,
        quoteContext: input.quote.quoteContext,
        evidenceRefs: input.quote.evidenceRefs,
        checkedAt: input.quote.checkedAt,
        ...anomaly
      };
      await quarantineSave(quarantine, input.quarantineKey);
      return { status: "QUARANTINED" as const, quarantine };
    }
    quotesByKey.set(input.publicationKey, input.quote);
    return { status: "PUBLISHED" as const };
  });
  const deps: RefreshPriceDeps = {
    ...baseControls(),
    adapters: { get: vi.fn(() => merchantAdapter) },
    evidence: { save: evidenceSave },
    quotes: { commit: quoteCommit },
    quarantine: { save: quarantineSave },
    clock: { now: () => new Date(now) },
    freshness: {
      ttlMs: 15 * 60_000,
      maxFutureSkewMs: 30_000,
      evidenceMaxAgeMs: 15 * 60_000,
      maxEvidenceToEntitySkewMs: 30_000
    }
  };
  return {
    deps,
    merchantAdapter,
    evidenceByKey,
    quotesByKey,
    evidenceSave,
    quoteSave: quoteCommit,
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
    const { deps, evidenceSave, quoteSave, quotesByKey, quarantineSave } = priceDeps(
      10_000,
      quote({ itemPriceCents: 1_000 })
    );

    await expect(refreshPrice(priceJob, deps)).resolves.toMatchObject({ status: "QUARANTINED" });

    expect(quoteSave).toHaveBeenCalledOnce();
    expect(quotesByKey.size).toBe(0);
    expect(evidenceSave).toHaveBeenCalledBefore(quarantineSave);
    expect(quarantineSave).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "PRICE_DROP_AT_LEAST_90_PERCENT",
        evidenceRefs: expect.arrayContaining([expect.stringMatching(/^[a-f0-9]{64}$/u)])
      }),
      expect.stringMatching(/^[a-f0-9]{64}$/u)
    );
  });

  it("treats zero historical price as no baseline", async () => {
    const { deps, quoteSave, quarantineSave } = priceDeps(0, quote({ itemPriceCents: 0 }));

    await expect(refreshPrice(priceJob, deps)).resolves.toMatchObject({ status: "PUBLISHED" });
    expect(quarantineSave).not.toHaveBeenCalled();
    expect(quoteSave).toHaveBeenCalledOnce();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "fails closed for invalid historical price %s",
    async (history) => {
      const { deps, quoteSave, quotesByKey } = priceDeps(history, quote());

      await expect(refreshPrice(priceJob, deps)).rejects.toThrow(/price history/i);
      expect(quoteSave).toHaveBeenCalledOnce();
      expect(quotesByKey.size).toBe(0);
    }
  );

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

  it("uses the adapter's atomic price evidence operation without product refresh", async () => {
    const { deps, merchantAdapter } = priceDeps(1_000, quote());

    await refreshPrice(priceJob, deps);

    expect(merchantAdapter.refreshPrice).toHaveBeenCalledOnce();
    expect(merchantAdapter.refreshProduct).not.toHaveBeenCalled();
    expect(merchantAdapter.quoteDeliveredPrice).not.toHaveBeenCalled();
  });

  it("fails closed when the atomic source version differs", async () => {
    const { deps, merchantAdapter, quoteSave } = priceDeps(1_000, quote());
    vi.mocked(merchantAdapter.refreshPrice).mockResolvedValueOnce({
      ...(await merchantAdapter.refreshPrice({
        merchantProductId: "sku-1",
        zipCode: "10001",
        memberships: [],
        sourceVersion: "v1"
      })),
      sourceVersion: "v2"
    });

    await expect(refreshPrice(priceJob, deps)).rejects.toThrow(/source version/i);
    expect(quoteSave).not.toHaveBeenCalled();
  });

  it("uses stable idempotency keys so a retry does not duplicate evidence or quotes", async () => {
    const { deps, evidenceByKey, quotesByKey } = priceDeps(1_000, quote({ itemPriceCents: 1_000 }));

    await refreshPrice(priceJob, deps);
    await refreshPrice(priceJob, deps);

    expect(evidenceByKey.size).toBe(1);
    expect(quotesByKey.size).toBe(1);
  });

  it("quarantines changed content for one immutable source version", async () => {
    const { deps, merchantAdapter, quoteSave, quarantineSave } = priceDeps(1_000, quote());
    await refreshPrice(priceJob, deps);
    vi.mocked(merchantAdapter.refreshPrice).mockResolvedValueOnce({
      merchantProductId: "sku-1",
      sourceVersion: "v1",
      sourceUrl: "https://merchant.example/quotes/sku-1",
      rawEvidence: "changed raw evidence",
      metadata: { sourceType: "api" },
      checkedAt: "2026-08-13T17:59:00.000Z",
      quote: quote()
    });

    await expect(refreshPrice(priceJob, deps)).resolves.toEqual({
      status: "QUARANTINED",
      reason: "SOURCE_VERSION_CONFLICT"
    });
    expect(quoteSave).toHaveBeenCalledOnce();
    expect(quarantineSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reason: "SOURCE_VERSION_CONFLICT",
        evidenceRefs: [expect.stringMatching(/^[a-f0-9]{64}$/u)]
      }),
      expect.stringMatching(/^[a-f0-9]{64}$/u)
    );
  });

  it.each([
    ["invalid calendar", refreshResult({ checkedAt: "2026-02-30T17:59:00Z" }), /RFC3339/i],
    ["stale", refreshResult({ checkedAt: "2026-08-13T17:30:00.000Z" }), /stale/i],
    ["mismatched", refreshResult({ checkedAt: "2026-08-13T17:58:00.000Z" }), /does not match/i]
  ])("rejects %s atomic evidence freshness", async (_case, refresh, expected) => {
    const merchantAdapter = adapter(refresh, offer(), quote());
    const { deps, quoteSave } = priceDeps(1_000, quote());
    vi.mocked(deps.adapters.get).mockReturnValue(merchantAdapter);

    await expect(refreshPrice(priceJob, deps)).rejects.toThrow(expected);
    expect(quoteSave).not.toHaveBeenCalled();
  });

  it.each(["ttlMs", "maxFutureSkewMs", "evidenceMaxAgeMs", "maxEvidenceToEntitySkewMs"] as const)(
    "rejects invalid %s policy before adapter access",
    async (field) => {
      const { deps, merchantAdapter } = priceDeps();
      deps.freshness[field] = Number.NaN;

      await expect(refreshPrice(priceJob, deps)).rejects.toThrow(/finite non-negative/i);
      expect(merchantAdapter.refreshPrice).not.toHaveBeenCalled();
    }
  );
});

describe("refresh queue policy", () => {
  it("uses named queues, exact deduplication IDs, retries, and bounded workers", () => {
    expect(PRODUCT_REFRESH_QUEUE).toBe("merchant-product-refresh");
    expect(PRICE_REFRESH_QUEUE).toBe("merchant-price-refresh");
    const logicalKey = refreshIdempotencyKey(productJob);
    const bullJobId = refreshJobId(productJob);
    expect(logicalKey).toMatch(/^[a-f0-9]{64}$/u);
    expect(Buffer.from(bullJobId, "base64url").toString("hex")).toBe(logicalKey);
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
    const idempotencyKey = refreshIdempotencyKey(productJob);

    await enqueueProductRefresh({ add }, productJob);

    expect(add).toHaveBeenCalledWith(
      "refresh",
      { ...productJob, idempotencyKey },
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

  it("separates canonical ZIP and membership quote contexts", async () => {
    const a = canonicalizePriceRefreshJob({
      ...priceJob,
      zipCode: " 10001-1234 ",
      memberships: [" prime ", "costco", "prime"]
    });
    const b = canonicalizePriceRefreshJob({
      ...priceJob,
      zipCode: "10001-1234",
      memberships: ["costco", "prime"]
    });
    const otherZip = canonicalizePriceRefreshJob({ ...priceJob, zipCode: "33433" });

    expect(a.zipCode).toBe("10001-1234");
    expect(a.memberships).toEqual(["costco", "prime"]);
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.idempotencyKey).not.toBe(otherZip.idempotencyKey);
    expect(quoteContextKey(a)).toHaveLength(64);

    const add = vi.fn(async () => undefined);
    await enqueuePriceRefresh({ add }, a);
    expect(add).toHaveBeenCalledWith("refresh", a, expect.objectContaining({
      jobId: refreshJobId(a)
    }));
  });

  it.each([
    [{ ...priceJob, zipCode: "100011234" }, /zip/i],
    [{ ...priceJob, memberships: [" "] }, /membership/i],
    [{ ...priceJob, memberships: Array.from({ length: 21 }, (_, i) => `m-${i}`) }, /membership/i],
    [{ ...priceJob, merchantProductId: "x".repeat(201) }, /merchant product/i],
    [{ ...priceJob, sourceVersion: "" }, /source version/i]
  ])("rejects invalid refresh identity at enqueue and handler boundaries", async (invalid, expected) => {
    expect(() => canonicalizePriceRefreshJob(invalid)).toThrow(expected);
    const { deps } = priceDeps();
    await expect(refreshPrice(invalid, deps)).rejects.toThrow(expected);
  });

  it("rejects a mismatched caller-supplied idempotency key", () => {
    expect(() => canonicalizeProductRefreshJob({ ...productJob, idempotencyKey: "0".repeat(64) }))
      .toThrow(/idempotency/i);
  });
});
