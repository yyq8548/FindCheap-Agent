import {
  RawMerchantRecordSchema,
  buildConfiguredUrl,
  fetchConfigured,
  type RawMerchantRecord,
  type ReaderDependencies,
  type ReaderNetworkConfig,
  type SourceReader
} from "./feed-reader.js";

export type JsonLdReaderConfig = ReaderNetworkConfig;

export function createJsonLdReader(
  config: JsonLdReaderConfig,
  dependencies: ReaderDependencies = {}
): SourceReader {
  const url = buildConfiguredUrl(config.host, config.resourcePath);

  return {
    async read() {
      const response = await fetchConfigured(url, config.allowedHosts, dependencies);
      if (!response.ok) throw new Error(`merchant source returned HTTP ${response.status}`);
      const contentType = response.headers.get("content-type");
      if (contentType === null || !/(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) {
        throw new Error("merchant source did not return HTML");
      }
      return parseProductJsonLd(await response.text());
    }
  };
}

export function parseProductJsonLd(document: string): RawMerchantRecord[] {
  const nodes = extractJsonLd(document).flatMap(flattenGraph);
  const records: RawMerchantRecord[] = [];
  for (const node of nodes) {
    if (!isProductNode(node)) continue;
    const parsed = RawMerchantRecordSchema.safeParse({
      merchantProductId: scalarString(node.sku),
      title: scalarString(node.name),
      brand: readBrand(node.brand),
      gtins: readGtins(node),
      mpn: scalarString(node.mpn),
      imageUrl: firstImage(node.image),
      rawOffer: readOffer(node.offers)
    });
    if (parsed.success) records.push(parsed.data);
  }
  return records;
}

function extractJsonLd(document: string): unknown[] {
  const values: unknown[] = [];
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of document.matchAll(scripts)) {
    const attributes = match[1] ?? "";
    if (!/\btype\s*=\s*(?:["']\s*application\/ld\+json\s*["']|application\/ld\+json(?:\s|$))/i.test(attributes)) {
      continue;
    }
    try {
      values.push(JSON.parse(match[2] ?? ""));
    } catch {
      // One malformed block must not hide other independent structured data.
    }
  }
  return values;
}

function flattenGraph(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenGraph);
  if (!isRecord(value)) return [];
  const result = [value];
  if (Object.hasOwn(value, "@graph")) result.push(...flattenGraph(value["@graph"]));
  return result;
}

function isProductNode(node: Record<string, unknown>): boolean {
  const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  return types.some(
    (type) =>
      typeof type === "string" &&
      (type === "Product" || type.endsWith("/Product") || type.endsWith("#Product"))
  );
}

function readBrand(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isRecord(value)) return scalarString(value.name);
  return undefined;
}

function readGtins(node: Record<string, unknown>): string[] {
  const values = [node.gtin, node.gtin8, node.gtin12, node.gtin13, node.gtin14]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map(scalarString)
    .filter((value): value is string => value !== undefined);
  return [...new Set(values)];
}

function firstImage(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first === "string") return first;
  if (isRecord(first)) return scalarString(first.url ?? first.contentUrl);
  return undefined;
}

function readOffer(value: unknown): Record<string, unknown> | undefined {
  const candidate = Array.isArray(value) ? value.find(isRecord) : value;
  if (!isRecord(candidate)) return undefined;
  const selected: Record<string, unknown> = {};
  selectOfferField(selected, "price", candidate.price);
  selectOfferField(selected, "priceCurrency", candidate.priceCurrency);
  selectOfferField(selected, "availability", candidate.availability);
  selectOfferField(selected, "url", candidate.url);
  return Object.keys(selected).length === 0 ? undefined : selected;
}

function selectOfferField(target: Record<string, unknown>, key: string, value: unknown): void {
  if (typeof value === "string" || (key === "price" && typeof value === "number")) {
    target[key] = value;
  }
}

function scalarString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
