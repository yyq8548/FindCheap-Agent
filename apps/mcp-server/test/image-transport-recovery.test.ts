import { describe, expect, it, vi } from "vitest";
import { safeFetchWithProvenance } from "../../../packages/network-safety/src/safe-fetch.js";
import { createVisualCandidateImagePort, isRetryableVisualImageFailure } from "../src/visual-candidate-images.js";
import { SearchRun } from "../src/search-run.js";

const url = "https://cdn.shopify.com/s/files/item.webp?private=secret";
const bytes = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=", "base64");
const response = () => new Response(bytes, { headers: { "content-type": "image/webp" } });
const transient = () => Object.assign(new Error("secret URL"), { code: "ECONNRESET" });
function port(request: () => Promise<Response>) {
  return createVisualCandidateImagePort((input, policy) => safeFetchWithProvenance(input, {
    ...policy, resolve: async () => [{ address: "93.184.216.34", family: 4 }], request
  }));
}
const retry = { retryTransient: isRetryableVisualImageFailure };

describe("image transport recovery in the execution budget", () => {
  it("records request phase and permits only one counted retry", async () => {
    const request = vi.fn().mockRejectedValueOnce(transient()).mockResolvedValueOnce(response());
    const images = port(request); const run = new SearchRun();
    const read = (signal: AbortSignal) => images.load(url, { signal });
    const results = await Promise.all([run.read("IMAGE", url, read, retry), run.read("IMAGE", url, read, retry)]);
    expect(results[0]).toEqual(results[1]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(run.diagnostics()).toMatchObject({ imageRequests: 2, imageRetryRequests: 1 });
  });

  it("retains a failed retry receipt instead of retrying indefinitely", async () => {
    const request = vi.fn(async () => { throw transient(); }); const images = port(request); const run = new SearchRun();
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(run.read("IMAGE", url, signal => images.load(url, { signal }), retry)).rejects.toMatchObject({
        code: "CONNECTION_FAILED", sourceHost: "cdn.shopify.com", phase: "REQUEST"
      });
    }
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(run.diagnostics())).not.toMatch(/secret|shopify|private/iu);
  });

  it.each(["TLS", "REDIRECT", "429", "503", "DECODE"])("does not automatically retry %s", async failure => {
    const request = vi.fn(async () => {
      if (failure === "TLS") throw Object.assign(new Error("secret"), { code: "CERT_HAS_EXPIRED" });
      if (failure === "REDIRECT") return new Response(null, { status: 302, headers: { location: "https://unknown.example/item" } });
      if (failure === "DECODE") return new Response("not an image", { headers: { "content-type": "image/webp" } });
      return new Response(null, { status: Number(failure) });
    });
    const images = port(request); const run = new SearchRun();
    await expect(run.read("IMAGE", url, signal => images.load(url, { signal }), retry)).rejects.toBeInstanceOf(Error);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("cannot retry past 12 image reads or a cancelled flow", async () => {
    const request = vi.fn(async () => { throw transient(); }); const images = port(request); const run = new SearchRun();
    for (let index = 0; index < 11; index++) await run.read("IMAGE", String(index), async () => true);
    await expect(run.read("IMAGE", url, signal => images.load(url, { signal }), retry)).rejects.toBeInstanceOf(Error);
    expect(request).toHaveBeenCalledTimes(1);
    expect(run.diagnostics().imageRequests).toBe(12);
    const cancelled = new SearchRun();
    await expect(cancelled.withRequestSignal(AbortSignal.abort(), () => cancelled.read("IMAGE", url,
      signal => images.load(url, { signal }), retry))).rejects.toBeInstanceOf(Error);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not create more service time for a late transient failure", async () => {
    let now = 0;
    const run = new SearchRun({ serviceBudgetMs: 20, monotonicNow: () => now });
    const request = vi.fn(async () => { now = 21; throw transient(); });
    const images = port(request);
    await expect(run.read("IMAGE", url, signal => images.load(url, { signal }), retry)).rejects.toBeInstanceOf(Error);
    expect(request).toHaveBeenCalledTimes(1);
    expect(run.diagnostics()).toMatchObject({ imageRetryRequests: 0, serviceBudget: { remainingMs: 0 } });
  });
});
