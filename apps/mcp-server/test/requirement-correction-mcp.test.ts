import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ProductCardContent } from "../src/server.js";
import { SearchProductsInputSchema } from "../src/search-products.js";
import { mergeSearchRequirements } from "../src/search-requirements-context.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

const initial = { query: "coffee beans", productType: "whole bean coffee", maxItemPriceCents: 4000,
  requiredFeatures: ["whole bean", "decaffeinated"], excludedFeatures: ["flavored"],
  preferences: ["dark roast"], conditionPreference: "NEW", responseLocale: "zh-CN" };
const correction = { query: "coffee capsules", productType: "coffee pods", contextMode: "CORRECT_PREVIOUS_PRODUCT",
  removeRequiredFeatures: ["whole bean"] };

describe("explicit per-feature withdrawal while correcting identity", () => {
  it.each(["render", "goal"])("keeps unrelated requirements and the original snapshot using a %s receipt", async reference => {
    const search = vi.fn(async () => searchResult([]));
    const replay = await connectReplay(search);
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: initial });
      expect(first.isError).not.toBe(true);
      const previous = first.structuredContent as ProductCardContent;
      const referenceArgs = reference === "render" ? { parentRenderId: previous.renderId }
        : { goalId: previous.goalId, goalRevision: previous.goalRevision };
      search.mockClear();
      const next = await replay.client.callTool({ name: "search_products", arguments: { ...correction, ...referenceArgs } });
      expect(next.isError, JSON.stringify(next.content)).not.toBe(true);
      expect(next.structuredContent).toMatchObject({ goalId: previous.goalId, goalRevision: 2,
        requirementsSummary: { productType: "coffee pods", maxItemPriceCents: 4000,
          requiredFeatures: ["decaffeinated"], excludedFeatures: ["flavored"], preferences: ["dark roast"] } });
      expect(search).toHaveBeenCalled();
      const original = await replay.client.callTool({ name: "render_product_cards", arguments: { renderId: previous.renderId } });
      expect(original.structuredContent).toEqual(previous);
    } finally { await replay.close(); }
  });

  it("keeps the old hard feature unless it is explicitly withdrawn, including required legacy features", () => {
    const old = SearchProductsInputSchema.parse({ ...initial, features: ["whole bean", "organic"], featureMode: "REQUIRED" });
    const unchanged = mergeSearchRequirements(SearchProductsInputSchema.parse({ ...correction, removeRequiredFeatures: [] }), old);
    expect(unchanged.requiredFeatures).toEqual(["whole bean", "decaffeinated"]);
    expect(unchanged.features).toEqual(["whole bean", "organic"]);
    const corrected = mergeSearchRequirements(SearchProductsInputSchema.parse(correction), old);
    expect(corrected).toMatchObject({ requiredFeatures: ["decaffeinated"], features: ["organic"], maxItemPriceCents: 4000, conditionPreference: "NEW" });
    expect(old.requiredFeatures).toEqual(["whole bean", "decaffeinated"]);
  });

  it.each([
    { label: "an invented prior feature", patch: { removeRequiredFeatures: ["invented requirement"] } },
    { label: "a feature re-added in the same correction", patch: { requiredFeatures: ["whole bean"] } },
    { label: "a feature re-added through the legacy field", patch: { features: ["whole bean"], featureMode: "REQUIRED" } },
    { label: "a missing receipt", patch: { parentRenderId: undefined } },
    { label: "an unknown receipt", patch: { parentRenderId: randomUUID() } }
  ])("rejects $label before consulting sources", async ({ patch }) => {
    const search = vi.fn(async () => searchResult([]));
    const replay = await connectReplay(search);
    try {
      const first = await replay.client.callTool({ name: "search_products", arguments: initial });
      const previous = first.structuredContent as ProductCardContent;
      search.mockClear();
      const rejected = await replay.client.callTool({ name: "search_products", arguments: {
        ...correction, parentRenderId: previous.renderId, ...patch
      } });
      expect(rejected.isError).toBe(true);
      expect(search).not.toHaveBeenCalled();
      expect(previous.goalRevision).toBe(1);
    } finally { await replay.close(); }
  });

  it.each(["search_products", "search_visual_candidates"])("rejects unbound withdrawal in %s", async name => {
    const search = vi.fn(async () => searchResult([]));
    const replay = await connectReplay(search);
    try {
      for (const contextMode of ["NEW_PRODUCT", "AMBIGUOUS"]) {
        const result = await replay.client.callTool({ name, arguments: {
          ...initial, contextMode, removeRequiredFeatures: ["whole bean"],
          ...(name === "search_visual_candidates" ? { visualInput: { productType: "coffee" } } : {})
        } });
        expect(result.isError, JSON.stringify(result)).toBe(true);
        expect(JSON.stringify(result.content)).toContain("INVALID_ARGUMENTS");
        expect(search).not.toHaveBeenCalled();
      }
    } finally { await replay.close(); }
  });

  it("applies the same correction contract to visual category clarification without resetting its flow", async () => {
    const search = vi.fn(async () => searchResult([product({ title: "Ivory camisole top", productType: "camisole top",
      description: "Ivory camisole top", variantDimensions: { Color: "Ivory" }, imageUrl: "https://cdn.shopify.com/ivory-top.jpg" })]));
    const replay = await connectReplay(search);
    try {
      const first = await replay.client.callTool({ name: "search_visual_candidates", arguments: {
        query: "ivory dress", productType: "dress", requiredFeatures: ["long sleeves", "ivory"], maxItemPriceCents: 10000,
        visualInput: { productType: "dress", colors: ["ivory"], categoryCandidates: ["dress", "camisole top"] }
      } });
      expect((first.structuredContent as { status?: string } | undefined)?.status).toBe("NEEDS_CLARIFICATION");
      expect(search).not.toHaveBeenCalled();
      const previous = first.structuredContent as { renderId: string; goalId: string };
      const next = await replay.client.callTool({ name: "search_visual_candidates", arguments: {
        query: "ivory camisole top", productType: "camisole top", contextMode: "CORRECT_PREVIOUS_PRODUCT",
        parentRenderId: previous.renderId, removeRequiredFeatures: ["long sleeves"],
        visualInput: { productType: "camisole top", colors: ["ivory"] }
      } });
      expect(next.isError, JSON.stringify(next.content)).not.toBe(true);
      expect((next.structuredContent as { status?: string } | undefined)?.status).toBe("OK");
      const session = next.structuredContent as { visualSessionId: string; candidates: { candidateId: string }[] };
      const final = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: session.visualSessionId, verdicts: session.candidates.map(candidate => ({ candidateId: candidate.candidateId,
          verdict: { classification: "CONFLICT", matches: [], conflicts: [
            { attribute: "COLOR", referenceEvidence: "ivory", candidateEvidence: "black" }
          ] } }))
      } });
      expect(final.isError, JSON.stringify(final.content)).not.toBe(true);
      expect(final.structuredContent).toMatchObject({ goalId: previous.goalId, goalRevision: 2,
        requirementsSummary: { requiredFeatures: ["ivory"], maxItemPriceCents: 10000 } });
    } finally { await replay.close(); }
  });
});
