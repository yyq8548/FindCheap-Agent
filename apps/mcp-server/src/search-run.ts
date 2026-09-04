import { randomUUID } from "node:crypto";

type ReadKind = "AWIN" | "SHOPIFY" | "EBAY" | "OFFICIAL" | "IMAGE" | "DEALS" | "REGISTRY";
type SearchRunOptions = { maxCatalogRequests: number; activeBudgetMs: number; readTimeoutMs: number };

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
  #catalogRequests = 0;
  #imageRequests = 0;
  #dealRequests = 0;
  #registryRequests = 0;
  #cacheHits = 0;
  #active = 0;
  #activeSince = 0;
  #elapsed = 0;
  #budgetExhausted = false;
  #readTimeouts = 0;
  #enrichmentLimited = false;

  constructor(options: Partial<SearchRunOptions> = {}) {
    this.#options = { maxCatalogRequests: 16, activeBudgetMs: 30_000, readTimeoutMs: 10_000, ...options };
  }

  async read<T>(kind: ReadKind, key: string, operation: () => Promise<T>): Promise<T> {
    const cacheKey = `${kind}:${key}`;
    const cached = this.#reads.get(cacheKey);
    if (cached !== undefined) {
      this.#cacheHits += 1;
      return cached as Promise<T>;
    }
    const remaining = this.#options.activeBudgetMs - this.activeDuration();
    const limitReached = kind === "IMAGE" ? this.#imageRequests >= 12
      : kind === "DEALS" ? this.#dealRequests >= 8
        : kind === "REGISTRY" ? this.#registryRequests >= 2
          : this.#catalogRequests >= this.#options.maxCatalogRequests;
    if (remaining <= 0 || limitReached) {
      if (kind === "DEALS" && remaining > 0) this.#enrichmentLimited = true;
      else this.#budgetExhausted = true;
      throw new SearchBudgetError();
    }
    if (kind === "IMAGE") this.#imageRequests += 1;
    else if (kind === "DEALS") this.#dealRequests += 1;
    else if (kind === "REGISTRY") this.#registryRequests += 1;
    else this.#catalogRequests += 1;
    if (this.#active++ === 0) this.#activeSince = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.#readTimeouts += 1;
        if (remaining <= this.#options.readTimeoutMs) this.#budgetExhausted = true;
        reject(this.#budgetExhausted ? new SearchBudgetError() : new SearchReadTimeoutError());
      }, Math.min(remaining, this.#options.readTimeoutMs));
    });
    const result = Promise.race([Promise.resolve().then(operation), timeout]).finally(() => {
      clearTimeout(timer);
      if (--this.#active === 0) this.#elapsed += Math.max(0, Date.now() - this.#activeSince);
    });
    // Do not retain image bytes between model turns. Provider clients still own
    // transport cancellation and SSRF/CDN policy; this boundary only bounds wait/dispatch.
    if (kind !== "IMAGE") this.#reads.set(cacheKey, result);
    return result;
  }

  private activeDuration(): number {
    return this.#elapsed + (this.#active === 0 ? 0 : Math.max(0, Date.now() - this.#activeSince));
  }

  diagnostics() {
    return {
      traceId: this.traceId,
      catalogRequests: this.#catalogRequests,
      imageRequests: this.#imageRequests,
      dealRequests: this.#dealRequests,
      cacheHits: this.#cacheHits,
      activeDurationMs: this.activeDuration(),
      budgetExhausted: this.#budgetExhausted,
      readTimeouts: this.#readTimeouts,
      enrichmentLimited: this.#enrichmentLimited
    };
  }
}
