import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema, type ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { createShoppingServer, PRODUCT_SELECTION_SNAPSHOT_TTL_MS, type ShoppingServerDependencies, type ShopifyPort } from "../src/server.js";
import { product, REPLAY_NOW, searchResult } from "./fixtures/conversation-replay-support.js";

type ModelContext = {
  version: number;
  tool: string;
  status: string;
  renderId: string;
  goalId: string;
  goalRevision: number;
  requirementsVersion: number;
  requirementsSummary: Record<string, unknown>;
  recovery?: { action: string };
  products: Array<{ position: number; selectionId: string; title: string; itemPrice: { amountCents: number }; quoteCapability: string }>;
  entries?: Array<{ selectionId: string; position?: number }>;
  variants?: Array<{ variantId: string; position?: number; variantDimensions: Record<string, string> }>;
  visualSessionId: string;
  candidates: Array<{ candidateId: string; title: string }>;
  workflow?: { finalAnswerAllowed: boolean; requiredNextTool: string };
  visualReview?: { visualSessionId: string; finalAnswerAllowed: boolean; requiredNextTool: string; candidates: ModelContext["candidates"] };
  webSessionId?: string;
  queries?: string[];
  limits?: Record<string, number>;
  updatedSnapshot?: ModelContext;
};

type VisibleResult = { content?: unknown; isError?: unknown };

function visibleText(result: unknown): string {
  if (result === null || typeof result !== "object") return "";
  const blocks = (result as VisibleResult).content;
  if (!Array.isArray(blocks)) return "";
  return blocks.flatMap((block: unknown) => {
    if (block === null || typeof block !== "object") return [];
    const value = block as { type?: unknown; text?: unknown };
    return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
  }).join("\n");
}

// Model-visible text is the only channel this replay can consume. No SDK-only fields or injected IDs.
function context(result: unknown): ModelContext {
  expect(result).not.toBeNull();
  expect(typeof result).toBe("object");
  expect((result as VisibleResult).isError, visibleText(result)).not.toBe(true);
  const receipts = [...visibleText(result).matchAll(/<findcheap-external-data>\s*(\{[\s\S]*?\})\s*<\/findcheap-external-data>/gu)].flatMap(match => {
    const value = JSON.parse(match[1]!) as { findcheapContext?: ModelContext };
    return value.findcheapContext === undefined ? [] : [value.findcheapContext];
  });
  expect(receipts, "The model must receive exactly one parseable context receipt in text").toHaveLength(1);
  expect(receipts[0]?.version).toBe(1);
  return receipts[0]!;
}

async function connect(search: ShopifyPort["search"], options: {
  dependencies?: ShoppingServerDependencies;
  consent?: boolean;
} = {}) {
  const network = vi.fn(async () => { throw new Error("NETWORK_FORBIDDEN_IN_MODEL_CONTEXT_REPLAY"); });
  vi.stubGlobal("fetch", network);
  const server = createShoppingServer({ search }, undefined, {
    now: () => REPLAY_NOW,
    awin: { search: async () => ({ source: "AWIN_PRODUCT_FEED", coverage: "COMPLETE", snapshotAt: REPLAY_NOW.toISOString(), products: [],
      diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 } }) },
    ...options.dependencies
  });
  const client = new Client({ name: "model-visible-context-replay", version: "1" }, {
    capabilities: options.consent === undefined ? {} : { elicitation: { form: {} } }
  });
  const approve = vi.fn(async (): Promise<ElicitResult> => ({ action: "accept", content: { approved: options.consent === true } }));
  if (options.consent !== undefined) client.setRequestHandler(ElicitRequestSchema, approve);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  return { client, approve, close: async () => {
    try { await client.close(); await server.close(); expect(network).not.toHaveBeenCalled(); }
    finally { vi.unstubAllGlobals(); }
  } };
}

function twoProducts() {
  return [product(), product({ handle: "second-wig", title: "Another short human hair wig",
    merchantUrl: "https://ishowbeauty.com/products/second-wig", itemPrice: { amountCents: 4000, currency: "USD" } })];
}

describe("model-visible context replay (network forbidden)", () => {
  it("continues 01a07168 MacBook clarification and preserves use and size when only the budget changes", async () => {
    const search = vi.fn(async () => searchResult([]));
    const replay = await connect(search);
    try {
      const first = context(await replay.client.callTool({ name: "search_products", arguments: {
        query: "MacBook Pro", productType: "laptop computer", brand: "Apple", responseLocale: "zh-CN"
      } }));
      expect(first).toMatchObject({ tool: "search_products", status: "NEEDS_CLARIFICATION", renderId: expect.any(String),
        goalId: expect.any(String), goalRevision: 1, requirementsVersion: 1 });
      expect(search).not.toHaveBeenCalled();

      const second = context(await replay.client.callTool({ name: "search_products", arguments: {
        query: "MacBook Pro", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: first.renderId,
        primaryUse: "coding", requiredSize: "14-inch display", maxItemPriceCents: 300000, responseLocale: "zh-CN"
      } }));
      expect(second.status).not.toBe("NEEDS_CLARIFICATION");
      expect(search).toHaveBeenCalled();
      expect(second.goalId).toBe(first.goalId);
      expect(second.renderId).not.toBe(first.renderId);
      expect(second.requirementsSummary).toMatchObject({ brand: "Apple", primaryUse: "coding", requiredSize: "14-inch display", maxItemPriceCents: 300000 });

      const third = context(await replay.client.callTool({ name: "search_products", arguments: {
        query: "MacBook Pro", contextMode: "CONTINUE_PREVIOUS_PRODUCT", goalId: second.goalId, goalRevision: second.goalRevision,
        maxItemPriceCents: 200000, responseLocale: "zh-CN"
      } }));
      expect(third.goalId).toBe(first.goalId);
      expect(third.goalRevision).toBe(3);
      expect(third.requirementsVersion).toBe(3);
      expect(third.requirementsSummary).toMatchObject({ brand: "Apple", primaryUse: "coding", requiredSize: "14-inch display", maxItemPriceCents: 200000 });
    } finally { await replay.close(); }
  });

  it("rejects a missing continuation reference, then succeeds once with the prior text receipt", async () => {
    const search = vi.fn(async () => searchResult([]));
    const replay = await connect(search);
    try {
      const first = context(await replay.client.callTool({ name: "search_products", arguments: { query: "MacBook Pro", productType: "laptop computer" } }));
      const patch = { query: "MacBook Pro", contextMode: "CONTINUE_PREVIOUS_PRODUCT", primaryUse: "coding", requiredSize: "14-inch display", maxItemPriceCents: 300000 };
      const failed = await replay.client.callTool({ name: "search_products", arguments: patch });
      expect(failed.isError).toBe(true);
      expect(visibleText(failed)).toContain("MISSING_REFERENCE_CONTEXT");
      expect(visibleText(failed)).not.toContain("findcheapContext");
      expect(search).not.toHaveBeenCalled();
      const corrected = context(await replay.client.callTool({ name: "search_products", arguments: { ...patch, parentRenderId: first.renderId } }));
      expect(corrected.goalId).toBe(first.goalId);
      expect(corrected.goalRevision).toBe(2);
      expect(search).toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("compares visible card IDs and recovers a missing comparison reference without a new search", async () => {
    const search = vi.fn(async () => searchResult(twoProducts()));
    const replay = await connect(search);
    try {
      const first = context(await replay.client.callTool({ name: "search_products", arguments: { query: "wig", productType: "wig" } }));
      expect(first.products).toHaveLength(2);
      expect(first.products.map(item => item.position)).toEqual([1, 2]);
      expect(first.products[0]).toMatchObject({ title: expect.any(String), itemPrice: { amountCents: expect.any(Number) }, quoteCapability: "MERCHANT_CHECKOUT_ONLY" });
      const searchCalls = search.mock.calls.length;
      const selectionIds = first.products.map(item => item.selectionId).reverse();
      const missing = await replay.client.callTool({ name: "compare_selected_products", arguments: { selectionIds } });
      expect(missing.isError).toBe(true);
      expect(visibleText(missing)).toContain("MISSING_REFERENCE_CONTEXT");
      expect(visibleText(missing)).not.toContain("findcheapContext");
      const compared = context(await replay.client.callTool({ name: "compare_selected_products", arguments: { renderId: first.renderId, selectionIds } }));
      expect(compared).toMatchObject({ tool: "compare_selected_products", status: "OK", renderId: first.renderId });
      expect(compared.entries?.map(entry => entry.selectionId)).toEqual(selectionIds);
      expect(compared.entries?.every(entry => !("position" in entry))).toBe(true);
      expect(search.mock.calls.length).toBe(searchCalls);
      await replay.client.callTool({ name: "sync_product_card_selection", arguments: { renderId: first.renderId, selectionIds, revision: 1 } });
      expect(context(await replay.client.callTool({ name: "compare_selected_products", arguments: { renderId: first.renderId } })).status).toBe("OK");
    } finally { await replay.close(); }
  });

  it("rejects foreign and expired continuation references instead of choosing a latest snapshot", async () => {
    let current = REPLAY_NOW;
    const search = vi.fn(async () => searchResult([]));
    const replay = await connect(search, { dependencies: { now: () => current } });
    try {
      const first = context(await replay.client.callTool({ name: "search_products", arguments: { query: "wig", productType: "wig" } }));
      const calls = search.mock.calls.length;
      for (const parentRenderId of [randomUUID(), first.renderId]) {
        if (parentRenderId === first.renderId) current = new Date(current.getTime() + PRODUCT_SELECTION_SNAPSHOT_TTL_MS + 1);
        const result = await replay.client.callTool({ name: "search_products", arguments: { query: "wig", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId, maxItemPriceCents: 3000 } });
        expect(result.isError).toBe(true);
        expect(visibleText(result)).toContain("MISSING_REFERENCE_CONTEXT");
        expect(visibleText(result)).not.toContain("findcheapContext");
      }
      expect(search.mock.calls.length).toBe(calls);
    } finally { await replay.close(); }
  });

  it("rejects cross-snapshot and expired selections obtained from valid text receipts", async () => {
    let current = REPLAY_NOW;
    const replay = await connect(async () => searchResult(twoProducts()), { dependencies: { now: () => current } });
    try {
      const request = { name: "search_products", arguments: { query: "wig", productType: "wig" } };
      const first = context(await replay.client.callTool(request));
      const second = context(await replay.client.callTool(request));
      const mixed = context(await replay.client.callTool({ name: "compare_selected_products", arguments: {
        renderId: second.renderId, selectionIds: [first.products[0]!.selectionId, second.products[1]!.selectionId]
      } }));
      expect(mixed.status).toBe("CROSS_SNAPSHOT_UNSUPPORTED");
      current = new Date(current.getTime() + PRODUCT_SELECTION_SNAPSHOT_TTL_MS + 1);
      const expired = context(await replay.client.callTool({ name: "compare_selected_products", arguments: {
        renderId: second.renderId, selectionIds: second.products.map(item => item.selectionId)
      } }));
      expect(expired.status).toBe("SELECTION_UNAVAILABLE");
    } finally { await replay.close(); }
  });

  it("starts and completes bounded web recovery using only visible recovery and session receipts", async () => {
    const read = vi.fn(async () => product({ sourceKind: "WEB_PRODUCT_PAGE", title: "Anti-dandruff shampoo", productType: "shampoo",
      description: "Suitable for oily scalp.", merchantUrl: "https://example-retailer.com/products/shampoo", sourceHost: "example-retailer.com" }));
    const replay = await connect(async () => searchResult([]), { consent: true, dependencies: { webProducts: { read } } });
    try {
      const first = context(await replay.client.callTool({ name: "search_products", arguments: {
        query: "shampoo", productType: "shampoo", requiredFeatures: ["anti-dandruff", "suitable for oily scalp"], responseLocale: "zh-CN"
      } }));
      expect(first.products).toEqual([]);
      expect(first.recovery?.action).toBe("REQUEST_WEB_SEARCH");
      const begin = context(await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: first.renderId } }));
      expect(begin).toMatchObject({ status: "READY", webSessionId: expect.any(String), queries: ["shampoo anti-dandruff", "shampoo anti-dandruff oily scalp"],
        limits: { durationMs: 60000, merchantPages: 5, results: 3, discoveryQueries: 2 } });
      expect(replay.approve).toHaveBeenCalledTimes(1);
      const completed = context(await replay.client.callTool({ name: "complete_web_search", arguments: {
        renderId: first.renderId, webSessionId: begin.webSessionId, urls: ["https://example-retailer.com/products/shampoo"]
      } }));
      expect(read).toHaveBeenCalledTimes(1);
      expect(completed.goalId).toBe(first.goalId);
      expect(completed.renderId).not.toBe(first.renderId);
      expect(completed.requirementsSummary.requiredFeatures).toEqual(first.requirementsSummary.requiredFeatures);
      expect(completed.products).toHaveLength(1);
      expect(completed.products[0]?.selectionId).toEqual(expect.any(String));
    } finally { await replay.close(); }
  });

  it("preserves the host consent boundary even when the model sees the recovery reference", async () => {
    const read = vi.fn(async () => product());
    const replay = await connect(async () => searchResult([]), { dependencies: { webProducts: { read } } });
    try {
      const first = context(await replay.client.callTool({ name: "search_products", arguments: { query: "shampoo", productType: "shampoo" } }));
      expect(first.recovery?.action).toBe("REQUEST_WEB_SEARCH");
      const begin = context(await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: first.renderId } }));
      expect(begin.status).toBe("PERMISSION_UNAVAILABLE");
      expect(begin.webSessionId).toBeUndefined();
      expect(read).not.toHaveBeenCalled();
      expect(replay.approve).not.toHaveBeenCalled();
    } finally { await replay.close(); }
  });

  it("uses visible updatedSnapshot references after variant inspection and keeps the old snapshot valid", async () => {
    const shoes = [1001, 2001].map(id => product({ handle: String(id), title: "Ballet flats", productType: "ballet flats",
      variantDimensions: { Size: "US 5" }, checkoutPlatform: "SHOPIFY", merchantUrl: `https://ishowbeauty.com/products/shoe-${id}` }));
    const replay = await connect(async () => searchResult(shoes), { dependencies: { selectedProducts: { inspect: async selected => ({
      productTitle: selected.title, canonicalProductUrl: selected.merchantUrl,
      variants: [{ ...selected, handle: "1007", variantDimensions: { Size: "US 7" }, itemPrice: { amountCents: 4200, currency: "USD" },
        merchantUrl: selected.merchantUrl + "?variant=1007" }]
    }) } } });
    try {
      const first = context(await replay.client.callTool({ name: "search_products", arguments: { query: "ballet flats", productType: "ballet flats", requiredSize: "US 5" } }));
      const inspected = context(await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
        renderId: first.renderId, selectionId: first.products[0]!.selectionId, variantDimensions: { Size: "US 7" }
      } }));
      const next = inspected.updatedSnapshot!;
      expect(inspected.variants).toEqual([expect.objectContaining({ variantId: "1007", variantDimensions: { Size: "US 7" } })]);
      expect(inspected.variants?.every(variant => !("position" in variant))).toBe(true);
      expect(next).toMatchObject({ renderId: expect.any(String), requirementsVersion: 2, requirementsSummary: { requiredSize: "US 7" } });
      expect(next.renderId).not.toBe(first.renderId);
      expect(next.products).toHaveLength(2);
      expect(next.products.every(item => !first.products.some(old => old.selectionId === item.selectionId))).toBe(true);
      expect(context(await replay.client.callTool({ name: "compare_selected_products", arguments: {
        renderId: next.renderId, selectionIds: next.products.map(item => item.selectionId)
      } })).status).toBe("OK");
      expect(context(await replay.client.callTool({ name: "compare_selected_products", arguments: {
        renderId: first.renderId, selectionIds: first.products.map(item => item.selectionId)
      } })).status).toBe("OK");
    } finally { await replay.close(); }
  });

  it("keeps image blocks and uses only visible visual references through a second review round", async () => {
    const dresses = Array.from({ length: 7 }, (_, index) => product({ handle: `visible-dress-${index}`,
      title: `Ivory boat neck cap sleeve mini dress ${index}`, productType: "dress",
      description: "Ivory boat neck cap sleeve mini dress.", imageUrl: `https://cdn.shopify.com/visible-dress-${index}.jpg`,
      merchantUrl: `https://ishowbeauty.com/products/visible-dress-${index}` }));
    const load = vi.fn(async (url: string) => ({ data: Buffer.from(url).toString("base64"), mimeType: "image/jpeg" as const }));
    const replay = await connect(async () => searchResult(dresses), { dependencies: { visualCandidateImages: { load } } });
    const conflict = { classification: "CONFLICT", matches: [], conflicts: [
      { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "deep V neck" }
    ] };
    try {
      const initialResult = await replay.client.callTool({ name: "search_visual_candidates", arguments: {
        query: "ivory boat neck cap sleeve mini dress", productType: "dress", responseLocale: "zh-CN", visualInput: {
          productType: "dress", colors: ["ivory"], neckline: "boat neck", sleeveType: "cap sleeve", length: "mini"
        }
      } });
      const initial = context(initialResult);
      expect(initial).toMatchObject({ visualSessionId: expect.any(String), workflow: {
        finalAnswerAllowed: false, requiredNextTool: "finalize_visual_search"
      } });
      expect(initial.candidates).toHaveLength(6);
      expect(initial.candidates.every(candidate => typeof candidate.candidateId === "string")).toBe(true);
      expect(initialResult.content).toEqual(expect.arrayContaining(dresses.slice(0, 6).map(dress => expect.objectContaining({
        type: "image", data: Buffer.from(dress.imageUrl!).toString("base64"), mimeType: "image/jpeg"
      }))));
      const retryResult = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: initial.visualSessionId,
        verdicts: initial.candidates.map(candidate => ({ candidateId: candidate.candidateId, verdict: conflict }))
      } });
      const retry = context(retryResult);
      expect(retry.products).toEqual([]);
      const second = retry.visualReview!;
      expect(second).toMatchObject({ finalAnswerAllowed: false, requiredNextTool: "finalize_visual_search",
        visualSessionId: expect.any(String), candidates: [{ title: dresses[6]!.title, candidateId: expect.any(String) }] });
      expect(second.visualSessionId).not.toBe(initial.visualSessionId);
      expect(second.candidates.every(candidate => !initial.candidates.some(old => old.candidateId === candidate.candidateId))).toBe(true);
      expect(retryResult.content).toEqual(expect.arrayContaining([expect.objectContaining({
        type: "image", data: Buffer.from(dresses[6]!.imageUrl!).toString("base64"), mimeType: "image/jpeg"
      })]));
      const final = context(await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: second.visualSessionId, verdicts: second.candidates.map(candidate => ({ candidateId: candidate.candidateId,
          verdict: { classification: "HIGHLY_SIMILAR", conflicts: [], matches: [
            { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
            { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "boat neck" },
            { attribute: "SLEEVE", referenceEvidence: "cap sleeve", candidateEvidence: "cap sleeve" },
            { attribute: "LENGTH", referenceEvidence: "mini", candidateEvidence: "mini" }
          ] }
        }))
      } }));
      expect(final.products).toEqual([expect.objectContaining({ title: dresses[6]!.title, selectionId: expect.any(String) })]);
      expect(final.visualReview).toBeUndefined();
      expect(load).toHaveBeenCalledTimes(7);
    } finally { await replay.close(); }
  });
});
