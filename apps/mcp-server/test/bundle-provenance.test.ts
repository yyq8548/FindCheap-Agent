import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const pluginRoot = path.join(repoRoot, "plugins", "shopping-agent");

describe("plugin bundle provenance", () => {
  it("records locked toolchain versions, source entry, licenses, and current bundle hash", async () => {
    const bundle = await readFile(path.join(pluginRoot, "dist", "mcp-server.js"));
    const notices = await readFile(path.join(pluginRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
    const bundleHash = createHash("sha256").update(bundle).digest("hex");

    expect(notices).toContain("Source entry: `apps/mcp-server/src/stdio.ts`");
    expect(notices).toContain(`Bundle SHA-256: \`${bundleHash}\``);
    expect(notices).toContain("`@modelcontextprotocol/sdk@1.30.0`");
    expect(notices).toContain("`zod@3.25.76`");
    expect(notices).toContain("`esbuild@0.28.2`");
    expect(notices.match(/MIT License/g)).toHaveLength(3);
    expect(notices).not.toMatch(/generated (at|on)|\d{4}-\d{2}-\d{2}T/i);
  });
});
