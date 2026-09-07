import { describe, expect, it } from "vitest";
import { countComparableOfferMerchants, finalizeSnapshotProducts, searchFallbackExplanation, summarizeSearchProducts } from "../src/search-result-summary.js";
import { product } from "./fixtures/conversation-replay-support.js";

describe("final result summary", () => {
  const offer = (host: string) => ({ ...product({ sourceHost: host, merchantId: host,
    merchantUrl: `https://${host}/products/pads?variant=1`, gtins: ["0123456789012"], variantDimensions: { Size: "S" } }), coupons: { verified: [] } });
  it("counts same-item merchants only with stable matching variants", () => {
    expect(countComparableOfferMerchants([offer("a.example"), offer("b.example")])).toBe(2);
    expect(countComparableOfferMerchants([offer("a.example"), { ...offer("b.example"), gtins: ["9999999999999"] }])).toBe(1);
    expect(countComparableOfferMerchants([offer("a.example"), { ...offer("b.example"), variantDimensions: { Size: "L" } }])).toBe(1);
  });
  it("retains typed brand/MPN evidence without substituting a merchant SKU", () => {
    const first = { ...offer("a.example"), gtins: [], brand: "Sony", mpn: "WH-1000XM6" };
    const second = { ...offer("b.example"), gtins: [], brand: "Sony", mpn: "WH-1000XM6" };
    expect(countComparableOfferMerchants([first, second])).toBe(2);
    expect(countComparableOfferMerchants([first, { ...second, mpn: "WH-1000XM5" }])).toBe(1);
    expect(countComparableOfferMerchants([first, { ...second, mpn: undefined, sku: "WH-1000XM6" }])).toBe(1);
  });
  it.each(["en-US", "zh-CN"] as const)("keeps found-item and unfinished-comparison semantics separate in %s", locale => {
    const summary = summarizeSearchProducts([offer("a.example")]);
    expect(summary).toMatchObject({ merchantCount: 1, recommendation: { state: "READY" }, comparison: { offerCount: 1, status: "DISCOVERY_ONLY" } });
    const message = searchFallbackExplanation(summary, true, locale);
    expect(message).not.toMatch(/No qualifying product|未返回符合要求/);
    expect(message).toContain(locale === "zh-CN" ? "比价尚未完成" : "comparison is incomplete");
  });
  it("does not promote unresolved identity into an exact comparison group", () => {
    const summary = summarizeSearchProducts([offer("a.example"), { ...offer("b.example"), requestIdentityStatus: "NEEDS_VERIFICATION" as const }]);
    expect(summary.comparison).toMatchObject({ status: "DISCOVERY_ONLY", offerCount: 2, merchantCount: 2 });
  });
  it("downgrades unsupported value labels without changing prices, order or IDs", () => {
    const first = { ...offer("a.example"), presentationGroup: "BEST_VALUE" as const, selectionId: "original-a" };
    const second = { ...offer("b.example"), presentationGroup: "TRUSTED_MATCH" as const, selectionId: "original-b",
      requestIdentityStatus: "NEEDS_VERIFICATION" as const };
    const result = finalizeSnapshotProducts([first, second], false, Date.now());
    expect(result.map(product => product.presentationGroup)).toEqual(["TRUSTED_MATCH", "RESEARCH_ONLY"]);
    expect(result.map(product => product.selectionId)).toEqual(["original-a", "original-b"]);
    expect(result.map(product => product.itemPrice)).toEqual([first.itemPrice, second.itemPrice]);
    expect(first.presentationGroup).toBe("BEST_VALUE");
  });
  it("retains a proved same-variant price advantage but removes stale value after a price change", () => {
    const first = { ...offer("a.example"), featureEvidence: ["size verified"], presentationGroup: "BEST_VALUE" as const,
      valueEvidence: { reason: "LOWER_SAME_PRODUCT_PRICE" as const, amountCents: 1000, currency: "USD" as const, basis: "ITEM_PRICE" as const },
      itemPrice: { amountCents: 1000, currency: "USD" as const } };
    const second = { ...offer("b.example"), featureEvidence: ["size verified"],
      itemPrice: { amountCents: 2000, currency: "USD" as const } };
    expect(finalizeSnapshotProducts([first, second], false, Date.now())[0]?.presentationGroup).toBe("BEST_VALUE");
    expect(finalizeSnapshotProducts([{ ...first, itemPrice: { amountCents: 1500, currency: "USD" } }, second], false, Date.now())[0]?.valueEvidence?.amountCents).toBe(500);
    expect(finalizeSnapshotProducts([{ ...first, itemPrice: second.itemPrice }, second], false, Date.now())[0]?.presentationGroup).toBe("TRUSTED_MATCH");
    expect(finalizeSnapshotProducts([{ ...first, itemPrice: second.itemPrice }, second], false, Date.now())[0]?.valueEvidence).toBeUndefined();
  });
});
