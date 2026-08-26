import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

export const MAX_AWIN_COMPRESSED_BYTES = 4 * 1024 * 1024;
export const MAX_AWIN_PUBLIC_SEARCH_RESPONSE_BYTES = 256 * 1024;
const MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
const DEFAULT_FEED_NAME = "datafeed_3047955.csv.gz";
const APPROVED_PUBLISHER_ID = "3047955";
const APPROVED_AFFILIATE_HOST = "www.awin1.com";

export type AwinSearchInput = {
  query: string;
  limit: number;
  maxItemPriceCents?: number | undefined;
};

export type AwinProduct = {
  merchantId: string;
  merchant: string;
  merchantProductId: string;
  title: string;
  category: string;
  matchStatus: "DISCOVERY_MATCH";
  matchEvidence: string[];
  condition: "UNKNOWN";
  imageUrl?: string | undefined;
  itemPrice: { amountCents: number; currency: "USD" };
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  merchantUrl: string;
  affiliateUrl: string;
  checkedAt: string;
};

export type AwinSearchResult = {
  source: "AWIN_PRODUCT_FEED";
  coverage: "COMPLETE";
  snapshotAt: string;
  diagnostics: {
    feedRows: number;
    validRows: number;
    rejectedRows: number;
    queryMatches: number;
    priceProductsExcluded: number;
  };
  products: AwinProduct[];
};

export interface AwinProductPort {
  search(input: AwinSearchInput): Promise<AwinSearchResult>;
}

type Dependencies = {
  read?: typeof readFile;
  fileStat?: typeof stat;
  homeDirectory?: () => string;
  fetch?: typeof fetch;
};

type IndexedProduct = AwinProduct & { searchText: string };

export type AwinFeedIndex = {
  snapshotAt: string;
  feedRows: number;
  validRows: number;
  rejectedRows: number;
  products: readonly IndexedProduct[];
};

export function createAwinFeedPort(
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: Dependencies = {}
): AwinProductPort {
  const configuredPath = environment.AWIN_PRODUCT_FEED_PATH?.trim();
  const feedPath = configuredPath === undefined || configuredPath === ""
    ? join((dependencies.homeDirectory ?? homedir)(), "Downloads", DEFAULT_FEED_NAME)
    : configuredPath;
  const read = dependencies.read ?? readFile;
  const fileStat = dependencies.fileStat ?? stat;
  const fetchRequest = dependencies.fetch ?? fetch;
  const publicSearch = parsePublicSearchConfiguration(environment);

  return {
    async search(rawInput) {
      const input = parseAwinSearchInput(rawInput);
      if (publicSearch !== undefined) {
        return fetchPublicSearch(publicSearch, input, fetchRequest);
      }
      const remote = parseRemoteConfiguration(environment);
      const archive = remote === undefined
        ? {
            compressed: await read(feedPath),
            snapshotAt: (await fileStat(feedPath)).mtime.toISOString()
          }
        : await fetchRemoteArchive(remote, fetchRequest);
      return searchAwinFeedIndex(createAwinFeedIndex(archive.compressed, archive.snapshotAt), input);
    }
  };
}

export function createAwinFeedIndex(compressed: Uint8Array, snapshotAt: string): AwinFeedIndex {
  const normalizedSnapshotAt = validIsoDate(snapshotAt, "Awin Feed snapshotAt");
  const { rows, parsed } = parseArchive(compressed, normalizedSnapshotAt);
  return {
    snapshotAt: normalizedSnapshotAt,
    feedRows: rows.records.length,
    validRows: parsed.length,
    rejectedRows: rows.records.length - parsed.length,
    products: parsed
  };
}

export function searchAwinFeedIndex(index: AwinFeedIndex, rawInput: unknown): AwinSearchResult {
  const input = parseAwinSearchInput(rawInput);
  const queryTokens = tokenizeQuery(input.query);
  const matched = index.products.filter((product) =>
    queryTokens.every((token) => product.searchText.includes(token))
  );
  const priceEligible = input.maxItemPriceCents === undefined
    ? matched
    : matched.filter((product) => product.itemPrice.amountCents <= input.maxItemPriceCents!);
  const products = [...priceEligible]
    .sort((left, right) =>
      titleMatchScore(right, queryTokens) - titleMatchScore(left, queryTokens) ||
      left.itemPrice.amountCents - right.itemPrice.amountCents ||
      left.merchantProductId.localeCompare(right.merchantProductId)
    )
    .slice(0, input.limit)
    .map(({ searchText: _searchText, ...product }) => product);
  return {
    source: "AWIN_PRODUCT_FEED",
    coverage: "COMPLETE",
    snapshotAt: index.snapshotAt,
    diagnostics: {
      feedRows: index.feedRows,
      validRows: index.validRows,
      rejectedRows: index.rejectedRows,
      queryMatches: matched.length,
      priceProductsExcluded: matched.length - priceEligible.length
    },
    products
  };
}

export function parseAwinSearchInput(value: unknown): AwinSearchInput {
  if (!isObject(value)) throw new Error("Awin search input must be an object");
  const allowedKeys = new Set(["query", "limit", "maxItemPriceCents"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("Awin search input contains unsupported fields");
  }
  const query = typeof value.query === "string" ? value.query.trim() : "";
  if (
    query.length < 2 ||
    query.length > 300 ||
    !/^[\p{L}\p{N}\s._+'-]+$/u.test(query) ||
    !/[\p{L}\p{N}]/u.test(query)
  ) {
    throw new Error("Awin search query is invalid");
  }
  const limit = value.limit;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 24) {
    throw new Error("Awin search limit must be an integer from 1 through 24");
  }
  const maxItemPriceCents = value.maxItemPriceCents;
  if (
    maxItemPriceCents !== undefined &&
    (!Number.isInteger(maxItemPriceCents) || (maxItemPriceCents as number) < 1 || (maxItemPriceCents as number) > 100_000_000)
  ) {
    throw new Error("Awin search maximum item price is invalid");
  }
  return {
    query,
    limit: limit as number,
    ...(maxItemPriceCents === undefined ? {} : { maxItemPriceCents: maxItemPriceCents as number })
  };
}

export function validateAwinFeedArchive(compressed: Uint8Array): {
  feedRows: number;
  validRows: number;
  rejectedRows: number;
  uniqueProductKeys: number;
} {
  const index = createAwinFeedIndex(compressed, new Date(0).toISOString());
  return {
    feedRows: index.feedRows,
    validRows: index.validRows,
    rejectedRows: index.rejectedRows,
    uniqueProductKeys: new Set(index.products.map((product) => `${product.merchantId}:${product.merchantProductId}`)).size
  };
}

export function mergeAwinFeedArchives(
  archives: readonly Uint8Array[],
  options: { defaultCurrency?: "USD"; canonicalizeMerchantNames?: boolean } = {}
): Uint8Array {
  if (archives.length === 0) throw new Error("at least one Awin Feed is required");
  const feeds = archives.map((archive) => {
    if (archive.byteLength > MAX_AWIN_COMPRESSED_BYTES) throw new Error("AWIN_FEED_TOO_LARGE");
    return parseAwinCsv(gunzipSync(archive, { maxOutputLength: MAX_UNCOMPRESSED_BYTES }).toString("utf8"));
  });
  let records = feeds.flatMap((feed) => feed.records.map((record) =>
    normalizeAwinFeedRecord(record, options.defaultCurrency)
  ));
  if (options.canonicalizeMerchantNames === true) {
    const merchantNames = new Map<string, string>();
    for (const record of records) {
      const merchantId = requireValue(record, "merchant_id");
      if (!merchantNames.has(merchantId)) merchantNames.set(merchantId, requireValue(record, "merchant_name"));
    }
    records = records.map((record) => ({
      ...record,
      merchant_name: merchantNames.get(requireValue(record, "merchant_id"))!
    }));
  }
  const headers = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const productKeys = records.map((record) =>
    `${requireValue(record, "merchant_id")}:${requireValue(record, "merchant_product_id")}`
  );
  if (new Set(productKeys).size !== productKeys.length) {
    throw new Error("duplicate Awin merchant product across source Feeds");
  }
  const csv = [
    headers,
    ...records.map((record) => headers.map((header) => record[header] ?? ""))
  ].map((row) => row.map(csvCell).join(",")).join("\r\n");
  if (Buffer.byteLength(csv, "utf8") > MAX_UNCOMPRESSED_BYTES) throw new Error("AWIN_FEED_TOO_LARGE");
  const merged = gzipSync(csv);
  if (merged.byteLength > MAX_AWIN_COMPRESSED_BYTES) throw new Error("AWIN_FEED_TOO_LARGE");
  return merged;
}

function normalizeAwinFeedRecord(
  record: Record<string, string>,
  defaultCurrency: "USD" | undefined
): Record<string, string> {
  if (record.merchant_id !== undefined) {
    return record.currency?.trim() ? record : { ...record, currency: defaultCurrency ?? "" };
  }
  if (record.advertiser_id === undefined) return record;
  const price = (record.sale_price?.trim() || record.price?.trim() || "")
    .match(/^(\d+(?:\.\d{1,2})?)\s+([A-Z]{3})$/u);
  if (price === null) throw new Error("invalid enhanced Awin price");
  const category = record.product_type?.trim() || record.google_product_category?.trim() || "Uncategorized";
  const availability = record.availability?.trim().toLocaleLowerCase("en-US");
  return {
    aw_deep_link: requireValue(record, "aw_deep_link"),
    product_name: requireValue(record, "title"),
    merchant_product_id: requireValue(record, "id"),
    merchant_image_url: record.image_link?.trim() ?? "",
    description: record.description?.trim() ?? "",
    merchant_category: category,
    search_price: price[1]!,
    merchant_name: requireValue(record, "advertiser_name"),
    merchant_id: requireValue(record, "advertiser_id"),
    category_name: record.google_product_category?.trim() || category,
    currency: price[2]!,
    merchant_deep_link: requireValue(record, "link"),
    in_stock: availability === "in_stock" ? "1" : availability === "out_of_stock" ? "0" : "",
    brand_name: record.brand?.trim() ?? "",
    mpn: record.mpn?.trim() ?? "",
    product_GTIN: record.gtin?.trim() ?? "",
    condition: record.condition?.trim() ?? ""
  };
}

export function createUnavailableAwinPort(): AwinProductPort {
  return { async search() { throw new Error("DATA_SOURCE_UNAVAILABLE"); } };
}

export function parseAwinCsv(document: string): {
  headers: string[];
  records: Array<Record<string, string>>;
} {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < document.length; index += 1) {
    const character = document[index]!;
    if (quoted) {
      if (character === '"') {
        if (document[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field === "") {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("invalid quoted CSV field");
  row.push(field.replace(/\r$/u, ""));
  if (row.some((value) => value !== "")) rows.push(row);
  const headers = rows.shift();
  if (headers === undefined || headers.length === 0) throw new Error("missing Awin CSV header");
  headers[0] = headers[0]!.replace(/^\uFEFF/u, "");
  if (new Set(headers).size !== headers.length) throw new Error("duplicate Awin CSV header");
  return {
    headers,
    records: rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])))
  };
}

type ObservedMerchant = { name: string };

function toProduct(
  record: Record<string, string>,
  checkedAt: string,
  observedMerchants: Map<string, ObservedMerchant>
): IndexedProduct {
  requireValue(record, "product_name");
  requireValue(record, "merchant_product_id");
  const merchantId = requireValue(record, "merchant_id");
  if (!/^\d{1,20}$/u.test(merchantId)) throw new Error("invalid Awin merchant ID");
  const merchantName = requireValue(record, "merchant_name");
  if (merchantName.length > 300) throw new Error("invalid Awin merchant name");
  if (record.currency !== "USD") throw new Error("unsupported Awin currency");
  const merchantUrl = approvedMerchantUrl(requireValue(record, "merchant_deep_link"));
  const observedMerchant = observedMerchants.get(merchantId);
  if (observedMerchant === undefined) {
    observedMerchants.set(merchantId, { name: merchantName });
  } else if (observedMerchant.name !== merchantName) {
    throw new Error("inconsistent Awin merchant identity");
  }
  const affiliateUrl = approvedUrl(requireValue(record, "aw_deep_link"), APPROVED_AFFILIATE_HOST);
  const affiliate = new URL(affiliateUrl);
  if (!hasApprovedAffiliateRelationship(affiliate, merchantId)) {
    throw new Error("Awin link does not match approved relationship");
  }
  const itemPriceCents = parseUsdCents(requireValue(record, "search_price"));
  const imageValue = record.merchant_image_url?.trim();
  const imageUrl = imageValue === undefined || imageValue === "" ? undefined : approvedHttpsUrl(imageValue);
  const title = record.product_name!.trim();
  const category = record.merchant_category?.trim() || record.category_name?.trim() || "Uncategorized";
  const description = record.description?.trim() ?? "";
  const identityValues = [
    record.brand_name,
    record.product_model,
    record.model_number,
    record.ean,
    record.upc,
    record.mpn,
    record.product_GTIN
  ].map((value) => value?.trim() ?? "").filter((value) => value !== "");
  return {
    merchantId,
    merchant: merchantName,
    merchantProductId: record.merchant_product_id!.trim(),
    title,
    category,
    matchStatus: "DISCOVERY_MATCH",
    matchEvidence: [
      "Awin merchant_product_id present",
      identityValues.length === 0
        ? "GTIN, MPN, brand, and condition unavailable; exact identity not independently verified"
        : "Feed identity fields present; exact identity not independently verified"
    ],
    condition: "UNKNOWN",
    ...(imageUrl === undefined ? {} : { imageUrl }),
    itemPrice: { amountCents: itemPriceCents, currency: "USD" },
    availability: record.in_stock === "1"
      ? "IN_STOCK"
      : record.in_stock === "0" ? "OUT_OF_STOCK" : "UNKNOWN",
    merchantUrl,
    affiliateUrl,
    checkedAt,
    searchText: normalizeSearchText([
      title,
      category,
      description,
      merchantName,
      ...identityValues
    ].join(" "))
  };
}

function parseArchive(compressed: Uint8Array, checkedAt: string): {
  rows: ReturnType<typeof parseAwinCsv>;
  parsed: IndexedProduct[];
} {
  if (compressed.byteLength > MAX_AWIN_COMPRESSED_BYTES) throw new Error("AWIN_FEED_TOO_LARGE");
  const csv = gunzipSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED_BYTES }).toString("utf8");
  const rows = parseAwinCsv(csv);
  const observedMerchants = new Map<string, ObservedMerchant>();
  const parsed = rows.records.flatMap((record) => {
    try {
      return [toProduct(record, checkedAt, observedMerchants)];
    } catch {
      return [];
    }
  });
  return { rows, parsed };
}

function parseRemoteConfiguration(environment: Readonly<Record<string, string | undefined>>): {
  url: string;
  token: string;
  timeoutMs: number;
} | undefined {
  const value = environment.AWIN_PRODUCT_FEED_URL?.trim();
  if (value === undefined || value === "") return undefined;
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    throw new Error("AWIN_PRODUCT_FEED_URL must be credential-free HTTPS on the default port");
  }
  const token = environment.AWIN_PRODUCT_FEED_TOKEN;
  if (token === undefined || token.length < 32 || token.length > 512) {
    throw new Error("AWIN_PRODUCT_FEED_TOKEN must contain 32 through 512 characters");
  }
  const timeoutMs = Number(environment.AWIN_PRODUCT_FEED_TIMEOUT_MS ?? "5000");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000) {
    throw new Error("AWIN_PRODUCT_FEED_TIMEOUT_MS must be an integer from 500 through 30000");
  }
  return { url: url.href, token, timeoutMs };
}

function parsePublicSearchConfiguration(environment: Readonly<Record<string, string | undefined>>): {
  url: string;
  timeoutMs: number;
} | undefined {
  const value = environment.AWIN_PRODUCT_SEARCH_URL?.trim();
  if (value === undefined || value === "") return undefined;
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("AWIN_PRODUCT_SEARCH_URL must be credential-free HTTPS on the default port");
  }
  const timeoutMs = Number(environment.AWIN_PRODUCT_SEARCH_TIMEOUT_MS ?? "5000");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000) {
    throw new Error("AWIN_PRODUCT_SEARCH_TIMEOUT_MS must be an integer from 500 through 30000");
  }
  return { url: url.href, timeoutMs };
}

async function fetchPublicSearch(
  configuration: { url: string; timeoutMs: number },
  input: AwinSearchInput,
  fetchRequest: typeof fetch
): Promise<AwinSearchResult> {
  const response = await fetchRequest(configuration.url, {
    method: "POST",
    redirect: "error",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(configuration.timeoutMs)
  });
  if (!response.ok) throw new Error(`Awin Search service returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new Error("Awin Search service returned an unsupported content type");
  }
  const encoded = await readLimitedBody(
    response,
    MAX_AWIN_PUBLIC_SEARCH_RESPONSE_BYTES,
    "Awin Search service"
  );
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(encoded));
  } catch {
    throw new Error("Awin Search service returned invalid JSON");
  }
  return parseAwinSearchResult(decoded);
}

export function parseAwinSearchResult(value: unknown): AwinSearchResult {
  if (!isObject(value)) throw new Error("Awin search result must be an object");
  if (value.source !== "AWIN_PRODUCT_FEED" || value.coverage !== "COMPLETE") {
    throw new Error("Awin search result source is invalid");
  }
  const snapshotAt = validIsoDate(value.snapshotAt, "Awin search snapshotAt");
  if (!isObject(value.diagnostics)) throw new Error("Awin search diagnostics are invalid");
  const diagnostics = {
    feedRows: nonnegativeInteger(value.diagnostics.feedRows, "feedRows"),
    validRows: nonnegativeInteger(value.diagnostics.validRows, "validRows"),
    rejectedRows: nonnegativeInteger(value.diagnostics.rejectedRows, "rejectedRows"),
    queryMatches: nonnegativeInteger(value.diagnostics.queryMatches, "queryMatches"),
    priceProductsExcluded: nonnegativeInteger(
      value.diagnostics.priceProductsExcluded,
      "priceProductsExcluded"
    )
  };
  if (
    diagnostics.validRows + diagnostics.rejectedRows !== diagnostics.feedRows ||
    diagnostics.queryMatches > diagnostics.validRows ||
    diagnostics.priceProductsExcluded > diagnostics.queryMatches
  ) {
    throw new Error("Awin search diagnostics are inconsistent");
  }
  if (!Array.isArray(value.products) || value.products.length > 24) {
    throw new Error("Awin search products are invalid");
  }
  return {
    source: "AWIN_PRODUCT_FEED",
    coverage: "COMPLETE",
    snapshotAt,
    diagnostics,
    products: value.products.map(parsePublicAwinProduct)
  };
}

function parsePublicAwinProduct(value: unknown): AwinProduct {
  if (!isObject(value)) throw new Error("Awin product must be an object");
  const merchantId = boundedString(value.merchantId, "merchantId", 1, 20);
  if (
    !/^\d{1,20}$/u.test(merchantId) ||
    value.matchStatus !== "DISCOVERY_MATCH" ||
    value.condition !== "UNKNOWN"
  ) {
    throw new Error("Awin product merchant or identity state is invalid");
  }
  if (!Array.isArray(value.matchEvidence) || value.matchEvidence.length < 1 || value.matchEvidence.length > 10) {
    throw new Error("Awin product match evidence is invalid");
  }
  const matchEvidence = value.matchEvidence.map((entry) => boundedString(entry, "matchEvidence", 1, 300));
  if (!isObject(value.itemPrice)) throw new Error("Awin product item price is invalid");
  if (value.itemPrice.currency !== "USD") {
    throw new Error("Awin product item price is invalid");
  }
  const amountCents = positiveInteger(value.itemPrice.amountCents, "amountCents", 100_000_000);
  const merchant = boundedString(value.merchant, "merchant", 1, 300);
  const merchantUrl = approvedMerchantUrl(boundedString(value.merchantUrl, "merchantUrl", 1, 4_096));
  const affiliateUrl = approvedUrl(
    boundedString(value.affiliateUrl, "affiliateUrl", 1, 4_096),
    APPROVED_AFFILIATE_HOST
  );
  const affiliate = new URL(affiliateUrl);
  if (!hasApprovedAffiliateRelationship(affiliate, merchantId)) {
    throw new Error("Awin product affiliate relationship is invalid");
  }
  if (value.availability !== "IN_STOCK" && value.availability !== "OUT_OF_STOCK" && value.availability !== "UNKNOWN") {
    throw new Error("Awin product availability is invalid");
  }
  const imageValue = value.imageUrl;
  const imageUrl = imageValue === undefined
    ? undefined
    : approvedHttpsUrl(boundedString(imageValue, "imageUrl", 1, 4_096));
  return {
    merchantId,
    merchant,
    merchantProductId: boundedString(value.merchantProductId, "merchantProductId", 1, 300),
    title: boundedString(value.title, "title", 1, 500),
    category: boundedString(value.category, "category", 1, 300),
    matchStatus: "DISCOVERY_MATCH",
    matchEvidence,
    condition: "UNKNOWN",
    ...(imageUrl === undefined ? {} : { imageUrl }),
    itemPrice: { amountCents, currency: "USD" },
    availability: value.availability,
    merchantUrl,
    affiliateUrl,
    checkedAt: validIsoDate(value.checkedAt, "Awin product checkedAt")
  };
}

async function fetchRemoteArchive(
  configuration: { url: string; token: string; timeoutMs: number },
  fetchRequest: typeof fetch
): Promise<{ compressed: Uint8Array; snapshotAt: string }> {
  const response = await fetchRequest(configuration.url, {
    method: "GET",
    redirect: "error",
    headers: {
      accept: "application/gzip, application/octet-stream",
      authorization: `Bearer ${configuration.token}`
    },
    signal: AbortSignal.timeout(configuration.timeoutMs)
  });
  if (!response.ok) throw new Error(`Awin Feed service returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/gzip" && contentType !== "application/octet-stream") {
    throw new Error("Awin Feed service returned an unsupported content type");
  }
  const compressed = await readLimitedBody(response, MAX_AWIN_COMPRESSED_BYTES, "Awin Feed service");
  const snapshotAt = response.headers.get("x-feed-snapshot-at");
  if (snapshotAt === null || !Number.isFinite(Date.parse(snapshotAt))) {
    throw new Error("Awin Feed service omitted a valid snapshot timestamp");
  }
  return { compressed, snapshotAt: new Date(snapshotAt).toISOString() };
}

export async function readLimitedBody(
  response: Response,
  limit: number,
  sourceName = "remote source"
): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > limit)) {
    throw new Error(`${sourceName} response is too large`);
  }
  if (response.body === null) throw new Error(`${sourceName} returned an empty body`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) throw new Error(`${sourceName} response is too large`);
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function requireValue(record: Record<string, string>, key: string): string {
  const value = record[key]?.trim();
  if (value === undefined || value === "") throw new Error(`missing Awin field: ${key}`);
  return value;
}

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function approvedUrl(value: string, expectedHost: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== expectedHost ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    throw new Error("unapproved Awin URL");
  }
  return url.href;
}

function approvedMerchantUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    host === APPROVED_AFFILIATE_HOST ||
    host === "localhost" ||
    !host.includes(".") ||
    isIP(host) !== 0 ||
    host.split(".").some((label) => label.startsWith("xn--"))
  ) {
    throw new Error("unapproved Awin merchant URL");
  }
  return url.href;
}

function approvedHttpsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
    throw new Error("invalid Awin image URL");
  }
  return url.href;
}

function hasApprovedAffiliateRelationship(url: URL, merchantId: string): boolean {
  const classic = url.searchParams.get("a") === APPROVED_PUBLISHER_ID && url.searchParams.get("m") === merchantId;
  const enhanced = url.searchParams.get("awinaffid") === APPROVED_PUBLISHER_ID && url.searchParams.get("awinmid") === merchantId;
  return classic || enhanced;
}

function parseUsdCents(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/u.test(value)) throw new Error("invalid Awin USD price");
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100_000_000) {
    throw new Error("Awin USD price out of range");
  }
  return cents;
}

function tokenizeQuery(value: string): string[] {
  const translated = value
    .normalize("NFKC")
    .replaceAll("护发", " hair care ")
    .replaceAll("角蛋白", " keratin ")
    .replaceAll("洗发水", " shampoo ")
    .replaceAll("护发素", " conditioner ")
    .replaceAll("发膜", " hair mask ")
    .replaceAll("拉直", " straightening ");
  const commerceTranslated = translated
    .replaceAll("狩猎相机", " trail camera ")
    .replaceAll("打猎相机", " trail camera ")
    .replaceAll("猎场相机", " trail camera ")
    .replaceAll("追踪相机", " trail camera ")
    .replaceAll("野生动物相机", " wildlife camera ")
    .replaceAll("手表", " watch ")
    .replaceAll("腕表", " watch ");
  return [...new Set(normalizeSearchText(commerceTranslated).match(/[\p{L}\p{N}]+/gu) ?? [])];
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}

function titleMatchScore(product: IndexedProduct, tokens: string[]): number {
  const normalizedTitle = normalizeSearchText(product.title);
  return tokens.filter((token) => normalizedTitle.includes(token)).length;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(
  value: unknown,
  name: string,
  minimumLength: number,
  maximumLength: number
): string {
  if (typeof value !== "string" || value.length < minimumLength || value.length > maximumLength) {
    throw new Error(`Awin ${name} is invalid`);
  }
  return value;
}

function nonnegativeInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`Awin ${name} is invalid`);
  }
  return value as number;
}

function positiveInteger(value: unknown, name: string, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new Error(`Awin ${name} is invalid`);
  }
  return value as number;
}

function validIsoDate(value: unknown, name: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${name} is invalid`);
  }
  return new Date(value).toISOString();
}
