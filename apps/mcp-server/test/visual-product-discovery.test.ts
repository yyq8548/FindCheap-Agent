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
});
