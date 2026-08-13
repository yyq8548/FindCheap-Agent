import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const pluginRoot = path.join(repoRoot, "plugins", "shopping-agent");
const packageRoot = path.join(repoRoot, "apps", "mcp-server");

function packageFromInput(input: string): { name: string; root: string } | undefined {
  const parts = input.replaceAll("\\", "/").split("/");
  const nodeModulesIndex = parts.lastIndexOf("node_modules");
  if (nodeModulesIndex < 0) return undefined;
  const first = parts[nodeModulesIndex + 1];
  if (!first || first === ".pnpm") return undefined;
  if (first.startsWith("@") && !parts[nodeModulesIndex + 2]) return undefined;
  const packageParts = first.startsWith("@")
    ? [first, parts[nodeModulesIndex + 2]].filter((part): part is string => Boolean(part))
    : [first];
  return {
    name: packageParts.join("/"),
    root: path.resolve(
      packageRoot,
      parts.slice(0, nodeModulesIndex + 1).concat(packageParts).join(path.sep)
    )
  };
}

describe("plugin bundle provenance", () => {
  it("records locked toolchain versions, source entry, licenses, and current bundle hash", async () => {
    const bundle = await readFile(path.join(pluginRoot, "dist", "mcp-server.js"));
    const metafile = JSON.parse(
      await readFile(path.join(pluginRoot, "dist", "mcp-server.meta.json"), "utf8")
    ) as { inputs: Record<string, unknown> };
    const notices = await readFile(path.join(pluginRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
    const bundleHash = createHash("sha256").update(bundle).digest("hex");

    const packageRoots = new Map(
      Object.keys(metafile.inputs)
        .map(packageFromInput)
        .filter((inputPackage): inputPackage is { name: string; root: string } => Boolean(inputPackage))
        .map((inputPackage) => [inputPackage.root, inputPackage.name])
    );
    const bundledPackages = (await Promise.all([...packageRoots].map(async ([root, name]) => {
      const manifest = JSON.parse(
        await readFile(path.join(root, "package.json"), "utf8")
      ) as { version: string };
      return `${name}@${manifest.version}`;
    }))).sort();
    const runtimeSection = notices.match(
      /## Bundled runtime packages\n\n([\s\S]*?)\n## Build-tool provenance/
    )?.[1] ?? "";
    const noticedPackages = [...runtimeSection.matchAll(/^### `([^`]+)`$/gm)]
      .map((match) => match[1] ?? "")
      .sort();

    expect(notices).toContain("Source entry: `apps/mcp-server/src/stdio.ts`");
    expect(notices).toContain(`Bundle SHA-256: \`${bundleHash}\``);
    const bundledNames = bundledPackages.map((reference) => reference.slice(0, reference.lastIndexOf("@")));
    expect(bundledNames).toEqual(expect.arrayContaining([
      "@modelcontextprotocol/sdk",
      "ajv",
      "ajv-formats",
      "zod",
      "zod-to-json-schema"
    ]));
    expect(noticedPackages).toEqual(bundledPackages);
    expect(runtimeSection.match(/^- License: .+$/gm)).toHaveLength(bundledPackages.length);
    expect(runtimeSection.match(/^- Source: https:\/\/.+$/gm)).toHaveLength(bundledPackages.length);
    expect(runtimeSection.match(/^- Homepage: .+$/gm)).toHaveLength(bundledPackages.length);
    expect(runtimeSection.match(/^- Repository: .+$/gm)).toHaveLength(bundledPackages.length);
    expect(runtimeSection.match(/^```text$/gm)).toHaveLength(bundledPackages.length);
    expect(notices).toContain("### `esbuild@0.28.2`");
    expect(notices).not.toMatch(/generated (at|on)|\d{4}-\d{2}-\d{2}T/i);
  });
});
