import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const WatchIdSchema = z.string().uuid();
const MAX_WATCHES = 500;

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

export const WatchSpecSchema = z.object({
  query: z.string().trim().min(2).max(300),
  merchant: z.string().trim().min(2).max(160).optional(),
  condition: WatchConditionSchema,
  threshold: z.number().nonnegative().max(100_000_000).optional()
    .describe("PRICE_BELOW uses integer USD cents; DISCOUNT_AT_LEAST and CASHBACK_AT_LEAST use percentage points."),
  zipCode: z.string().regex(/^\d{5}(?:-\d{4})?$/u).optional(),
  membershipIds: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  identity: ProductWatchIdentitySchema.optional(),
  conditionPreference: ProductWatchConditionPreferenceSchema.optional(),
  intervalMinutes: z.number().int().min(15).max(1_440).default(60),
  expiresAt: z.string().datetime({ offset: true }).optional()
}).strict().superRefine((spec, context) => {
  if (["PRICE_BELOW", "DISCOUNT_AT_LEAST", "CASHBACK_AT_LEAST"].includes(spec.condition) && spec.threshold === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `${spec.condition} requires threshold` });
  }
  if (["DISCOUNT_AT_LEAST", "COUPON_AVAILABLE", "CASHBACK_AT_LEAST"].includes(spec.condition) && spec.merchant === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `${spec.condition} requires merchant` });
  }
});

export type WatchSpec = z.infer<typeof WatchSpecSchema>;

export function productWatchClarificationQuestions(spec: WatchSpec): string[] {
  if (!["PRICE_BELOW", "IN_STOCK", "RESTOCKED"].includes(spec.condition)) return [];
  const questions: string[] = [];
  if (spec.identity === undefined) {
    questions.push("Which generation, exact model number, or GTIN should this watch monitor?");
  }
  if (spec.conditionPreference === undefined) {
    questions.push("Which product condition should this watch accept: NEW, USED, REFURBISHED, OPEN_BOX, or ANY?");
  }
  return questions;
}

export const WatchRecordSchema = z.object({
  watchId: z.string().uuid(),
  spec: WatchSpecSchema,
  status: z.enum(["ACTIVE", "PAUSED", "EXPIRED"]),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  lastCheckedAt: z.string().datetime({ offset: true }).optional(),
  wasSatisfied: z.boolean().optional(),
  lastObservation: z.record(z.string(), z.unknown()).optional()
}).strict();

export type WatchRecord = z.infer<typeof WatchRecordSchema>;

export interface WatchStore {
  create(spec: WatchSpec, now: string): Promise<WatchRecord>;
  get(watchId: string): Promise<WatchRecord | undefined>;
  list(): Promise<WatchRecord[]>;
  save(record: WatchRecord): Promise<void>;
  delete(watchId: string): Promise<boolean>;
}

export function createMemoryWatchStore(): WatchStore {
  const records = new Map<string, WatchRecord>();
  return {
    async create(spec, now) {
      const normalized = WatchSpecSchema.parse(spec);
      const key = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
      const existing = [...records.values()].find((record) =>
        createHash("sha256").update(JSON.stringify(record.spec)).digest("hex") === key && record.status !== "EXPIRED");
      if (existing !== undefined) return existing;
      if (records.size >= MAX_WATCHES) throw new Error("watch limit reached");
      const record = WatchRecordSchema.parse({ watchId: randomUUID(), spec: normalized, status: "ACTIVE", createdAt: now, updatedAt: now });
      records.set(record.watchId, record);
      return record;
    },
    async get(watchId) { return records.get(watchId); },
    async list() { return [...records.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)); },
    async save(record) { records.set(record.watchId, WatchRecordSchema.parse(record)); },
    async delete(watchId) { return records.delete(watchId); }
  };
}

export function createJsonWatchStore(directory: string): WatchStore {
  const fileFor = (watchId: string) => join(directory, `${WatchIdSchema.parse(watchId)}.json`);
  const ensure = () => mkdir(directory, { recursive: true, mode: 0o700 });
  const read = async (watchId: string) => {
    try { return WatchRecordSchema.parse(JSON.parse(await readFile(fileFor(watchId), "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  };
  const listRecords = async () => {
    await ensure();
    const names = await readdir(directory);
    const records = await Promise.all(names.filter((name) => /^[0-9a-f-]{36}\.json$/u.test(name)).map((name) => read(name.slice(0, -5))));
    return records.filter((record): record is WatchRecord => record !== undefined).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  };
  return {
    async create(spec, now) {
      await ensure();
      const normalized = WatchSpecSchema.parse(spec);
      const existingRecords = await listRecords();
      const existing = existingRecords.find((record) =>
        JSON.stringify(record.spec) === JSON.stringify(normalized) && record.status !== "EXPIRED");
      if (existing !== undefined) return existing;
      if (existingRecords.length >= MAX_WATCHES) throw new Error("watch limit reached");
      const record = WatchRecordSchema.parse({ watchId: randomUUID(), spec: normalized, status: "ACTIVE", createdAt: now, updatedAt: now });
      await writeFile(fileFor(record.watchId), `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      return record;
    },
    get: read,
    list: listRecords,
    async save(record) {
      await ensure();
      const validated = WatchRecordSchema.parse(record);
      await writeFile(fileFor(record.watchId), `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    },
    async delete(watchId) {
      try { await rm(fileFor(watchId)); return true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    }
  };
}
