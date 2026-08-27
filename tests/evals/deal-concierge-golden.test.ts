import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { evaluateDealConcierge } from "../../apps/mcp-server/src/deal-concierge.js";

const goldenPath = new URL("./deal-concierge-golden.json", import.meta.url);

describe("Deal Concierge golden evaluation", () => {
  it("returns evidence-bounded decisions for all 30 tasks", async () => {
    const fixture = JSON.parse(await readFile(goldenPath, "utf8")) as {
      version: string;
      tasks: Array<{
        id: string;
        availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
        currentPriceCents?: number;
        historyUnavailable?: boolean;
        history: number[];
        expected: "BUY_NOW" | "WAIT" | "WATCH";
      }>;
    };
    expect(fixture.version).toBe("0.11.0");
    expect(fixture.tasks).toHaveLength(30);
    expect(new Set(fixture.tasks.map((task) => task.id)).size).toBe(30);

    for (const task of fixture.tasks) {
      const decision = evaluateDealConcierge({
        availability: task.availability,
        ...(task.currentPriceCents === undefined ? {} : { currentPriceCents: task.currentPriceCents }),
        basis: "ITEM_PRICE",
        observations: task.history.map((amountCents, index) => ({
          amountCents,
          currency: "USD" as const,
          basis: "ITEM_PRICE" as const,
          observedAt: `2026-07-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`
        })),
        ...(task.historyUnavailable === undefined ? {} : { historyUnavailable: task.historyUnavailable }),
        deals: []
      });
      expect(decision.recommendation, task.id).toBe(task.expected);
      if (decision.history.status !== "AVAILABLE") {
        expect(decision.history.historicalLowCents, task.id).toBeUndefined();
        expect(decision.history.typicalMedianCents, task.id).toBeUndefined();
      }
    }
  });
});
