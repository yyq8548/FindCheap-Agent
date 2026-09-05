import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { createShoppingServer, type ProductCardContent, type ShopifyPort } from "../src/server.js";
import { product, searchResult, REPLAY_NOW } from "./fixtures/conversation-replay-support.js";

// Synthetic workflow replay, not medical efficacy evidence or an LLM evaluation.
async function connect() {
  const network = vi.fn(async () => { throw new Error("NETWORK_FORBIDDEN_IN_CONVERSATION_REPLAY"); });
  vi.stubGlobal("fetch", network);
  const shampoo = (handle: string, description: string) => product({ handle, title: `${handle} shampoo`, brand: "Example",
    productType: "shampoo", description, merchantUrl: `https://ishowbeauty.com/products/${handle}` });
  const base = [shampoo("daily-a", "Gentle cleansing."), shampoo("daily-b", "Gentle cleansing.")];
  const dandruff = shampoo("dandruff-care", "Anti-dandruff shampoo. Suitable for color-treated hair.");
  const repair = shampoo("color-care", "Suitable for color-treated hair. Damaged hair repair.");
  const search = vi.fn<ShopifyPort["search"]>(async request => searchResult(request.query?.includes("anti-dandruff")
    ? [dandruff] : request.query?.includes("color-safe") ? [repair] : base));
  const read = vi.fn(async (url: string) => ({ ...shampoo("recovered", "Anti-dandruff shampoo. Suitable for color-treated hair. Damaged hair repair."),
    sourceKind: "WEB_PRODUCT_PAGE" as const, merchantUrl: url, handle: new URL(url).pathname.split("/").at(-1)! }));
  const server = createShoppingServer({ search }, undefined, { now: () => REPLAY_NOW, webProducts: { read }, awin: {
    search: async () => ({ source: "AWIN_PRODUCT_FEED", coverage: "COMPLETE", snapshotAt: REPLAY_NOW.toISOString(), products: [],
      diagnostics: { feedRows: 0, validRows: 0, rejectedRows: 0, queryMatches: 0, priceProductsExcluded: 0 } })
  } });
  const client = new Client({ name: "conversation-01a070aa-replay", version: "1" }, { capabilities: { elicitation: { form: {} } } });
  const approve = vi.fn(async () => ({ action: "accept" as const, content: { approved: true } }));
  client.setRequestHandler(ElicitRequestSchema, approve);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  return { client, search, read, approve, network, clientSend: vi.spyOn(a, "send"), serverSend: vi.spyOn(b, "send"),
    close: async () => { try { await client.close(); await server.close(); expect(network).not.toHaveBeenCalled(); }
      finally { vi.unstubAllGlobals(); } } };
}

describe("conversation 01a070aa workflow", () => {
  it("recovers after inherited constraints, compares selections, and retains old snapshots", async () => {
    const replay = await connect();
    try {
      const search = async (args: Record<string, unknown>) => {
        const result = await replay.client.callTool({ name: "search_products", arguments: { query: "shampoo", productType: "shampoo", responseLocale: "zh-CN", ...args } });
        expect(result.isError).not.toBe(true);
        return result.structuredContent as ProductCardContent;
      };
      const first = await search({});
      expect(first.products).toHaveLength(2);
      const dandruff = await search({ contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: first.renderId, requiredFeatures: ["anti-dandruff"], budgetFlexible: true });
      expect(dandruff.products.some(item => item.requirementAssessment?.status === "SATISFIED")).toBe(true);
      const repair = await search({ contextMode: "NEW_PRODUCT", requiredFeatures: ["suitable for color-treated hair", "damaged hair repair"] });
      const combined = await search({ contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: repair.renderId,
        requiredFeatures: ["anti-dandruff"], primaryUse: "dandruff control on color-treated hair" });
      expect(combined).toMatchObject({ requirementsSummary: { requiredFeatures: ["suitable for color-treated hair", "damaged hair repair", "anti-dandruff"] },
        recovery: { qualified: 0, recommendable: 0, action: "REQUEST_WEB_SEARCH" } });
      expect(combined.products.every(item => item.presentationGroup === "RESEARCH_ONLY")).toBe(true);
      expect(replay.search.mock.calls.at(-1)![0].query).toBe("shampoo anti-dandruff");
      const selectionIds = combined.products.slice(0, 2).map(item => item.selectionId!);
      const synced = await replay.client.callTool({ name: "sync_product_card_selection", arguments: { renderId: combined.renderId, selectionIds, revision: 1 } });
      expect(synced.structuredContent).toMatchObject({ status: "RECORDED" });
      const compared = await replay.client.callTool({ name: "compare_selected_products", arguments: { renderId: combined.renderId, responseLocale: "zh-CN" } });
      expect(compared.structuredContent).toMatchObject({ status: "OK", recommendation: { state: "RESEARCH_ONLY" } });
      const begin = await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: combined.renderId } });
      expect(begin.structuredContent).toMatchObject({ status: "READY", attempt: 1, queries: ["shampoo anti-dandruff", "shampoo anti-dandruff color-safe"] });
      const incoming = replay.clientSend.mock.calls.find(([message]) => "method" in message && message.method === "tools/call" && message.params?.name === "begin_web_search")![0];
      const outgoing = replay.serverSend.mock.calls.find(([message]) => "method" in message && message.method === "elicitation/create")!;
      expect(outgoing[1]?.relatedRequestId).toBe("id" in incoming ? incoming.id : undefined);
      const recovered = await replay.client.callTool({ name: "complete_web_search", arguments: { renderId: combined.renderId,
        webSessionId: (begin.structuredContent as { webSessionId: string }).webSessionId, urls: ["https://ishowbeauty.com/products/recovered"] } });
      expect(recovered.isError).not.toBe(true);
      const next = recovered.structuredContent as ProductCardContent;
      expect(next.renderId).not.toBe(combined.renderId);
      expect(next.requirementsSummary?.requiredFeatures).toEqual(combined.requirementsSummary?.requiredFeatures);
      expect(next.products[0]?.requirementAssessment?.status).toBe("SATISFIED");
      const old = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: combined.renderId } });
      expect(old.structuredContent).toEqual(combined);
      expect((await replay.client.callTool({ name: "compare_selected_products", arguments: { renderId: combined.renderId } })).structuredContent).toMatchObject({ status: "OK" });
      expect((await replay.client.callTool({ name: "begin_web_search", arguments: { renderId: combined.renderId } })).structuredContent).toMatchObject({ status: "ALREADY_USED" });
      expect(replay.approve).toHaveBeenCalledTimes(1); expect(replay.read).toHaveBeenCalledTimes(1);
    } finally { await replay.close(); }
  });

  it("clarifies a possible use replacement without searches, then withdraws only the stated feature", async () => {
    const replay = await connect();
    try {
      const first = (await replay.client.callTool({ name: "search_products", arguments: { query: "shampoo", productType: "shampoo", maxItemPriceCents: 5000,
        requiredFeatures: ["suitable for color-treated hair", "damaged hair repair"] } })).structuredContent as ProductCardContent;
      const calls = replay.search.mock.calls.length;
      const unclear = await replay.client.callTool({ name: "search_products", arguments: { query: "shampoo", contextMode: "AMBIGUOUS", parentRenderId: first.renderId, responseLocale: "zh-CN" } });
      expect(unclear.structuredContent).toMatchObject({ status: "NEEDS_CLARIFICATION" });
      expect(JSON.stringify(unclear.content)).toContain("哪些要求不再需要");
      expect(replay.search).toHaveBeenCalledTimes(calls);
      const next = await replay.client.callTool({ name: "search_products", arguments: { query: "shampoo", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: first.renderId,
        removeRequiredFeatures: ["damaged hair repair"], requiredFeatures: ["anti-dandruff"], responseLocale: "zh-CN" } });
      expect(next.structuredContent).toMatchObject({ requirementsSummary: { maxItemPriceCents: 5000,
        requiredFeatures: ["suitable for color-treated hair", "anti-dandruff"] } });
      const invalid = await replay.client.callTool({ name: "search_products", arguments: { query: "shampoo", removeRequiredFeatures: ["damaged hair repair"] } });
      expect(invalid.isError).toBe(true);
    } finally { await replay.close(); }
  });
});
