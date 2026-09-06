import { describe, expect, it } from "vitest";
import { SearchRun } from "../src/search-run.js";

describe("server-observed category clarification wait", () => {
  it("preserves the original service budget and review quota through one snapshot-bound wait", async () => {
    let clock = 0;
    const run = new SearchRun({ serviceBudgetMs: 180_000, monotonicNow: () => clock });
    await run.read("SHOPIFY", "earlier", async () => "cached");
    expect(run.claimVisualReviewRound()).toBe(true);
    clock = 10_000;
    expect(run.beginCategoryClarification("original-render")).toBe(true);
    clock = 191_000;
    expect(run.awaitingCategoryClarification()).toBe(true);
    expect(run.canRead("IMAGE")).toBe(false);
    expect(run.claimVisualReviewRound()).toBe(false);
    await expect(run.read("SHOPIFY", "earlier", async () => "wrong")).rejects.toThrow("SEARCH_WAIT_NOT_ALLOWED");
    await expect(run.withVerifiedUserWait(async () => true)).rejects.toThrow("SEARCH_WAIT_NOT_ALLOWED");
    expect(run.resumeCategoryClarification("unrelated-render")).toBe(false);
    expect(run.remainingServiceMs()).toBe(170_000);
    expect(run.resumeCategoryClarification("original-render")).toBe(true);
    expect(run.awaitingCategoryClarification()).toBe(false);
    expect(run.remainingVisualReviewRounds()).toBe(1);
    expect(run.diagnostics().serviceBudget).toMatchObject({ elapsedMs: 191_000, activeMs: 10_000,
      verifiedUserWaitMs: 0, observedClarificationWaitMs: 181_000, remainingMs: 170_000 });
    expect(JSON.stringify(run.diagnostics())).not.toContain("original-render");
    expect(run.resumeCategoryClarification("original-render")).toBe(false);
    expect(run.beginCategoryClarification("second-render")).toBe(false);
    clock = 192_000;
    expect(run.remainingServiceMs()).toBe(169_000);
    expect(await run.read("IMAGE", "after-answer", async () => "candidate")).toBe("candidate");
  });

  it("cannot pause busy, exhausted or cancelled flows or overlap a verified host wait", async () => {
    let clock = 0;
    const run = new SearchRun({ monotonicNow: () => clock });
    let finish!: () => void;
    const reading = run.read("SHOPIFY", "pending", () => new Promise<void>(resolve => { finish = resolve; }));
    await Promise.resolve();
    expect(run.beginCategoryClarification("while-reading")).toBe(false);
    finish();
    await reading;
    await run.withVerifiedUserWait(async () => {
      expect(run.beginCategoryClarification("while-authorizing")).toBe(false);
    });
    clock = 90_000;
    expect(run.beginCategoryClarification("expired")).toBe(false);
    const reviewed = new SearchRun();
    reviewed.claimVisualReviewRound();
    reviewed.claimVisualReviewRound();
    expect(reviewed.beginCategoryClarification("exhausted-rounds")).toBe(false);
    expect(reviewed.remainingVisualReviewRounds()).toBe(0);
    const cancelled = new SearchRun();
    const parent = new AbortController();
    parent.abort();
    await expect(cancelled.withRequestSignal(parent.signal, async () => true)).rejects.toThrow("SEARCH_CANCELLED");
    expect(cancelled.beginCategoryClarification("cancelled")).toBe(false);
  });

  it("freezes observed wait on cancellation without restoring execution or review budget", async () => {
    let clock = 0;
    const run = new SearchRun({ monotonicNow: () => clock });
    run.claimVisualReviewRound();
    expect(run.beginCategoryClarification("original")).toBe(true);
    clock = 2_000;
    const parent = new AbortController();
    parent.abort();
    await expect(run.withRequestSignal(parent.signal, async () => true)).rejects.toThrow("SEARCH_CANCELLED");
    clock = 3_000;
    expect(run.resumeCategoryClarification("original")).toBe(false);
    expect(run.beginCategoryClarification("new")).toBe(false);
    expect(run.canRead("IMAGE")).toBe(false);
    expect(run.claimVisualReviewRound()).toBe(false);
    expect(run.diagnostics()).toMatchObject({ visualReviewRounds: 1, serviceBudget: {
      cancelled: true, observedClarificationWaitMs: 2_000, verifiedUserWaitMs: 0, activeMs: 1_000 } });
  });
});
