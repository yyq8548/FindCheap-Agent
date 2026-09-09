import { randomUUID } from "node:crypto";
import { mkdir, open, opendir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

const WatchIdSchema = z.string().uuid();
export const WatchAutomationIdSchema = z.string().trim().min(1).max(128)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u);
const MAX_WATCHES = 500;
const DEFAULT_WATCH_DURATION_MS = 30 * 24 * 60 * 60_000;

export const WatchConditionSchema = z.enum([
  "PRICE_BELOW",
  "DISCOUNT_AT_LEAST",
  "COUPON_AVAILABLE",
  "CASHBACK_AT_LEAST",
  "IN_STOCK",
  "RESTOCKED"
]);

export const ProductWatchConditionPreferenceSchema = z.enum([
  "NEW",
  "USED",
  "REFURBISHED",
  "OPEN_BOX",
  "ANY"
]);

export const ProductWatchPriceBasisSchema = z.enum([
  "ITEM_PRICE",
  "DELIVERED_TOTAL"
]);

export const ProductWatchIdentitySchema = z.object({
  generation: z.string().trim().min(1).max(80).regex(/[\p{L}\p{N}]/u).optional(),
  modelNumber: z.string().trim().min(1).max(120).regex(/[\p{L}\p{N}]/u).optional(),
  gtin: z.string().regex(/^\d{8,14}$/u).optional(),
  variantDimensions: z.record(z.string().trim().min(1).max(80), z.string().trim().min(1).max(120)).optional()
}).strict().superRefine((identity, context) => {
  if (identity.generation === undefined && identity.modelNumber === undefined && identity.gtin === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "product identity requires generation, modelNumber, or gtin" });
  }
});

const WatchSpecShape = {
  query: z.string().trim().min(2).max(300),
  merchant: z.string().trim().min(2).max(160).optional(),
  condition: WatchConditionSchema,
  threshold: z.number().nonnegative().max(100_000_000).optional()
    .describe("PRICE_BELOW is an exclusive ceiling in integer USD cents: for 'below $40', send 4000 so $39.99 triggers; never subtract one cent. DISCOUNT_AT_LEAST and CASHBACK_AT_LEAST use percentage points."),
  priceBasis: ProductWatchPriceBasisSchema.optional()
    .describe("PRICE_BELOW requires explicit ITEM_PRICE, comparing public item price only. DELIVERED_TOTAL is retained for legacy compatibility but unavailable without recurring Cart authorization."),
  zipCode: z.string().regex(/^\d{5}(?:-\d{4})?$/u).optional(),
  membershipIds: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  identity: ProductWatchIdentitySchema.optional(),
  conditionPreference: ProductWatchConditionPreferenceSchema.optional(),
  intervalMinutes: z.number().int().min(15).max(1_440).default(60),
  expiresAt: z.string().datetime({ offset: true }).optional()
};

export const WatchQuoteReferenceSchema = z.object({
  selectionId: z.string().uuid().optional(),
  renderId: z.string().uuid().optional(),
  variantId: z.string().regex(/^\d{1,30}$/u).optional()
}).strict();

const ShopifyWatchSelectedProductSchema = z.object({
  sourceKind: z.literal("SHOPIFY_GLOBAL_CATALOG"),
  merchantId: z.string().trim().min(1).max(160),
  merchant: z.string().trim().min(1).max(160),
  sourceHost: z.string().trim().min(1).max(253),
  variantId: z.string().regex(/^\d{1,30}$/u),
  title: z.string().trim().min(1).max(500),
  merchantUrl: z.string().url(),
  condition: z.enum(["NEW", "USED", "REFURBISHED", "OPEN_BOX", "UNKNOWN"]),
  variantDimensions: z.record(z.string(), z.string()),
  selectedAt: z.string().datetime({ offset: true })
}).strict();

export const WooWatchSelectedProductSchema = ShopifyWatchSelectedProductSchema.omit({ variantId: true }).extend({
  sourceKind: z.literal("WOOCOMMERCE_STORE_API"),
  productId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  parentProductId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  variationId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  productType: z.enum(["simple", "variation"])
}).strict();

export const WatchSelectedProductSchema = z.discriminatedUnion("sourceKind", [
  ShopifyWatchSelectedProductSchema, WooWatchSelectedProductSchema
]);

export const WatchSpecInputSchema = z.object({
  ...WatchSpecShape,
  quoteReference: WatchQuoteReferenceSchema.optional()
}).strict();

const PersistedWatchSpecSchema = z.object({
  ...WatchSpecShape,
  selectedProduct: WatchSelectedProductSchema.optional()
}).strict();

export const WatchSpecSchema = PersistedWatchSpecSchema.superRefine((spec, context) => {
  const selected = spec.selectedProduct;
  if (selected?.sourceKind === "WOOCOMMERCE_STORE_API") {
    const validTarget = selected.productType === "simple"
      ? selected.variationId === undefined && selected.parentProductId === undefined
      : selected.variationId !== undefined && selected.variationId !== selected.productId &&
        selected.parentProductId === selected.productId;
    if (!validTarget) context.addIssue({ code: z.ZodIssueCode.custom,
      message: "Woo Watch requires a simple product or an explicitly selected variation" });
  }
  if (["PRICE_BELOW", "DISCOUNT_AT_LEAST", "CASHBACK_AT_LEAST"].includes(spec.condition) && spec.threshold === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `${spec.condition} requires threshold` });
  }
  if (["DISCOUNT_AT_LEAST", "COUPON_AVAILABLE", "CASHBACK_AT_LEAST"].includes(spec.condition) && spec.merchant === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `${spec.condition} requires merchant` });
  }
  if (spec.priceBasis === "DELIVERED_TOTAL" && spec.zipCode === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "DELIVERED_TOTAL requires zipCode" });
  }
  if (spec.priceBasis === "DELIVERED_TOTAL" && spec.selectedProduct === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "DELIVERED_TOTAL requires selectedProduct" });
  }
});

export type WatchSpec = z.infer<typeof WatchSpecSchema>;

type ProductWatchClarificationSpec = z.infer<typeof WatchSpecInputSchema> | WatchSpec;

export function productWatchClarificationQuestions(spec: ProductWatchClarificationSpec): string[] {
  if (!["PRICE_BELOW", "IN_STOCK", "RESTOCKED"].includes(spec.condition)) return [];
  const questions: string[] = [];
  const selectedProduct = "selectedProduct" in spec ? spec.selectedProduct : undefined;
  const quoteReference = "quoteReference" in spec ? spec.quoteReference : undefined;
  const stableQuoteReference = quoteReference?.selectionId !== undefined ||
    (quoteReference?.renderId !== undefined && quoteReference.variantId !== undefined);
  const stableSelectionProvided = selectedProduct !== undefined ||
    (spec.priceBasis === "DELIVERED_TOTAL" && stableQuoteReference);
  const identity = spec.identity;
  if (spec.condition === "PRICE_BELOW" && spec.priceBasis === undefined) {
    questions.push("Should this watch compare ITEM_PRICE (public item price only, excluding shipping and tax)?");
  }
  if (spec.priceBasis === "DELIVERED_TOTAL" && spec.zipCode === undefined) {
    questions.push("Which US ZIP code should be used for shipping and tax estimates?");
  }
  if (spec.priceBasis === "DELIVERED_TOTAL" && !stableSelectionProvided) {
    questions.push("Which previously returned product should be monitored? Provide its quoteReference or selectionId.");
  }
  if (spec.priceBasis !== "DELIVERED_TOTAL" && !stableSelectionProvided && identity === undefined) {
    questions.push("Which generation, exact model number, or GTIN should this watch monitor?");
  } else if (spec.priceBasis !== "DELIVERED_TOTAL" && !stableSelectionProvided &&
    identity?.generation !== undefined &&
    identity.modelNumber === undefined &&
    identity.gtin === undefined &&
    spec.merchant === undefined
  ) {
    questions.push("Which merchant should this generation or named style watch monitor?");
  }
  if (spec.conditionPreference === undefined) {
    questions.push("Which product condition should this watch accept: NEW, USED, REFURBISHED, OPEN_BOX, or ANY?");
  }
  return questions;
}

export const WatchStopIntentSchema = z.object({
  watchId: WatchIdSchema,
  automationId: WatchAutomationIdSchema,
  reason: z.enum(["RESTOCKED", "EXPIRED", "PAUSED", "DELETED"]),
  requestedAt: z.string().datetime({ offset: true }),
  status: z.literal("STOP_REQUIRED")
}).strict();
export type WatchStopIntent = z.infer<typeof WatchStopIntentSchema>;

export const WatchCompletionNotificationSchema = z.object({
  eventId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  status: z.literal("DELIVERY_UNCONFIRMED"),
  message: z.string().min(1).max(4_000),
  observation: z.record(z.string(), z.unknown())
}).strict();

export const WatchRecordSchema = z.object({
  watchId: z.string().uuid(),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  completionEventId: z.string().uuid().optional(),
  completionNotification: WatchCompletionNotificationSchema.optional(),
  stopIntent: WatchStopIntentSchema.optional(),
  automationId: WatchAutomationIdSchema.optional(),
  schedulingState: z.enum(["PENDING", "BOUND"]).optional(),
  spec: WatchSpecSchema,
  status: z.enum(["ACTIVE", "PAUSED", "EXPIRED", "COMPLETED"]),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  lastCheckedAt: z.string().datetime({ offset: true }).optional(),
  wasSatisfied: z.boolean().optional(),
  lastObservation: z.record(z.string(), z.unknown()).optional()
}).strict().superRefine((record, context) => {
  if (record.completionNotification !== undefined && (record.status !== "COMPLETED" ||
    record.spec.condition !== "RESTOCKED" || record.completionNotification.eventId !== record.completionEventId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "notification must match its one-shot completion event" });
  }
  if (record.stopIntent !== undefined && (record.stopIntent.watchId !== record.watchId ||
    record.stopIntent.automationId !== record.automationId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "stop intent must match its Watch binding" });
  }
  if ((record.schedulingState === "BOUND") !== (record.automationId !== undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "BOUND schedulingState and automationId must be set together"
    });
  }
});

export type WatchRecord = z.infer<typeof WatchRecordSchema>;
export type WatchInitialObservation = { checkedAt: string; data: Record<string, unknown> };

export interface WatchStore {
  create(spec: WatchSpec, now: string, initialObservation?: WatchInitialObservation): Promise<WatchRecord>;
  get(watchId: string): Promise<WatchRecord | undefined>;
  list(): Promise<WatchRecord[]>;
  save(record: WatchRecord): Promise<WatchRecord>;
  delete(watchId: string): Promise<boolean>;
  listPendingStops(): Promise<WatchStopIntent[]>;
}

export class WatchStateConflictError extends Error {
  constructor() { super("WATCH_STATE_CONFLICT"); this.name = "WatchStateConflictError"; }
}

export function watchStopIntent(record: WatchRecord, reason: WatchStopIntent["reason"], requestedAt: string): WatchStopIntent | undefined {
  return record.stopIntent ?? (record.automationId === undefined ? undefined : {
    watchId: record.watchId, automationId: record.automationId, reason, requestedAt, status: "STOP_REQUIRED"
  });
}

function nextRevision(existing: WatchRecord | undefined, requested: WatchRecord,
  records: WatchRecord[], stops: WatchStopIntent[]): WatchRecord {
  if (existing === undefined || (existing.revision ?? 0) !== (requested.revision ?? 0) ||
    (requested.status === "ACTIVE" && requested.stopIntent !== undefined) ||
    (existing.completionEventId !== undefined && existing.completionEventId !== requested.completionEventId) ||
    (existing.status === "COMPLETED" &&
      JSON.stringify(existing.completionNotification) !== JSON.stringify(requested.completionNotification)) ||
    (["EXPIRED", "COMPLETED"].includes(existing.status) && requested.status !== existing.status) ||
    (existing.stopIntent !== undefined && JSON.stringify(existing.stopIntent) !== JSON.stringify(requested.stopIntent)) ||
    (existing.automationId !== undefined && existing.automationId !== requested.automationId) ||
    ((isWooWatch(existing.spec) || isWooWatch(requested.spec)) &&
      JSON.stringify(existing.spec.selectedProduct) !== JSON.stringify(requested.spec.selectedProduct))) throw new WatchStateConflictError();
  if (requested.automationId !== undefined &&
    (records.some(record => record.watchId !== requested.watchId && record.automationId === requested.automationId) ||
      stops.some(stop => stop.watchId !== requested.watchId && stop.automationId === requested.automationId))) throw new WatchStateConflictError();
  return WatchRecordSchema.parse({ ...requested, revision: (existing.revision ?? 0) + 1 });
}

function matchesActiveWatch(record: WatchRecord, requested: WatchSpec, now: string): boolean {
  const previous = requested.expiresAt === undefined ? { ...record.spec, expiresAt: undefined } : record.spec;
  const comparable = (spec: WatchSpec) => spec.selectedProduct?.sourceKind === "WOOCOMMERCE_STORE_API"
    ? { ...spec, selectedProduct: { ...spec.selectedProduct, selectedAt: undefined } } : spec;
  return (record.status === "ACTIVE" || record.status === "PAUSED") &&
    (record.spec.expiresAt === undefined || Date.parse(record.spec.expiresAt) > Date.parse(now)) &&
    JSON.stringify(comparable(previous)) === JSON.stringify(comparable(requested));
}

function isWooWatch(spec: WatchSpec): boolean {
  return spec.selectedProduct?.sourceKind === "WOOCOMMERCE_STORE_API";
}

export function createMemoryWatchStore(): WatchStore {
  const records = new Map<string, WatchRecord>();
  const deletedStops = new Map<string, WatchStopIntent>();
  const pendingStops = () => [...deletedStops.values(), ...[...records.values()].flatMap(record => record.stopIntent ?? [])];
  return {
    async create(spec, now, initialObservation) {
      const normalized = WatchSpecSchema.parse(spec);
      const existing = [...records.values()].find((record) => matchesActiveWatch(record, normalized, now));
      if (existing !== undefined) return structuredClone(existing);
      if (records.size >= MAX_WATCHES) throw new Error("watch limit reached");
      const record = WatchRecordSchema.parse({
        watchId: randomUUID(),
        revision: 0,
        schedulingState: "PENDING",
        spec: { ...normalized, expiresAt: normalized.expiresAt ?? new Date(Date.parse(now) + DEFAULT_WATCH_DURATION_MS).toISOString() },
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
        ...(initialObservation === undefined ? {} : {
          lastCheckedAt: initialObservation.checkedAt, lastObservation: structuredClone(initialObservation.data)
        })
      });
      records.set(record.watchId, record);
      return structuredClone(record);
    },
    async get(watchId) { return structuredClone(records.get(watchId)); },
    async list() { return structuredClone([...records.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))); },
    async save(record) {
      const validated = WatchRecordSchema.parse(record);
      const saved = nextRevision(records.get(validated.watchId), validated, [...records.values()], pendingStops());
      records.set(saved.watchId, saved);
      return structuredClone(saved);
    },
    async delete(watchId) {
      const record = records.get(watchId);
      if (record === undefined) return false;
      const intent = watchStopIntent(record, "DELETED", new Date().toISOString());
      if (intent !== undefined) deletedStops.set(watchId, intent);
      return records.delete(watchId);
    },
    async listPendingStops() { return structuredClone(pendingStops()); }
  };
}

export function createJsonWatchStore(directory: string, options: { kernelLock?: boolean } = {}): WatchStore {
  const maxRecordBytes = 256 * 1024;
  const maxDirectoryEntries = 2048;
  const fileFor = (watchId: string, woo: boolean) => join(directory,
    `${WatchIdSchema.parse(watchId)}${woo ? ".woocommerce-v1" : ""}.json`);
  const deletedFileFor = (watchId: string, woo: boolean) => join(directory,
    `${WatchIdSchema.parse(watchId)}${woo ? ".woocommerce-v1" : ""}.deleted.json`);
  const TombstoneSchema = z.object({ watchId: WatchIdSchema, deletedAt: z.string().datetime({ offset: true }),
    stopIntent: WatchStopIntentSchema.optional() }).strict().refine(value =>
    value.stopIntent === undefined || value.stopIntent.watchId === value.watchId);
  const ensure = () => mkdir(directory, { recursive: true, mode: 0o700 });
  const readJson = async (file: string): Promise<unknown> => {
    let handle;
    try { handle = await open(file, "r"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maxRecordBytes) throw new Error("WATCH_STORE_RECORD_INVALID");
      const buffer = Buffer.alloc(maxRecordBytes + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > maxRecordBytes) throw new Error("WATCH_STORE_RECORD_INVALID");
      return JSON.parse(buffer.subarray(0, length).toString("utf8"));
    } finally { await handle.close(); }
  };
  const readState = async (watchId: string) => {
    const [legacyValue, wooValue, legacyDeleted, wooDeleted] = await Promise.all([
      readJson(fileFor(watchId, false)), readJson(fileFor(watchId, true)),
      readJson(deletedFileFor(watchId, false)), readJson(deletedFileFor(watchId, true))
    ]);
    const woo = wooValue !== undefined || wooDeleted !== undefined;
    if (woo && (legacyValue !== undefined || legacyDeleted !== undefined)) throw new Error("WATCH_STORE_RECORD_INVALID");
    const deleted = woo ? wooDeleted : legacyDeleted;
    if (deleted !== undefined) {
      const tombstone = TombstoneSchema.parse(deleted);
      if (tombstone.watchId !== watchId) throw new Error("WATCH_STORE_RECORD_INVALID");
      return { woo, tombstone, record: undefined };
    }
    const value = woo ? wooValue : legacyValue;
    if (value === undefined) return { woo, record: undefined, tombstone: undefined };
    const record = WatchRecordSchema.parse(value);
    if (record.watchId !== watchId || isWooWatch(record.spec) !== woo) throw new Error("WATCH_STORE_RECORD_INVALID");
    return { woo, record, tombstone: undefined };
  };
  const read = async (watchId: string) => (await readState(watchId)).record;
  const listState = async () => {
    await ensure();
    const entries = await opendir(directory);
    const records: WatchRecord[] = [];
    const stops = new Map<string, WatchStopIntent>();
    const watchIds = new Set<string>();
    let count = 0;
    for await (const entry of entries) {
      if (++count > maxDirectoryEntries) throw new Error("WATCH_STORE_DIRECTORY_LIMIT");
      if (/^[0-9a-f-]{36}(?:\.woocommerce-v1)?(?:\.deleted)?\.json$/u.test(entry.name)) {
        watchIds.add(entry.name.slice(0, 36));
      }
    }
    for (const watchId of watchIds) {
      const { record, tombstone } = await readState(watchId);
      if (record !== undefined) records.push(record);
      const stop = tombstone?.stopIntent ?? record?.stopIntent;
      if (stop !== undefined) stops.set(watchId, stop);
    }
    return { records: records.sort((a, b) => a.createdAt.localeCompare(b.createdAt)), stops: [...stops.values()] };
  };
  const fileLocked = async <T>(action: () => Promise<T>): Promise<T> => {
    await ensure();
    const lockFile = join(directory, ".watch-store.lock");
    const started = performance.now();
    let lock;
    while (lock === undefined) {
      try { lock = await open(lockFile, "wx", 0o600); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (performance.now() - started >= 2000) throw new Error("WATCH_STORE_BUSY");
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    try { return await action(); }
    finally { await lock.close(); await rm(lockFile); }
  };
  // New task directories never use the legacy file-lock protocol. SQLite owns
  // this lock in the kernel, so a crashed writer cannot leave a stale owner file.
  const kernelLocked = async <T>(action: () => Promise<T>): Promise<T> => {
    await ensure();
    const database = new DatabaseSync(join(directory, ".watch-store.sqlite"));
    const started = performance.now();
    let acquired = false;
    try {
      while (!acquired) {
        try { database.exec("BEGIN IMMEDIATE"); acquired = true; }
        catch (error) {
          if (!(error instanceof Error) || !/database is locked/u.test(error.message)) throw error;
          if (performance.now() - started >= 2000) throw new Error("WATCH_STORE_BUSY");
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
      return await action();
    } finally {
      try { if (acquired) database.exec("ROLLBACK"); }
      finally { database.close(); }
    }
  };
  const locked = options.kernelLock === true ? kernelLocked : fileLocked;
  const writeAtomic = async (file: string, value: unknown) => {
    const content = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(content, "utf8") > maxRecordBytes) throw new Error("WATCH_STORE_RECORD_INVALID");
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      try { await handle.writeFile(content, "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
  };
  return {
    async create(spec, now, initialObservation) {
      const normalized = WatchSpecSchema.parse(spec);
      return locked(async () => {
        const { records } = await listState();
        const existing = records.find(record => matchesActiveWatch(record, normalized, now));
        if (existing !== undefined) return existing;
        if (records.length >= MAX_WATCHES) throw new Error("watch limit reached");
        const record = WatchRecordSchema.parse({ watchId: randomUUID(), revision: 0, schedulingState: "PENDING",
          spec: { ...normalized, expiresAt: normalized.expiresAt ?? new Date(Date.parse(now) + DEFAULT_WATCH_DURATION_MS).toISOString() },
          status: "ACTIVE", createdAt: now, updatedAt: now,
          ...(initialObservation === undefined ? {} : {
            lastCheckedAt: initialObservation.checkedAt, lastObservation: structuredClone(initialObservation.data)
          }) });
        await writeAtomic(fileFor(record.watchId, isWooWatch(record.spec)), record);
        return record;
      });
    },
    get: read,
    async list() { return (await listState()).records; },
    async save(record) {
      const validated = WatchRecordSchema.parse(record);
      return locked(async () => {
        const { records, stops } = await listState();
        const saved = nextRevision(await read(validated.watchId), validated, records, stops);
        await writeAtomic(fileFor(saved.watchId, isWooWatch(saved.spec)), saved);
        return saved;
      });
    },
    async delete(watchId) {
      WatchIdSchema.parse(watchId);
      return locked(async () => {
        const { woo, tombstone, record } = await readState(watchId);
        if (tombstone === undefined && record === undefined) return false;
        if (tombstone === undefined) {
          const deletedAt = new Date().toISOString();
          const stopIntent = watchStopIntent(record!, "DELETED", deletedAt);
          await writeAtomic(deletedFileFor(watchId, woo), { watchId, deletedAt, ...(stopIntent === undefined ? {} : { stopIntent }) });
        }
        try { await rm(fileFor(watchId, woo)); return true; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw error;
        }
      });
    },
    async listPendingStops() { return (await listState()).stops; }
  };
}
