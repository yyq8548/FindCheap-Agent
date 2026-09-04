import { describe, expect, it, vi } from "vitest";
import {
  VerifiedDealSchema,
  createDealPortFromEnvironment,
  estimatedItemPriceAfterCoupon,
  hasDealProviderConfiguration
} from "../src/deal-client.js";

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
    expect(hasDealProviderConfiguration({
      AWIN_OFFERS_SEARCH_URL: "https://findcheap-agent-production.up.railway.app/v1/offers/search"
    })).toBe(true);
    expect(hasDealProviderConfiguration({
      AWIN_OFFERS_SEARCH_URL: "https://findcheap-agent-production.up.railway.app/not-offers"
    })).toBe(false);
  });

  it("uses the public Awin Offers endpoint without exposing a publisher token", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ deals: [
      {
        ...deal,
        kind: "PROMO_CODE",
        code: "SAVE10",
        channels: ["ONLINE"],
        sourceUrl: "https://www.awin1.com/cread.php?awinmid=99&awinaffid=3047955"
      }
    ] }), { headers: { "content-type": "application/json" } }));
    const port = createDealPortFromEnvironment({
      AWIN_OFFERS_SEARCH_URL: "https://findcheap-agent-production.up.railway.app/v1/offers/search"
    }, fetcher as typeof fetch, () => new Date("2026-08-18T12:00:00.000Z"));

    await expect(port.search({ merchant: "Merchant", membershipIds: [], channel: "ONLINE" })).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://findcheap-agent-production.up.railway.app/v1/offers/search"),
      expect.objectContaining({ headers: expect.not.objectContaining({ authorization: expect.anything() }) })
    );
  });

  it("requires a stable product ID before calculating an after-Coupon price", () => {
    const confirmed = {
      ...deal,
      kind: "PROMO_CODE",
      code: "SAVE20",
      channels: ["ONLINE"],
      productApplicability: "PRODUCT_CONFIRMED",
      applicableProductIds: ["sku-1"],
      discountAmountCents: undefined,
      discountPercent: 20,
      eligibility: []
    };
    expect(VerifiedDealSchema.safeParse({ ...confirmed, applicableProductIds: undefined }).success).toBe(false);
    const parsed = VerifiedDealSchema.parse(confirmed);

    expect(estimatedItemPriceAfterCoupon(1_200, [parsed], "sku-1")).toBe(960);
    expect(estimatedItemPriceAfterCoupon(1_200, [parsed], "other-sku")).toBeUndefined();
    expect(estimatedItemPriceAfterCoupon(1_200, [{
      ...parsed,
      productApplicability: "MERCHANT_WIDE"
    }], "sku-1")).toBeUndefined();
    expect(estimatedItemPriceAfterCoupon(1_200, [{
      ...parsed,
      discountAmountCents: 500
    }], "sku-1")).toBeUndefined();
  });
});
