import { describe, expect, it } from "vitest";
import { assessQualityEvidence, comparableSameProduct, comparableUnitPrices, costAdvantage, unitPriceEvidence } from "../src/product-value-evidence.js";

const shampoo = { title: "Hydrating Shampoo 250 mL", productType: "shampoo", condition: "NEW" as const,
  itemPrice: { amountCents: 2000, currency: "USD" as const }, variantDimensions: {} };

describe("bounded cost and quality evidence", () => {
  it("normalizes explicit volume and count, recording source evidence", () => {
    expect(unitPriceEvidence(shampoo)).toMatchObject({ amountCents: 800, currency: "USD", perQuantity: 100, unit: "ML", quantity: 250, source: "TITLE", sourceText: "250 mL" });
    expect(unitPriceEvidence({ ...shampoo, title: "Shampoo 0.5 L" })).toMatchObject({ amountCents: 400, quantity: 500 });
    expect(unitPriceEvidence({ ...shampoo, title: "Coffee pods", variantDimensions: { "Pack Size": "10 count" } }))
      .toMatchObject({ amountCents: 200, perQuantity: 1, unit: "ITEM", quantity: 10, source: "VARIANT" });
    expect(unitPriceEvidence({ ...shampoo, title: "洗发露 500 毫升" })).toMatchObject({ amountCents: 400, quantity: 500 });
  });

  it.each(["Shampoo + Conditioner bundle 250 mL", "Shampoo and conditioner 250 mL", "Shampoo 2 x 250 mL", "Shampoo 250 mL 2 pack", "Shampoo 0 mL", "Shampoo 8 oz", "Shampoo 1000001 mL"])(
    "does not invent unit cost for ambiguous or invalid %s", title => expect(unitPriceEvidence({ ...shampoo, title })).toBeUndefined());

  it("rejects conflicting title and selected variant quantities", () => {
    expect(unitPriceEvidence({ ...shampoo, variantDimensions: { Volume: "500 mL" } })).toBeUndefined();
  });

  it("compares same-family new products per unit, not incomparable packages or conditions", () => {
    const large = { ...shampoo, title: "Shampoo 500 mL", itemPrice: { amountCents: 3000, currency: "USD" as const } };
    expect(costAdvantage(large, shampoo)).toMatchObject({ reason: "LOWER_COMPARABLE_UNIT_PRICE", amountCents: 200, basis: "PER_100_ML" });
    for (const peer of [{ ...shampoo, condition: "UNKNOWN" as const }, { ...shampoo, title: "Conditioner 250 mL", productType: "conditioner" },
      { ...shampoo, variantDimensions: { Color: "red" } }]) expect(comparableUnitPrices(large, peer)).toBeUndefined();
  });

  it("never omits non-quantity size evidence from unit comparisons", () => {
    const small = { ...shampoo, title: "Diapers 20 count", productType: "diapers", variantDimensions: { Size: "Newborn" } };
    expect(comparableUnitPrices(small, { ...small, variantDimensions: { Size: "Toddler" } })).toBeUndefined();
  });

  it("stable identity cannot override quantity or condition conflicts", () => {
    const identified = { ...shampoo, brand: "Brand", sku: "MODEL", gtins: ["1234567890123"] };
    expect(comparableSameProduct(identified, { ...identified })).toBe(true);
    expect(comparableSameProduct(identified, { ...identified, title: "Shampoo 500 mL" })).toBe(false);
    expect(comparableSameProduct(identified, { ...identified, condition: "UNKNOWN" })).toBe(false);
    expect(comparableSameProduct(identified, { ...identified, title: "Shampoo and Conditioner Kit 250 mL" })).toBe(false);
  });

  it("keeps source ratings separate from merchant trust and quality guarantees", () => {
    expect(assessQualityEvidence({})).toEqual({ status: "UNKNOWN", qualityGuaranteed: false });
    expect(assessQualityEvidence({ productRating: { value: 4.8, count: 12, scaleMax: 5 } })).toEqual({
      status: "REPORTED_RATING", rating: { value: 4.8, count: 12, scaleMax: 5 }, qualityGuaranteed: false
    });
    expect(assessQualityEvidence({ productRating: { value: 5, count: 0, scaleMax: 5 } }).status).toBe("UNKNOWN");
  });
});
