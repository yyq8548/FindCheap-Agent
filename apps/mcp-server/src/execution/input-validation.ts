import { z } from "zod";

export type SafeInputIssue = {
  path: string;
  code: "TOO_LONG" | "TOO_MANY_ITEMS" | "OUT_OF_RANGE" | "REQUIRED" | "INVALID_TYPE" |
    "INVALID_ENUM" | "INVALID_FORMAT" | "UNSUPPORTED_FIELDS" | "INVALID_VALUE";
  action: "SHORTEN_TEXT" | "REMOVE_EXTRA_ITEMS" | "SET_VALID_VALUE" | "SUPPLY_REQUIRED_FIELD" |
    "REMOVE_UNSUPPORTED_FIELDS";
  maximum?: number;
  minimum?: number;
};

// Paths come from the declared schema, never record keys or custom error text.
function declaredPath(schema: unknown, path: readonly (string | number)[], depth = 0): string | undefined {
  if (depth > 24) return undefined;
  if (path.length === 0) return "";
  if (schema instanceof z.ZodEffects) return declaredPath(schema.innerType(), path, depth + 1);
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable ||
      schema instanceof z.ZodBranded || schema instanceof z.ZodReadonly) {
    return declaredPath(schema.unwrap(), path, depth + 1);
  }
  if (schema instanceof z.ZodDefault) return declaredPath(schema.removeDefault(), path, depth + 1);
  if (schema instanceof z.ZodCatch) return declaredPath(schema.removeCatch(), path, depth + 1);
  if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) {
    for (const option of schema.options) {
      const found = declaredPath(option, path, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const [head, ...tail] = path;
  if (schema instanceof z.ZodObject && typeof head === "string" &&
      /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(head) && Object.hasOwn(schema.shape, head)) {
    const suffix = declaredPath(schema.shape[head], tail, depth + 1);
    return suffix === undefined ? undefined : `${head}${suffix.startsWith("[") || suffix === "" ? "" : "."}${suffix}`;
  }
  if (schema instanceof z.ZodArray && typeof head === "number" && Number.isSafeInteger(head) && head >= 0 && head < 512) {
    const suffix = declaredPath(schema.element, tail, depth + 1);
    return suffix === undefined ? undefined : `[${head}]${suffix.startsWith("[") || suffix === "" ? "" : "."}${suffix}`;
  }
  return undefined;
}

export function safeInputIssues(error: z.ZodError | undefined, schema: unknown): SafeInputIssue[] {
  return (error?.issues ?? []).slice(0, 5).map((issue): SafeInputIssue => {
    const path = declaredPath(schema, issue.path) || "$";
    if (issue.code === "too_big" || issue.code === "too_small") {
      const maximum = issue.code === "too_big" ? issue.maximum : undefined;
      const minimum = issue.code === "too_small" ? issue.minimum : undefined;
      return {
        path,
        code: issue.code === "too_big" && issue.type === "string" ? "TOO_LONG"
          : issue.code === "too_big" && issue.type === "array" ? "TOO_MANY_ITEMS" : "OUT_OF_RANGE",
        action: issue.code === "too_big" && issue.type === "string" ? "SHORTEN_TEXT"
          : issue.code === "too_big" && issue.type === "array" ? "REMOVE_EXTRA_ITEMS" : "SET_VALID_VALUE",
        ...(typeof maximum === "number" && Number.isFinite(maximum) && maximum >= 0 && maximum <= 1_000_000 ? { maximum } : {}),
        ...(typeof minimum === "number" && Number.isFinite(minimum) && minimum >= 0 && minimum <= 1_000_000 ? { minimum } : {})
      };
    }
    if (issue.code === "invalid_type") {
      return issue.received === "undefined"
        ? { path, code: "REQUIRED", action: "SUPPLY_REQUIRED_FIELD" }
        : { path, code: "INVALID_TYPE", action: "SET_VALID_VALUE" };
    }
    if (issue.code === "unrecognized_keys") return { path, code: "UNSUPPORTED_FIELDS", action: "REMOVE_UNSUPPORTED_FIELDS" };
    if (issue.code === "invalid_enum_value") return { path, code: "INVALID_ENUM", action: "SET_VALID_VALUE" };
    if (issue.code === "invalid_string") return { path, code: "INVALID_FORMAT", action: "SET_VALID_VALUE" };
    return { path, code: "INVALID_VALUE", action: "SET_VALID_VALUE" };
  });
}
