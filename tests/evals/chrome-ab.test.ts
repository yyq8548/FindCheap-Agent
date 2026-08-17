import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { scoreChromeAb, type ChromeAbRun } from "../../scripts/evaluate-chrome-ab.js";

const goldenPath = new URL("./findcheap-chrome-golden.json", import.meta.url);

describe("FindCheap Chrome DOM/CDP golden evaluation", () => {
  it("freezes 20 representative, unique tasks", async () => {
    const golden = JSON.parse(await readFile(goldenPath, "utf8")) as {
      tasks: Array<{ id: string; category: string; query: string; expectedOutcome: string; expectedTokens: string[] }>;
    };

    expect(golden.tasks).toHaveLength(20);
    expect(new Set(golden.tasks.map((task) => task.id)).size).toBe(20);
    expect(new Set(golden.tasks.map((task) => task.query)).size).toBe(20);
    expect(new Set(golden.tasks.map((task) => task.category)).size).toBeGreaterThanOrEqual(10);
    expect(golden.tasks.filter((task) => task.expectedOutcome === "EXACT")).toHaveLength(16);
    expect(golden.tasks.filter((task) => task.expectedOutcome === "AMBIGUOUS")).toHaveLength(2);
    expect(golden.tasks.filter((task) => task.expectedOutcome === "NO_RESULT")).toHaveLength(2);
    expect(golden.tasks.filter((task) => task.expectedOutcome === "EXACT").every((task) => task.expectedTokens.length > 0)).toBe(true);
  });

  it("requires correctness parity, zero safety violations, and 20 percent p95 improvement", () => {
    const runs: ChromeAbRun[] = Array.from({ length: 20 }, (_, index) => ({
      taskId: `task-${index}`,
      expectedOutcome: index < 16 ? "EXACT" : index < 18 ? "AMBIGUOUS" : "NO_RESULT",
      dom: { latencyMs: 100, passed: true, safetyViolations: [] },
      cdp: { latencyMs: 75, passed: true, safetyViolations: [] }
    }));

    expect(scoreChromeAb(runs)).toMatchObject({
      decision: "CDP",
      taskCount: 20,
      dom: { taskSuccessRate: 1, safetyViolationCount: 0 },
      cdp: { taskSuccessRate: 1, safetyViolationCount: 0 },
      p95Improvement: 0.25
    });
  });

  it("keeps DOM when CDP is faster but less correct", () => {
    const runs: ChromeAbRun[] = Array.from({ length: 20 }, (_, index) => ({
      taskId: `task-${index}`,
      expectedOutcome: index < 16 ? "EXACT" : index < 18 ? "AMBIGUOUS" : "NO_RESULT",
      dom: { latencyMs: 100, passed: true, safetyViolations: [] },
      cdp: { latencyMs: 50, passed: index !== 0, safetyViolations: [] }
    }));

    expect(scoreChromeAb(runs).decision).toBe("DOM");
  });
});
