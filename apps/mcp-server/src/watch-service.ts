import { VerifiedDealsSchema, type DealPort, type VerifiedDeal } from "./deal-client.js";
import type { ShopifyPort, ShopifyProduct } from "./shopify-client.js";
import { productWatchClarificationQuestions, type WatchRecord, type WatchStore } from "./watch-store.js";

export type WatchEvaluation = {
  status: "TRIGGERED" | "NOT_TRIGGERED" | "PAUSED" | "EXPIRED" | "NEEDS_CLARIFICATION" | "DATA_SOURCE_UNAVAILABLE";
  message: string;
  watch: WatchRecord;
  observation?: Record<string, unknown>;
};

export async function evaluateWatch(
  watch: WatchRecord,
  store: WatchStore,
  shopify: ShopifyPort,
  deals: DealPort,
  now: Date
): Promise<WatchEvaluation> {
  if (watch.status === "PAUSED") return { status: "PAUSED", message: "Watch is paused.", watch };
  if (watch.spec.expiresAt !== undefined && Date.parse(watch.spec.expiresAt) <= now.getTime()) {
    const expired = { ...watch, status: "EXPIRED" as const, updatedAt: now.toISOString() };
    await store.save(expired);
    return { status: "EXPIRED", message: "Watch has expired.", watch: expired };
  }
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
      : await observeProducts(watch, shopify, now);
    const triggered = observation.satisfied && watch.wasSatisfied !== true;
    const updated = {
      ...watch,
      updatedAt: now.toISOString(),
      lastCheckedAt: now.toISOString(),
      wasSatisfied: observation.satisfied,
      lastObservation: observation.data
    };
    await store.save(updated);
    return {
      status: triggered ? "TRIGGERED" : "NOT_TRIGGERED",
      message: triggered ? observation.triggerMessage : observation.statusMessage,
      watch: updated,
      observation: observation.data
    };
  } catch {
    return {
      status: "DATA_SOURCE_UNAVAILABLE",
      message: "The verified source required by this watch is unavailable; no alert was generated.",
      watch
    };
  }
}

function isDealCondition(watch: WatchRecord) {
  return ["DISCOUNT_AT_LEAST", "COUPON_AVAILABLE", "CASHBACK_AT_LEAST"].includes(watch.spec.condition);
}

async function observeProducts(watch: WatchRecord, shopify: ShopifyPort, now: Date) {
  const result = await shopify.search({
    query: buildProductWatchQuery(watch),
    limit: 3,
    selectionMode: "LOWEST_PRICE",
    comparisonMode: "DISCOVERY",
    ...(watch.spec.zipCode === undefined ? {} : { zipCode: watch.spec.zipCode }),
    membershipIds: watch.spec.membershipIds
  });
  const products = result.products.filter((product) => {
    const checkedAt = Date.parse(product.checkedAt);
    return product.matchStatus === "EXACT" && identityMatches(product, watch) && conditionMatches(product, watch) &&
      checkedAt <= now.getTime() + 120_000 && checkedAt >= now.getTime() - 900_000;
  });
  if (products.length === 0) throw new Error("DATA_SOURCE_UNAVAILABLE");
  if (watch.spec.condition === "PRICE_BELOW") {
    const product = lowestPriced(products);
    if (product?.itemPrice === undefined) throw new Error("DATA_SOURCE_UNAVAILABLE");
    const threshold = watch.spec.threshold ?? 0;
    const satisfied = product.itemPrice.amountCents <= threshold;
    const price = `$${(product.itemPrice.amountCents / 100).toFixed(2)}`;
    return {
      satisfied,
      triggerMessage: `${product.title} is ${price}, at or below the watch target.`,
      statusMessage: `${product.title} is ${price}; target not reached.`,
      data: productObservation(product)
    };
  }
  const product = products.find((candidate) => candidate.availability === "IN_STOCK") ?? products[0];
  if (product === undefined) throw new Error("DATA_SOURCE_UNAVAILABLE");
  const inStock = product.availability === "IN_STOCK";
  const satisfied = watch.spec.condition === "RESTOCKED"
    ? watch.lastObservation?.availability !== undefined && watch.lastObservation.availability !== "IN_STOCK" && inStock
    : inStock;
  return {
    satisfied,
    triggerMessage: `${product.title} is now in stock at ${product.merchant}.`,
    statusMessage: inStock ? `${product.title} is in stock; no new transition to alert.` : `${product.title} is not currently in stock.`,
    data: productObservation(product)
  };
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

function identityMatches(product: ShopifyProduct, watch: WatchRecord): boolean {
  const identity = watch.spec.identity;
  if (identity === undefined) return false;
  if (identity.gtin !== undefined && !product.gtins.includes(identity.gtin)) return false;
  if (identity.modelNumber !== undefined && normalizeIdentity(product.sku) !== normalizeIdentity(identity.modelNumber)) return false;
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
    title: product.title,
    merchant: product.merchant,
    merchantUrl: product.merchantUrl,
    availability: product.availability,
    ...(product.itemPrice === undefined ? {} : { itemPrice: product.itemPrice }),
    checkedAt: product.checkedAt
  };
}
