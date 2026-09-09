import { describe, expect, it } from "vitest";
import { assessRequestIdentity, classifyShopifyCandidate, hasStrongProductIdentifier } from "../src/shopify-match.js";

describe("product identifiers exclude measurements", () => {
  it.each(["155g", "500g", "1.5kg", "500mg", "100ml", "5.46 fl oz", "70pcs", "70count", "70pads", "155grams", "5000mah", "100w", "120hz", "2pack", "14inch", "50mm", "100cm", "1tb"])("does not treat %s as a model", query => {
    expect(hasStrongProductIdentifier(query)).toBe(false);
  });
  it.each(["Sony WH-1000XM5", "SM-S928U", "0123456789012"])("retains identifier %s", query => {
    expect(hasStrongProductIdentifier(query)).toBe(true);
  });
});

describe("request identity is distinct from same-product identity", () => {
  it.each(["EXACT", "DISCOVERY_MATCH"] as const)("does not resolve Sony WH/WF from a %s candidate", status => {
    expect(assessRequestIdentity("Sony 1000XM5", { title: "Sony WH-1000XM5", brand: "Sony" }, status)).toBe("NEEDS_VERIFICATION");
    expect(assessRequestIdentity("1000XM6", { title: "Sony WF-1000XM6", brand: "Sony" }, status)).toBe("NEEDS_VERIFICATION");
    expect(assessRequestIdentity("Sony WH-1000XM5", { title: "Sony WH-1000XM5", brand: "Sony" }, status)).toBe("CONFIRMED");
  });
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
  it("does not match a requested edition from cross-sell copy", () => {
    expect(classifyShopifyCandidate("medicube Zero Pore Pad Mild", {
      title: "medicube Zero Pore Pad", description: "For gentler exfoliation try Zero Pore Pad Mild."
    })).toMatchObject({ status: "SIMILAR", missingTerms: ["mild"] });
  });
  it("rejects an explicit opposing edition even with shared copy", () => {
    expect(classifyShopifyCandidate("medicube Zero Pore Pad Mild", {
      title: "medicube Zero Pore Pad Regular", description: "Compare with Zero Pore Pad Mild."
    })).toMatchObject({ status: "IRRELEVANT" });
  });
  it("accepts an edition in a selected option but not a descriptive adjective", () => {
    expect(classifyShopifyCandidate("medicube Zero Pore Pad Mild", {
      title: "medicube Zero Pore Pad", variantDimensions: { Edition: "Mild" }
    })).toMatchObject({ status: "DISCOVERY_MATCH" });
    expect(classifyShopifyCandidate("mild shampoo", {
      title: "Daily shampoo", description: "A mild shampoo for daily use."
    })).toMatchObject({ status: "DISCOVERY_MATCH" });
  });
  it("retains mini length in garment discovery instead of interpreting a model edition", () => {
    expect(classifyShopifyCandidate("DOEN black lace mini dress", {
      title: "Cornella Dress Black", brand: "DOEN", description: "Black lace mini dress"
    }).status).toBe("DISCOVERY_MATCH");
  });
});
