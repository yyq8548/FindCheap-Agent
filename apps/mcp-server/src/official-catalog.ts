import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveMerchantTrust, resolveVerifiedOfficialStorefrontByHost } from "./merchant-trust.js";
import type { ShopifyProduct } from "./shopify-client.js";
import type { OfficialShopifySearchPort, OfficialShopifyStoreSeed } from "./shopify-official-store-search.js";
import { productReferenceKey } from "./product-reference.js";
import { hasVisualProductFamilyConflict, type VisualProductInput } from "./visual-product-discovery.js";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PRODUCTS = 2_000;
const FRESH_MS = 24 * 60 * 60 * 1_000;
const EXPIRE_MS = 7 * FRESH_MS;
const REFRESH_MS = 6 * 60 * 60 * 1_000;
const Text = z.string().trim().min(1).max(1_000);
const ProductSchema = z.object({
  merchantId: Text, merchant: Text, sourceHost: z.string().max(253), handle: Text, title: Text,
  productType: Text.optional(), description: z.string().max(20_000).optional(), brand: Text.optional(),
  sku: Text.optional(), gtins: z.array(Text).max(20), variantDimensions: z.record(Text).refine((value) => Object.keys(value).length <= 20),
  imageUrl: z.string().url().max(4_096).optional(),
  itemPrice: z.object({ amountCents: z.number().int().nonnegative().max(100_000_000), currency: z.literal("USD") }).optional(),
  availability: z.enum(["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"]), merchantUrl: z.string().url().max(4_096),
  checkedAt: z.string().datetime(), checkoutPlatform: z.enum(["SHOPIFY", "MERCHANT"]).optional(),
  availableSizes: z.array(z.string().max(100)).max(100).optional(),
  availabilityScope: z.enum(["SELECTED_VARIANT", "PRODUCT_COLOR"]).optional()
});
const SourceSchema = z.object({ lastAttemptAt: z.number().nonnegative(), cursor: z.number().int().min(0).max(100),
  queryPlanHash: z.string().max(64), coveredQueries: z.array(z.string().max(64)).max(100),
  lastStatus: z.enum(["COMPLETE", "FAILED"]) });
const SnapshotSchema = z.object({ version: z.literal(1), products: z.array(ProductSchema).max(MAX_PRODUCTS),
  sources: z.record(SourceSchema).refine((value) => Object.keys(value).length <= 200) }).strict();
const SourcePlanSchema = z.array(z.object({ host: z.string().trim().min(1).max(253),
  queries: z.array(z.string().trim().min(2).max(100)).min(1).max(100) }).strict()).min(1).max(6);
type Snapshot = z.infer<typeof SnapshotSchema>;
export type OfficialCatalogDiagnostics = { status: "EMPTY" | "FRESH" | "STALE" | "EXPIRED" | "CACHE_UNAVAILABLE";
  cachedProducts: number; returnedProducts: number; approvedSources: number; coveredQueries: number; expiredProducts: number };
export type OfficialCatalogPort = {
  search(input: { query: string; limit: number; visualInput?: VisualProductInput; signal?: AbortSignal }): Promise<{
    products: ShopifyProduct[]; diagnostics: OfficialCatalogDiagnostics;
  }>;
};

/** Public, reviewed metadata only. Search never crawls; explicit bounded refresh is an operator action. */
export function createOfficialCatalogPort(dependencies: {
  path: string; official: OfficialShopifySearchPort; now?: () => number;
}): OfficialCatalogPort & {
  importUrls(urls: string[]): Promise<{ imported: number; skippedSources: number; failedSources: number }>;
  refreshSources(plans: Array<{ host: string; queries: string[] }>): Promise<{ imported: number; skippedSources: number; failedSources: number }>;
} {
  const now = dependencies.now ?? Date.now;
  let snapshot: Snapshot = { version: 1, products: [], sources: {} };
  let lastRead = -Infinity;
  let readFailed = false;
  async function load(force = false): Promise<void> {
    if (!force && now() - lastRead < 60_000) return;
    lastRead = now();
    try {
      const bytes = await readBoundedSnapshot(dependencies.path);
      snapshot = SnapshotSchema.parse(JSON.parse(bytes.toString("utf8")));
      readFailed = false;
    } catch (error) {
      readFailed = !(error instanceof Error && "code" in error && error.code === "ENOENT");
      // Failed restoration never replaces this process's last valid snapshot.
    }
  }
  async function save(): Promise<void> {
    SnapshotSchema.parse(snapshot);
    const body = JSON.stringify(snapshot);
    if (Buffer.byteLength(body) > MAX_BYTES) throw new Error("OFFICIAL_CATALOG_BYTE_LIMIT");
    await mkdir(dirname(dependencies.path), { recursive: true });
    const temporary = `${dependencies.path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, body, { encoding: "utf8", flag: "wx" }); await rename(temporary, dependencies.path); }
    finally { await unlink(temporary).catch(() => undefined); }
  }
  async function update(work: Array<{ host: string; queries?: string[]; urls?: string[] }>) {
    for (const source of work) if (resolveVerifiedOfficialStorefrontByHost(source.host) === undefined) throw new Error("OFFICIAL_SOURCE_NOT_APPROVED");
    await mkdir(dirname(dependencies.path), { recursive: true });
    const lockPath = `${dependencies.path}.lock`;
    const lock = await open(lockPath, "wx"); // A crashed importer fails closed until an operator inspects its lock.
    let imported = 0; let skippedSources = 0; let failedSources = 0;
    try {
      await load(true);
      if (readFailed) throw new Error("OFFICIAL_CATALOG_RESTORE_FAILED");
      for (const source of work) {
        if (imported >= 20) break;
        const store = resolveVerifiedOfficialStorefrontByHost(source.host)!;
        const previous = snapshot.sources[store.host];
        if (previous !== undefined && now() - previous.lastAttemptAt < REFRESH_MS) { skippedSources += 1; continue; }
        const queries = source.queries ?? [];
        const hash = createHash("sha256").update(JSON.stringify(queries)).digest("hex");
        const cursor = previous?.queryPlanHash === hash ? previous.cursor % Math.max(1, queries.length) : 0;
        const query = queries[cursor];
        const state = { lastAttemptAt: now(), cursor: (cursor + 1) % Math.max(1, queries.length), queryPlanHash: hash,
          coveredQueries: previous?.queryPlanHash === hash ? previous.coveredQueries : [], lastStatus: "FAILED" as "FAILED" | "COMPLETE" };
        snapshot.sources[store.host] = state;
        await save(); // Failed attempts consume the persisted frequency budget too.
        try {
          const seed: OfficialShopifyStoreSeed = { ...store, merchantId: `official-${store.host}`, merchant: store.brand,
            sourceHost: store.host, merchantUrl: `https://${store.host}/` };
          const fetched: ShopifyProduct[] = [];
          const operations = source.urls ?? [undefined];
          for (const value of operations) {
            if (imported + fetched.length >= 20) break;
            const direct = value === undefined ? undefined : new URL(value);
            if (direct !== undefined) direct.hostname = store.host;
            const products = await dependencies.official.search({ seed, query: query ?? "public product", limit: Math.min(12, 20 - imported - fetched.length),
              signal: AbortSignal.timeout(10_000), cacheScope: source,
              ...(direct === undefined ? {} : { sourcePageUrl: direct.href }) });
            if (products.length > Math.min(12, 20 - imported - fetched.length)) throw new Error("OFFICIAL_CATALOG_BATCH_LIMIT");
            for (const product of products) {
              const normalized = normalizeProduct(product);
              if (normalized === undefined || normalized.sourceHost !== store.host) throw new Error("OFFICIAL_CATALOG_PRODUCT_REJECTED");
              fetched.push(normalized);
            }
          }
          const merged = new Map(snapshot.products.map((product) => [productReferenceKey(product), product]));
          for (const product of fetched) merged.set(productReferenceKey(product), product);
          const products = [...merged.values()].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt)).slice(0, MAX_PRODUCTS);
          if (Buffer.byteLength(JSON.stringify({ ...snapshot, products })) > MAX_BYTES) throw new Error("OFFICIAL_CATALOG_BYTE_LIMIT");
          snapshot.products = products;
          imported += fetched.length;
          state.lastStatus = "COMPLETE";
          if (query !== undefined) state.coveredQueries = [...new Set([...state.coveredQueries, createHash("sha256").update(query).digest("hex")])].slice(0, 100);
        } catch { failedSources += 1; }
        await save();
      }
      return { imported, skippedSources, failedSources };
    } finally { await lock.close(); await unlink(lockPath); }
  }
  return {
    async search(input) {
      input.signal?.throwIfAborted();
      await load();
      input.signal?.throwIfAborted();
      let expiredProducts = 0;
      const terms = tokens(input.query);
      const usable = snapshot.products.flatMap((entry) => {
        const product = normalizeProduct(entry);
        const age = now() - Date.parse(entry.checkedAt);
        if (product === undefined || age < -60_000 || age > EXPIRE_MS) { expiredProducts += 1; return []; }
        if (input.visualInput !== undefined && hasVisualProductFamilyConflict(input.visualInput, product)) return [];
        const words = new Set(tokens([product.title, product.productType, product.description, ...Object.values(product.variantDimensions)].join(" ")));
        const score = terms.reduce((sum, word) => sum + (words.has(word) ? 1 : 0), 0);
        if (score === 0) return [];
        if (age > FRESH_MS) { delete product.itemPrice; delete product.availableSizes; product.availability = "UNKNOWN"; }
        return [{ product, score, stale: age > FRESH_MS }];
      }).sort((a, b) => b.score - a.score || productReferenceKey(a.product).localeCompare(productReferenceKey(b.product)));
      const selected = usable.slice(0, Math.max(1, Math.min(18, input.limit)));
      const diagnostics: OfficialCatalogDiagnostics = {
        status: readFailed ? "CACHE_UNAVAILABLE" : selected.some((entry) => entry.stale) ? "STALE"
          : snapshot.products.length === 0 ? "EMPTY" : usable.length === 0 && expiredProducts > 0 ? "EXPIRED" : "FRESH",
        cachedProducts: snapshot.products.length, returnedProducts: selected.length,
        approvedSources: new Set(usable.map((entry) => entry.product.sourceHost)).size,
        coveredQueries: Object.values(snapshot.sources).reduce((sum, source) => sum + source.coveredQueries.length, 0), expiredProducts
      };
      return { products: selected.map((entry) => entry.product), diagnostics };
    },
    async importUrls(input) {
      const urls = z.array(z.string().url().max(4_096)).min(1).max(20).parse(input);
      const groups = new Map<string, string[]>();
      for (const url of urls) { const host = new URL(url).hostname; groups.set(host, [...(groups.get(host) ?? []), url]); }
      return update([...groups].map(([host, entries]) => ({ host, urls: entries })));
    },
    async refreshSources(input) { return update(SourcePlanSchema.parse(input)); }
  };
}

function normalizeProduct(value: unknown): ShopifyProduct | undefined {
  const parsed = ProductSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const product = parsed.data;
  const store = resolveVerifiedOfficialStorefrontByHost(product.sourceHost);
  if (store === undefined || store.host !== product.sourceHost) return undefined;
  const url = new URL(product.merchantUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hostname !== store.host ||
    !store.productPathPrefixes.some((prefix) => url.pathname.startsWith(prefix))) return undefined;
  if (product.imageUrl !== undefined) {
    const image = new URL(product.imageUrl);
    if (image.protocol !== "https:" || image.username || image.password || image.port || ![store.host, ...store.imageHosts].includes(image.hostname)) delete product.imageUrl;
  }
  return { ...Object.fromEntries(Object.entries(product).filter(([, entry]) => entry !== undefined)), merchantTrust: resolveMerchantTrust(store.host, store.brand),
    condition: "UNKNOWN", matchStatus: "DISCOVERY_MATCH", matchEvidence: ["reviewed official catalog metadata; visual review remains required"] } as ShopifyProduct;
}
function tokens(value: string): string[] {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

async function readBoundedSnapshot(path: string): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error("OFFICIAL_CATALOG_BYTE_LIMIT");
    const buffer = Buffer.alloc(Math.min(MAX_BYTES + 1, info.size + 1));
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MAX_BYTES || total > info.size) throw new Error("OFFICIAL_CATALOG_BYTE_LIMIT");
    return buffer.subarray(0, total);
  } finally { await handle.close(); }
}
