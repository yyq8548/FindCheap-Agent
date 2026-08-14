import { z } from "zod";

import type { ConfiguredSourceRequest } from "./configured-adapter.js";
import {
  buildConfiguredUrl,
  ensureSuccessfulJson,
  fetchConfigured,
  sourceReadSnapshot,
  type RawMerchantRecord,
  type ReaderDependencies,
  type SourceReadSnapshot
} from "./feed-reader.js";

const API_HOST = "api.bestbuy.com";
const API_KEY_SCHEMA = z.string().trim().min(8).max(256).regex(/^[A-Za-z0-9_-]+$/u);
const PRODUCT_FIELDS = [
  "sku",
  "name",
  "manufacturer",
  "modelNumber",
  "upc",
  "image",
  "salePrice",
  "regularPrice",
  "onlineAvailability",
  "url"
].join(",");

const BestBuyProductSchema = z
  .object({
    sku: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/u)]),
    name: z.string().trim().min(1).max(1_000),
    manufacturer: z.string().trim().max(300).nullable().optional(),
    modelNumber: z.string().trim().max(300).nullable().optional(),
    upc: z.string().trim().max(32).nullable().optional(),
    image: z.string().url().nullable().optional(),
    salePrice: z.number().finite().nonnegative().nullable().optional(),
    regularPrice: z.number().finite().nonnegative().nullable().optional(),
    onlineAvailability: z.boolean().nullable().optional(),
    url: z.string().url()
  })
  .strip();

const ProductCollectionSchema = z.object({ products: z.array(z.unknown()).max(50) }).passthrough();

export type BestBuyProductsReaderDependencies = ReaderDependencies & {
  apiKey: string;
};

export type BestBuyProductsReader = {
  capture(request: ConfiguredSourceRequest): Promise<SourceReadSnapshot>;
};

/** Official Best Buy Products API reader. Credentials are used in transit and redacted from evidence. */
export function createBestBuyProductsReader(
  allowedHosts: readonly string[],
  dependencies: BestBuyProductsReaderDependencies
): BestBuyProductsReader {
  const apiKey = API_KEY_SCHEMA.parse(dependencies.apiKey);
  if (!allowedHosts.includes(API_HOST)) throw new Error("Best Buy API host is not audited");

  return {
    async capture(request) {
      const resourcePath = requestPath(request, apiKey);
      const fetched = await fetchConfigured(
        buildConfiguredUrl(API_HOST, resourcePath),
        allowedHosts,
        dependencies
      );
      ensureSuccessfulJson(fetched.response);
      const rawBody = await fetched.response.text();
      const records = parseProducts(rawBody, allowedHosts);
      const redactedEvidence = redactCredential(rawBody, apiKey);
      return sourceReadSnapshot(
        records,
        redactedEvidence,
        redactUrl(fetched.finalUrl),
        dependencies
      );
    }
  };
}

function requestPath(request: ConfiguredSourceRequest, apiKey: string): string {
  if (request.operation === "search") {
    const terms = searchTerms(request.query);
    const expression = terms.map((term) => `search=${encodeURIComponent(term)}`).join("&");
    return collectionPath(`/v1/products(${expression})`, apiKey, Math.min(request.limit, 50));
  }
  if (
    request.operation === "get" ||
    request.operation === "refreshProduct" ||
    request.operation === "refreshOffer"
  ) {
    const sku = request.merchantProductId.trim();
    if (!/^\d{1,20}$/u.test(sku)) throw new Error("Best Buy SKU is invalid");
    return collectionPath(`/v1/products/${sku}.json`, apiKey);
  }
  throw new Error("Best Buy Products API does not provide this operation");
}

function collectionPath(path: string, apiKey: string, pageSize?: number): string {
  const query = new URLSearchParams({ format: "json", show: PRODUCT_FIELDS, apiKey });
  if (pageSize !== undefined) query.set("pageSize", String(pageSize));
  return `${path}?${query.toString()}`;
}

function searchTerms(query: string): string[] {
  const normalized = query.normalize("NFKC").trim();
  if (
    normalized.length < 2 ||
    normalized.length > 300 ||
    !/^[\p{L}\p{N}\s._+'-]+$/u.test(normalized)
  ) {
    throw new Error("Best Buy search query is invalid");
  }
  const terms = normalized.split(/\s+/u);
  if (terms.length > 12 || terms.some((term) => term.length > 50)) {
    throw new Error("Best Buy search query is invalid");
  }
  return terms;
}

function parseProducts(rawBody: string, allowedHosts: readonly string[]): RawMerchantRecord[] {
  let document: unknown;
  try {
    document = JSON.parse(rawBody);
  } catch (error) {
    throw new Error("Best Buy API returned invalid JSON", { cause: error });
  }
  const values = isRecord(document) && Array.isArray(document.products)
    ? ProductCollectionSchema.parse(document).products
    : [document];
  return values.map((value, index) => {
    let product: z.infer<typeof BestBuyProductSchema>;
    try {
      product = BestBuyProductSchema.parse(value);
    } catch (error) {
      throw new Error(`invalid Best Buy product at index ${index}`, { cause: error });
    }
    requireOfficialProductUrl(product.url, allowedHosts);
    const rawOffer: NonNullable<RawMerchantRecord["rawOffer"]> = {
      priceCurrency: "USD",
      availability: product.onlineAvailability === true
        ? "IN_STOCK"
        : product.onlineAvailability === false
          ? "OUT_OF_STOCK"
          : "UNKNOWN",
      url: product.url
    };
    if (product.salePrice !== undefined && product.salePrice !== null) rawOffer.price = product.salePrice;
    const upc = product.upc !== undefined && product.upc !== null && /^\d{8,14}$/u.test(product.upc)
      ? product.upc
      : undefined;
    const record: RawMerchantRecord = {
      merchantProductId: String(product.sku),
      title: product.name,
      gtins: upc === undefined ? [] : [upc],
      rawOffer
    };
    if (product.manufacturer !== undefined && product.manufacturer !== null && product.manufacturer !== "") {
      record.brand = product.manufacturer;
    }
    if (product.modelNumber !== undefined && product.modelNumber !== null && product.modelNumber !== "") {
      record.mpn = product.modelNumber;
    }
    if (product.image !== undefined && product.image !== null) record.imageUrl = product.image;
    return record;
  });
}

function requireOfficialProductUrl(value: string, allowedHosts: readonly string[]): void {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    !allowedHosts.includes(url.hostname.toLowerCase())
  ) {
    throw new Error("Best Buy product URL is outside audited hosts");
  }
}

function redactCredential(value: string, apiKey: string): string {
  const redacted = value
    .split(apiKey).join("[REDACTED]")
    .split(encodeURIComponent(apiKey)).join("[REDACTED]")
    .replace(/([?&]apiKey=)[^"&\\\s]*/giu, "$1[REDACTED]");
  if (redacted.includes(apiKey)) throw new Error("Best Buy API credential redaction failed");
  return redacted;
}

function redactUrl(value: string): string {
  const url = new URL(value);
  url.searchParams.delete("apiKey");
  url.hash = "";
  return url.href;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
