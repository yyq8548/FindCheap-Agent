import { createHash, randomUUID } from "node:crypto";
import { WooInspectionResultSchema, WooLookupResultSchema, WooProductTargetSchema, WooSearchInputSchema, WooSearchResultSchema, WooVariantRequirementsSchema,
  type WooInspectionResult, type WooLookupResult, type WooProduct, type WooProductTarget, type WooSearchInput, type WooSearchResult, type WooStoreResult, type WooVariantRequirements
} from "../../../packages/contracts/src/woocommerce.js";
import { createPinnedRequest, safeFetch, type FetchPolicy } from "../../../packages/network-safety/src/safe-fetch.js";
import { createWooStoreReader, normalizeWooProduct, wooMatchesRequirements, WooReadError, type WooReadBudget, type WooRawProduct, type WooStoreReader } from "./woocommerce-store.js";
import { WooRegistrySchema, wooMerchantForUrl, type WooMerchant, type WooRegistry } from "./woocommerce-registry.js";

export type WooCommerceController = {
  search(input: WooSearchInput, options?: { signal?: AbortSignal }): Promise<WooSearchResult>;
  lookup(target: WooProductTarget, options?: { signal?: AbortSignal }): Promise<WooLookupResult>;
  inspect(target: WooProductTarget, requirements: WooVariantRequirements, options?: { signal?: AbortSignal }): Promise<WooInspectionResult>;
  image(merchantId: string, imageId: string, options?: { signal?: AbortSignal }): Promise<Response>;
};
type Dependencies = Pick<FetchPolicy, "resolve" | "request"> & { now?: () => number };
type Health = { failures: number; until: number; probe: boolean };

export function createWooCommerceController(registryInput: WooRegistry, dependencies: Dependencies = {}): WooCommerceController {
  const registry = WooRegistrySchema.parse(registryInput);
  const now = dependencies.now ?? Date.now;
  const timestamp = () => new Date(now()).toISOString();
  const acquire = concurrencyGate();
  const reader = createWooStoreReader({ ...dependencies, acquire });
  const health = new Map<string, Health>();
  const cache = new Map<string, { expires: number; bytes: number; value: WooSearchResult }>();
  let cacheBytes = 0;
  const images = new Map<string, { merchantId: string; url: string }>();
  function remember(product: WooProduct): WooProduct {
    const result = structuredClone(product);
    for (const image of result.images) {
      const id = createHash("sha256").update(`${product.merchantId}\n${image.url}`).digest("hex");
      image.id = id;
      images.delete(id);
      images.set(id, { merchantId: product.merchantId, url: image.url });
    }
    while (images.size > 2_000) images.delete(images.keys().next().value!);
    return result;
  }
  function merchant(id: string, probe = true): WooMerchant {
    const result = registry.stores.find((store) => store.merchantId === id && store.enabled);
    if (result === undefined) throw new WooReadError("ACCESS_DENIED");
    const state = health.get(id);
    if (state !== undefined && (state.until > now() || state.probe)) throw new WooReadError("CIRCUIT_OPEN");
    if (probe && state !== undefined && state.failures >= 3) state.probe = true;
    return result;
  }
  function recordFailure(id: string, error: unknown): void {
    if (!registry.stores.some((store) => store.merchantId === id)) return;
    const reason = error instanceof WooReadError ? error.reason : "UPSTREAM_UNAVAILABLE";
    if (!["TIMEOUT", "UPSTREAM_UNAVAILABLE", "RATE_LIMITED", "ACCESS_DENIED", "SECURITY_REJECTED", "INVALID_RESPONSE"].includes(reason)) {
      const state = health.get(id); if (state !== undefined && reason !== "CIRCUIT_OPEN") state.probe = false;
      return;
    }
    const failures = (health.get(id)?.failures ?? 0) + 1;
    const pause = reason === "RATE_LIMITED" ? Math.max(1_000, error instanceof WooReadError ? error.retryAfterMs ?? 300_000 : 300_000) : ["ACCESS_DENIED", "SECURITY_REJECTED", "INVALID_RESPONSE"].includes(reason) ? Number.POSITIVE_INFINITY : failures >= 3 ? 300_000 : 0;
    health.set(id, { failures, until: now() + pause, probe: false });
  }
  function budget(signal?: AbortSignal, timeout = 8_000): WooReadBudget {
    return { signal: signal === undefined ? AbortSignal.timeout(timeout) : AbortSignal.any([signal, AbortSignal.timeout(timeout)]), requests: 0, bytes: 0, maxRequests: 18, maxBytes: 8 * 1024 * 1024 };
  }
  async function variants(store: WooMerchant, parent: WooRawProduct, requirements: WooVariantRequirements, limits: WooReadBudget): Promise<{ products: WooProduct[]; truncated: boolean }> {
    if (!store.capabilities.variations) throw new WooReadError("UNSUPPORTED");
    const products: WooProduct[] = [];
    let truncated = false;
    for (let page = 1; page <= 2; page += 1) {
      let result: Awaited<ReturnType<WooStoreReader["list"]>>;
      try { result = await reader.list(store, new URLSearchParams({ type: "variation", parent: String(parent.id), per_page: "20", page: String(page) }), limits); }
      catch (error) { if (products.length > 0) return { products: products.slice(0, 24), truncated: true }; throw error; }
      for (const raw of result.products) {
        if (raw.type !== "variation") throw new WooReadError("INVALID_RESPONSE");
        const product = normalizeWooProduct(raw, store, timestamp(), parent);
        if (product === undefined) throw new WooReadError("INVALID_RESPONSE");
        if (wooMatchesRequirements(product, requirements)) products.push(remember(product));
      }
      if (result.totalPages <= page) break;
      truncated = page === 2;
    }
    return { products: products.slice(0, 24), truncated: truncated || products.length > 24 };
  }
  return {
    async search(value, options = {}) {
      const input = WooSearchInputSchema.parse(value);
      const urlSelection = input.productUrl === undefined ? undefined : selectionForProductUrl(input.productUrl);
      if (urlSelection !== undefined) {
        const attributes = { ...input.requirements?.attributes };
        for (const [key, value] of Object.entries(urlSelection.attributes)) {
          const explicit = key === "color" ? input.requirements?.color : key === "size" ? input.requirements?.size : attributes[key];
          if (explicit !== undefined && explicit.toLowerCase() !== value.toLowerCase()) throw new WooReadError("SECURITY_REJECTED");
          attributes[key] = value;
        }
        input.requirements = { ...input.requirements, attributes };
      }
      const started = now();
      const limits = budget(options.signal, input.budgetMs);
      limits.signal.throwIfAborted();
      const eligible = registry.stores.filter((store) => store.enabled && store.capabilities.search && store.currency === input.currency);
      if (input.continuation !== undefined && (input.continuation.registryVersion !== registry.version || input.continuation.attemptedMerchantIds.some((id) => !registry.stores.some((store) => store.merchantId === id)))) throw new WooReadError("SECURITY_REJECTED");
      const attemptedBefore = new Set(input.continuation?.attemptedMerchantIds ?? []);
      const urlStore = input.productUrl === undefined ? undefined : wooMerchantForUrl(registry, input.productUrl);
      if (input.productUrl !== undefined && urlStore === undefined) throw new WooReadError("SECURITY_REJECTED");
      const unattempted = eligible.filter((store) => !attemptedBefore.has(store.merchantId));
      const candidates = urlStore === undefined ? unattempted.length > 0 ? unattempted : eligible : [urlStore];
      const planned = candidates.sort((a, b) => storeScore(b, input) - storeScore(a, input) || a.merchantId.localeCompare(b.merchantId)).slice(0, 6);
      const key = JSON.stringify([registry.version, input]);
      const cached = cache.get(key);
      if (cached !== undefined && cached.expires > now() && planned.every((store) => store.enabled && (health.get(store.merchantId)?.until ?? 0) <= now() && health.get(store.merchantId)?.probe !== true)) {
        cache.delete(key); cache.set(key, cached);
        const result = structuredClone(cached.value);
        result.products = result.products.map(remember);
        result.requestId = randomUUID();
        result.diagnostics = { ...result.diagnostics, physicalRequests: 0, responseBytes: 0, cacheHits: 1, elapsedMs: now() - started };
        result.stores = result.stores.map((store) => ({ ...store, requests: 0 }));
        return result;
      }
      if (cached !== undefined) { cacheBytes -= cached.bytes; cache.delete(key); }
      let retryCount = 0;
      const outputs = await mapConcurrent(planned, 3, async (store) => {
        const state = health.get(store.merchantId);
        const result: WooStoreResult = { merchantId: store.merchantId, status: "COMPLETE", requests: 0, returned: 0 };
        const collected: WooProduct[] = [];
        if (state !== undefined && (state.until > now() || (state.failures >= 3 && state.probe))) return { result: { ...result, status: "SKIPPED" as const, reason: "CIRCUIT_OPEN" as const }, products: collected, truncated: true };
        if (state !== undefined && state.failures >= 3) state.probe = true;
        let truncated = false;
        let retried = false;
        const local: WooReadBudget = { signal: limits.signal, get requests() { return limits.requests; }, set requests(value) { limits.requests = value; },
          get bytes() { return limits.bytes; }, set bytes(value) { limits.bytes = value; }, maxRequests: 18, maxBytes: limits.maxBytes, onRequest: () => { result.requests += 1; } };
        try {
          for (let page = 1; page <= 2; page += 1) {
            const params = input.productUrl === undefined ? new URLSearchParams({ search: input.query, per_page: "20", page: String(page) }) : paramsForProductUrl(input.productUrl);
            let response: Awaited<ReturnType<WooStoreReader["list"]>>;
            try { response = await reader.list(store, params, local); }
            catch (error) {
              if (!(error instanceof WooReadError) || !["TIMEOUT", "UPSTREAM_UNAVAILABLE"].includes(error.reason) || retried || retryCount >= 2 || limits.signal.aborted) throw error;
              retried = true;
              retryCount += 1;
              response = await reader.list(store, params, local);
            }
            for (const raw of response.products) {
              if (input.productUrl !== undefined && !sameProductUrl(raw.permalink, input.productUrl, store)) continue;
              const product = normalizeWooProduct(raw, store, timestamp());
              if (product === undefined) continue;
              if (product.productType === "variable") {
                if (!store.capabilities.variations) { truncated = true; result.reason = "UNSUPPORTED"; continue; }
                const children = await variants(store, raw, input.requirements ?? {}, local);
                collected.push(...children.products.filter((child) => eligibleProduct(child, input) && (urlSelection?.variationId === undefined || child.variationId === urlSelection.variationId)));
                truncated ||= children.truncated;
              } else if (urlSelection?.variationId === undefined && eligibleProduct(product, input)) collected.push(remember(product));
              if (collected.length >= input.limit) break;
            }
            if (response.totalPages <= page || collected.length >= input.limit || input.productUrl !== undefined) break;
            if (page === 2) truncated = true;
          }
          health.delete(store.merchantId);
          result.returned = collected.length;
          if (truncated) result.status = "PARTIAL";
        } catch (error) {
          const reason = error instanceof WooReadError ? error.reason : "UPSTREAM_UNAVAILABLE";
          result.status = collected.length > 0 ? "PARTIAL" : "UNAVAILABLE";
          result.reason = reason;
          result.returned = collected.length;
          truncated = true;
          if (["TIMEOUT", "UPSTREAM_UNAVAILABLE", "RATE_LIMITED", "ACCESS_DENIED", "SECURITY_REJECTED", "INVALID_RESPONSE"].includes(reason)) {
            recordFailure(store.merchantId, error);
          } else if (state !== undefined) state.probe = false;
        }
        return { result, products: collected, truncated };
      });
      const stores = outputs.map((output) => output.result);
      const succeeded = stores.filter((store) => store.status === "COMPLETE" || store.status === "PARTIAL").length;
      // Preserve bounded cross-merchant recall before the MCP applies shared ranking.
      const allProducts: WooProduct[] = [];
      for (let index = 0; outputs.some((output) => output.products[index] !== undefined); index += 1) {
        for (const output of outputs) if (output.products[index] !== undefined) allProducts.push(output.products[index]!);
      }
      const attempted = [...attemptedBefore, ...stores.filter((store) => store.requests > 0).map((store) => store.merchantId)];
      const result = WooSearchResultSchema.parse({
        source: "WOOCOMMERCE_STORE_API", schemaVersion: 1, registryVersion: registry.version, requestId: randomUUID(),
        status: eligible.length === 0 ? "NOT_CONFIGURED" : stores.length > 0 && stores.every((store) => store.status === "COMPLETE") ? "COMPLETE" : succeeded > 0 ? "PARTIAL" : "UNAVAILABLE",
        snapshotAt: timestamp(), products: allProducts.slice(0, input.limit), stores,
        diagnostics: { eligibleStores: eligible.length, plannedStores: planned.length, attemptedStores: stores.filter((store) => store.requests > 0).length,
          succeededStores: succeeded, failedStores: stores.filter((store) => store.status === "UNAVAILABLE").length,
          skippedStores: Math.max(0, eligible.length - planned.length) + stores.filter((store) => store.status === "SKIPPED").length,
          physicalRequests: limits.requests, responseBytes: limits.bytes, cacheHits: 0, elapsedMs: Math.max(0, now() - started),
          truncated: outputs.some((output) => output.truncated) || allProducts.length > input.limit,
          registryCoverageComplete: eligible.length > 0 && eligible.every((store) => stores.some((result) => result.merchantId === store.merchantId && result.status === "COMPLETE")) },
        ...(attempted.length >= 12 ? {} : { continuation: { registryVersion: registry.version, attemptedMerchantIds: [...new Set(attempted)] } })
      });
      if (result.status === "COMPLETE") {
        const bytes = Buffer.byteLength(JSON.stringify(result));
        cache.set(key, { expires: now() + 60_000, bytes, value: structuredClone(result) }); cacheBytes += bytes;
        while (cache.size > 2_000 || cacheBytes > 24 * 1024 * 1024) { const first = cache.keys().next().value!; cacheBytes -= cache.get(first)!.bytes; cache.delete(first); }
      }
      return result;
    },
    async lookup(value, options = {}) {
      const target = WooProductTargetSchema.parse(value);
      const base = { source: "WOOCOMMERCE_STORE_API" as const, registryVersion: registry.version };
      try {
        const store = merchant(target.merchantId);
        const limits = budget(options.signal);
        const parent = await reader.product(store, target.productId, limits);
        const raw = target.variationId === undefined ? parent : await reader.product(store, target.variationId, limits);
        const product = normalizeWooProduct(raw, store, timestamp(), target.variationId === undefined ? undefined : parent);
        health.delete(store.merchantId);
        return WooLookupResultSchema.parse({ ...base, status: product === undefined ? "UNSUPPORTED" : "FOUND", ...(product === undefined ? {} : { product: remember(product) }), checkedAt: timestamp() });
      } catch (error) {
        recordFailure(target.merchantId, error);
        return { ...base, status: error instanceof WooReadError && error.reason === "NOT_FOUND" ? "NOT_FOUND" : "UNAVAILABLE", checkedAt: timestamp() };
      }
    },
    async inspect(value, requirementsValue, options = {}) {
      const target = WooProductTargetSchema.parse(value);
      const requirements = WooVariantRequirementsSchema.parse(requirementsValue);
      const base = { source: "WOOCOMMERCE_STORE_API" as const, registryVersion: registry.version };
      try {
        const store = merchant(target.merchantId);
        const limits = budget(options.signal);
        const raw = await reader.product(store, target.productId, limits);
        if (target.variationId !== undefined) {
          const child = await reader.product(store, target.variationId, limits);
          if (normalizeWooProduct(child, store, timestamp(), raw) === undefined) throw new WooReadError("SECURITY_REJECTED");
        }
        const parent = normalizeWooProduct(raw, store, timestamp());
        if (parent === undefined) return { ...base, status: "UNSUPPORTED", products: [], checkedAt: timestamp(), truncated: false };
        const found = raw.type === "variable" ? await variants(store, raw, requirements, limits) : { products: wooMatchesRequirements(parent, requirements) ? [remember(parent)] : [], truncated: false };
        health.delete(store.merchantId);
        return WooInspectionResultSchema.parse({ ...base, status: found.truncated ? "PARTIAL" : "COMPLETE", parent: remember(parent), ...found, checkedAt: timestamp() });
      } catch (error) {
        recordFailure(target.merchantId, error);
        return { ...base, status: error instanceof WooReadError && error.reason === "UNSUPPORTED" ? "UNSUPPORTED" : "UNAVAILABLE", products: [], checkedAt: timestamp(), truncated: true };
      }
    },
    async image(merchantId, imageId, options = {}) {
      const store = merchant(merchantId, false);
      const record = images.get(imageId);
      if (record === undefined || record.merchantId !== merchantId) throw new WooReadError("SECURITY_REJECTED");
      const signal = options.signal === undefined ? AbortSignal.timeout(3_000) : AbortSignal.any([options.signal, AbortSignal.timeout(3_000)]);
      const release = await acquire(merchantId, signal);
      const request = dependencies.request ?? createPinnedRequest();
      try { return await safeFetch({ url: record.url }, { ...dependencies, allowedHosts: [new URL(store.origin).hostname, ...store.imageHosts], signal, maxResponseBytes: 5_000_000,
        request: async (target, init, addresses) => {
          if (target.href !== record.url) throw new Error("request blocked: Woo image redirects are not allowed");
          const response = await request(target, init, addresses);
          if ([301, 302, 303, 307, 308].includes(response.status)) { await response.body?.cancel(); throw new Error("request blocked: Woo image redirects are not allowed"); }
          return response;
        }
      }); }
      finally { release(); }
    }
  };
}

function eligibleProduct(product: WooProduct, input: WooSearchInput): boolean {
  return (input.includeOutOfStock === true || product.availability !== "OUT_OF_STOCK") &&
    (input.maxItemPriceCents === undefined || (product.itemPrice !== undefined && product.itemPrice.amountCents <= input.maxItemPriceCents)) &&
    wooMatchesRequirements(product, input.requirements ?? {});
}
function storeScore(store: WooMerchant, input: WooSearchInput): number {
  const text = `${input.query} ${input.brand ?? ""} ${input.productType ?? ""}`.toLowerCase();
  return [...store.brands, ...store.categories].reduce((score, value) => score + (text.includes(value.toLowerCase()) ? 1 : 0), 0);
}
function paramsForProductUrl(value: string): URLSearchParams {
  const url = new URL(value);
  const productId = url.searchParams.get("p");
  if (productId !== null && /^\d+$/u.test(productId)) return new URLSearchParams({ include: productId, per_page: "1" });
  const slug = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  return new URLSearchParams({ slug, per_page: "20" });
}
function selectionForProductUrl(value: string): { attributes: Record<string, string>; variationId?: number } {
  const attributes: Record<string, string> = {};
  let variationId: number | undefined;
  const url = new URL(value);
  const seen = new Set<string>();
  for (const [key, raw] of url.searchParams) {
    if (/^(?:utm_[a-z_]+|gclid|fbclid)$/u.test(key)) continue;
    if (seen.has(key)) throw new WooReadError("SECURITY_REJECTED");
    seen.add(key);
    if (key === "variation_id") {
      const id = Number(raw);
      if (!/^\d+$/u.test(raw) || !Number.isSafeInteger(id) || id <= 0) throw new WooReadError("SECURITY_REJECTED");
      variationId = id;
    } else if (/^attribute_(?:pa_)?[a-z][a-z0-9_-]{0,60}$/u.test(key) && raw.length > 0 && raw.length <= 300) {
      const name = key.replace(/^attribute_(?:pa_)?/u, "");
      const canonical = name === "colour" ? "color" : name;
      if (attributes[canonical] !== undefined && attributes[canonical]!.toLowerCase() !== raw.toLowerCase()) throw new WooReadError("SECURITY_REJECTED");
      attributes[canonical] = raw;
    } else if (key !== "p" || !/^\d+$/u.test(raw)) throw new WooReadError("SECURITY_REJECTED");
  }
  return { attributes, ...(variationId === undefined ? {} : { variationId }) };
}
function sameProductUrl(raw: string, target: string, store: WooMerchant): boolean {
  try { const a = new URL(raw, store.origin); const b = new URL(target); return a.pathname.replace(/\/$/u, "") === b.pathname.replace(/\/$/u, ""); } catch { return false; }
}
async function mapConcurrent<T, R>(values: T[], count: number, task: (value: T) => Promise<R>): Promise<R[]> {
  const result: R[] = []; let next = 0;
  await Promise.all(Array.from({ length: Math.min(count, values.length) }, async () => {
    while (next < values.length) { const index = next++; result[index] = await task(values[index]!); }
  }));
  return result;
}
function concurrencyGate(): (merchantId: string, signal: AbortSignal) => Promise<() => void> {
  let active = 0; const perStore = new Map<string, number>();
  const queue: Array<{ merchantId: string; signal: AbortSignal; resolve: (release: () => void) => void; reject: (reason: unknown) => void; abort: () => void }> = [];
  function drain() {
    for (let index = 0; index < queue.length && active < 12;) {
      const item = queue[index]!;
      if ((perStore.get(item.merchantId) ?? 0) >= 2) { index += 1; continue; }
      queue.splice(index, 1); item.signal.removeEventListener("abort", item.abort);
      active += 1; perStore.set(item.merchantId, (perStore.get(item.merchantId) ?? 0) + 1);
      item.resolve(() => { active -= 1; perStore.set(item.merchantId, perStore.get(item.merchantId)! - 1); drain(); });
    }
  }
  return async (merchantId, signal) => {
    signal.throwIfAborted();
    if (queue.length >= 256) throw new WooReadError("BUDGET_EXHAUSTED");
    return new Promise((resolve, reject) => {
      const item = { merchantId, signal, resolve, reject, abort: () => { const index = queue.indexOf(item); if (index >= 0) queue.splice(index, 1); reject(signal.reason); } };
      queue.push(item); signal.addEventListener("abort", item.abort, { once: true }); drain();
    });
  };
}
