import { describe, expect, it } from "vitest";
import { connectReplay, product, searchResult, REPLAY_NOW } from "./fixtures/conversation-replay-support.js";
import { PRODUCT_SELECTION_SNAPSHOT_TTL_MS, type ProductCardContent } from "../src/server.js";

describe("shopping goal continuity", () => {
  it("does not revive an expired goal revision through another reference field", async () => {
    let time = REPLAY_NOW.getTime();
    const replay = await connectReplay(async () => searchResult([]), { now: () => new Date(time) });
    try {
      const first = (await replay.client.callTool({ name: "search_products", arguments: { query: "wig" } })).structuredContent as ProductCardContent;
      time += PRODUCT_SELECTION_SNAPSHOT_TTL_MS + 1;
      for (const reference of [{ goalId: first.goalId, goalRevision: first.goalRevision }, { parentRenderId: first.renderId }]) {
        const result = await replay.client.callTool({ name: "search_products", arguments: {
          query: "wig", contextMode: "CONTINUE_PREVIOUS_PRODUCT", ...reference
        } });
        expect(result.isError).toBe(true);
      }
    } finally { await replay.close(); }
  });
  it("binds five refinements to a goal without guessing a latest snapshot", async () => {
    const replay = await connectReplay(async () => searchResult([product()]));
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: {
        query: "wig", productType: "wig", maxItemPriceCents: 10000
      } });
      let content = first.structuredContent as ProductCardContent;
      expect(content.goalId).toEqual(expect.any(String));
      expect(content.goalRevision).toBe(1);
      const original = content;
      for (const patch of [{ primaryUse: "cosplay" }, { requiredFeatures: ["short hair"] },
        { preferences: ["easy to maintain"] }, { maxItemPriceCents: 5000 }, { responseLocale: "zh-CN" }]) {
        const next = await replay.client.callTool({ name: "search_products", arguments: {
          query: "wig", contextMode: "CONTINUE_PREVIOUS_PRODUCT", goalId: content.goalId,
          goalRevision: content.goalRevision, ...patch
        } });
        expect(next.isError).not.toBe(true);
        const result = next.structuredContent as ProductCardContent;
        expect(result.goalId).toBe(original.goalId);
        expect(result.goalRevision).toBe(Number(content.goalRevision) + 1);
        expect(result.requirementsSummary).toMatchObject({ maxItemPriceCents: patch.maxItemPriceCents ??
          (content.requirementsSummary as { maxItemPriceCents: number }).maxItemPriceCents });
        content = result;
      }
      expect(content.requirementsSummary).toMatchObject({ primaryUse: "cosplay", requiredFeatures: ["short hair"],
        preferences: ["easy to maintain"], maxItemPriceCents: 5000 });
      expect(original.requirementsSummary).toMatchObject({ maxItemPriceCents: 10000, requiredFeatures: [] });
      const missing = await replay.client.callTool({ name: "search_products", arguments: {
        query: "wig", contextMode: "CONTINUE_PREVIOUS_PRODUCT"
      } });
      expect(missing.isError).toBe(true);
      const fresh = await replay.client.callTool({ name: "search_products", arguments: { query: "shampoo" } });
      expect((fresh.structuredContent as ProductCardContent).goalId).not.toBe(original.goalId);
      expect((fresh.structuredContent as ProductCardContent).requirementsSummary?.maxItemPriceCents).toBeUndefined();
    } finally { await replay.close(); }
  });

  it("rejects cross-goal reference pairs and caller-created new goal identities", async () => {
    const replay = await connectReplay(async () => searchResult([]));
    try {
      const a = (await replay.client.callTool({ name: "search_products", arguments: { query: "wig" } })).structuredContent as ProductCardContent;
      const b = (await replay.client.callTool({ name: "search_products", arguments: { query: "shampoo" } })).structuredContent as ProductCardContent;
      expect(a.goalId).toEqual(expect.any(String));
      for (const args of [
        { query: "shampoo", contextMode: "NEW_PRODUCT", parentRenderId: a.renderId },
        { query: "wig", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: a.renderId,
          goalId: b.goalId, goalRevision: b.goalRevision },
        { query: "wig", goalId: a.goalId, goalRevision: a.goalRevision },
        { query: "wig", contextMode: "CONTINUE_PREVIOUS_PRODUCT", goalId: a.goalId, goalRevision: 99 }
      ]) expect((await replay.client.callTool({ name: "search_products", arguments: args })).isError).toBe(true);
    } finally { await replay.close(); }
  });
});
