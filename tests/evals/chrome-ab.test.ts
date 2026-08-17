import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  scoreChromeAb,
  scoreChromeRegression,
  type ChromeAbRun
} from "../../scripts/evaluate-chrome-ab.js";
import {
  classifyGoldenObservation,
  runWithSingleTransientRetry,
  selectBestVerifiedOptions
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

  it("accepts product pages from different HTTPS merchants and rejects discovery or unsafe URLs", () => {
    const expectation = { expectedOutcome: "EXACT" as const, expectedTokens: ["sony", "wh-1000xm5"] };

    expect(classifyGoldenObservation(expectation, {
      pageType: "DETAIL",
      products: [{ title: "Sony WH-1000XM5 Headphones", url: "https://www.walmart.com/ip/123" }]
    })).toBe(true);
    expect(classifyGoldenObservation(expectation, {
      pageType: "DETAIL",
      products: [{ title: "Sony WH-1000XM5 Headphones", url: "https://www.ebay.com/itm/123" }]
    })).toBe(true);
    expect(classifyGoldenObservation(expectation, {
      pageType: "SEARCH",
      products: [{ title: "Sony WH-1000XM5 Headphones", url: "https://www.google.com/search?q=sony" }]
    })).toBe(false);
    expect(classifyGoldenObservation(expectation, {
      pageType: "DETAIL",
      products: [{ title: "Sony WH-1000XM5 Headphones", url: "http://shop.example.com/product/123" }]
    })).toBe(false);
  });

  it("selects the three strongest direct exact offers from the verified Sony trial", () => {
    const selected = selectBestVerifiedOptions([
      { merchant: "Sony", sellerType: "DIRECT", title: "Sony WH-1000XM5 Black", url: "https://electronics.sony.com/p/wh1000xm5-b", match: "EXACT", variantMatch: true, itemPriceCents: 24800, availability: "IN_STOCK" },
      { merchant: "Best Buy", sellerType: "DIRECT", title: "Sony WH1000XM5/B", url: "https://www.bestbuy.com/site/6505727.p", match: "EXACT", variantMatch: true, itemPriceCents: 24999, availability: "IN_STOCK" },
      { merchant: "Target", sellerType: "DIRECT", title: "Sony WH-1000XM5", url: "https://www.target.com/p/sony-wh-1000xm5/-/A-1", match: "EXACT", variantMatch: true, itemPriceCents: 24999, availability: "IN_STOCK" },
      { merchant: "Best Buy Marketplace", sellerType: "MARKETPLACE", title: "Sony WH-1000XM5", url: "https://www.bestbuy.com/marketplace/offer/1", match: "EXACT", variantMatch: true, itemPriceCents: 21900, availability: "IN_STOCK" },
      { merchant: "Example", sellerType: "DIRECT", title: "Sony WH-1000XM4", url: "https://shop.example.com/xm4", match: "SIMILAR", variantMatch: false, itemPriceCents: 19900, availability: "IN_STOCK" }
    ]);

    expect(selected.map((candidate) => candidate.merchant)).toEqual(["Sony", "Best Buy", "Target"]);
  });

  it("orders verified options by seller, availability, price, and stable tie-breakers", () => {
    const selected = selectBestVerifiedOptions([
      { merchant: "Marketplace", sellerType: "MARKETPLACE", title: "Exact", url: "https://market.example.com/1", match: "EXACT", variantMatch: true, itemPriceCents: 10000, availability: "IN_STOCK" },
      { merchant: "Unknown Stock", sellerType: "DIRECT", title: "Exact", url: "https://unknown.example.com/1", match: "EXACT", variantMatch: true, itemPriceCents: 20000, availability: "UNKNOWN" },
      { merchant: "Higher In Stock", sellerType: "DIRECT", title: "Exact", url: "https://higher.example.com/1", match: "EXACT", variantMatch: true, itemPriceCents: 22000, availability: "IN_STOCK" },
      { merchant: "Out Of Stock", sellerType: "DIRECT", title: "Exact", url: "https://out.example.com/1", match: "EXACT", variantMatch: true, itemPriceCents: 18000, availability: "OUT_OF_STOCK" },
      { merchant: "Lower In Stock", sellerType: "DIRECT", title: "Exact", url: "https://lower.example.com/1", match: "EXACT", variantMatch: true, itemPriceCents: 21000, availability: "IN_STOCK" },
      { merchant: "Wrong Variant", sellerType: "DIRECT", title: "Exact", url: "https://variant.example.com/1", match: "EXACT", variantMatch: false, itemPriceCents: 9000, availability: "IN_STOCK" }
    ]);

    expect(selected.map((candidate) => candidate.merchant)).toEqual([
      "Lower In Stock",
      "Higher In Stock",
      "Unknown Stock"
    ]);
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
