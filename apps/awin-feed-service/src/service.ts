import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname } from "node:path";

import {
  createAwinFeedIndex,
  MAX_AWIN_SOURCE_COMPRESSED_BYTES,
  mergeAwinFeedArchives,
  mergeAwinFeedArchivesStreaming,
  parseAwinCsv,
  parseAwinSearchInput,
  readLimitedBody,
  searchAwinFeedIndex,
  type AwinFeedIndex,
  type AwinSearchInput,
  type AwinSearchResult
} from "../../../packages/awin-feed/src/index.js";
import { safeFetch } from "../../../packages/network-safety/src/safe-fetch.js";
import { validateAwinSourceUrl, type AwinFeedServiceEnvironment } from "./environment.js";
import {
  parseEbaySearchInput,
  type EbayBrowseController
} from "./ebay-browse.js";
import {
  parseAwinOfferSearchInput,
  type AwinOffersController
} from "./offers.js";
import type { ServedOfficialStorefrontRegistry } from "./official-storefront-registry.js";
import type { ServedMerchantTrustRegistry } from "./merchant-trust-registry.js";
import {
  acquireRefreshLock,
  archiveSha256,
  emptyFeedCacheManifest,
  feedStatePaths,
  loadFeedCacheManifest,
  readCachedSource,
  recordSourceRequest,
  removeUnusedCachedSources,
  sourceFeedKeyHash,
  writeCachedSource,
  writeFeedCacheManifest,
  type FeedCacheManifest,
  type SourceCacheEntry
} from "./source-cache.js";

const MAX_AWIN_FEED_LIST_BYTES = 4 * 1024 * 1024;
const MAX_OFFICIAL_IMAGE_BYTES = 1_500_000;

type FeedSnapshot = {
  archive: Uint8Array;
  index: AwinFeedIndex;
  snapshotAt: string;
  feedRows: number;
  sourceFeeds?: number;
  excludedSourceFeeds: number;
  excludedSourceFeedReasons: Partial<Record<FeedErrorDetailCode, number>>;
  staleSourceFeeds: number;
};

type FeedState = {
  snapshot?: FeedSnapshot;
  lastRefreshAt?: string;
  lastErrorAt?: string;
  lastErrorCode?: "SOURCE_REQUEST_FAILED" | "SOURCE_HTTP_ERROR" | "SOURCE_READ_FAILED" | "FEED_LIST_INVALID" | "FEED_INVALID" | "STORAGE_WRITE_FAILED";
  lastErrorDetailCode?: FeedErrorDetailCode;
  lastAttemptSourceFeeds?: number;
  lastAttemptExcludedSourceFeeds?: number;
  lastAttemptExcludedSourceFeedReasons?: Partial<Record<FeedErrorDetailCode, number>>;
  lastSuccessfulRefreshAt?: string;
  consecutiveRefreshFailures?: number;
};

type FeedErrorDetailCode =
  | "SOURCE_TIMEOUT"
  | "SOURCE_HTTP_429"
  | "SOURCE_HTTP_5XX"
  | "SOURCE_RATE_LIMITED"
  | "SOURCE_TOO_LARGE"
  | "ARCHIVE_INVALID"
  | "NO_ELIGIBLE_PRODUCTS"
  | "DUPLICATE_PRODUCT_KEY"
  | "INVALID_ENHANCED_PRICE"
  | "CSV_INVALID"
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_MERCHANT"
  | "UNSUPPORTED_CURRENCY"
  | "INCONSISTENT_MERCHANT_IDENTITY"
  | "UNAPPROVED_PRODUCT_URL"
  | "INVALID_PRICE"
  | "INDEX_VALIDATION_FAILED"
  | "OTHER";

type Dependencies = {
  fetch?: typeof fetch;
  now?: () => Date;
  clock?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  log?: (event: FeedSourceLog) => void;
};

export type FeedSourceLog = {
  event: "awin_feed_source";
  feedKeyHash: string;
  host: string;
  position: number;
  phase: "response" | "body" | "normalize" | "cache";
  attempt: number;
  ttfbMs: number;
  bytes: number;
  durationMs: number;
  outcome: "success" | "retry" | "excluded" | "cache_hit" | "cache_recovered" | "failed";
  detailCode?: FeedErrorDetailCode;
};

export type AwinFeedController = {
  loadExisting(): Promise<void>;
  refresh(): Promise<void>;
  getState(): Readonly<FeedState>;
  search(input: AwinSearchInput): AwinSearchResult | undefined;
  getImageSource(merchantId: string, merchantProductId: string): string | undefined;
};

export function createAwinFeedController(
  environment: AwinFeedServiceEnvironment,
  dependencies: Dependencies = {}
): AwinFeedController {
  const fetchRequest = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const clock = dependencies.clock ?? Date.now;
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const random = dependencies.random ?? Math.random;
  const log = dependencies.log ?? (() => {});
  const paths = feedStatePaths(environment.dataPath);
  const state: FeedState = { consecutiveRefreshFailures: 0 };
  let manifest: FeedCacheManifest = emptyFeedCacheManifest();
  let activeRefresh: Promise<void> | undefined;
  let requestLedgerQueue = Promise.resolve();

  const reserveSourceRequest = (feedKeyHash: string): Promise<boolean> => {
    const reservation = requestLedgerQueue.then(() => recordSourceRequest(
      paths.requestLedgerPath,
      feedKeyHash,
      validDate(now())
    ));
    requestLedgerQueue = reservation.then(() => undefined, () => undefined);
    return reservation;
  };

  const loadExisting = async (): Promise<void> => {
    try {
      const archive = await readFile(environment.dataPath);
      const fileSnapshotAt = (await stat(environment.dataPath)).mtime.toISOString();
      manifest = await loadFeedCacheManifest(paths.manifestPath);
      const metadata = manifest.snapshot?.archiveSha256 === archiveSha256(archive)
        ? manifest.snapshot
        : undefined;
      state.snapshot = validatedSnapshot(
        archive,
        metadata?.snapshotAt ?? fileSnapshotAt,
        metadata?.sourceFeeds ?? (environment.sourceFeedListUrl === undefined ? environment.sourceUrls.length : undefined),
        metadata?.excludedSourceFeeds ?? 0,
        metadata?.excludedSourceFeedReasons as Partial<Record<FeedErrorDetailCode, number>> | undefined,
        metadata?.staleSourceFeeds ?? 0
      );
      state.lastSuccessfulRefreshAt = metadata?.lastSuccessfulRefreshAt ?? fileSnapshotAt;
      state.consecutiveRefreshFailures = manifest.health.consecutiveRefreshFailures;
      if (manifest.health.lastErrorAt === undefined) delete state.lastErrorAt;
      else state.lastErrorAt = manifest.health.lastErrorAt;
      if (manifest.health.lastErrorCode === undefined) delete state.lastErrorCode;
      else state.lastErrorCode = manifest.health.lastErrorCode as NonNullable<FeedState["lastErrorCode"]>;
      if (manifest.health.lastErrorDetailCode === undefined) delete state.lastErrorDetailCode;
      else state.lastErrorDetailCode = manifest.health.lastErrorDetailCode as FeedErrorDetailCode;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      manifest = await loadFeedCacheManifest(paths.manifestPath);
    }
  };
  const runRefresh = async (): Promise<void> => {
    const releaseLock = await acquireRefreshLock(paths.refreshLockPath, validDate(now()));
    let failureCode: NonNullable<FeedState["lastErrorCode"]> = "SOURCE_REQUEST_FAILED";
    delete state.lastAttemptSourceFeeds;
    delete state.lastAttemptExcludedSourceFeeds;
    delete state.lastAttemptExcludedSourceFeedReasons;
    try {
      if (environment.sourceFeedListUrl === undefined) {
        await refreshDirectSources(
          environment,
          fetchRequest,
          now,
          clock,
          sleep,
          random,
          reserveSourceRequest,
          log,
          state
        );
        const snapshot = state.snapshot!;
        manifest = {
          version: 1,
          snapshot: {
            archiveSha256: archiveSha256(snapshot.archive),
            snapshotAt: snapshot.snapshotAt,
            lastSuccessfulRefreshAt: state.lastSuccessfulRefreshAt!,
            feedRows: snapshot.feedRows,
            sourceFeeds: snapshot.sourceFeeds ?? environment.sourceUrls.length,
            excludedSourceFeeds: snapshot.excludedSourceFeeds,
            excludedSourceFeedReasons: snapshot.excludedSourceFeedReasons,
            staleSourceFeeds: 0
          },
          health: { consecutiveRefreshFailures: 0 },
          sources: []
        };
        await writeFeedCacheManifest(paths.manifestPath, manifest);
        return;
      }
      failureCode = "FEED_LIST_INVALID";
      const sources = await discoverJoinedFeeds(environment, fetchRequest);
      const mergeOptions = environment.sourceFeedListUrl === undefined
        ? {}
        : {
            ...(environment.sourceFeedRegion === "US" ? { defaultCurrency: "USD" as const } : {}),
            canonicalizeMerchantNames: true,
            compactRecords: true
          };
      const excludedSourceFeedReasons: Partial<Record<FeedErrorDetailCode, number>> = {};
      const priorEntries = new Map(manifest.sources.map((entry) => [entry.feedKey, entry]));
      const results = await mapWithConcurrency(sources, 5, async (source): Promise<SourceResolution> => {
        const priorEntry = priorEntries.get(source.feedKey);
        const cached = priorEntry === undefined ? undefined : await readCachedSource(paths, priorEntry);
        if (priorEntry?.importedAt === source.importedAt && cached !== undefined) {
          logSource(log, source, "cache", 0, 0, cached.byteLength, 0, "cache_hit");
          return { archive: cached, entry: priorEntry, stale: false };
        }
        try {
          const downloaded = await downloadSourceWithRetry(
            source,
            environment,
            fetchRequest,
            reserveSourceRequest,
            clock,
            sleep,
            random,
            log
          );
          const normalizeStarted = clock();
          try {
            const normalized = await mergeAwinFeedArchivesStreaming([downloaded], mergeOptions);
            const updatedAt = validDate(now()).toISOString();
            validatedSnapshot(normalized, updatedAt, 1);
            const entry: SourceCacheEntry = {
              feedKey: source.feedKey,
              feedKeyHash: source.feedKeyHash,
              importedAt: source.importedAt,
              archiveSha256: archiveSha256(normalized),
              bytes: normalized.byteLength,
              updatedAt
            };
            await writeCachedSource(paths, entry, normalized);
            logSource(log, source, "normalize", 0, 0, normalized.byteLength, clock() - normalizeStarted, "success");
            return { archive: normalized, entry, stale: false };
          } catch (error) {
            const detailCode = feedErrorDetailCode(error);
            logSource(log, source, "normalize", 0, 0, downloaded.byteLength, clock() - normalizeStarted, "excluded", detailCode);
            if (cached !== undefined && priorEntry !== undefined) {
              logSource(log, source, "cache", 0, 0, cached.byteLength, 0, "cache_recovered", detailCode);
              return { archive: cached, entry: priorEntry, stale: true, error, detailCode };
            }
            return { error, detailCode, stale: false };
          }
        } catch (error) {
          if (cached !== undefined && priorEntry !== undefined) {
            logSource(log, source, "cache", 0, 0, cached.byteLength, 0, "cache_recovered", feedErrorDetailCode(error));
            return { archive: cached, entry: priorEntry, stale: true, error, detailCode: feedErrorDetailCode(error) };
          }
          return { fatal: true, error, detailCode: feedErrorDetailCode(error), stale: false };
        }
      });
      const sourceArchives: Uint8Array[] = [];
      const nextEntries: SourceCacheEntry[] = [];
      let firstSourceValidationError: unknown;
      let fatalSourceError: unknown;
      let staleSourceFeeds = 0;
      for (const result of results) {
        if (result.fatal === true) {
          fatalSourceError ??= result.error;
          const reasonCode = result.detailCode ?? "OTHER";
          excludedSourceFeedReasons[reasonCode] = (excludedSourceFeedReasons[reasonCode] ?? 0) + 1;
          continue;
        }
        if (result.archive !== undefined && result.entry !== undefined) {
          sourceArchives.push(result.archive);
          nextEntries.push(result.entry);
          if (result.stale) staleSourceFeeds += 1;
          continue;
        }
        firstSourceValidationError ??= result.error;
        const reasonCode = result.detailCode ?? "OTHER";
        excludedSourceFeedReasons[reasonCode] = (excludedSourceFeedReasons[reasonCode] ?? 0) + 1;
      }
      state.lastAttemptSourceFeeds = sourceArchives.length;
      state.lastAttemptExcludedSourceFeeds = sources.length - sourceArchives.length;
      state.lastAttemptExcludedSourceFeedReasons = excludedSourceFeedReasons;
      if (fatalSourceError !== undefined) {
        manifest = { ...manifest, sources: nextEntries };
        await writeFeedCacheManifest(paths.manifestPath, manifest);
        throw fatalSourceError;
      }
      const snapshotAt = validDate(now()).toISOString();
      failureCode = "FEED_INVALID";
      if (sourceArchives.length === 0) {
        throw firstSourceValidationError ?? new Error("at least one valid Awin Feed is required");
      }
      const archive = await mergeAwinFeedArchivesStreaming(sourceArchives, mergeOptions);
      const snapshot = validatedSnapshot(
        archive,
        snapshotAt,
        sourceArchives.length,
        sources.length - sourceArchives.length,
        excludedSourceFeedReasons,
        staleSourceFeeds
      );
      failureCode = "STORAGE_WRITE_FAILED";
      await writeArchiveAtomically(environment.dataPath, archive);
      const degraded = staleSourceFeeds > 0;
      const lastSuccessfulRefreshAt = degraded
        ? state.lastSuccessfulRefreshAt ?? snapshotAt
        : snapshotAt;
      const failureAt = degraded ? snapshotAt : undefined;
      const failureDetail = degraded
        ? results.find((result) => result.stale)?.detailCode ?? "OTHER"
        : undefined;
      const degradedError = results.find((result) => result.stale)?.error;
      const degradedFailureCode = degradedError instanceof SourceFetchError
        ? degradedError.failureCode
        : "FEED_INVALID";
      const nextManifest: FeedCacheManifest = {
        version: 1,
        snapshot: {
          archiveSha256: archiveSha256(archive),
          snapshotAt,
          lastSuccessfulRefreshAt,
          feedRows: snapshot.feedRows,
          sourceFeeds: sourceArchives.length,
          excludedSourceFeeds: sources.length - sourceArchives.length,
          excludedSourceFeedReasons,
          staleSourceFeeds
        },
        health: degraded
          ? {
              consecutiveRefreshFailures: (state.consecutiveRefreshFailures ?? 0) + 1,
              lastErrorAt: failureAt!,
              lastErrorCode: degradedFailureCode,
              lastErrorDetailCode: failureDetail
            }
          : { consecutiveRefreshFailures: 0 },
        sources: nextEntries
      };
      await writeFeedCacheManifest(paths.manifestPath, nextManifest);
      await removeUnusedCachedSources(paths, new Set(nextEntries.map((entry) => entry.feedKeyHash)));
      manifest = nextManifest;
      state.snapshot = snapshot;
      state.lastRefreshAt = snapshotAt;
      state.lastSuccessfulRefreshAt = lastSuccessfulRefreshAt;
      state.consecutiveRefreshFailures = nextManifest.health.consecutiveRefreshFailures;
      if (nextManifest.health.lastErrorAt === undefined) delete state.lastErrorAt;
      else state.lastErrorAt = nextManifest.health.lastErrorAt;
      if (nextManifest.health.lastErrorCode === undefined) delete state.lastErrorCode;
      else state.lastErrorCode = nextManifest.health.lastErrorCode as NonNullable<FeedState["lastErrorCode"]>;
      if (nextManifest.health.lastErrorDetailCode === undefined) delete state.lastErrorDetailCode;
      else state.lastErrorDetailCode = nextManifest.health.lastErrorDetailCode as FeedErrorDetailCode;
      delete state.lastAttemptSourceFeeds;
      delete state.lastAttemptExcludedSourceFeeds;
      delete state.lastAttemptExcludedSourceFeedReasons;
      return;
    } catch (error) {
      if (error instanceof SourceFetchError) failureCode = error.failureCode;
      state.lastErrorAt = validDate(now()).toISOString();
      state.lastErrorCode = failureCode;
      state.lastErrorDetailCode = feedErrorDetailCode(error);
      state.consecutiveRefreshFailures = (state.consecutiveRefreshFailures ?? 0) + 1;
      manifest = {
        ...manifest,
        health: {
          consecutiveRefreshFailures: state.consecutiveRefreshFailures,
          lastErrorAt: state.lastErrorAt,
          lastErrorCode: state.lastErrorCode,
          lastErrorDetailCode: state.lastErrorDetailCode
        }
      };
      await writeFeedCacheManifest(paths.manifestPath, manifest).catch(() => {});
      throw error;
    } finally {
      await releaseLock();
    }
  };
  return {
    loadExisting,
    refresh() {
      activeRefresh ??= runRefresh().finally(() => {
        activeRefresh = undefined;
      });
      return activeRefresh;
    },
    getState: () => state,
    search(input) {
      return state.snapshot === undefined
        ? undefined
        : searchAwinFeedIndex(state.snapshot.index, input);
    },
    getImageSource(merchantId, merchantProductId) {
      return state.snapshot?.index.products.find((product) =>
        product.merchantId === merchantId && product.merchantProductId === merchantProductId
      )?.imageUrl;
    }
  };
}

type DiscoveredFeed = {
  feedKey: string;
  feedKeyHash: string;
  importedAt: string;
  url: string;
  host: string;
  position: number;
};

type SourceResolution = {
  archive?: Uint8Array;
  entry?: SourceCacheEntry;
  stale: boolean;
  fatal?: boolean;
  error?: unknown;
  detailCode?: FeedErrorDetailCode;
};

class SourceFetchError extends Error {
  constructor(
    message: string,
    readonly failureCode: NonNullable<FeedState["lastErrorCode"]>,
    readonly detailCode: FeedErrorDetailCode,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

async function discoverJoinedFeeds(
  environment: AwinFeedServiceEnvironment,
  fetchRequest: typeof fetch
): Promise<DiscoveredFeed[]> {
  let response: Response;
  try {
    response = await fetchResponseWithTimeout(environment.sourceFeedListUrl!, {
      method: "GET",
      redirect: "error",
      headers: { accept: "text/csv, text/plain, application/octet-stream" }
    }, environment.sourceTimeoutMs, fetchRequest);
  } catch (error) {
    throw new SourceFetchError(
      "Awin Feed List response request failed",
      "SOURCE_REQUEST_FAILED",
      feedErrorDetailCode(error),
      { cause: error }
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new SourceFetchError(
      `Awin Feed List returned HTTP ${response.status}`,
      "SOURCE_HTTP_ERROR",
      httpDetailCode(response.status)
    );
  }
  let encoded: Uint8Array;
  try {
    encoded = await readLimitedBody(response, MAX_AWIN_FEED_LIST_BYTES, "Awin Feed List", {
      timeoutMs: environment.sourceBodyTimeoutMs
    });
  } catch (error) {
    throw new SourceFetchError("Awin Feed List body read failed", "SOURCE_READ_FAILED", feedErrorDetailCode(error), { cause: error });
  }
  let document: string;
  try {
    document = new TextDecoder("utf-8", { fatal: true }).decode(encoded);
  } catch {
    throw new Error("Awin Feed List is not valid UTF-8");
  }
  const rows = parseAwinCsv(document).records;
  const selected = new Map<string, { advertiserId: string; feedId: string; importedAt: number; url: string }>();
  for (const row of rows) {
    const membershipStatus = feedListValue(row, "Membership Status").toLocaleLowerCase("en-US");
    if (membershipStatus !== "joined" && membershipStatus !== "active") continue;
    if (feedListValue(row, "Primary Region").toUpperCase() !== environment.sourceFeedRegion) continue;
    if (feedListValue(row, "Language").toLocaleLowerCase("en-US") !== environment.sourceFeedLanguage.toLocaleLowerCase("en-US")) continue;
    const advertiserId = feedListValue(row, "Advertiser ID");
    const feedId = feedListValue(row, "Feed ID");
    const advertiserName = feedListValue(row, "Advertiser Name");
    const importedAt = parseAwinImportedAt(feedListValue(row, "Last Imported"));
    if (!/^\d{1,20}$/u.test(advertiserId) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(feedId) || advertiserName.length > 300 || !Number.isFinite(importedAt)) {
      throw new Error("Awin Feed List contains invalid joined Feed metadata");
    }
    const url = validateAwinSourceUrl(feedListValue(row, "URL"), environment.sourceAllowedHosts);
    const feedKey = `${advertiserId}:${feedId}`;
    const current = selected.get(feedKey);
    if (current === undefined || importedAt > current.importedAt) {
      selected.set(feedKey, { advertiserId, feedId, importedAt, url });
    }
  }
  const numericCompare = (left: string, right: string): number =>
    left.length - right.length || left.localeCompare(right, "en-US");
  const feeds = [...selected.values()]
    .sort((left, right) =>
      numericCompare(left.advertiserId, right.advertiserId) || numericCompare(left.feedId, right.feedId)
    )
    .map((feed, index): DiscoveredFeed => {
      const feedKey = `${feed.advertiserId}:${feed.feedId}`;
      return {
        feedKey,
        feedKeyHash: sourceFeedKeyHash(feedKey),
        importedAt: new Date(feed.importedAt).toISOString(),
        url: feed.url,
        host: new URL(feed.url).hostname.toLocaleLowerCase("en-US"),
        position: index + 1
      };
    });
  if (feeds.length === 0) throw new Error("Awin Feed List contains no joined Feeds for the configured region and language");
  if (new Set(feeds.map((feed) => feed.url)).size !== feeds.length) throw new Error("Awin Feed List contains duplicate download URLs");
  return feeds;
}

async function downloadSourceWithRetry(
  source: DiscoveredFeed,
  environment: AwinFeedServiceEnvironment,
  fetchRequest: typeof fetch,
  reserveRequest: (feedKeyHash: string) => Promise<boolean>,
  clock: () => number,
  sleep: (milliseconds: number) => Promise<void>,
  random: () => number,
  log: (event: FeedSourceLog) => void
): Promise<Uint8Array> {
  let lastError: SourceFetchError | undefined;
  for (let attempt = 1; attempt <= environment.sourceRetryAttempts + 1; attempt += 1) {
    if (!await reserveRequest(source.feedKeyHash)) {
      throw new SourceFetchError(
        "Awin source hourly request budget exhausted",
        "SOURCE_REQUEST_FAILED",
        "SOURCE_RATE_LIMITED"
      );
    }
    const started = clock();
    let ttfbMs = 0;
    let bytes = 0;
    let phase: FeedSourceLog["phase"] = "response";
    try {
      const response = await fetchResponseWithTimeout(source.url, {
        method: "GET",
        redirect: "error",
        headers: { accept: "application/gzip, application/x-gzip, application/octet-stream" }
      }, environment.sourceTimeoutMs, fetchRequest);
      ttfbMs = Math.max(0, clock() - started);
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new SourceFetchError(
          `Awin source returned HTTP ${response.status}`,
          "SOURCE_HTTP_ERROR",
          httpDetailCode(response.status)
        );
      }
      phase = "body";
      const archive = await readLimitedBody(response, MAX_AWIN_SOURCE_COMPRESSED_BYTES, "Awin source", {
        timeoutMs: environment.sourceBodyTimeoutMs,
        onBytes: (value) => { bytes = value; }
      });
      bytes = archive.byteLength;
      logSource(log, source, phase, attempt, ttfbMs, bytes, clock() - started, "success");
      return archive;
    } catch (error) {
      lastError = error instanceof SourceFetchError
        ? error
        : new SourceFetchError(
            phase === "response" ? "Awin source response failed" : "Awin source body read failed",
            phase === "response" ? "SOURCE_REQUEST_FAILED" : "SOURCE_READ_FAILED",
            feedErrorDetailCode(error),
            { cause: error }
          );
      const retry = attempt <= environment.sourceRetryAttempts && retryableSourceError(lastError);
      logSource(log, source, phase, attempt, ttfbMs, bytes, clock() - started, retry ? "retry" : "failed", lastError.detailCode);
      if (!retry) throw lastError;
      const exponential = environment.sourceRetryBaseDelayMs * (2 ** (attempt - 1));
      await sleep(Math.round(exponential * (0.75 + random() * 0.5)));
    }
  }
  throw lastError ?? new SourceFetchError("Awin source failed", "SOURCE_REQUEST_FAILED", "OTHER");
}

async function fetchResponseWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
  fetchRequest: typeof fetch
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref();
  try {
    return await fetchRequest(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error("Awin source response aborted due to timeout", { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function retryableSourceError(error: SourceFetchError): boolean {
  return error.detailCode === "SOURCE_TIMEOUT" ||
    error.detailCode === "SOURCE_HTTP_429" ||
    error.detailCode === "SOURCE_HTTP_5XX" ||
    (error.detailCode === "OTHER" && error.failureCode !== "SOURCE_HTTP_ERROR");
}

function httpDetailCode(status: number): FeedErrorDetailCode {
  if (status === 429) return "SOURCE_HTTP_429";
  if (status >= 500) return "SOURCE_HTTP_5XX";
  return "OTHER";
}

function logSource(
  log: (event: FeedSourceLog) => void,
  source: DiscoveredFeed,
  phase: FeedSourceLog["phase"],
  attempt: number,
  ttfbMs: number,
  bytes: number,
  durationMs: number,
  outcome: FeedSourceLog["outcome"],
  detailCode?: FeedErrorDetailCode
): void {
  log({
    event: "awin_feed_source",
    feedKeyHash: source.feedKeyHash,
    host: source.host,
    position: source.position,
    phase,
    attempt,
    ttfbMs: Math.max(0, Math.round(ttfbMs)),
    bytes: Math.max(0, bytes),
    durationMs: Math.max(0, Math.round(durationMs)),
    outcome,
    ...(detailCode === undefined ? {} : { detailCode })
  });
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

async function refreshDirectSources(
  environment: AwinFeedServiceEnvironment,
  fetchRequest: typeof fetch,
  now: () => Date,
  clock: () => number,
  sleep: (milliseconds: number) => Promise<void>,
  random: () => number,
  reserveRequest: (feedKeyHash: string) => Promise<boolean>,
  log: (event: FeedSourceLog) => void,
  state: FeedState
): Promise<void> {
  const sources = environment.sourceUrls.map((url, index): DiscoveredFeed => {
    const feedKey = `direct:${index + 1}`;
    return {
      feedKey,
      feedKeyHash: sourceFeedKeyHash(feedKey),
      importedAt: new Date(0).toISOString(),
      url,
      host: new URL(url).hostname.toLocaleLowerCase("en-US"),
      position: index + 1
    };
  });
  const normalized: Uint8Array[] = [];
  const excludedSourceFeedReasons: Partial<Record<FeedErrorDetailCode, number>> = {};
  let firstValidationError: unknown;
  for (const source of sources) {
    const archive = await downloadSourceWithRetry(
      source,
      environment,
      fetchRequest,
      reserveRequest,
      clock,
      sleep,
      random,
      log
    );
    const started = clock();
    try {
      normalized.push(mergeAwinFeedArchives([archive]));
      logSource(log, source, "normalize", 0, 0, archive.byteLength, clock() - started, "success");
    } catch (error) {
      firstValidationError ??= error;
      const detailCode = feedErrorDetailCode(error);
      excludedSourceFeedReasons[detailCode] = (excludedSourceFeedReasons[detailCode] ?? 0) + 1;
      logSource(log, source, "normalize", 0, 0, archive.byteLength, clock() - started, "excluded", detailCode);
    }
  }
  state.lastAttemptSourceFeeds = normalized.length;
  state.lastAttemptExcludedSourceFeeds = sources.length - normalized.length;
  state.lastAttemptExcludedSourceFeedReasons = excludedSourceFeedReasons;
  if (normalized.length === 0) {
    const message = firstValidationError instanceof Error
      ? firstValidationError.message
      : "at least one valid Awin Feed is required";
    throw new SourceFetchError(message, "FEED_INVALID", feedErrorDetailCode(firstValidationError), { cause: firstValidationError });
  }
  const archive = normalized.length === 1 ? normalized[0]! : mergeAwinFeedArchives(normalized);
  const snapshotAt = validDate(now()).toISOString();
  const snapshot = validatedSnapshot(
    archive,
    snapshotAt,
    normalized.length,
    sources.length - normalized.length,
    excludedSourceFeedReasons,
    0
  );
  try {
    await writeArchiveAtomically(environment.dataPath, archive);
  } catch (error) {
    throw new SourceFetchError("Awin snapshot storage write failed", "STORAGE_WRITE_FAILED", "OTHER", { cause: error });
  }
  state.snapshot = snapshot;
  state.lastRefreshAt = snapshotAt;
  state.lastSuccessfulRefreshAt = snapshotAt;
  state.consecutiveRefreshFailures = 0;
  delete state.lastErrorAt;
  delete state.lastErrorCode;
  delete state.lastErrorDetailCode;
  delete state.lastAttemptSourceFeeds;
  delete state.lastAttemptExcludedSourceFeeds;
  delete state.lastAttemptExcludedSourceFeedReasons;
  return;
}

function feedListValue(record: Record<string, string>, expectedHeader: string): string {
  const canonical = (value: string): string => value.replace(/^\uFEFF/u, "").trim().toLocaleLowerCase("en-US");
  const key = Object.keys(record).find((candidate) => canonical(candidate) === canonical(expectedHeader));
  const value = key === undefined ? undefined : record[key]?.trim();
  if (value === undefined || value === "") throw new Error(`Awin Feed List is missing ${expectedHeader}`);
  return value;
}

function parseAwinImportedAt(value: string): number {
  const awinTimestamp = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/u.exec(value);
  if (awinTimestamp !== null) {
    const [, year, month, day, hour, minute, second] = awinTimestamp;
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  }
  return Date.parse(value);
}

export function createAwinFeedHttpServer(
  controller: AwinFeedController,
  apiToken: string,
  options: {
    now?: () => number;
    publicSearchLimitPerMinute?: number;
    publicImageLimitPerMinute?: number;
    imageFetch?: (url: string) => Promise<Response>;
    offers?: AwinOffersController;
    ebay?: EbayBrowseController;
    officialStorefronts?: ServedOfficialStorefrontRegistry;
    merchantTrust?: ServedMerchantTrustRegistry;
  } = {}
) {
  const publicSearchLimiter = createPublicSearchLimiter(
    options.publicSearchLimitPerMinute ?? 60,
    options.now ?? Date.now
  );
  const publicImageLimiter = createPublicSearchLimiter(
    options.publicImageLimitPerMinute ?? 180,
    options.now ?? Date.now
  );
  const server = createServer((request, response) => {
    void handleRequest(
      controller,
      apiToken,
      publicSearchLimiter,
      publicImageLimiter,
      options.imageFetch ?? fetchValidatedImage,
      options.offers,
      options.ebay,
      options.officialStorefronts,
      options.merchantTrust,
      request,
      response
    ).catch(() => {
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "INTERNAL_SERVER_ERROR" }));
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

async function handleRequest(
  controller: AwinFeedController,
  apiToken: string,
  publicSearchLimiter: PublicSearchLimiter,
  publicImageLimiter: PublicSearchLimiter,
  imageFetch: (url: string) => Promise<Response>,
  offers: AwinOffersController | undefined,
  ebay: EbayBrowseController | undefined,
  officialStorefronts: ServedOfficialStorefrontRegistry | undefined,
  merchantTrust: ServedMerchantTrustRegistry | undefined,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  const path = requestUrl.pathname;
  if (path === "/v1/merchant-trust") {
    if (request.method !== "GET") {
      json(response, 405, { error: "METHOD_NOT_ALLOWED" });
      return;
    }
    if (merchantTrust === undefined) {
      json(response, 404, { error: "MERCHANT_TRUST_NOT_CONFIGURED" });
      return;
    }
    if (etagMatches(request.headers["if-none-match"], merchantTrust.etag)) {
      response.writeHead(304, {
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
        etag: merchantTrust.etag
      });
      response.end();
      return;
    }
    response.writeHead(200, {
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(merchantTrust.body)),
      etag: merchantTrust.etag,
      "x-content-type-options": "nosniff"
    });
    response.end(merchantTrust.body);
    return;
  }
  if (path === "/v1/official-storefronts") {
    if (request.method !== "GET") {
      json(response, 405, { error: "METHOD_NOT_ALLOWED" });
      return;
    }
    if (officialStorefronts === undefined) {
      json(response, 404, { error: "OFFICIAL_STOREFRONTS_NOT_CONFIGURED" });
      return;
    }
    if (etagMatches(request.headers["if-none-match"], officialStorefronts.etag)) {
      response.writeHead(304, {
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
        etag: officialStorefronts.etag
      });
      response.end();
      return;
    }
    response.writeHead(200, {
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(officialStorefronts.body)),
      etag: officialStorefronts.etag,
      "x-content-type-options": "nosniff"
    });
    response.end(officialStorefronts.body);
    return;
  }
  if (path === "/v1/search" || path === "/v1/offers/search" || path === "/v1/ebay/search") {
    if (request.method !== "POST") {
      json(response, 405, { error: "METHOD_NOT_ALLOWED" });
      return;
    }
    const rate = publicSearchLimiter.take(publicSearchClientKey(request));
    if (!rate.allowed) {
      response.setHeader("retry-after", String(rate.retryAfterSeconds));
      json(response, 429, { error: "RATE_LIMITED" });
      return;
    }
    try {
      const body = await readJsonRequest(request);
      if (path === "/v1/ebay/search") {
        if (ebay === undefined) {
          json(response, 404, { error: "EBAY_NOT_CONFIGURED" });
          return;
        }
        const input = parseEbaySearchInput(body);
        try {
          json(response, 200, await ebay.search(input));
        } catch {
          json(response, 503, { error: "EBAY_UPSTREAM_UNAVAILABLE" });
        }
        return;
      }
      if (path === "/v1/offers/search") {
        const result = offers?.search(parseAwinOfferSearchInput(body));
        if (result === undefined) {
          json(response, 503, { error: "OFFERS_UNAVAILABLE" });
          return;
        }
        json(response, 200, result);
        return;
      }
      const input = parseAwinSearchInput(body);
      const result = controller.search(input);
      if (result === undefined) {
        json(response, 503, { error: "FEED_UNAVAILABLE" });
        return;
      }
      json(response, 200, result);
      return;
    } catch (error) {
      const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
      json(response, status, { error: status === 413 ? "REQUEST_TOO_LARGE" : "INVALID_SEARCH_REQUEST" });
      return;
    }
  }
  if (path === "/v1/images" || path === "/v1/official-images") {
    if (request.method !== "GET") {
      json(response, 405, { error: "METHOD_NOT_ALLOWED" });
      return;
    }
    const rate = publicImageLimiter.take(publicSearchClientKey(request));
    if (!rate.allowed) {
      response.setHeader("retry-after", String(rate.retryAfterSeconds));
      json(response, 429, { error: "RATE_LIMITED" });
      return;
    }
    if (path === "/v1/official-images") {
      const source = approvedOfficialImageUrl(requestUrl.searchParams.get("url") ?? "", officialStorefronts);
      if (source === undefined) {
        json(response, 400, { error: "INVALID_IMAGE_REQUEST" });
        return;
      }
      try {
        const upstream = await imageFetch(source);
        const contentType = upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
        if (!upstream.ok || contentType === undefined || !ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
          json(response, 502, { error: "IMAGE_UPSTREAM_UNAVAILABLE" });
          return;
        }
        const image = await readLimitedBody(upstream, MAX_OFFICIAL_IMAGE_BYTES, "Official image");
        response.writeHead(200, {
          "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
          "content-type": contentType,
          "content-length": String(image.byteLength),
          "x-content-type-options": "nosniff"
        });
        response.end(image);
      } catch {
        json(response, 502, { error: "IMAGE_UPSTREAM_UNAVAILABLE" });
      }
      return;
    }
    const merchantId = requestUrl.searchParams.get("merchantId") ?? "";
    const merchantProductId = requestUrl.searchParams.get("merchantProductId") ?? "";
    if (!/^\d{1,20}$/u.test(merchantId) || merchantProductId.length < 1 || merchantProductId.length > 300) {
      json(response, 400, { error: "INVALID_IMAGE_REQUEST" });
      return;
    }
    const source = controller.getImageSource(merchantId, merchantProductId);
    if (source === undefined) {
      json(response, 404, { error: "IMAGE_NOT_FOUND" });
      return;
    }
    try {
      const upstream = await imageFetch(source);
      const contentType = upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (!upstream.ok || contentType === undefined || !ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
        json(response, 502, { error: "IMAGE_UPSTREAM_UNAVAILABLE" });
        return;
      }
      const image = new Uint8Array(await upstream.arrayBuffer());
      response.writeHead(200, {
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
        "content-type": contentType,
        "content-length": String(image.byteLength),
        "x-content-type-options": "nosniff"
      });
      response.end(image);
    } catch {
      json(response, 502, { error: "IMAGE_UPSTREAM_UNAVAILABLE" });
    }
    return;
  }
  if (request.method !== "GET") {
    json(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }
  const state = controller.getState();
  if (path === "/health") {
    json(response, 200, {
      status: "ok",
      ...feedMetadata(state),
      ...(offers === undefined ? {} : offersMetadata(offers.getState())),
      ...(ebay === undefined ? {} : { ebayStatus: "ready" })
    });
    return;
  }
  if (path === "/ready") {
    json(response, state.snapshot === undefined ? 503 : 200, feedMetadata(state));
    return;
  }
  if (path !== "/v1/feed") {
    json(response, 404, { error: "NOT_FOUND" });
    return;
  }
  if (!validBearer(request.headers.authorization, apiToken)) {
    json(response, 401, { error: "UNAUTHORIZED" });
    return;
  }
  if (state.snapshot === undefined) {
    json(response, 503, { error: "FEED_UNAVAILABLE" });
    return;
  }
  response.writeHead(200, {
    "cache-control": "private, no-store",
    "content-type": "application/gzip",
    "content-length": String(state.snapshot.archive.byteLength),
    "x-content-type-options": "nosniff",
    "x-feed-row-count": String(state.snapshot.feedRows),
    ...(state.snapshot.sourceFeeds === undefined
      ? {}
      : { "x-feed-source-count": String(state.snapshot.sourceFeeds) }),
    "x-feed-snapshot-at": state.snapshot.snapshotAt
  });
  response.end(state.snapshot.archive);
}

function feedMetadata(state: Readonly<FeedState>): Record<string, unknown> {
  const snapshotAgeSeconds = state.snapshot === undefined
    ? undefined
    : Math.max(0, Math.floor((Date.now() - Date.parse(
        state.lastSuccessfulRefreshAt ?? state.snapshot.snapshotAt
      )) / 1_000));
  return {
    feedStatus: state.snapshot === undefined ? "unavailable" : state.lastErrorAt === undefined ? "ready" : "degraded",
    ...(state.snapshot === undefined
      ? {}
      : {
          snapshotAt: state.snapshot.snapshotAt,
          snapshotAgeSeconds,
          feedRows: state.snapshot.feedRows,
          ...(state.snapshot.sourceFeeds === undefined ? {} : { sourceFeeds: state.snapshot.sourceFeeds }),
          excludedSourceFeeds: state.snapshot.excludedSourceFeeds,
          staleSourceFeeds: state.snapshot.staleSourceFeeds,
          ...(state.snapshot.excludedSourceFeeds === 0
            ? {}
            : { excludedSourceFeedReasons: state.snapshot.excludedSourceFeedReasons })
        }),
    ...(state.lastRefreshAt === undefined ? {} : { lastRefreshAt: state.lastRefreshAt }),
    ...(state.lastSuccessfulRefreshAt === undefined
      ? {}
      : { lastSuccessfulRefreshAt: state.lastSuccessfulRefreshAt }),
    consecutiveRefreshFailures: state.consecutiveRefreshFailures,
    ...(state.lastErrorAt === undefined ? {} : { lastErrorAt: state.lastErrorAt }),
    ...(state.lastErrorCode === undefined ? {} : { lastErrorCode: state.lastErrorCode }),
    ...(state.lastErrorDetailCode === undefined ? {} : { lastErrorDetailCode: state.lastErrorDetailCode }),
    ...(state.lastAttemptSourceFeeds === undefined ? {} : { lastAttemptSourceFeeds: state.lastAttemptSourceFeeds }),
    ...(state.lastAttemptExcludedSourceFeeds === undefined
      ? {}
      : { lastAttemptExcludedSourceFeeds: state.lastAttemptExcludedSourceFeeds }),
    ...(state.lastAttemptExcludedSourceFeedReasons === undefined
      ? {}
      : { lastAttemptExcludedSourceFeedReasons: state.lastAttemptExcludedSourceFeedReasons })
  };
}

function feedErrorDetailCode(error: unknown): FeedErrorDetailCode {
  if (error instanceof SourceFetchError) return error.detailCode;
  const message = error instanceof Error ? error.message : "";
  const errorCode = (error as NodeJS.ErrnoException | undefined)?.code ?? "";
  if (message.includes("aborted due to timeout") || message.includes("timed out")) return "SOURCE_TIMEOUT";
  if (
    message === "AWIN_FEED_TOO_LARGE" ||
    message.includes("is too large") ||
    message.startsWith("Cannot create a Buffer larger than")
  ) return "SOURCE_TOO_LARGE";
  if (
    errorCode.startsWith("Z_") ||
    errorCode === "ERR_ENCODING_INVALID_ENCODED_DATA" ||
    message.includes("incorrect header check") ||
    message.includes("unexpected end of file")
  ) return "ARCHIVE_INVALID";
  if (message === "Awin Feed contained no eligible products") return "NO_ELIGIBLE_PRODUCTS";
  if (message === "duplicate Awin merchant product across source Feeds") return "DUPLICATE_PRODUCT_KEY";
  if (message === "invalid enhanced Awin price") return "INVALID_ENHANCED_PRICE";
  if (["duplicate Awin CSV header", "invalid quoted CSV field", "missing Awin CSV header"].includes(message)) return "CSV_INVALID";
  if (message.startsWith("missing Awin field:")) return "MISSING_REQUIRED_FIELD";
  if (message === "invalid Awin merchant ID" || message === "invalid Awin merchant name") return "INVALID_MERCHANT";
  if (message === "unsupported Awin currency") return "UNSUPPORTED_CURRENCY";
  if (message === "inconsistent Awin merchant identity") return "INCONSISTENT_MERCHANT_IDENTITY";
  if (["Invalid URL", "Awin link does not match approved relationship", "unapproved Awin URL", "unapproved Awin merchant URL", "invalid Awin image URL"].includes(message)) return "UNAPPROVED_PRODUCT_URL";
  if (message === "invalid Awin USD price" || message === "Awin USD price out of range") return "INVALID_PRICE";
  if (
    message === "Awin Feed failed approved merchant validation"
  ) return "INDEX_VALIDATION_FAILED";
  return "OTHER";
}

function validatedSnapshot(
  archive: Uint8Array,
  snapshotAt: string,
  sourceFeeds: number | undefined,
  excludedSourceFeeds = 0,
  excludedSourceFeedReasons: Partial<Record<FeedErrorDetailCode, number>> = {},
  staleSourceFeeds = 0
): FeedSnapshot {
  const index = createAwinFeedIndex(archive, snapshotAt);
  const productKeys = new Set<string>();
  for (const product of index.products) {
    productKeys.add(`${product.merchantId}:${product.merchantProductId}`);
  }
  if (
    index.feedRows === 0 ||
    index.validRows !== index.feedRows ||
    index.rejectedRows !== 0 ||
    productKeys.size !== index.validRows
  ) {
    const firstRejectionReason = Object.keys(index.rejectionReasons).sort()[0];
    throw new Error(firstRejectionReason ?? "Awin Feed failed approved merchant validation");
  }
  return {
    archive,
    index,
    snapshotAt,
    feedRows: index.feedRows,
    ...(sourceFeeds === undefined ? {} : { sourceFeeds }),
    excludedSourceFeeds,
    excludedSourceFeedReasons,
    staleSourceFeeds
  };
}

function etagMatches(requestValue: string | undefined, currentValue: string): boolean {
  return requestValue?.split(",").some((candidate) => candidate.trim().replace(/^W\//u, "") === currentValue) === true;
}

function approvedOfficialImageUrl(
  value: string,
  officialStorefronts: ServedOfficialStorefrontRegistry | undefined
): string | undefined {
  if (value.length < 1 || value.length > 4_096 || officialStorefronts === undefined) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" || url.hash !== "") {
      return undefined;
    }
    const allowed = new Set(officialStorefronts.registry.stores.flatMap((store) => [
      store.officialHost,
      store.storefrontHost ?? store.officialHost,
      ...store.imageHosts
    ]));
    return allowed.has(url.hostname.toLocaleLowerCase("en-US")) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp"
]);

async function fetchValidatedImage(url: string): Promise<Response> {
  return safeFetch({ url }, { allowedHosts: [new URL(url).hostname] });
}

function offersMetadata(state: ReturnType<AwinOffersController["getState"]>): Record<string, unknown> {
  return {
    offersStatus: state.deals === undefined ? "unavailable" : state.lastErrorAt === undefined ? "ready" : "degraded",
    ...(state.deals === undefined ? {} : { offerRows: state.deals.length, offersSnapshotAt: state.snapshotAt }),
    ...(state.lastRefreshAt === undefined ? {} : { offersLastRefreshAt: state.lastRefreshAt }),
    ...(state.lastErrorAt === undefined ? {} : { offersLastErrorAt: state.lastErrorAt }),
    ...(state.lastErrorCode === undefined ? {} : { offersLastErrorCode: state.lastErrorCode })
  };
}

async function writeArchiveAtomically(path: string, archive: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, archive, { flag: "wx", mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function validBearer(header: string | undefined, expected: string): boolean {
  if (header === undefined || !header.startsWith("Bearer ")) return false;
  const suppliedDigest = createHash("sha256").update(header.slice("Bearer ".length)).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new Error("invalid Feed service clock");
  return value;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

type PublicSearchLimiter = {
  take(key: string): { allowed: boolean; retryAfterSeconds: number };
};

function createPublicSearchLimiter(limitPerMinute: number, now: () => number): PublicSearchLimiter {
  if (!Number.isInteger(limitPerMinute) || limitPerMinute < 1 || limitPerMinute > 1_000) {
    throw new Error("public search rate limit must be an integer from 1 through 1000");
  }
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    take(key) {
      const currentTime = now();
      let window = windows.get(key);
      if (window === undefined || window.resetAt <= currentTime) {
        if (windows.size >= 10_000) {
          for (const [storedKey, storedWindow] of windows) {
            if (storedWindow.resetAt <= currentTime) windows.delete(storedKey);
          }
          if (windows.size >= 10_000) windows.delete(windows.keys().next().value as string);
        }
        window = { count: 0, resetAt: currentTime + 60_000 };
        windows.set(key, window);
      }
      if (window.count >= limitPerMinute) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - currentTime) / 1_000))
        };
      }
      window.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
  };
}

function publicSearchClientKey(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  const candidate = (Array.isArray(forwarded) ? forwarded.at(-1) : forwarded?.split(",").at(-1))?.trim();
  return candidate !== undefined && /^[0-9a-f:.]{1,64}$/iu.test(candidate)
    ? candidate
    : request.socket.remoteAddress ?? "unknown";
}

class RequestBodyTooLargeError extends Error {}

async function readJsonRequest(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new Error("content type must be application/json");
  const maximumBytes = 4_096;
  const declaredLength = request.headers["content-length"];
  if (
    declaredLength !== undefined &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new RequestBodyTooLargeError("request body is too large");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > maximumBytes) throw new RequestBodyTooLargeError("request body is too large");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("request body must contain valid JSON");
  }
}
