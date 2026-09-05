import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createOfficialCatalogPort } from "../apps/mcp-server/src/official-catalog.js";
import { createOfficialShopifySearchPort } from "../apps/mcp-server/src/shopify-official-store-search.js";
import { createOfficialStorefrontRegistryPortFromEnvironment } from "../apps/mcp-server/src/official-storefront-registry-client.js";

const [command, manifestPath, statePath] = process.argv.slice(2);
if (command === "--help" || command === undefined) {
  console.log("Usage: pnpm exec tsx scripts/official-catalog.ts refresh|import manifest.json [catalog.json]\nrefresh: {sources:[{host,queries:[public category terms]}]}; import: {urls:[exact approved product URLs]}.\nNo automatic trust approval or recurring crawl. Run only against reviewed sources. Status includes partial coverage; cache alone is not visual verification.");
} else {
  if (!["refresh", "import"].includes(command) || manifestPath === undefined) throw new Error("OFFICIAL_CATALOG_ARGUMENTS_INVALID");
  if ((await stat(manifestPath)).size > 64 * 1024) throw new Error("OFFICIAL_CATALOG_MANIFEST_TOO_LARGE");
  const bytes = await readFile(manifestPath);
  if (bytes.byteLength > 64 * 1024) throw new Error("OFFICIAL_CATALOG_MANIFEST_TOO_LARGE");
  const manifest = JSON.parse(bytes.toString("utf8")) as { sources: Array<{ host: string; queries: string[] }>; urls: string[] };
  const registry = createOfficialStorefrontRegistryPortFromEnvironment(process.env);
  await registry?.refresh();
  const stateDirectory = process.env.FINDCHEAP_STATE_DIR ?? join(homedir(), ".findcheap-agent", "watches-v1");
  // Import keeps original public image URLs; runtime applies its existing image safety boundary.
  const catalog = createOfficialCatalogPort({ path: statePath ?? join(stateDirectory, "official-catalog-v1.json"), official: createOfficialShopifySearchPort() });
  const result = command === "refresh" ? await catalog.refreshSources(manifest.sources) : await catalog.importUrls(manifest.urls);
  console.log(JSON.stringify({ command, ...result, coverage: "BOUNDED_INCREMENTAL_NOT_FULL_SITE" }));
}
