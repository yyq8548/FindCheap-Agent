// Read-only diagnostic replay, not independent accuracy or native-host acceptance.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile, mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { createHash } from "node:crypto";
import process from "node:process";
import { performance } from "node:perf_hooks";

const root = fileURLToPath(new URL("../../../plugins/findcheap-agent/", import.meta.url));
const config = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8")).mcpServers["findcheap-agent"];
const stateDir = await mkdtemp(join(tmpdir(), "findcheap-qa-readonly-"));
const connect = async () => {
  const client = new Client({ name: "findcheap-qa-preflight", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath, args: config.args, cwd: root,
    env: { ...config.env, PATH: process.env.PATH ?? "", FINDCHEAP_STATE_DIR: stateDir }, stderr: "pipe" });
  transport.stderr?.resume();
  await client.connect(transport);
  return client;
};
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
let client;
try {
  client = await connect();
  const tools = await client.listTools();
  const resources = await client.listResources();
  emit({ case: "PREFLIGHT", scope: "LOCAL_BUNDLE_STDIO", server: client.getServerVersion(),
    bundleSha256: createHash("sha256").update(await readFile(join(root, "dist/mcp-server.js"))).digest("hex"),
    toolCount: tools.tools.length, resourceCount: resources.resources.length,
    nativeHostTools: "NOT_VERIFIED_BY_STDIO", nativeUI: "NOT_VERIFIED", hostForms: "NOT_VERIFIED", lifecycle: "NOT_IMPLEMENTED" });
  if (process.argv.includes("--live")) {
    const cases = [
      ["R10", "search_products", { query: "medicube Zero Pore Pad 70 pads 155g", brand: "medicube", productType: "toner pads",
        requiredFeatures: ["70 pads", "155 g"], comparisonMode: "SAME_PRODUCT", compareMerchants: true, responseLocale: "zh-CN", limit: 8 }],
      ["R11", "search_products", { query: "Sony WH-1000XM5", brand: "Sony", productType: "headphones",
        comparisonMode: "SAME_PRODUCT", compareMerchants: true, responseLocale: "zh-CN", limit: 8 }],
      ["R12", "search_visual_candidates", { query: "medicube Zero Pore Pad", brand: "medicube", brandMode: "OBSERVED", productType: "toner pads",
        responseLocale: "zh-CN", contextMode: "NEW_PRODUCT", visualInput: { productType: "toner pads", brand: "medicube",
          suspectedProductName: "Zero Pore Pad", logoText: "medicube", colors: ["blue", "white"], observations: [{
            attribute: "DETAIL", value: "Label reads ZERO PORE PAD, 155 g / 5.46 oz. (70 pads)", confidence: 0.99, visibility: "VISIBLE" }] } }]
    ];
    for (const [id, name, args] of cases) {
      const start = performance.now();
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 190_000 });
      const content = result.structuredContent ?? {};
      const trace = result._meta?.["findcheap/searchTrace"];
      emit({ case: id, scope: "ORIGINAL_NATIVE_STAGE_DEFAULT_REGISTRIES", durationMs: Math.round(performance.now() - start),
        isError: result.isError === true, errorCode: result._meta?.["findcheap/errorCode"], status: content.status,
        products: content.products?.length ?? 0, candidates: content.candidates?.length ?? 0,
        images: result.content.filter(block => block.type === "image").length,
        recovery: content.recovery, recommendationState: content.recommendation?.state,
        outcome: trace?.outcome, sourceFailures: trace?.sourceFailures, officialStore: trace?.officialStore,
        imageRequests: trace?.imageRequests, imageRetries: trace?.imageRetryRequests,
        imageLoad: result._meta?.["findcheap/visualImageLoadDiagnostics"],
        visualReview: "NOT_RUN", authorizedWebRecovery: "NOT_RUN" });
    }
  }
  const first = await client.callTool({ name: "search_products", arguments: {
    query: "MacBook Pro", brand: "Apple", productType: "laptop", responseLocale: "zh-CN" } });
  if (first.structuredContent?.status !== "NEEDS_CLARIFICATION" || !first.structuredContent.renderId) throw new Error("QA_RECEIPT_MISSING");
  await client.close(); client = await connect();
  const continued = await client.callTool({ name: "search_products", arguments: {
    query: "MacBook Pro", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: first.structuredContent.renderId,
    maxItemPriceCents: 250000, responseLocale: "zh-CN" } });
  emit({ case: "R13", scope: "ACTUAL_PROCESS_RESTART_SAME_STATE_DIRECTORY", restored: continued.isError !== true,
    errorCode: continued._meta?.["findcheap/errorCode"], recovery: continued._meta?.["findcheap/errorDetails"]?.recovery });
} catch {
  emit({ case: "HARNESS", status: "FAILED", reason: "QA_EXECUTION_FAILED" }); process.exitCode = 1;
} finally {
  await client?.close();
  // This read-only harness must leave an empty directory. Never recursively
  // remove unexpected data or touch the user's installed Watch state.
  await rmdir(stateDir).catch(() => emit({ case: "CLEANUP", status: "UNEXPECTED_STATE_RETAINED" }));
}
