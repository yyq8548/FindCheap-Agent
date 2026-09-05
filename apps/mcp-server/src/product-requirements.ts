import { z } from "zod";
import { evaluateFeature, isColorRequirement, namedIdentityFeatureStatus, type FeatureMatchStatus } from "./product-constraint-matcher.js";
import { sanitizeExternalText } from "./execution/external-data-fence.js";
import { functionalFeatureEvidence, requiredPrimaryUseFeatures } from "./functional-requirements.js";
import { boundNamedIdentityRequirement } from "./named-product-identity.js";
import { missingChargingRequirements } from "./decision-constraints.js";
import { isPartialPriceListing } from "./shopify-match.js";

/** Product/feed claims describe what the merchant says, not verified efficacy. */
export const CandidateClaimEvidenceSchema = z.object({
  kind: z.literal("MERCHANT_CLAIM"),
  attribute: z.enum(["anti-dandruff", "oily scalp", "moisturizing", "dry hair", "anti-frizz", "fine hair", "cosplay"]),
  source: z.enum(["PRODUCT", "FEED"]),
  field: z.enum(["TITLE", "DESCRIPTION"]),
  scope: z.enum(["PRODUCT", "OTHER_PRODUCT", "INGREDIENT", "CONDITIONAL"]),
  status: z.enum(["MATCHED", "CONTRADICTED", "UNKNOWN"]),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  quote: z.string().max(240)
}).strict();
export type CandidateClaimEvidence = z.infer<typeof CandidateClaimEvidenceSchema>;

export const RequirementAssessmentSchema = z.object({
  policyVersion: z.literal("requirements-v1"),
  status: z.enum(["SATISFIED", "NEEDS_VERIFICATION", "CONFLICT"]),
  entries: z.array(z.object({
    requirement: z.string().max(200),
    status: z.enum(["MATCHED", "CONTRADICTED", "UNKNOWN", "CONFLICT"]),
    source: z.enum(["VARIANT", "PRODUCT", "FEED", "MISSING"]),
    observed: z.string().max(240).optional(),
    evidence: z.array(CandidateClaimEvidenceSchema).max(8).optional()
  }).strict()).max(32)
}).strict();
export type RequirementAssessment = z.infer<typeof RequirementAssessmentSchema>;
export type RequirementProduct = {
  title: string;
  productType?: string | undefined;
  description?: string | undefined;
  brand?: string | undefined;
  sku?: string | undefined;
  variantDimensions?: Readonly<Record<string, string>> | undefined;
  evidenceSource?: "PRODUCT" | "FEED";
  itemPrice?: { amountCents: number; currency: string } | undefined;
};
type Requirements = {
  query?: string | undefined;
  productType?: string | undefined;
  primaryUse?: string | undefined;
  requiredFeatures: readonly string[];
  excludedFeatures: readonly string[];
  preferences: readonly string[];
  requiredSize?: string | undefined;
  maxItemPriceCents?: number | undefined;
};

export function isFootwear(value: string): boolean {
  return /\b(?:shoes?|flats?|boots?|sneakers?|sandals?|loafers?)\b|鞋|靴/iu.test(value);
}

export function normalizedSizeRequirement(value: string, category: string): string {
  if (/(?:display|screen|monitor|屏幕|显示器)/iu.test(value)) return value;
  return /\b(?:laptop|macbook|tablet|monitor|television|tv|display|screen)\b|电脑|屏幕|显示器/iu.test(category)
    ? `${value} ${/\p{Script=Han}/u.test(value) ? "屏幕" : "display"}` : value;
}

export function ambiguousShoeSize(size: string | undefined, category: string): boolean {
  return size !== undefined && isFootwear(category) && !/\b(?:US|UK|EU)\s*\d|美码|英码|欧码/iu.test(size);
}

/** A numeric option gets a size system only from the merchant's explicit text,
 * never its country, currency, brand name or a guessed conversion table. */
export function sizeEvidence(value: string, description = ""): string {
  if (!/^\d+(?:\.5)?$/u.test(value.trim())) return value;
  const system = /\b(US|UK|EU)\s+(?:shoe\s+)?siz(?:e|es|ing)\b|\bsiz(?:e|es|ing)\s*(?:in|:)?\s*(US|UK|EU)\b/iu.exec(description);
  return system === null ? value : `${system[1] ?? system[2]} ${value}`;
}

export function evaluateProductRequirements(product: RequirementProduct, input: Requirements) {
  const dimensions = Object.entries(product.variantDimensions ?? {});
  const text = [product.title, product.productType, product.description, product.brand, product.sku,
    ...dimensions.flat()].filter(Boolean).join(" ");
  const entries: RequirementAssessment["entries"] = [];
  const requirements = [...new Set([...input.requiredFeatures, ...requiredPrimaryUseFeatures(input.primaryUse)])];
  for (const requirement of requirements) {
    const named = namedProductAssessment(product, boundNamedIdentityRequirement(requirement, input.query));
    if (named !== undefined) {
      entries.push({ requirement: sanitizeExternalText(requirement, 200), status: named.status,
        source: named.status === "UNKNOWN" ? "MISSING" : product.evidenceSource ?? "PRODUCT",
        observed: sanitizeExternalText(named.observed, 240) });
      continue;
    }
    const claim = productClaimAssessment(product, requirement);
    if (claim !== undefined) {
      entries.push({ requirement: sanitizeExternalText(requirement, 200), status: claim.status,
        source: claim.evidence.length === 0 ? "MISSING" : product.evidenceSource ?? "PRODUCT",
        ...(claim.evidence.length === 0 ? {} : { observed: claim.evidence[0]!.quote, evidence: claim.evidence }) });
      continue;
    }
    const isSize = input.requiredSize === requirement || /^(?:(?:shoe )?size\s*[:=]?\s*)?(?:(?:US|UK|EU)\s*\d+(?:\.5)?|XXXS|XXS|XS|S|M|L|XL|XXL|XXXL)$/iu.test(requirement);
    const isColor = isColorRequirement(requirement);
    const dimension = dimensions.find(([name]) => isSize ? /^(?:shoe )?size(?:s)?$/iu.test(name)
      : /^(?:long|short)\s+(?:hair|wig)|^(?:长发|短发)$/iu.test(requirement) ? /^(?:hair )?length(?:[- ]inches)?$/iu.test(name)
        : /^(?:straight|curly|wavy)\s+(?:hair|wig)|^(?:直发|卷发)$/iu.test(requirement) ? /^(?:hair )?(?:texture|style)$/iu.test(name)
          : isColor ? /^(?:product )?(?:color|colour)$/iu.test(name) : false);
    let observed = text;
    let source: RequirementAssessment["entries"][number]["source"] = product.evidenceSource ?? "PRODUCT";
    let status: FeatureMatchStatus | "CONFLICT";
    if (isSize) {
      source = dimension === undefined ? "MISSING" : "VARIANT";
      observed = dimension === undefined ? "" : sizeEvidence(dimension[1], product.description);
      // A product's list of available sizes is not the selected variant's size.
      status = observed === "" ? "UNKNOWN" : evaluateFeature(`size ${observed}`, requirement);
      if (dimension !== undefined && /^\d+(?:\.5)?$/u.test(dimension[1])) {
        if (/\b(?:US|UK|EU)\b/iu.test(requirement) && !/\b(?:US|UK|EU)\b/iu.test(observed)) status = "UNKNOWN";
      }
    } else if (dimension !== undefined) {
      source = "VARIANT";
      observed = /length/iu.test(dimension[0])
        ? `wig hair length: ${dimension[1]}${/^\d+(?:\.\d+)?$/u.test(dimension[1]) ? " inches" : ""}`
        : isColor ? `color ${dimension[1]}` : `wig hair ${dimension[1]}`;
      status = evaluateFeature(observed, requirement);
    } else {
      status = evaluateFeature(observed, requirement);
      const titleStatus = evaluateFeature(product.title, requirement);
      const descriptionStatus = evaluateFeature(product.description ?? "", requirement);
      if ((titleStatus === "MATCHED" && descriptionStatus === "CONTRADICTED") ||
        (titleStatus === "CONTRADICTED" && descriptionStatus === "MATCHED")) status = "CONFLICT";
    }
    entries.push({ requirement: sanitizeExternalText(requirement, 200), status, source,
      ...(observed === "" ? {} : { observed: sanitizeExternalText(observed, 240) }) });
  }
  const partialPrice = isPartialPriceListing(product);
  if (partialPrice) entries.push({ requirement: "complete item price", status: "UNKNOWN", source: "MISSING" });
  if (input.maxItemPriceCents !== undefined) {
    const price = product.itemPrice;
    const verified = !partialPrice && price?.currency === "USD" && Number.isSafeInteger(price.amountCents) && price.amountCents >= 0;
    entries.push({ requirement: `maximum item price: USD ${(input.maxItemPriceCents / 100).toFixed(2)}`,
      status: !verified ? "UNKNOWN" : price.amountCents <= input.maxItemPriceCents ? "MATCHED" : "CONTRADICTED",
      source: verified ? product.evidenceSource ?? "PRODUCT" : "MISSING",
      ...(verified ? { observed: `USD ${(price.amountCents / 100).toFixed(2)}` } : {}) });
  }
  for (const excluded of input.excludedFeatures) {
    if ((namedProductAssessment(product, excluded)?.status ?? productClaimAssessment(product, excluded)?.status ?? evaluateFeature(text, excluded)) === "MATCHED") entries.push({
      requirement: sanitizeExternalText(`excluded: ${excluded}`, 200), status: "CONTRADICTED", source: product.evidenceSource ?? "PRODUCT"
    });
  }
  for (const gap of missingChargingRequirements(input)) entries.push({
    requirement: `EV compatibility: ${gap}`, status: "UNKNOWN", source: "MISSING"
  });
  const matched = entries.filter(entry => entry.status === "MATCHED").map(entry => entry.requirement);
  const contradicted = entries.filter(entry => entry.status === "CONTRADICTED").map(entry => entry.requirement);
  const unknown = entries.filter(entry => entry.status === "UNKNOWN" || entry.status === "CONFLICT").map(entry => entry.requirement);
  const assessment: RequirementAssessment = { policyVersion: "requirements-v1", entries,
    status: contradicted.length > 0 || entries.some(entry => entry.status === "CONFLICT") ? "CONFLICT"
      : unknown.length > 0 ? "NEEDS_VERIFICATION" : "SATISFIED" };
  return { matched, contradicted, unknown,
    preferences: input.preferences.filter(feature =>
      (namedProductAssessment(product, feature)?.status ?? productClaimAssessment(product, feature)?.status ?? evaluateFeature(text, feature)) === "MATCHED"), assessment };
}

function namedProductAssessment(product: RequirementProduct, requirement: string) {
  const titleStatus = namedIdentityFeatureStatus(product.title, requirement);
  if (titleStatus === undefined) return undefined;
  const descriptionStatus = namedIdentityFeatureStatus(product.description ?? "", requirement)!;
  const statuses = [titleStatus, descriptionStatus];
  const status = statuses.includes("MATCHED") && statuses.includes("CONTRADICTED") ? "CONFLICT"
    : statuses.includes("CONTRADICTED") ? "CONTRADICTED" : statuses.includes("MATCHED") ? "MATCHED" : "UNKNOWN";
  return { status, observed: titleStatus === "UNKNOWN" ? product.description ?? "" : product.title } as const;
}

function productClaimAssessment(product: RequirementProduct, requirement: string) {
  const context = { productTitle: product.title, productType: product.productType };
  const title = functionalFeatureEvidence(product.title, requirement, context);
  if (title === undefined) return undefined;
  const description = functionalFeatureEvidence(product.description ?? "", requirement, context)!;
  const evidence = ([{ field: "TITLE", result: title }, { field: "DESCRIPTION", result: description }] as const)
    .flatMap(({ field, result }) => result.evidence.map(entry => ({ ...entry,
      kind: "MERCHANT_CLAIM" as const, source: product.evidenceSource ?? "PRODUCT" as const, field,
      quote: sanitizeExternalText(entry.quote, 240) })))
    .sort((a, b) => ({ CONTRADICTED: 0, MATCHED: 1, UNKNOWN: 2 })[a.status] -
      ({ CONTRADICTED: 0, MATCHED: 1, UNKNOWN: 2 })[b.status]).slice(0, 8);
  // A functional conjunction can be supported across fields, but every named
  // attribute still needs positive evidence and no attribute may conflict.
  const combined = functionalFeatureEvidence([product.title, product.description].filter(Boolean).join(". "), requirement, context)!;
  const status = combined.conflictingAttributes.length > 0 ? "CONFLICT" : combined.status;
  return { status, evidence } as const;
}
