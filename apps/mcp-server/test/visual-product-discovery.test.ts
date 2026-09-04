import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  VisualProductInputSchema,
  classifyVisualProduct,
  enforceVisualEvidenceAuthority,
  hasVisualProductFamilyConflict,
  isVisualAttributeOccluded,
  normalizeVisualEvidence,
  relaxVisualProductInput,
  visualOfficialStoreSearchQueries,
  visualSearchTerms
} from "../src/visual-product-discovery.js";
import { DOEN_VISUAL_GOLDEN_CASES } from "./fixtures/doen-visual-golden.js";
import { BLACK_DRESS_OBSERVATIONS, PARTLY_OCCLUDED_BLOUSE } from "./fixtures/visual-observation-regressions.js";

const GoldenTaskSchema = z.object({
  id: z.string(),
  visual: VisualProductInputSchema,
  candidate: z.object({
    title: z.string(),
    productType: z.string().optional(),
    brand: z.string().optional(),
    modelOrStyleNumber: z.string().optional(),
    description: z.string().optional(),
    attributes: z.array(z.string()).optional()
  }),
  expectedGroup: z.enum(["POSSIBLE_SAME_ITEM", "HIGHLY_SIMILAR", "SAME_STYLE"]).nullable()
});

describe("visual product discovery", () => {
  it("accepts the production 101-character observation value with bounded payloads", () => {
    expect(BLACK_DRESS_OBSERVATIONS.observations[4]!.value).toHaveLength(101);
    expect(VisualProductInputSchema.safeParse(BLACK_DRESS_OBSERVATIONS).success).toBe(true);
    for (const invalid of [
      { observations: [{ attribute: "DETAIL", value: "x".repeat(241), confidence: 1 }] },
      { observations: Array.from({ length: 25 }, () => ({ attribute: "DETAIL", value: "lace", confidence: 1 })) },
      { imageUrl: "http://example.com/dress.jpg" },
      { imageUrl: "https://user:password@example.com/dress.jpg" }
    ]) expect(VisualProductInputSchema.safeParse({ productType: "dress", ...invalid }).success).toBe(false);
  });

  it("preserves distinctive observations in both initial and second-pass retrieval", () => {
    const visual = VisualProductInputSchema.parse(BLACK_DRESS_OBSERVATIONS);
    const relaxed = relaxVisualProductInput(visual);
    expect(relaxed).toMatchObject({
      brand: "DOEN", productType: "dress", colors: ["black"], length: "mini, above-knee length"
    });
    expect(relaxed.distinctiveDetails).toEqual([
      BLACK_DRESS_OBSERVATIONS.observations[4]!.value,
      BLACK_DRESS_OBSERVATIONS.observations[1]!.value
    ]);
    expect(visualSearchTerms(visual).join(" ")).toMatch(/lace/u);
    expect(visualOfficialStoreSearchQueries(visual)[0]?.query).toMatch(/lace/u);
    expect(visualOfficialStoreSearchQueries(relaxed)[0]?.query).toMatch(/lace/u);
    for (const { query } of visualOfficialStoreSearchQueries(relaxed)) {
      expect(query).toMatch(/\bblack\b/u);
      expect(query).toMatch(/\bmini\b/u);
    }
    expect(visualOfficialStoreSearchQueries(relaxed)[0]?.query).toContain("boat neck");
    expect(classifyVisualProduct(relaxed, { title: "DOEN Cornella Dress", productType: "dress" })?.group).toBe("SAME_STYLE");
  });

  it("keeps visible chest ruffles and front tie when only the right shoulder is partly hidden", () => {
    const visual = VisualProductInputSchema.parse(PARTLY_OCCLUDED_BLOUSE);
    const relaxed = relaxVisualProductInput(visual);
    expect(relaxed.distinctiveDetails).toEqual(
      PARTLY_OCCLUDED_BLOUSE.distinctiveDetails.slice(0, 2)
    );
    expect(relaxed).toMatchObject({ brand: "DOEN", productType: "shirt", colors: ["ivory cream"] });
    const queries = visualOfficialStoreSearchQueries(relaxed);
    for (const { query } of queries) {
      expect(query).toContain("shirt");
      expect(query).toContain("ivory cream");
    }
    expect(queries[0]?.query).toContain("ruffle");
    expect(queries[0]?.query).toContain("tie front");
    expect(hasVisualProductFamilyConflict(relaxed, { title: "DOEN Leather Slide" })).toBe(true);
  });

  it("uses the same query and classification for legacy fields and direct observations", () => {
    const legacy = VisualProductInputSchema.parse({
      brand: "DOEN", productType: "dress", colors: ["black"],
      neckline: "boat neck", sleeveType: "cap sleeves", silhouette: "a line"
    });
    const observed = VisualProductInputSchema.parse({
      brand: "DOEN", productType: "dress",
      observations: [
        { attribute: "COLOR", value: "black", confidence: 0.95 },
        { attribute: "NECKLINE", value: "boat neck", confidence: 0.95 },
        { attribute: "SLEEVE_TYPE", value: "cap sleeves", confidence: 0.95 },
        { attribute: "SILHOUETTE", value: "a line", confidence: 0.95 }
      ]
    });
    const candidate = { title: "DOEN Black Boat Neck Cap Sleeve A-line Dress", productType: "dress" };
    expect(visualSearchTerms(observed)).toEqual(visualSearchTerms(legacy));
    expect(visualOfficialStoreSearchQueries(observed)).toEqual(visualOfficialStoreSearchQueries(legacy));
    expect(relaxVisualProductInput(observed)).toEqual(relaxVisualProductInput(legacy));
    expect(classifyVisualProduct(observed, candidate)).toEqual(classifyVisualProduct(legacy, candidate));
  });

  it("does not count repeated synonymous observations as independent structural matches", () => {
    const visual = VisualProductInputSchema.parse({
      brand: "DOEN", productType: "dress", neckline: "boat neck",
      distinctiveDetails: ["bateau neckline"],
      observations: [
        { attribute: "NECKLINE", value: "boat neck", confidence: 0.95 },
        { attribute: "neckline", value: "bateau neckline", confidence: 0.99 }
      ]
    });
    const result = classifyVisualProduct(visual, { title: "DOEN Bateau Neckline Dress" });
    expect(result?.group).toBe("SAME_STYLE");
    expect(result?.evidence.filter((entry) => entry.startsWith("visual attribute matched:"))).toHaveLength(1);
  });

  it("does not turn unknown visibility into support or a conflict", () => {
    const visual = VisualProductInputSchema.parse({
      brand: "DOEN", productType: "dress",
      observations: [{ attribute: "SLEEVE", value: "sleeveless", confidence: 1, visibility: "UNKNOWN" }]
    });
    const result = classifyVisualProduct(visual, { title: "DOEN Long Sleeve Dress" });
    expect(result?.group).toBe("SAME_STYLE");
    expect(result?.evidence.some((entry) => entry.startsWith("visual attribute matched:"))).toBe(false);
    expect(visualSearchTerms(visual).join(" ")).not.toContain("sleeveless");
  });

  it("keeps explicit uncertainty when the same attribute is repeated as a confident observation", () => {
    const visual = VisualProductInputSchema.parse({
      brand: "DOEN", productType: "dress", sleeveType: "sleeveless",
      observations: [
        { attribute: "SLEEVE", value: "sleeveless", confidence: 0.5, visibility: "UNKNOWN" },
        { attribute: "SLEEVE", value: "sleeveless", confidence: 1 }
      ]
    });
    expect(isVisualAttributeOccluded(visual, "SLEEVE")).toBe(true);
    expect(classifyVisualProduct(visual, { title: "DOEN Long Sleeve Dress" })?.group).toBe("SAME_STYLE");
    expect(relaxVisualProductInput(visual).distinctiveDetails).toBeUndefined();
  });

  it("does not promote duplicate low-confidence observations into strong relaxed attributes", () => {
    const visual = VisualProductInputSchema.parse({
      brand: "DOEN", productType: "mini dress", colors: ["black"], length: "mini", sleeveType: "sleeveless",
      observations: [
        { attribute: "COLOR", value: "black", confidence: 0.5 },
        { attribute: "LENGTH", value: "mini", confidence: 0.5 },
        { attribute: "SLEEVE", value: "sleeveless", confidence: 0.5 },
        { attribute: "SLEEVE", value: "sleeveless", confidence: 1 }
      ]
    });
    const relaxed = relaxVisualProductInput(visual);
    expect(relaxed).toMatchObject({ brand: "DOEN", productType: "dress", colors: [] });
    expect(relaxed.length).toBeUndefined();
    expect(relaxed.distinctiveDetails).toBeUndefined();
    expect(classifyVisualProduct(relaxed, { title: "DOEN White Long Sleeve Maxi Dress" })?.group).toBe("SAME_STYLE");
    expect(normalizeVisualEvidence(visual).filter((entry) => !entry.inferred)).toEqual([]);
  });

  it("retains bounded long anchor observations without overflowing compact legacy fields", () => {
    const length = "mini above-knee length " + "visible hem ".repeat(8);
    const relaxed = relaxVisualProductInput(VisualProductInputSchema.parse({
      productType: "dress", colors: ["black"],
      observations: [{ attribute: "LENGTH", value: length, confidence: 0.95 }]
    }));
    expect(VisualProductInputSchema.safeParse(relaxed).success).toBe(true);
    expect(relaxed.length).toBeUndefined();
    expect(normalizeVisualEvidence(relaxed)).toContainEqual(expect.objectContaining({
      attribute: "LENGTH", value: length.trim(), visibility: "VISIBLE", inferred: false
    }));
    for (const { query } of visualOfficialStoreSearchQueries(relaxed)) expect(query).toContain("mini");
  });

  it.each(["UNKNOWN", "PARTIAL", "OCCLUDED"] as const)(
    "does not restore %s length or color through legacy fields or the product subtype", (visibility) => {
      const relaxed = relaxVisualProductInput(VisualProductInputSchema.parse({
        brand: "DOEN", productType: "mini dress", colors: ["black"], length: "mini",
        observations: [
          { attribute: "COLOR", value: "black", confidence: 1, visibility },
          { attribute: "LENGTH", value: "mini", confidence: 1, visibility }
        ]
      }));
      expect(relaxed).toMatchObject({ brand: "DOEN", productType: "dress", colors: [] });
      expect(relaxed.length).toBeUndefined();
      expect(visualOfficialStoreSearchQueries(relaxed)).toEqual([{ stage: "FULL", query: "dress" }]);
      expect(classifyVisualProduct(relaxed, { title: "DOEN White Maxi Dress" })?.group).toBe("SAME_STYLE");
    }
  );

  it("tracks explicit local visibility without applying a right-side occlusion to the left", () => {
    const visual = VisualProductInputSchema.parse({
      productType: "blouse",
      occlusions: ["Right shoulder is hidden by a raised hand"],
      observations: [
        { attribute: "SLEEVE", value: "flutter sleeves", region: "left shoulder", confidence: 0.95 },
        { attribute: "DETAIL", value: "scalloped lace", region: "right shoulder", confidence: 0.95 }
      ]
    });
    expect(normalizeVisualEvidence(visual)).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "flutter sleeves", visibility: "VISIBLE", source: "OBSERVATION" }),
      expect.objectContaining({ value: "scalloped lace", visibility: "UNKNOWN" })
    ]));
    expect(relaxVisualProductInput(visual).distinctiveDetails).toEqual(["flutter sleeves"]);
  });

  it("does not reintroduce downgraded hard clues as exclusive model-authored constraints", () => {
    const visual = enforceVisualEvidenceAuthority(VisualProductInputSchema.parse({
      productType: "dress", brand: "DOEN", hardClues: ["sleeveless"]
    }));
    expect(classifyVisualProduct(visual, { title: "DOEN Long Sleeve Dress" })?.group).toBe("SAME_STYLE");
  });

  it("does not retain the hem or closure when those attributes are explicitly hidden", () => {
    const visual = VisualProductInputSchema.parse({
      productType: "dress", hem: "scalloped lace hem", closure: "back zipper",
      occlusions: ["The hem and back closure are outside the photograph"]
    });
    expect(isVisualAttributeOccluded(visual, "HEM")).toBe(true);
    expect(isVisualAttributeOccluded(visual, "CLOSURE")).toBe(true);
    expect(relaxVisualProductInput(visual).distinctiveDetails).toBeUndefined();
  });

  it("locks the visible product family before candidate-image review", () => {
    const visual = VisualProductInputSchema.parse({ productType: "women's blouse" });
    expect(hasVisualProductFamilyConflict(visual, { title: "DÔEN Adair Slide" })).toBe(true);
    expect(hasVisualProductFamilyConflict(visual, { title: "DÔEN leather pump" })).toBe(true);
    expect(hasVisualProductFamilyConflict(visual, { title: "DÔEN lace top", productType: "women's tops" })).toBe(false);
  });

  it("downgrades model-authored hard clues and removes inferred negative constraints", () => {
    const governed = enforceVisualEvidenceAuthority(VisualProductInputSchema.parse({
      productType: "women's dress",
      hardClues: ["square neckline", "maxi length"],
      softClues: ["heather gray"],
      negativeClues: ["long sleeves"]
    }));

    expect(governed.hardClues).toBeUndefined();
    expect(governed.negativeClues).toBeUndefined();
    expect(governed.softClues).toEqual(["heather gray", "square neckline", "maxi length"]);
  });

  it("keeps product family, color, length and only two structural details in the one relaxed visual search", () => {
    const relaxed = relaxVisualProductInput({
      brand: "DÔEN",
      productType: "women's mini dress",
      colors: ["black"],
      materials: ["lace"],
      patterns: ["horizontal lace bands"],
      styleClues: ["romantic vintage"],
      neckline: "boat neck",
      sleeveType: "cap sleeves",
      distinctiveDetails: ["horizontal shirred tiers", "scalloped lace hem", "decorative buttons"],
      hardClues: ["black lace"]
    });

    expect(relaxed).toMatchObject({
      brand: "DÔEN",
      productType: "mini dress",
      colors: ["black"],
      materials: [],
      patterns: [],
      styleClues: [],
      distinctiveDetails: ["horizontal shirred tiers", "scalloped lace hem"]
    });
    expect(visualOfficialStoreSearchQueries(relaxed)).toEqual([
      { stage: "FULL", query: "mini dress black smocked lace" },
      { stage: "CORE", query: "dress black mini smocked lace" },
      { stage: "SYNONYM", query: "dress black mini shirred lace" },
      { stage: "CATEGORY", query: "dress black mini" }
    ]);
  });

  it("preserves a useful subtype before broadening to the family", () => {
    expect(relaxVisualProductInput(VisualProductInputSchema.parse({
      productType: "off-shoulder lace mini dress",
      colors: ["black"]
    })).productType).toBe("mini dress");
  });

  it("meets the 95 percent visual-grouping gate on 30 golden tasks", async () => {
    const file = new URL("../../../tests/evals/visual-product-discovery-golden.json", import.meta.url);
    const tasks = z.array(GoldenTaskSchema).length(30).parse(JSON.parse(await readFile(file, "utf8")));
    const correct = tasks.filter((task) =>
      (classifyVisualProduct(task.visual, task.candidate)?.group ?? null) === task.expectedGroup
    );

    expect(correct.length / tasks.length).toBeGreaterThanOrEqual(0.95);
  });

  it("rejects an image reference without observed product evidence", () => {
    expect(() => VisualProductInputSchema.parse({ imageUrl: "https://example.com/item.jpg" })).toThrow();
  });

  it("accepts detailed visual descriptions without forcing a failed retry", () => {
    expect(VisualProductInputSchema.parse({
      productType: "women's mini dress",
      styleClues: [
        "wide ruffled lace shoulder straps",
        "low square scoop neckline",
        "gathered bust",
        "empire seam",
        "long center-front tie",
        "vertical scalloped lace panel",
        "wide ruffled mini hem"
      ]
    }).styleClues).toHaveLength(7);
  });

  it("accepts concise observation evidence above 100 characters but still rejects local image paths", () => {
    const evidence = "A broad layered ruffle crosses the chest and is finished with lace; a bow tie is visible at center front.";
    expect(evidence).toHaveLength(105);
    expect(VisualProductInputSchema.parse({
      productType: "blouse",
      observations: [{ attribute: "detail", value: "ruffle and bow", confidence: 0.97, evidence }]
    }).observations?.[0]?.evidence).toBe(evidence);
    expect(() => VisualProductInputSchema.parse({
      imageUrl: "C:\\Users\\chris\\AppData\\Local\\Temp\\reference.png",
      productType: "blouse"
    })).toThrow();
  });

  it("keeps direct observations separate from lower-confidence inferences", () => {
    const visual = VisualProductInputSchema.parse({
      productType: "women's dress",
      neckline: "square neck",
      sleeveType: "puff short sleeves",
      closure: "back zipper",
      distinctiveDetails: ["blue floral placement", "lace neckline trim"],
      imageQuality: "MEDIUM",
      occlusions: ["waist partly covered"],
      observations: [{
        attribute: "neckline",
        value: "square neck",
        confidence: 0.96,
        evidence: "front neckline visible"
      }],
      inferences: [{
        attribute: "material",
        value: "silk",
        confidence: 0.42,
        evidence: "surface appears shiny"
      }]
    });

    expect(visual.observations?.[0]).toMatchObject({ value: "square neck", confidence: 0.96 });
    expect(visual.inferences?.[0]).toMatchObject({ value: "silk", confidence: 0.42 });
  });

  it("uses multiple distinctive details as independent same-item evidence", () => {
    const result = classifyVisualProduct(VisualProductInputSchema.parse({
      productType: "women's dress",
      brand: "DÔEN",
      distinctiveDetails: ["blue floral placement", "smocked back panel", "lace neckline trim"]
    }), {
      title: "DÔEN blue floral dress",
      productType: "Dresses",
      brand: "DÔEN",
      description: "Blue floral placement with a smocked back panel and lace neckline trim"
    });

    expect(result?.group).toBe("POSSIBLE_SAME_ITEM");
  });

  it("matches Chinese compound fashion types against English catalog evidence", () => {
    const result = classifyVisualProduct({
      productType: "女士迷你连衣裙",
      brand: "DÔEN",
      colors: ["黑色"],
      materials: [],
      patterns: ["蕾丝"],
      silhouette: "收腰A字",
      length: "迷你",
      styleClues: ["船领", "分层裙摆"]
    }, {
      title: "DÔEN Black Lace Tiered Mini Dress",
      productType: "Dresses",
      brand: "DÔEN",
      description: "A black mini dress with lace panels and a tiered skirt."
    });

    expect(result).toMatchObject({ group: "POSSIBLE_SAME_ITEM" });
    expect(result?.evidence).toContain("product type matched: 女士迷你连衣裙");
  });

  it("keeps a brand-confirmed visual candidate when detailed attributes are not independently verified", () => {
    const result = classifyVisualProduct({
      productType: "女士迷你连衣裙",
      brand: "DÔEN",
      colors: ["黑色"],
      materials: [],
      patterns: ["蕾丝"],
      styleClues: []
    }, {
      title: "DÔEN Mini Dress",
      productType: "Dresses",
      brand: "DÔEN"
    });

    expect(result?.group).toBe("SAME_STYLE");
  });

  it("rejects a brand candidate with contradictory visual evidence", () => {
    const result = classifyVisualProduct({
      productType: "women's midi dress",
      brand: "DÔEN",
      colors: ["black"],
      materials: [],
      patterns: ["floral"],
      length: "midi",
      styleClues: ["lace trim"]
    }, {
      title: "DÔEN White Cotton Maxi Dress",
      productType: "Dresses",
      brand: "DÔEN",
      description: "A plain white full-length cotton dress."
    });

    expect(result).toBeUndefined();
  });

  it("rejects an unknown product type even when brand and colors overlap", () => {
    const result = classifyVisualProduct({
      productType: "pajama pants",
      brand: "SKIMS",
      colors: ["gray"],
      materials: [],
      patterns: ["plaid"],
      styleClues: [],
      hardClues: ["full length"],
      negativeClues: ["shorts"]
    }, {
      title: "SKIMS Boy Short Heather Gray",
      brand: "SKIMS",
      description: "Soft gray boy shorts"
    });

    expect(result).toBeUndefined();
  });

  it("rejects long sleeves for a sleeveless observed garment", () => {
    const result = classifyVisualProduct({
      productType: "women's dress",
      brand: "SKIMS",
      colors: ["brown"],
      materials: [],
      patterns: [],
      styleClues: [],
      hardClues: ["sleeveless", "square neck"]
    }, {
      title: "SKIMS Long Sleeve Brown Dress",
      productType: "Dresses",
      brand: "SKIMS",
      description: "Long sleeves and a crew neckline"
    });

    expect(result).toBeUndefined();
  });

  it("rejects explicit negative clues", () => {
    const result = classifyVisualProduct({
      productType: "women's dress",
      colors: ["ivory"],
      materials: [],
      patterns: [],
      styleClues: [],
      hardClues: ["boat neck", "sleeveless"],
      negativeClues: ["ruffled straps"]
    }, {
      title: "Ivory Ruffled Strap Dress",
      productType: "Dresses",
      description: "Ivory dress with wide ruffled straps"
    });

    expect(result).toBeUndefined();
  });

  it("matches an ASCII storefront brand and English style evidence to accented Chinese observations", () => {
    const result = classifyVisualProduct({
      productType: "女士迷你连衣裙",
      brand: "DÔEN",
      colors: ["黑色"],
      materials: [],
      patterns: ["蕾丝"],
      silhouette: "收腰A字",
      length: "迷你",
      styleClues: ["船领"]
    }, {
      title: "CORNELLA DRESS -- BLACK",
      productType: "FALL 26",
      brand: "DOEN",
      description: "Intricate lace, a mini silhouette, high bateau neckline, fitted bodice and full flared skirt."
    });

    expect(result).toMatchObject({ group: "POSSIBLE_SAME_ITEM", score: 105 });
    expect(result?.evidence).toContain("brand/logo matched: DÔEN");
  });

  it("still rejects a known contradictory product family", () => {
    const result = classifyVisualProduct({
      productType: "女士迷你连衣裙",
      colors: [],
      materials: [],
      patterns: [],
      styleClues: []
    }, {
      title: "Wide Leg Trousers",
      productType: "Pants"
    });

    expect(result).toBeUndefined();
  });

  it("keeps short sleeves distinct from mini length and searches a ribbed top as a t shirt", () => {
    const queries = visualOfficialStoreSearchQueries({
      productType: "women's fitted short-sleeve top",
      colors: ["olive brown"],
      materials: [],
      patterns: ["solid", "fine vertical rib knit"],
      styleClues: ["crew neck", "short sleeves"]
    });

    expect(queries[0]?.query).toContain("t shirt");
    expect(queries[0]?.query).toContain("ribbed");
    expect(queries[0]?.query).toContain("short sleeve");
    expect(queries[0]?.query).not.toContain("mini");
  });

  it("adds one bounded storefront synonym query for smocked and shirred descriptions", () => {
    const queries = visualOfficialStoreSearchQueries({
      productType: "women's dress",
      colors: ["cream"],
      materials: [],
      patterns: ["red floral bouquets"],
      styleClues: [],
      waist: "wide multi-row smocked waist",
      silhouette: "gathered full skirt"
    });

    expect(queries).toContainEqual({ stage: "FULL", query: "dress cream floral smocked" });
    expect(queries).toContainEqual({ stage: "SYNONYM", query: "dress cream floral shirred" });
    expect(queries.filter((attempt) => attempt.stage === "SYNONYM")).toHaveLength(1);
  });

  it("adds the official long-slip vocabulary for a fitted square-neck maxi dress", () => {
    const queries = visualOfficialStoreSearchQueries({
      brand: "SKIMS",
      productType: "women's dress",
      colors: ["heather gray"],
      materials: [],
      patterns: ["solid"],
      styleClues: [],
      silhouette: "fitted column bodycon",
      length: "maxi",
      neckline: "square neck",
      sleeveType: "sleeveless"
    });

    expect(queries).toContainEqual({ stage: "SYNONYM", query: "dress gray maxi long slip lounge" });
  });

  it("keeps distinctive neckline, sleeve, tie, ruffle, and slit structure in official queries", () => {
    const queries = visualOfficialStoreSearchQueries({
      productType: "women's dress",
      colors: ["ivory"],
      materials: [],
      patterns: [],
      styleClues: [],
      neckline: "off-shoulder sweetheart neckline",
      sleeveType: "flutter sleeves",
      distinctiveDetails: ["ruffled center-front tie", "side slit"]
    });
    const combined = queries.map((attempt) => attempt.query).join(" ");

    expect(combined).toContain("sweetheart neck");
    expect(combined).toContain("off shoulder");
    expect(combined).toContain("flutter sleeve");
    expect(combined).toContain("ruffle");
    expect(combined).toContain("tie front");
    expect(combined).toContain("slit");
  });

  it("does not use an obscured strap or sleeve as official-search evidence", () => {
    const queries = visualOfficialStoreSearchQueries({
      productType: "women's dress",
      colors: ["cream"],
      materials: [],
      patterns: ["red floral"],
      styleClues: [],
      sleeveType: "narrow straps",
      hardClues: ["narrow straps", "smocked waist"],
      occlusions: ["hair and phone partially obscure the upper straps"]
    });
    const combined = queries.map((attempt) => attempt.query).join(" ");

    expect(combined).not.toContain("strap");
    expect(combined).toContain("smocked");
  });

  it.each(DOEN_VISUAL_GOLDEN_CASES)(
    "builds a compact official-store query for $sourceImage",
    ({ visualInput, requiredQueryTerms }) => {
      const queries = visualOfficialStoreSearchQueries(visualInput);
      const full = queries.find((attempt) => attempt.stage === "FULL")?.query ?? "";
      const core = queries.find((attempt) => attempt.stage === "CORE")?.query ?? "";

      for (const term of requiredQueryTerms) expect(full).toContain(term);
      expect(full.split(/\s+/u).length).toBeLessThanOrEqual(10);
      expect(core.split(/\s+/u).length).toBeLessThanOrEqual(7);
    }
  );

  it("treats a catalog t shirt as compatible with an observed top", () => {
    const result = classifyVisualProduct({
      productType: "fitted top",
      colors: ["olive"],
      materials: [],
      patterns: ["ribbed"],
      styleClues: ["crew neck", "short sleeve"]
    }, {
      title: "NikeSKIMS Ribbed Seamless Baby T-Shirt Dusty Oakmoss",
      productType: "T-Shirts",
      description: "A fitted ribbed short sleeve crew-neck tee"
    });

    expect(result?.group).toBe("HIGHLY_SIMILAR");
  });
});
