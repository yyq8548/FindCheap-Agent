import { createHash } from "node:crypto";

import {
  parseRfc3339Timestamp,
  requireMetadata,
  requireOfferShape,
  requireQuoteShape,
  requireRawEvidence,
  type CouponQuery,
  type EvidenceRecord,
  type MerchantAdapter,
  type MerchantHealth,
  type MerchantProductCandidate,
  type QuoteDeliveredPriceInput,
  type RawCoupon,
  type RawMerchantOffer,
  type RawPriceQuote,
  type RefreshOfferResult,
  type RefreshPriceResult,
  type RefreshResult,
  type SearchProductsInput
} from "../../../merchant-sdk/src/index.js";
import type { RawMerchantRecord } from "./feed-reader.js";
import {
  parseMerchantSourceConfig,
  type MerchantSourceConfig,
  type MerchantSourceConfigInput
} from "./source-config.js";

type SourceType = MerchantSourceConfig["source"]["type"];
type SourceHealth = Exclude<MerchantHealth["status"], "disabled">;

export type ConfiguredSourceRequest =
  | { operation: "search"; query: string; limit: number }
  | { operation: "get"; merchantProductId: string }
  | { operation: "quote"; merchantProductId: string; zipCode: string; memberships: string[] }
  | { operation: "coupons"; merchantProductId: string; memberships: string[] }
  | { operation: "refreshProduct"; merchantProductId: string }
  | { operation: "refreshOffer"; merchantProductId: string }
  | { operation: "refreshPrice"; merchantProductId: string; zipCode: string; memberships: string[] };

export type SourceQuote = Omit<
  RawPriceQuote,
  "merchantProductId" | "currency" | "evidenceRefs" | "checkedAt" | "expiresAt"
>;

export type ConfiguredSourceSnapshot = {
  merchantId: string;
  sourceType: SourceType;
  records: RawMerchantRecord[];
  sourceUrl: string;
  rawEvidence: string;
  metadata: Record<string, string>;
  checkedAt: string;
  quote?: SourceQuote;
  coupons?: RawCoupon[];
};

/** One capture produces the parsed entities and the evidence envelope from the same source read. */
export interface ConfiguredSource {
  readonly merchantId: string;
  readonly sourceType: SourceType;
  capture(request: ConfiguredSourceRequest): Promise<ConfiguredSourceSnapshot>;
  health(): Promise<SourceHealth>;
}

export type ConfiguredAdapterDependencies = {
  catalogCandidate: unknown;
  sources: Partial<Record<SourceType, ConfiguredSource>>;
  evidence: {
    find(merchantId: string, entityId: string): Promise<EvidenceRecord[]>;
  };
  redirectValidator: {
    isAllowed(url: string): boolean | Promise<boolean>;
  };
  controls: {
    isEnabled(merchantId: string): boolean;
    isKillSwitchActive(merchantId: string): boolean;
  };
  freshness: {
    maxAgeMs: number;
    maxFutureSkewMs: number;
  };
  clock: { now(): Date };
};

type ValidatedSnapshot = ConfiguredSourceSnapshot & {
  sourceVersion: string;
  metadata: Record<string, string>;
  evidenceRef: string;
};

const MAX_QUERY_LENGTH = 300;
const MAX_SEARCH_LIMIT = 50;
const MAX_MEMBERSHIPS = 20;
const MAX_MEMBERSHIP_LENGTH = 80;
const MAX_PRODUCT_ID_LENGTH = 200;
const MAX_CAMPAIGN_ID_LENGTH = 80;
const MAX_URL_BYTES = 4_096;
const MAX_FRESHNESS_WINDOW_MS = 604_800_000;
const ALLOWED_PLACEHOLDERS = new Set(["campaignId", "merchantProductId", "merchantUrl"]);

export function createConfiguredAdapter(
  configInput: MerchantSourceConfigInput,
  deps: ConfiguredAdapterDependencies
): MerchantAdapter {
  const config = parseMerchantSourceConfig(configInput, deps.catalogCandidate);
  validateFreshnessPolicy(deps.freshness);
  const source = deps.sources[config.source.type];
  if (source === undefined) throw new Error(`configured ${config.source.type} source is unavailable`);
  if (source.merchantId !== config.merchantId || source.sourceType !== config.source.type) {
    throw new Error("configured source is bound to a different merchant or source type");
  }
  if (config.affiliate !== undefined) validateAffiliateConfig(config);

  const requireOperational = (): void => {
    if (!deps.controls.isEnabled(config.merchantId)) throw new Error("merchant adapter is disabled");
    if (deps.controls.isKillSwitchActive(config.merchantId)) {
      throw new Error("merchant adapter kill switch is active");
    }
  };
  const operationNow = (): Date => {
    requireOperational();
    const now = deps.clock.now();
    if (!Number.isFinite(now.getTime())) throw new Error("adapter clock returned an invalid time");
    return now;
  };
  const capture = async (
    request: ConfiguredSourceRequest,
    now: Date
  ): Promise<ValidatedSnapshot> =>
    validateSnapshot(await source.capture(request), config, source, now, deps.freshness);

  const quote = async (
    input: QuoteDeliveredPriceInput,
    operation: "quote" | "refreshPrice"
  ): Promise<{ snapshot: ValidatedSnapshot; quote: RawPriceQuote }> => {
    const now = operationNow();
    const merchantProductId = boundedText(input.merchantProductId, "merchant product id", MAX_PRODUCT_ID_LENGTH);
    const zipCode = normalizeZipCode(input.zipCode);
    const memberships = normalizeMemberships(input.memberships);
    const snapshot = await capture({ operation, merchantProductId, zipCode, memberships }, now);
    const record = exactRecord(snapshot.records, merchantProductId);
    if (record === undefined) throw new Error(`merchant product ${merchantProductId} not found`);
    if (snapshot.quote === undefined) throw new Error("delivered price quote is unavailable from source");
    return { snapshot, quote: normalizeQuote(snapshot, merchantProductId, config, now) };
  };

  return {
    merchantId: config.merchantId,

    async searchProducts(input: SearchProductsInput) {
      const now = operationNow();
      const query = normalizeQuery(input.query);
      const limit = normalizeLimit(input.limit);
      const snapshot = await capture({ operation: "search", query, limit }, now);
      requireFreshExpiry(snapshot.checkedAt, config.ttlSeconds.product, now, "product");
      const terms = query.toLocaleLowerCase("en-US").split(/\s+/u);
      return snapshot.records
        .filter((record) => {
          const haystack = [record.title, record.brand, record.mpn, ...record.gtins]
            .filter((value): value is string => value !== undefined)
            .join(" ")
            .toLocaleLowerCase("en-US");
          return terms.every((term) => haystack.includes(term));
        })
        .slice(0, limit)
        .map((record) => normalizeCandidate(record, snapshot, config, now));
    },

    async getOffer(merchantProductIdInput: string) {
      const now = operationNow();
      const merchantProductId = boundedText(
        merchantProductIdInput,
        "merchant product id",
        MAX_PRODUCT_ID_LENGTH
      );
      const snapshot = await capture({ operation: "get", merchantProductId }, now);
      requireFreshExpiry(snapshot.checkedAt, config.ttlSeconds.product, now, "product");
      return normalizeOffer(exactRecord(snapshot.records, merchantProductId), snapshot, config, now);
    },

    async quoteDeliveredPrice(input: QuoteDeliveredPriceInput) {
      return (await quote(input, "quote")).quote;
    },

    async getCoupons(input: CouponQuery) {
      const now = operationNow();
      const merchantProductId = boundedText(
        input.merchantProductId,
        "merchant product id",
        MAX_PRODUCT_ID_LENGTH
      );
      const memberships = normalizeMemberships(input.memberships);
      const snapshot = await capture({ operation: "coupons", merchantProductId, memberships }, now);
      requireFreshExpiry(snapshot.checkedAt, config.ttlSeconds.coupon, now, "coupon");
      if (exactRecord(snapshot.records, merchantProductId) === undefined) {
        throw new Error(`merchant product ${merchantProductId} not found`);
      }
      return verifiedCoupons(snapshot.coupons ?? [], memberships, now);
    },

    async buildAffiliateLink(input) {
      const now = operationNow();
      const merchantProductId = boundedText(
        input.merchantProductId,
        "merchant product id",
        MAX_PRODUCT_ID_LENGTH
      );
      const campaignId = normalizeCampaignId(input.campaignId);
      requireApprovedUrl(input.merchantUrl, config.allowedHosts, "caller merchant URL");
      const snapshot = await capture({ operation: "get", merchantProductId }, now);
      requireFreshExpiry(snapshot.checkedAt, config.ttlSeconds.product, now, "product");
      const record = exactRecord(snapshot.records, merchantProductId);
      if (record === undefined) throw new Error(`merchant product ${merchantProductId} not found`);
      const canonicalUrl = canonicalMerchantUrl(record, config);
      if (config.affiliate === undefined) return { url: canonicalUrl, kind: "NORMAL" };

      try {
        const rendered = renderAffiliateTemplate(config, {
          campaignId,
          merchantProductId,
          merchantUrl: canonicalUrl
        });
        if (await deps.redirectValidator.isAllowed(rendered)) {
          return { url: rendered, kind: "AFFILIATE" };
        }
      } catch {
        // Rendering or validation failure must fail closed to the canonical merchant URL.
      }
      return { url: canonicalUrl, kind: "NORMAL" };
    },

    async refreshProduct(merchantProductIdInput: string): Promise<RefreshResult> {
      const now = operationNow();
      const merchantProductId = boundedText(
        merchantProductIdInput,
        "merchant product id",
        MAX_PRODUCT_ID_LENGTH
      );
      const snapshot = await capture({ operation: "refreshProduct", merchantProductId }, now);
      requireFreshExpiry(snapshot.checkedAt, config.ttlSeconds.product, now, "product");
      return sourceEnvelope(snapshot, merchantProductId);
    },

    async refreshOffer(input): Promise<RefreshOfferResult> {
      const now = operationNow();
      const merchantProductId = boundedText(
        input.merchantProductId,
        "merchant product id",
        MAX_PRODUCT_ID_LENGTH
      );
      const snapshot = await capture({ operation: "refreshOffer", merchantProductId }, now);
      requireFreshExpiry(snapshot.checkedAt, config.ttlSeconds.product, now, "product");
      requireRequestedSourceVersion(input.sourceVersion, snapshot.sourceVersion);
      return {
        ...sourceEnvelope(snapshot, merchantProductId),
        offer: normalizeOffer(exactRecord(snapshot.records, merchantProductId), snapshot, config, now)
      };
    },

    async refreshPrice(input): Promise<RefreshPriceResult> {
      const result = await quote(input, "refreshPrice");
      requireRequestedSourceVersion(input.sourceVersion, result.snapshot.sourceVersion);
      return {
        ...sourceEnvelope(result.snapshot, result.quote.merchantProductId),
        quote: result.quote
      };
    },

    async healthCheck() {
      const checkedAt = deps.clock.now().toISOString();
      if (
        !deps.controls.isEnabled(config.merchantId) ||
        deps.controls.isKillSwitchActive(config.merchantId)
      ) {
        return { status: "disabled", source: config.source.type, checkedAt };
      }
      try {
        return { status: await source.health(), source: config.source.type, checkedAt };
      } catch {
        return { status: "degraded", source: config.source.type, checkedAt };
      }
    },

    async evidence(entityIdInput: string) {
      requireOperational();
      const entityId = boundedText(entityIdInput, "evidence entity id", MAX_PRODUCT_ID_LENGTH);
      const records = await deps.evidence.find(config.merchantId, entityId);
      return records.filter((record) => record.merchantId === config.merchantId);
    }
  };
}

function validateSnapshot(
  snapshot: ConfiguredSourceSnapshot,
  config: MerchantSourceConfig,
  source: ConfiguredSource,
  now: Date,
  freshness: ConfiguredAdapterDependencies["freshness"]
): ValidatedSnapshot {
  if (
    snapshot.merchantId !== config.merchantId ||
    snapshot.sourceType !== config.source.type ||
    snapshot.merchantId !== source.merchantId ||
    snapshot.sourceType !== source.sourceType
  ) {
    throw new Error("source snapshot is bound to a different merchant or source type");
  }
  if (!Array.isArray(snapshot.records)) throw new Error("source records must be an array");
  requireApprovedUrl(snapshot.sourceUrl, config.allowedHosts, "source URL");
  requireRawEvidence(snapshot.rawEvidence);
  requireMetadata(snapshot.metadata);
  const checkedAt = parseRfc3339Timestamp(snapshot.checkedAt);
  if (checkedAt === undefined) {
    throw new Error("source checkedAt must be strict RFC3339");
  }
  const ageMs = now.getTime() - checkedAt;
  if (ageMs > freshness.maxAgeMs) throw new Error("source snapshot is stale");
  if (-ageMs > freshness.maxFutureSkewMs) throw new Error("source snapshot is too far in the future");
  if (
    snapshot.metadata.sourceType !== undefined &&
    snapshot.metadata.sourceType !== config.source.type
  ) {
    throw new Error("source metadata type does not match the configured source");
  }
  const declaredVersion = snapshot.metadata.sourceVersion;
  const sourceVersion = declaredVersion === undefined
    ? createHash("sha256").update(snapshot.rawEvidence, "utf8").digest("hex")
    : boundedText(declaredVersion, "source version", 128);
  const metadata = { ...snapshot.metadata, sourceType: config.source.type };
  return {
    ...snapshot,
    metadata,
    sourceVersion,
    evidenceRef: `${config.merchantId}:${sourceVersion}`
  };
}

function normalizeCandidate(
  record: RawMerchantRecord,
  snapshot: ValidatedSnapshot,
  config: MerchantSourceConfig,
  now: Date
): MerchantProductCandidate {
  const candidate: MerchantProductCandidate = {
    merchantId: config.merchantId,
    merchantProductId: boundedText(record.merchantProductId, "merchant product id", MAX_PRODUCT_ID_LENGTH),
    title: boundedText(record.title, "product title", 1_000),
    gtins: record.gtins,
    variantDimensions: {},
    currency: "USD",
    merchantUrl: canonicalMerchantUrl(record, config),
    evidenceRefs: [snapshot.evidenceRef],
    checkedAt: snapshot.checkedAt,
    expiresAt: expiresAt(snapshot.checkedAt, config.ttlSeconds.product, now, "product")
  };
  if (record.brand !== undefined) candidate.brand = record.brand;
  if (record.mpn !== undefined) candidate.mpn = record.mpn;
  return candidate;
}

function normalizeOffer(
  record: RawMerchantRecord | undefined,
  snapshot: ValidatedSnapshot,
  config: MerchantSourceConfig,
  now: Date
): RawMerchantOffer | null {
  if (record === undefined || record.rawOffer?.price === undefined) return null;
  if (record.rawOffer.priceCurrency !== undefined && record.rawOffer.priceCurrency !== "USD") {
    throw new Error("merchant offer currency must be USD");
  }
  const offer: RawMerchantOffer = {
    ...normalizeCandidate(record, snapshot, config, now),
    sellerName: config.seller.name,
    condition: config.seller.condition,
    inventoryStatus: inventoryStatus(record.rawOffer.availability),
    itemPriceCents: decimalToCents(record.rawOffer.price),
    expiresAt: expiresAt(
      snapshot.checkedAt,
      Math.min(config.ttlSeconds.product, config.ttlSeconds.price, config.ttlSeconds.inventory),
      now,
      "offer"
    )
  };
  requireOfferShape(offer);
  return offer;
}

function normalizeQuote(
  snapshot: ValidatedSnapshot,
  merchantProductId: string,
  config: MerchantSourceConfig,
  now: Date
): RawPriceQuote {
  if (snapshot.quote === undefined) throw new Error("delivered price quote is unavailable from source");
  const quote: RawPriceQuote = {
    merchantProductId,
    ...snapshot.quote,
    currency: "USD",
    evidenceRefs: [snapshot.evidenceRef],
    checkedAt: snapshot.checkedAt,
    expiresAt: expiresAt(snapshot.checkedAt, config.ttlSeconds.price, now, "price")
  };
  requireQuoteShape(quote);
  return quote;
}

function sourceEnvelope(snapshot: ValidatedSnapshot, merchantProductId: string): RefreshResult {
  return {
    merchantProductId,
    sourceVersion: snapshot.sourceVersion,
    sourceUrl: snapshot.sourceUrl,
    rawEvidence: snapshot.rawEvidence,
    metadata: snapshot.metadata,
    checkedAt: snapshot.checkedAt
  };
}

function exactRecord(records: RawMerchantRecord[], merchantProductId: string): RawMerchantRecord | undefined {
  return records.find((record) => record.merchantProductId === merchantProductId);
}

function canonicalMerchantUrl(record: RawMerchantRecord, config: MerchantSourceConfig): string {
  const value = record.rawOffer?.url;
  if (value === undefined) throw new Error("product URL is missing from merchant source evidence");
  return requireApprovedUrl(value, config.allowedHosts, "canonical merchant URL").href;
}

function expiresAt(checkedAt: string, ttlSeconds: number, now: Date, label: string): string {
  const checked = parseRfc3339Timestamp(checkedAt);
  if (checked === undefined) throw new Error("source checkedAt must be strict RFC3339");
  const expires = checked + ttlSeconds * 1_000;
  if (expires <= now.getTime()) throw new Error(`${label} source data has expired`);
  return new Date(expires).toISOString();
}

function requireFreshExpiry(checkedAt: string, ttlSeconds: number, now: Date, label: string): void {
  expiresAt(checkedAt, ttlSeconds, now, label);
}

function decimalToCents(value: string | number): number {
  if (typeof value === "string") {
    if (!/^\d+(?:\.\d{1,2})?$/u.test(value)) throw new Error("offer price is not a USD decimal");
    const [dollars = "", fractional = ""] = value.split(".");
    const cents = Number(dollars) * 100 + Number(fractional.padEnd(2, "0"));
    if (!Number.isSafeInteger(cents)) throw new Error("offer price exceeds safe integer range");
    return cents;
  }
  const cents = Math.round(value * 100);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(cents) || Math.abs(cents / 100 - value) > 1e-9) {
    throw new Error("offer price is not a precise USD decimal");
  }
  return cents;
}

function inventoryStatus(value: string | undefined): RawMerchantOffer["inventoryStatus"] {
  if (value === undefined) return "UNKNOWN";
  const normalized = value.toLowerCase();
  if (normalized.includes("outofstock") || normalized.includes("out_of_stock")) return "OUT_OF_STOCK";
  if (normalized.includes("instock") || normalized.includes("in_stock")) return "IN_STOCK";
  return "UNKNOWN";
}

function normalizeQuery(value: unknown): string {
  return boundedText(value, "search query", MAX_QUERY_LENGTH);
}

function normalizeLimit(value: unknown): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1 || value > MAX_SEARCH_LIMIT) {
    throw new Error(`search limit must be an integer from 1 to ${MAX_SEARCH_LIMIT}`);
  }
  return value;
}

function normalizeZipCode(value: unknown): string {
  if (typeof value !== "string") throw new Error("ZIP code must be a string");
  const normalized = value.trim();
  if (!/^\d{5}(?:-\d{4})?$/u.test(normalized)) {
    throw new Error("ZIP code must be 5 digits or ZIP+4");
  }
  return normalized;
}

function normalizeMemberships(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_MEMBERSHIPS) {
    throw new Error("membership context is invalid");
  }
  return [...new Set(value.map((membership) =>
    boundedText(membership, "membership id", MAX_MEMBERSHIP_LENGTH)
  ))].sort();
}

function normalizeCampaignId(value: unknown): string {
  const campaignId = boundedText(value, "campaign id", MAX_CAMPAIGN_ID_LENGTH);
  if (!/^[A-Za-z0-9_-]+$/u.test(campaignId)) throw new Error("campaign id is invalid");
  return campaignId;
}

function boundedText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function verifiedCoupons(coupons: RawCoupon[], memberships: string[], now: Date): RawCoupon[] {
  const nowMs = now.getTime();
  return coupons.filter((coupon) => {
    try {
      boundedText(coupon.couponId, "coupon id", 200);
      if (coupon.code !== undefined) boundedText(coupon.code, "coupon code", 200);
      if (!Array.isArray(coupon.eligibility) || coupon.eligibility.length > 50) return false;
      for (const rule of coupon.eligibility) boundedText(rule, "coupon eligibility", 500);
      const validFrom = parseRfc3339Timestamp(coupon.validFrom);
      const validTo = parseRfc3339Timestamp(coupon.validTo);
      if (
        coupon.verificationStatus !== "VERIFIED" ||
        !Number.isSafeInteger(coupon.amountCents) ||
        coupon.amountCents < 0 ||
        validFrom === undefined ||
        validTo === undefined ||
        validFrom >= validTo ||
        validFrom > nowMs ||
        validTo <= nowMs
      ) {
        return false;
      }
      return coupon.eligibility.every((rule) =>
        !rule.startsWith("membership:") || memberships.includes(rule.slice("membership:".length))
      );
    } catch {
      return false;
    }
  });
}

function requireRequestedSourceVersion(requestedInput: string, actual: string): void {
  const requested = boundedText(requestedInput, "source version", 128);
  if (requested !== actual) throw new Error("requested source version does not match captured evidence");
}

function validateFreshnessPolicy(policy: ConfiguredAdapterDependencies["freshness"]): void {
  for (const [label, value] of Object.entries(policy)) {
    if (!Number.isFinite(value) || value < 0 || value > MAX_FRESHNESS_WINDOW_MS) {
      throw new Error(`${label} must be a finite non-negative bounded duration`);
    }
  }
}

function requireApprovedUrl(value: string, allowedHosts: readonly string[], label: string): URL {
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > MAX_URL_BYTES) {
    throw new Error(`${label} exceeds the 4096-byte URL limit`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    !allowedHosts.includes(url.hostname.toLowerCase())
  ) {
    throw new Error(`${label} must use an approved credential-free HTTPS host and port`);
  }
  return url;
}

function validateAffiliateConfig(config: MerchantSourceConfig): void {
  const affiliate = config.affiliate;
  if (affiliate === undefined) return;
  const approvedHosts = new Set(affiliate.affiliateHosts);
  const approvedOrigins = new Set(
    affiliate.affiliateOrigins.map((origin) => {
      const parsed = requireApprovedUrl(origin, affiliate.affiliateHosts, "affiliate origin");
      if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
        throw new Error("affiliate origin must not contain path, query, or fragment");
      }
      return parsed.origin;
    })
  );
  const authorityEnd = affiliate.template.indexOf("/", "https://".length);
  const authority = authorityEnd === -1 ? affiliate.template : affiliate.template.slice(0, authorityEnd);
  if (!affiliate.template.startsWith("https://") || /[{}]/u.test(authority)) {
    throw new Error("affiliate template must have a literal HTTPS origin");
  }
  for (const match of affiliate.template.matchAll(/\{([^{}]+)\}/gu)) {
    if (!ALLOWED_PLACEHOLDERS.has(match[1] ?? "")) {
      throw new Error("affiliate template contains an unknown placeholder");
    }
  }
  if (/[{}]/u.test(affiliate.template.replace(/\{(?:campaignId|merchantProductId|merchantUrl)\}/gu, ""))) {
    throw new Error("affiliate template syntax is invalid");
  }
  const sample = affiliate.template.replace(
    /\{(?:campaignId|merchantProductId|merchantUrl)\}/gu,
    "template-value"
  );
  const parsed = requireApprovedUrl(sample, affiliate.affiliateHosts, "affiliate template URL");
  if (!approvedHosts.has(parsed.hostname) || !approvedOrigins.has(parsed.origin)) {
    throw new Error("affiliate template origin is not separately approved");
  }
}

function renderAffiliateTemplate(
  config: MerchantSourceConfig,
  values: { campaignId: string; merchantProductId: string; merchantUrl: string }
): string {
  const affiliate = config.affiliate;
  if (affiliate === undefined) throw new Error("affiliate template is not configured");
  const rendered = affiliate.template.replace(/\{(campaignId|merchantProductId|merchantUrl)\}/gu, (_match, key: keyof typeof values) =>
    encodeURIComponent(values[key])
  );
  const parsed = requireApprovedUrl(rendered, affiliate.affiliateHosts, "affiliate URL");
  const origins = new Set(affiliate.affiliateOrigins.map((origin) => new URL(origin).origin));
  if (!origins.has(parsed.origin)) throw new Error("affiliate URL origin is not approved");
  return parsed.href;
}
