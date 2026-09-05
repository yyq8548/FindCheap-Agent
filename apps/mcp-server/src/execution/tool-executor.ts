import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { BackendCapability } from "./capabilities.js";
import { sanitizeToolResult } from "./external-data-fence.js";
import { safeInputIssues } from "./input-validation.js";
import { normalizeToolError, ToolOutputRejectedError, toolError, type ToolFailurePhase } from "./tool-outcome.js";

type ParseResult = { success: true; data: unknown } | { success: false; error?: z.ZodError };
type InputSchema = { safeParseAsync(value: unknown): Promise<ParseResult> };
type OutputParseResult = { success: true; data: unknown } | { success: false; error?: z.ZodError };
type OutputSchema = { safeParseAsync(value: unknown): Promise<OutputParseResult> };

export const INVALID_TOOL_INPUT = Symbol("findcheap-invalid-tool-input");

const REFERENCE_CONTEXT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  begin_web_search: ["renderId"],
  complete_web_search: ["renderId"],
  compare_selected_products: ["renderId"],
  quote_and_compare_selected_products: ["renderId"],
  inspect_selected_shopify_product: ["renderId"],
  quote_selected_shopify_product: ["renderId"],
  research_selected_product_deal: ["renderId"]
};

function missingReferenceContext(name: string, input: unknown): boolean {
  const fields = REFERENCE_CONTEXT_FIELDS[name];
  if (fields === undefined || input === null || typeof input !== "object" || Array.isArray(input)) return false;
  const values = input as Record<string, unknown>;
  return fields.every((field) => values[field] === undefined);
}

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
      input !== null &&
      typeof input === "object" &&
      INVALID_TOOL_INPUT in input
    ) {
      const invalid = (input as { [INVALID_TOOL_INPUT]: { input: unknown; error: z.ZodError } })[INVALID_TOOL_INPUT];
      return missingReferenceContext(name, invalid.input)
        ? toolError("MISSING_REFERENCE_CONTEXT")
        : toolError("INVALID_ARGUMENTS", { issues: safeInputIssues(invalid.error, spec.inputSchema) });
    }
    if (input !== undefined && (input === null || typeof input !== "object" || Array.isArray(input))) {
      return toolError("INVALID_ARGUMENTS");
    }
    if (missingReferenceContext(name, input)) return toolError("MISSING_REFERENCE_CONTEXT");
    let phase: ToolFailurePhase = "INPUT_VALIDATION";
    try {
      const parsedInput = spec.inputSchema === undefined
        ? undefined
        : await spec.inputSchema.safeParseAsync(input);
      if (parsedInput?.success === false) {
        return toolError("INVALID_ARGUMENTS", { issues: safeInputIssues(parsedInput.error, spec.inputSchema) });
      }
      const validatedInput = parsedInput?.data ?? input;
      phase = "DOMAIN_EXECUTION";
      const result = await handler(validatedInput);
      phase = "OUTPUT_VALIDATION";
      const sanitized = normalizeToolError(sanitizeToolResult(result));
      if (sanitized.isError !== true && spec.outputSchema !== undefined && sanitized.structuredContent === undefined) {
        this.#log(`[findcheap-tool-executor] ${name} output rejected`);
        return toolError("TOOL_OUTPUT_REJECTED");
      }
      if (sanitized.structuredContent === undefined || spec.outputSchema === undefined) return sanitized;
      const parsedOutput = await spec.outputSchema.safeParseAsync(sanitized.structuredContent);
      if (!parsedOutput.success) {
        this.#log(`[findcheap-tool-executor] ${name} output rejected`);
        // Schema-owned paths and reason codes only; never source text or record keys.
        this.#log(`[findcheap-output-issues] ${JSON.stringify(safeInputIssues(parsedOutput.error, spec.outputSchema))}`);
        return toolError("TOOL_OUTPUT_REJECTED");
      }
      return {
        ...sanitized,
        structuredContent: parsedOutput.data as Record<string, unknown>
      };
    } catch (error) {
      if (error instanceof z.ZodError && phase === "INPUT_VALIDATION") {
        return toolError("INVALID_ARGUMENTS", { issues: safeInputIssues(error, spec.inputSchema) });
      }
      if (error instanceof z.ZodError && phase === "OUTPUT_VALIDATION") return toolError("TOOL_OUTPUT_REJECTED");
      if (error instanceof ToolOutputRejectedError) return toolError("TOOL_OUTPUT_REJECTED");
      this.#log(`[findcheap-tool-executor] ${name} failed`);
      return toolError("TOOL_EXECUTION_FAILED", { phase });
    }
  }
}
