import { afterEach, describe, expect, it, vi } from "vitest";

import {
  currentMerchantTrustRegistryVersion,
  resetManagedMerchantTrustRecords,
  resolveMerchantTrust
} from "../src/merchant-trust.js";
import { createMerchantTrustRegistryPortFromEnvironment } from "../src/merchant-trust-registry-client.js";

afterEach(() => resetManagedMerchantTrustRecords());

describe("managed merchant trust registry", () => {
  it("loads an authoritative bounded registry and revalidates it with ETag", async () => {
    let now = 1_000;
    let requests = 0;
    const fetchRequest = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requests += 1;
      if (requests === 2) {
        expect(new Headers(init?.headers).get("if-none-match")).toBe('"trust-v1"');
        return new Response(null, { status: 304 });
      }
      return new Response(JSON.stringify({
        version: "managed-trust-v1",
        merchants: [{
          host: "managed.example",
          level: "AUTHORIZED_RETAILER",
          evidenceUrl: "https://managed.example/evidence",
          reviewedAt: "2026-08-28",
          status: "APPROVED"
        }]
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          etag: '"trust-v1"'
        }
      });
    });
    const port = createMerchantTrustRegistryPortFromEnvironment({
      AWIN_PRODUCT_SEARCH_URL: "https://findcheap.example/v1/search"
    }, {
      fetch: fetchRequest as typeof fetch,
      now: () => now,
      cacheMs: 1_000
    });

    await port!.refresh();
    expect(resolveMerchantTrust("managed.example")).toMatchObject({
      level: "AUTHORIZED_RETAILER",
      verification: "INDEPENDENT"
    });
    expect(currentMerchantTrustRegistryVersion()).toBe("managed-trust-v1");
    expect(resolveMerchantTrust("bestbuy.com")).toMatchObject({
      level: "UNKNOWN",
      verification: "UNVERIFIED"
    });
    await port!.refresh();
    expect(fetchRequest).toHaveBeenCalledOnce();

    now = 2_001;
    await port!.refresh();
    expect(fetchRequest).toHaveBeenCalledTimes(2);
  });

  it("keeps the last valid registry when a later response is invalid", async () => {
    let now = 1_000;
    let requests = 0;
    const port = createMerchantTrustRegistryPortFromEnvironment({
      FINDCHEAP_MERCHANT_TRUST_URL: "https://findcheap.example/v1/merchant-trust"
    }, {
      fetch: vi.fn(async () => {
        requests += 1;
        return requests === 1
          ? new Response(JSON.stringify({
              version: "managed-trust-v1",
              merchants: [{
                host: "managed.example",
                level: "ESTABLISHED_RETAILER",
                evidenceUrl: "https://managed.example/",
                reviewedAt: "2026-08-28",
                status: "APPROVED"
              }]
            }), { status: 200, headers: { "content-type": "application/json" } })
          : new Response(JSON.stringify({ version: "bad", merchants: [] }), {
              status: 200,
              headers: { "content-type": "application/json" }
            });
      }) as typeof fetch,
      now: () => now,
      cacheMs: 1_000
    });

    await port!.refresh();
    now = 2_001;
    await port!.refresh();
    expect(resolveMerchantTrust("managed.example").level).toBe("ESTABLISHED_RETAILER");
  });

  it("rejects credentialed or non-HTTPS managed registry URLs", () => {
    expect(() => createMerchantTrustRegistryPortFromEnvironment({
      FINDCHEAP_MERCHANT_TRUST_URL: "http://findcheap.example/v1/merchant-trust"
    })).toThrow("credential-free HTTPS");
    expect(() => createMerchantTrustRegistryPortFromEnvironment({
      FINDCHEAP_MERCHANT_TRUST_URL: "https://user:pass@findcheap.example/v1/merchant-trust"
    })).toThrow("credential-free HTTPS");
  });
});
