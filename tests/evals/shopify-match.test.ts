import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  classifyShopifyCandidate,
  hasSpecificProductIdentity,
  type ShopifyMatchCandidate,
  type ShopifyMatchStatus
} from "../../apps/mcp-server/src/shopify-match.js";

const goldenPath = new URL("./shopify-match-golden.json", import.meta.url);

describe("FindCheap v0.5.4 Shopify product matching gate", () => {
  it("classifies all 30 golden tasks deterministically", async () => {
    const golden = JSON.parse(await readFile(goldenPath, "utf8")) as {
      tasks: Array<{
        id: string;
        query: string;
        candidate: ShopifyMatchCandidate;
        expected: ShopifyMatchStatus;
      }>;
    };

    expect(golden.tasks).toHaveLength(30);
    expect(new Set(golden.tasks.map((task) => task.id)).size).toBe(30);
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

  it("does not accept a longer model that only contains the requested model as a prefix", () => {
    expect(classifyShopifyCandidate("Sony WH-1000XM5", {
      title: "Sony WH-1000XM50 Headphones",
      brand: "Sony",
      sku: "WH1000XM50",
      productType: "Headphones"
    })).toMatchObject({ status: "SIMILAR", missingTerms: ["1000xm5"] });
  });

  it("accepts normalized exact MPN evidence", () => {
    expect(classifyShopifyCandidate("Sony WH-1000XM5", {
      title: "Sony Wireless Headphones",
      brand: "Sony",
      sku: "WH1000XM5",
      productType: "Headphones"
    })).toMatchObject({ status: "EXACT", evidence: expect.arrayContaining(["brand and MPN exact"]) });
  });

  it("accepts exact brand and MPN inside additional descriptive terms", () => {
    expect(classifyShopifyCandidate("Sony wireless WH-1000XM5 headphones", {
      title: "Sony Wireless Headphones",
      brand: "Sony",
      sku: "WH1000XM5",
      productType: "Headphones"
    })).toMatchObject({ status: "EXACT", evidence: expect.arrayContaining(["brand and MPN exact"]) });
  });

  it("accepts a MacBook product-family title when the translated query adds laptop", () => {
    expect(classifyShopifyCandidate("Apple MacBook Pro laptop", {
      title: "Apple MacBook Pro 14-inch",
      brand: "Apple",
      productType: "Computers"
    })).toMatchObject({
      status: "DISCOVERY_MATCH",
      missingTerms: [],
      evidence: expect.arrayContaining(["product category exact"])
    });
  });

  it("still rejects a non-laptop Apple product from a MacBook laptop query", () => {
    expect(classifyShopifyCandidate("Apple MacBook Pro laptop", {
      title: "Apple iPad Pro 14-inch",
      brand: "Apple",
      productType: "Tablets"
    })).toMatchObject({ status: "IRRELEVANT" });
  });

  it("does not call a keyword-only match exact", () => {
    expect(classifyShopifyCandidate("blue jeans", {
      title: "High Rise Blue Jeans",
      productType: "Jeans",
      variantDimensions: { Color: "Blue" }
    })).toMatchObject({ status: "DISCOVERY_MATCH" });
  });

  it("requires the candidate brand in the query before MPN evidence is exact", () => {
    expect(classifyShopifyCandidate("WH-1000XM5", {
      title: "Wireless Headphones",
      brand: "Sony",
      sku: "WH1000XM5",
      productType: "Headphones"
    })).toMatchObject({ status: "DISCOVERY_MATCH" });
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

  it("rejects a jeans-shaped accessory from a jeans search", () => {
    expect(classifyShopifyCandidate("blue jeans", {
      title: "Denim Jeans Key Charm",
      productType: "Accessories",
      variantDimensions: { Color: "Dark Denim" }
    })).toMatchObject({ status: "IRRELEVANT" });
  });

  it("keeps accessories when the user explicitly requests one", () => {
    expect(classifyShopifyCandidate("denim key charm", {
      title: "Denim Key Charm",
      productType: "Accessories"
    })).toMatchObject({ status: "DISCOVERY_MATCH" });
  });

  it.each([
    ["blue jeans", false],
    ["anime shirt", false],
    ["Sony headphones", false],
    ["Sony WH-1000XM5", true],
    ["810063341254", true],
    ["Allbirds Tree Runner shoes", true],
    ["Valhalla Java coffee", true]
  ] as const)("classifies same-product query specificity for %s", (query, expected) => {
    expect(hasSpecificProductIdentity(query)).toBe(expected);
  });
});
