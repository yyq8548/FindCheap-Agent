import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { BackendCapability } from "./capabilities.js";
import { sanitizeToolResult } from "./external-data-fence.js";
import { normalizeToolError, ToolOutputRejectedError, toolError } from "./tool-outcome.js";

type ParseResult = { success: true; data: unknown } | { success: false };
type InputSchema = { safeParseAsync(value: unknown): Promise<ParseResult> };
type OutputParseResult = { success: true; data: unknown } | { success: false };
type OutputSchema = { safeParseAsync(value: unknown): Promise<OutputParseResult> };

export const INVALID_TOOL_INPUT = Symbol("findcheap-invalid-tool-input");

export type ToolExecutionSpec = {
  name: string;
  capability: BackendCapability;
  inputSchema?: InputSchema;
  outputSchema?: OutputSchema;
};

export type ToolExecutorOptions = {
  capabilities: ReadonlySet<BackendCapability>;
  log?: (message: string) => void;
};

export class ToolExecutor {
  readonly #capabilities: ReadonlySet<BackendCapability>;
  readonly #log: (message: string) => void;
  readonly #tools = new Map<string, ToolExecutionSpec>();

  constructor(options: ToolExecutorOptions) {
    this.#capabilities = options.capabilities;
    this.#log = options.log ?? ((message) => process.stderr.write(`${message}\n`));
  }

  register(spec: ToolExecutionSpec): void {
    if (this.#tools.has(spec.name)) throw new Error(`duplicate tool registration: ${spec.name}`);
    this.#tools.set(spec.name, spec);
  }

  registeredTools(): readonly string[] {
    return [...this.#tools.keys()];
  }

  async execute(
    name: string,
    input: unknown,
    handler: (validatedInput: unknown) => CallToolResult | Promise<CallToolResult>
  ): Promise<CallToolResult> {
    const spec = this.#tools.get(name);
    if (spec === undefined || !this.#capabilities.has(spec.capability)) {
      return toolError("TOOL_NOT_AVAILABLE");
    }
    if (
      (input !== undefined && (input === null || typeof input !== "object" || Array.isArray(input))) ||
      (input !== null && typeof input === "object" && INVALID_TOOL_INPUT in input)
    ) {
      return toolError("INVALID_ARGUMENTS");
    }
    try {
      const parsedInput = spec.inputSchema === undefined
        ? undefined
        : await spec.inputSchema.safeParseAsync(input);
      if (parsedInput?.success === false) return toolError("INVALID_ARGUMENTS");
      const validatedInput = parsedInput?.data ?? input;
      const sanitized = normalizeToolError(sanitizeToolResult(await handler(validatedInput)));
      if (sanitized.isError !== true && spec.outputSchema !== undefined && sanitized.structuredContent === undefined) {
        this.#log(`[findcheap-tool-executor] ${name} output rejected`);
        return toolError("TOOL_OUTPUT_REJECTED");
      }
      if (sanitized.structuredContent === undefined || spec.outputSchema === undefined) return sanitized;
      const parsedOutput = await spec.outputSchema.safeParseAsync(sanitized.structuredContent);
      if (!parsedOutput.success) {
        this.#log(`[findcheap-tool-executor] ${name} output rejected`);
        return toolError("TOOL_OUTPUT_REJECTED");
      }
      return {
        ...sanitized,
        structuredContent: parsedOutput.data as Record<string, unknown>
      };
    } catch (error) {
      if (error instanceof z.ZodError) return toolError("INVALID_ARGUMENTS");
      if (error instanceof ToolOutputRejectedError) return toolError("TOOL_OUTPUT_REJECTED");
      this.#log(`[findcheap-tool-executor] ${name} failed`);
      return toolError("TOOL_EXECUTION_FAILED");
    }
  }
}
