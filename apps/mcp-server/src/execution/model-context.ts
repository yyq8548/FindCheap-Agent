import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fenceExternalPayload, MAX_TOOL_OUTPUT_BYTES } from "./external-data-fence.js";
import { ToolOutputRejectedError } from "./tool-outcome.js";

const CONTEXT_TOOLS = new Set([
  "search_products", "search_visual_candidates", "finalize_visual_search",
  "begin_web_search", "complete_web_search", "inspect_selected_shopify_product",
  "compare_selected_products", "quote_and_compare_selected_products",
  "quote_selected_shopify_product", "research_selected_product_deal"
]);
const CONTEXT_FIELDS = [
  "status", "locale", "renderId", "goalId", "goalRevision", "requirementsVersion",
  "requirementsSummary", "recommendation", "recovery", "coverage", "priceScope",
  "visualSessionId", "webSessionId", "expiresAt", "workflow", "retryable",
  "queries", "limits", "comparisonId", "selectionId", "mode", "priceBasis",
  "priceComparability", "priceDelta"
] as const;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function pick(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const source = object(value);
  return Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}

function referenceRows(value: unknown, snapshotPositions = false): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((entry, index) => {
    const row = pick(entry, [
      "selectionId", "candidateId", "variantId", "quoteReference", "source", "mimeType",
      "itemPrice", "condition", "availability", "matchStatus", "quoteCapability", "variantDimensions",
      "presentationGroup", "deliveredTotal", "deliveredTotalStatus"
    ]);
    for (const key of ["title", "merchant"]) {
      const text = object(entry)[key];
      if (typeof text === "string") row[key] = text.slice(0, 240);
    }
    const trust = object(entry).merchantTrust;
    if (trust !== undefined) row.merchantTrust = pick(trust, ["level", "verification"]);
    // Comparison/variant lists can be subsets: their indices are not card positions.
    return { ...(snapshotPositions ? { position: index + 1 } : {}), ...row };
  });
}

function snapshotContext(data: Record<string, unknown>): Record<string, unknown> {
  const context = pick(data, CONTEXT_FIELDS);
  for (const key of ["products", "entries", "candidates", "variants"]) {
    const rows = referenceRows(data[key], key === "products");
    if (rows !== undefined) context[key] = rows;
  }
  if (data.visualReview !== undefined) {
    context.visualReview = {
      ...pick(data.visualReview, ["stage", "terminal", "finalAnswerAllowed", "requiredNextTool", "visualSessionId", "expiresAt"]),
      candidates: referenceRows(object(data.visualReview).candidates)
    };
  }
  return context;
}

/** Project only validated server output. A text-only client must retain the same
 * immutable references as a structured client; this does not grant permission. */
export function appendModelContext(name: string, result: CallToolResult): CallToolResult {
  if (!CONTEXT_TOOLS.has(name) || result.isError === true || result.structuredContent === undefined) return result;
  const data = result.structuredContent;
  const context = { version: 1, tool: name, ...snapshotContext(data) };
  const updatedSnapshot = data.updatedSnapshot === undefined ? undefined : snapshotContext(object(data.updatedSnapshot));
  const payload = { findcheapContext: { ...context, ...(updatedSnapshot === undefined ? {} : { updatedSnapshot }) } };
  // Never truncate serialized references or silently emit a partial JSON receipt.
  if (JSON.stringify(payload).length > 23_000) throw new ToolOutputRejectedError();
  const projected: CallToolResult = {
    ...result,
    content: [...result.content, { type: "text", text: fenceExternalPayload(payload) }]
  };
  if (Buffer.byteLength(JSON.stringify(projected), "utf8") > MAX_TOOL_OUTPUT_BYTES) throw new ToolOutputRejectedError();
  return projected;
}
