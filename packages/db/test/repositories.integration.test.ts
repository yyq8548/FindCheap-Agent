import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/client.js";
import { createOfferRepository } from "../src/repositories/offer-repository.js";
import { createProductRepository } from "../src/repositories/product-repository.js";
import type { StoredCoupon, StoredEvidence, StoredMerchantOffer, StoredPriceQuote } from "../src/schema.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://shopping:local-only@127.0.0.1:5432/shopping";
const db = createDatabase(databaseUrl);
const products = createProductRepository(db);
const offers = createOfferRepository(db);
const now = new Date("2026-08-13T12:00:00.000Z");

const product = {
  productId: "product-1",
  brand: "Acme",
  manufacturerPartNumber: "MODEL-1",
  gtins: ["12345678"],
  title: "Acme Model 1",
  categoryPath: ["Home", "Widgets"],
  attributes: [],
  variantDimensions: { color: "black" }
};

const offer: StoredMerchantOffer = {
  offerId: "offer-1",
  merchantId: "merchant-1",
  merchantProductId: "sku-1",
  productId: "product-1",
  sellerName: "Acme Store",
  condition: "NEW",
  matchStatus: "EXACT",
  inventoryStatus: "IN_STOCK",
  merchantUrl: "https://merchant.example/products/sku-1",
  evidenceRefs: ["evidence-1"],
  matchEvidence: [{ type: "GTIN", gtin: "12345678", source: "MERCHANT_PAGE" }],
  checkedAt: now,
  expiresAt: new Date(now.getTime() + 10 * 60_000)
};

const fixtureQuote = (overrides: Partial<StoredPriceQuote> = {}): StoredPriceQuote => ({
  quoteId: "quote-1",
  offerId: "offer-1",
  zipCode: "10001",
  membershipContext: { tier: "none" },
  status: "VERIFIED",
  deliveredPrice: { amountCents: 1299, currency: "USD" as const },
  lineItems: [{ kind: "ITEM", amount: { amountCents: 1299, currency: "USD" as const }, label: "Item" }],
  eligibilityConditions: [],
  evidenceRefs: ["evidence-1"],
  checkedAt: now,
  expiresAt: new Date(now.getTime() + 5 * 60_000),
  ...overrides
});

describe("commerce repositories", () => {
  beforeAll(async () => {
    await db.connect();
  });

  beforeEach(async () => {
    await db.query("TRUNCATE TABLE price_quotes, coupons, merchant_offers, evidence, products CASCADE");
    await products.upsert(product);
    await offers.saveEvidence({
      evidenceId: "evidence-1",
      merchantId: "merchant-1",
      sourceUrl: "https://merchant.example/products/sku-1",
      sourceType: "MERCHANT_PAGE",
      contentHash: "sha256:abc",
      capturedAt: now,
      metadata: { selector: "#price" }
    } satisfies StoredEvidence);
    await offers.saveOffer(offer);
  });

  afterAll(async () => {
    await db.close();
  });

  it("stores quote evidence and returns only unexpired offers", async () => {
    await offers.saveQuote(fixtureQuote({ quoteId: "q1", expiresAt: new Date(now.getTime() + 5 * 60_000) }));
    await offers.saveQuote(fixtureQuote({
      quoteId: "q2",
      checkedAt: new Date(now.getTime() - 10 * 60_000),
      expiresAt: new Date(now.getTime() - 60_000)
    }));

    const rows = await offers.findComparableOffers("product-1", now);

    expect(rows.map((row) => row.quoteId)).toEqual(["q1"]);
    expect(rows[0]?.evidenceRefs).toEqual(["evidence-1"]);
  });

  it("upserts canonical products and merchant offers", async () => {
    await products.upsert({ ...product, title: "Acme Model 1 Updated" });
    await offers.saveOffer({ ...offer, sellerName: "Acme Outlet" });

    const result = await db.query<{ title: string; seller_name: string }>(
      "SELECT p.title, o.seller_name FROM products p JOIN merchant_offers o ON o.product_id = p.id WHERE p.id = $1",
      [product.productId]
    );

    expect(result.rows).toEqual([{ title: "Acme Model 1 Updated", seller_name: "Acme Outlet" }]);
  });

  it("persists coupons with their expiry and evidence references", async () => {
    await offers.saveCoupon({
      couponId: "coupon-1",
      merchantId: "merchant-1",
      code: "SAVE10",
      discountRule: { type: "PERCENT", value: 10 },
      eligibility: { minimumCents: 1000 },
      stackingRule: "NOT_STACKABLE",
      verificationStatus: "VERIFIED",
      evidenceRefs: ["evidence-1"],
      validFrom: now,
      validTo: new Date(now.getTime() + 60 * 60_000)
    } satisfies StoredCoupon);

    const result = await db.query<{ code: string; evidence_refs: string[] }>(
      "SELECT code, evidence_refs FROM coupons WHERE id = $1",
      ["coupon-1"]
    );

    expect(result.rows).toEqual([{ code: "SAVE10", evidence_refs: ["evidence-1"] }]);
  });
});
