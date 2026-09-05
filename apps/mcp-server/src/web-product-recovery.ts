import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { safeFetchWithProvenance } from "../../../packages/network-safety/src/safe-fetch.js";
import { parseWebProductDocument } from "./generic-official-store-search.js";
import type { SearchProductsInput } from "./search-products.js";
import type { ShopifyProduct } from "./shopify-client.js";
import { functionalQueryFeatures } from "./functional-requirements.js";

export const WEB_SEARCH_LIMITS = { durationMs: 60_000, merchantPages: 5, results: 3, discoveryQueries: 2 } as const;
const blockedHosts = ["google.com", "bing.com", "duckduckgo.com", "yahoo.com", "t.co", "bit.ly", "tinyurl.com"];

export function webProductUrl(value: string): string {
  const url = new URL(value);
  const path = decodeURIComponent(url.pathname);
  // eslint-disable-next-line no-control-regex -- URL normalization must not hide control characters.
  if (/[\u0000-\u0020\\]/u.test(value) || /[%\\]/u.test(path) || url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
    !url.hostname.includes(".") || url.hostname.endsWith(".") || isIP(url.hostname.replace(/^\[|\]$/gu, "")) ||
    path === "/" || /(?:^|\/)(?:search|collections?|categories|cart|checkout|accounts?|login|logout|admin|api)(?:\/|$)/iu.test(path) ||
    blockedHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) ||
    [...url.searchParams.keys()].some(key => !["variant", "size", "color", "type"].includes(key)) ||
    [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) throw new Error("WEB_URL_REJECTED");
  return url.href;
}

export const WebProductUrlSchema = z.string().max(4096).refine(value => {
  try { webProductUrl(value); return true; } catch { return false; }
}, "Use an exact credential-free HTTPS merchant product URL");

export type WebProductPagePort = { read(url: string, request: SearchProductsInput, signal: AbortSignal): Promise<ShopifyProduct> };
export function createWebProductPagePort(fetchPage = safeFetchWithProvenance): WebProductPagePort {
  return { async read(value, request, signal) {
    const url = webProductUrl(value);
    let requests = 0;
    const fetched = await fetchPage({ url }, { allowedHosts: [new URL(url).hostname], signal,
      maxResponseBytes: 1024 * 1024, onRead: delta => {
        requests += delta.requests ?? 0;
        if (requests > 1) throw new Error("WEB_REDIRECT_REJECTED");
      } });
    if (!fetched.response.ok || fetched.finalUrl !== url ||
      !/^text\/html(?:;|$)/iu.test(fetched.response.headers.get("content-type") ?? "")) throw new Error("WEB_PAGE_UNAVAILABLE");
    const bytes = new Uint8Array(await fetched.response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 1024 * 1024) throw new Error("WEB_PAGE_UNAVAILABLE");
    // Exact URL binds the offer; all requested colors (including disjunctions)
    // are evaluated by the shared requirement gate after parsing.
    return parseWebProductDocument(new TextDecoder("utf-8", { fatal: true }).decode(bytes), url, new Date(), request.requiredSize);
  } };
}

type Lease = { token: string; deadline: number; state: "PENDING" | "DENIED" | "READY" | "USED" };
/** One consent and one admission per immutable snapshot. Never accept a
 * model-supplied boolean as permission; approval comes from the host UI. */
export class WebRecoverySessions {
  readonly #leases = new Map<string, Lease>();
  constructor(private readonly now: () => number = Date.now) {}
  forget(renderId: string): void { this.#leases.delete(renderId); }
  async begin(renderId: string, approve: () => Promise<boolean>): Promise<Lease | undefined> {
    if (this.#leases.has(renderId) || this.#leases.size >= 64) return undefined;
    const lease: Lease = { token: randomUUID(), deadline: 0, state: "PENDING" };
    this.#leases.set(renderId, lease);
    let approved = false;
    try { approved = await approve(); } catch { /* Missing host permission fails closed. */ }
    if (!approved) { lease.state = "DENIED"; return undefined; }
    if (this.#leases.get(renderId) !== lease) return undefined;
    lease.state = "READY";
    lease.deadline = this.now() + WEB_SEARCH_LIMITS.durationMs;
    return { ...lease };
  }
  consume(renderId: string, token: string): number | undefined {
    const lease = this.#leases.get(renderId);
    if (lease?.state !== "READY" || lease.token !== token) return undefined;
    lease.state = "USED";
    const remaining = lease.deadline - this.now();
    return remaining > 0 ? remaining : undefined;
  }
}

export function webSearchQueries(request: SearchProductsInput): string[] {
  const identity = [request.brand, request.query].filter(Boolean).join(" ");
  const features = functionalQueryFeatures(request.requiredFeatures);
  return [...new Set([`${identity} ${features.join(" ")}`, `${identity} ${request.requiredFeatures.map(value =>
    functionalQueryFeatures([value])[0] ?? value).join(" ")}`].map(value => value.replace(/\s+/gu, " ").trim().slice(0, 300)))];
}

export async function readWebCandidates(urls: readonly string[], request: SearchProductsInput, port: WebProductPagePort,
  durationMs: number): Promise<{ products: ShopifyProduct[]; rejected: number; unavailable: number }> {
  if (urls.length > WEB_SEARCH_LIMITS.merchantPages) throw new Error("WEB_PAGE_LIMIT");
  const distinct = new Map<string, string>();
  for (const value of urls) { const url = webProductUrl(value); const host = new URL(url).hostname;
    if (!distinct.has(host)) distinct.set(host, url); }
  const selected = [...distinct.values()];
  const controller = new AbortController();
  // Leave response time inside the plugin's 30-second per-tool host deadline.
  const timeout = setTimeout(() => controller.abort(), Math.min(durationMs, 25_000));
  const products: Array<ShopifyProduct | undefined> = Array.from({ length: selected.length });
  let unavailable = 0;
  try {
    // Count at most five explicit pages, two concurrent reads. An adapter that
    // ignores abort cannot extend this lease or mutate the returned snapshot.
    let next = 0;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (next < selected.length && !controller.signal.aborted) {
        const index = next++;
        const url = selected[index]!;
        let onAbort: (() => void) | undefined;
        try {
          const value = await Promise.race([port.read(url, request, controller.signal), new Promise<never>((_, reject) => {
            if (controller.signal.aborted) reject(new Error("WEB_TIMEOUT"));
            else { onAbort = () => reject(new Error("WEB_TIMEOUT")); controller.signal.addEventListener("abort", onAbort, { once: true }); }
          })]);
          if (value.sourceHost !== new URL(url).hostname || value.merchantUrl !== url || value.sourceKind !== "WEB_PRODUCT_PAGE") {
            throw new Error("WEB_IDENTITY_MISMATCH");
          }
          products[index] = value;
        } catch { unavailable++; }
        finally { if (onAbort !== undefined) controller.signal.removeEventListener("abort", onAbort); }
      }
    }));
    unavailable += selected.length - next;
  } finally { clearTimeout(timeout); }
  return { products: products.filter((value): value is ShopifyProduct => value !== undefined), rejected: urls.length - selected.length, unavailable };
}
