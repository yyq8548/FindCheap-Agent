import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  VisualProductInputSchema,
  classifyVisualProduct
} from "../src/visual-product-discovery.js";

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
  it("meets the 80 percent visual-grouping gate on 30 golden tasks", async () => {
    const file = new URL("../../../tests/evals/visual-product-discovery-golden.json", import.meta.url);
    const tasks = z.array(GoldenTaskSchema).length(30).parse(JSON.parse(await readFile(file, "utf8")));
    const correct = tasks.filter((task) =>
      (classifyVisualProduct(task.visual, task.candidate)?.group ?? null) === task.expectedGroup
    );

    expect(correct.length / tasks.length).toBeGreaterThanOrEqual(0.8);
  });

  it("rejects an image reference without observed product evidence", () => {
    expect(() => VisualProductInputSchema.parse({ imageUrl: "https://example.com/item.jpg" })).toThrow();
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

  it("labels a brand-only candidate as same style instead of a strong visual match", () => {
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

    expect(result?.group).toBe("SAME_STYLE");
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
});
