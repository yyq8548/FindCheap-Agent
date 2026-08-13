export function normalizeToken(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function normalizeGtin(value: string): string {
  return value.normalize("NFKC").replace(/[^0-9]/g, "");
}
