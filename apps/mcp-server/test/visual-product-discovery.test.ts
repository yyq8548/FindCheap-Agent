import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  VisualProductInputSchema,
  classifyVisualProduct,
  relaxVisualProductInput,
  visualOfficialStoreSearchQueries
} from "../src/visual-product-discovery.js";
import { DOEN_VISUAL_GOLDEN_CASES } from "./fixtures/doen-visual-golden.js";

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
  it("removes uncertain visual details from the one allowed relaxed official search", () => {
    const relaxed = relaxVisualProductInput({
      brand: "DÔEN",
      productType: "women's mini dress",
      colors: ["black"],
      materials: ["lace"],
      patterns: ["horizontal lace bands"],
      styleClues: ["romantic vintage"],
      hardClues: ["boat neck", "cap sleeves"]
    });

    expect(relaxed).toMatchObject({
      brand: "DÔEN",
      productType: "women's mini dress",
      colors: [],
      materials: [],
      patterns: [],
      styleClues: []
    });
    expect(visualOfficialStoreSearchQueries(relaxed)).toEqual([
      { stage: "FULL", query: "dress" }
    ]);
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
