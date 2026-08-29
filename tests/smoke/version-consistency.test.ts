import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { FINDCHEAP_VERSION } from "../../config/version.js";

describe("FindCheap version consistency", () => {
  it("keeps plugin and skill metadata on the shared runtime version", async () => {
    const manifest = JSON.parse(await readFile(
      new URL("../../plugins/findcheap-agent/.codex-plugin/plugin.json", import.meta.url),
      "utf8"
    )) as { version: string };
    const skill = await readFile(
      new URL("../../plugins/findcheap-agent/skills/compare-products/SKILL.md", import.meta.url),
      "utf8"
    );
    const agent = await readFile(
      new URL("../../plugins/findcheap-agent/skills/compare-products/agents/openai.yaml", import.meta.url),
      "utf8"
    );

    expect(manifest.version.split("+")[0]).toBe(FINDCHEAP_VERSION);
    expect(skill).toContain(`FindCheap Agent v${FINDCHEAP_VERSION}`);
    expect(agent).toContain(`FindCheap Agent v${FINDCHEAP_VERSION}`);
  });
});
