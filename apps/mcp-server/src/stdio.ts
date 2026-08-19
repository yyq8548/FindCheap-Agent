import { join } from "node:path";
import { homedir } from "node:os";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBestBuyPortFromEnvironment } from "./bestbuy-client.js";
import { createComparePortFromEnvironment } from "./commerce-client.js";
import { createShoppingServer, createUnavailableComparePort } from "./server.js";
import { createShopifyPortFromEnvironment } from "./shopify-client.js";
import { createDealPortFromEnvironment } from "./deal-client.js";
import { createJsonWatchStore } from "./watch-store.js";

const comparePort = createComparePortFromEnvironment(process.env, createUnavailableComparePort);
const bestBuyPort = createBestBuyPortFromEnvironment(process.env);
const shopifyPort = createShopifyPortFromEnvironment(process.env);
const dealPort = createDealPortFromEnvironment(process.env);
const stateDirectory = process.env.FINDCHEAP_STATE_DIR ?? join(homedir(), ".findcheap-agent", "watches-v1");
const server = createShoppingServer(comparePort, bestBuyPort, shopifyPort, undefined, {
  deals: dealPort,
  watches: createJsonWatchStore(stateDirectory)
});

try {
  await server.connect(new StdioServerTransport());
} catch {
  console.error("FindCheap Agent MCP server failed to start.");
  process.exitCode = 1;
}
