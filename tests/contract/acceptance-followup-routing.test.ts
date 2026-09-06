import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skill = readFileSync(new URL("../../plugins/findcheap-agent/skills/compare-products/SKILL.md", import.meta.url), "utf8");

// Static routing contracts protect instructions, not actual model compliance.
describe("T1–T9 and V1–V6 shopping instruction contracts", () => {
  it("separates explicit cross-merchant comparison from an ordinary exact search", () => {
    expect(skill).toContain("compareMerchants=true");
    expect(skill).toContain("COMPARISON_INCOMPLETE");
  });
  it("resolves category ambiguity before retrieval and preserves the visual route after correction", () => {
    expect(skill).toContain("categoryCandidates");
    expect(skill).toContain("USE_VISUAL_TOOL");
    expect(skill).toContain("CORRECT_PREVIOUS_PRODUCT through search_visual_candidates");
  });
  it("hands off an available similar recommendation and accurately scopes stock", () => {
    expect(skill).toContain("READY + SIMILAR");
    expect(skill).toContain("PRODUCT_COLOR");
    expect(skill).toContain("availableSizesTruncated");
    expect(skill).toContain("visualMatchEvidenceTruncated");
  });
  it("routes a single selected quote without pretending it is a batch", () => {
    expect(skill).toContain("QUOTE_SINGLE_SELECTION");
    expect(skill).toContain("one synced choice");
    expect(skill).toContain("2–4");
  });
});
