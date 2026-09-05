import { SearchBudgetError, SearchReadTimeoutError } from "./search-run.js";

export type SourceFailure = {
  source: "AWIN" | "SHOPIFY" | "EBAY" | "OFFICIAL";
  kind: "INVALID_QUERY" | "SOURCE_REJECTED" | "TIMEOUT" | "RATE_LIMITED" | "UPSTREAM_ERROR" |
    "CONNECTION_FAILED" | "SCHEMA_INVALID" | "SECURITY_REJECTED" | "BUDGET_EXHAUSTED" | "UNKNOWN";
  retryable: boolean;
};

/** Only locally owned error types/messages map to safe public reason codes.
 * Unknown failures remain closed; no raw exception text enters diagnostics. */
export function classifySourceFailure(source: SourceFailure["source"], error: unknown): SourceFailure {
  const result = (kind: SourceFailure["kind"], retryable = false): SourceFailure => ({ source, kind, retryable });
  if (error instanceof SearchBudgetError) return result("BUDGET_EXHAUSTED");
  if (!(error instanceof Error)) return result("UNKNOWN");
  if (error instanceof SearchReadTimeoutError || error.name === "TimeoutError" ||
    error.message === "catalog search deadline exceeded" || error.message === "Awin Search service exceeded its retry budget") return result("TIMEOUT", true);
  if (error.message === "SOURCE_QUERY_INVALID" || /^Awin search (?:query is invalid|input |limit |maximum item price)/u.test(error.message)) return result("INVALID_QUERY");
  if (/^unapproved Awin (?:merchant )?URL$|^invalid Awin image URL$|^UNSAFE_URL$|^SSRF_BLOCKED$/u.test(error.message) ||
    /^(?:redirect )?(?:blocked (?:URL|protocol|port|host|address)|DNS blocked|request blocked)|^redirect (?:blocked|limit exceeded)/u.test(error.message)) return result("SECURITY_REJECTED");
  if (error.message === "CATALOG_SCHEMA_CHANGED" || error.name === "ZodError" || error.name === "SyntaxError" ||
    /^(?:Awin|eBay) (?:Search|search) (?:service |result |diagnostics |products )/u.test(error.message) && /invalid|unsupported|inconsistent|too large|empty body/u.test(error.message)) return result("SCHEMA_INVALID");
  const status = /^(?:(?:Awin|eBay) Search|Shopify Catalog) service returned HTTP (\d{3})$/u.exec(error.message)?.[1];
  if (status === "429") return result("RATE_LIMITED", true);
  if (status !== undefined) return Number(status) >= 500 ? result("UPSTREAM_ERROR", true) : result("SOURCE_REJECTED");
  const code = "code" in error ? error.code : undefined;
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT") return result("TIMEOUT", true);
  if (code === "ECONNRESET" || code === "ECONNREFUSED" || code === "EAI_AGAIN") return result("CONNECTION_FAILED", true);
  if (error.cause !== undefined && error.cause !== error) {
    // Provider wrappers retain their original error; bound traversal explicitly.
    const cause = error.cause;
    if (cause instanceof Error && cause.cause === undefined) return classifySourceFailure(source, cause);
  }
  return result("UNKNOWN");
}
