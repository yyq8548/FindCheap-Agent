import { SearchProductsInputSchema, type SearchProductsInput } from "./search-products.js";
import { sanitizeExternalText } from "./execution/external-data-fence.js";
import { normalizeNamedProductIdentity } from "./named-product-identity.js";
import { hasSpecificProductIdentity, hasStrongProductIdentifier, productQueryCategoryKeys } from "./shopify-match.js";
import { functionalRequirement, requiredPrimaryUseFeatures } from "./functional-requirements.js";
import { isColorRequirement } from "./product-constraint-matcher.js";

/** Provenance of submitted fields, not a claim that the model saw a verbatim user quote. */
export function shoppingRequirementLedger(input: SearchProductsInput) {
  type Entry = { field: "requiredFeatures" | "excludedFeatures" | "preferences" | "primaryUse" | "brand" | "requiredSize" | "maxItemPriceCents";
    value: string; strength: "REQUIRED" | "EXCLUDED" | "PREFERRED"; origin: "REQUEST_FIELD" };
  const entries: Entry[] = [];
  const add = (field: Entry["field"], value: string, strength: Entry["strength"]) => entries.push({
    field, value: sanitizeExternalText(value, 160), strength, origin: "REQUEST_FIELD"
  });
  for (const value of input.requiredFeatures) add("requiredFeatures", value, "REQUIRED");
  for (const value of input.excludedFeatures) add("excludedFeatures", value, "EXCLUDED");
  for (const value of input.preferences) add("preferences", value, "PREFERRED");
  if (input.primaryUse !== undefined) add("primaryUse", input.primaryUse,
    requiredPrimaryUseFeatures(input.primaryUse).length > 0 ? "REQUIRED" : "PREFERRED");
  if (input.brand !== undefined) add("brand", input.brand, input.brandMode === "REQUIRED" ? "REQUIRED" : "PREFERRED");
  if (input.requiredSize !== undefined) add("requiredSize", input.requiredSize, "REQUIRED");
  if (input.maxItemPriceCents !== undefined) add("maxItemPriceCents", String(input.maxItemPriceCents), "REQUIRED");
  return entries.slice(0, 40);
}

/** Pure merge; the caller resolves a same-session, unexpired explicit snapshot.
 * Parser defaults are not user requests to remove previous constraints. */
export function mergeSearchRequirements(current: SearchProductsInput, previous: SearchProductsInput): SearchProductsInput {
  if (current.removeRequiredFeatures.length > 0 && current.contextMode !== "CONTINUE_PREVIOUS_PRODUCT") throw new Error("PRODUCT_CONTEXT_CONFLICT");
  if (current.contextMode === "NEW_PRODUCT") return current;
  const correctingIdentity = current.contextMode === "CORRECT_PREVIOUS_PRODUCT";
  const retained: Record<string, unknown> = { ...previous };
  const withdrawn = new Set(current.removeRequiredFeatures.map(value => value.normalize("NFKC").toLowerCase()));
  const isWithdrawn = (value: string) => withdrawn.has(value.normalize("NFKC").toLowerCase());
  if (current.removeRequiredFeatures.some(value => ![...previous.requiredFeatures, ...(previous.featureMode === "REQUIRED" ? previous.features : [])].some(old => old.normalize("NFKC").toLowerCase() === value.normalize("NFKC").toLowerCase())) ||
    [...current.requiredFeatures, ...(current.featureMode === "REQUIRED" ? current.features : [])].some(isWithdrawn)) throw new Error("PRODUCT_CONTEXT_CONFLICT");
  retained.requiredFeatures = previous.requiredFeatures.filter(value => !isWithdrawn(value));
  if (previous.featureMode === "REQUIRED") retained.features = previous.features.filter(value => !isWithdrawn(value));
  for (const key of current.clearConstraints) {
    delete retained[key];
    if (key === "requiredFeatures" && previous.featureMode === "REQUIRED") delete retained.features;
  }
  previous = SearchProductsInputSchema.parse(retained);
  if (!correctingIdentity && current.productType !== undefined && previous.productType !== undefined &&
    current.productType.toLowerCase() !== previous.productType.toLowerCase()) throw new Error("PRODUCT_CONTEXT_CONFLICT");
  if (!correctingIdentity && current.brand !== undefined && previous.brand !== undefined && current.brand !== previous.brand) throw new Error("PRODUCT_CONTEXT_CONFLICT");
  const merged: Record<string, unknown> = { ...previous, parentRenderId: current.parentRenderId,
    contextMode: current.contextMode, responseLocale: current.responseLocale ?? previous.responseLocale,
    clearConstraints: [], removeRequiredFeatures: [], limit: current.limit };
  if (!correctingIdentity) merged.query = continuedIdentityQuery(current, previous);
  if (correctingIdentity) {
    // Correcting identity is not permission to withdraw budget, size, or must-haves.
    // Old image observations are identity evidence, not constraints for a new identity.
    merged.query = current.query;
    delete merged.visualInput;
    if (current.visualInput !== undefined) merged.visualInput = current.visualInput;
  }
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

/** CONTINUE can narrow identity, but cannot replace, combine or erase it.
 * Unreviewed translations are not evidence of identity equivalence. */
function continuedIdentityQuery(current: SearchProductsInput, previous: SearchProductsInput): string {
  // Within an already explicit EV category, "Tesla charging station" is a
  // category shorthand. This says nothing about vehicle/region compatibility.
  const evCategory = /^(?:ev (?:charging station|charger)|electric vehicle (?:charging station|charger)|充电桩)$/iu
    .test(previous.productType ?? previous.query);
  const categoryForm = (value: string) => evCategory ? value
    .replace(/\b(?:(?:ev|electric vehicle)\s+)?charging stations?\b|\b(?:ev|electric vehicle)\s+chargers?\b|充电桩/giu, "charger") : value;
  const tokens = (value: string) => [...new Set(normalizeNamedProductIdentity(categoryForm(value)).normalize("NFKD")
    .replace(/\p{M}+/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
  const same = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every(token => right.includes(token));
  const oldTokens = tokens(previous.query);
  const newTokens = tokens(current.query);
  if (same(oldTokens, newTokens)) return previous.query;
  const oldCategories = productQueryCategoryKeys(normalizeNamedProductIdentity(categoryForm([previous.query, previous.productType].filter(Boolean).join(" "))));
  const newCategories = productQueryCategoryKeys(normalizeNamedProductIdentity(categoryForm(current.query)));
  if (newCategories.some(category => !oldCategories.includes(category))) throw new Error("PRODUCT_CONTEXT_CONFLICT");
  const type = previous.productType ?? (oldCategories.length === 1 ? oldCategories[0] : undefined);
  const typeTokens = type === undefined ? [] : tokens(type);
  const categoryOnly = type !== undefined && (same(newTokens, typeTokens) ||
    (newCategories.length === 1 && oldCategories.includes(newCategories[0]!) && !hasSpecificProductIdentity(current.query, 1)));
  if (categoryOnly) return previous.query;
  if (!oldTokens.every(token => newTokens.includes(token))) throw new Error("PRODUCT_CONTEXT_CONFLICT");
  if (oldTokens.some(hasStrongProductIdentifier) && newTokens.some(token =>
    hasStrongProductIdentifier(token) && !oldTokens.includes(token))) throw new Error("PRODUCT_CONTEXT_CONFLICT");
  const brandTokens = previous.brand === undefined ? [] : tokens(previous.brand);
  const oldIdentity = oldTokens.filter(token => !brandTokens.includes(token));
  const generic = typeTokens.length > 0 && same(oldIdentity, typeTokens);
  const supplied = new Set(tokens([...current.requiredFeatures,
    ...(current.featureMode === "REQUIRED" ? current.features : []), current.requiredSize,
    current.preferredSize].filter((value): value is string => value !== undefined && controlledVariantRefinement(value)).join(" ")));
  // A complete reviewed attribute in query is already explicit input. Do not
  // require the model to repeat it in requiredFeatures; never accept only the
  // safe-looking part of a phrase that also appends another identity.
  const queryAddition = newTokens.filter(token => !oldTokens.includes(token));
  const controlledQueryAddition = controlledVariantRefinement(queryAddition.join(" "));
  if (!generic && current.requiredFeatures.some(feature => /\bcharacter\b|角色/iu.test(feature) &&
    tokens(feature).some(token => !oldTokens.includes(token)))) throw new Error("PRODUCT_CONTEXT_CONFLICT");
  if (!generic && !controlledQueryAddition && queryAddition.some(token => !supplied.has(token))) {
    throw new Error("PRODUCT_CONTEXT_CONFLICT");
  }
  return current.query;
}

/** Free-text requirements remain requirements, not authorization to append an
 * arbitrary second name/model to an established identity. */
function controlledVariantRefinement(value: string): boolean {
  const normalized = normalizeNamedProductIdentity(value).toLowerCase();
  return normalized === "default" || isColorRequirement(value) || functionalRequirement(value) !== undefined ||
    /^(?:(?:long|short|straight|curly|wavy) (?:hair|wig)|长发|短发|直发|卷发)$/u.test(normalized) ||
    /^(?:size\s*)?(?:(?:us|uk|eu)\s*\d+(?:\.5)?|xxs|xs|s|m|l|xl|xxl|xxxl)$/u.test(normalized) ||
    /^(?:(?:at least|under|maximum|minimum)\s+)?\d+(?:\.\d+)?\s*(?:gb|tb|mb|cm|mm|inch(?:es)?|in|ml|l|fl oz|g|kg|lb|oz|hz|w)(?:\s+(?:ram|memory|storage|ssd|display|screen|length|weight|power))?$/u.test(normalized);
}
