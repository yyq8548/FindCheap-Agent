export function normalizeToken(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function normalizeGtin(value: string): string {
  return value.normalize("NFKC").replace(/[^0-9]/g, "");
}
