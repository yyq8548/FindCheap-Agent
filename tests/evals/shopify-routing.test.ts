import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { scoreShopifyRouting, type ShopifyRoutingRun } from "../../scripts/evaluate-shopify-routing.js";

const goldenPath = new URL("./findcheap-chrome-golden.json", import.meta.url);

describe("FindCheap v0.1.2 Shopify routing gate", () => {
  it("passes all 20 golden tasks with one Shopify call and correct Chrome routing", async () => {
    const golden = JSON.parse(await readFile(goldenPath, "utf8")) as {
      tasks: Array<{ id: string; expectedOutcome: "EXACT" | "AMBIGUOUS" | "NO_RESULT" }>;
    };
    const runs: ShopifyRoutingRun[] = golden.tasks.map((task, index) => {
      const empty = task.expectedOutcome === "NO_RESULT";
      return {
        taskId: task.id,
        shopifyToolCalls: 1,
        status: "OK",
        coverage: "COMPLETE",
        productCount: empty ? 0 : 3,
        chromeUsed: empty,
        totalLatencyMs: 900 + index
      };
    });

    expect(scoreShopifyRouting(runs)).toEqual({
      decision: "PASS",
      taskCount: 20,
      redundantToolCallCount: 0,
      routingViolationCount: 0,
      p95TotalLatencyMs: 918
    });
  });

  it("fails duplicate Shopify calls and unsafe Chrome fallback", () => {
    expect(scoreShopifyRouting([{
      taskId: "regression",
      shopifyToolCalls: 2,
      status: "OK",
      coverage: "PARTIAL",
      productCount: 1,
      chromeUsed: true,
      totalLatencyMs: 1_000
    }])).toMatchObject({
      decision: "FAIL",
      redundantToolCallCount: 1,
      routingViolationCount: 1
    });
  });
});
