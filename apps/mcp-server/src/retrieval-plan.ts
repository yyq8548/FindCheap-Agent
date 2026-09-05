import { parseAwinSearchInput } from "../../../packages/awin-feed/src/index.js";
import { hasSpecificProductIdentity, hasStrongProductIdentifier } from "./shopify-match.js";
import { namedIdentityRetrievalQuery } from "./named-product-identity.js";

/** Retrieval terms are not eligibility rules. Never write compiled terms back
 * into the user request, identity assessment or requirement ledger. */
export type CatalogSource = "AWIN" | "SHOPIFY" | "EBAY";

export function compileSourceQuery(source: CatalogSource, query: string, options: {
  pass: 1 | 2;
  identityQuery: string;
  visual: boolean;
}): string {
  let selected = query;
  if (!options.visual) {
    // Never infer that arbitrary English/Chinese segments mean the same thing.
    // The tiny reviewed alias table may propose a complementary language query.
    if (!hasStrongProductIdentifier(options.identityQuery)) selected = namedIdentityRetrievalQuery(options.identityQuery, options.pass) ?? query;
  }
  // Awin's AND-token search rejects punctuation; the other catalog adapters
  // accept this conservative literal form without interpreting search syntax.
  const compiled = selected.normalize("NFKC").replace(/[’]/gu, "'").replace(/&/gu, " and ")
    .replace(/[^\p{L}\p{N}\s._+'-]+/gu, " ").replace(/\s+/gu, " ").slice(0, 300).trim();
  if (source === "AWIN") parseAwinSearchInput({ query: compiled, limit: 1 });
  if (compiled.length < 2 || !/[\p{L}\p{N}]/u.test(compiled)) throw new Error("SOURCE_QUERY_INVALID");
  return compiled;
}

export function discoveryTarget(input: { limit: number; comparisonMode: "DISCOVERY" | "SAME_PRODUCT" }, visual: boolean): number {
  return visual || input.comparisonMode === "SAME_PRODUCT" ? input.limit : Math.min(3, input.limit);
}

export function isExplicitCategoryQuery(query: string, productType?: string): boolean {
  const normalized = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const value = normalized(query);
  const evCategory = /^(?:ev (?:charging station|charger)|electric vehicle (?:charging station|charger)|充电桩)$/u;
  return (productType !== undefined && !hasSpecificProductIdentity(productType, 1) && value === normalized(productType)) ||
    evCategory.test(value) || (productType !== undefined && evCategory.test(normalized(productType)) && /^(?:charging station|charger)$/u.test(value));
}
