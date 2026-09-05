import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

// Sanitized regression shapes derived from the local six-photo trial, not live
// merchant facts or model-generated acceptance scores.
function dress(index: number, imageSuffix = "") {
  return product({ handle: `round-${index}`, title: `Ivory floral boat neck cap sleeve mini dress ${index}`,
    productType: "dress", description: "ivory floral boat neck cap sleeve mini dress",
    imageUrl: `https://cdn.shopify.com/round-${index}.jpg${imageSuffix}`,
    merchantUrl: `https://ishowbeauty.com/products/round-${index}` });
}

const request = { query: "ivory floral boat neck cap sleeve mini dress", productType: "dress", contextMode: "NEW_PRODUCT",
  responseLocale: "zh-CN", visualInput: { productType: "dress", colors: ["ivory"], patterns: ["floral"],
    neckline: "boat neck", sleeveType: "cap sleeve", length: "mini" } };
type Session = { visualSessionId: string; candidates: Array<{ candidateId: string; title: string }> };
const sessionOf = (value: unknown) => {
  const content = value as Session & { visualReview?: Session };
  return content.visualReview ?? content;
};
const conflict = { classification: "CONFLICT", matches: [], conflicts: [
  { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "deep V neck" }
] };

describe("cross-round visual regressions", () => {
  it.each([true, false])("reserves official continuation despite a full same-run tail; new result=%s", async fresh => {
    let second = false;
    const officialDress = (index: number) => ({ ...dress(index), merchant: "DÔEN", brand: "DÔEN",
      merchantId: "official-doen", sourceHost: "www.shopdoen.com",
      merchantUrl: `https://www.shopdoen.com/products/round-${index}` });
    const original = Array.from({ length: 9 }, (_, index) => officialDress(index));
    const search = vi.fn(async () => second && fresh ? [...original, officialDress(99)] : original);
    const replay = await connectReplay(async () => searchResult([]), {
      officialShopify: { search },
      visualCandidateImages: { load: async url => ({ data: Buffer.from(url).toString("base64"), mimeType: "image/jpeg" }) }
    });
    try {
      const first = await replay.client.callTool({ name: "search_visual_candidates", arguments: {
        ...request, brand: "DÔEN", brandMode: "REQUIRED", visualInput: { ...request.visualInput, brand: "DÔEN" }
      } });
      const initial = sessionOf(first.structuredContent);
      expect(initial.candidates).toHaveLength(6);
      const firstCalls = search.mock.calls.length;
      second = true;
      const next = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: initial.visualSessionId,
        verdicts: initial.candidates.map(({ candidateId }) => ({ candidateId, verdict: conflict }))
      } });
      expect(next.isError).not.toBe(true);
      expect(search.mock.calls.length).toBeGreaterThan(firstCalls);
      const candidates = sessionOf(next.structuredContent).candidates;
      expect(candidates).toHaveLength(3);
      expect(candidates.map(entry => entry.title)).toEqual([
        officialDress(6).title, officialDress(7).title, officialDress(fresh ? 99 : 8).title
      ]);
      expect(next._meta?.["findcheap/searchTrace"]).toMatchObject({ reviewed: 6, imageRequests: 9, budgetExhausted: false });
    } finally { await replay.close(); }
  });

  it("does not present the same product and image content twice when its CDN query changes", async () => {
    let second = false;
    const load = vi.fn(async (url: string) => ({
      // Resized output differs across rounds while the raw source stays identical.
      data: Buffer.from(url).toString("base64"), mimeType: "image/jpeg" as const,
      sourceContentSha256: createHash("sha256").update(new URL(url).pathname).digest("hex")
    }));
    const replay = await connectReplay(async () => searchResult(second
      ? [dress(0, "?width=900&v=new"), dress(7), dress(8), dress(9)]
      : Array.from({ length: 7 }, (_, index) => dress(index))), { visualCandidateImages: { load } });
    try {
      // A genuine relaxed provider query: remove a tentative name, retaining family/features.
      const first = await replay.client.callTool({ name: "search_visual_candidates", arguments: {
        ...request, visualInput: { ...request.visualInput, suspectedProductName: "Botanical collection" }
      } });
      const firstSession = sessionOf(first.structuredContent);
      expect(firstSession.candidates).toHaveLength(6);
      second = true;
      const next = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: firstSession.visualSessionId,
        verdicts: firstSession.candidates.map(({ candidateId }) => ({ candidateId, verdict: conflict }))
      } });
      expect(next.isError).not.toBe(true);
      const nextSession = sessionOf(next.structuredContent);
      expect(nextSession.candidates).toHaveLength(3);
      const previousTitles = new Set(firstSession.candidates.map(({ title }) => title));
      expect(nextSession.candidates.filter(({ title }) => previousTitles.has(title))).toEqual([]);
      expect(next._meta?.["findcheap/visualImageLoadDiagnostics"]).toMatchObject({ duplicateContentSkipped: 1 });
      expect(next._meta?.["findcheap/searchTrace"]).toMatchObject({ reviewed: 6, imageRequests: 10 });
    } finally { await replay.close(); }
  });

  it("retains prior insufficient evidence in the cumulative terminal reason and reviewed count", async () => {
    const replay = await connectReplay(async () => searchResult(Array.from({ length: 9 }, (_, index) => dress(index))), {
      visualCandidateImages: { load: async (url) => ({ data: Buffer.from(url).toString("base64"), mimeType: "image/jpeg" }) }
    });
    try {
      const first = await replay.client.callTool({ name: "search_visual_candidates", arguments: request });
      const initial = sessionOf(first.structuredContent);
      const next = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: initial.visualSessionId,
        verdicts: initial.candidates.map(({ candidateId }, index) => ({ candidateId, verdict: index === 0
          ? { classification: "SAME_STYLE", matches: [], conflicts: [] } : conflict }))
      } });
      const second = sessionOf(next.structuredContent);
      expect(second.candidates).toHaveLength(3);
      const final = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: second.visualSessionId,
        verdicts: second.candidates.map(({ candidateId }) => ({ candidateId, verdict: conflict }))
      } });
      expect(final.isError).not.toBe(true);
      expect(final.structuredContent).toMatchObject({ products: [], visualSearchFailure: { code: "VISUAL_EVIDENCE_INSUFFICIENT" } });
      expect(final._meta?.["findcheap/searchTrace"]).toMatchObject({ reviewed: 9, reviewConflicts: 8, reviewInsufficient: 1 });
      expect(JSON.stringify(final.structuredContent)).not.toContain("所有已检查图片都存在清晰");
    } finally { await replay.close(); }
  });
});
