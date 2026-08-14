import { describe, expect, it, vi } from "vitest";

import type { Database } from "../../../packages/db/src/client.js";
import { createCurrentOfferStore } from "../src/current-offer-store.js";

const now = new Date("2026-08-13T12:00:00.000Z");

describe("current Commerce store bounds", () => {
  it("does not query promoted data when the audited allowlist is empty", async () => {
    const query = vi.fn();
    const store = createCurrentOfferStore({ query } as unknown as Database, new Set());
    await expect(store.search("Acme Model-1", now)).resolves.toMatchObject({
      status: "NEEDS_CLARIFICATION"
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("fails closed instead of truncating a product with too many current offers", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [productRow()] })
      .mockResolvedValueOnce({ rows: Array.from({ length: 51 }, (_, index) => offerRow(index)) });
    const store = createCurrentOfferStore(
      { query } as unknown as Database,
      new Set(["approved-shop"])
    );
    await expect(store.search("Acme Model-1", now)).resolves.toEqual({
      status: "NEEDS_CLARIFICATION",
      questions: ["Too many current offers match this product; comparison is temporarily unavailable."]
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not let a later disabled merchant read a previously eligible database", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [productRow()] })
      .mockResolvedValueOnce({ rows: [offerRow(1)] });
    const enabled = createCurrentOfferStore(
      { query } as unknown as Database,
      new Set(["approved-shop"])
    );
    await enabled.search("Acme Model-1", now);
    const callsBeforeDisable = query.mock.calls.length;

    const disabled = createCurrentOfferStore({ query } as unknown as Database, new Set());
    await disabled.search("Acme Model-1", now);
    expect(query).toHaveBeenCalledTimes(callsBeforeDisable);
  });
});

function productRow() {
  return {
    id: "product-1",
    brand: "Acme",
    manufacturer_part_number: "Model-1",
    gtins: ["12345678"],
    title: "Acme Model",
    category_path: ["Widgets"],
    attributes: [],
    variant_dimensions: {}
  };
}

function offerRow(index: number) {
  return {
    offer_id: `offer-${index}`,
    merchant_id: "approved-shop",
    promotion_decision_id: `promotion-${index}`,
    revision: "1",
    seller_name: "Approved Shop",
    merchant_url: `https://approved-shop.example/items/${index}`
  };
}
