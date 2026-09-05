import { describe, expect, it } from "vitest";
import { SearchRun } from "../src/search-run.js";

describe("safe visual funnel", () => {
  it("does not add visual metadata to ordinary text searches", () => {
    expect(new SearchRun().diagnostics()).not.toHaveProperty("visualFunnel");
  });

  it("records bounded fingerprints and counts without query or URL text", () => {
    const run = new SearchRun();
    run.recordVisualStage("NORMALIZED", [{ productHash: "a".repeat(64), imageUrlHash: "b".repeat(64) },
      { productHash: "https://private.example/token" }], { source: "SHOPIFY", queryHash: "not a hash" });
    const value = run.diagnostics();
    expect(value.visualFunnel?.stages).toEqual([{ stage: "NORMALIZED", source: "SHOPIFY", count: 2,
      fingerprints: [{ productHash: "a".repeat(64), imageUrlHash: "b".repeat(64) }], fingerprintsTruncated: true }]);
    expect(JSON.stringify(value)).not.toMatch(/private|token|not a hash/u);
  });

  it("caps retained event and fingerprint data, not source counts", () => {
    const run = new SearchRun();
    const fingerprints = Array.from({ length: 100 }, (_, index) => ({ productHash: index.toString(16).padStart(64, "0") }));
    for (let index = 0; index < 55; index++) run.recordVisualStage("ELIGIBLE", fingerprints);
    const funnel = run.diagnostics().visualFunnel!;
    expect(funnel.stages.length).toBeLessThanOrEqual(48);
    expect(funnel.stages.flatMap(stage => stage.fingerprints).length).toBeLessThanOrEqual(256);
    expect(funnel.stages.every(stage => stage.count === 100)).toBe(true);
    expect(funnel.truncated).toBe(true);
  });

  it("returns copies that cannot mutate the retained trace", () => {
    const run = new SearchRun();
    run.recordVisualStage("FINAL", [{ productHash: "a".repeat(64) }], { round: 2 });
    run.diagnostics().visualFunnel!.stages[0]!.fingerprints[0]!.productHash = "changed";
    expect(run.diagnostics().visualFunnel!.stages[0]!.fingerprints[0]!.productHash).toBe("a".repeat(64));
  });
});
