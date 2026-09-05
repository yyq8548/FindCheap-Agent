import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema, type ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { createShoppingServer, type ProductCardContent } from "../src/server.js";
import { product, searchResult } from "./fixtures/conversation-replay-support.js";

const imageRequest = { query: "black lace mini dress", productType: "dress", responseLocale: "zh-CN", visualInput: {
  productType: "dress", colors: ["black"], length: "mini", neckline: "boat neck", distinctiveDetails: ["horizontal lace bands"]
} };
const url = "https://example-retailer.com/products/black-lace-dress";
const dress = (id = "web") => product({ handle: id, title: "Black lace mini dress", productType: "dress",
  description: "Black boat neck mini dress with horizontal lace bands.", sourceKind: "WEB_PRODUCT_PAGE", sourceHost: "example-retailer.com",
  merchantId: "example-retailer.com", merchant: "Example retailer", merchantUrl: id === "web" ? url : `${url}-${id}`,
  imageUrl: `https://images.example-retailer.com/${id}.jpg` });
type Review = { visualSessionId: string; candidates: Array<{ candidateId: string }> };
const match = { classification: "HIGHLY_SIMILAR", matches: [
  { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
  { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "boat neck" },
  { attribute: "LENGTH", referenceEvidence: "mini", candidateEvidence: "mini" },
  { attribute: "DISTINCTIVE_DETAIL", referenceEvidence: "horizontal lace bands", candidateEvidence: "horizontal lace bands" }
], conflicts: [] };
const conflict = { classification: "CONFLICT", matches: [], conflicts: [
  { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "shoes" }
] };

async function connect(options: { consent?: boolean; candidates?: number; malformedConsent?: boolean; imagesFail?: boolean;
  now?: () => Date; readAdvance?: () => void; wrongCategory?: boolean } = {}) {
  const network = vi.fn(async () => { throw new Error("NETWORK_FORBIDDEN_IN_CONVERSATION_REPLAY"); });
  vi.stubGlobal("fetch", network);
  const candidates = Array.from({ length: options.candidates ?? 0 }, (_, index) => { const candidate = dress(String(index)); delete candidate.sourceKind; return candidate; });
  const read = vi.fn(async () => { options.readAdvance?.(); return options.wrongCategory
    ? { ...dress(), title: "Black lace shoes", productType: "shoes", description: "Black lace shoes." } : dress(); });
  const load = vi.fn(async (value: string) => { if (options.imagesFail) throw new Error("REQUEST_FAILED");
    return { data: Buffer.from(`synthetic image ${value}`).toString("base64"), mimeType: "image/jpeg" as const }; });
  const server = createShoppingServer({ search: async () => searchResult(candidates) }, undefined, {
    awin: { search: async () => ({ source: "AWIN_PRODUCT_FEED", coverage: "COMPLETE", snapshotAt: new Date().toISOString(), products: [],
      diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 } }) },
    webProducts: { read }, visualCandidateImages: { load }, ...(options.now === undefined ? {} : { now: options.now })
  });
  const client = new Client({ name: "visual-web-recovery-replay", version: "1" }, { capabilities: { elicitation: { form: {} } } });
  const approve = vi.fn(async (): Promise<ElicitResult> => ({ action: "accept",
    content: { approved: options.malformedConsent ? "yes" : options.consent !== false } }));
  client.setRequestHandler(ElicitRequestSchema, approve);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  return { client, read, load, approve, close: async () => { await client.close(); await server.close(); expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); } };
}

describe("descriptor-only visual web recovery MCP contract", () => {
  it.each([0, 1])("keeps a failed visual goal after %i initial candidates, requiring authorization and review before cards", async candidates => {
    const replay = await connect({ candidates });
    try {
      let initial = await replay.client.callTool({ name: "search_visual_candidates", arguments: imageRequest });
      if (candidates > 0) {
        const review = initial.structuredContent as Review;
        initial = await replay.client.callTool({ name: "finalize_visual_search", arguments: { visualSessionId: review.visualSessionId,
          verdicts: review.candidates.map(candidate => ({ candidateId: candidate.candidateId, verdict: conflict })) } });
      }
      const parent = initial.structuredContent as ProductCardContent;
      expect(parent).toMatchObject({ renderId: expect.any(String), goalId: expect.any(String), recovery: { action: "REQUEST_WEB_SEARCH" } });
      const begin = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: parent.renderId } });
      expect(begin.structuredContent).toMatchObject({ status: "READY", diagnostics: { hostAction: "ACCEPT_TRUE" } });
      expect(JSON.stringify(begin.structuredContent)).not.toContain("imageUrl");
      const args = { renderId: parent.renderId, webSessionId: (begin.structuredContent as { webSessionId: string }).webSessionId, urls: [url] };
      const recovered = await replay.client.callTool({ name: "complete_web_search", arguments: args });
      expect(recovered.structuredContent).toMatchObject({ products: [], visualReview: { finalAnswerAllowed: false, requiredNextTool: "finalize_visual_search" } });
      expect(recovered._meta?.["findcheap/visualEvaluation"]).toMatchObject({ reviewedCandidates: [expect.objectContaining({ candidateId: expect.any(String) })] });
      const review = (recovered.structuredContent as ProductCardContent).visualReview as Review;
      const result = await replay.client.callTool({ name: "finalize_visual_search", arguments: { visualSessionId: review.visualSessionId,
        verdicts: review.candidates.map(candidate => ({ candidateId: candidate.candidateId, verdict: match })) } });
      expect(result.isError).not.toBe(true);
      const content = result.structuredContent as ProductCardContent;
      expect(content.goalId).toBe(parent.goalId);
      expect(content.products).toHaveLength(1);
      expect(content.products[0]).toMatchObject({ visualMatchGroup: "HIGHLY_SIMILAR", selectionId: expect.any(String) });
      expect(content.products[0]!.matchStatus).not.toBe("EXACT");
      expect((await replay.client.callTool({ name: "complete_web_search", arguments: args })).isError).toBe(true);
      expect((await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: content.renderId } })).isError).toBe(true);
      expect(replay.load.mock.calls.length).toBeLessThanOrEqual(12);
    } finally { await replay.close(); }
  });

  it("does not start image loading when page reads leave less than a full image budget in the lease", async () => {
    let clock = Date.now();
    const replay = await connect({ now: () => new Date(clock), readAdvance: () => { clock += 51_000; } });
    try {
      const initial = await replay.client.callTool({ name: "search_visual_candidates", arguments: imageRequest });
      const parent = initial.structuredContent as ProductCardContent;
      const begin = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: parent.renderId } });
      const result = await replay.client.callTool({ name: "complete_web_search", arguments: { renderId: parent.renderId,
        webSessionId: (begin.structuredContent as { webSessionId: string }).webSessionId, urls: [url] } });
      expect(result.structuredContent).toMatchObject({ products: [], goalId: parent.goalId,
        visualSearchFailure: { code: "SEARCH_BUDGET_EXHAUSTED" }, recovery: { action: "REPORT_INCOMPLETE" } });
      expect(result._meta?.["findcheap/visualEvaluation"]).toMatchObject({ reviewedCandidates: [], finalProductHashes: [] });
      expect(replay.read).toHaveBeenCalledTimes(1); expect(replay.load).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("malformed host form approval is an error, never permission", async () => {
    const replay = await connect({ malformedConsent: true });
    try {
      const initial = await replay.client.callTool({ name: "search_visual_candidates", arguments: imageRequest });
      const parent = initial.structuredContent as ProductCardContent;
      const result = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: parent.renderId } });
      expect(result.structuredContent).toMatchObject({ status: "PERMISSION_ERROR", diagnostics: { hostAction: "ERROR" } });
      expect(replay.read).not.toHaveBeenCalled(); expect(replay.load).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("cannot turn a recovered wrong-category page into a reviewed recommendation", async () => {
    const replay = await connect({ wrongCategory: true });
    try {
      const initial = await replay.client.callTool({ name: "search_visual_candidates", arguments: imageRequest });
      const parent = initial.structuredContent as ProductCardContent;
      const begin = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: parent.renderId } });
      const result = await replay.client.callTool({ name: "complete_web_search", arguments: { renderId: parent.renderId,
        webSessionId: (begin.structuredContent as { webSessionId: string }).webSessionId, urls: [url] } });
      expect(result.structuredContent).toMatchObject({ products: [], recovery: { action: "REPORT_INCOMPLETE" } });
      expect((result.structuredContent as ProductCardContent).visualReview).toBeUndefined();
      expect(replay.load).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("does not authorize recovery after all twelve image load attempts fail", async () => {
    const replay = await connect({ candidates: 18, imagesFail: true });
    try {
      const initial = await replay.client.callTool({ name: "search_visual_candidates", arguments: imageRequest });
      const content = initial.structuredContent as ProductCardContent;
      expect(content).toMatchObject({ recovery: { action: "REPORT_INCOMPLETE", reason: "BUDGET_EXHAUSTED" } });
      expect((await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: content.renderId } })).isError).toBe(true);
      expect(replay.approve).not.toHaveBeenCalled(); expect(replay.read).not.toHaveBeenCalled();
      expect(replay.load).toHaveBeenCalledTimes(12);
    } finally { await replay.close(); }
  });

  it("denial never reads pages or loads new images", async () => {
    const replay = await connect({ consent: false });
    try {
      const initial = await replay.client.callTool({ name: "search_visual_candidates", arguments: imageRequest });
      const parent = initial.structuredContent as ProductCardContent;
      const result = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: parent.renderId } });
      expect(result.structuredContent).toMatchObject({ status: "PERMISSION_DENIED", diagnostics: { hostAction: "ACCEPT_FALSE" } });
      expect(replay.read).not.toHaveBeenCalled(); expect(replay.load).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("two completed visual review rounds cannot acquire a third round through web recovery", async () => {
    const replay = await connect({ candidates: 8 });
    try {
      const initial = await replay.client.callTool({ name: "search_visual_candidates", arguments: imageRequest });
      let review = initial.structuredContent as Review;
      let result = await replay.client.callTool({ name: "finalize_visual_search", arguments: { visualSessionId: review.visualSessionId,
        verdicts: review.candidates.map(candidate => ({ candidateId: candidate.candidateId, verdict: conflict })) } });
      review = (result.structuredContent as ProductCardContent).visualReview as Review;
      expect(review).toBeDefined();
      result = await replay.client.callTool({ name: "finalize_visual_search", arguments: { visualSessionId: review.visualSessionId,
        verdicts: review.candidates.map(candidate => ({ candidateId: candidate.candidateId, verdict: conflict })) } });
      const content = result.structuredContent as ProductCardContent;
      expect(content).toMatchObject({ renderId: expect.any(String), goalId: expect.any(String), products: [], recovery: { action: "REPORT_INCOMPLETE" } });
      expect((await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: content.renderId } })).isError).toBe(true);
      expect(replay.approve).not.toHaveBeenCalled(); expect(replay.read).not.toHaveBeenCalled();
      expect(replay.load.mock.calls.length).toBeLessThanOrEqual(12);
    } finally { await replay.close(); }
  });
});
