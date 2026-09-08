import { VerifiedDealsSchema, type DealPort, type VerifiedDeal } from "./deal-client.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { ShopifyPort, ShopifyProduct } from "./shopify-client.js";
import { ShopifyCartQuoteError, type ShopifyCartQuotePort } from "./shopify-cart-quote.js";
import { productWatchClarificationQuestions, WatchStateConflictError, watchStopIntent, type WatchRecord, type WatchStore } from "./watch-store.js";
import type { WooCommerceProductPort } from "./woocommerce-client.js";
import { WooLookupResultSchema, type WooProduct } from "../../../packages/contracts/src/woocommerce.js";

export type WatchEvaluation = {
  status: "TRIGGERED" | "NOT_TRIGGERED" | "PAUSED" | "EXPIRED" | "COMPLETED" | "NEEDS_CLARIFICATION" | "DATA_SOURCE_UNAVAILABLE";
  message: string;
  watch: WatchRecord;
  observation?: Record<string, unknown>;
};

export async function evaluateWatch(
  watch: WatchRecord,
  store: WatchStore,
  shopify: ShopifyPort,
  deals: DealPort,
  _cartQuotes: ShopifyCartQuotePort | undefined,
  now: Date,
  woocommerceProducts?: WooCommerceProductPort
): Promise<WatchEvaluation> {
  const started = performance.now();
  if (watch.status === "COMPLETED") return { status: "COMPLETED", message: "Restock Watch is locally completed; no new notification. Host scheduler stop remains unverified.", watch };
  if (watch.status === "EXPIRED" || (watch.spec.expiresAt !== undefined && Date.parse(watch.spec.expiresAt) <= now.getTime())) {
    const stopIntent = watchStopIntent(watch, "EXPIRED", now.toISOString());
    if (watch.status === "EXPIRED" && (stopIntent === undefined || watch.stopIntent !== undefined)) {
      return { status: "EXPIRED", message: "Watch is locally expired; host scheduler stop remains unverified.", watch };
    }
    const expired = { ...watch, status: "EXPIRED" as const, updatedAt: now.toISOString(),
      ...(stopIntent === undefined ? {} : { stopIntent }) };
    const saved = await store.save(expired);
    return { status: "EXPIRED", message: "Watch has expired.", watch: saved };
  }
  if (watch.status === "PAUSED") return { status: "PAUSED", message: "Watch is locally paused; host scheduler state is unverified.", watch };
  if (watch.spec.priceBasis === "DELIVERED_TOTAL") return {
    status: "DATA_SOURCE_UNAVAILABLE",
    message: "[RECURRING_QUOTE_AUTHORIZATION_UNAVAILABLE] Recurring anonymous Cart authorization is not implemented. No quote was requested. One-time quote consent does not authorize Watch quotes.",
    watch
  };
  const questions = productWatchClarificationQuestions(watch.spec);
  if (questions.length > 0) {
    return {
      status: "NEEDS_CLARIFICATION",
      message: questions.join(" "),
      watch,
      observation: { questions }
    };
  }

  try {
    const observation = isDealCondition(watch)
      ? await observeDeals(watch, deals, now)
      : watch.spec.selectedProduct?.sourceKind === "WOOCOMMERCE_STORE_API"
        ? await observeWooProduct(watch, woocommerceProducts, new Date(now.getTime() + Math.ceil(performance.now() - started)))
        : await observeProducts(watch, shopify, now);
    const triggered = observation.satisfied && watch.wasSatisfied !== true;
    const complete = triggered && watch.spec.condition === "RESTOCKED";
    const stopIntent = complete ? watchStopIntent(watch, "RESTOCKED", now.toISOString()) : undefined;
    const updated = {
      ...watch,
      updatedAt: now.toISOString(),
      lastCheckedAt: now.toISOString(),
      wasSatisfied: observation.satisfied,
      lastObservation: observation.data,
      ...(complete ? { status: "COMPLETED" as const, completionEventId: randomUUID() } : {}),
      ...(stopIntent === undefined ? {} : { stopIntent })
    };
    const saved = await store.save(updated);
    return {
      status: triggered ? "TRIGGERED" : "NOT_TRIGGERED",
      message: triggered ? observation.triggerMessage : observation.statusMessage,
      watch: saved,
      observation: observation.data
    };
  } catch (error) {
    if (error instanceof WatchStateConflictError) throw error;
    const failureCode = error instanceof ShopifyCartQuoteError ? error.code : undefined;
    return {
      status: "DATA_SOURCE_UNAVAILABLE",
      message: failureCode === undefined
        ? "The verified source required by this watch is unavailable; no alert was generated."
        : `The selected merchant could not provide a delivered-total quote (${failureCode}); no alert was generated.`,
      watch,
      ...(failureCode === undefined ? {} : { observation: { failureCode, priceBasis: "DELIVERED_TOTAL" } })
    };
  }
}

function isDealCondition(watch: WatchRecord) {
  return ["DISCOUNT_AT_LEAST", "COUPON_AVAILABLE", "CASHBACK_AT_LEAST"].includes(watch.spec.condition);
}

type WooSelectedProduct = Extract<NonNullable<WatchRecord["spec"]["selectedProduct"]>, { sourceKind: "WOOCOMMERCE_STORE_API" }>;
type WooWatchTarget = Pick<WatchRecord, "spec" | "lastCheckedAt" | "lastObservation">;
export type WooWatchObservation = {
  satisfied: boolean;
  triggerMessage: string;
  statusMessage: string;
  data: Record<string, unknown>;
};

/** Reads and verifies the locked target; callers own persistence and notification. */
export async function observeWooProduct(watch: WooWatchTarget, source: WooCommerceProductPort | undefined, now: Date): Promise<WooWatchObservation> {
  const started = performance.now();
  const selected = watch.spec.selectedProduct;
  if (source === undefined || selected?.sourceKind !== "WOOCOMMERCE_STORE_API") throw new Error("DATA_SOURCE_UNAVAILABLE");
  const result = WooLookupResultSchema.parse(await source.lookup({
    merchantId: selected.merchantId, productId: selected.productId,
    ...(selected.parentProductId === undefined ? {} : { parentProductId: selected.parentProductId }),
    ...(selected.variationId === undefined ? {} : { variationId: selected.variationId })
  }, { signal: AbortSignal.timeout(9_000) }));
  if (result.status !== "FOUND" || result.product === undefined) throw new Error("DATA_SOURCE_UNAVAILABLE");
  now = new Date(now.getTime() + Math.ceil(performance.now() - started));
  const product = result.product;
  const checkedAt = Date.parse(product.checkedAt);
  const previousSourceTime = typeof watch.lastObservation?.["checkedAt"] === "string"
    ? Date.parse(watch.lastObservation["checkedAt"]) : NaN;
  const previous = matchingWooInventoryObservation(watch, selected, now);
  if (!wooTargetMatches(product, selected) || !wooRequirementsMatch(product, watch) ||
    checkedAt > now.getTime() || checkedAt < now.getTime() - 900_000 ||
    checkedAt < Date.parse(selected.selectedAt) ||
    (watch.lastCheckedAt !== undefined && checkedAt < Date.parse(watch.lastCheckedAt)) ||
    (Number.isFinite(previousSourceTime) && checkedAt < previousSourceTime) ||
    (previous !== undefined && checkedAt < Date.parse(previous.checkedAt))) throw new Error("DATA_SOURCE_UNAVAILABLE");
  const data = {
    sourceKind: product.sourceKind, merchantId: product.merchantId, sourceHost: product.sourceHost,
    productId: product.productId, productType: product.productType,
    ...(product.parentProductId === undefined ? {} : { parentProductId: product.parentProductId }),
    ...(product.variationId === undefined ? {} : { variationId: product.variationId }),
    title: product.title, merchant: product.merchantName, merchantUrl: product.merchantUrl,
    variantDimensions: { ...product.selectedAttributes }, condition: product.condition,
    availability: product.availability, availabilityScope: product.availabilityScope,
    ...(product.itemPrice === undefined ? {} : { itemPrice: product.itemPrice }),
    checkedAt: product.checkedAt
  };
  if (watch.spec.condition === "PRICE_BELOW") {
    if (product.itemPrice === undefined || product.priceEvidence.scope !==
      (selected.productType === "variation" ? "VARIANT" : "PRODUCT")) throw new Error("DATA_SOURCE_UNAVAILABLE");
    const satisfied = product.itemPrice.amountCents < (watch.spec.threshold ?? 0);
    const price = `$${(product.itemPrice.amountCents / 100).toFixed(2)}`;
    return { satisfied, triggerMessage: `${product.title} is ${price}, below the watch target.`,
      statusMessage: `${product.title} is ${price}; target not reached.`, data: { ...data, priceBasis: "ITEM_PRICE" } };
  }
  if (!["IN_STOCK", "OUT_OF_STOCK"].includes(product.availability) || product.availabilityScope !==
    (selected.productType === "variation" ? "VARIANT" : "PRODUCT")) throw new Error("DATA_SOURCE_UNAVAILABLE");
  const inStock = product.availability === "IN_STOCK";
  const satisfied = inStock && (watch.spec.condition !== "RESTOCKED" || previous?.availability === "OUT_OF_STOCK");
  return { satisfied, triggerMessage: `${product.title} is now in stock at ${product.merchantName}.`,
    statusMessage: inStock ? `${product.title} is in stock; no new transition to alert.` : `${product.title} is not currently in stock.`, data };
}

function sameDimensions(first: Record<string, string>, second: Record<string, string>): boolean {
  return Object.keys(first).length === Object.keys(second).length && Object.entries(first).every(([key, value]) =>
    Object.entries(second).some(([otherKey, otherValue]) => normalizeIdentity(key) === normalizeIdentity(otherKey) &&
      normalizeIdentity(value) === normalizeIdentity(otherValue)));
}

function wooTargetMatches(product: WooProduct, selected: WooSelectedProduct): boolean {
  return product.merchantId === selected.merchantId && product.sourceHost.toLowerCase() === selected.sourceHost.toLowerCase() &&
    product.productId === selected.productId && product.parentProductId === selected.parentProductId &&
    product.variationId === selected.variationId && product.productType === selected.productType &&
    product.condition === selected.condition && sameDimensions(product.selectedAttributes, selected.variantDimensions);
}

function wooRequirementsMatch(product: WooProduct, watch: Pick<WatchRecord, "spec">): boolean {
  const spec = watch.spec;
  if (spec.merchant !== undefined && normalizeIdentity(spec.merchant) !== normalizeIdentity(product.merchantName)) return false;
  if (spec.conditionPreference !== "ANY" && spec.conditionPreference !== product.condition) return false;
  const identity = spec.identity;
  if (identity === undefined) return true;
  if (identity.gtin !== undefined && identity.gtin !== product.gtin) return false;
  if (identity.modelNumber !== undefined && ![product.mpn, product.sku].some(value =>
    normalizeIdentity(value) === normalizeIdentity(identity.modelNumber)) &&
    !normalizeIdentity(product.title).includes(normalizeIdentity(identity.modelNumber))) return false;
  if (identity.generation !== undefined && !normalizeIdentity(product.title).includes(normalizeIdentity(identity.generation))) return false;
  return Object.entries(identity.variantDimensions ?? {}).every(([key, value]) => Object.entries(product.selectedAttributes)
    .some(([otherKey, otherValue]) => normalizeIdentity(key) === normalizeIdentity(otherKey) && normalizeIdentity(value) === normalizeIdentity(otherValue)));
}

const WooInventoryObservationSchema = z.object({
  sourceKind: z.literal("WOOCOMMERCE_STORE_API"), merchantId: z.string().min(1), sourceHost: z.string().min(1),
  productId: z.number().int().positive(), parentProductId: z.number().int().positive().optional(),
  variationId: z.number().int().positive().optional(), productType: z.enum(["simple", "variation"]),
  variantDimensions: z.record(z.string(), z.string()),
  condition: z.enum(["NEW", "USED", "REFURBISHED", "OPEN_BOX", "UNKNOWN"]),
  availability: z.enum(["OUT_OF_STOCK", "IN_STOCK"]), availabilityScope: z.enum(["PRODUCT", "VARIANT"]),
  checkedAt: z.string().datetime({ offset: true })
});

function matchingWooInventoryObservation(watch: Pick<WatchRecord, "lastObservation">, selected: WooSelectedProduct, now: Date) {
  const parsed = WooInventoryObservationSchema.safeParse(watch.lastObservation);
  if (!parsed.success) return undefined;
  const previous = parsed.data;
  return Date.parse(previous.checkedAt) <= now.getTime() && previous.merchantId === selected.merchantId &&
    previous.sourceHost.toLowerCase() === selected.sourceHost.toLowerCase() && previous.productId === selected.productId &&
    previous.parentProductId === selected.parentProductId && previous.variationId === selected.variationId &&
    previous.productType === selected.productType && previous.condition === selected.condition &&
    previous.availabilityScope === (selected.productType === "variation" ? "VARIANT" : "PRODUCT") &&
    sameDimensions(previous.variantDimensions, selected.variantDimensions) ? previous : undefined;
}

async function observeProducts(
  watch: WatchRecord,
  shopify: ShopifyPort,
  now: Date
) {
  const result = await shopify.search({
    query: buildProductWatchQuery(watch),
    limit: 3,
    selectionMode: "LOWEST_PRICE",
    comparisonMode: "DISCOVERY",
    includeOutOfStock: watch.spec.condition === "IN_STOCK" || watch.spec.condition === "RESTOCKED",
    ...(watch.spec.zipCode === undefined ? {} : { zipCode: watch.spec.zipCode }),
    membershipIds: watch.spec.membershipIds
  });
  const products = result.products.filter((product) => {
    const checkedAt = Date.parse(product.checkedAt);
    const previous = watch.spec.condition === "RESTOCKED" ? matchingInventoryObservation(watch, product, now) : undefined;
    return watchIdentityEvidenceMatches(product, watch) && identityMatches(product, watch) && merchantMatches(product, watch) &&
      conditionMatches(product, watch) &&
      (watch.spec.condition !== "RESTOCKED" || (product.availability !== "UNKNOWN" &&
        product.availabilityScope !== "PRODUCT_COLOR" && checkedAt <= now.getTime())) &&
      (previous === undefined || checkedAt >= Date.parse(previous.checkedAt)) &&
      checkedAt <= now.getTime() + 120_000 && checkedAt >= now.getTime() - 900_000;
  });
  if (products.length === 0) throw new Error("DATA_SOURCE_UNAVAILABLE");
  if (watch.spec.condition === "PRICE_BELOW") {
    const product = lowestPriced(products);
    if (product?.itemPrice === undefined) throw new Error("DATA_SOURCE_UNAVAILABLE");
    const threshold = watch.spec.threshold ?? 0;
    const satisfied = product.itemPrice.amountCents < threshold;
    const price = `$${(product.itemPrice.amountCents / 100).toFixed(2)}`;
    return {
      satisfied,
      triggerMessage: `${product.title} is ${price}, below the watch target.`,
      statusMessage: `${product.title} is ${price}; target not reached.`,
      data: { ...productObservation(product), priceBasis: "ITEM_PRICE" }
    };
  }
  const trackedProduct = watch.spec.condition === "RESTOCKED"
    ? products.find((candidate) => matchingInventoryObservation(watch, candidate, now) !== undefined)
    : undefined;
  const product = trackedProduct ?? products.find((candidate) => candidate.availability === "IN_STOCK") ?? products[0];
  if (product === undefined) throw new Error("DATA_SOURCE_UNAVAILABLE");
  const inStock = product.availability === "IN_STOCK";
  const satisfied = watch.spec.condition === "RESTOCKED"
    ? inStock && matchingInventoryObservation(watch, product, now)?.availability === "OUT_OF_STOCK"
    : inStock;
  return {
    satisfied,
    triggerMessage: `${product.title} is now in stock at ${product.merchant}.`,
    statusMessage: inStock ? `${product.title} is in stock; no new transition to alert.` : `${product.title} is not currently in stock.`,
    data: productObservation(product)
  };
}

const InventoryObservationSchema = z.object({
  merchantId: z.string().min(1),
  sourceHost: z.string().min(1),
  handle: z.string().min(1),
  variantDimensions: z.record(z.string(), z.string()),
  condition: z.enum(["NEW", "USED", "REFURBISHED", "OPEN_BOX", "UNKNOWN"]),
  availability: z.enum(["OUT_OF_STOCK", "IN_STOCK"]),
  checkedAt: z.string().datetime({ offset: true })
});

function matchingInventoryObservation(
  watch: WatchRecord, product: ShopifyProduct, now: Date
): z.infer<typeof InventoryObservationSchema> | undefined {
  const parsed = InventoryObservationSchema.safeParse(watch.lastObservation);
  if (!parsed.success) return undefined;
  const previous = parsed.data;
  const previousTime = Date.parse(previous.checkedAt);
  return previousTime <= now.getTime() &&
    previous.merchantId === product.merchantId && previous.sourceHost === product.sourceHost &&
    previous.handle === product.handle && previous.condition === product.condition &&
    Object.keys(previous.variantDimensions).length === Object.keys(product.variantDimensions).length &&
    Object.entries(previous.variantDimensions).every(([key, value]) => product.variantDimensions[key] === value)
    ? previous : undefined;
}

function buildProductWatchQuery(watch: WatchRecord): string {
  const identity = watch.spec.identity;
  const terms = [
    watch.spec.query,
    identity?.generation,
    identity?.modelNumber,
    identity?.gtin,
    ...Object.values(identity?.variantDimensions ?? {})
  ].filter((term): term is string => term !== undefined && term.length > 0);
  return [...new Set(terms)].join(" ");
}

function conditionMatches(product: ShopifyProduct, watch: WatchRecord): boolean {
  const requested = watch.spec.conditionPreference;
  return requested === "ANY" || product.condition === requested;
}

function merchantMatches(product: ShopifyProduct, watch: WatchRecord): boolean {
  return watch.spec.merchant === undefined || normalizeIdentity(product.merchant) === normalizeIdentity(watch.spec.merchant);
}

function watchIdentityEvidenceMatches(product: ShopifyProduct, watch: WatchRecord): boolean {
  if (product.matchStatus === "EXACT") return true;
  const identity = watch.spec.identity;
  return product.matchStatus === "DISCOVERY_MATCH" && watch.spec.merchant !== undefined &&
    identity?.generation !== undefined && identity.modelNumber === undefined && identity.gtin === undefined;
}

function identityMatches(product: ShopifyProduct, watch: WatchRecord): boolean {
  const identity = watch.spec.identity;
  if (identity === undefined) return false;
  if (identity.gtin !== undefined && !product.gtins.includes(identity.gtin)) return false;
  if (identity.modelNumber !== undefined) {
    const requestedModel = normalizeIdentity(identity.modelNumber);
    const skuMatches = normalizeIdentity(product.sku) === requestedModel;
    const titleMatches = normalizeIdentity(product.title).includes(requestedModel);
    if (!skuMatches && !titleMatches) return false;
  }
  if (identity.generation !== undefined && !normalizeIdentity(product.title).includes(normalizeIdentity(identity.generation))) return false;
  return Object.entries(identity.variantDimensions ?? {}).every(([key, value]) => {
    const productValue = Object.entries(product.variantDimensions)
      .find(([productKey]) => normalizeIdentity(productKey) === normalizeIdentity(key))?.[1];
    return normalizeIdentity(productValue) === normalizeIdentity(value);
  });
}

function normalizeIdentity(value: string | undefined): string {
  return (value ?? "").normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}

async function observeDeals(watch: WatchRecord, deals: DealPort, now: Date) {
  const found = VerifiedDealsSchema.parse(await deals.search({
    merchant: watch.spec.merchant ?? "",
    productQuery: watch.spec.query,
    membershipIds: watch.spec.membershipIds,
    channel: "ANY"
  }));
  const merchant = (watch.spec.merchant ?? "").toLocaleLowerCase("en-US");
  const eligible = found.filter((deal) => {
    const checkedAt = Date.parse(deal.checkedAt);
    return deal.verificationStatus === "VERIFIED" && deal.merchant.toLocaleLowerCase("en-US") === merchant &&
      checkedAt <= now.getTime() + 120_000 && checkedAt >= now.getTime() - 86_400_000 &&
      Date.parse(deal.validFrom) <= now.getTime() && Date.parse(deal.validTo) > now.getTime();
  });
  let selected: VerifiedDeal | undefined;
  if (watch.spec.condition === "COUPON_AVAILABLE") {
    selected = eligible.find((deal) => deal.kind !== "CASHBACK");
  } else if (watch.spec.condition === "DISCOUNT_AT_LEAST") {
    selected = eligible.find((deal) => (deal.discountPercent ?? -1) >= (watch.spec.threshold ?? 0));
  } else {
    selected = eligible.find((deal) => deal.kind === "CASHBACK" && (deal.cashbackPercent ?? -1) >= (watch.spec.threshold ?? 0));
  }
  const satisfied = selected !== undefined;
  return {
    satisfied,
    triggerMessage: selected === undefined ? "" : `${selected.merchant}: ${selected.title}`,
    statusMessage: "No verified deal currently satisfies this watch.",
    data: selected === undefined ? { dealsFound: eligible.length } : { dealsFound: eligible.length, deal: selected }
  };
}

function lowestPriced(products: ShopifyProduct[]) {
  return [...products].filter((product) => product.itemPrice !== undefined).sort((a, b) =>
    (a.itemPrice?.amountCents ?? Number.MAX_SAFE_INTEGER) - (b.itemPrice?.amountCents ?? Number.MAX_SAFE_INTEGER))[0];
}

function productObservation(product: ShopifyProduct): Record<string, unknown> {
  return {
    merchantId: product.merchantId,
    sourceHost: product.sourceHost,
    handle: product.handle,
    variantDimensions: { ...product.variantDimensions },
    condition: product.condition,
    title: product.title,
    merchant: product.merchant,
    merchantUrl: product.merchantUrl,
    availability: product.availability,
    ...(product.itemPrice === undefined ? {} : { itemPrice: product.itemPrice }),
    checkedAt: product.checkedAt
  };
}
