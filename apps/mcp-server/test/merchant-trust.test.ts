import { describe, expect, it } from "vitest";

import {
  isHighRatedProduct,
  merchantRecommendationTier,
  resolveMerchantTrust,
  resolveVerifiedOfficialStorefront
} from "../src/merchant-trust.js";

describe("merchant trust evidence", () => {
  it("recognizes only exact independently reviewed official domains", () => {
    expect(resolveMerchantTrust("www.shopdoen.com")).toMatchObject({
      level: "OFFICIAL",
      verification: "INDEPENDENT"
    });
    expect(resolveMerchantTrust("shopdoen.com")).toMatchObject({
      level: "OFFICIAL",
      verification: "INDEPENDENT"
    });
    expect(resolveMerchantTrust("electronics.sony.com")).toMatchObject({
      level: "OFFICIAL",
      verification: "INDEPENDENT"
    });
    expect(resolveMerchantTrust("www.apple.com")).toMatchObject({
      level: "OFFICIAL",
      verification: "INDEPENDENT"
    });
    expect(resolveMerchantTrust("fake-shopdoen.com")).toEqual({
      level: "UNKNOWN",
      verification: "UNVERIFIED",
      evidence: ["no independent merchant trust evidence"]
    });
  });

  it("recognizes reviewed authorized and established retailers", () => {
    expect(resolveMerchantTrust("expercom.com")).toMatchObject({
      level: "AUTHORIZED_RETAILER",
      verification: "INDEPENDENT"
    });
    expect(resolveMerchantTrust("www.clemsontigertechshop.com")).toMatchObject({
      level: "AUTHORIZED_RETAILER",
      verification: "INDEPENDENT"
    });
    expect(resolveMerchantTrust("www.bestbuy.com")).toMatchObject({
      level: "ESTABLISHED_RETAILER",
      verification: "INDEPENDENT"
    });
    expect(resolveMerchantTrust("fake-bestbuy.com")).toMatchObject({
      level: "UNKNOWN",
      verification: "UNVERIFIED"
    });
  });

  it("does not treat an official-looking name as independent evidence", () => {
    expect(resolveMerchantTrust("doen-official.example", "DÔEN Official Store")).toEqual({
      level: "UNKNOWN",
      verification: "UNVERIFIED",
      evidence: ["merchant self-description is not independent trust evidence"]
    });
  });

  it("marks numeric, localhost, and punycode hosts risky", () => {
    for (const host of ["127.0.0.1", "203.0.113.10", "localhost", "xn--d1acpjx3f.example"]) {
      expect(resolveMerchantTrust(host).level).toBe("RISKY");
    }
  });

  it("resolves only reviewed official storefront brands", () => {
    expect(resolveVerifiedOfficialStorefront("SKIMS")).toMatchObject({ host: "skims.com", brand: "SKIMS", platform: "SHOPIFY" });
    expect(resolveVerifiedOfficialStorefront("doen")).toMatchObject({ host: "www.shopdoen.com", brand: "DÔEN", platform: "SHOPIFY" });
    expect(resolveVerifiedOfficialStorefront("Death Wish")).toMatchObject({
      host: "www.deathwishcoffee.com",
      brand: "Death Wish Coffee"
    });
    expect(resolveVerifiedOfficialStorefront("BLK and Bold")).toMatchObject({
      host: "blkandbold.com",
      brand: "BLK & Bold"
    });
    expect(resolveVerifiedOfficialStorefront("Verve")).toMatchObject({
      host: "www.vervecoffee.com",
      brand: "Verve Coffee"
    });
    expect(resolveVerifiedOfficialStorefront("Steve Madden")).toMatchObject({
      host: "www.stevemadden.com",
      brand: "Steve Madden"
    });
    expect(resolveVerifiedOfficialStorefront("Allbirds")).toMatchObject({
      host: "www.allbirds.com",
      brand: "Allbirds"
    });
    expect(resolveVerifiedOfficialStorefront("Brooklinen")).toMatchObject({
      host: "www.brooklinen.com",
      brand: "Brooklinen"
    });
    expect(resolveVerifiedOfficialStorefront("Glossier")).toMatchObject({
      host: "www.glossier.com",
      brand: "Glossier"
    });
    expect(resolveVerifiedOfficialStorefront("Colour Pop")).toMatchObject({
      host: "colourpop.com",
      brand: "ColourPop"
    });
    expect(resolveVerifiedOfficialStorefront("Intimately")).toMatchObject({
      host: "www.freepeople.com",
      officialHost: "freepeople.com",
      brand: "Free People",
      platform: "GENERIC_JSON_LD",
      productPathPrefixes: ["/shop/"]
    });
    expect(resolveMerchantTrust("www.freepeople.com")).toMatchObject({
      level: "OFFICIAL",
      verification: "INDEPENDENT"
    });
    expect(resolveVerifiedOfficialStorefront("Unknown Brand")).toBeUndefined();
  });

  it("requires a rating above 3.8 with at least two reviews", () => {
    expect(isHighRatedProduct({ value: 3.81, count: 2, scaleMax: 5 })).toBe(true);
    expect(isHighRatedProduct({ value: 3.8, count: 20, scaleMax: 5 })).toBe(false);
    expect(isHighRatedProduct({ value: 5, count: 1, scaleMax: 5 })).toBe(false);
    expect(merchantRecommendationTier(
      resolveMerchantTrust("unknown.example"),
      { value: 4.2, count: 2, scaleMax: 5 }
    )).toBe("HIGH_RATED_UNVERIFIED");
  });
});
