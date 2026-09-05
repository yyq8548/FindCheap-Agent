import { describe, expect, it } from "vitest";
import { buildVisualRetrievalQuery } from "../src/visual-retrieval-query.js";
import { normalizeVisualEvidence, relaxVisualProductInput, VisualProductInputSchema } from "../src/visual-product-discovery.js";

describe("shared reliable visual retrieval query", () => {
  it.each(["navy teal plaid", "navy teal tartan", "ivory pinstripe"])("retains discriminating %s in initial and already-relaxed input", (pattern) => {
    const input = VisualProductInputSchema.parse({ brand: "Example Brand", productType: "dress", colors: ["ivory"],
      neckline: "scoop neck", observations: [{ attribute: "PATTERN", value: pattern, confidence: 0.96, visibility: "VISIBLE" }] });
    for (const query of [buildVisualRetrievalQuery(input), buildVisualRetrievalQuery(relaxVisualProductInput(input), { relaxed: true })]) {
      for (const term of ["Example Brand", "dress", ...pattern.split(" ")]) expect(query).toContain(term);
    }
    expect(normalizeVisualEvidence(relaxVisualProductInput(input))).toContainEqual(expect.objectContaining({
      attribute: "PATTERN", value: pattern, source: "OBSERVATION", inferred: false, visibility: "VISIBLE"
    }));
    expect(relaxVisualProductInput(input).observations).toContainEqual(expect.objectContaining({ confidence: 0.96 }));
  });

  it("preserves base and print colors alongside pinstripes and narrow straps", () => {
    const input = VisualProductInputSchema.parse({ productType: "camisole top", observations: [
      { attribute: "COLOR", value: "ivory base", confidence: 0.96, visibility: "VISIBLE" },
      { attribute: "PATTERN", value: "burgundy vertical pinstripes", confidence: 0.97, visibility: "VISIBLE" },
      { attribute: "SLEEVE", value: "thin spaghetti straps", confidence: 0.92, visibility: "VISIBLE" },
      { attribute: "NECKLINE", value: "square neck", confidence: 0.94, visibility: "VISIBLE" }
    ] });
    const query = buildVisualRetrievalQuery(input);
    for (const word of ["top", "ivory", "burgundy", "pinstripe", "spaghetti strap"]) expect(query).toContain(word);
    expect(query).not.toContain("dress");
  });

  it("does not turn uncertain patterns into reliable second-pass anchors", () => {
    const input = VisualProductInputSchema.parse({ productType: "dress", patterns: ["navy plaid"], observations: [
      { attribute: "PATTERN", value: "navy plaid", confidence: 0.3, visibility: "VISIBLE" }
    ], inferences: [{ attribute: "PATTERN", value: "red pinstripes", confidence: 0.99, visibility: "VISIBLE" }] });
    const query = buildVisualRetrievalQuery(relaxVisualProductInput(input), { relaxed: true });
    expect(query).toBe("dress");
  });

  it("keeps visible flower observations and both base and flower colors without requiring the word floral", () => {
    const visual = VisualProductInputSchema.parse({ productType: "dress", colors: ["pale blue gray base"], observations: [
      { attribute: "PATTERN", value: "large pale pink flowers with deep pink centers and gray green leaves", confidence: 0.99, visibility: "VISIBLE" }
    ] });
    for (const query of [buildVisualRetrievalQuery(visual), buildVisualRetrievalQuery(relaxVisualProductInput(visual), { relaxed: true })]) {
      for (const word of ["blue", "pink", "floral"]) expect(query).toContain(word);
    }
  });

  it("does not bypass a low-confidence observation through a differently worded legacy pattern", () => {
    const visual = VisualProductInputSchema.parse({ productType: "dress", patterns: ["navy plaid"], observations: [
      { attribute: "PATTERN", value: "possibly dark navy checked fabric", confidence: 0.3, visibility: "VISIBLE" }
    ] });
    expect(buildVisualRetrievalQuery(relaxVisualProductInput(visual), { relaxed: true })).toBe("dress");
  });

  it.each(["PARTIAL", "OCCLUDED", "UNKNOWN"])("does not restore %s pattern via different legacy wording", (visibility) => {
    const visual = VisualProductInputSchema.parse({ productType: "dress", patterns: ["navy plaid"], observations: [
      { attribute: "PATTERN", value: "dark navy checked fabric", confidence: 0.99, visibility }
    ] });
    expect(buildVisualRetrievalQuery(relaxVisualProductInput(visual), { relaxed: true })).toBe("dress");
  });

  it("retains an uncommon observed color rather than silently removing it", () => {
    expect(buildVisualRetrievalQuery(VisualProductInputSchema.parse({ productType: "dress", colors: ["mauve"] }))).toContain("mauve");
  });

  it("preserves structured pattern confidence when a duplicate legacy field exists", () => {
    const visual = VisualProductInputSchema.parse({ productType: "dress", patterns: ["navy teal plaid"], observations: [
      { attribute: "PATTERN", value: "navy teal plaid", confidence: 0.97, visibility: "VISIBLE" }
    ] });
    expect(relaxVisualProductInput(visual).observations).toContainEqual(expect.objectContaining({
      attribute: "PATTERN", value: "navy teal plaid", confidence: 0.97, visibility: "VISIBLE"
    }));
  });

  it("simplifies two structural features to one without dropping brand, family, color or length", () => {
    const input = VisualProductInputSchema.parse({ brand: "DÔEN", productType: "dress", colors: ["black"], length: "mini",
      distinctiveDetails: ["horizontal lace bands"], neckline: "boat neck" });
    const first = buildVisualRetrievalQuery(input);
    const second = buildVisualRetrievalQuery(input, { relaxed: true });
    expect(first).toContain("boat neck");
    expect(second).not.toContain("boat neck");
    for (const query of [first, second]) for (const word of ["DÔEN", "dress", "black", "mini", "lace"]) expect(query).toContain(word);
  });
  it("does not duplicate a brand already present in the suspected product-name hint", () => {
    const query = buildVisualRetrievalQuery(VisualProductInputSchema.parse({ brand: "SKIMS", productType: "dress",
      suspectedProductName: "SKIMS Soft Lounge Long Slip Dress", colors: ["gray"] }));
    expect(query.match(/SKIMS/gu)).toHaveLength(1);
  });
  it("keeps useful non-fashion shape detail without inferring clothing descriptors", () => {
    const query = buildVisualRetrievalQuery(VisualProductInputSchema.parse({ productType: "headphones", colors: ["black"],
      distinctiveDetails: ["round ear cups", "folding metal headband"] }));
    expect(query).toContain("headphone");
    expect(query).toContain("black");
    expect(query).toContain("round ear cups");
  });
  it("does not promote low-confidence or occluded observations into retrieval constraints", () => {
    const query = buildVisualRetrievalQuery(VisualProductInputSchema.parse({ productType: "dress", colors: ["black"],
      observations: [
        { attribute: "LENGTH", value: "maxi", confidence: 0.2, visibility: "VISIBLE" },
        { attribute: "SLEEVE", value: "long sleeve", confidence: 0.95, visibility: "OCCLUDED" }
      ] }));
    expect(query).toBe("dress black");
  });
});
