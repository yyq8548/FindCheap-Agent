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

const HostSchema = z.string().trim().toLowerCase().regex(
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u
);
const ApiVersionSchema = z.literal("2026-07");
const HandleSchema = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(200);
const MoneySchema = z.object({ amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/u), currencyCode: z.literal("USD") }).strict();
const ImageSchema = z.object({ url: z.string().url() }).strict();
const VariantSchema = z.object({
  title: z.string().trim().min(1).max(500),
  sku: z.string().trim().max(200).nullable().optional(),
  barcode: z.string().trim().max(32).nullable().optional(),
  availableForSale: z.boolean(),
  price: MoneySchema,
  image: ImageSchema.nullable().optional()
}).strict();
const ProductSchema = z.object({
  title: z.string().trim().min(1).max(1_000),
  handle: HandleSchema,
  vendor: z.string().trim().max(300),
  productType: z.string().trim().max(200),
  tags: z.array(z.string().trim().min(1).max(200)).max(100),
  onlineStoreUrl: z.string().url(),
  featuredImage: ImageSchema.nullable().optional(),
  selectedOrFirstAvailableVariant: VariantSchema.nullable()
}).strict();
const SearchResponseSchema = z.object({
  data: z.object({ products: z.object({ nodes: z.array(ProductSchema).max(20) }).strict() }).strict(),
  errors: z.never().optional()
}).passthrough();
const ProductResponseSchema = z.object({
  data: z.object({ product: ProductSchema.nullable() }).strict(),
  errors: z.never().optional()
}).passthrough();

const PRODUCT_FIELDS = `
  title
  handle
  vendor
  productType
  tags
  onlineStoreUrl
  featuredImage { url }
  selectedOrFirstAvailableVariant {
    title
    sku
    barcode
    availableForSale
    price { amount currencyCode }
    image { url }
  }
`;
const SEARCH_QUERY = `query SearchProducts($first: Int!, $query: String!) @inContext(country: US) {
  products(first: $first, query: $query, sortKey: RELEVANCE) { nodes { ${PRODUCT_FIELDS} } }
}`;
const PRODUCT_QUERY = `query ProductByHandle($handle: String!) @inContext(country: US) {
  product(handle: $handle) { ${PRODUCT_FIELDS} }
}`;

export type ShopifyStorefrontReaderConfig = {
  host: string;
  apiVersion: "2026-07";
};

export type ShopifyStorefrontReader = {
  capture(request: ConfiguredSourceRequest): Promise<SourceReadSnapshot>;
};

/** Tokenless, read-only Shopify Storefront reader bound to one audited merchant host. */
export function createShopifyStorefrontReader(
  allowedHostsInput: readonly string[],
  configInput: ShopifyStorefrontReaderConfig,
  dependencies: ReaderDependencies = {}
): ShopifyStorefrontReader {
  const host = HostSchema.parse(configInput.host);
  const apiVersion = ApiVersionSchema.parse(configInput.apiVersion);
  const allowedHosts = allowedHostsInput.map((value) => HostSchema.parse(value));
  if (!allowedHosts.includes(host)) throw new Error("Shopify Storefront host is not audited");

  return {
    async capture(request) {
      const graph = graphRequest(request);
      const path = `/api/${apiVersion}/graphql.json?${new URLSearchParams({
        query: graph.query,
        variables: JSON.stringify(graph.variables)
      }).toString()}`;
      const fetched = await fetchConfigured(buildConfiguredUrl(host, path), allowedHosts, dependencies);
      ensureSuccessfulJson(fetched.response);
      const rawBody = await fetched.response.text();
      return sourceReadSnapshot(
        parseResponse(rawBody, graph.kind, allowedHosts),
        rawBody,
        fetched.finalUrl,
        dependencies
      );
    }
  };
}

function graphRequest(request: ConfiguredSourceRequest): {
  kind: "search" | "product";
  query: string;
  variables: Record<string, string | number>;
} {
  if (request.operation === "search") {
    const query = normalizeSearchQuery(request.query);
    if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 20) {
      throw new Error("Shopify search limit is invalid");
    }
    return { kind: "search", query: SEARCH_QUERY, variables: { first: request.limit, query } };
  }
  if (
    request.operation === "get" ||
    request.operation === "refreshProduct" ||
    request.operation === "refreshOffer"
  ) {
    return {
      kind: "product",
      query: PRODUCT_QUERY,
      variables: { handle: parseHandle(request.merchantProductId) }
    };
  }
  throw new Error("Shopify Storefront API does not provide this operation");
}

function normalizeSearchQuery(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (
    normalized.length < 2 ||
    normalized.length > 300 ||
    !/^[\p{L}\p{N}\s._+'-]+$/u.test(normalized)
  ) {
    throw new Error("Shopify search query is invalid");
  }
  return normalized;
}

function parseHandle(value: string): string {
  try {
    return HandleSchema.parse(value);
  } catch (error) {
    throw new Error("Shopify product handle is invalid", { cause: error });
  }
}

function parseResponse(
  rawBody: string,
  kind: "search" | "product",
  allowedHosts: readonly string[]
): RawMerchantRecord[] {
  let document: unknown;
  try {
    document = JSON.parse(rawBody);
  } catch (error) {
    throw new Error("Shopify Storefront API returned invalid JSON", { cause: error });
  }
  if (isRecord(document) && Array.isArray(document.errors) && document.errors.length > 0) {
    throw new Error("Shopify Storefront GraphQL request failed");
  }
  try {
    const products = kind === "search"
      ? SearchResponseSchema.parse(document).data.products.nodes
      : [ProductResponseSchema.parse(document).data.product].filter(
          (product): product is z.infer<typeof ProductSchema> => product !== null
        );
    return products.flatMap((product) => mapProduct(product, allowedHosts));
  } catch (error) {
    throw new Error("Shopify Storefront response is invalid", { cause: error });
  }
}

function mapProduct(product: z.infer<typeof ProductSchema>, allowedHosts: readonly string[]): RawMerchantRecord[] {
  const variant = product.selectedOrFirstAvailableVariant;
  if (variant === null) return [];
  const productUrl = requireProductUrl(product.onlineStoreUrl, allowedHosts);
  const barcode = variant.barcode !== undefined && variant.barcode !== null && /^\d{8,14}$/u.test(variant.barcode)
    ? variant.barcode
    : undefined;
  const title = variant.title === "Default Title" ? product.title : `${product.title} — ${variant.title}`;
  const record: RawMerchantRecord = {
    merchantProductId: product.handle,
    title,
    gtins: barcode === undefined ? [] : [barcode],
    rawOffer: {
      price: variant.price.amount,
      priceCurrency: variant.price.currencyCode,
      availability: variant.availableForSale ? "IN_STOCK" : "OUT_OF_STOCK",
      url: productUrl
    }
  };
  if (product.vendor !== "") record.brand = product.vendor;
  if (product.productType !== "") record.productType = product.productType;
  if (product.tags.length > 0) record.tags = product.tags;
  if (variant.sku !== undefined && variant.sku !== null && variant.sku !== "") record.mpn = variant.sku;
  const imageUrl = variant.image?.url ?? product.featuredImage?.url;
  if (imageUrl !== undefined) record.imageUrl = imageUrl;
  return [record];
}

function requireProductUrl(value: string, allowedHosts: readonly string[]): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    !allowedHosts.includes(url.hostname.toLowerCase()) ||
    !url.pathname.startsWith("/products/")
  ) {
    throw new Error("Shopify product URL is outside the audited host");
  }
  url.hash = "";
  return url.href;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
