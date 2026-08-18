import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  selectSameProductGroup,
  type ShopifyIdentityCandidate
} from "../../apps/mcp-server/src/shopify-identity.js";

const goldenPath = new URL("./shopify-identity-golden.json", import.meta.url);

describe("FindCheap v0.3.0 same-product identity gate", () => {
  it("passes all 10 cross-merchant golden tasks", async () => {
    const golden = JSON.parse(await readFile(goldenPath, "utf8")) as {
      tasks: Array<{
        id: string;
        left: ShopifyIdentityCandidate;
        right: ShopifyIdentityCandidate;
        expected: "GTIN" | "BRAND_MPN" | null;
      }>;
    };

    expect(golden.tasks).toHaveLength(10);
    expect(new Set(golden.tasks.map((task) => task.id)).size).toBe(10);
    for (const task of golden.tasks) {
      expect(selectSameProductGroup([task.left, task.right])?.identityType ?? null, task.id)
        .toBe(task.expected);
    }
  });
});
