import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  classifyShopifyCandidate,
  type ShopifyMatchCandidate,
  type ShopifyMatchStatus
} from "../../apps/mcp-server/src/shopify-match.js";

const goldenPath = new URL("./shopify-match-golden.json", import.meta.url);

describe("FindCheap v0.2.1 Shopify product matching gate", () => {
  it("classifies all 20 golden tasks deterministically", async () => {
    const golden = JSON.parse(await readFile(goldenPath, "utf8")) as {
      tasks: Array<{
        id: string;
        query: string;
        candidate: ShopifyMatchCandidate;
        expected: ShopifyMatchStatus;
      }>;
    };

    expect(golden.tasks).toHaveLength(20);
    expect(new Set(golden.tasks.map((task) => task.id)).size).toBe(20);
    for (const task of golden.tasks) {
      expect(classifyShopifyCandidate(task.query, task.candidate).status, task.id).toBe(task.expected);
    }
  });

  it("returns evidence and missing terms without mutating candidate data", () => {
    const candidate: ShopifyMatchCandidate = {
      title: "Sony WH-1000XM4 Headphones",
      brand: "Sony",
      sku: "WH1000XM4",
      productType: "Headphones",
      tags: [],
      gtins: [],
      variantDimensions: {}
    };
    const before = structuredClone(candidate);

    const result = classifyShopifyCandidate("Sony WH-1000XM5", candidate);

    expect(result).toMatchObject({ status: "SIMILAR", missingTerms: ["1000xm5"] });
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(candidate).toEqual(before);
  });

  it("does not mistake an SKU fragment for requested size evidence", () => {
    expect(classifyShopifyCandidate("Pride Tee size 10", {
      title: "Pride Tee",
      sku: "TEE-10-RED",
      productType: "T-Shirts",
      variantDimensions: { Size: "8" }
    })).toMatchObject({ status: "SIMILAR", missingTerms: ["10"] });
  });

  it("rejects accessories that repeat the requested model number", () => {
    expect(classifyShopifyCandidate("Sony WH-1000XM5", {
      title: "Protective Case for Sony WH-1000XM5",
      brand: "Generic",
      productType: "Cases"
    })).toMatchObject({ status: "IRRELEVANT" });
  });
});
