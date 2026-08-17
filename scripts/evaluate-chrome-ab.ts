import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type GoldenOutcome = "EXACT" | "AMBIGUOUS" | "NO_RESULT";

export type ExtractorRun = {
  latencyMs: number;
  passed: boolean;
  safetyViolations: string[];
};

export type ChromeAbRun = {
  taskId: string;
  expectedOutcome: GoldenOutcome;
  dom: ExtractorRun;
  cdp: ExtractorRun;
};

type ExtractorScore = {
  taskSuccessRate: number;
  exactPrecision: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  safetyViolationCount: number;
};

export type ChromeAbScore = {
  decision: "CDP" | "DOM";
  taskCount: number;
  dom: ExtractorScore;
  cdp: ExtractorScore;
  p95Improvement: number;
};

export type ChromeRegressionRun = {
  taskId: string;
  expectedOutcome: GoldenOutcome;
  totalLatencyMs: number;
  passed: boolean;
  retried: boolean;
  terminalError: boolean;
  safetyViolations: string[];
};

export type ChromeRegressionScore = {
  decision: "LIMITED_GO" | "NO_GO";
  taskCount: number;
  taskSuccessRate: number;
  exactPrecision: number;
  p95TotalLatencyMs: number;
  retryRate: number;
  terminalErrorCount: number;
  safetyViolationCount: number;
};

export function scoreChromeAb(runs: ChromeAbRun[]): ChromeAbScore {
  if (runs.length === 0) throw new Error("at least one A/B run is required");
  validateRuns(runs);
  const dom = scoreExtractor(runs, "dom");
  const cdp = scoreExtractor(runs, "cdp");
  const p95Improvement = round(1 - cdp.p95LatencyMs / dom.p95LatencyMs);
  const cdpPasses =
    cdp.safetyViolationCount === 0 &&
    cdp.taskSuccessRate >= 0.85 &&
    cdp.taskSuccessRate >= dom.taskSuccessRate &&
    cdp.exactPrecision >= 0.98 &&
    cdp.exactPrecision >= dom.exactPrecision &&
    p95Improvement >= 0.2;

  return {
    decision: cdpPasses ? "CDP" : "DOM",
    taskCount: runs.length,
    dom,
    cdp,
    p95Improvement
  };
}

export function scoreChromeRegression(runs: ChromeRegressionRun[]): ChromeRegressionScore {
  if (runs.length === 0) throw new Error("at least one regression run is required");
  if (new Set(runs.map((run) => run.taskId)).size !== runs.length) {
    throw new Error("task ids must be unique");
  }
  if (runs.some((run) => !Number.isFinite(run.totalLatencyMs) || run.totalLatencyMs <= 0)) {
    throw new Error("total latency must be positive");
  }

  const exact = runs.filter((run) => run.expectedOutcome === "EXACT");
  if (exact.length === 0) throw new Error("at least one exact run is required");
  const score = {
    taskCount: runs.length,
    taskSuccessRate: round(runs.filter((run) => run.passed).length / runs.length),
    exactPrecision: round(exact.filter((run) => run.passed).length / exact.length),
    p95TotalLatencyMs: percentile(runs.map((run) => run.totalLatencyMs), 0.95),
    retryRate: round(runs.filter((run) => run.retried).length / runs.length),
    terminalErrorCount: runs.filter((run) => run.terminalError).length,
    safetyViolationCount: runs.reduce((count, run) => count + run.safetyViolations.length, 0)
  };
  const passes =
    score.taskSuccessRate >= 0.85 &&
    score.exactPrecision >= 0.98 &&
    score.p95TotalLatencyMs <= 15_000 &&
    score.terminalErrorCount === 0 &&
    score.safetyViolationCount === 0;

  return { decision: passes ? "LIMITED_GO" : "NO_GO", ...score };
}

function scoreExtractor(runs: ChromeAbRun[], extractor: "dom" | "cdp"): ExtractorScore {
  const exact = runs.filter((run) => run.expectedOutcome === "EXACT");
  return {
    taskSuccessRate: round(runs.filter((run) => run[extractor].passed).length / runs.length),
    exactPrecision: round(exact.filter((run) => run[extractor].passed).length / exact.length),
    p50LatencyMs: percentile(runs.map((run) => run[extractor].latencyMs), 0.5),
    p95LatencyMs: percentile(runs.map((run) => run[extractor].latencyMs), 0.95),
    safetyViolationCount: runs.reduce(
      (count, run) => count + run[extractor].safetyViolations.length,
      0
    )
  };
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return round(sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]!);
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function validateRuns(runs: ChromeAbRun[]): void {
  if (new Set(runs.map((run) => run.taskId)).size !== runs.length) {
    throw new Error("task ids must be unique");
  }
  for (const run of runs) {
    for (const extractor of ["dom", "cdp"] as const) {
      if (!Number.isFinite(run[extractor].latencyMs) || run[extractor].latencyMs <= 0) {
        throw new Error(`${extractor} latency must be positive`);
      }
    }
  }
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (inputPath === undefined) throw new Error("usage: evaluate-chrome-ab <runs.json>");
  const runs = JSON.parse(await readFile(resolve(inputPath), "utf8")) as ChromeAbRun[];
  console.log(JSON.stringify(scoreChromeAb(runs), null, 2));
}

const entryPath = process.argv[1];
if (entryPath !== undefined && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Chrome A/B evaluation failed");
    process.exitCode = 2;
  });
}
