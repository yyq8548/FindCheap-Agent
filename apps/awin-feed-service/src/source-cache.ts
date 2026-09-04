import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import { MAX_AWIN_COMPRESSED_BYTES } from "../../../packages/awin-feed/src/index.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_SOURCE_ENTRIES = 1_000;
const REQUEST_WINDOW_MS = 60 * 60 * 1_000;
const MAX_REQUESTS_PER_SOURCE_PER_HOUR = 5;
const REFRESH_LOCK_STALE_MS = 60_000;
const REFRESH_LOCK_HEARTBEAT_MS = 10_000;

const FeedErrorCodeSchema = z.enum([
  "SOURCE_REQUEST_FAILED",
  "SOURCE_HTTP_ERROR",
  "SOURCE_READ_FAILED",
  "FEED_LIST_INVALID",
  "FEED_INVALID",
  "STORAGE_WRITE_FAILED"
]);

const FeedErrorDetailCodeSchema = z.enum([
  "SOURCE_TIMEOUT",
  "SOURCE_HTTP_429",
  "SOURCE_HTTP_5XX",
  "SOURCE_RATE_LIMITED",
  "SOURCE_TOO_LARGE",
  "ARCHIVE_INVALID",
  "NO_ELIGIBLE_PRODUCTS",
  "DUPLICATE_PRODUCT_KEY",
  "INVALID_ENHANCED_PRICE",
  "CSV_INVALID",
  "MISSING_REQUIRED_FIELD",
  "INVALID_MERCHANT",
  "UNSUPPORTED_CURRENCY",
  "INCONSISTENT_MERCHANT_IDENTITY",
  "UNAPPROVED_PRODUCT_URL",
  "INVALID_PRICE",
  "INDEX_VALIDATION_FAILED",
  "OTHER"
]);

const SourceEntrySchema = z.object({
  feedKey: z.string().min(3).max(120),
  feedKeyHash: z.string().regex(HASH_PATTERN),
  importedAt: z.string().datetime({ offset: true }),
  archiveSha256: z.string().regex(HASH_PATTERN),
  bytes: z.number().int().positive().max(MAX_AWIN_COMPRESSED_BYTES),
  updatedAt: z.string().datetime({ offset: true })
}).strict();

const SnapshotMetadataSchema = z.object({
  archiveSha256: z.string().regex(HASH_PATTERN),
  snapshotAt: z.string().datetime({ offset: true }),
  lastSuccessfulRefreshAt: z.string().datetime({ offset: true }),
  feedRows: z.number().int().positive(),
  sourceFeeds: z.number().int().nonnegative(),
  excludedSourceFeeds: z.number().int().nonnegative(),
  excludedSourceFeedReasons: z.record(FeedErrorDetailCodeSchema, z.number().int().positive()),
  staleSourceFeeds: z.number().int().nonnegative()
}).strict();

const HealthMetadataSchema = z.object({
  consecutiveRefreshFailures: z.number().int().nonnegative(),
  lastErrorAt: z.string().datetime({ offset: true }).optional(),
  lastErrorCode: FeedErrorCodeSchema.optional(),
  lastErrorDetailCode: FeedErrorDetailCodeSchema.optional()
}).strict();

const ManifestSchema = z.object({
  version: z.literal(1),
  snapshot: SnapshotMetadataSchema.optional(),
  health: HealthMetadataSchema,
  sources: z.array(SourceEntrySchema).max(MAX_SOURCE_ENTRIES)
}).strict();

const RequestLedgerSchema = z.object({
  version: z.literal(1),
  requests: z.record(z.string().regex(HASH_PATTERN), z.array(z.string().datetime({ offset: true })).max(
    MAX_REQUESTS_PER_SOURCE_PER_HOUR
  ))
}).strict();

export type SourceCacheEntry = z.infer<typeof SourceEntrySchema>;
export type SnapshotMetadata = z.infer<typeof SnapshotMetadataSchema>;
export type FeedCacheManifest = z.infer<typeof ManifestSchema>;

export type FeedStatePaths = {
  manifestPath: string;
  requestLedgerPath: string;
  refreshLockPath: string;
  sourceDirectory: string;
};

export function feedStatePaths(dataPath: string): FeedStatePaths {
  return {
    manifestPath: `${dataPath}.metadata.json`,
    requestLedgerPath: `${dataPath}.requests.json`,
    refreshLockPath: `${dataPath}.refresh.lock`,
    sourceDirectory: `${dataPath}.sources`
  };
}

export function sourceFeedKeyHash(feedKey: string): string {
  return createHash("sha256").update(feedKey).digest("hex");
}

export function archiveSha256(archive: Uint8Array): string {
  return createHash("sha256").update(archive).digest("hex");
}

export async function loadFeedCacheManifest(path: string): Promise<FeedCacheManifest> {
  try {
    const parsed = ManifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
    for (const source of parsed.sources) {
      if (sourceFeedKeyHash(source.feedKey) !== source.feedKeyHash) throw new Error("invalid source cache identity");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return emptyFeedCacheManifest();
    return emptyFeedCacheManifest();
  }
}

export function emptyFeedCacheManifest(): FeedCacheManifest {
  return { version: 1, health: { consecutiveRefreshFailures: 0 }, sources: [] };
}

export async function readCachedSource(
  paths: FeedStatePaths,
  entry: SourceCacheEntry
): Promise<Uint8Array | undefined> {
  try {
    const archive = await readFile(join(paths.sourceDirectory, `${entry.feedKeyHash}.csv.gz`));
    if (archive.byteLength !== entry.bytes || archiveSha256(archive) !== entry.archiveSha256) return undefined;
    return archive;
  } catch {
    return undefined;
  }
}

export async function writeCachedSource(
  paths: FeedStatePaths,
  entry: SourceCacheEntry,
  archive: Uint8Array
): Promise<void> {
  if (
    entry.feedKeyHash !== sourceFeedKeyHash(entry.feedKey) ||
    entry.archiveSha256 !== archiveSha256(archive) ||
    entry.bytes !== archive.byteLength
  ) {
    throw new Error("source cache metadata does not match archive");
  }
  await writeFileAtomically(join(paths.sourceDirectory, `${entry.feedKeyHash}.csv.gz`), archive);
}

export async function writeFeedCacheManifest(path: string, manifest: FeedCacheManifest): Promise<void> {
  const validated = ManifestSchema.parse(manifest);
  await writeFileAtomically(path, Buffer.from(`${JSON.stringify(validated)}\n`, "utf8"));
}

export async function removeUnusedCachedSources(
  paths: FeedStatePaths,
  activeHashes: ReadonlySet<string>
): Promise<void> {
  let files: string[];
  try {
    files = await readdir(paths.sourceDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await Promise.all(files.filter((file) => /^[a-f0-9]{64}\.csv\.gz$/u.test(file))
    .filter((file) => !activeHashes.has(file.slice(0, 64)))
    .map((file) => unlink(join(paths.sourceDirectory, file))));
}

export async function recordSourceRequest(
  path: string,
  feedKeyHash: string,
  now: Date
): Promise<boolean> {
  let ledger: z.infer<typeof RequestLedgerSchema> = { version: 1, requests: {} };
  try {
    ledger = RequestLedgerSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") ledger = { version: 1, requests: {} };
  }
  const cutoff = now.getTime() - REQUEST_WINDOW_MS;
  const requests = Object.fromEntries(Object.entries(ledger.requests)
    .map(([key, values]) => [key, values.filter((value) => Date.parse(value) > cutoff)] as const)
    .filter((entry) => entry[1].length > 0));
  const current = requests[feedKeyHash] ?? [];
  if (current.length >= MAX_REQUESTS_PER_SOURCE_PER_HOUR) return false;
  requests[feedKeyHash] = [...current, now.toISOString()];
  await writeFileAtomically(path, Buffer.from(`${JSON.stringify({ version: 1, requests })}\n`, "utf8"));
  return true;
}

export async function acquireRefreshLock(
  path: string,
  now: Date
): Promise<() => Promise<void>> {
  await mkdir(dirname(path), { recursive: true });
  const token = randomUUID();
  const attempt = async (): Promise<boolean> => {
    try {
      await writeFile(path, JSON.stringify({ token, startedAt: now.toISOString() }), { flag: "wx", mode: 0o600 });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return false;
    }
  };
  if (!await attempt()) {
    const lockAge = await stat(path).then((value) => now.getTime() - value.mtimeMs).catch(() => 0);
    if (lockAge <= REFRESH_LOCK_STALE_MS) throw new Error("Awin Feed refresh is already running");
    await unlink(path).catch(() => {});
    if (!await attempt()) throw new Error("Awin Feed refresh is already running");
  }
  const heartbeat = setInterval(() => {
    void renewRefreshLock(path, token);
  }, REFRESH_LOCK_HEARTBEAT_MS);
  heartbeat.unref();
  return async () => {
    clearInterval(heartbeat);
    try {
      const lock = JSON.parse(await readFile(path, "utf8")) as { token?: unknown };
      if (lock.token === token) await unlink(path);
    } catch {
      // Lock cleanup is best effort; stale locks expire.
    }
  };
}

async function renewRefreshLock(path: string, token: string): Promise<void> {
  try {
    const lock = JSON.parse(await readFile(path, "utf8")) as { token?: unknown };
    if (lock.token !== token) return;
    const now = new Date();
    await utimes(path, now, now);
  } catch {
    // A missing or replaced lease belongs to the next refresh attempt.
  }
}

async function writeFileAtomically(path: string, data: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, data, { flag: "wx", mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}
