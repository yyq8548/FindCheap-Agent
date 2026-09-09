import { SearchBudgetError, SearchReadTimeoutError } from "./search-run.js";
import { TransportFailure, type TransportPhase } from "../../../packages/network-safety/src/transport-failure.js";
import { z } from "zod";
import type { ShopifySearchResult } from "./shopify-client.js";
import type { WooSearchResult, WooStoreResult } from "../../../packages/contracts/src/woocommerce.js";

export const SourceValidationDetailsSchema = z.object({
  provider: z.literal("SONY"),
  stage: z.enum(["SEARCH_RESPONSE", "DETAIL_RESPONSE"]),
  reason: z.enum(["INVALID_JSON", "INVALID_SCHEMA", "PRODUCT_URL_INVALID", "PRODUCT_IDENTITY_INVALID",
    "MODEL_IDENTITY_INVALID", "VARIANT_IDENTITY_INVALID", "VARIANT_COLOR_INVALID"]),
  fields: z.array(z.enum(["PRODUCTS", "CODE", "URL", "MODEL", "PRICE", "STOCK", "VARIANT", "CONTENT", "IMAGE", "OTHER"])).max(8).optional()
}).strict();
export type SourceValidationDetails = z.infer<typeof SourceValidationDetailsSchema>;

/** Source-owned parse diagnostics only. Never expose exception text or source values. */
export class SourceValidationError extends Error {
  readonly validation: SourceValidationDetails;
  constructor(readonly original: Error, validation: SourceValidationDetails) {
    super(original.message, { cause: original });
    this.name = "SourceValidationError";
    this.validation = SourceValidationDetailsSchema.parse(validation);
  }
}

export type SourceFailure = {
  source: "AWIN" | "SHOPIFY" | "EBAY" | "WOOCOMMERCE" | "OFFICIAL";
  kind: "INVALID_QUERY" | "SOURCE_REJECTED" | "TIMEOUT" | "RATE_LIMITED" | "UPSTREAM_ERROR" |
    "CONNECTION_FAILED" | "SCHEMA_INVALID" | "SECURITY_REJECTED" | "BUDGET_EXHAUSTED" | "UNSUPPORTED" | "UNKNOWN";
  retryable: boolean;
  scope?: "SOURCE" | "SEARCH";
  phase?: TransportPhase;
  validation?: SourceValidationDetails;
};

/** Retrying the failed source and requesting independent, host-authorized recovery
 * are different decisions. Unclassified and safety failures remain closed. */
export function allowsIndependentSourceRecovery(failure: SourceFailure): boolean {
  if (["SECURITY_REJECTED", "SCHEMA_INVALID", "SOURCE_REJECTED", "INVALID_QUERY", "UNKNOWN"].includes(failure.kind)) return false;
  return failure.retryable || (failure.source === "WOOCOMMERCE" && failure.scope === "SOURCE" &&
    ["UNSUPPORTED", "BUDGET_EXHAUSTED"].includes(failure.kind));
}

/** More catalog pages are incomplete coverage, not an unavailable provider. */
export function isCompletedShopifyPage(result: ShopifySearchResult | undefined, failures: readonly SourceFailure[] = []): boolean {
  return result?.coverage === "PARTIAL" && result.pagination?.hasNextPage === true &&
    result.diagnostics.coverageScope === "RETURNED_PAGE" && !failures.some(failure => failure.source === "SHOPIFY");
}

export function wooStoreSourceFailure(reason: NonNullable<WooStoreResult["reason"]>): SourceFailure {
  return { source: "WOOCOMMERCE",
    kind: reason === "TIMEOUT" ? "TIMEOUT" : reason === "RATE_LIMITED" ? "RATE_LIMITED" :
      reason === "SECURITY_REJECTED" ? "SECURITY_REJECTED" : reason === "ACCESS_DENIED" ? "SOURCE_REJECTED" :
        reason === "INVALID_RESPONSE" ? "SCHEMA_INVALID" : reason === "BUDGET_EXHAUSTED" ? "BUDGET_EXHAUSTED" : reason === "UNSUPPORTED" ? "UNSUPPORTED" : "UPSTREAM_ERROR",
    ...(["UNSUPPORTED", "BUDGET_EXHAUSTED"].includes(reason) ? { scope: "SOURCE" as const } : {}),
    retryable: ["TIMEOUT", "RATE_LIMITED", "UPSTREAM_UNAVAILABLE", "CIRCUIT_OPEN"].includes(reason) };
}

/** Every observed store/pass must explain incomplete reads. Coverage bounds are
 * positive source facts, not failures or permission to bypass host consent. */
export function wooCoverageState(result: WooSearchResult | undefined, failures: readonly SourceFailure[] = [],
  passes: readonly Pick<WooSearchResult, "status" | "stores" | "diagnostics">[] = []) {
  const observations = passes.length > 0 ? passes : result === undefined ? [] : [result];
  const sourceFailures = failures.filter(failure => failure.source === "WOOCOMMERCE");
  const completedStore = (store: WooStoreResult, truncated: boolean) => store.reason === undefined &&
    (store.status === "COMPLETE" && store.boundedReasons === undefined ||
      store.status === "PARTIAL" && truncated && store.requests > 0 && (store.boundedReasons?.length ?? 0) > 0 &&
      store.boundedReasons!.every(reason => ["PRODUCT_PAGE_LIMIT", "VARIANT_PAGE_LIMIT", "VARIANT_LIMIT"].includes(reason)));
  const completedPass = (pass: typeof observations[number]) => pass.status === "NOT_CONFIGURED" ? pass.stores.length === 0 :
    (pass.status === "COMPLETE" && pass.stores.every(store => store.status === "COMPLETE") ||
      pass.status === "PARTIAL" && pass.stores.some(store => store.status === "PARTIAL")) &&
    pass.stores.every(store => completedStore(store, pass.diagnostics.truncated));
  const complete = observations.every(completedPass);
  const explained = observations.every(pass => completedPass(pass) ||
    ["PARTIAL", "UNAVAILABLE"].includes(pass.status) && pass.stores.some(store => store.status !== "COMPLETE") && pass.stores.every(store =>
      completedStore(store, pass.diagnostics.truncated) || store.status !== "COMPLETE" && store.reason !== undefined &&
      allowsIndependentSourceRecovery(wooStoreSourceFailure(store.reason))));
  return { completed: complete && sourceFailures.length === 0,
    recoveryAllowed: explained && sourceFailures.every(allowsIndependentSourceRecovery) };
}

/** Only locally owned error types/messages map to safe public reason codes.
 * Unknown failures remain closed; no raw exception text enters diagnostics. */
export function classifySourceFailure(source: SourceFailure["source"], error: unknown): SourceFailure {
  const result = (kind: SourceFailure["kind"], retryable = false): SourceFailure => ({ source, kind, retryable });
  if (error instanceof SourceValidationError) return { ...classifySourceFailure(source, error.original), validation: error.validation };
  if (error instanceof SearchBudgetError) return result("BUDGET_EXHAUSTED");
  if (error instanceof TransportFailure) return { ...result(error.kind, error.retryable), phase: error.phase };
  if (!(error instanceof Error)) return result("UNKNOWN");
  if (error instanceof SearchReadTimeoutError || error.name === "TimeoutError" ||
    error.message === "catalog search deadline exceeded" || error.message === "Awin Search service exceeded its retry budget") return result("TIMEOUT", true);
  if (error.message === "SOURCE_QUERY_INVALID" || /^Awin search (?:query is invalid|input |limit |maximum item price)/u.test(error.message)) return result("INVALID_QUERY");
  if (/^unapproved Awin (?:merchant )?URL$|^invalid Awin image URL$|^UNSAFE_URL$|^SSRF_BLOCKED$/u.test(error.message) ||
    /^(?:redirect )?(?:blocked (?:URL|protocol|port|host|address)|DNS blocked|request blocked)|^redirect (?:blocked|limit exceeded)/u.test(error.message)) return result("SECURITY_REJECTED");
  if (error.message === "CATALOG_SCHEMA_CHANGED" || error.name === "ZodError" || error.name === "SyntaxError" ||
    /^(?:Awin|eBay|WooCommerce) (?:Search|search) (?:service |result |diagnostics |products )/u.test(error.message) && /invalid|unsupported|inconsistent|too large|empty body/u.test(error.message)) return result("SCHEMA_INVALID");
  const status = /^(?:(?:Awin|eBay|WooCommerce) Search|Shopify Catalog) service returned HTTP (\d{3})$/u.exec(error.message)?.[1];
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
