import { z } from "zod";
import { RECOMMENDATION_REASON_CODES, choosePrimaryRecommendation } from "./product-recommendation.js";
import { DealAssessmentSchema, DealSummarySchema, type DealAssessment, type DealSummary } from "./deal-assessment.js";
import { DealLookupStatusSchema } from "./deal-client.js";

const MoneySchema = z.object({
  amountCents: z.number().int().nonnegative(),
  currency: z.literal("USD")
}).strict();

export const COMPARISON_FOCUS_VALUES = [
  "PRICE",
  "DELIVERED_TOTAL",
  "DEALS",
  "AVAILABILITY",
  "CONDITION",
  "MERCHANT_TRUST",
  "IDENTITY",
  "REQUIREMENTS",
  "PREFERENCES"
] as const;

export const ProductComparisonInputSchema = z.object({
  selectionIds: z.array(z.string().uuid()).min(2).max(4).refine(
    (values) => new Set(values).size === values.length,
    { message: "selectionIds must contain 2-4 unique values" }
  ),
  mode: z.enum(["AUTO", "SAME_PRODUCT_OFFERS", "PRODUCT_CHOICES"]).default("AUTO"),
  focus: z.array(z.enum(COMPARISON_FOCUS_VALUES)).max(3).default([]).refine(
    (values) => new Set(values).size === values.length,
    { message: "focus must contain unique values" }
  ),
  responseLocale: z.enum(["en-US", "zh-CN"]).default("en-US")
}).strict();

const ComparisonEntrySchema = z.object({
  selectionId: z.string().uuid(),
  title: z.string(),
  merchant: z.string(),
  sellerName: z.string().optional(),
  imageUrl: z.string().url().optional(),
  purchaseUrl: z.string().url(),
  brand: z.string().optional(),
  sku: z.string().optional(),
  gtins: z.array(z.string()),
  variantDimensions: z.record(z.string(), z.string()),
  matchStatus: z.enum(["EXACT", "DISCOVERY_MATCH", "SIMILAR"]),
  itemPrice: MoneySchema.optional(),
  deliveredTotal: MoneySchema.optional(),
  deliveredTotalExpiresAt: z.string().datetime().optional(),
  deliveredTotalStatus: z.enum(["QUOTED", "NOT_QUOTED", "MERCHANT_CHECKOUT_ONLY"]),
  comparedPrice: MoneySchema.optional(),
  availability: z.enum(["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"]),
  condition: z.enum(["NEW", "USED", "REFURBISHED", "OPEN_BOX", "UNKNOWN"]),
  merchantTrust: z.object({
    level: z.enum(["OFFICIAL", "AUTHORIZED_RETAILER", "ESTABLISHED_RETAILER", "UNKNOWN", "RISKY"]),
    verification: z.enum(["INDEPENDENT", "UNVERIFIED"])
  }).strict(),
  verifiedDeals: z.array(z.object({
    dealId: z.string().optional(),
    assessment: DealAssessmentSchema.optional(),
    kind: z.enum(["COUPON", "PROMO_CODE", "BRAND_PROMOTION"]),
    title: z.string(),
    code: z.string().optional(),
    discountPercent: z.number().min(0).max(100).optional(),
    discountAmount: MoneySchema.optional(),
    productApplicability: z.enum(["PRODUCT_CONFIRMED", "MERCHANT_WIDE", "UNKNOWN"]),
    validTo: z.string()
  }).strict()),
  dealLookupStatus: DealLookupStatusSchema.optional(),
  dealSummary: DealSummarySchema.optional(),
  identityEvidence: z.array(z.string()),
  requirementEvidence: z.array(z.string()),
  preferenceEvidence: z.array(z.string()),
  limitations: z.array(z.string()),
  unknowns: z.array(z.enum(["ITEM_PRICE", "DELIVERED_TOTAL", "CONDITION", "AVAILABILITY", "MERCHANT_TRUST"])),
  checkedAt: z.string()
}).strict();

export const ProductComparisonOutputSchema = z.object({
  status: z.enum([
    "OK",
    "SELECTION_UNAVAILABLE",
    "CROSS_SNAPSHOT_UNSUPPORTED",
    "SAME_PRODUCT_IDENTITY_UNVERIFIED"
  ]),
  message: z.string(),
  comparisonId: z.string().uuid().optional(),
  renderId: z.string().uuid().optional(),
  expiresAt: z.string().optional(),
  evaluatedAt: z.string().datetime().optional(),
  locale: z.enum(["en-US", "zh-CN"]),
  mode: z.enum(["SAME_PRODUCT_OFFERS", "PRODUCT_CHOICES"]).optional(),
  focus: z.array(z.enum(COMPARISON_FOCUS_VALUES)),
  priceBasis: z.enum(["ITEM_PRICE", "DELIVERED_TOTAL", "UNAVAILABLE"]).optional(),
  priceDelta: z.object({
    basis: z.enum(["ITEM_PRICE", "DELIVERED_TOTAL"]),
    currency: z.literal("USD"),
    lowestSelectionId: z.string().uuid(),
    highestSelectionId: z.string().uuid(),
    amountCents: z.number().int().nonnegative()
  }).strict().optional(),
  recommendation: z.object({
    state: z.enum(["READY", "RESEARCH_ONLY", "NO_MATCH"]),
    recommendedSelectionId: z.string().uuid().optional(),
    reasonCodes: z.array(z.enum(RECOMMENDATION_REASON_CODES)).max(3),
    conditions: z.array(z.string()).max(3).optional(),
    limitations: z.array(z.string()).max(3).optional()
  }).strict().optional(),
  entries: z.array(ComparisonEntrySchema).max(4)
}).strict();

export type ProductComparisonInput = z.infer<typeof ProductComparisonInputSchema>;
export type ProductComparisonOutput = z.infer<typeof ProductComparisonOutputSchema>;

export type ComparableProduct = {
  selectionId?: string;
  title: string;
  merchant: string;
  sellerName?: string;
  imageUrl?: string;
  merchantUrl: string;
  purchaseLink?: { url: string };
  brand?: string;
  sku?: string;
  gtins: string[];
  variantDimensions: Record<string, string>;
  matchStatus: "EXACT" | "DISCOVERY_MATCH" | "SIMILAR";
  presentationGroup?: "OFFICIAL_STORE" | "TRUSTED_MATCH" | "BEST_VALUE";
  recommendationTier?: "TRUSTED_OR_AFFILIATE" | "HIGH_RATED_UNVERIFIED" | "GENERAL_UNVERIFIED";
  itemPrice?: { amountCents: number; currency: "USD" };
  quoteCapability?: "DELIVERED_TOTAL_SUPPORTED" | "ZIP_ESTIMATE_ONLY" | "MERCHANT_CHECKOUT_ONLY";
  pricing: {
    deliveredPrice: {
      status: "ESTIMATED" | "UNAVAILABLE";
      amount?: { amountCents: number; currency: "USD" };
      checkedAt?: string;
      expiresAt?: string;
    };
  };
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  condition: "NEW" | "USED" | "REFURBISHED" | "OPEN_BOX" | "UNKNOWN";
  merchantTrust: {
    level: "OFFICIAL" | "AUTHORIZED_RETAILER" | "ESTABLISHED_RETAILER" | "UNKNOWN" | "RISKY";
    verification: "INDEPENDENT" | "UNVERIFIED";
  };
  coupons: {
    lookupStatus?: z.infer<typeof DealLookupStatusSchema>;
    summary?: DealSummary;
    verified: Array<{
      dealId?: string;
      assessment?: DealAssessment;
      kind: "COUPON" | "PROMO_CODE" | "BRAND_PROMOTION";
      title: string;
      code?: string;
      discountPercent?: number;
      discountAmount?: { amountCents: number; currency: "USD" };
      productApplicability?: "PRODUCT_CONFIRMED" | "MERCHANT_WIDE" | "UNKNOWN";
      validTo: string;
    }>;
    estimatedItemPriceAfterCoupon?: { amountCents: number; currency: "USD" };
  };
  matchEvidence: string[];
  featureEvidence?: string[];
  preferenceEvidence?: string[];
  requiredFeatureLimitations?: string[];
  checkedAt: string;
};

export function buildProductComparison(
  input: ProductComparisonInput,
  products: ComparableProduct[],
  identity: { comparisonId: string; renderId: string; expiresAt: string; evaluatedAt: string }
): ProductComparisonOutput {
  const evaluatedAtMs = Date.parse(identity.evaluatedAt);
  const sameProduct = hasSharedStableIdentity(products) && variantsCompatible(products) && conditionsCompatible(products);
  if (input.mode === "SAME_PRODUCT_OFFERS" && !sameProduct) {
    return {
      status: "SAME_PRODUCT_IDENTITY_UNVERIFIED",
      message: localize(input.responseLocale,
        "Stable same-product identity was not verified. Compare these as different product choices instead.",
        "未验证稳定的同款身份。请改为不同商品选择对比。"),
      locale: input.responseLocale,
      focus: input.focus,
      entries: []
    };
  }
  const mode = input.mode === "PRODUCT_CHOICES"
    ? "PRODUCT_CHOICES" as const
    : sameProduct ? "SAME_PRODUCT_OFFERS" as const : "PRODUCT_CHOICES" as const;
  const priceBasis = comparablePriceBasis(products, evaluatedAtMs);
  const entries = products.map((product) => comparisonEntry(product, priceBasis, evaluatedAtMs));
  const decisionProducts = products.map((product, index) => ({
    ...product,
    itemPrice: entries[index]?.comparedPrice,
    coupons: priceBasis === "ITEM_PRICE"
      ? product.coupons
      : { verified: product.coupons.verified }
  }));
  const decision = choosePrimaryRecommendation(decisionProducts);
  const recommendedSelectionId = decision.primaryProductIndex === undefined
    ? undefined
    : entries[decision.primaryProductIndex]?.selectionId;
  const selectedProduct = decision.primaryProductIndex === undefined ? undefined : products[decision.primaryProductIndex];
  const conditionalChoice = mode === "PRODUCT_CHOICES" && selectedProduct !== undefined;
  const selectedEvidence = [...new Set([
    ...(selectedProduct?.featureEvidence ?? []), ...(selectedProduct?.preferenceEvidence ?? [])
  ])].slice(0, 2);
  const recommendation = {
    state: decision.state === "READY" ? "READY" as const
      : decision.state === "NO_MATCH" ? "NO_MATCH" as const : "RESEARCH_ONLY" as const,
    ...(recommendedSelectionId === undefined ? {} : { recommendedSelectionId }),
    reasonCodes: decision.reasonCodes,
    ...(conditionalChoice ? {
      conditions: [selectedEvidence.length > 0
        ? localize(input.responseLocale,
            `Consider this choice only if these documented attributes fit your needs: ${selectedEvidence.join("; ")}.`,
            `仅当这些已有证据的属性符合你的需求时优先考虑：${selectedEvidence.join("；")}。`)
        : localize(input.responseLocale,
            "Confirm the product type, material, size and intended use before accepting this choice.",
            "接受此选择前，请确认商品类型、材质、尺寸和用途符合需求。")],
      limitations: [localize(input.responseLocale,
        "Different identities or variants are being compared; equal evidence counts or a lower price do not establish equivalent suitability.",
        "比较的是不同身份或规格的商品；证据数量相同或价格更低，并不代表用途和适合程度相同。")]
    } : {})
  };
  const delta = priceDelta(entries, priceBasis);
  const comparisonMessage = localize(input.responseLocale,
    mode === "SAME_PRODUCT_OFFERS"
      ? "Verified same-product offers are compared using server evidence."
      : "Different product choices are compared without claiming like-for-like identity.",
    mode === "SAME_PRODUCT_OFFERS"
      ? "已按服务器证据对比验证同款的不同报价。"
      : "正在对比不同商品选择，不会声称它们是同款。"
  );
  const pricingMessage = priceBasis === "DELIVERED_TOTAL"
    ? localize(input.responseLocale, "Delivered totals are quoted and comparable.", "到手价已报价且可直接比较。")
    : entries.some((entry) => entry.deliveredTotalStatus === "MERCHANT_CHECKOUT_ONLY")
      ? localize(
          input.responseLocale,
          "At least one card does not support quote retrieval and requires merchant checkout; item prices are used where comparable.",
          "至少一张商品卡不支持报价，只能在商家结账页获取到手价；可比较时使用商品价。"
        )
      : localize(
          input.responseLocale,
          "Delivered totals have not been quoted; provide a ZIP for supported cards.",
          "到手价尚未报价；可为支持的商品卡提供 ZIP。"
        );
  return {
    status: "OK",
    message: `${comparisonMessage} ${pricingMessage}${conditionalChoice ? localize(input.responseLocale,
      " This recommendation is conditional on the documented attributes meeting your needs, not price alone.",
      " 此推荐以已有证据的属性满足你的需求为条件，不能仅凭价格决定。") : ""}`,
    comparisonId: identity.comparisonId,
    renderId: identity.renderId,
    expiresAt: identity.expiresAt,
    evaluatedAt: identity.evaluatedAt,
    locale: input.responseLocale,
    mode,
    focus: input.focus,
    priceBasis,
    ...(delta === undefined ? {} : { priceDelta: delta }),
    recommendation,
    entries
  };
}

function comparisonEntry(
  product: ComparableProduct,
  priceBasis: "ITEM_PRICE" | "DELIVERED_TOTAL" | "UNAVAILABLE",
  evaluatedAtMs: number
): z.infer<typeof ComparisonEntrySchema> {
  const deliveredTotal = activeDeliveredPrice(product, evaluatedAtMs);
  const deliveredTotalExpiresAt = deliveredTotal === undefined
    ? undefined
    : product.pricing.deliveredPrice.expiresAt;
  const deliveredTotalStatus = deliveredTotal !== undefined
    ? "QUOTED" as const
    : product.quoteCapability === "MERCHANT_CHECKOUT_ONLY"
      ? "MERCHANT_CHECKOUT_ONLY" as const
      : "NOT_QUOTED" as const;
  const comparedPrice = priceBasis === "DELIVERED_TOTAL"
    ? deliveredTotal
    : priceBasis === "ITEM_PRICE" ? product.itemPrice : undefined;
  const unknowns: Array<"ITEM_PRICE" | "DELIVERED_TOTAL" | "CONDITION" | "AVAILABILITY" | "MERCHANT_TRUST"> = [];
  if (product.itemPrice === undefined) unknowns.push("ITEM_PRICE");
  if (deliveredTotal === undefined) unknowns.push("DELIVERED_TOTAL");
  if (product.condition === "UNKNOWN") unknowns.push("CONDITION");
  if (product.availability === "UNKNOWN") unknowns.push("AVAILABILITY");
  if (product.merchantTrust.verification === "UNVERIFIED") unknowns.push("MERCHANT_TRUST");
  return {
    selectionId: product.selectionId!,
    title: product.title,
    merchant: product.merchant,
    ...(product.sellerName === undefined ? {} : { sellerName: product.sellerName }),
    ...(product.imageUrl === undefined ? {} : { imageUrl: product.imageUrl }),
    purchaseUrl: product.purchaseLink?.url ?? product.merchantUrl,
    ...(product.brand === undefined ? {} : { brand: product.brand }),
    ...(product.sku === undefined ? {} : { sku: product.sku }),
    gtins: product.gtins,
    variantDimensions: product.variantDimensions,
    matchStatus: product.matchStatus,
    ...(product.itemPrice === undefined ? {} : { itemPrice: product.itemPrice }),
    ...(deliveredTotal === undefined ? {} : { deliveredTotal }),
    ...(deliveredTotalExpiresAt === undefined ? {} : { deliveredTotalExpiresAt }),
    deliveredTotalStatus,
    ...(comparedPrice === undefined ? {} : { comparedPrice }),
    availability: product.availability,
    condition: product.condition,
    merchantTrust: {
      level: product.merchantTrust.level,
      verification: product.merchantTrust.verification
    },
    verifiedDeals: product.coupons.verified.map((deal) => ({
      ...(deal.dealId === undefined ? {} : { dealId: deal.dealId }),
      ...(deal.assessment === undefined ? {} : { assessment: deal.assessment }),
      kind: deal.kind,
      title: deal.title,
      ...(deal.code === undefined ? {} : { code: deal.code }),
      ...(deal.discountPercent === undefined ? {} : { discountPercent: deal.discountPercent }),
      ...(deal.discountAmount === undefined ? {} : { discountAmount: deal.discountAmount }),
      productApplicability: deal.productApplicability ?? "UNKNOWN",
      validTo: deal.validTo
    })),
    ...(product.coupons.lookupStatus === undefined ? {} : { dealLookupStatus: product.coupons.lookupStatus }),
    ...(product.coupons.summary === undefined ? {} : { dealSummary: product.coupons.summary }),
    identityEvidence: product.matchEvidence,
    requirementEvidence: product.featureEvidence ?? [],
    preferenceEvidence: product.preferenceEvidence ?? [],
    limitations: product.requiredFeatureLimitations ?? [],
    unknowns,
    checkedAt: product.checkedAt
  };
}

function hasSharedStableIdentity(products: ComparableProduct[]): boolean {
  if (products.length < 2) return false;
  const first = products[0]!;
  const commonGtin = first.gtins.some((gtin) => products.every((product) => product.gtins.includes(gtin)));
  if (commonGtin) return true;
  const brand = normalized(first.brand);
  const sku = normalized(first.sku);
  return brand !== "" && sku !== "" && products.every((product) =>
    normalized(product.brand) === brand && normalized(product.sku) === sku
  );
}

function variantsCompatible(products: ComparableProduct[]): boolean {
  const explicit = products.map((product) => Object.entries(product.variantDimensions)
    .map(([key, value]) => `${normalized(key)}=${normalized(value)}`).sort());
  const first = explicit[0] ?? [];
  return explicit.every((dimensions) =>
    dimensions.length === first.length && dimensions.every((value, index) => value === first[index])
  );
}

function conditionsCompatible(products: ComparableProduct[]): boolean {
  const condition = products[0]?.condition;
  return condition !== undefined && condition !== "UNKNOWN" && products.every((product) => product.condition === condition);
}

function comparablePriceBasis(
  products: ComparableProduct[],
  evaluatedAtMs: number
): "ITEM_PRICE" | "DELIVERED_TOTAL" | "UNAVAILABLE" {
  const delivered = products.map((product) => activeDeliveredPrice(product, evaluatedAtMs));
  if (delivered.every((price) => price?.currency === "USD")) {
    return "DELIVERED_TOTAL";
  }
  if (products.every((product) => product.itemPrice?.currency === "USD")) return "ITEM_PRICE";
  return "UNAVAILABLE";
}

function activeDeliveredPrice(
  product: ComparableProduct,
  evaluatedAtMs: number
): { amountCents: number; currency: "USD" } | undefined {
  const delivered = product.pricing.deliveredPrice;
  if (delivered.status !== "ESTIMATED" || delivered.amount?.currency !== "USD" || delivered.expiresAt === undefined) {
    return undefined;
  }
  const expiresAtMs = Date.parse(delivered.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > evaluatedAtMs ? delivered.amount : undefined;
}

function priceDelta(
  entries: Array<z.infer<typeof ComparisonEntrySchema>>,
  basis: "ITEM_PRICE" | "DELIVERED_TOTAL" | "UNAVAILABLE"
): ProductComparisonOutput["priceDelta"] {
  if (basis === "UNAVAILABLE" || entries.some((entry) => entry.comparedPrice === undefined)) return undefined;
  const ordered = [...entries].sort((left, right) =>
    left.comparedPrice!.amountCents - right.comparedPrice!.amountCents ||
    left.selectionId.localeCompare(right.selectionId)
  );
  const lowest = ordered[0]!;
  const highest = ordered.at(-1)!;
  return {
    basis,
    currency: "USD",
    lowestSelectionId: lowest.selectionId,
    highestSelectionId: highest.selectionId,
    amountCents: highest.comparedPrice!.amountCents - lowest.comparedPrice!.amountCents
  };
}

function normalized(value: string | undefined): string {
  return value?.normalize("NFKC").trim().toLocaleLowerCase("en-US") ?? "";
}

function localize(locale: "en-US" | "zh-CN", english: string, chinese: string): string {
  return locale === "zh-CN" ? chinese : english;
}
