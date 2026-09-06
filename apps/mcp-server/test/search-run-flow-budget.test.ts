import { describe, expect, it, vi } from "vitest";
import { SearchBudgetError, SearchRun } from "../src/search-run.js";

describe("service-observed search flow budget", () => {
  it("never dispatches queued reads after an earlier operation crosses the deadline", async () => {
    let clock = 0;
    const run = new SearchRun({ monotonicNow: () => clock });
    const late = vi.fn(async () => "must not dispatch");
    const first = run.read("SHOPIFY", "clock-jump", async () => { clock = 90_000; return "late"; });
    const queued = run.read("SHOPIFY", "queued", late);
    const results = await Promise.allSettled([first, queued]);
    expect(results.every(result => result.status === "rejected" && result.reason instanceof SearchBudgetError)).toBe(true);
    expect(late).not.toHaveBeenCalled();
    expect(run.diagnostics()).toMatchObject({ readTimeouts: 2, budgetExhausted: true });
  });

  it.each([
    { kind: "text", serviceBudgetMs: 90_000, beforeDeadlineMs: 89_999 },
    { kind: "visual", serviceBudgetMs: 180_000, beforeDeadlineMs: 179_999 }
  ])("stops new $kind reads at its deadline, including gaps between calls", async ({ serviceBudgetMs, beforeDeadlineMs }) => {
    let monotonicMs = 0;
    const options = { serviceBudgetMs, monotonicNow: () => monotonicMs, readTimeoutMs: 10_000 };
    const run = new SearchRun(options);
    const sourceRead = vi.fn(async () => ["verified candidate"]);

    expect(await run.read("SHOPIFY", "first", sourceRead)).toEqual(["verified candidate"]);
    monotonicMs = beforeDeadlineMs;
    expect(run.canRead("SHOPIFY")).toBe(true);
    expect(await run.read("SHOPIFY", "before-deadline", sourceRead)).toEqual(["verified candidate"]);

    monotonicMs = serviceBudgetMs;
    await expect(run.read("SHOPIFY", "at-deadline", sourceRead)).rejects.toBeInstanceOf(SearchBudgetError);
    expect(sourceRead).toHaveBeenCalledTimes(2);
    expect(run.canRead("SHOPIFY")).toBe(false);
  });

  it("terminates the flow on parent cancellation, including late providers and cached reads", async () => {
    const run = new SearchRun();
    await run.read("SHOPIFY", "cached", async () => "earlier evidence");
    const parent = new AbortController();
    let providerSignal: AbortSignal | undefined;
    let resolveProvider!: (value: string) => void;
    const lateWork = vi.fn();
    const pending = run.withRequestSignal(parent.signal, async () => {
      const result = await run.read("SHOPIFY", "slow", signal => {
        providerSignal = signal;
        return new Promise<string>(resolve => { resolveProvider = resolve; });
      });
      lateWork(result);
    });
    const rejected = expect(pending).rejects.toThrow("SEARCH_CANCELLED");
    await Promise.resolve();
    await Promise.resolve();
    parent.abort();
    await rejected;
    expect(providerSignal?.aborted).toBe(true);
    resolveProvider("ignored late result");
    await Promise.resolve();
    expect(lateWork).not.toHaveBeenCalled();
    await expect(run.read("SHOPIFY", "cached", async () => "wrong")).rejects.toThrow("SEARCH_CANCELLED");
    await expect(run.withRequestSignal(new AbortController().signal, async () => "resumed"))
      .rejects.toThrow("SEARCH_CANCELLED");
    expect(run.diagnostics()).toMatchObject({ budgetExhausted: false, serviceBudget: { cancelled: true } });
  });

  it("rejects an already cancelled parent before dispatch and detaches completed request listeners", async () => {
    const run = new SearchRun();
    const oldParent = new AbortController();
    const remove = vi.spyOn(oldParent.signal, "removeEventListener");
    expect(await run.withRequestSignal(oldParent.signal, async () => "complete")).toBe("complete");
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    oldParent.abort();
    expect(run.signal.aborted).toBe(false);
    const parent = new AbortController();
    parent.abort();
    const source = vi.fn(async () => "unreachable");
    await expect(run.withRequestSignal(parent.signal, () => run.read("SHOPIFY", "first", source)))
      .rejects.toThrow("SEARCH_CANCELLED");
    expect(source).not.toHaveBeenCalled();
  });

  it("detaches flow listeners when an ignored provider abort times out", async () => {
    vi.useFakeTimers();
    try {
      const run = new SearchRun({ readTimeoutMs: 10 });
      const remove = vi.spyOn(run.signal, "removeEventListener");
      const pending = run.read("SHOPIFY", "stalled", () => new Promise(() => {}));
      const rejected = expect(pending).rejects.toThrow("SEARCH_READ_TIMEOUT");
      await vi.advanceTimersByTimeAsync(10);
      await rejected;
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    } finally { vi.useRealTimers(); }
  });

  it("subtracts only a verified wait and resumes the service clock after failure", async () => {
    let clock = 0;
    const run = new SearchRun({ serviceBudgetMs: 90_000, monotonicNow: () => clock });
    clock = 89_000;
    await expect(run.withVerifiedUserWait(async () => {
      clock += 20_000;
      expect(run.remainingServiceMs()).toBe(1_000);
      throw new Error("host declined");
    })).rejects.toThrow("host declined");
    expect(run.diagnostics().serviceBudget).toMatchObject({ elapsedMs: 109_000,
      verifiedUserWaitMs: 20_000, activeMs: 89_000, remainingMs: 1_000 });
    clock += 1_000;
    expect(run.canRead("SHOPIFY")).toBe(false);
    const hostWait = vi.fn(async () => true);
    await expect(run.withVerifiedUserWait(hostWait)).rejects.toThrow("SEARCH_BUDGET_EXHAUSTED");
    expect(hostWait).not.toHaveBeenCalled();
  });

  it("does not pause while source IO is active or admit source IO during a verified wait", async () => {
    const run = new SearchRun();
    let finishRead!: () => void;
    const reading = run.read("SHOPIFY", "busy", () => new Promise<void>(resolve => { finishRead = resolve; }));
    await Promise.resolve();
    const wait = vi.fn(async () => true);
    await expect(run.withVerifiedUserWait(wait)).rejects.toThrow("SEARCH_WAIT_NOT_ALLOWED");
    expect(wait).not.toHaveBeenCalled();
    finishRead();
    await reading;
    await run.withVerifiedUserWait(async () => {
      expect(run.canRead("SHOPIFY")).toBe(false);
      await expect(run.read("SHOPIFY", "during-consent", async () => true)).rejects.toThrow("SEARCH_WAIT_NOT_ALLOWED");
    });
  });

  it("records service-time image truncation without fabricating a quota on cancellation", async () => {
    let clock = 0;
    const run = new SearchRun({ monotonicNow: () => clock });
    clock = 90_000;
    run.noteUnattemptedImages(2);
    expect(run.diagnostics()).toMatchObject({ imageRequests: 0, activeDurationMs: 0,
      imageReviewStop: { reason: "SERVICE_TIME_LIMIT", unattemptedCandidates: 2 } });
    const cancelled = new SearchRun();
    const parent = new AbortController();
    parent.abort();
    await expect(cancelled.withRequestSignal(parent.signal, async () => true)).rejects.toThrow("SEARCH_CANCELLED");
    cancelled.noteUnattemptedImages(2);
    expect(cancelled.diagnostics()).not.toHaveProperty("imageReviewStop");
    expect(cancelled.diagnostics().budgetExhausted).toBe(false);
  });

  it("counts concurrent network time once and ignores wall-clock jumps", async () => {
    vi.useFakeTimers();
    try {
      const run = new SearchRun({ activeBudgetMs: 30_000, readTimeoutMs: 10_000 });
      const pending = ["a", "b"].map(key => run.read("SHOPIFY", key,
        () => new Promise(resolve => setTimeout(() => resolve(key), 100))));
      await vi.advanceTimersByTimeAsync(100);
      expect(await Promise.all(pending)).toEqual(["a", "b"]);
      expect(run.diagnostics().activeDurationMs).toBe(100);
      vi.setSystemTime(new Date("2000-01-01T00:00:00Z"));
      expect(run.remainingServiceMs()).toBe(89_900);
      await vi.advanceTimersByTimeAsync(89_900);
      expect(run.canRead("SHOPIFY")).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("resumes a verified wait when the current request is cancelled", async () => {
    let clock = 0;
    const run = new SearchRun({ monotonicNow: () => clock });
    const parent = new AbortController();
    const pending = run.withRequestSignal(parent.signal, () => run.withVerifiedUserWait(() => new Promise(() => {})));
    const rejected = expect(pending).rejects.toThrow("SEARCH_CANCELLED");
    await Promise.resolve();
    clock = 1_000;
    parent.abort();
    await rejected;
    await Promise.resolve();
    clock = 2_000;
    expect(run.diagnostics().serviceBudget.verifiedUserWaitMs).toBe(1_000);
  });

  it.each([
    { duration: 10_001, reason: "SEARCH_READ_TIMEOUT", budgetExhausted: false },
    { duration: 90_000, reason: "SEARCH_BUDGET_EXHAUSTED", budgetExhausted: true }
  ])("rejects a $duration ms late result before timers get an event-loop turn", async ({ duration, reason, budgetExhausted }) => {
    let clock = 0;
    const run = new SearchRun({ monotonicNow: () => clock });
    let signal: AbortSignal | undefined;
    await expect(run.read("SHOPIFY", "late", async current => {
      signal = current;
      clock = duration;
      return "too late";
    })).rejects.toThrow(reason);
    expect(signal?.aborted).toBe(true);
    expect(run.diagnostics()).toMatchObject({ readTimeouts: 1, budgetExhausted });
  });
});
