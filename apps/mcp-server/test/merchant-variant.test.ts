import { describe, expect, it } from "vitest";
import { merchantReportedVariant, merchantVariantStyleKey } from "../src/merchant-variant.js";

const source = { sourceKind: "AWIN_PRODUCT_FEED", merchantId: "50707", sourceHost: "ishowbeauty.com", handle: "123456",
  merchantUrl: "https://ishowbeauty.com/products/short-wig?variant=123456", title: "Short Human Hair Wig - Finger Wave / Natura Black" };

describe("source-bound merchant variant text", () => {
  it("retains explicit source spelling and never invents a unit", () => {
    expect(merchantReportedVariant(source)).toEqual({ "Merchant variant": "Finger Wave / Natura Black" });
    expect(merchantReportedVariant({ ...source, title: "U Part Wig - 8 / Brazilian Hair / Natural Black" }))
      .toEqual({ "Merchant variant": "8 / Brazilian Hair / Natural Black" });
  });
  it.each([
    { handle: "other" }, { merchantUrl: source.merchantUrl + "&variant=123456" },
    { merchantUrl: source.merchantUrl + "&selling_plan=100" }, { sourceHost: "other.example" },
    { merchantUrl: "https://user:pass@ishowbeauty.com/products/short-wig?variant=123456" },
    { merchantUrl: "http://ishowbeauty.com/products/short-wig?variant=123456" },
    { merchantUrl: "https://ishowbeauty.com/search?variant=123456" }, { merchantUrl: "not a URL" }
  ])("rejects ambiguous or unbound variant URLs (%#)", change => {
    expect(merchantReportedVariant({ ...source, ...change })).toEqual({});
    expect(merchantVariantStyleKey({ ...source, ...change })).toBeUndefined();
  });
  it.each(["Plain Black Wig", "Wig - Unknown", "Wig - / Black", `Wig - ${"a".repeat(200)} / Black`])("keeps unsupported titles unspecified (%#)", title => {
    expect(merchantReportedVariant({ ...source, title })).toEqual({});
  });
  it("groups a source-owned style only, never merges IDs, sources or merchants", () => {
    const otherVariant = { ...source, handle: "654321", merchantUrl: source.merchantUrl.replace("123456", "654321") };
    expect(merchantVariantStyleKey(otherVariant)).toBe(merchantVariantStyleKey(source));
    for (const change of [{ merchantId: "other" }, { sourceKind: "SHOPIFY_GLOBAL_CATALOG" }, { merchantUrl: source.merchantUrl.replace("short-wig", "long-wig") }]) {
      expect(merchantVariantStyleKey({ ...source, ...change })).not.toBe(merchantVariantStyleKey(source));
    }
  });
});
