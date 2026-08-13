import { describe, expect, it } from "vitest";
import type { CanonicalProduct } from "../../contracts/src/index.js";
import { matchProduct, type CandidateProduct } from "../src/index.js";

const canonicalTv = (): CanonicalProduct => ({
  productId: "tv-1",
  brand: "Acme",
  manufacturerPartNumber: "OLED-55-X",
  gtins: ["012345678905"],
  title: "Acme OLED TV",
  categoryPath: ["Electronics", "Televisions"],
  attributes: [],
  variantDimensions: { color: "black", size: "55 inch" }
});

const canonicalChineseTv = (): CanonicalProduct => ({
  ...canonicalTv(),
  brand: "海信",
  manufacturerPartNumber: "电视型号甲",
  gtins: []
});

const candidate = (overrides: Partial<CandidateProduct> = {}): CandidateProduct => ({
  brand: "Acme",
  mpn: "OLED-55-X",
  gtins: ["012345678905"],
  title: "Acme OLED TV",
  variantDimensions: { color: "black", size: "55 inch" },
  coreSimilarity: 0.2,
  ...overrides
});

const candidateWithoutMpn = (
  overrides: Omit<Partial<CandidateProduct>, "mpn"> = {}
): Omit<CandidateProduct, "mpn"> => {
  const { mpn: _mpn, ...withoutMpn } = candidate();
  return { ...withoutMpn, ...overrides };
};

describe("matchProduct", () => {
  it("classifies a GTIN match with equal canonical variants as exact", () => {
    expect(matchProduct(candidate(), canonicalTv())).toEqual({
      status: "EXACT",
      evidence: ["GTIN exact"]
    });
  });

  it("requires confirmation when a GTIN match conflicts on a canonical variant", () => {
    expect(
      matchProduct(candidate({ variantDimensions: { color: "white", size: "55 inch" } }), canonicalTv())
    ).toEqual({
      status: "NEEDS_CONFIRMATION",
      evidence: ["variant conflict: color"]
    });
  });

  it("requires confirmation when an identity match omits a canonical variant", () => {
    expect(matchProduct(candidate({ variantDimensions: { color: "black" } }), canonicalTv())).toEqual({
      status: "NEEDS_CONFIRMATION",
      evidence: ["variant missing: size"]
    });
  });

  it("recognizes normalized brand and manufacturer part number identity", () => {
    expect(
      matchProduct(
        candidate({
          brand: " ACME ",
          mpn: "oled 55 x",
          gtins: []
        }),
        canonicalTv()
      )
    ).toEqual({ status: "EXACT", evidence: ["brand and MPN exact"] });
  });

  it("does not treat distinct Chinese brand and MPN tokens as exact identity", () => {
    expect(
      matchProduct(
        candidate({ brand: "创维", mpn: "电视型号乙", gtins: [] }),
        canonicalChineseTv()
      ).status
    ).toBe("INSUFFICIENT");
  });

  it("recognizes matching Chinese brand and MPN tokens as exact identity", () => {
    expect(
      matchProduct(
        candidate({ brand: "海信", mpn: "电视型号甲", gtins: [] }),
        canonicalChineseTv()
      )
    ).toEqual({ status: "EXACT", evidence: ["brand and MPN exact"] });
  });

  it("normalizes GTIN punctuation without altering its digits", () => {
    expect(
      matchProduct(candidateWithoutMpn({ gtins: ["0-12345-67890-5"] }), canonicalTv())
    ).toEqual({ status: "EXACT", evidence: ["GTIN exact"] });
  });

  it("never upgrades semantic similarity to exact", () => {
    const result = matchProduct(
      candidateWithoutMpn({ gtins: [], title: "similar oled tv", coreSimilarity: 1 }),
      canonicalTv()
    );

    expect(result.status).toBe("SIMILAR");
  });

  it("returns insufficient when identity is absent and core similarity is below the threshold", () => {
    expect(
      matchProduct(candidateWithoutMpn({ gtins: [], coreSimilarity: 0.74 }), canonicalTv())
    ).toEqual({ status: "INSUFFICIENT", evidence: ["identity absent"] });
  });
});
