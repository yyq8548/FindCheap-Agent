import { parseRfc3339Timestamp } from "./time.js";
import type { RawMerchantOffer, RawPriceQuote } from "./types.js";

export const MAX_RAW_EVIDENCE_BYTES = 5_000_000;
export const MAX_EVIDENCE_REFS = 50;
export const MAX_METADATA_KEYS = 50;
export const SOURCE_TYPES = ["feed", "api", "jsonld", "http", "unknown"] as const;

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function requireBoundedString(
  value: unknown,
  label: string,
  maxBytes: number,
  allowEmpty = false
): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  if ((!allowEmpty && value.trim().length === 0) || bytes(value) > maxBytes) {
    throw new Error(`${label} is empty or exceeds ${maxBytes} UTF-8 bytes`);
  }
  return value;
}

export function requireHttpsUrl(value: string, label = "source URL"): void {
  requireBoundedString(value, label, 2_048);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    throw new Error(`${label} must be credential-free HTTPS`);
  }
}

export function requireRawEvidence(value: string): void {
  requireBoundedString(value, "raw evidence", MAX_RAW_EVIDENCE_BYTES);
}

export function requireMetadata(value: unknown): asserts value is Record<string, string> {
  if (!isPlainRecord(value)) throw new Error("metadata must be a plain object");
  const entries = Object.entries(value);
  if (entries.length > MAX_METADATA_KEYS) throw new Error("metadata has too many keys");
  for (const [key, entry] of entries) {
    requireBoundedString(key, "metadata key", 128);
    requireBoundedString(entry, "metadata value", 2_048, true);
  }
}

export function requireSourceType(value: string): void {
  if (!(SOURCE_TYPES as readonly string[]).includes(value)) throw new Error("source type is invalid");
}

export function requireEvidenceRefs(values: unknown, label = "evidence refs"): asserts values is string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_EVIDENCE_REFS) {
    throw new Error(`${label} has invalid count`);
  }
  for (const value of values) requireBoundedString(value, label, 256);
}

export function requireSafeCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function requireJsonSafe(value: unknown): void {
  const active = new WeakSet<object>();
  let nodes = 0;
  const visit = (current: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > 10_000 || depth > 12) throw new Error("JSON value exceeds complexity bounds");
    if (current === null || typeof current === "boolean") return;
    if (typeof current === "string") {
      requireBoundedString(current, "JSON string", 100_000, true);
      return;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new Error("JSON numbers must be finite");
      return;
    }
    if (typeof current !== "object") throw new Error("value is not JSON-safe");
    if (active.has(current)) throw new Error("JSON value contains a cycle");
    active.add(current);
    if (Array.isArray(current)) {
      if (current.length > 1_000) throw new Error("JSON array is too large");
      for (const entry of current) visit(entry, depth + 1);
    } else {
      if (!isPlainRecord(current)) throw new Error("JSON object has an unsafe prototype");
      const entries = Object.entries(current);
      if (entries.length > 1_000) throw new Error("JSON object has too many keys");
      for (const [key, entry] of entries) {
        requireBoundedString(key, "JSON key", 256);
        visit(entry, depth + 1);
      }
    }
    active.delete(current);
  };
  visit(value, 0);
}

export function requireStrictTimestamp(value: string, label: string): number {
  const parsed = parseRfc3339Timestamp(value);
  if (parsed === undefined) throw new Error(`${label} must be strict RFC3339`);
  return parsed;
}

export function requireOfferShape(offer: RawMerchantOffer): void {
  requireBoundedString(offer.merchantId, "offer merchantId", 80);
  requireBoundedString(offer.merchantProductId, "offer merchantProductId", 200);
  requireBoundedString(offer.title, "offer title", 1_000);
  if (offer.brand !== undefined) requireBoundedString(offer.brand, "offer brand", 300);
  if (offer.mpn !== undefined) requireBoundedString(offer.mpn, "offer MPN", 200);
  requireBoundedString(offer.sellerName, "offer sellerName", 300);
  requireHttpsUrl(offer.merchantUrl, "offer merchant URL");
  requireEvidenceRefs(offer.evidenceRefs, "offer evidence refs");
  requireSafeCents(offer.itemPriceCents, "offer item price");
  if (offer.currency !== "USD") throw new Error("offer currency must be USD");
  if (!Array.isArray(offer.gtins) || !isPlainRecord(offer.variantDimensions) ||
      offer.gtins.length > 20 || Object.keys(offer.variantDimensions).length > 50) {
    throw new Error("offer identity fields exceed bounds");
  }
  for (const value of offer.gtins) requireBoundedString(value, "GTIN", 32);
  for (const [key, value] of Object.entries(offer.variantDimensions)) {
    requireBoundedString(key, "variant dimension", 128);
    requireBoundedString(value, "variant value", 500);
  }
  if (!["NEW", "REFURBISHED", "USED"].includes(offer.condition) ||
      !["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"].includes(offer.inventoryStatus)) {
    throw new Error("offer condition or inventory status is invalid");
  }
  const checked = requireStrictTimestamp(offer.checkedAt, "offer checkedAt");
  const expires = requireStrictTimestamp(offer.expiresAt, "offer expiresAt");
  if (expires <= checked) throw new Error("offer expiresAt must be after checkedAt");
  requireJsonSafe(offer);
}

export function requireQuoteShape(quote: RawPriceQuote): void {
  requireBoundedString(quote.merchantProductId, "quote merchantProductId", 200);
  requireSafeCents(quote.itemPriceCents, "quote item price");
  requireSafeCents(quote.shippingCents, "quote shipping");
  requireSafeCents(quote.taxCents, "quote tax");
  requireSafeCents(quote.mandatoryFeeCents, "quote fee");
  if (quote.currency !== "USD") throw new Error("quote currency must be USD");
  if (!["VERIFIED", "ESTIMATED", "CONDITIONAL"].includes(quote.status)) {
    throw new Error("quote status is invalid");
  }
  if (!Array.isArray(quote.conditions) || quote.conditions.length > 50) {
    throw new Error("quote conditions exceed bounds");
  }
  for (const condition of quote.conditions) requireBoundedString(condition, "quote condition", 1_000);
  requireEvidenceRefs(quote.evidenceRefs, "quote evidence refs");
  const checked = requireStrictTimestamp(quote.checkedAt, "quote checkedAt");
  const expires = requireStrictTimestamp(quote.expiresAt, "quote expiresAt");
  if (expires <= checked) throw new Error("quote expiresAt must be after checkedAt");
  requireJsonSafe(quote);
}
