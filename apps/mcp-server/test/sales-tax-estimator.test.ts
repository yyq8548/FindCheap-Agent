import { describe, expect, it } from "vitest";

import { estimateSalesTax } from "../src/sales-tax-estimator.js";

describe("ZIP sales-tax estimate", () => {
  it("uses the ZIP-inferred 2026 state and average local rate", () => {
    expect(estimateSalesTax("33433-1234", 10_000)).toEqual({
      amountCents: 698,
      currency: "USD",
      jurisdiction: "FL",
      rateBasisPoints: 698,
      source: "TAX_FOUNDATION_STATE_AVERAGE_2026"
    });
  });

  it("supports zero-rate states and IRS ZIP exceptions", () => {
    expect(estimateSalesTax("97201", 10_000)).toMatchObject({
      amountCents: 0,
      jurisdiction: "OR",
      rateBasisPoints: 0
    });
    expect(estimateSalesTax("06390", 10_000)).toMatchObject({
      jurisdiction: "NY",
      rateBasisPoints: 854
    });
  });

  it("fails closed for military, territory, unassigned, and malformed ZIPs", () => {
    expect(estimateSalesTax("09001", 10_000)).toBeUndefined();
    expect(estimateSalesTax("00601", 10_000)).toBeUndefined();
    expect(estimateSalesTax("98701", 10_000)).toBeUndefined();
    expect(estimateSalesTax("3343", 10_000)).toBeUndefined();
  });
});
