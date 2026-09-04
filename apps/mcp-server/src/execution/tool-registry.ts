import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { requiredCapabilityForTool } from "./capabilities.js";
import { INVALID_TOOL_INPUT, type ToolExecutor } from "./tool-executor.js";

type UnknownToolHandler = (...args: unknown[]) => unknown;

export type ExecutedToolRegistrar = Pick<McpServer, "registerTool">;

export function createExecutedToolRegistrar(
  server: McpServer,
  executor: ToolExecutor
): ExecutedToolRegistrar {
  const registerTool = ((name: string, config: unknown, handler: UnknownToolHandler) => {
    const inputSchema = schemaParser(config, "inputSchema");
    const outputSchema = outputParser(config);
    const capability = requiredCapabilityForTool(name);
    executor.register({
      name,
      capability,
      ...(inputSchema === undefined ? {} : { inputSchema }),
      ...(outputSchema === undefined ? {} : { outputSchema })
    });
    const wrapped = async (...args: unknown[]) => executor.execute(name, args[0], async (validatedInput) =>
      await handler(validatedInput, ...args.slice(1)) as CallToolResult
    );
    return Reflect.apply(server.registerTool, server, [name, boundaryConfig(config, inputSchema), wrapped]);
  }) as McpServer["registerTool"];
  return { registerTool };
}

function outputParser(config: unknown): z.ZodTypeAny | undefined {
  return schemaParser(config, "outputSchema");
}

function schemaParser(
  config: unknown,
  key: "inputSchema" | "outputSchema"
): z.ZodTypeAny | undefined {
  if (config === null || typeof config !== "object" || !(key in config)) return undefined;
  const schema = (config as Record<string, unknown>)[key];
  if (schema === undefined) return undefined;
  if (
    schema !== null &&
    typeof schema === "object" &&
    "safeParse" in schema &&
    typeof schema.safeParse === "function"
  ) {
    return schema as z.ZodTypeAny;
  }
  if (schema !== null && typeof schema === "object" && !Array.isArray(schema)) {
    return z.object(schema as z.ZodRawShape);
  }
  return undefined;
}

function boundaryConfig(config: unknown, inputSchema: z.ZodTypeAny | undefined): unknown {
  if (config === null || typeof config !== "object" || inputSchema === undefined) return config;
  const boundarySchema = inputSchema.catch(() => ({ [INVALID_TOOL_INPUT]: true }));
  if ("shape" in inputSchema) {
    Object.defineProperty(boundarySchema, "shape", {
      configurable: false,
      enumerable: false,
      get: () => inputSchema.shape
    });
  }
  return { ...config, inputSchema: boundarySchema };
}
