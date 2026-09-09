import { parseStoredSearchRequest, type SearchProductsInput } from "./search-products.js";
import { sanitizeExternalText } from "./execution/external-data-fence.js";
import { normalizeNamedProductIdentity } from "./named-product-identity.js";
import { hasSpecificProductIdentity, hasStrongProductIdentifier, productQueryCategoryKeys } from "./shopify-match.js";
import { functionalRequirement, requiredPrimaryUseFeatures } from "./functional-requirements.js";
import { isColorRequirement } from "./product-constraint-matcher.js";
import { normalizePackageRequirements } from "./package-requirements.js";
import { isCoffeeCategoryRefinement } from "./coffee-category.js";

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
export function mergeSearchRequirements(current: SearchProductsInput, previous: SearchProductsInput,
  previousCandidates: readonly { title: string; brand?: string | undefined }[] = []): SearchProductsInput {
  // Only the resolved server snapshot can supply an existing product anchor.
  const { wooAnchor: _submittedAnchor, ...submitted } = current;
  current = submitted;
  current = normalizePackageRequirements(current);
  previous = normalizePackageRequirements(previous);
  if (current.removeRequiredFeatures.length > 0 && !["CONTINUE_PREVIOUS_PRODUCT", "CORRECT_PREVIOUS_PRODUCT"].includes(current.contextMode)) throw new Error("PRODUCT_CONTEXT_CONFLICT");
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
  previous = parseStoredSearchRequest(retained);
  if (!correctingIdentity && current.productType !== undefined && previous.productType !== undefined &&
    current.productType.toLowerCase() !== previous.productType.toLowerCase() &&
    !isHeadphoneTypeRefinement(previous.productType, current.productType) &&
    !isCoffeeCategoryRefinement(previous.productType, current.productType)) throw new Error("PRODUCT_CONTEXT_CONFLICT");
  if (!correctingIdentity && current.brand !== undefined && previous.brand !== undefined && current.brand !== previous.brand) throw new Error("PRODUCT_CONTEXT_CONFLICT");
  const merged: Record<string, unknown> = { ...previous, parentRenderId: current.parentRenderId,
    contextMode: current.contextMode, responseLocale: current.responseLocale ?? previous.responseLocale,
    clearConstraints: [], removeRequiredFeatures: [], limit: current.limit };
  if (!correctingIdentity) {
    const query = continuedIdentityQuery(current, previous, previousCandidates);
    const subtype = headphoneType(current.productType ?? previous.productType);
    const prefix = subtype === "OVER_EAR" ? "wh" : subtype === "IN_EAR" ? "wf" : undefined;
    const identity = normalizeNamedProductIdentity(query).normalize("NFKC");
    // Category-only references retain the prior query. Validate that final
    // identity too, including a Sony brand supplied only in the query.
    if (prefix !== undefined && /\bsony\b/iu.test(`${current.brand ?? previous.brand ?? ""} ${identity}`) &&
      [...identity.matchAll(/\b(w[fh])[-\s]?1000xm\d{1,2}\b/giu)].some(match => match[1]!.toLowerCase() !== prefix)) {
      throw new Error("PRODUCT_CONTEXT_CONFLICT");
    }
    merged.query = query;
  }
  if (correctingIdentity) {
    // Correcting identity is not permission to withdraw budget, size, or must-haves.
    // Old image observations are identity evidence, not constraints for a new identity.
    merged.query = current.query;
    delete merged.visualInput;
    delete merged.wooAnchor;
    if (current.visualInput !== undefined) merged.visualInput = current.visualInput;
  }
  for (const key of ["maxItemPriceCents", "requiredSize", "preferredSize", "primaryUse", "brand", "productType", "zipCode", "membershipIds", "compareMerchants"] as const) {
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
  return parseStoredSearchRequest(merged);
}

/** CONTINUE can narrow identity, but cannot replace, combine or erase it.
 * Unreviewed translations are not evidence of identity equivalence. */
function continuedIdentityQuery(current: SearchProductsInput, previous: SearchProductsInput,
  previousCandidates: readonly { title: string; brand?: string | undefined }[]): string {
  if (previous.wooAnchor !== undefined && current.query === previous.wooAnchor.url) return previous.query;
  // Within an already explicit EV category, "Tesla charging station" is a
  // category shorthand. This says nothing about vehicle/region compatibility.
  const evCategory = /^(?:ev (?:charging station|charger)|electric vehicle (?:charging station|charger)|充电桩)$/iu
    .test(previous.productType ?? previous.query);
  const categoryForm = (value: string) => evCategory ? value
    .replace(/\b(?:(?:ev|electric vehicle)\s+)?charging stations?\b|\b(?:ev|electric vehicle)\s+chargers?\b|充电桩/giu, "charger") : value;
  const tokens = (value: string) => [...new Set(normalizeNamedProductIdentity(categoryForm(value)).normalize("NFKD")
    .replace(/\p{M}+/gu, "").toLowerCase().replace(/\bpads\b/gu, "pad")
    .replace(/\b(w[fh])[-\s]?(1000xm\d{1,2})\b/gu, "$1$2").match(/[\p{L}\p{N}]+/gu) ?? [])];
  const same = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every(token => right.includes(token));
  let oldTokens = tokens(previous.query);
  const newTokens = tokens(current.query);
  // A confirmed headphone subtype qualifies Sony's ambiguous numeric family;
  // it never replaces an already explicit WH/WF prefix or generation.
  const family = oldTokens.find(token => /^1000xm\d{1,2}$/u.test(token));
  const subtype = headphoneType(current.productType ?? previous.productType);
  const prefix = subtype === "OVER_EAR" ? "wh" : subtype === "IN_EAR" ? "wf" : undefined;
  const requestedSony = previous.brand?.toLowerCase() === "sony" || previous.brand === undefined && oldTokens.includes("sony");
  const qualifiesFamily = requestedSony && family !== undefined && prefix !== undefined &&
    newTokens.includes(prefix + family) && !oldTokens.some(token => /^w[fh]1000xm/u.test(token));
  if (qualifiesFamily) oldTokens = oldTokens.map(token => token === family ? prefix + family : token);
  if (same(oldTokens, newTokens)) return qualifiesFamily ? current.query : previous.query;
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
  const cosmetic = /\b(?:toner|pads?|serum|cream|skincare)\b|护肤|棉片/iu.test(previous.productType ?? previous.query);
  const editions = newTokens.filter(token => token === "mild" || token === "regular");
  const oldEditions = oldTokens.filter(token => token === "mild" || token === "regular");
  if (cosmetic && editions.length > 1) throw new Error("PRODUCT_CONTEXT_CONFLICT");
  // User input may narrow an unspecified edition; a source title alone does not.
  // Longer spelling must exactly match a candidate from the original snapshot,
  // after the old anchors/category/model checks above have already passed.
  const editionRefinement = cosmetic && oldEditions.length === 0 && editions.length === 1 &&
    (queryAddition.length === 1 || previousCandidates.some(candidate =>
      same(newTokens, tokens([candidate.brand, candidate.title].filter(Boolean).join(" ")))));
  if (!generic && current.requiredFeatures.some(feature => /\bcharacter\b|角色/iu.test(feature) &&
    tokens(feature).some(token => !oldTokens.includes(token)))) throw new Error("PRODUCT_CONTEXT_CONFLICT");
  if (!generic && !controlledQueryAddition && !editionRefinement && queryAddition.some(token => !supplied.has(token))) {
    throw new Error("PRODUCT_CONTEXT_CONFLICT");
  }
  return current.query;
}

function headphoneType(value: string | undefined): "GENERIC" | "OVER_EAR" | "IN_EAR" | undefined {
  const type = value?.normalize("NFKC").trim().toLowerCase().replace(/-/gu, " ").replace(/\s+/gu, " ");
  if (/^(?:headphones?|耳机)$/u.test(type ?? "")) return "GENERIC";
  if (/^(?:over ear(?: headphones?)?|头戴式(?:耳机)?)$/u.test(type ?? "")) return "OVER_EAR";
  if (/^(?:in ear(?: headphones?)?|earbuds?|入耳式(?:耳机)?)$/u.test(type ?? "")) return "IN_EAR";
  return undefined;
}

function isHeadphoneTypeRefinement(previous: string, current: string): boolean {
  const before = headphoneType(previous);
  const after = headphoneType(current);
  return before !== undefined && after !== undefined && (before === after || before === "GENERIC");
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
