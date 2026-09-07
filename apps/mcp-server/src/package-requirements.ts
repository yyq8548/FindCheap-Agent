/** Whole, explicit package expressions only. Never interpret a bare number or
 * partially strip a compound requirement; unknown physical sizes stay intact. */
export function normalizePackageRequirements<T extends { requiredSize?: string | undefined; requiredFeatures: string[];
  query?: string | undefined; productType?: string | undefined }>(input: T): T {
  if (input.requiredSize === undefined) return input;
  const parts = input.requiredSize.normalize("NFKC").trim().split(/\s*[,、;/]\s*/u);
  // Chinese 片 can mean tablets, slices or pads. Do not choose a product type.
  if (parts.some(part => part.includes("片")) && !/\bpads?\b|棉片/iu.test(input.productType ?? input.query ?? "")) return input;
  const units: Record<string, string> = { pad: "pads", pads: "pads", 片: "pads", g: "g", 克: "g",
    kg: "kg", ml: "ml", 毫升: "ml", oz: "oz", "fl oz": "fl oz", count: "count", ct: "count" };
  const requirements = parts.map(part => {
    const match = /^(\d+(?:\.\d+)?)\s*(pads?|片|g|克|kg|ml|毫升|oz|fl oz|count|ct)$/iu.exec(part);
    return match !== null && Number(match[1]) > 0 ? `${match[1]} ${units[match[2]!.toLowerCase()]}` : undefined;
  });
  if (requirements.some(value => value === undefined)) return input;
  const requiredFeatures = [...new Set([...input.requiredFeatures, ...requirements as string[]])];
  // Preserve the entire original constraint if the canonical form cannot fit.
  if (requiredFeatures.length > 10) return input;
  const normalized = { ...input, requiredFeatures };
  delete normalized.requiredSize;
  return normalized;
}
