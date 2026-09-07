// Bounded live regression of known development cases, not general accuracy acceptance.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile, mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { createHash } from "node:crypto";
import process from "node:process";

if (!process.argv.includes("--live")) throw new Error("EXPLICIT_LIVE_FLAG_REQUIRED");
const root = process.env.FINDCHEAP_PLUGIN_ROOT ?? fileURLToPath(new URL("../../../plugins/findcheap-agent/", import.meta.url));
const config = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8")).mcpServers["findcheap-agent"];
const stateDirectory = await mkdtemp(join(tmpdir(), "findcheap-identity-qa-"));
const client = new Client({ name: "findcheap-identity-qa", version: "1" });
const transport = new StdioClientTransport({ command: process.execPath, args: config.args, cwd: root,
  env: { ...config.env, PATH: process.env.PATH ?? "", FINDCHEAP_STATE_DIR: stateDirectory }, stderr: "pipe" });
transport.stderr?.resume();
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const cases = [
  { id: "UNSPECIFIED_EDITION", query: "medicube Zero Pore Pad 70 pads 155g", brand: "medicube", productType: "toner pads", requiredFeatures: ["70 pads", "155 g"] },
  { id: "EXPLICIT_MILD", query: "medicube Zero Pore Pad Mild 70 pads 155g", brand: "medicube", productType: "toner pads", requiredFeatures: ["70 pads", "155 g"] },
  { id: "NAMED_MODEL", query: "Sony WH-1000XM6", brand: "Sony", productType: "headphones", requiredFeatures: [] }
];
try {
  await client.connect(transport);
  emit({ scope: process.env.FINDCHEAP_PLUGIN_ROOT ? "SELECTED_PLUGIN_LIVE_READ_ONLY" : "LOCAL_BUNDLE_LIVE_READ_ONLY", bundleSha256: createHash("sha256").update(await readFile(join(root, "dist/mcp-server.js"))).digest("hex"),
    nativeUI: "NOT_TESTED", originalImageIdentity: "NOT_VERIFIED", hostedDeployment: "NOT_CHANGED" });
  for (const { id, ...input } of cases) {
    const response = await client.callTool({ name: "search_products", arguments: { ...input,
      comparisonMode: "SAME_PRODUCT", compareMerchants: true, responseLocale: "zh-CN", limit: 8 } }, undefined, { timeout: 95_000 });
    const result = response.structuredContent ?? {};
    const products = result.products ?? [];
    const assertions = [];
    const check = (name, passed) => assertions.push({ name, passed: passed === true });
    check("tool_success", response.isError !== true);
    check("has_candidates", products.length > 0);
    const offerKeys = products.map(product => {
      const url = new URL(product.merchantUrl);
      return JSON.stringify([url.hostname, url.pathname, url.searchParams.getAll("variant")]);
    });
    check("distinct_offer_cards", new Set(offerKeys).size === offerKeys.length);
    check("final_offer_count", result.comparison?.offerCount === products.length);
    const merchants = new Set(products.map(product => new URL(product.merchantUrl).hostname.replace(/^www\./u, "")));
    check("final_merchant_count", result.comparison?.merchantCount === merchants.size);
    check("badge_agrees", products.every(product => product.card?.matchBadge === product.matchStatus));
    check("no_false_zero_result_copy", !/没有返回符合要求的同款|没有找到符合要求的同款/u.test(result.message ?? ""));
    if (id === "UNSPECIFIED_EDITION") {
      check("no_unverified_primary", result.recommendation?.state === "RESEARCH_ONLY");
      check("mild_not_asserted_same_item", products.filter(product => /mild/iu.test(product.title)).every(product => product.matchStatus !== "EXACT" && product.requestIdentityStatus === "NEEDS_VERIFICATION"));
      check("identity_recovery", result.recovery?.reason === "IDENTITY_UNVERIFIED" && result.recovery?.awaitingVerification === products.length);
    } else {
      check("explicit_identity_remains_usable", result.recommendation?.state === "READY");
    }
    if (assertions.some(assertion => !assertion.passed)) process.exitCode = 1;
    emit({ case: id, status: assertions.every(assertion => assertion.passed) ? "PASS" : "FAIL", assertions,
      products: products.map(product => ({ title: product.title, host: product.sourceHost, matchStatus: product.matchStatus,
        requestIdentityStatus: product.requestIdentityStatus, presentationGroup: product.presentationGroup })),
      recommendation: result.recommendation?.state, comparison: result.comparison, recovery: result.recovery });
  }
} catch {
  emit({ status: "FAIL", reason: "LIVE_DIAGNOSTIC_FAILED" }); process.exitCode = 1;
} finally {
  await client.close();
  // Do not recursively remove unexpected state or touch installed user state.
  await rmdir(stateDirectory).catch(() => { emit({ status: "FAIL", reason: "UNEXPECTED_STATE_RETAINED" }); process.exitCode = 1; });
}
