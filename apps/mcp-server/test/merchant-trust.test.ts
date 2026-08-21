import { describe, expect, it } from "vitest";

import { resolveMerchantTrust } from "../src/merchant-trust.js";

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
    expect(resolveMerchantTrust("fake-shopdoen.com")).toEqual({
      level: "UNKNOWN",
      verification: "UNVERIFIED",
      evidence: ["no independent merchant trust evidence"]
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
});
