import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ToolExecutor } from "../src/execution/tool-executor.js";
import { createExecutedToolRegistrar } from "../src/execution/tool-registry.js";

describe("executed MCP input contract", () => {
  it("publishes the original schema and exposes the same safe correction through Client.callTool", async () => {
    const server = new McpServer({ name: "execution-contract-test", version: "0.0.0" });
    const executor = new ToolExecutor({ capabilities: new Set(["VISUAL_SEARCH"]), log: vi.fn() });
    const schema = z.object({
      visualInput: z.object({ observations: z.array(z.object({ value: z.string().max(100) })) })
    });
    const handler = vi.fn(async () => ({ content: [{ type: "text" as const, text: "complete" }] }));
    createExecutedToolRegistrar(server, executor).registerTool("search_visual_candidates", { inputSchema: schema }, handler);
    const client = new Client({ name: "execution-contract-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const tools = await client.listTools();
      const published = tools.tools.find((tool) => tool.name === "search_visual_candidates")?.inputSchema;
      expect(published?.required).toEqual(["visualInput"]);
      expect(published?.properties).toMatchObject({
        visualInput: { properties: { observations: { items: { properties: { value: { maxLength: 100 } } } } } }
      });
      const input = { visualInput: { observations: [{ value: "x".repeat(101) }] } };
      const direct = await executor.execute("search_visual_candidates", input, handler);
      const remote = await client.callTool({ name: "search_visual_candidates", arguments: input });
      expect(remote._meta).toEqual(direct._meta);
      expect(remote.content).toEqual(direct.content);
      expect(JSON.stringify(remote.content)).toContain("visualInput.observations[0].value");
      expect(handler).not.toHaveBeenCalled();
      const corrected = await client.callTool({
        name: "search_visual_candidates",
        arguments: { visualInput: { observations: [{ value: "x".repeat(100) }] } }
      });
      expect(corrected.isError).not.toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
