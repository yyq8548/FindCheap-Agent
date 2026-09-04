import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SafeInputIssue } from "./input-validation.js";

export const TOOL_ERROR_CODES = [
  "INVALID_ARGUMENTS",
  "MISSING_REFERENCE_CONTEXT",
  "TOOL_NOT_AVAILABLE",
  "TOOL_OUTPUT_REJECTED",
  "TOOL_REQUEST_REJECTED",
  "TOOL_EXECUTION_FAILED"
] as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];
export type ToolFailurePhase = "CAPABILITY_CHECK" | "INPUT_VALIDATION" | "DOMAIN_EXECUTION" | "OUTPUT_VALIDATION";

const TOOL_ERROR_MESSAGES: Record<ToolErrorCode, string> = {
  INVALID_ARGUMENTS: "Tool arguments were invalid.",
  MISSING_REFERENCE_CONTEXT: "Tool call omitted required prior-product reference context.",
  TOOL_NOT_AVAILABLE: "This tool is not available in the current FindCheap configuration.",
  TOOL_OUTPUT_REJECTED: "Tool output did not satisfy FindCheap safety requirements.",
  TOOL_REQUEST_REJECTED: "The requested FindCheap operation was rejected.",
  TOOL_EXECUTION_FAILED: "The requested FindCheap operation is temporarily unavailable."
};

export class ToolOutputRejectedError extends Error {
  constructor() {
    super(TOOL_ERROR_MESSAGES.TOOL_OUTPUT_REJECTED);
    this.name = "ToolOutputRejectedError";
  }
}

export function toolError(
  code: ToolErrorCode,
  options: { phase?: ToolFailurePhase; issues?: SafeInputIssue[] } = {}
): CallToolResult {
  const message = TOOL_ERROR_MESSAGES[code];
  const inputFailure = code === "INVALID_ARGUMENTS" || code === "MISSING_REFERENCE_CONTEXT";
  const details = {
    version: 1,
    phase: options.phase ?? (inputFailure ? "INPUT_VALIDATION"
      : code === "TOOL_OUTPUT_REJECTED" ? "OUTPUT_VALIDATION"
        : code === "TOOL_NOT_AVAILABLE" ? "CAPABILITY_CHECK" : "DOMAIN_EXECUTION"),
    recovery: code === "INVALID_ARGUMENTS" ? { action: "CORRECT_ARGUMENTS", maxAttempts: 1 }
      : code === "MISSING_REFERENCE_CONTEXT" ? { action: "REUSE_ORIGINAL_REFERENCE", maxAttempts: 1 }
        : { action: "NONE", maxAttempts: 0 },
    ...(options.issues === undefined ? {} : { issues: options.issues.slice(0, 5) })
  };
  return {
    isError: true,
    content: [{ type: "text", text: `[${code}] ${message}\n${JSON.stringify(details)}` }],
    _meta: { "findcheap/errorCode": code, "findcheap/errorDetails": details }
  };
}

export function normalizeToolError(result: CallToolResult): CallToolResult {
  if (result.isError !== true) return result;
  const originalCode = result._meta?.["findcheap/errorCode"];
  const code = typeof originalCode === "string" && TOOL_ERROR_CODES.includes(originalCode as ToolErrorCode)
    ? originalCode : "TOOL_REQUEST_REJECTED";
  return {
    ...result,
    _meta: {
      ...result._meta,
      "findcheap/errorCode": code
    }
  };
}
