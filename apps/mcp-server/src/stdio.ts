import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createShoppingServer, createUnavailableComparePort } from "./server.js";

const server = createShoppingServer(createUnavailableComparePort());

try {
  await server.connect(new StdioServerTransport());
} catch {
  console.error("Shopping Agent MCP server failed to start.");
  process.exitCode = 1;
}
