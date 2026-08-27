import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname } from "node:path";

import {
  createAwinFeedIndex,
  MAX_AWIN_COMPRESSED_BYTES,
  mergeAwinFeedArchives,
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

const MAX_AWIN_FEED_LIST_BYTES = 4 * 1024 * 1024;

type FeedSnapshot = {
  archive: Uint8Array;
  index: AwinFeedIndex;
  snapshotAt: string;
  feedRows: number;
  sourceFeeds: number;
};

type FeedState = {
  snapshot?: FeedSnapshot;
  lastRefreshAt?: string;
  lastErrorAt?: string;
  lastErrorCode?: "SOURCE_REQUEST_FAILED" | "SOURCE_HTTP_ERROR" | "SOURCE_READ_FAILED" | "FEED_LIST_INVALID" | "FEED_INVALID" | "STORAGE_WRITE_FAILED";
};

type Dependencies = {
  fetch?: typeof fetch;
  now?: () => Date;
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
  const state: FeedState = {};
  let activeRefresh: Promise<void> | undefined;

  const loadExisting = async (): Promise<void> => {
    try {
      const archive = await readFile(environment.dataPath);
      const snapshotAt = (await stat(environment.dataPath)).mtime.toISOString();
      state.snapshot = validatedSnapshot(archive, snapshotAt, environment.sourceUrls.length);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
  const runRefresh = async (): Promise<void> => {
    let failureCode: NonNullable<FeedState["lastErrorCode"]> = "SOURCE_REQUEST_FAILED";
    try {
      if (environment.sourceFeedListUrl !== undefined) failureCode = "FEED_LIST_INVALID";
      const sourceUrls = environment.sourceFeedListUrl === undefined
        ? environment.sourceUrls
        : await discoverJoinedFeedUrls(environment, fetchRequest);
      const sourceArchives: Uint8Array[] = [];
      for (const sourceUrl of sourceUrls) {
        const response = await fetchRequest(sourceUrl, {
          method: "GET",
          redirect: "error",
          headers: { accept: "application/gzip, application/x-gzip, application/octet-stream" },
          signal: AbortSignal.timeout(environment.sourceTimeoutMs)
        });
        if (!response.ok) {
          failureCode = "SOURCE_HTTP_ERROR";
          throw new Error(`Awin source returned HTTP ${response.status}`);
        }
        failureCode = "SOURCE_READ_FAILED";
        sourceArchives.push(await readLimitedBody(
          response,
          MAX_AWIN_COMPRESSED_BYTES,
          "Awin source"
        ));
      }
      const snapshotAt = validDate(now()).toISOString();
      failureCode = "FEED_INVALID";
      const archive = mergeAwinFeedArchives(
        sourceArchives,
        environment.sourceFeedListUrl === undefined
          ? {}
          : {
              ...(environment.sourceFeedRegion === "US" ? { defaultCurrency: "USD" as const } : {}),
              canonicalizeMerchantNames: true
            }
      );
      const snapshot = validatedSnapshot(archive, snapshotAt, sourceUrls.length);
      failureCode = "STORAGE_WRITE_FAILED";
      await writeArchiveAtomically(environment.dataPath, archive);
      state.snapshot = snapshot;
      state.lastRefreshAt = snapshotAt;
      delete state.lastErrorAt;
      delete state.lastErrorCode;
    } catch (error) {
      state.lastErrorAt = validDate(now()).toISOString();
      state.lastErrorCode = failureCode;
      throw error;
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

async function discoverJoinedFeedUrls(
  environment: AwinFeedServiceEnvironment,
  fetchRequest: typeof fetch
): Promise<string[]> {
  const response = await fetchRequest(environment.sourceFeedListUrl!, {
    method: "GET",
    redirect: "error",
    headers: { accept: "text/csv, text/plain, application/octet-stream" },
    signal: AbortSignal.timeout(environment.sourceTimeoutMs)
  });
  if (!response.ok) throw new Error(`Awin Feed List returned HTTP ${response.status}`);
  const encoded = await readLimitedBody(response, MAX_AWIN_FEED_LIST_BYTES, "Awin Feed List");
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
  const urls = [...selected.values()]
    .sort((left, right) =>
      numericCompare(left.advertiserId, right.advertiserId) || numericCompare(left.feedId, right.feedId)
    )
    .map((feed) => feed.url);
  if (urls.length === 0) throw new Error("Awin Feed List contains no joined Feeds for the configured region and language");
  if (new Set(urls).size !== urls.length) throw new Error("Awin Feed List contains duplicate download URLs");
  return urls;
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
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  const path = requestUrl.pathname;
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
  if (path === "/v1/images") {
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
    "x-feed-source-count": String(state.snapshot.sourceFeeds),
    "x-feed-snapshot-at": state.snapshot.snapshotAt
  });
  response.end(state.snapshot.archive);
}

function feedMetadata(state: Readonly<FeedState>): Record<string, unknown> {
  return {
    feedStatus: state.snapshot === undefined ? "unavailable" : state.lastErrorAt === undefined ? "ready" : "degraded",
    ...(state.snapshot === undefined
      ? {}
      : {
          snapshotAt: state.snapshot.snapshotAt,
          feedRows: state.snapshot.feedRows,
          sourceFeeds: state.snapshot.sourceFeeds
        }),
    ...(state.lastRefreshAt === undefined ? {} : { lastRefreshAt: state.lastRefreshAt }),
    ...(state.lastErrorAt === undefined ? {} : { lastErrorAt: state.lastErrorAt }),
    ...(state.lastErrorCode === undefined ? {} : { lastErrorCode: state.lastErrorCode })
  };
}

function validatedSnapshot(archive: Uint8Array, snapshotAt: string, sourceFeeds: number): FeedSnapshot {
  const index = createAwinFeedIndex(archive, snapshotAt);
  if (
    index.feedRows === 0 ||
    index.validRows !== index.feedRows ||
    index.rejectedRows !== 0 ||
    new Set(index.products.map((product) => `${product.merchantId}:${product.merchantProductId}`)).size !== index.validRows
  ) {
    throw new Error("Awin Feed failed approved merchant validation");
  }
  return { archive, index, snapshotAt, feedRows: index.feedRows, sourceFeeds };
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
