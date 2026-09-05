import { SearchProductsInputSchema, type SearchProductsInput } from "./search-products.js";

/** Pure merge; the caller resolves a same-session, unexpired explicit snapshot.
 * Parser defaults are not user requests to remove previous constraints. */
export function mergeSearchRequirements(current: SearchProductsInput, previous: SearchProductsInput): SearchProductsInput {
  if (current.contextMode === "NEW_PRODUCT") return current;
  if (current.contextMode === "CORRECT_PREVIOUS_PRODUCT") return SearchProductsInputSchema.parse({
    ...current, maxItemPriceCents: current.maxItemPriceCents ?? previous.maxItemPriceCents
  });
  const retained: Record<string, unknown> = { ...previous };
  for (const key of current.clearConstraints) {
    delete retained[key];
    if (key === "requiredFeatures" && previous.featureMode === "REQUIRED") delete retained.features;
  }
  previous = SearchProductsInputSchema.parse(retained);
  if (current.productType !== undefined && previous.productType !== undefined &&
    current.productType.toLowerCase() !== previous.productType.toLowerCase()) throw new Error("PRODUCT_CONTEXT_CONFLICT");
  if (current.brand !== undefined && previous.brand !== undefined && current.brand !== previous.brand) throw new Error("PRODUCT_CONTEXT_CONFLICT");
  const merged: Record<string, unknown> = { ...previous, parentRenderId: current.parentRenderId,
    contextMode: current.contextMode, responseLocale: current.responseLocale ?? previous.responseLocale,
    clearConstraints: [], limit: current.limit };
  for (const key of ["maxItemPriceCents", "requiredSize", "preferredSize", "primaryUse", "brand", "productType", "zipCode", "membershipIds"] as const) {
    if (current[key] !== undefined) merged[key] = current[key];
  }
  for (const key of ["requiredFeatures", "excludedFeatures", "preferences", "features"] as const) {
    merged[key] = [...new Set([...previous[key], ...current[key]])];
  }
  if (current.featureMode === "REQUIRED") merged.featureMode = "REQUIRED";
  if (current.conditionPreference !== "ANY") merged.conditionPreference = current.conditionPreference;
  if (current.allowAlternatives) merged.allowAlternatives = true;
  if (current.budgetFlexible) merged.budgetFlexible = true;
  if (current.selectionMode === "LOWEST_PRICE") merged.selectionMode = "LOWEST_PRICE";
  return SearchProductsInputSchema.parse(merged);
}
