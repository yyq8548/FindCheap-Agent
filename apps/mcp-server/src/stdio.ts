import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBestBuyPortFromEnvironment } from "./bestbuy-client.js";
import { createComparePortFromEnvironment } from "./commerce-client.js";
import { createShoppingServer, createUnavailableComparePort } from "./server.js";

const comparePort = createComparePortFromEnvironment(process.env, createUnavailableComparePort);
const bestBuyPort = createBestBuyPortFromEnvironment(process.env);
const server = createShoppingServer(comparePort, bestBuyPort);

try {
  await server.connect(new StdioServerTransport());
} catch {
  console.error("FindCheap-Agent MCP server failed to start.");
  process.exitCode = 1;
}
