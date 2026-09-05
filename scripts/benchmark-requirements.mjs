// Offline, reproducible feed regression check; no source URLs or user data.
// node --expose-gc scripts/benchmark-requirements.mjs [baseline git ref]
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { Buffer } from "node:buffer";
import console from "node:console";
import { gzipSync } from "node:zlib";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const self = fileURLToPath(import.meta.url);
const require = createRequire(new URL("../apps/mcp-server/package.json", import.meta.url));
const { build } = require("esbuild");
const baseline = process.argv[2] ?? "56d670a";
const mode = process.argv[3];
if (mode === undefined) {
  const measure = mode => JSON.parse(execFileSync(process.execPath, ["--expose-gc", self, baseline, mode], { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 }));
  const before = measure("baseline"), after = measure("candidate");
  const ratio = { p95: after.p95Ms / before.p95Ms, heap: after.indexHeapBytes / before.indexHeapBytes, peakRss: after.peakRssBytes / before.peakRssBytes };
  console.log(JSON.stringify({ workload: "66000 synthetic feed rows; 100 paired legacy queries after 15 warmups; isolated processes", baseline, before, after, ratio,
    passed: Object.values(ratio).every(value => value <= 1.20) }, null, 2));
} else {
  const source = mode === "baseline" ? execFileSync("git", ["show", `${baseline}:packages/awin-feed/src/index.ts`], { cwd: root, encoding: "utf8" }) : undefined;
  const bundled = await build({ ...(source === undefined ? { entryPoints: [path.join(root, "packages/awin-feed/src/index.ts")] }
    : { stdin: { contents: source, loader: "ts", resolveDir: path.join(root, "packages/awin-feed/src") } }), bundle: true, platform: "node", format: "esm", write: false });
  const module = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
  const header = "aw_deep_link,product_name,merchant_product_id,merchant_image_url,description,merchant_category,search_price,merchant_name,merchant_id,category_name,currency,merchant_deep_link,in_stock";
  let csv = header + "\n";
  for (let i = 0; i < 66000; i++) {
    const kind = ["Short straight hair wig", "Straight human hair wig", "Ballet flats", "Dress"][i % 4];
    csv += `https://www.awin1.com/pclick.php?p=${i}&a=3047955&m=50707,${kind} ${i},${i},https://cdn.shopify.com/${i}.jpg,${kind} LENGTH: ${i % 4 === 0 ? 10 : 28} inches,Clothing,${10 + i % 80}.00,Fixture,50707,Clothing,USD,https://merchant.example/products/${i},1\n`;
  }
  const archive = gzipSync(csv); csv = "";
  globalThis.gc(); const before = process.memoryUsage().heapUsed;
  const index = module.createAwinFeedIndex(archive, "2026-09-05T00:00:00.000Z");
  globalThis.gc(); const indexHeapBytes = process.memoryUsage().heapUsed - before;
  const timings = [];
  for (let i = 0; i < 115; i++) {
    const start = performance.now();
    for (const query of ["wig", "ballet flats"]) module.searchAwinFeedIndex(index, { query, limit: 24, maxItemPriceCents: 6000 });
    if (i >= 15) timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  let typedP95Ms;
  if (mode === "candidate") {
    const typed = [];
    for (let i = 0; i < 25; i++) {
      const start = performance.now();
      module.searchAwinFeedIndex(index, { query: "long straight wig", productType: "wig", requiredFeatures: ["long hair", "straight hair"], limit: 24 });
      if (i >= 5) typed.push(performance.now() - start);
    }
    typed.sort((a, b) => a - b); typedP95Ms = typed[Math.floor(typed.length * 0.95)];
  }
  console.log(JSON.stringify({ rows: index.products.length, p95Ms: timings[95], indexHeapBytes, peakRssBytes: process.resourceUsage().maxRSS * 1024, typedP95Ms }));
}
