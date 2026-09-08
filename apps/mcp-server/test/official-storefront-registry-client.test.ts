import { afterEach, describe, expect, it, vi } from "vitest";

import { replaceManagedOfficialStorefronts, resolveVerifiedOfficialStorefront } from "../src/merchant-trust.js";
import { createOfficialStorefrontRegistryPortFromEnvironment } from "../src/official-storefront-registry-client.js";

afterEach(() => replaceManagedOfficialStorefronts([]));

describe("managed official storefront registry", () => {
  it("cancels only the caller, leaving the bounded shared refresh and cache for other callers", async () => {
    let finish!: (response: Response) => void;
    let sourceSignal: AbortSignal | undefined;
    const fetchRequest = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      sourceSignal = init?.signal ?? undefined;
      return new Promise<Response>(resolve => { finish = resolve; });
    });
    const port = createOfficialStorefrontRegistryPortFromEnvironment({ AWIN_PRODUCT_SEARCH_URL: "https://findcheap.example/v1/search" },
      { fetch: fetchRequest as typeof fetch });
    const parent = new AbortController();
    const cancelled = port!.refresh({ signal: parent.signal });
    const rejected = expect(cancelled).rejects.toThrow();
    const other = port!.refresh();
    parent.abort();
    finish(new Response(null, { status: 304 }));
    await rejected;
    await other;
    expect(sourceSignal?.aborted).toBe(false);
    await port!.refresh();
    expect(fetchRequest).toHaveBeenCalledOnce();
    await expect(port!.refresh({ signal: parent.signal })).rejects.toThrow();
  });

  it("does not dispatch for an already cancelled caller", async () => {
    const fetchRequest = vi.fn(async () => new Response(null, { status: 304 }));
    const port = createOfficialStorefrontRegistryPortFromEnvironment({ AWIN_PRODUCT_SEARCH_URL: "https://findcheap.example/v1/search" },
      { fetch: fetchRequest as typeof fetch });
    const parent = new AbortController(); parent.abort();
    await expect(port!.refresh({ signal: parent.signal })).rejects.toThrow();
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it.each(["SHOPIFY", "WOOCOMMERCE"])("loads a bounded %s registry and revalidates it with ETag", async platform => {
    let now = 1_000;
    let requests = 0;
    const fetchRequest = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requests += 1;
      expect(new Headers(init?.headers).get("x-findcheap-registry-schema")).toBe("2");
      if (requests === 2) {
        expect(new Headers(init?.headers).get("if-none-match")).toBe('"registry-v1"');
        return new Response(null, { status: 304 });
      }
      return new Response(JSON.stringify({
        version: "managed-v1",
        stores: [{
          brand: "Managed Brand",
          aliases: ["Managed Alias"],
          officialHost: "managed.example",
          storefrontHost: "shop.managed.example",
          platform,
          productPathPrefixes: ["/products/"],
          imageHosts: ["cdn.shopify.com"],
          evidenceUrl: "https://managed.example/",
          reviewedAt: "2026-08-28",
          status: "APPROVED"
        }]
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          etag: '"registry-v1"'
        }
      });
    });
    const port = createOfficialStorefrontRegistryPortFromEnvironment({
      AWIN_PRODUCT_SEARCH_URL: "https://findcheap.example/v1/search"
    }, {
      fetch: fetchRequest as typeof fetch,
      now: () => now,
      cacheMs: 1_000
    });
    expect(port).toBeDefined();

    await port!.refresh();
    expect(resolveVerifiedOfficialStorefront("Managed Alias")).toMatchObject({
      host: "shop.managed.example",
      brand: "Managed Brand",
      platform
    });
    await port!.refresh();
    expect(fetchRequest).toHaveBeenCalledOnce();

    now = 2_001;
    await port!.refresh();
    expect(fetchRequest).toHaveBeenCalledTimes(2);
  });

  it("rejects credentialed or non-HTTPS managed registry URLs", () => {
    expect(() => createOfficialStorefrontRegistryPortFromEnvironment({
      FINDCHEAP_OFFICIAL_STOREFRONTS_URL: "http://findcheap.example/v1/official-storefronts"
    })).toThrow("credential-free HTTPS");
    expect(() => createOfficialStorefrontRegistryPortFromEnvironment({
      FINDCHEAP_OFFICIAL_STOREFRONTS_URL: "https://user:pass@findcheap.example/v1/official-storefronts"
    })).toThrow("credential-free HTTPS");
  });
});
