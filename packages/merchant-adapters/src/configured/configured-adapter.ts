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
import { buildConfiguredUrl, type RawMerchantRecord } from "./feed-reader.js";
import {
  parseMerchantSourceConfig,
  type MerchantCatalogGrant,
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
  capture(request: ConfiguredSourceRequest): Promise<ConfiguredSourceSnapshot>;
  health(): Promise<SourceHealth>;
}

export type ConfiguredAdapterDependencies = {
  catalog: MerchantCatalogGrant;
  sources: Partial<Record<SourceType, ConfiguredSource>>;
  evidence: {
    find(merchantId: string, entityId: string): Promise<EvidenceRecord[]>;
  };
  redirectValidator: {
    isAllowed(url: string): boolean | Promise<boolean>;
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
const ALLOWED_PLACEHOLDERS = new Set(["campaignId", "merchantProductId", "merchantUrl"]);

export function createConfiguredAdapter(
  configInput: MerchantSourceConfigInput,
  deps: ConfiguredAdapterDependencies
): MerchantAdapter {
  const config = parseMerchantSourceConfig(configInput, deps.catalog);
  const source = deps.sources[config.source.type];
  if (source === undefined) throw new Error(`configured ${config.source.type} source is unavailable`);
  if (config.affiliate !== undefined) validateAffiliateConfig(config);

  const capture = async (request: ConfiguredSourceRequest): Promise<ValidatedSnapshot> =>
    validateSnapshot(await source.capture(request), config);

  const quote = async (
    input: QuoteDeliveredPriceInput,
    operation: "quote" | "refreshPrice"
  ): Promise<{ snapshot: ValidatedSnapshot; quote: RawPriceQuote }> => {
    const merchantProductId = boundedText(input.merchantProductId, "merchant product id", MAX_PRODUCT_ID_LENGTH);
    const zipCode = normalizeZipCode(input.zipCode);
    const memberships = normalizeMemberships(input.memberships);
    const snapshot = await capture({ operation, merchantProductId, zipCode, memberships });
    const record = exactRecord(snapshot.records, merchantProductId);
    if (record === undefined) throw new Error(`merchant product ${merchantProductId} not found`);
    if (snapshot.quote === undefined) throw new Error("delivered price quote is unavailable from source");
    return { snapshot, quote: normalizeQuote(snapshot, merchantProductId, config) };
  };

  return {
    merchantId: config.merchantId,

    async searchProducts(input: SearchProductsInput) {
      const query = normalizeQuery(input.query);
      const limit = normalizeLimit(input.limit);
      const snapshot = await capture({ operation: "search", query, limit });
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
        .map((record) => normalizeCandidate(record, snapshot, config));
    },

    async getOffer(merchantProductIdInput: string) {
      const merchantProductId = boundedText(
        merchantProductIdInput,
        "merchant product id",
        MAX_PRODUCT_ID_LENGTH
      );
      const snapshot = await capture({ operation: "get", merchantProductId });
      return normalizeOffer(exactRecord(snapshot.records, merchantProductId), snapshot, config);
    },

    async quoteDeliveredPrice(input: QuoteDeliveredPriceInput) {
      return (await quote(input, "quote")).quote;
    },

    async getCoupons(input: CouponQuery) {
      const merchantProductId = boundedText(
        input.merchantProductId,
        "merchant product id",
        MAX_PRODUCT_ID_LENGTH
      );
      const memberships = normalizeMemberships(input.memberships);
      const snapshot = await capture({ operation: "coupons", merchantProductId, memberships });
      if (exactRecord(snapshot.records, merchantProductId) === undefined) {
        throw new Error(`merchant product ${merchantProductId} not found`);
      }
      return verifiedCoupons(snapshot.coupons ?? [], memberships, deps.clock.now());
    },

    async buildAffiliateLink(input) {
      const merchantProductId = boundedText(
        input.merchantProductId,
        "merchant product id",
        MAX_PRODUCT_ID_LENGTH
      );
      const campaignId = normalizeCampaignId(input.campaignId);
      requireApprovedUrl(input.merchantUrl, config.allowedHosts, "caller merchant URL");
      const snapshot = await capture({ operation: "get", merchantProductId });
      const record = exactRecord(snapshot.records, merchantProductId);
      if (record === undefined) throw new Error(`merchant product ${merchantProductId} not found`);
      const canonicalUrl = canonicalMerchantUrl(record, config);
      if (config.affiliate === undefined) return { url: canonicalUrl, kind: "NORMAL" };

      const rendered = renderAffiliateTemplate(config, {
        campaignId,
        merchantProductId,
        merchantUrl: canonicalUrl
      });
      try {
        if (await deps.redirectValidator.isAllowed(rendered)) {
          return { url: rendered, kind: "AFFILIATE" };
        }
      } catch {
        // A validator outage must fail closed to the canonical merchant URL.
      }
      return { url: canonicalUrl, kind: "NORMAL" };
    },

    async refreshProduct(merchantProductIdInput: string): Promise<RefreshResult> {
      const merchantProductId = boundedText(
        merchantProductIdInput,
        "merchant product id",
        MAX_PRODUCT_ID_LENGTH
      );
      return sourceEnvelope(
        await capture({ operation: "refreshProduct", merchantProductId }),
        merchantProductId
      );
    },

    async refreshOffer(input): Promise<RefreshOfferResult> {
      const merchantProductId = boundedText(
        input.merchantProductId,
        "merchant product id",
        MAX_PRODUCT_ID_LENGTH
      );
      const snapshot = await capture({ operation: "refreshOffer", merchantProductId });
      requireRequestedSourceVersion(input.sourceVersion, snapshot.sourceVersion);
      return {
        ...sourceEnvelope(snapshot, merchantProductId),
        offer: normalizeOffer(exactRecord(snapshot.records, merchantProductId), snapshot, config)
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
      if (!config.enabled || config.killSwitch) {
        return { status: "disabled", source: config.source.type, checkedAt };
      }
      try {
        return { status: await source.health(), source: config.source.type, checkedAt };
      } catch {
        return { status: "degraded", source: config.source.type, checkedAt };
      }
    },

    async evidence(entityIdInput: string) {
      const entityId = boundedText(entityIdInput, "evidence entity id", MAX_PRODUCT_ID_LENGTH);
      const records = await deps.evidence.find(config.merchantId, entityId);
      return records.filter((record) => record.merchantId === config.merchantId);
    }
  };
}

function validateSnapshot(
  snapshot: ConfiguredSourceSnapshot,
  config: MerchantSourceConfig
): ValidatedSnapshot {
  if (!Array.isArray(snapshot.records)) throw new Error("source records must be an array");
  requireApprovedUrl(snapshot.sourceUrl, config.allowedHosts, "source URL");
  requireRawEvidence(snapshot.rawEvidence);
  requireMetadata(snapshot.metadata);
  if (parseRfc3339Timestamp(snapshot.checkedAt) === undefined) {
    throw new Error("source checkedAt must be strict RFC3339");
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
  config: MerchantSourceConfig
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
    expiresAt: expiresAt(snapshot.checkedAt, config.ttlSeconds.product)
  };
  if (record.brand !== undefined) candidate.brand = record.brand;
  if (record.mpn !== undefined) candidate.mpn = record.mpn;
  return candidate;
}

function normalizeOffer(
  record: RawMerchantRecord | undefined,
  snapshot: ValidatedSnapshot,
  config: MerchantSourceConfig
): RawMerchantOffer | null {
  if (record === undefined || record.rawOffer?.price === undefined) return null;
  if (record.rawOffer.priceCurrency !== undefined && record.rawOffer.priceCurrency !== "USD") {
    throw new Error("merchant offer currency must be USD");
  }
  const offer: RawMerchantOffer = {
    ...normalizeCandidate(record, snapshot, config),
    sellerName: config.seller.name,
    condition: config.seller.condition,
    inventoryStatus: inventoryStatus(record.rawOffer.availability),
    itemPriceCents: decimalToCents(record.rawOffer.price),
    expiresAt: expiresAt(
      snapshot.checkedAt,
      Math.min(config.ttlSeconds.product, config.ttlSeconds.price, config.ttlSeconds.inventory)
    )
  };
  requireOfferShape(offer);
  return offer;
}

function normalizeQuote(
  snapshot: ValidatedSnapshot,
  merchantProductId: string,
  config: MerchantSourceConfig
): RawPriceQuote {
  if (snapshot.quote === undefined) throw new Error("delivered price quote is unavailable from source");
  const quote: RawPriceQuote = {
    merchantProductId,
    ...snapshot.quote,
    currency: "USD",
    evidenceRefs: [snapshot.evidenceRef],
    checkedAt: snapshot.checkedAt,
    expiresAt: expiresAt(snapshot.checkedAt, config.ttlSeconds.price)
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
  const value = record.rawOffer?.url ?? buildConfiguredUrl(config.source.host, config.source.resourcePath);
  return requireApprovedUrl(value, config.allowedHosts, "canonical merchant URL").href;
}

function expiresAt(checkedAt: string, ttlSeconds: number): string {
  const checked = parseRfc3339Timestamp(checkedAt);
  if (checked === undefined) throw new Error("source checkedAt must be strict RFC3339");
  return new Date(checked + ttlSeconds * 1_000).toISOString();
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

function requireApprovedUrl(value: string, allowedHosts: readonly string[], label: string): URL {
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
