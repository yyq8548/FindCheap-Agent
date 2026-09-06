import { describe, expect, it } from "vitest";
import type { ProductCardContent } from "../src/server.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

describe("visual identity MCP output", () => {
  it.each(["COLOR", "PATTERN"] as const)("removes source EXACT from cards and recommendations after a verified %s difference", async attribute => {
    // No requested brand: the source's EXACT assessment and the visual
    // candidate's discovery assessment follow different paths before review.
    const original = product({ handle: "colorway-dress", title: "Ivory striped boat neck cap sleeve mini dress",
      productType: "dress", description: "Ivory striped boat neck cap sleeve mini dress",
      matchStatus: "EXACT", gtins: ["0123456789012"], variantDimensions: { color: "ivory", size: "M" },
      merchantUrl: "https://ishowbeauty.com/products/colorway-dress", imageUrl: "https://cdn.shopify.com/colorway-dress.jpg" });
    const before = structuredClone(original);
    const replay = await connectReplay(async () => searchResult([original]));
    try {
      const first = await replay.client.callTool({ name: "search_visual_candidates", arguments: {
        query: "black floral mini dress", productType: "dress", responseLocale: "zh-CN", visualInput: {
          productType: "dress", colors: ["black"], patterns: ["floral"], neckline: "boat neck", sleeveType: "cap sleeve", length: "mini"
        }
      } });
      expect(first.isError).not.toBe(true);
      const session = first.structuredContent as { visualSessionId: string; candidates: Array<{ candidateId: string }> };
      expect(session.candidates).toHaveLength(1);
      const final = await replay.client.callTool({ name: "finalize_visual_search", arguments: {
        visualSessionId: session.visualSessionId, verdicts: [{ candidateId: session.candidates[0]!.candidateId, verdict: {
          classification: "POSSIBLE_SAME_ITEM", matches: [
            { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "boat neck" },
            { attribute: "SLEEVE", referenceEvidence: "cap sleeve", candidateEvidence: "cap sleeve" },
            { attribute: "LENGTH", referenceEvidence: "mini", candidateEvidence: "mini" }
          ], conflicts: [attribute === "COLOR"
            ? { attribute, referenceEvidence: "black", candidateEvidence: "ivory" }
            : { attribute, referenceEvidence: "floral", candidateEvidence: "striped" }]
        } }]
      } });
      expect(final.isError).not.toBe(true);
      const content = final.structuredContent as ProductCardContent;
      expect(content.products).toHaveLength(1);
      const card = content.products[0]!;
      expect(card).toMatchObject({ matchStatus: "DISCOVERY_MATCH", visualMatchGroup: "HIGHLY_SIMILAR",
        resultGroup: "DISCOVERY", card: { matchBadge: "DISCOVERY_MATCH" }, merchantId: "ishow", handle: "colorway-dress",
        gtins: ["0123456789012"], variantDimensions: { color: "ivory", size: "M" }, itemPrice: { amountCents: 3_641, currency: "USD" },
        merchantTrust: { verification: "INDEPENDENT", level: "ESTABLISHED_RETAILER" }, selectionId: expect.any(String) });
      expect(card.visualMatchEvidence).toContain(attribute === "COLOR"
        ? "Codex visual difference COLOR: black | ivory" : "Codex visual difference PATTERN: floral | striped");
      expect(content.recommendation).toMatchObject({ state: "READY", primarySelectionId: card.selectionId });
      expect(content.recommendation!.reasonCodes).not.toContain("EXACT_MATCH");
      expect(content.recommendation!.reasonCodes).toContain("BEST_FIT");
      expect(original).toEqual(before);
    } finally { await replay.close(); }
  });
});
