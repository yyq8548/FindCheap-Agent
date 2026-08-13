import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultMetafilePath = path.resolve(
  packageRoot,
  "../../plugins/shopping-agent/dist/mcp-server.meta.json"
);

function sortedObject(entries) {
  return Object.fromEntries(entries.sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  )));
}

function normalizeValue(value) {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (!value || typeof value !== "object") return value;
  return sortedObject(Object.entries(value).map(([key, nestedValue]) => [
    key,
    normalizeValue(nestedValue)
  ]));
}

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function normalizeInput(input) {
  return normalizeValue(Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== "bytes")
  ));
}

export function normalizeMetafile(metafile) {
  if (!metafile?.inputs || !metafile?.outputs) {
    throw new Error("esbuild metafile must contain inputs and outputs");
  }

  const inputs = sortedObject(Object.entries(metafile.inputs).map(([inputPath, input]) => [
    normalizePath(inputPath),
    normalizeInput(input)
  ]));
  const outputs = sortedObject(Object.entries(metafile.outputs).map(([outputPath, output]) => {
    const normalizedOutput = normalizeValue(output);
    if (typeof normalizedOutput.entryPoint === "string") {
      normalizedOutput.entryPoint = normalizePath(normalizedOutput.entryPoint);
    }
    if (normalizedOutput.inputs) {
      normalizedOutput.inputs = sortedObject(
        Object.entries(normalizedOutput.inputs).map(([inputPath, contribution]) => [
          normalizePath(inputPath),
          contribution
        ])
      );
    }
    return [normalizePath(outputPath), normalizedOutput];
  }));

  return { inputs, outputs };
}

export async function normalizeMetafileAtPath(metafilePath = defaultMetafilePath) {
  const metafile = JSON.parse(await readFile(metafilePath, "utf8"));
  const normalized = normalizeMetafile(metafile);
  await writeFile(metafilePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await normalizeMetafileAtPath(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
}
