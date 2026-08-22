import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const MAX_COMPRESSED_BYTES = 4 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
const DEFAULT_FEED_NAME = "datafeed_3047955.csv.gz";
const APPROVED_PUBLISHER_ID = "3047955";
const APPROVED_MERCHANT_ID = "20282";
const APPROVED_MERCHANT_NAME = "Amazonliss (US)";
const APPROVED_MERCHANT_HOST = "www.nutreecosmetics.com";
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

  return {
    async search(input) {
      const remote = parseRemoteConfiguration(environment);
      const archive = remote === undefined
        ? {
            compressed: await read(feedPath),
            snapshotAt: (await fileStat(feedPath)).mtime.toISOString()
          }
        : await fetchRemoteArchive(remote, fetchRequest);
      const { rows, parsed } = parseArchive(archive.compressed, archive.snapshotAt);
      const queryTokens = tokenizeQuery(input.query);
      const matched = parsed.filter((product) =>
        queryTokens.every((token) => product.searchText.includes(token))
      );
      const priceEligible = input.maxItemPriceCents === undefined
        ? matched
        : matched.filter((product) => product.itemPrice.amountCents <= input.maxItemPriceCents!);
      const products = priceEligible
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
        snapshotAt: archive.snapshotAt,
        diagnostics: {
          feedRows: rows.records.length,
          validRows: parsed.length,
          rejectedRows: rows.records.length - parsed.length,
          queryMatches: matched.length,
          priceProductsExcluded: matched.length - priceEligible.length
        },
        products
      };
    }
  };
}

export function validateAwinFeedArchive(compressed: Uint8Array): {
  feedRows: number;
  validRows: number;
  rejectedRows: number;
  uniqueMerchantProductIds: number;
} {
  const { rows, parsed } = parseArchive(compressed, new Date(0).toISOString());
  return {
    feedRows: rows.records.length,
    validRows: parsed.length,
    rejectedRows: rows.records.length - parsed.length,
    uniqueMerchantProductIds: new Set(parsed.map((product) => product.merchantProductId)).size
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
  if (new Set(headers).size !== headers.length) throw new Error("duplicate Awin CSV header");
  return {
    headers,
    records: rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])))
  };
}

function toProduct(record: Record<string, string>, checkedAt: string): IndexedProduct {
  requireValue(record, "product_name");
  requireValue(record, "merchant_product_id");
  if (record.merchant_id !== APPROVED_MERCHANT_ID || record.merchant_name !== APPROVED_MERCHANT_NAME) {
    throw new Error("unapproved Awin merchant");
  }
  if (record.currency !== "USD") throw new Error("unsupported Awin currency");
  const merchantUrl = approvedUrl(requireValue(record, "merchant_deep_link"), APPROVED_MERCHANT_HOST);
  const affiliateUrl = approvedUrl(requireValue(record, "aw_deep_link"), APPROVED_AFFILIATE_HOST);
  const affiliate = new URL(affiliateUrl);
  if (
    affiliate.searchParams.get("a") !== APPROVED_PUBLISHER_ID ||
    affiliate.searchParams.get("m") !== APPROVED_MERCHANT_ID
  ) {
    throw new Error("Awin link does not match approved relationship");
  }
  const itemPriceCents = parseUsdCents(requireValue(record, "search_price"));
  const imageValue = record.merchant_image_url?.trim();
  const imageUrl = imageValue === undefined || imageValue === "" ? undefined : approvedHttpsUrl(imageValue);
  const title = record.product_name!.trim();
  const category = record.merchant_category?.trim() || record.category_name?.trim() || "Uncategorized";
  const description = record.description?.trim() ?? "";
  return {
    merchantId: APPROVED_MERCHANT_ID,
    merchant: APPROVED_MERCHANT_NAME,
    merchantProductId: record.merchant_product_id!.trim(),
    title,
    category,
    matchStatus: "DISCOVERY_MATCH",
    matchEvidence: [
      "Awin merchant_product_id present",
      "GTIN, MPN, brand, and condition unavailable; exact identity not independently verified"
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
    searchText: normalizeSearchText(`${title} ${category} ${description} ${APPROVED_MERCHANT_NAME} Nutree Cosmetics`)
  };
}

function parseArchive(compressed: Uint8Array, checkedAt: string): {
  rows: ReturnType<typeof parseAwinCsv>;
  parsed: IndexedProduct[];
} {
  if (compressed.byteLength > MAX_COMPRESSED_BYTES) throw new Error("AWIN_FEED_TOO_LARGE");
  const csv = gunzipSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED_BYTES }).toString("utf8");
  const rows = parseAwinCsv(csv);
  const parsed = rows.records.flatMap((record) => {
    try {
      return [toProduct(record, checkedAt)];
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
  const compressed = await readLimitedBody(response, MAX_COMPRESSED_BYTES);
  const snapshotAt = response.headers.get("x-feed-snapshot-at");
  if (snapshotAt === null || !Number.isFinite(Date.parse(snapshotAt))) {
    throw new Error("Awin Feed service omitted a valid snapshot timestamp");
  }
  return { compressed, snapshotAt: new Date(snapshotAt).toISOString() };
}

async function readLimitedBody(response: Response, limit: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > limit)) {
    throw new Error("Awin Feed service response is too large");
  }
  if (response.body === null) throw new Error("Awin Feed service returned an empty body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) throw new Error("Awin Feed service response is too large");
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

function approvedHttpsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
    throw new Error("invalid Awin image URL");
  }
  return url.href;
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
  return [...new Set(normalizeSearchText(translated).match(/[\p{L}\p{N}]+/gu) ?? [])];
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}

function titleMatchScore(product: IndexedProduct, tokens: string[]): number {
  const normalizedTitle = normalizeSearchText(product.title);
  return tokens.filter((token) => normalizedTitle.includes(token)).length;
}
