import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type StdioServerConfig = {
  type: "stdio";
  command: string;
  args: string[];
  cwd: string;
};

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const pluginRoot = path.join(repoRoot, "plugins", "shopping-agent");

describe("installed plugin stdio", () => {
  it("uses .mcp.json to initialize the committed bundle with protocol-clean stdout", async () => {
    const mcpFile = JSON.parse(
      await readFile(path.join(pluginRoot, ".mcp.json"), "utf8")
    ) as { mcpServers: { "shopping-agent": StdioServerConfig } };
    const config = mcpFile.mcpServers["shopping-agent"];
    expect(config).toEqual({
      type: "stdio",
      command: "node",
      args: ["./dist/mcp-server.js"],
      cwd: "."
    });

    const transportErrors: Error[] = [];
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd: path.resolve(pluginRoot, config.cwd),
      stderr: "pipe"
    });
    transport.onerror = (error) => transportErrors.push(error);
    const client = new Client({ name: "shopping-agent-stdio-smoke", version: "0.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const comparison = await client.callTool({
        name: "compare_products",
        arguments: { query: "OLED65C4PUA", zipCode: "33433" }
      });

      expect(tools.tools.map((tool) => tool.name)).toEqual(["compare_products"]);
      expect(comparison.structuredContent).toEqual({
        status: "DATA_SOURCE_UNAVAILABLE",
        message: "Live comparison is unavailable because no approved shopping data source is connected.",
        exactOffers: [],
        similarOffers: [],
        questions: []
      });
    } finally {
      await client.close();
    }
    expect(transportErrors).toEqual([]);
  }, 10_000);
});
