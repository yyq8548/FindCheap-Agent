import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const TOOL_ERROR_CODES = [
  "INVALID_ARGUMENTS",
  "TOOL_NOT_AVAILABLE",
  "TOOL_OUTPUT_REJECTED",
  "TOOL_REQUEST_REJECTED",
  "TOOL_EXECUTION_FAILED"
] as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

const TOOL_ERROR_MESSAGES: Record<ToolErrorCode, string> = {
  INVALID_ARGUMENTS: "Tool arguments were invalid.",
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

export function toolError(code: ToolErrorCode): CallToolResult {
  const message = TOOL_ERROR_MESSAGES[code];
  return {
    isError: true,
    content: [{ type: "text", text: `[${code}] ${message}` }],
    _meta: { "findcheap/errorCode": code }
  };
}

export function normalizeToolError(result: CallToolResult): CallToolResult {
  if (result.isError !== true) return result;
  return {
    ...result,
    _meta: {
      ...result._meta,
      "findcheap/errorCode": "TOOL_REQUEST_REJECTED"
    }
  };
}
