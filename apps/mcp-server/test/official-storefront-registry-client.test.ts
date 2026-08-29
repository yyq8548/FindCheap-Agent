import { afterEach, describe, expect, it, vi } from "vitest";

import { replaceManagedOfficialStorefronts, resolveVerifiedOfficialStorefront } from "../src/merchant-trust.js";
import { createOfficialStorefrontRegistryPortFromEnvironment } from "../src/official-storefront-registry-client.js";

afterEach(() => replaceManagedOfficialStorefronts([]));

describe("managed official storefront registry", () => {
  it("loads one bounded registry and revalidates it with ETag", async () => {
    let now = 1_000;
    let requests = 0;
    const fetchRequest = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requests += 1;
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
          platform: "SHOPIFY",
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
      platform: "SHOPIFY"
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
