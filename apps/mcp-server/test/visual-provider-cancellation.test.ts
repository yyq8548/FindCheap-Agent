import { describe, expect, it, vi } from "vitest";
import { createAwinFeedPort } from "../../../packages/awin-feed/src/index.js";
import { createEbayPortFromEnvironment } from "../src/ebay-client.js";
import { createShopifyGlobalCatalogPort } from "../src/shopify-global-catalog-client.js";

describe("visual search provider cancellation", () => {
  const factories = [
    ["Shopify", (fetch: typeof globalThis.fetch) => createShopifyGlobalCatalogPort({ SHOPIFY_AGENT_PROFILE_URL: "https://findcheap.example/profile.json" }, { fetch })],
    ["eBay", (fetch: typeof globalThis.fetch) => createEbayPortFromEnvironment({ EBAY_PRODUCT_SEARCH_URL: "https://findcheap.example/v1/ebay/search" }, { fetch })!],
    ["Awin", (fetch: typeof globalThis.fetch) => createAwinFeedPort({ AWIN_PRODUCT_SEARCH_URL: "https://findcheap.example/v1/search" }, { fetch })]
  ] as const;

  it.each(factories)("%s never starts an already cancelled request", async (_name, create) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const controller = new AbortController();
    controller.abort();
    await expect(create(fetch).search({ query: "black dress", limit: 3, signal: controller.signal })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(factories)("%s forwards parent cancellation and never retries it", async (_name, create) => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      requestSignal = init?.signal ?? undefined;
      controller.abort(new Error("caller cancelled"));
      requestSignal?.throwIfAborted();
      throw new Error("should have been cancelled");
    });
    await expect(create(fetch).search({ query: "black dress", limit: 3, signal: controller.signal })).rejects.toThrow();
    expect(requestSignal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[1]?.body)).not.toContain('"signal"');
  });

  it.each(factories)("%s cancels a stalled response body", async (_name, create) => {
    const controller = new AbortController();
    const cancelled = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new ReadableStream({
      start(stream) { stream.enqueue(new TextEncoder().encode("{")); }, cancel: cancelled
    }), { headers: { "content-type": "application/json" } }));
    const pending = create(fetch).search({ query: "black dress", limit: 3, signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort(new Error("caller cancelled"));
    await rejected;
    expect(cancelled).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
