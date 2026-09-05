import { z } from "zod";
import { evaluateFeature, isColorRequirement, type FeatureMatchStatus } from "./product-constraint-matcher.js";
import { sanitizeExternalText } from "./execution/external-data-fence.js";

export const RequirementAssessmentSchema = z.object({
  policyVersion: z.literal("requirements-v1"),
  status: z.enum(["SATISFIED", "NEEDS_VERIFICATION", "CONFLICT"]),
  entries: z.array(z.object({
    requirement: z.string().max(200),
    status: z.enum(["MATCHED", "CONTRADICTED", "UNKNOWN", "CONFLICT"]),
    source: z.enum(["VARIANT", "PRODUCT", "FEED", "MISSING"]),
    observed: z.string().max(240).optional()
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
  const requirements = [...new Set(input.requiredFeatures)];
  for (const requirement of requirements) {
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
  if (input.maxItemPriceCents !== undefined) {
    const price = product.itemPrice;
    const verified = price?.currency === "USD" && Number.isSafeInteger(price.amountCents) && price.amountCents >= 0;
    entries.push({ requirement: `maximum item price: USD ${(input.maxItemPriceCents / 100).toFixed(2)}`,
      status: !verified ? "UNKNOWN" : price.amountCents <= input.maxItemPriceCents ? "MATCHED" : "CONTRADICTED",
      source: verified ? product.evidenceSource ?? "PRODUCT" : "MISSING",
      ...(verified ? { observed: `USD ${(price.amountCents / 100).toFixed(2)}` } : {}) });
  }
  for (const excluded of input.excludedFeatures) {
    if (evaluateFeature(text, excluded) === "MATCHED") entries.push({
      requirement: sanitizeExternalText(`excluded: ${excluded}`, 200), status: "CONTRADICTED", source: product.evidenceSource ?? "PRODUCT"
    });
  }
  const matched = entries.filter(entry => entry.status === "MATCHED").map(entry => entry.requirement);
  const contradicted = entries.filter(entry => entry.status === "CONTRADICTED").map(entry => entry.requirement);
  const unknown = entries.filter(entry => entry.status === "UNKNOWN" || entry.status === "CONFLICT").map(entry => entry.requirement);
  const assessment: RequirementAssessment = { policyVersion: "requirements-v1", entries,
    status: contradicted.length > 0 || entries.some(entry => entry.status === "CONFLICT") ? "CONFLICT"
      : unknown.length > 0 ? "NEEDS_VERIFICATION" : "SATISFIED" };
  return { matched, contradicted, unknown,
    preferences: input.preferences.filter(feature => evaluateFeature(text, feature) === "MATCHED"), assessment };
}
