import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname } from "node:path";

import {
  MAX_AWIN_COMPRESSED_BYTES,
  readLimitedBody,
  validateAwinFeedArchive
} from "../../../packages/awin-feed/src/index.js";
import type { AwinFeedServiceEnvironment } from "./environment.js";

type FeedSnapshot = {
  archive: Uint8Array;
  snapshotAt: string;
  feedRows: number;
};

type FeedState = {
  snapshot?: FeedSnapshot;
  lastRefreshAt?: string;
  lastErrorAt?: string;
  lastErrorCode?: "SOURCE_REQUEST_FAILED" | "SOURCE_HTTP_ERROR" | "SOURCE_READ_FAILED" | "FEED_INVALID" | "STORAGE_WRITE_FAILED";
};

type Dependencies = {
  fetch?: typeof fetch;
  now?: () => Date;
};

export type AwinFeedController = {
  loadExisting(): Promise<void>;
  refresh(): Promise<void>;
  getState(): Readonly<FeedState>;
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
      state.snapshot = validatedSnapshot(archive, snapshotAt);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
  const runRefresh = async (): Promise<void> => {
    let failureCode: NonNullable<FeedState["lastErrorCode"]> = "SOURCE_REQUEST_FAILED";
    try {
      const response = await fetchRequest(environment.sourceUrl, {
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
      const archive = await readLimitedBody(
        response,
        MAX_AWIN_COMPRESSED_BYTES,
        "Awin source"
      );
      const snapshotAt = validDate(now()).toISOString();
      failureCode = "FEED_INVALID";
      const snapshot = validatedSnapshot(archive, snapshotAt);
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
    getState: () => state
  };
}

export function createAwinFeedHttpServer(controller: AwinFeedController, apiToken: string) {
  const server = createServer((request, response) => {
    void handleRequest(controller, apiToken, request, response).catch(() => {
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
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (request.method !== "GET") {
    json(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const state = controller.getState();
  if (path === "/health") {
    json(response, 200, { status: "ok", ...feedMetadata(state) });
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
    "x-feed-snapshot-at": state.snapshot.snapshotAt
  });
  response.end(state.snapshot.archive);
}

function feedMetadata(state: Readonly<FeedState>): Record<string, unknown> {
  return {
    feedStatus: state.snapshot === undefined ? "unavailable" : state.lastErrorAt === undefined ? "ready" : "degraded",
    ...(state.snapshot === undefined
      ? {}
      : { snapshotAt: state.snapshot.snapshotAt, feedRows: state.snapshot.feedRows }),
    ...(state.lastRefreshAt === undefined ? {} : { lastRefreshAt: state.lastRefreshAt }),
    ...(state.lastErrorAt === undefined ? {} : { lastErrorAt: state.lastErrorAt }),
    ...(state.lastErrorCode === undefined ? {} : { lastErrorCode: state.lastErrorCode })
  };
}

function validatedSnapshot(archive: Uint8Array, snapshotAt: string): FeedSnapshot {
  const validation = validateAwinFeedArchive(archive);
  if (
    validation.feedRows === 0 ||
    validation.validRows !== validation.feedRows ||
    validation.rejectedRows !== 0 ||
    validation.uniqueMerchantProductIds !== validation.validRows
  ) {
    throw new Error("Awin Feed failed approved merchant validation");
  }
  return { archive, snapshotAt, feedRows: validation.feedRows };
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

function json(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(body));
}
