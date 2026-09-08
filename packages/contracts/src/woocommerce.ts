import { z } from "zod";

const Id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const MerchantId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/u);
const Text = z.string().trim().min(1).max(300);
const HttpsUrl = z.string().url().max(4_096).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.username === "" && url.password === "" && url.port === "";
}, "credential-free HTTPS required");
const Attributes = z.record(z.string().max(80), Text).refine((value) => Object.keys(value).length <= 24);
const Dimensions = z.record(z.string().max(80), z.array(Text).max(100))
  .refine((value) => Object.keys(value).length <= 24);
const Timestamp = z.string().datetime();

export const WooVariantRequirementsSchema = z.object({
  color: Text.optional(), size: Text.optional(), attributes: Attributes.optional()
}).strict();
export const WooProductTargetSchema = z.object({
  merchantId: MerchantId, productId: Id, parentProductId: Id.optional(), variationId: Id.optional()
}).strict().superRefine((value, context) => {
  if (value.variationId !== undefined && value.variationId === value.productId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["variationId"], message: "variation target requires its distinct parent productId" });
  }
  if (value.parentProductId !== undefined && value.parentProductId !== value.productId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["parentProductId"], message: "target productId must identify the parent" });
  }
});
const Continuation = z.object({
  registryVersion: z.string().min(1).max(80), attemptedMerchantIds: z.array(MerchantId).max(12)
}).strict();
export const WooSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(300), limit: z.number().int().min(1).max(24).default(12),
  market: z.literal("US").default("US"), currency: z.literal("USD").default("USD"),
  brand: Text.optional(), productType: Text.optional(), maxItemPriceCents: z.number().int().positive().max(100_000_000).optional(),
  requirements: WooVariantRequirementsSchema.optional(), includeOutOfStock: z.boolean().optional(),
  productUrl: HttpsUrl.optional(), budgetMs: z.number().int().min(100).max(8_000).optional(), continuation: Continuation.optional()
}).strict();

export const WooProductSchema = z.object({
  sourceKind: z.literal("WOOCOMMERCE_STORE_API"), merchantId: MerchantId, merchantName: Text,
  sourceHost: z.string().min(3).max(253), productId: Id, parentProductId: Id.optional(), variationId: Id.optional(),
  title: z.string().trim().min(1).max(500), description: z.string().max(4_000).optional(),
  brand: Text.optional(), sku: Text.optional(), gtin: z.string().regex(/^\d{8,14}$/u).optional(), mpn: Text.optional(),
  productType: z.enum(["simple", "variable", "variation"]), category: z.string().max(300),
  condition: z.enum(["NEW", "USED", "REFURBISHED", "OPEN_BOX", "UNKNOWN"]).default("UNKNOWN"),
  attributes: z.array(Text).max(100), variantDimensions: Dimensions, selectedAttributes: Attributes,
  merchantUrl: HttpsUrl, imageUrl: HttpsUrl.optional(), images: z.array(z.object({ id: z.string().min(1).max(128), url: HttpsUrl }).strict()).max(12),
  itemPrice: z.object({ amountCents: z.number().int().nonnegative().max(100_000_000), currency: z.literal("USD") }).strict().optional(),
  priceEvidence: z.object({
    amountMinor: z.string().regex(/^\d{1,16}$/u).optional(), currency: z.string().regex(/^[A-Z]{3}$/u),
    currencyMinorUnit: z.number().int().min(0).max(6), scope: z.enum(["PRODUCT", "PARENT_RANGE", "VARIANT", "UNKNOWN"]), taxBasis: z.literal("UNKNOWN")
  }).strict(),
  availability: z.enum(["IN_STOCK", "OUT_OF_STOCK", "BACKORDER", "UNKNOWN"]),
  availabilityScope: z.enum(["PRODUCT", "PARENT", "VARIANT"]),
  rating: z.object({ value: z.number().min(0).max(5), reviewCount: z.number().int().nonnegative().max(100_000_000), scale: z.literal(5), productId: Id }).strict().optional(),
  checkedAt: Timestamp
}).strict().superRefine((product, context) => {
  if (new URL(product.merchantUrl).hostname !== product.sourceHost) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceHost"], message: "merchant URL must match observed host" });
  }
  if (product.productType === "variation" && (product.variationId === undefined || product.parentProductId !== product.productId || product.variationId === product.productId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["variationId"], message: "variation requires explicit distinct parent and child identity" });
  }
  if (product.productType !== "variation" && (product.variationId !== undefined || product.parentProductId !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["productType"], message: "non-variation cannot claim variation identity" });
  }
  const price = product.itemPrice;
  if (price !== undefined) {
    const evidence = product.priceEvidence;
    const units = evidence.amountMinor === undefined ? NaN : Number(evidence.amountMinor) * 10 ** (2 - evidence.currencyMinorUnit);
    if (evidence.currency !== "USD" || !Number.isSafeInteger(units) || units !== price.amountCents || evidence.scope === "PARENT_RANGE" || evidence.scope === "UNKNOWN") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["itemPrice"], message: "USD item price requires exact non-range minor-unit evidence" });
    }
  }
});

export const WooStoreResultSchema = z.object({
  merchantId: MerchantId, status: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE", "SKIPPED"]),
  reason: z.enum(["TIMEOUT", "RATE_LIMITED", "ACCESS_DENIED", "SECURITY_REJECTED", "INVALID_RESPONSE", "UPSTREAM_UNAVAILABLE", "BUDGET_EXHAUSTED", "CIRCUIT_OPEN", "NOT_ELIGIBLE", "NOT_FOUND", "UNSUPPORTED", "CANCELLED"]).optional(),
  requests: z.number().int().nonnegative().max(18), returned: z.number().int().nonnegative().max(100)
}).strict();
export const WooSearchResultSchema = z.object({
  source: z.literal("WOOCOMMERCE_STORE_API"), schemaVersion: z.literal(1), registryVersion: z.string().min(1).max(80), requestId: z.string().min(1).max(80),
  status: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE", "NOT_CONFIGURED"]), snapshotAt: Timestamp,
  products: z.array(WooProductSchema).max(24), stores: z.array(WooStoreResultSchema).max(6),
  diagnostics: z.object({
    eligibleStores: z.number().int().nonnegative(), plannedStores: z.number().int().nonnegative().max(6),
    attemptedStores: z.number().int().nonnegative().max(6), succeededStores: z.number().int().nonnegative().max(6),
    failedStores: z.number().int().nonnegative().max(6), skippedStores: z.number().int().nonnegative(),
    physicalRequests: z.number().int().nonnegative().max(18), responseBytes: z.number().int().nonnegative().max(8 * 1024 * 1024),
    cacheHits: z.number().int().nonnegative().max(100), elapsedMs: z.number().nonnegative(), truncated: z.boolean(), registryCoverageComplete: z.boolean()
  }).strict(), continuation: Continuation.optional()
}).strict();
export const WooLookupInputSchema = WooProductTargetSchema;
export const WooInspectionInputSchema = z.object({ target: WooProductTargetSchema, requirements: WooVariantRequirementsSchema.default({}) }).strict();
export const WooLookupResultSchema = z.object({
  source: z.literal("WOOCOMMERCE_STORE_API"), registryVersion: z.string().min(1).max(80),
  status: z.enum(["FOUND", "NOT_FOUND", "UNAVAILABLE", "UNSUPPORTED"]), product: WooProductSchema.optional(), checkedAt: Timestamp
}).strict().refine((value) => (value.status === "FOUND") === (value.product !== undefined), "FOUND requires an observation");
export const WooInspectionResultSchema = z.object({
  source: z.literal("WOOCOMMERCE_STORE_API"), registryVersion: z.string().min(1).max(80),
  status: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE", "UNSUPPORTED"]), parent: WooProductSchema.optional(),
  products: z.array(WooProductSchema).max(24), checkedAt: Timestamp, truncated: z.boolean()
}).strict();

export type WooProduct = z.infer<typeof WooProductSchema>;
export type WooProductTarget = z.infer<typeof WooProductTargetSchema>;
export type WooVariantRequirements = z.infer<typeof WooVariantRequirementsSchema>;
export type WooSearchInput = z.infer<typeof WooSearchInputSchema>;
export type WooSearchResult = z.infer<typeof WooSearchResultSchema>;
export type WooStoreResult = z.infer<typeof WooStoreResultSchema>;
export type WooLookupResult = z.infer<typeof WooLookupResultSchema>;
export type WooInspectionResult = z.infer<typeof WooInspectionResultSchema>;

export function wooProductTarget(product: WooProduct): WooProductTarget {
  return { merchantId: product.merchantId, productId: product.productId,
    ...(product.parentProductId === undefined ? {} : { parentProductId: product.parentProductId }),
    ...(product.variationId === undefined ? {} : { variationId: product.variationId }) };
}
