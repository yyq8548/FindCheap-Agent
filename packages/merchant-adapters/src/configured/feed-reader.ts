import { z } from "zod";

import {
  safeFetch as defaultSafeFetch,
  type FetchPolicy,
  type ResolveHost,
  type SafeFetchInput,
  type SafeRequest
} from "../../../../apps/ingestion-worker/src/network/safe-fetch.js";

const FieldPathSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(isSafeFieldPath, "invalid field path");

const FieldMappingSchema = z
  .object({
    merchantProductId: FieldPathSchema,
    title: FieldPathSchema,
    brand: FieldPathSchema.optional(),
    gtins: FieldPathSchema.optional(),
    mpn: FieldPathSchema.optional(),
    imageUrl: FieldPathSchema.optional(),
    offer: z
      .object({
        price: FieldPathSchema.optional(),
        priceCurrency: FieldPathSchema.optional(),
        availability: FieldPathSchema.optional(),
        url: FieldPathSchema.optional()
      })
      .strict()
      .optional()
  })
  .strict();

const ReaderNetworkConfigSchema = z
  .object({
    host: z.string().regex(/^[A-Za-z0-9.-]+$/).min(1).max(253),
    resourcePath: z
      .string()
      .min(1)
      .max(2_000)
      .refine(
        (value) => value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"),
        "resourcePath must be an absolute path without a host"
      ),
    allowedHosts: z.array(z.string().min(1).max(253)).min(1)
  })
  .strict();

const RawOfferSchema = z
  .object({
    price: z.union([z.string().min(1), z.number().finite()]).optional(),
    priceCurrency: z.string().min(1).optional(),
    availability: z.string().min(1).optional(),
    url: z.string().url().optional()
  })
  .strict();

export const RawMerchantRecordSchema = z
  .object({
    merchantProductId: z.string().min(1),
    title: z.string().min(1),
    brand: z.string().min(1).optional(),
    gtins: z.array(z.string().min(1)),
    mpn: z.string().min(1).optional(),
    imageUrl: z.string().url().optional(),
    rawOffer: RawOfferSchema.optional()
  })
  .strict();

export type RawMerchantRecord = z.infer<typeof RawMerchantRecordSchema>;
export type SourceReader = { read(): Promise<RawMerchantRecord[]> };
export type SafeFetcher = (input: SafeFetchInput, policy: FetchPolicy) => Promise<Response>;

export type ReaderDependencies = {
  safeFetch?: SafeFetcher;
  resolve?: ResolveHost;
  request?: SafeRequest;
};

export type ReaderNetworkConfig = z.input<typeof ReaderNetworkConfigSchema>;
export type RecordFieldMapping = z.input<typeof FieldMappingSchema>;

export type FeedReaderConfig = ReaderNetworkConfig & {
  recordsPath: string;
  fields: RecordFieldMapping;
};

export function createFeedReader(
  config: FeedReaderConfig,
  dependencies: ReaderDependencies = {}
): SourceReader {
  const network = ReaderNetworkConfigSchema.parse({
    host: config.host,
    resourcePath: config.resourcePath,
    allowedHosts: config.allowedHosts
  });
  const recordsPath = FieldPathSchema.parse(config.recordsPath);
  const fields = FieldMappingSchema.parse(config.fields);
  const url = buildConfiguredUrl(network.host, network.resourcePath);

  return {
    async read() {
      const response = await fetchConfigured(url, network.allowedHosts, dependencies);
      ensureSuccessfulJson(response);
      return parseMappedRecords(await response.text(), recordsPath, fields);
    }
  };
}

export function parseMappedRecords(
  document: string,
  recordsPath: string,
  fieldsInput: RecordFieldMapping
): RawMerchantRecord[] {
  const path = FieldPathSchema.parse(recordsPath);
  const fields = FieldMappingSchema.parse(fieldsInput);
  let parsed: unknown;
  try {
    parsed = JSON.parse(document);
  } catch (error) {
    throw new Error("invalid JSON source", { cause: error });
  }

  const selected = readPath(parsed, path);
  const records = Array.isArray(selected) ? selected : [selected];
  return records.map((record, index) => {
    if (!isRecord(record)) throw new Error(`invalid merchant record at index ${index}`);
    try {
      return RawMerchantRecordSchema.parse(mapDeclaredFields(record, fields));
    } catch (error) {
      throw new Error(`invalid merchant record at index ${index}`, { cause: error });
    }
  });
}

export function buildConfiguredUrl(host: string, resourcePath: string): string {
  const network = ReaderNetworkConfigSchema.pick({ host: true, resourcePath: true }).parse({
    host,
    resourcePath
  });
  const url = new URL(network.resourcePath, `https://${network.host}`);
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== network.host.toLowerCase()) {
    throw new Error("resourcePath escaped configured host");
  }
  return url.href;
}

export async function fetchConfigured(
  url: string,
  allowedHosts: readonly string[],
  dependencies: ReaderDependencies
): Promise<Response> {
  const fetcher = dependencies.safeFetch ?? defaultSafeFetch;
  const policy: FetchPolicy = { allowedHosts };
  if (dependencies.resolve !== undefined) policy.resolve = dependencies.resolve;
  if (dependencies.request !== undefined) policy.request = dependencies.request;
  return fetcher({ url }, policy);
}

export function ensureSuccessfulJson(response: Response): void {
  if (!response.ok) throw new Error(`merchant source returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type");
  if (contentType === null || !/(?:^|\/)json(?:$|\s*;)|\+json(?:$|\s*;)/i.test(contentType)) {
    throw new Error("merchant source did not return declared JSON content");
  }
}

function mapDeclaredFields(
  record: Record<string, unknown>,
  fields: z.output<typeof FieldMappingSchema>
): unknown {
  const mapped: Record<string, unknown> = {
    merchantProductId: readPath(record, fields.merchantProductId),
    title: readPath(record, fields.title),
    gtins: readGtins(fields.gtins === undefined ? undefined : readPath(record, fields.gtins))
  };

  assignOptional(mapped, "brand", fields.brand, record);
  assignOptional(mapped, "mpn", fields.mpn, record);
  assignOptional(mapped, "imageUrl", fields.imageUrl, record);

  if (fields.offer !== undefined) {
    const offer: Record<string, unknown> = {};
    assignOptional(offer, "price", fields.offer.price, record);
    assignOptional(offer, "priceCurrency", fields.offer.priceCurrency, record);
    assignOptional(offer, "availability", fields.offer.availability, record);
    assignOptional(offer, "url", fields.offer.url, record);
    if (Object.keys(offer).length > 0) mapped.rawOffer = offer;
  }
  return mapped;
}

function assignOptional(
  target: Record<string, unknown>,
  key: string,
  path: string | undefined,
  source: Record<string, unknown>
): void {
  if (path === undefined) return;
  const value = readPath(source, path);
  if (value !== undefined) target[key] = value;
}

function readGtins(value: unknown): unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".")) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function isSafeFieldPath(path: string): boolean {
  return path.split(".").every(
    (segment) =>
      /^[A-Za-z0-9_-]+$/.test(segment) &&
      segment !== "__proto__" &&
      segment !== "prototype" &&
      segment !== "constructor"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
