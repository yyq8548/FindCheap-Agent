import { describe, expect, it } from "vitest";

import type { CanonicalProduct } from "../../contracts/src/index.js";
import { decideProductPromotion } from "../src/index.js";

const product = (overrides: Partial<CanonicalProduct> = {}): CanonicalProduct => ({
  productId: "product-1",
  brand: "Acme",
  manufacturerPartNumber: "Model-1",
  gtins: ["12345678"],
  title: "Acme Model 1",
  categoryPath: ["Widgets"],
  attributes: [],
  variantDimensions: { color: "black" },
  ...overrides
});

describe("product promotion decision", () => {
  it("promotes one deterministic GTIN and required-variant match", () => {
    expect(decideProductPromotion({
      title: "Acme Model 1",
      gtins: ["１２３４ ５６７８"],
      variantDimensions: { color: "black" },
      coreSimilarity: 0
    }, [product()])).toMatchObject({
      status: "EXACT",
      canonicalProductId: "product-1",
      method: "GTIN",
      fields: { gtin: "12345678" }
    });
  });

  it("never upgrades a merely similar candidate to exact", () => {
    expect(decideProductPromotion({
      brand: "Acme",
      title: "Acme other widget",
      gtins: [],
      variantDimensions: {},
      coreSimilarity: 0.8
    }, [product({ manufacturerPartNumber: "OTHER", gtins: [] })])).toMatchObject({
      status: "SIMILAR"
    });
  });

  it("rejects conflicting exact canonical candidates as ambiguous", () => {
    expect(decideProductPromotion({
      brand: "ＡＣＭＥ",
      mpn: "MODEL－1",
      title: "Acme Model 1",
      gtins: [],
      variantDimensions: { color: "black" },
      coreSimilarity: 0
    }, [
      product(),
      product({ productId: "product-2", gtins: [], title: "Duplicate canonical seed" })
    ])).toMatchObject({ status: "AMBIGUOUS", candidateProductIds: ["product-1", "product-2"] });
  });

  it("keeps variant conflicts and absent identities out of exact comparison", () => {
    expect(decideProductPromotion({
      brand: "Acme",
      mpn: "Model-1",
      title: "Acme Model 1 Blue",
      gtins: [],
      variantDimensions: { color: "blue" },
      coreSimilarity: 0
    }, [product()])).toMatchObject({ status: "NEEDS_CLARIFICATION" });

    expect(decideProductPromotion({
      brand: "Unknown",
      title: "Unknown",
      gtins: [],
      variantDimensions: {},
      coreSimilarity: 0
    }, [])).toMatchObject({ status: "NO_MATCH" });
  });
});
