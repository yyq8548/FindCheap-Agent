import { describe, expect, it, vi } from "vitest";
import { SearchRun, SearchBudgetError, SearchReadTimeoutError } from "../src/search-run.js";

describe("bounded search run", () => {
  it("aborts the underlying operation when its read deadline expires", async () => {
    vi.useFakeTimers();
    try {
      const run = new SearchRun({ readTimeoutMs: 20 });
      let signal: AbortSignal | undefined;
      const pending = run.read("IMAGE", "abortable", (value) => {
        signal = value;
        return new Promise(() => {});
      });
      const rejected = expect(pending).rejects.toBeInstanceOf(SearchReadTimeoutError);
      await vi.advanceTimersByTimeAsync(20);
      await rejected;
      expect(signal?.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("checks remaining capacity without falsely reporting an incomplete search", async () => {
    const run = new SearchRun();
    for (let index = 0; index < 12; index += 1) await run.read("IMAGE", String(index), async () => true);
    expect(run.remainingImageRequests()).toBe(0);
    expect(run.canRead("IMAGE")).toBe(false);
    expect(run.diagnostics().budgetExhausted).toBe(false);
    run.noteUnattemptedImages(0);
    expect(run.diagnostics().budgetExhausted).toBe(false);
    run.noteUnattemptedImages(2);
    expect(run.diagnostics()).toMatchObject({ budgetExhausted: true,
      imageReviewStop: { reason: "IMAGE_REQUEST_LIMIT", unattemptedCandidates: 2 } });
  });

  it("records active-time truncation only for remaining eligible work", () => {
    const run = new SearchRun({ activeBudgetMs: 0 });
    for (const count of [0, -1, NaN, 1.5]) run.noteUnattemptedImages(count);
    expect(run.diagnostics().budgetExhausted).toBe(false);
    run.noteUnattemptedImages(1);
    expect(run.diagnostics()).toMatchObject({ budgetExhausted: true,
      imageReviewStop: { reason: "ACTIVE_TIME_LIMIT", unattemptedCandidates: 1 } });
    const available = new SearchRun();
    available.noteUnattemptedImages(20);
    expect(available.diagnostics().budgetExhausted).toBe(false);
  });

  it("shares successful reads between retrieval passes without logging the query", async () => {
    const run = new SearchRun();
    const read = vi.fn(async () => ["candidate"]);
    expect(await run.read("SHOPIFY", "private-query", read)).toEqual(["candidate"]);
    expect(await run.read("SHOPIFY", "private-query", read)).toEqual(["candidate"]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(run.diagnostics()).toMatchObject({ catalogRequests: 1, cacheHits: 1, budgetExhausted: false });
    expect(JSON.stringify(run.diagnostics())).not.toContain("private-query");
  });

  it("caps catalog dispatch across rounds without retrying failed reads", async () => {
    const run = new SearchRun({ maxCatalogRequests: 1 });
    const read = vi.fn(async () => { throw new Error("private provider failure"); });
    await expect(run.read("AWIN", "one", read)).rejects.toThrow();
    await expect(run.read("AWIN", "one", read)).rejects.toThrow();
    await expect(run.read("SHOPIFY", "two", read)).rejects.toBeInstanceOf(SearchBudgetError);
    expect(read).toHaveBeenCalledTimes(1);
    expect(run.diagnostics().budgetExhausted).toBe(true);
  });

  it("bounds a stalled read and counts no human review time against active IO", async () => {
    vi.useFakeTimers();
    try {
      const run = new SearchRun({ activeBudgetMs: 50, readTimeoutMs: 30 });
      const stalled = run.read("IMAGE", "one", () => new Promise(() => {}));
      const rejected = expect(stalled).rejects.toBeInstanceOf(SearchReadTimeoutError);
      await vi.advanceTimersByTimeAsync(30);
      await rejected;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await run.read("IMAGE", "two", async () => "loaded")).toBe("loaded");
      expect(run.diagnostics().activeDurationMs).toBe(30);
      expect(run.diagnostics()).toMatchObject({ budgetExhausted: false, readTimeouts: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares pending images and failed URLs without retaining successful image bytes", async () => {
    const run = new SearchRun();
    const load = vi.fn(async () => "image-bytes");
    expect(await Promise.all([run.read("IMAGE", "shared-image", load), run.read("IMAGE", "shared-image", load)]))
      .toEqual(["image-bytes", "image-bytes"]);
    expect(load).toHaveBeenCalledOnce();
    await run.read("IMAGE", "shared-image", load);
    expect(load).toHaveBeenCalledTimes(2);
    const failure = vi.fn(async () => { throw new Error("IMAGE_UNAVAILABLE"); });
    await expect(run.read("IMAGE", "failed-image", failure)).rejects.toThrow("IMAGE_UNAVAILABLE");
    await expect(run.read("IMAGE", "failed-image", failure)).rejects.toThrow("IMAGE_UNAVAILABLE");
    expect(failure).toHaveBeenCalledOnce();
    expect(run.diagnostics()).toMatchObject({ imageRequests: 3, cacheHits: 2, budgetExhausted: false });
  });
});
