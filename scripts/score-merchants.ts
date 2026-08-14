import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { MerchantCatalogSchema, selectForBuild } from "../config/merchants/schema.js";

function parseArguments(arguments_: string[]): { catalogPath: string } {
  const values = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  if (values.length !== 2 || values[0] !== "--catalog" || !values[1]) {
    throw new Error("Usage: pnpm merchants:score -- --catalog <catalog.yaml>");
  }

  return { catalogPath: values[1] };
}

async function main(): Promise<void> {
  const { catalogPath } = parseArguments(process.argv.slice(2));
  const catalog = MerchantCatalogSchema.parse(parse(await readFile(resolve(catalogPath), "utf8")));
  const selectedForBuild = selectForBuild(catalog);

  console.log(`Candidates: ${catalog.candidates.length}`);
  console.log(`Selected for build: ${selectedForBuild.length}`);
  for (const merchant of selectedForBuild) console.log(`- ${merchant.id}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
