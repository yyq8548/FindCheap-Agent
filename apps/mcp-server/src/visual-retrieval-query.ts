import {
  normalizeVisualEvidence,
  relaxVisualProductInput,
  visualOfficialStoreSearchQueries,
  type VisualProductInput
} from "./visual-product-discovery.js";

/** Retrieval hints only. Required brand and product identity remain executor-owned. */
export function buildVisualRetrievalQuery(
  visual: VisualProductInput,
  options: { brand?: string; productType?: string; relaxed?: boolean } = {}
): string {
  const normalized = relaxVisualProductInput({
    ...visual,
    ...(options.productType === undefined ? {} : { productType: options.productType })
  });
  const evidence = normalizeVisualEvidence(normalized);
  const structure = evidence.filter((entry) => !["COLOR", "LENGTH", "PRODUCT_TYPE", "PATTERN", "PRINT"].includes(entry.attribute));
  // A second pass simplifies descriptive detail, not the product family or color/length.
  if (options.relaxed === true && structure.length > 1) normalized.distinctiveDetails = [structure[0]!.value];
  const queries = visualOfficialStoreSearchQueries(normalized);
  const core = queries.find((entry) => entry.stage === "CORE")?.query ?? queries[0]?.query ?? normalized.productType ?? "";
  const category = queries.find((entry) => entry.stage === "CATEGORY")?.query;
  // Non-fashion details need no clothing-specific descriptor dictionary.
  const customStructure = core === category || queries.length === 1
    ? (normalized.distinctiveDetails ?? []).slice(0, options.relaxed === true ? 1 : 2)
      .map((value) => value.split(/\s+/u).slice(0, 6).join(" ")) : [];
  const identityHint = options.relaxed === true ? undefined : visual.suspectedProductName ?? visual.modelOrStyleNumber;
  const brand = options.brand ?? visual.brand;
  const words = (value: string): string => ` ${value.normalize("NFKD").replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const brandInIdentity = brand !== undefined && identityHint !== undefined && words(identityHint).includes(words(brand));
  return [...new Set([
    brandInIdentity ? undefined : brand,
    identityHint,
    core,
    ...customStructure
  ].filter((value): value is string => value !== undefined && value.trim() !== ""))]
    .join(" ").replace(/\s+/gu, " ").trim().slice(0, 300);
}
