import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const skill = read("plugins/findcheap-agent/skills/compare-products/SKILL.md");
const prompt = read("plugins/findcheap-agent/skills/compare-products/agents/openai.yaml");
const recovery = read("plugins/findcheap-agent/skills/compare-products/references/chrome-fallback.md");
const design = read("DESIGN.md");
const manifest = JSON.parse(read("plugins/findcheap-agent/.codex-plugin/plugin.json")) as {
  interface: { longDescription: string };
};

// These assert shipped guidance, not that a native host or model followed it.
describe("shopping friend guidance", () => {
  it("keeps the plugin introduction concise and aligned with current matching boundaries", () => {
    const introduction = manifest.interface.longDescription;
    expect(Buffer.byteLength(introduction, "utf8")).toBeLessThanOrEqual(2400);
    expect(introduction).not.toMatch(/v0\.17\./u);
    expect(introduction).toContain("Highly rated products");
    expect(introduction).toContain("do not independently verify merchants");
    expect(introduction).toContain("Without a verified item price, a lead is not shown as a product card");
    expect(introduction).toContain("User-authorized Chrome");
    expect(introduction).toContain("Native Codex permission prompts");
    expect(introduction).not.toContain("otherwise cards remain research-only");
  });

  it("acknowledges host instruction priority without redundant progress or optional file work", () => {
    for (const text of [skill, prompt]) {
      expect(text).toMatch(/Follow (?:required host instructions|host requirements)/u);
      expect(text).toContain("skip optional");
      expect(text).toMatch(/no optional progress line or tool narration|add no optional process narration/u);
    }
    expect(skill).not.toContain("Pre-load silent");
  });

  it("routes inspection directly and chains snapshots for accumulated checks", () => {
    const selected = skill.split("## Selected")[1]!.split("## Chrome fallback")[0]!;
    expect(selected).toContain("do not compare first to inspect one");
    expect(selected).toContain("Check sequentially with each");
    expect(selected).toContain("updatedSnapshot");
    expect(selected).toContain("never mix IDs");
  });

  it("distinguishes a rated match from a merchant audit or a chosen best deal", () => {
    expect(skill).toContain("MATCHES_AVAILABLE");
    expect(skill).toContain("高评分商品");
    expect(skill).toContain("高评分商家");
    expect(skill).toContain("Missing item price: no card");
    expect(skill).toContain("recommend only `primarySelectionId`");
  });

  it("gives natural grounded examples without blaming the user or promising a popup", () => {
    expect(design).toContain("add no optional progress sentence");
    expect(design).toContain("这款符合你要的规格");
    expect(design).toContain("是否适用这件商品，还要看优惠条件");
    expect(design).toContain("这次网页补搜没能启动");
    expect(recovery).toContain("这次网页补搜没能启动");
    expect(recovery).toContain("Never promise a popup");
    expect(recovery).toContain("a host decline does not establish whether the user interacted");
    expect(recovery).toContain("higher-priority host instructions");
  });
});
