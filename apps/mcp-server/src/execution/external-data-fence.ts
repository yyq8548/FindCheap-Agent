import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ToolOutputRejectedError } from "./tool-outcome.js";

export const MAX_TOOL_TEXT_CHARS = 24_000;
export const MAX_EXTERNAL_FIELD_CHARS = 4_000;
export const MAX_TOOL_OUTPUT_BYTES = 512_000;
const MAX_ARRAY_ITEMS = 512;
const MAX_OBJECT_FIELDS = 256;

const FORMAT_CHARACTERS = /\p{Cf}/gu;
const SPECIAL_TOKEN = /<\|[^|\r\n]{1,80}\|>/gu;
const ROLE_TAG = /<\/?(?:assistant|developer|system|tool|user|findcheap-external-data)(?:\s[^>]*)?>/giu;
const FORGED_ROLE_BOUNDARY = /(^|\n)\s*(assistant|developer|system|tool|user)\s*[:：]/giu;

export function sanitizeExternalText(value: string, maxChars = MAX_EXTERNAL_FIELD_CHARS): string {
  const compatibilityNormalized = [...value.normalize("NFC")]
    .map((character) => /\p{P}/u.test(character) ? character : character.normalize("NFKC"))
    .join("");
  const withoutControls = [...compatibilityNormalized].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return character === "\n" || character === "\t" || !(
      code <= 0x1f || (code >= 0x7f && code <= 0x9f)
    );
  }).join("");
  const normalized = withoutControls
    .replace(FORMAT_CHARACTERS, "")
    .replace(SPECIAL_TOKEN, "[removed]")
    .replace(ROLE_TAG, "[removed]")
    .replace(FORGED_ROLE_BOUNDARY, (_match, prefix: string, role: string) => `${prefix}[removed ${role}] :`);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function sanitizeExternalValue(value: unknown): unknown {
  return sanitizeValue(value, new WeakSet<object>());
}

export function fenceExternalPayload(value: unknown): string {
  const sanitized = sanitizeExternalValue(value);
  return `<findcheap-external-data>\n${JSON.stringify(sanitized)}\n</findcheap-external-data>`;
}

export function fenceExternalText(value: string): string {
  const body = sanitizeExternalText(value, MAX_TOOL_TEXT_CHARS - 80);
  return `<findcheap-external-data>\n${body}\n</findcheap-external-data>`;
}

export function sanitizeToolResult(result: CallToolResult): CallToolResult {
  const content = result.content.map(sanitizeContentItem);
  const structuredContent = result.structuredContent === undefined
    ? undefined
    : sanitizeExternalValue(result.structuredContent);
  const sanitized: CallToolResult = {
    content,
    ...(result.isError === undefined ? {} : { isError: result.isError }),
    ...(result._meta === undefined ? {} : { _meta: sanitizeExternalValue(result._meta) as Record<string, unknown> }),
    ...(structuredContent === undefined
      ? { structuredContent: undefined }
      : { structuredContent: structuredContent as Record<string, unknown> })
  };
  const byteLength = Buffer.byteLength(JSON.stringify(sanitized), "utf8");
  if (byteLength > MAX_TOOL_OUTPUT_BYTES) throw new ToolOutputRejectedError();
  return sanitized;
}

function sanitizeContentItem(item: CallToolResult["content"][number]): CallToolResult["content"][number] {
  const annotations = item.annotations === undefined
    ? {}
    : { annotations: sanitizeExternalValue(item.annotations) as typeof item.annotations };
  const meta = item._meta === undefined
    ? {}
    : { _meta: sanitizeExternalValue(item._meta) as Record<string, unknown> };
  switch (item.type) {
    case "text":
      return { ...item, ...annotations, ...meta, text: fenceExternalText(item.text) };
    case "image":
    case "audio":
      return { ...item, ...annotations, ...meta };
    case "resource_link":
      return sanitizeExternalValue({ ...item, ...annotations, ...meta }) as typeof item;
    case "resource": {
      const resource = "text" in item.resource
        ? { ...item.resource, text: fenceExternalText(item.resource.text) }
        : item.resource;
      return { ...item, ...annotations, ...meta, resource };
    }
  }
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return sanitizeExternalText(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) throw new ToolOutputRejectedError();
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_ITEMS) throw new ToolOutputRejectedError();
      return value.map((item) => sanitizeValue(item, seen));
    }
    const entries = Object.entries(value);
    if (entries.length > MAX_OBJECT_FIELDS) throw new ToolOutputRejectedError();
    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of entries) {
      const safeKey = sanitizeExternalText(key, 120);
      if (safeKey in sanitized) throw new ToolOutputRejectedError();
      sanitized[safeKey] = sanitizeValue(item, seen);
    }
    return sanitized;
  } finally {
    seen.delete(value);
  }
}
