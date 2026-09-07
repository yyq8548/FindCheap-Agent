import { describe, expect, it } from "vitest";
import { assessRequestIdentity, hasStrongProductIdentifier } from "../src/shopify-match.js";

describe("product identifiers exclude measurements", () => {
  it.each(["155g", "500g", "1.5kg", "500mg", "100ml", "5.46 fl oz", "70pcs", "70count", "70pads", "155grams", "5000mah", "100w", "120hz", "2pack", "14inch", "50mm", "100cm", "1tb"])("does not treat %s as a model", query => {
    expect(hasStrongProductIdentifier(query)).toBe(false);
  });
  it.each(["Sony WH-1000XM5", "SM-S928U", "0123456789012"])("retains identifier %s", query => {
    expect(hasStrongProductIdentifier(query)).toBe(true);
  });
});

describe("request identity is distinct from same-product identity", () => {
  const mild = { title: "Zero Pore Madecassoside Pads (Mild)", brand: "medicube",
    description: "medicube Zero Pore Pad. Net wt. 155g (70 pads)" };
  it("keeps an unspecified edition unresolved despite matching package copy", () => {
    expect(assessRequestIdentity("medicube Zero Pore Pad 70 pads 155g", mild, "DISCOVERY_MATCH")).toBe("NEEDS_VERIFICATION");
  });
  it("accepts an explicit edition without inventing stable product identity", () => {
    expect(assessRequestIdentity("medicube Zero Pore Pad Mild 70 pads 155g", mild, "DISCOVERY_MATCH")).toBe("CONFIRMED");
  });
  it("does not let shared description verify a different primary title", () => {
    expect(assessRequestIdentity("Sony WH-1000XM5", { title: "Sony WH-1000XM6", description: "compare Sony WH-1000XM5" }, "DISCOVERY_MATCH")).toBe("NEEDS_VERIFICATION");
    expect(assessRequestIdentity("Sony WH-1000XM5", { title: "Sony WH-1000XM5 Headphones" }, "DISCOVERY_MATCH")).toBe("CONFIRMED");
  });
  it("does not turn measurements alone into a verified named request", () => {
    expect(assessRequestIdentity("155g", mild, "DISCOVERY_MATCH")).toBe("NEEDS_VERIFICATION");
  });
});
