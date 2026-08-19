import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(packageRoot, "../..");
const pluginRoot = path.join(repoRoot, "plugins", "findcheap-agent");
const bundlePath = path.join(pluginRoot, "dist", "mcp-server.js");
const metafilePath = path.join(pluginRoot, "dist", "mcp-server.meta.json");

function packageFromInput(input) {
  const parts = input.replaceAll("\\", "/").split("/");
  const nodeModulesIndex = parts.lastIndexOf("node_modules");
  if (nodeModulesIndex < 0) return undefined;
  const first = parts[nodeModulesIndex + 1];
  if (!first || first === ".pnpm") return undefined;
  if (first.startsWith("@") && !parts[nodeModulesIndex + 2]) return undefined;
  const packageParts = first.startsWith("@")
    ? [first, parts[nodeModulesIndex + 2]].filter(Boolean)
    : [first];
  return {
    name: packageParts.join("/"),
    root: path.resolve(
      packageRoot,
      parts.slice(0, nodeModulesIndex + 1).concat(packageParts).join(path.sep)
    )
  };
}

function repositoryUrl(repository) {
  const raw = typeof repository === "string" ? repository : repository?.url;
  if (!raw) return undefined;
  if (/^[^/:]+\/[^/]+$/.test(raw)) return `https://github.com/${raw}`;
  return raw
    .replace(/^git\+/, "")
    .replace(/^git:\/\/github\.com\//, "https://github.com/")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
}

async function packageNotice(name, root) {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const licenseIdentifier = typeof manifest.license === "string"
    ? manifest.license
    : manifest.license?.type;
  if (!licenseIdentifier) throw new Error(`${name} does not declare a license identifier`);

  const licenseFile = (await readdir(root))
    .filter((file) => /^(licen[cs]e|copying)(\..*)?$/i.test(file))
    .sort()[0];
  if (!licenseFile) throw new Error(`${name} does not ship a license file`);

  const repository = repositoryUrl(manifest.repository);
  const homepage = typeof manifest.homepage === "string" ? manifest.homepage : undefined;
  const source = repository ?? homepage;
  if (!source) throw new Error(`${name} does not declare a source or homepage`);

  return {
    name,
    version: manifest.version,
    licenseIdentifier,
    licenseFile,
    licenseText: (await readFile(path.join(root, licenseFile), "utf8")).trim(),
    source,
    homepage: homepage ?? "Not declared",
    repository: repository ?? "Not declared"
  };
}

function formatNotice(component) {
  return [
    `### \`${component.name}@${component.version}\``,
    "",
    `- License: ${component.licenseIdentifier}`,
    `- License file: \`${component.licenseFile}\``,
    `- Source: ${component.source}`,
    `- Homepage: ${component.homepage}`,
    `- Repository: ${component.repository}`,
    "",
    "```text",
    component.licenseText,
    "```"
  ].join("\n");
}

export async function renderNotices(metafile) {
  const runtimeRoots = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const inputPackage = packageFromInput(input);
    if (inputPackage) runtimeRoots.set(inputPackage.root, inputPackage.name);
  }

  const runtimeByReference = new Map();
  for (const [root, name] of runtimeRoots) {
    const component = await packageNotice(name, root);
    runtimeByReference.set(`${component.name}@${component.version}`, component);
  }
  const runtimePackages = [...runtimeByReference.values()].sort((left, right) => {
    const leftReference = `${left.name}@${left.version}`;
    const rightReference = `${right.name}@${right.version}`;
    return leftReference < rightReference ? -1 : leftReference > rightReference ? 1 : 0;
  });

  const packageManifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const esbuild = await packageNotice("esbuild", path.join(packageRoot, "node_modules", "esbuild"));
  if (packageManifest.devDependencies?.esbuild !== esbuild.version) {
    throw new Error(`esbuild must be pinned to ${esbuild.version}`);
  }

  const bundle = await readFile(bundlePath);
  const bundleHash = createHash("sha256").update(bundle).digest("hex");
  return [
    "# Third-Party Notices and Bundle Provenance",
    "",
    "Source entry: `apps/mcp-server/src/stdio.ts`",
    "",
    "Bundle: `plugins/findcheap-agent/dist/mcp-server.js`",
    "",
    "Metafile: `plugins/findcheap-agent/dist/mcp-server.meta.json`",
    "",
    `Bundle SHA-256: \`${bundleHash}\``,
    "",
    "Build command: `pnpm build:mcp`",
    "",
    "## Bundled runtime packages",
    "",
    runtimePackages.map(formatNotice).join("\n\n"),
    "",
    "## Build-tool provenance",
    "",
    formatNotice(esbuild),
    ""
  ].join("\n");
}

export async function generateNotices() {
  const metafile = JSON.parse(await readFile(metafilePath, "utf8"));
  const output = await renderNotices(metafile);
  await writeFile(path.join(pluginRoot, "THIRD_PARTY_NOTICES.md"), output, "utf8");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await generateNotices();
}
