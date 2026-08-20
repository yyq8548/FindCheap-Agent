import { describe, expect, it, vi } from "vitest";
import { createDealPortFromEnvironment, hasDealProviderConfiguration } from "../src/deal-client.js";

const deal = {
  dealId: "coupon-1",
  merchant: "Merchant",
  kind: "OFFLINE_BARCODE",
  title: "Store coupon",
  description: "Show barcode in store",
  barcodeUrl: "https://merchant.example/coupon/barcode",
  discountAmountCents: 500,
  eligibility: [],
  channels: ["IN_STORE"],
  sourceUrl: "https://merchant.example/coupons/1",
  checkedAt: "2026-08-18T11:00:00.000Z",
  validFrom: "2026-08-18T00:00:00.000Z",
  validTo: "2026-08-19T00:00:00.000Z",
  verificationStatus: "VERIFIED"
};

describe("Deals API client", () => {
  it("uses a bounded authenticated HTTPS request and filters by channel", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ deals: [deal] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const port = createDealPortFromEnvironment({
      FINDCHEAP_DEALS_API_URL: "https://deals.example/v1/search",
      FINDCHEAP_DEALS_API_TOKEN: "secret"
    }, fetcher as typeof fetch, () => new Date("2026-08-18T12:00:00.000Z"));
    const result = await port.search({ merchant: "Merchant", membershipIds: [], channel: "IN_STORE" });
    expect(result).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith(new URL("https://deals.example/v1/search"), expect.objectContaining({
      method: "POST", redirect: "error", headers: expect.objectContaining({ authorization: "Bearer secret" })
    }));
  });

  it("fails closed for non-HTTPS configuration and malformed evidence", async () => {
    await expect(createDealPortFromEnvironment({ FINDCHEAP_DEALS_API_URL: "http://deals.example", FINDCHEAP_DEALS_API_TOKEN: "secret" })
      .search({ merchant: "Merchant", membershipIds: [], channel: "ANY" })).rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
    const port = createDealPortFromEnvironment({ FINDCHEAP_DEALS_API_URL: "https://deals.example", FINDCHEAP_DEALS_API_TOKEN: "secret" },
      (async () => new Response(JSON.stringify({ deals: [{ ...deal, verificationStatus: "UNVERIFIED" }] }))) as typeof fetch);
    await expect(port.search({ merchant: "Merchant", membershipIds: [], channel: "ANY" })).rejects.toThrow();
  });

  it("stops reading a chunked response above 512 KiB", async () => {
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(300_000));
        controller.enqueue(new Uint8Array(300_000));
        controller.close();
      }
    });
    const port = createDealPortFromEnvironment({ FINDCHEAP_DEALS_API_URL: "https://deals.example", FINDCHEAP_DEALS_API_TOKEN: "secret" },
      (async () => new Response(oversized, { headers: { "content-type": "application/json" } })) as typeof fetch);
    await expect(port.search({ merchant: "Merchant", membershipIds: [], channel: "ANY" })).rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
  });

  it("exposes Deals capability only for a complete safe configuration", () => {
    expect(hasDealProviderConfiguration({})).toBe(false);
    expect(hasDealProviderConfiguration({ FINDCHEAP_DEALS_API_URL: "https://deals.example" })).toBe(false);
    expect(hasDealProviderConfiguration({
      FINDCHEAP_DEALS_API_URL: "http://deals.example",
      FINDCHEAP_DEALS_API_TOKEN: "secret"
    })).toBe(false);
    expect(hasDealProviderConfiguration({
      FINDCHEAP_DEALS_API_URL: "https://deals.example/v1/search",
      FINDCHEAP_DEALS_API_TOKEN: "secret"
    })).toBe(true);
  });
});
