import { describe, expect, it } from "vitest";
import { comparableSameProduct, comparableUnitPrices, costAdvantage, type ValueProduct } from "../src/product-value-evidence.js";
import { countComparableOfferMerchants } from "../src/search-result-summary.js";

// Fixed facts from the two actual 2026-09-09 source observations; prices are historical fixture values.
const sony = { title: "WH-1000XM5 Premium Wireless Noise Canceling Headphones | Black", brand: "Sony", sku: "wh1000xm5-b",
  mpn: "WH-1000XM5", gtins: ["027242923232"], condition: "NEW" as const, variantDimensions: { Color: "Black" },
  itemPrice: { amountCents: 29999, currency: "USD" as const }, merchantId: "official-electronics.sony.com", merchantUrl: "https://electronics.sony.com/audio/headphones/headband/p/wh1000xm5-b" };
const retailer = { title: "Sony WH-1000XM5 Wireless Noise Canceling Headphones — Black / New", brand: "Sony", sku: "WH1000XM5/B",
  gtins: ["027242923232"], condition: "NEW" as const, variantDimensions: { Color: "Black", Condition: "New" },
  itemPrice: { amountCents: 29800, currency: "USD" as const }, merchantId: "shopify-11236098", merchantUrl: "https://skybygramophone.com/products/sony-wh-1000xm5" };

describe("comparison keeps repeated condition evidence consistent", () => {
  it("compares the same actual GTIN/color/condition despite a redundant condition option", () => {
    const original = JSON.stringify([sony, retailer]);
    expect(comparableSameProduct(sony, retailer)).toBe(true);
    expect(countComparableOfferMerchants([sony, retailer])).toBe(2);
    expect(costAdvantage(retailer, sony)).toMatchObject({ reason: "LOWER_SAME_PRODUCT_PRICE", amountCents: 199 });
    expect(JSON.stringify([sony, retailer])).toBe(original);
  });
  it.each(["Used", "Refurbished", "Open Box", "Unknown", "Like New", "New or Used"])("rejects contradictory or unconfirmed option %s", Condition => {
    const peer = { ...retailer, variantDimensions: { Color: "Black", Condition } };
    expect(comparableSameProduct(sony, peer)).toBe(false);
    expect(comparableSameProduct(peer, { ...peer })).toBe(false);
  });
  it("keeps other variant dimensions and unknown canonical condition strict", () => {
    expect(comparableSameProduct(sony, { ...retailer, variantDimensions: { Color: "Blue", Condition: "New" } })).toBe(false);
    expect(comparableSameProduct(sony, { ...retailer, condition: "UNKNOWN" })).toBe(false);
    expect(comparableSameProduct(sony, { ...retailer, variantDimensions: { Color: "Black", Condition: "New", "Item Condition": "Used" } })).toBe(false);
    expect(comparableSameProduct(sony, { ...retailer, title: "WH-1000XM5 Black Bundle" })).toBe(false);
  });
  it.each(["USED", "REFURBISHED", "OPEN_BOX"] as const)("supports explicit matching %s without promoting it to new", condition => {
    const base = { ...sony, condition };
    expect(comparableSameProduct(base, { ...base, variantDimensions: { Color: "Black", Condition: condition.replaceAll("_", " ") } })).toBe(true);
  });
  it("uses the same condition consistency in unit-price comparison", () => {
    const a: ValueProduct = { title: "Shampoo 250 ml", productType: "shampoo", condition: "NEW", itemPrice: { amountCents: 1000, currency: "USD" } };
    const b = { ...a, title: "Shampoo 500 ml", variantDimensions: { Condition: "New" } };
    expect(comparableUnitPrices(a, b)).toBeDefined();
    expect(comparableUnitPrices(a, { ...b, variantDimensions: { Condition: "Used" } })).toBeUndefined();
    expect(comparableUnitPrices({ ...b, variantDimensions: { Condition: "Used" } }, { ...b, variantDimensions: { Condition: "Used" } })).toBeUndefined();
  });
});
