import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  scoreChromeAb,
  scoreChromeRegression,
  type ChromeAbRun
} from "../../scripts/evaluate-chrome-ab.js";
import {
  classifyGoldenObservation,
  runWithSingleTransientRetry
} from "../../scripts/findcheap-browser-eval.js";

const goldenPath = new URL("./findcheap-chrome-golden.json", import.meta.url);

describe("FindCheap Chrome DOM/CDP golden evaluation", () => {
  it("freezes 20 representative, unique tasks", async () => {
    const golden = JSON.parse(await readFile(goldenPath, "utf8")) as {
      tasks: Array<{ id: string; category: string; query: string; expectedOutcome: string; expectedPageType?: string; expectedTokens: string[]; relevanceTokens?: string[] }>;
    };

    expect(golden.tasks).toHaveLength(20);
    expect(new Set(golden.tasks.map((task) => task.id)).size).toBe(20);
    expect(new Set(golden.tasks.map((task) => task.query)).size).toBe(20);
    expect(new Set(golden.tasks.map((task) => task.category)).size).toBeGreaterThanOrEqual(10);
    expect(golden.tasks.filter((task) => task.expectedOutcome === "EXACT")).toHaveLength(16);
    expect(golden.tasks.filter((task) => task.expectedOutcome === "AMBIGUOUS")).toHaveLength(2);
    expect(golden.tasks.filter((task) => task.expectedOutcome === "NO_RESULT")).toHaveLength(2);
    expect(golden.tasks.filter((task) => task.expectedOutcome === "EXACT").every((task) => task.expectedTokens.length > 0)).toBe(true);
    expect(golden.tasks.find((task) => task.id === "sku-sony-xm5")?.expectedPageType).toBe("DETAIL");
    expect(golden.tasks.filter((task) => task.expectedOutcome === "NO_RESULT").every((task) => task.relevanceTokens?.length)).toBe(true);
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

  it("classifies an exact SKU redirect from the product detail page", () => {
    expect(classifyGoldenObservation(
      { expectedOutcome: "EXACT", expectedPageType: "DETAIL", expectedTokens: ["sony", "wh-1000xm5"] },
      { pageType: "DETAIL", products: [{ title: "Sony WH-1000XM5 Headphones", url: "https://www.bestbuy.com/product/x/sku/6505727" }] }
    )).toBe(true);
  });

  it("treats unrelated recommendations as no relevant result", () => {
    expect(classifyGoldenObservation(
      { expectedOutcome: "NO_RESULT", expectedPageType: "SEARCH", expectedTokens: [], relevanceTokens: ["acme", "zzz", "99183"] },
      { pageType: "SEARCH", products: [{ title: "Blueair Air Purifier", url: "https://www.bestbuy.com/product/blueair/sku/1" }] }
    )).toBe(true);
  });

  it("retries one transient browser deadline and never retries access denial", async () => {
    let transientAttempts = 0;
    await expect(runWithSingleTransientRetry(async () => {
      transientAttempts += 1;
      if (transientAttempts === 1) throw new Error("CDP operation exceeded its deadline");
      return "ok";
    })).resolves.toBe("ok");
    expect(transientAttempts).toBe(2);

    let selectorAttempts = 0;
    await expect(runWithSingleTransientRetry(async () => {
      selectorAttempts += 1;
      if (selectorAttempts === 1) throw new Error("Playwright selector deadline exceeded");
      return "ok";
    })).resolves.toBe("ok");
    expect(selectorAttempts).toBe(2);

    let deniedAttempts = 0;
    await expect(runWithSingleTransientRetry(async () => {
      deniedAttempts += 1;
      throw new Error("access denied by site");
    })).rejects.toThrow(/access denied/u);
    expect(deniedAttempts).toBe(1);
  });

  it("allows a limited pilot only when the optimized regression clears every gate", () => {
    const runs = Array.from({ length: 20 }, (_, index) => ({
      taskId: `optimized-${index}`,
      expectedOutcome: index < 16 ? "EXACT" as const : index < 18 ? "AMBIGUOUS" as const : "NO_RESULT" as const,
      totalLatencyMs: 11_000,
      passed: true,
      retried: index < 15,
      terminalError: false,
      safetyViolations: []
    }));

    expect(scoreChromeRegression(runs)).toMatchObject({
      decision: "LIMITED_GO",
      taskSuccessRate: 1,
      exactPrecision: 1,
      p95TotalLatencyMs: 11_000,
      retryRate: 0.75,
      terminalErrorCount: 0,
      safetyViolationCount: 0
    });
  });
});
