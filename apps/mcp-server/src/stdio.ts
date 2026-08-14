import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createComparePortFromEnvironment } from "./commerce-client.js";
import { createShoppingServer, createUnavailableComparePort } from "./server.js";

const comparePort = createComparePortFromEnvironment(process.env, createUnavailableComparePort);
const server = createShoppingServer(comparePort);

try {
  await server.connect(new StdioServerTransport());
} catch {
  console.error("FindCheap-Agent MCP server failed to start.");
  process.exitCode = 1;
}
