import { randomUUID } from "node:crypto";

type ReadKind = "AWIN" | "SHOPIFY" | "EBAY" | "OFFICIAL" | "IMAGE" | "DEALS" | "REGISTRY";
type SearchRunOptions = { maxCatalogRequests: number; activeBudgetMs: number; readTimeoutMs: number };
export type VisualStage = "NORMALIZED" | "ELIGIBLE" | "REVIEW_POOL" | "IMAGES_PRESENTED" |
  "IMAGES_DUPLICATED" | "REVIEW_ACCEPTED" | "REVIEW_CONFLICT" | "REVIEW_INSUFFICIENT" | "FINAL";
export type VisualFingerprint = { productHash: string; styleHash?: string; colorwayHash?: string;
  imageUrlHash?: string; imageSha256?: string };
type VisualStageOptions = {
  source?: "AWIN" | "SHOPIFY" | "EBAY" | "OFFICIAL";
  queryHash?: string;
  round?: 1 | 2;
  counts?: Partial<Record<"identity" | "brand" | "requirements" | "visual" | "outOfStock" | "malformed", number>>;
};
type VisualStageEvent = VisualStageOptions & { stage: VisualStage; count: number;
  fingerprints: VisualFingerprint[]; fingerprintsTruncated?: true };
const visualStages = new Set<VisualStage>(["NORMALIZED", "ELIGIBLE", "REVIEW_POOL", "IMAGES_PRESENTED",
  "IMAGES_DUPLICATED", "REVIEW_ACCEPTED", "REVIEW_CONFLICT", "REVIEW_INSUFFICIENT", "FINAL"]);
const visualSources = new Set(["AWIN", "SHOPIFY", "EBAY", "OFFICIAL"]);
const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

export class SearchBudgetError extends Error {
  constructor() { super("SEARCH_BUDGET_EXHAUSTED"); }
}
export class SearchReadTimeoutError extends Error {
  constructor() { super("SEARCH_READ_TIMEOUT"); }
}

/** One interactive search, including its second visual round. No global cache,
 * raw-query telemetry, network retries, or extension of provider timeouts. */
export class SearchRun {
  readonly traceId = randomUUID();
  readonly #options: SearchRunOptions;
  readonly #reads = new Map<string, Promise<unknown>>();
  readonly #officialQueries = new Set<string>();
  readonly #reviewedProducts = new Set<string>();
  #catalogRequests = 0;
  #imageRequests = 0;
  #dealRequests = 0;
  #registryRequests = 0;
  #cacheHits = 0;
  #officialHttpRequests = 0;
  #officialHttpBytes = 0;
  #officialDocumentCacheHits = 0;
  #active = 0;
  #activeSince = 0;
  #elapsed = 0;
  #budgetExhausted = false;
  #readTimeouts = 0;
  #enrichmentLimited = false;
  #imageReviewStop: { reason: "IMAGE_REQUEST_LIMIT" | "ACTIVE_TIME_LIMIT"; unattemptedCandidates: number } | undefined;
  readonly #visualStages: VisualStageEvent[] = [];
  #visualFingerprints = 0;
  #visualTraceTruncated = false;

  constructor(options: Partial<SearchRunOptions> = {}) {
    this.#options = { maxCatalogRequests: 16, activeBudgetMs: 30_000, readTimeoutMs: 10_000, ...options };
  }

  remainingImageRequests(): number { return Math.max(0, 12 - this.#imageRequests); }

  /** Execution-owned continuation, not a model-supplied cursor. The read budget still applies. */
  claimOfficialQuery(hash: string): boolean {
    if (!validHash(hash) || this.#officialQueries.has(hash) || this.#officialQueries.size >= 64) return false;
    this.#officialQueries.add(hash);
    return true;
  }

  wasVisuallyReviewed(hash: string): boolean { return this.#reviewedProducts.has(hash); }

  recordOfficialRead(delta: { requests?: number; bytes?: number; cacheHits?: number }): void {
    this.#officialHttpRequests += delta.requests ?? 0;
    this.#officialHttpBytes += delta.bytes ?? 0;
    this.#officialDocumentCacheHits += delta.cacheHits ?? 0;
  }

  /** Local bounded audit data only. Source strings, titles, URLs and queries never
   * cross this boundary; truncation is explicit and never changes source counts. */
  recordVisualStage(stage: VisualStage, entries: readonly VisualFingerprint[], options: VisualStageOptions = {}): void {
    if (!visualStages.has(stage)) return;
    // Control state is independent of diagnostic truncation. At most 12 images are read per run.
    if (["REVIEW_ACCEPTED", "REVIEW_CONFLICT", "REVIEW_INSUFFICIENT"].includes(stage)) {
      for (const entry of entries) if (validHash(entry.productHash) && this.#reviewedProducts.size < 32) this.#reviewedProducts.add(entry.productHash);
    }
    if (this.#visualStages.length >= 48) { this.#visualTraceTruncated = true; return; }
    const fingerprints = entries.filter((entry) => validHash(entry.productHash))
      .slice(0, Math.min(64, 256 - this.#visualFingerprints)).map((entry) => ({
        productHash: entry.productHash,
        ...Object.fromEntries((["styleHash", "colorwayHash", "imageUrlHash", "imageSha256"] as const)
          .filter((key) => validHash(entry[key])).map((key) => [key, entry[key]]))
      }));
    this.#visualFingerprints += fingerprints.length;
    const truncated = fingerprints.length !== entries.length;
    this.#visualTraceTruncated ||= truncated;
    const counts = Object.fromEntries((["identity", "brand", "requirements", "visual", "outOfStock", "malformed"] as const)
      .filter((key) => Number.isSafeInteger(options.counts?.[key]) && options.counts![key]! >= 0)
      .map((key) => [key, options.counts![key]]));
    this.#visualStages.push({ stage, count: entries.length, fingerprints,
      ...(options.source !== undefined && visualSources.has(options.source) ? { source: options.source } : {}),
      ...(validHash(options.queryHash) ? { queryHash: options.queryHash } : {}),
      ...(options.round === 1 || options.round === 2 ? { round: options.round } : {}),
      ...(Object.keys(counts).length === 0 ? {} : { counts }),
      ...(truncated ? { fingerprintsTruncated: true } : {}) });
  }

  canRead(kind: ReadKind): boolean {
    return this.activeDuration() < this.#options.activeBudgetMs && !this.limitReached(kind);
  }

  /** A proactive stop is budget exhaustion only when known eligible work remains. */
  noteUnattemptedImages(count: number): void {
    if (!Number.isSafeInteger(count) || count <= 0 || this.canRead("IMAGE")) return;
    this.#budgetExhausted = true;
    this.#imageReviewStop = {
      reason: this.activeDuration() >= this.#options.activeBudgetMs ? "ACTIVE_TIME_LIMIT" : "IMAGE_REQUEST_LIMIT",
      unattemptedCandidates: Math.max(count, this.#imageReviewStop?.unattemptedCandidates ?? 0)
    };
  }

  private limitReached(kind: ReadKind): boolean {
    return kind === "IMAGE" ? this.remainingImageRequests() === 0
      : kind === "DEALS" ? this.#dealRequests >= 8
        : kind === "REGISTRY" ? this.#registryRequests >= 2
          : this.#catalogRequests >= this.#options.maxCatalogRequests;
  }

  async read<T>(kind: ReadKind, key: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const cacheKey = `${kind}:${key}`;
    const cached = this.#reads.get(cacheKey);
    if (cached !== undefined) {
      this.#cacheHits += 1;
      return cached as Promise<T>;
    }
    const remaining = this.#options.activeBudgetMs - this.activeDuration();
    if (remaining <= 0 || this.limitReached(kind)) {
      if (kind === "DEALS" && remaining > 0) this.#enrichmentLimited = true;
      else this.#budgetExhausted = true;
      throw new SearchBudgetError();
    }
    if (kind === "IMAGE") this.#imageRequests += 1;
    else if (kind === "DEALS") this.#dealRequests += 1;
    else if (kind === "REGISTRY") this.#registryRequests += 1;
    else this.#catalogRequests += 1;
    if (this.#active++ === 0) this.#activeSince = Date.now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.#readTimeouts += 1;
        if (remaining <= this.#options.readTimeoutMs) this.#budgetExhausted = true;
        const error = this.#budgetExhausted ? new SearchBudgetError() : new SearchReadTimeoutError();
        reject(error);
        controller.abort(error);
      }, Math.min(remaining, this.#options.readTimeoutMs));
    });
    const result = Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout]).finally(() => {
      clearTimeout(timer);
      if (--this.#active === 0) this.#elapsed += Math.max(0, Date.now() - this.#activeSince);
    });
    // Share in-flight images and failed reads across variants, but release successful
    // image bytes before the next model turn. Transport safety remains provider-owned.
    this.#reads.set(cacheKey, result);
    if (kind === "IMAGE") void result.then(() => { this.#reads.delete(cacheKey); }, () => {});
    return result;
  }

  private activeDuration(): number {
    return this.#elapsed + (this.#active === 0 ? 0 : Math.max(0, Date.now() - this.#activeSince));
  }

  diagnostics() {
    return {
      traceId: this.traceId,
      catalogRequests: this.#catalogRequests,
      officialHttpRequests: this.#officialHttpRequests,
      officialHttpBytes: this.#officialHttpBytes,
      officialDocumentCacheHits: this.#officialDocumentCacheHits,
      imageRequests: this.#imageRequests,
      dealRequests: this.#dealRequests,
      cacheHits: this.#cacheHits,
      activeDurationMs: this.activeDuration(),
      budgetExhausted: this.#budgetExhausted,
      ...(this.#imageReviewStop === undefined ? {} : { imageReviewStop: { ...this.#imageReviewStop } }),
      readTimeouts: this.#readTimeouts,
      enrichmentLimited: this.#enrichmentLimited,
      ...(this.#visualStages.length === 0 ? {} : { visualFunnel: {
        stages: this.#visualStages.map((entry) => ({ ...entry,
          ...(entry.counts === undefined ? {} : { counts: { ...entry.counts } }),
          fingerprints: entry.fingerprints.map((fingerprint) => ({ ...fingerprint })) })),
        truncated: this.#visualTraceTruncated
      } })
    };
  }
}
