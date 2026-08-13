import { createHash } from "node:crypto";

const MAX_MERCHANT_PRODUCT_ID = 200;
const MAX_SOURCE_VERSION = 128;
const MAX_MEMBERSHIPS = 20;
const MAX_MEMBERSHIP_ID = 80;

export type RefreshJob = {
  merchantId: string;
  merchantProductId: string;
  sourceVersion: string;
  idempotencyKey?: string;
};

export type RefreshPriceJob = RefreshJob & {
  zipCode: string;
  memberships: string[];
};

export type CanonicalRefreshJob = Omit<RefreshJob, "idempotencyKey"> & {
  idempotencyKey: string;
};

export type CanonicalRefreshPriceJob = Omit<RefreshPriceJob, "idempotencyKey"> & {
  idempotencyKey: string;
};

export type SourceIdentity = {
  key: string;
  kind: "product" | "price";
  merchantId: string;
  merchantProductId: string;
  sourceVersion: string;
  quoteContext?: { zipCode: string; memberships: string[] };
};

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("value is not canonical JSON data");
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
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

function baseFields(job: RefreshJob): Omit<CanonicalRefreshJob, "idempotencyKey"> {
  const merchantId = boundedText(job.merchantId, "merchant id", 80);
  if (!/^[a-z0-9-]+$/u.test(merchantId)) throw new Error("merchant id is invalid");
  return {
    merchantId,
    merchantProductId: boundedText(
      job.merchantProductId,
      "merchant product id",
      MAX_MERCHANT_PRODUCT_ID
    ),
    sourceVersion: boundedText(job.sourceVersion, "source version", MAX_SOURCE_VERSION)
  };
}

function validateSuppliedKey(supplied: string | undefined, expected: string): void {
  if (supplied !== undefined && supplied !== expected) {
    throw new Error("caller-supplied idempotency key does not match canonical identity");
  }
}

export function normalizeMemberships(memberships: unknown): string[] {
  if (!Array.isArray(memberships) || memberships.length > MAX_MEMBERSHIPS) {
    throw new Error("membership context is invalid");
  }
  const normalized = memberships.map((membership) =>
    boundedText(membership, "membership id", MAX_MEMBERSHIP_ID)
  );
  return [...new Set(normalized)].sort();
}

export function normalizeZipCode(zipCode: unknown): string {
  if (typeof zipCode !== "string") throw new Error("ZIP code must be a string");
  const normalized = zipCode.trim();
  if (!/^\d{5}(?:-\d{4})?$/u.test(normalized)) {
    throw new Error("ZIP code must be 5 digits or ZIP+4");
  }
  return normalized;
}

export function canonicalizeProductRefreshJob(job: RefreshJob): CanonicalRefreshJob {
  const fields = baseFields(job);
  const idempotencyKey = canonicalHash({ kind: "product", ...fields });
  validateSuppliedKey(job.idempotencyKey, idempotencyKey);
  return { ...fields, idempotencyKey };
}

export function canonicalizePriceRefreshJob(job: RefreshPriceJob): CanonicalRefreshPriceJob {
  const fields = baseFields(job);
  const zipCode = normalizeZipCode(job.zipCode);
  const memberships = normalizeMemberships(job.memberships);
  const idempotencyKey = canonicalHash({
    kind: "price",
    ...fields,
    quoteContext: { zipCode, memberships }
  });
  validateSuppliedKey(job.idempotencyKey, idempotencyKey);
  return { ...fields, zipCode, memberships, idempotencyKey };
}

export function quoteContextKey(job: Pick<RefreshPriceJob, "zipCode" | "memberships">): string {
  return canonicalHash({
    zipCode: normalizeZipCode(job.zipCode),
    memberships: normalizeMemberships(job.memberships)
  });
}

export function productSourceIdentity(job: RefreshJob): SourceIdentity {
  const canonical = canonicalizeProductRefreshJob(job);
  return { key: canonical.idempotencyKey, kind: "product", ...canonical };
}

export function priceSourceIdentity(job: RefreshPriceJob): SourceIdentity {
  const canonical = canonicalizePriceRefreshJob(job);
  return {
    key: canonical.idempotencyKey,
    kind: "price",
    merchantId: canonical.merchantId,
    merchantProductId: canonical.merchantProductId,
    sourceVersion: canonical.sourceVersion,
    quoteContext: { zipCode: canonical.zipCode, memberships: canonical.memberships }
  };
}

export function stableRecordId(kind: "evidence" | "offer" | "quote" | "quarantine", key: string): string {
  return canonicalHash({ kind, sourceIdentityKey: key });
}
