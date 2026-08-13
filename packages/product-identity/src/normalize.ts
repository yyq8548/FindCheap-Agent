export function normalizeToken(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function normalizeGtin(value: string): string | undefined {
  const normalized = value.normalize("NFKC");
  if (!/^\d(?:[ -]?\d){7,13}$/.test(normalized)) return undefined;
  const digits = normalized.replace(/[ -]/g, "");
  return /^\d{8,14}$/.test(digits) ? digits : undefined;
}
