import { describe, expect, it } from "vitest";
import type { MerchantAdapter, MerchantProductCandidate } from "../src/index.js";
import { runMerchantContractSuite } from "../src/index.js";

const fixtureContext = () => ({
  search: { query: "wireless headphones", limit: 5 }
});

const validOffer = (): MerchantProductCandidate => ({
  merchantId: "merchant-a",
  merchantProductId: "sku-1",
  title: "Wireless Headphones",
  gtins: ["12345678"],
  variantDimensions: { color: "black" },
  currency: "USD",
  merchantUrl: "https://merchant.example/products/sku-1",
  evidenceRefs: ["evidence-1"],
  checkedAt: "2026-08-13T12:00:00.000Z",
  expiresAt: "2026-08-13T12:15:00.000Z"
});

const adapterWith = (offers: MerchantProductCandidate[]): MerchantAdapter => ({
  merchantId: "merchant-a",
  searchProducts: async () => offers,
  getOffer: async () => null,
  quoteDeliveredPrice: async () => ({
    merchantProductId: "sku-1",
    itemPriceCents: 1000,
    shippingCents: 0,
    taxCents: 0,
    mandatoryFeeCents: 0,
    currency: "USD",
    status: "ESTIMATED",
    conditions: [],
    evidenceRefs: ["evidence-1"],
    checkedAt: "2026-08-13T12:00:00.000Z",
    expiresAt: "2026-08-13T12:15:00.000Z"
  }),
  getCoupons: async () => [],
  buildAffiliateLink: async () => ({
    url: "https://merchant.example/products/sku-1",
    kind: "NORMAL"
  }),
  refreshProduct: async () => ({
    merchantProductId: "sku-1",
    sourceUrl: "https://merchant.example/products/sku-1",
    rawEvidence: "{}",
    metadata: {},
    checkedAt: "2026-08-13T12:00:00.000Z"
  }),
  healthCheck: async () => ({
    status: "healthy",
    source: "feed",
    checkedAt: "2026-08-13T12:00:00.000Z"
  }),
  evidence: async () => []
});

describe("merchant adapter contract suite", () => {
  it("rejects offers without evidence and freshness", async () => {
    const invalidOffer = {
      ...validOffer(),
      evidenceRefs: [],
      expiresAt: "2026-08-13T12:00:00.000Z",
      currency: "CAD"
    } as unknown as MerchantProductCandidate;
    const report = await runMerchantContractSuite(
      () => adapterWith([invalidOffer]),
      fixtureContext()
    );

    expect(report.failures).toContain("offer evidenceRefs must not be empty");
    expect(report.failures).toContain("expiresAt must be after checkedAt");
    expect(report.failures).toContain("currency must be USD");
  });

  it("accepts a valid adapter", async () => {
    const report = await runMerchantContractSuite(() => adapterWith([validOffer()]), fixtureContext());

    expect(report).toEqual({ merchantId: "merchant-a", failures: [] });
  });

  it("fails closed for ambiguous timestamps", async () => {
    const report = await runMerchantContractSuite(
      () => adapterWith([{ ...validOffer(), checkedAt: "2026-08-13T12:00:00" }]),
      fixtureContext()
    );

    expect(report.failures).toContain("expiresAt must be after checkedAt");
  });
});
