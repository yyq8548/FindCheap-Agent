import { createHash } from "node:crypto";

import { z } from "zod";

import type { RawCoupon } from "../../../merchant-sdk/src/index.js";
import type {
  ConfiguredSource,
  ConfiguredSourceRequest,
  ConfiguredSourceSnapshot,
  SourceQuote
} from "./configured-adapter.js";
import {
  buildConfiguredUrl,
  readDeclaredPath,
  type ReaderDependencies,
  type SourceReadSnapshot,
  type SourceReader
} from "./feed-reader.js";
import { createFeedReader } from "./feed-reader.js";
import { createHttpReader } from "./http-reader.js";
import { createJsonLdReader } from "./jsonld-reader.js";
import {
  parseMerchantSourceConfig,
  type MerchantSourceConfig,
  type MerchantSourceConfigInput
} from "./source-config.js";

const SourceQuoteSchema = z.object({
  itemPriceCents: z.number().int().nonnegative(),
  shippingCents: z.number().int().nonnegative(),
  taxCents: z.number().int().nonnegative(),
  mandatoryFeeCents: z.number().int().nonnegative(),
  status: z.enum(["VERIFIED", "ESTIMATED", "CONDITIONAL"]),
  conditions: z.array(z.string().min(1).max(1_000)).max(50)
}).strict();

const SourceCouponSchema = z.object({
  couponId: z.string().min(1).max(200),
  code: z.string().min(1).max(200).optional(),
  amountCents: z.number().int().nonnegative(),
  verificationStatus: z.enum(["VERIFIED", "UNVERIFIED", "EXPIRED"]),
  eligibility: z.array(z.string().min(1).max(500)).max(50),
  validFrom: z.string().min(1).max(100),
  validTo: z.string().min(1).max(100)
}).strict();

type QuoteEndpoint = NonNullable<MerchantSourceConfig["quoteEndpoint"]>;
type CouponEndpoint = NonNullable<MerchantSourceConfig["couponEndpoint"]>;

export type ConfiguredSourceDriverDependencies = ReaderDependencies;

/**
 * Production bridge from audited config to the generic adapter contract.
 * Each capture consumes exactly one response body for both entities and evidence.
 */
export function createConfiguredSource(
  configInput: MerchantSourceConfigInput,
  catalogCandidate: unknown,
  dependencies: ConfiguredSourceDriverDependencies = {}
): ConfiguredSource {
  const config = parseMerchantSourceConfig(configInput, catalogCandidate);
  const primaryReader = createPrimaryReader(config, dependencies);

  return {
    merchantId: config.merchantId,
    sourceType: config.source.type,

    async capture(request: ConfiguredSourceRequest): Promise<ConfiguredSourceSnapshot> {
      if (request.operation === "quote" || request.operation === "refreshPrice") {
        if (config.quoteEndpoint === undefined) {
          throw new Error("delivered price quote source is unavailable");
        }
        const endpoint = config.quoteEndpoint;
        const read = await captureMappedEndpoint(
          endpoint,
          renderEndpointPath(endpoint.resourcePath, quotePlaceholders(request)),
          config.allowedHosts,
          dependencies
        );
        return envelope(config, read, { quote: parseQuote(read.rawBody, endpoint) });
      }

      if (request.operation === "coupons") {
        if (config.couponEndpoint === undefined) throw new Error("coupon source is unavailable");
        const endpoint = config.couponEndpoint;
        const read = await captureMappedEndpoint(
          endpoint,
          renderEndpointPath(endpoint.resourcePath, couponPlaceholders(request)),
          config.allowedHosts,
          dependencies
        );
        return envelope(config, read, { coupons: parseCoupons(read.rawBody, endpoint) });
      }

      return envelope(config, await primaryReader.capture());
    },

    async health() {
      return "healthy";
    }
  };
}

function createPrimaryReader(
  config: MerchantSourceConfig,
  dependencies: ConfiguredSourceDriverDependencies
): SourceReader {
  const common = {
    host: config.source.host,
    resourcePath: config.source.resourcePath,
    allowedHosts: config.allowedHosts
  };
  if (config.source.type === "jsonld") return createJsonLdReader(common, dependencies);
  if (config.source.recordsPath === undefined || config.source.fields === undefined) {
    throw new Error(`${config.source.type} source requires audited recordsPath and field mappings`);
  }
  const mapped = {
    ...common,
    recordsPath: config.source.recordsPath,
    fields: config.source.fields
  };
  return config.source.type === "feed"
    ? createFeedReader(mapped, dependencies)
    : createHttpReader(mapped, dependencies);
}

async function captureMappedEndpoint(
  endpoint: QuoteEndpoint | CouponEndpoint,
  resourcePath: string,
  allowedHosts: string[],
  dependencies: ConfiguredSourceDriverDependencies
): Promise<SourceReadSnapshot> {
  return createHttpReader({
    host: endpoint.host,
    resourcePath,
    allowedHosts,
    recordsPath: endpoint.recordsPath,
    fields: endpoint.fields
  }, dependencies).capture();
}

function envelope(
  config: MerchantSourceConfig,
  read: SourceReadSnapshot,
  extra: Pick<ConfiguredSourceSnapshot, "quote" | "coupons"> = {}
): ConfiguredSourceSnapshot {
  const sourceVersion = createHash("sha256").update(read.rawBody, "utf8").digest("hex");
  return {
    merchantId: config.merchantId,
    sourceType: config.source.type,
    records: read.records,
    sourceUrl: read.sourceUrl,
    rawEvidence: read.rawBody,
    checkedAt: read.checkedAt,
    metadata: { sourceType: config.source.type, sourceVersion },
    ...extra
  };
}

function parseQuote(rawBody: string, endpoint: QuoteEndpoint): SourceQuote {
  const document = parseJsonObject(rawBody);
  return SourceQuoteSchema.parse({
    itemPriceCents: readDeclaredPath(document, endpoint.quote.itemPriceCents),
    shippingCents: readDeclaredPath(document, endpoint.quote.shippingCents),
    taxCents: readDeclaredPath(document, endpoint.quote.taxCents),
    mandatoryFeeCents: readDeclaredPath(document, endpoint.quote.mandatoryFeeCents),
    status: readDeclaredPath(document, endpoint.quote.status),
    conditions: readDeclaredPath(document, endpoint.quote.conditions)
  });
}

function parseCoupons(rawBody: string, endpoint: CouponEndpoint): RawCoupon[] {
  const selected = readDeclaredPath(parseJsonObject(rawBody), endpoint.couponsPath);
  if (!Array.isArray(selected)) throw new Error("coupon mapping must select an array");
  return selected.map((coupon, index) => {
    if (!isRecord(coupon)) throw new Error(`invalid coupon record at index ${index}`);
    const mapped: Record<string, unknown> = {
      couponId: readDeclaredPath(coupon, endpoint.coupon.couponId),
      amountCents: readDeclaredPath(coupon, endpoint.coupon.amountCents),
      verificationStatus: readDeclaredPath(coupon, endpoint.coupon.verificationStatus),
      eligibility: readDeclaredPath(coupon, endpoint.coupon.eligibility),
      validFrom: readDeclaredPath(coupon, endpoint.coupon.validFrom),
      validTo: readDeclaredPath(coupon, endpoint.coupon.validTo)
    };
    if (endpoint.coupon.code !== undefined) {
      const code = readDeclaredPath(coupon, endpoint.coupon.code);
      if (code !== undefined) mapped.code = code;
    }
    try {
      const parsed = SourceCouponSchema.parse(mapped);
      const coupon: RawCoupon = {
        couponId: parsed.couponId,
        amountCents: parsed.amountCents,
        verificationStatus: parsed.verificationStatus,
        eligibility: parsed.eligibility,
        validFrom: parsed.validFrom,
        validTo: parsed.validTo
      };
      if (parsed.code !== undefined) coupon.code = parsed.code;
      return coupon;
    } catch (error) {
      throw new Error(`invalid coupon record at index ${index}`, { cause: error });
    }
  });
}

function parseJsonObject(rawBody: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch (error) {
    throw new Error("invalid JSON endpoint response", { cause: error });
  }
  if (!isRecord(value)) throw new Error("endpoint response must be a JSON object");
  return value;
}

function quotePlaceholders(
  request: Extract<ConfiguredSourceRequest, { operation: "quote" | "refreshPrice" }>
): Record<string, string> {
  return {
    merchantProductId: canonicalProductId(request.merchantProductId),
    zipCode: canonicalZip(request.zipCode),
    memberships: canonicalMemberships(request.memberships).join(",")
  };
}

function couponPlaceholders(
  request: Extract<ConfiguredSourceRequest, { operation: "coupons" }>
): Record<string, string> {
  return {
    merchantProductId: canonicalProductId(request.merchantProductId),
    memberships: canonicalMemberships(request.memberships).join(",")
  };
}

function renderEndpointPath(template: string, values: Record<string, string>): string {
  const rendered = template.replace(/\{([^{}]+)\}/gu, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error("endpoint contains an unsupported placeholder");
    return encodeURIComponent(value);
  });
  if (/[{}]/u.test(rendered)) throw new Error("endpoint placeholder syntax is invalid");
  // Re-use the URL builder's origin escape check before the reader performs the request.
  buildConfiguredUrl("placeholder.invalid", rendered);
  return rendered;
}

function canonicalProductId(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 200 || hasControlCharacter(normalized)) {
    throw new Error("merchant product id is invalid");
  }
  return normalized;
}

function canonicalZip(value: string): string {
  const normalized = value.trim();
  if (!/^\d{5}(?:-\d{4})?$/u.test(normalized)) throw new Error("ZIP code is invalid");
  return normalized;
}

function canonicalMemberships(values: string[]): string[] {
  if (!Array.isArray(values) || values.length > 20) throw new Error("membership context is invalid");
  return [...new Set(values.map((value) => {
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > 80 || hasControlCharacter(normalized)) {
      throw new Error("membership id is invalid");
    }
    return normalized;
  }))].sort();
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
