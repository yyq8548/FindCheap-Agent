import { z } from "zod";

export function isCurrentDeal(deal: { validTo?: string | undefined; validFrom?: string | undefined }, evaluatedAtMs: number): boolean {
  const end = Date.parse(deal.validTo ?? "");
  const start = deal.validFrom === undefined ? -Infinity : Date.parse(deal.validFrom);
  return Number.isFinite(evaluatedAtMs) && Number.isFinite(end) && start <= evaluatedAtMs && end > evaluatedAtMs;
}

const RatingSchema = z.object({ value: z.number().min(0).max(5), count: z.number().int().positive(), scaleMax: z.literal(5) }).strict();
export const QualityEvidenceSchema = z.object({
  status: z.enum(["REPORTED_RATING", "UNKNOWN"]),
  rating: RatingSchema.optional(),
  qualityGuaranteed: z.literal(false)
}).strict();
export type QualityEvidence = z.infer<typeof QualityEvidenceSchema>;
export const UnitPriceSchema = z.object({
  amountCents: z.number().int().nonnegative(), currency: z.literal("USD"),
  perQuantity: z.union([z.literal(1), z.literal(100)]), unit: z.enum(["ML", "ITEM"]),
  quantity: z.number().positive().max(1_000_000),
  source: z.enum(["TITLE", "VARIANT"]), sourceText: z.string().min(1).max(160),
  priceBasis: z.literal("ITEM_PRICE")
}).strict();
export type UnitPriceEvidence = z.infer<typeof UnitPriceSchema>;
export const ValueEvidenceSchema = z.object({
  reason: z.enum(["LOWER_SAME_PRODUCT_PRICE", "LOWER_COMPARABLE_UNIT_PRICE", "CONFIRMED_COUPON_SAVINGS"]),
  amountCents: z.number().int().positive(), currency: z.literal("USD"),
  basis: z.enum(["ITEM_PRICE", "PER_100_ML", "PER_ITEM"]),
  comparedWithTitle: z.string().max(500).optional()
}).strict();
export type ValueEvidence = z.infer<typeof ValueEvidenceSchema>;

export type ValueProduct = {
  title: string;
  productType?: string | undefined;
  brand?: string | undefined;
  sku?: string | undefined;
  gtins?: readonly string[] | undefined;
  variantDimensions?: Readonly<Record<string, string>> | undefined;
  condition?: "NEW" | "USED" | "REFURBISHED" | "OPEN_BOX" | "UNKNOWN" | undefined;
  itemPrice?: { amountCents: number; currency: "USD" } | undefined;
  productRating?: { value: number; count: number; scaleMax: 5 } | undefined;
};

export function assessQualityEvidence(product: Pick<ValueProduct, "productRating">): QualityEvidence {
  const rating = RatingSchema.safeParse(product.productRating);
  // A source-reported review score is neither independent quality verification
  // nor evidence that a merchant is trusted. Do not invent an aggregate score.
  return rating.success
    ? { status: "REPORTED_RATING", rating: rating.data, qualityGuaranteed: false }
    : { status: "UNKNOWN", qualityGuaranteed: false };
}

export function unitPriceEvidence(product: ValueProduct): UnitPriceEvidence | undefined {
  const price = product.itemPrice;
  if (!price || price.currency !== "USD" || !Number.isSafeInteger(price.amountCents) || price.amountCents < 0) return undefined;
  const quantity = packageQuantity(product);
  if (!quantity) return undefined;
  const perQuantity = quantity.unit === "ML" ? 100 : 1;
  const amountCents = Math.round(price.amountCents / quantity.quantity * perQuantity);
  if (!Number.isSafeInteger(amountCents)) return undefined;
  return { ...quantity, amountCents,
    currency: "USD", perQuantity, priceBasis: "ITEM_PRICE" };
}

/** Title/variant quantities only. Descriptions may describe other bundle parts. */
function packageQuantity(product: ValueProduct): Pick<UnitPriceEvidence, "quantity" | "unit" | "source" | "sourceText"> | undefined {
  const dimensions = Object.entries(product.variantDimensions ?? {}).filter(([key]) => /size|volume|capacity|pack|count|quantity|容量|数量|规格/iu.test(key));
  const fields = [{ text: product.title, source: "TITLE" as const }, ...dimensions.map(([key, value]) => ({ text: `${key}: ${value}`, source: "VARIANT" as const }))];
  const joined = fields.map(field => field.text).join(" ");
  // Mixed bundles and multiplications need constituent-level evidence; never
  // treat a 2 x 250 mL set as one 250 mL product or guess that oz means fluid oz.
  if (/\b(?:bundle|kit|set|duo|trio|combo)\b|套装|组合|\d\s*[x×]\s*\d|\b(?:shampoo|洗发)[\s\S]*\bconditioner\b/iu.test(joined)) return undefined;
  const quantities: Array<Pick<UnitPriceEvidence, "quantity" | "unit" | "source" | "sourceText">> = [];
  for (const field of fields) {
    for (const match of field.text.matchAll(/\b(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?)\b|([\d.]+)\s*(毫升|升)/giu)) {
      const value = Number(match[1] ?? match[3]);
      const unit = (match[2] ?? match[4] ?? "").toLowerCase();
      const quantity = value * (/^(?:l|lit|升)/u.test(unit) ? 1000 : 1);
      quantities.push({ quantity, unit: "ML", source: field.source, sourceText: match[0].slice(0, 160) });
    }
    for (const match of field.text.matchAll(/\b(?:pack\s+of\s+(\d+)|(\d+)\s*[- ]?\s*(?:count|ct|pack|pieces?|pcs))\b|(\d+)\s*(?:件装|片装|个装)/giu)) {
      quantities.push({ quantity: Number(match[1] ?? match[2] ?? match[3]), unit: "ITEM", source: field.source, sourceText: match[0].slice(0, 160) });
    }
  }
  if (quantities.length === 0 || quantities.some(item => !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 1_000_000)) return undefined;
  const first = quantities[0]!;
  if (quantities.some(item => item.unit !== first.unit || item.quantity !== first.quantity)) return undefined;
  return quantities.find(item => item.source === "VARIANT") ?? first;
}

/** A stable identity never overrides variant, condition or packaging conflicts. */
export function comparableSameProduct(left: ValueProduct, right: ValueProduct): boolean {
  if (!left.condition || left.condition === "UNKNOWN" || left.condition !== right.condition) return false;
  const stable = (left.gtins ?? []).some(gtin => gtin !== "" && right.gtins?.includes(gtin)) ||
    normalized(left.brand) !== "" && normalized(left.sku) !== "" && normalized(left.brand) === normalized(right.brand) && normalized(left.sku) === normalized(right.sku);
  if (!stable || variantKey(left) !== variantKey(right)) return false;
  const packageLeft = packageQuantity(left);
  const packageRight = packageQuantity(right);
  if (packageLeft || packageRight) return packageLeft?.quantity === packageRight?.quantity && packageLeft?.unit === packageRight?.unit;
  const packaging = /\b(?:bundle|kit|set|duo|trio|combo|pack|count|ct|ml|liters?)\b|套装|组合|毫升|件装/iu;
  return !packaging.test(left.title) && !packaging.test(right.title);
}

export function comparableUnitPrices(left: ValueProduct, right: ValueProduct): [UnitPriceEvidence, UnitPriceEvidence] | undefined {
  if (left.condition !== "NEW" || right.condition !== "NEW") return undefined;
  const family = comparableFamily(left);
  if (!family || family !== comparableFamily(right)) return undefined;
  const a = unitPriceEvidence(left);
  const b = unitPriceEvidence(right);
  if (!a || !b || a.unit !== b.unit) return undefined;
  // Capacity/count may differ. Other explicit dimensions must remain equal.
  if (variantKey(left, true) !== variantKey(right, true)) return undefined;
  return [a, b];
}

export function costAdvantage(left: ValueProduct, right: ValueProduct): ValueEvidence | undefined {
  if (!left.itemPrice || !right.itemPrice) return undefined;
  if (comparableSameProduct(left, right)) {
    const saved = right.itemPrice.amountCents - left.itemPrice.amountCents;
    return saved > 0 ? { reason: "LOWER_SAME_PRODUCT_PRICE", amountCents: saved, currency: "USD", basis: "ITEM_PRICE", comparedWithTitle: right.title.slice(0, 500) } : undefined;
  }
  const units = comparableUnitPrices(left, right);
  if (!units) return undefined;
  const saved = units[1].amountCents - units[0].amountCents;
  return saved > 0 ? { reason: "LOWER_COMPARABLE_UNIT_PRICE", amountCents: saved, currency: "USD", basis: units[0].unit === "ML" ? "PER_100_ML" : "PER_ITEM", comparedWithTitle: right.title.slice(0, 500) } : undefined;
}

function comparableFamily(product: ValueProduct): string | undefined {
  const text = `${product.productType ?? ""} ${product.title}`;
  const families = [
    ["shampoo", /\bshampoo\b|洗发/iu], ["conditioner", /\bconditioner\b|护发素/iu],
    ["body-wash", /\bbody\s+wash\b|沐浴露/iu], ["hand-wash", /\bhand\s+(?:wash|soap)\b|洗手液/iu],
    ["coffee-pods", /\b(?:coffee\s+)?pods\b|咖啡胶囊/iu], ["diapers", /\bdiapers?\b|纸尿裤/iu],
    ["tissues", /\btissues?\b|纸巾/iu]
  ] as const;
  const matched = families.filter(([, pattern]) => pattern.test(text));
  return matched.length === 1 ? matched[0]![0] : undefined;
}

function variantKey(product: ValueProduct, omitQuantity = false): string {
  return Object.entries(product.variantDimensions ?? {}).filter(([key, value]) => !omitQuantity ||
      !(/volume|capacity|pack|count|quantity|size|容量|数量|规格/iu.test(key) &&
        /^(?:\d+(?:\.\d+)?\s*(?:ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|count|ct|pack|pieces?|pcs|毫升|升|件装|片装|个装)|pack\s+of\s+\d+)$/iu.test(value.trim())))
    .map(([key, value]) => `${normalized(key)}=${normalized(value)}`).sort().join("|");
}
function normalized(value: string | undefined): string { return value?.normalize("NFKC").trim().toLocaleLowerCase("en-US") ?? ""; }
