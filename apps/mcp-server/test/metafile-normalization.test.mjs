import { readFile } from "node:fs/promises";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderNotices } from "../scripts/generate-third-party-notices.mjs";
import { normalizeMetafile } from "../scripts/normalize-metafile.mjs";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const metafilePath = path.join(
  repoRoot,
  "plugins",
  "findcheap-agent",
  "dist",
  "mcp-server.meta.json"
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe("MCP bundle metafile normalization", () => {
  it("makes LF and CRLF input-byte variation produce identical metadata and notices", async () => {
    const stableMetafile = JSON.parse(await readFile(metafilePath, "utf8"));
    const lfMetafile = clone(stableMetafile);
    const crlfMetafile = clone(stableMetafile);
    let index = 0;
    for (const inputPath of Object.keys(stableMetafile.inputs)) {
      lfMetafile.inputs[inputPath].bytes = 1_000 + index;
      crlfMetafile.inputs[inputPath].bytes = 1_001 + index;
      index += 1;
    }

    const normalizedLf = normalizeMetafile(lfMetafile);
    const normalizedCrlf = normalizeMetafile(crlfMetafile);

    expect(normalizedCrlf).toEqual(normalizedLf);
    expect(Object.values(normalizedLf.inputs).every((input) => !("bytes" in input))).toBe(true);
    expect(normalizedLf.outputs).toEqual(stableMetafile.outputs);
    expect(await renderNotices(normalizedCrlf)).toBe(await renderNotices(normalizedLf));
  });
});
