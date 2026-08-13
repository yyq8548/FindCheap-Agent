import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(packageRoot, "../..");
const pluginRoot = path.join(repoRoot, "plugins", "shopping-agent");

const components = [
  {
    name: "@modelcontextprotocol/sdk",
    role: "Bundled runtime dependency",
    source: "https://github.com/modelcontextprotocol/typescript-sdk",
    licenseFile: "LICENSE"
  },
  {
    name: "zod",
    role: "Bundled runtime dependency",
    source: "https://github.com/colinhacks/zod",
    licenseFile: "LICENSE"
  },
  {
    name: "esbuild",
    role: "Build dependency; not included as runtime code",
    source: "https://github.com/evanw/esbuild",
    licenseFile: "LICENSE.md"
  }
];

const packageManifest = JSON.parse(
  await readFile(path.join(packageRoot, "package.json"), "utf8")
);
const bundle = await readFile(path.join(pluginRoot, "dist", "mcp-server.js"));
const bundleHash = createHash("sha256").update(bundle).digest("hex");

const notices = await Promise.all(components.map(async (component) => {
  const dependencyRoot = path.join(packageRoot, "node_modules", ...component.name.split("/"));
  const dependencyManifest = JSON.parse(
    await readFile(path.join(dependencyRoot, "package.json"), "utf8")
  );
  const declaredVersion = packageManifest.dependencies?.[component.name]
    ?? packageManifest.devDependencies?.[component.name];
  if (declaredVersion !== dependencyManifest.version) {
    throw new Error(`${component.name} must be pinned to ${dependencyManifest.version}`);
  }
  const license = (await readFile(path.join(dependencyRoot, component.licenseFile), "utf8")).trim();
  return [
    `## \`${component.name}@${dependencyManifest.version}\``,
    "",
    `- Role: ${component.role}`,
    `- License: ${dependencyManifest.license}`,
    `- Source: ${component.source}`,
    "",
    "```text",
    license,
    "```"
  ].join("\n");
}));

const output = [
  "# Third-Party Notices and Bundle Provenance",
  "",
  "Source entry: `apps/mcp-server/src/stdio.ts`",
  "",
  "Bundle: `plugins/shopping-agent/dist/mcp-server.js`",
  "",
  `Bundle SHA-256: \`${bundleHash}\``,
  "",
  "Build command: `pnpm build:mcp`",
  "",
  notices.join("\n\n"),
  ""
].join("\n");

await writeFile(path.join(pluginRoot, "THIRD_PARTY_NOTICES.md"), output, "utf8");
