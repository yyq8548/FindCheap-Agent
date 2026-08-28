import { z } from "zod";

import { classifyShopifyCandidate, hasStrongProductIdentifier } from "./shopify-match.js";
import type {
  ShopifyCondition,
  ShopifyPort,
  ShopifyProduct,
  ShopifySearchInput,
  ShopifySearchResult
} from "./shopify-client.js";
import {
  MERCHANT_TRUST_REGISTRY_VERSION,
  isTrustedMerchant,
  merchantRecommendationRank,
  merchantRecommendationTier,
  merchantTrustRank,
  resolveMerchantTrust
} from "./merchant-trust.js";

export const SHOPIFY_GLOBAL_CATALOG_ENDPOINT = "https://catalog.shopify.com/api/ucp/mcp";
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const HttpsUrlSchema = z.string().url().max(4_096).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.username === "" && url.password === "" && url.port === "";
});
const NumericSchema = z.union([
  z.number().finite(),
  z.string().regex(/^\d+(?:\.\d+)?$/u).max(40).transform(Number)
]);
const RatingValueSchema = NumericSchema.pipe(z.number().finite().nonnegative().max(100));
const RatingCountSchema = NumericSchema.pipe(z.number().int().nonnegative().max(1_000_000_000));
const MediaSchema = z.union([
  HttpsUrlSchema.transform((url) => ({ type: "image", url })),
  z.object({
    type: z.string().max(40).optional(),
    url: HttpsUrlSchema
  }).passthrough().transform((value) => ({ type: value.type ?? "image", url: value.url })),
  z.object({
    image: z.object({ url: HttpsUrlSchema }).passthrough()
  }).passthrough().transform((value) => ({ type: "image", url: value.image.url }))
]);
const RatingSchema = z.object({
  value: RatingValueSchema,
  scale_min: RatingValueSchema,
  scale_max: RatingValueSchema.pipe(z.number().positive()),
  count: RatingCountSchema
}).passthrough().refine((rating) =>
  rating.scale_max > rating.scale_min &&
  rating.value >= rating.scale_min &&
  rating.value <= rating.scale_max
);
const DescriptionSchema = z.union([
  z.string().trim().max(20_000),
  z.object({
    plain: z.string().trim().max(20_000).optional(),
    markdown: z.string().trim().max(20_000).optional(),
    html: z.string().trim().max(40_000).optional()
  }).passthrough().refine((value) =>
    value.plain !== undefined || value.markdown !== undefined || value.html !== undefined,
  "description must contain plain, markdown, or html text")
]);
const CategorySchema = z.union([
  z.string().trim().max(300),
  z.object({
    name: z.string().trim().max(300).optional(),
    label: z.string().trim().max(300).optional(),
    fullName: z.string().trim().max(300).optional()
  }).passthrough().refine((value) =>
    value.name !== undefined || value.label !== undefined || value.fullName !== undefined,
  "category object must contain a name")
]);
const AvailabilitySchema = z.union([
  z.object({ available: z.boolean() }).passthrough(),
  z.boolean().transform((available) => ({ available })),
  z.enum(["AVAILABLE", "IN_STOCK", "UNAVAILABLE", "OUT_OF_STOCK"])
    .transform((value) => ({ available: value === "AVAILABLE" || value === "IN_STOCK" }))
]);
const ConditionValueSchema = z.union([
  z.string().trim().min(1).max(80),
  z.object({
    value: z.string().trim().min(1).max(80).optional(),
    name: z.string().trim().min(1).max(80).optional(),
    status: z.string().trim().min(1).max(80).optional()
  }).passthrough().refine((value) =>
    value.value !== undefined || value.name !== undefined || value.status !== undefined,
  "condition object must contain a value")
]);
const ConditionSchema = z.union([
  z.array(ConditionValueSchema).max(10),
  ConditionValueSchema.transform((value) => [value])
]).nullish().transform((values) => values?.map(conditionText));
const VariantOptionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(300).optional(),
  value: z.string().trim().min(1).max(300).optional()
}).passthrough().refine((option) => option.label !== undefined || option.value !== undefined)
  .transform((option) => ({ name: option.name, label: option.label ?? option.value! }));
const ProductOptionValueSchema = z.union([
  z.string().trim().min(1).max(300).transform((label) => ({ label })),
  z.object({
    label: z.string().trim().min(1).max(300).optional(),
    value: z.string().trim().min(1).max(300).optional(),
    name: z.string().trim().min(1).max(300).optional()
  }).passthrough().refine((value) =>
    value.label !== undefined || value.value !== undefined || value.name !== undefined)
    .transform((value) => ({ label: value.label ?? value.value ?? value.name! }))
]);
const CatalogPriceSchema = z.union([
  z.object({
    amount: z.number().int().nonnegative().max(100_000_000),
    currency: z.string().length(3)
  }).passthrough(),
  z.object({
    amount: z.string().regex(/^\d+\.\d{1,2}$/u).max(20),
    currency: z.string().length(3).optional(),
    currencyCode: z.string().length(3).optional()
  }).passthrough().refine((value) => value.currency !== undefined || value.currencyCode !== undefined)
    .transform((value) => ({
      amount: decimalDollarsToCents(value.amount),
      currency: value.currency ?? value.currencyCode!
    }))
]);
const VariantSchema = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/u).max(200),
  title: z.string().trim().min(1).max(1_000),
  url: HttpsUrlSchema,
  price: CatalogPriceSchema,
  availability: AvailabilitySchema,
  options: z.array(VariantOptionSchema).max(30).nullish().transform((value) => value ?? undefined),
  media: z.array(MediaSchema).max(20).nullish().transform((value) => value ?? undefined),
  seller: z.object({
    id: z.string().regex(/^gid:\/\/shopify\/Shop\/\d+$/u).max(200),
    name: z.string().trim().min(1).max(300),
    url: HttpsUrlSchema,
    domain: z.string().trim().min(1).max(253).nullish()
  }).passthrough(),
  condition: ConditionSchema,
  rating: RatingSchema.nullish(),
  description: DescriptionSchema.optional()
}).passthrough();
const ProductSchema = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/p\/[A-Za-z0-9]+$/u).max(200),
  title: z.string().trim().min(1).max(1_000),
  description: DescriptionSchema.optional(),
  product_type: CategorySchema.nullish(),
  productType: CategorySchema.nullish(),
  category: CategorySchema.nullish(),
  options: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    values: z.array(ProductOptionValueSchema).max(100)
  }).passthrough()).max(30).nullish().transform((value) => value ?? undefined),
  media: z.array(MediaSchema).max(20).nullish().transform((value) => value ?? undefined),
  rating: RatingSchema.nullish(),
  variants: z.array(VariantSchema).max(100)
}).passthrough();
const CatalogEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: z.object({
    structuredContent: z.object({
      ucp: z.object({
        version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
        status: z.literal("success")
      }).passthrough(),
      products: z.array(z.unknown()).max(50),
      messages: z.array(z.unknown()).max(100).nullish()
    }).passthrough()
  }).passthrough()
}).passthrough();

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
type Dependencies = {
  fetch?: Fetch;
  clock?: { now(): Date };
  monotonicNow?: () => number;
};
type GlobalCandidate = ShopifyProduct & { catalogProductId: string };
type CatalogQuery = { kind: "PRIMARY" | "RELAXED"; query: string };

const CHINESE_QUERY_REPLACEMENTS = [
  ["头戴式耳机", "over ear headphones", "headphones"],
  ["无线耳机", "wireless headphones", "headphones"],
  ["蓝牙耳机", "bluetooth headphones", "headphones"],
  ["逗猫棒", "cat wand toy", "cat toy"],
  ["猫零食", "cat treats", "cat treats"],
  ["猫用品", "cat supplies", "cat supplies"],
  ["猫砂", "cat litter", "cat litter"],
  ["猫粮", "cat food", "cat food"],
  ["狗零食", "dog treats", "dog treats"],
  ["狗粮", "dog food", "dog food"],
  ["跑步鞋", "running shoes", "athletic shoes"],
  ["跑鞋", "running shoes", "athletic shoes"],
  ["运动鞋", "sneakers", "shoes"],
  ["平底皮鞋", "leather flat shoes", "flat shoes"],
  ["芭蕾平底鞋", "ballet flats", "flat shoes"],
  ["芭蕾舞鞋", "ballet shoes", "flat shoes"],
  ["平底鞋", "flat shoes", "shoes"],
  ["乐福鞋", "loafers", "shoes"],
  ["高跟鞋", "high heels", "shoes"],
  ["皮鞋", "leather shoes", "shoes"],
  ["靴子", "boots", "shoes"],
  ["凉鞋", "sandals", "shoes"],
  ["无袖或盖肩", "sleeveless or cap sleeve", ""],
  ["横向分层蕾丝", "tiered lace", "lace"],
  ["透视蕾丝拼接", "sheer lace panel", "lace"],
  ["分层裙摆", "tiered skirt", "tiered"],
  ["荷叶边裙摆", "ruffle skirt", "ruffle"],
  ["植物印花", "floral print", "floral"],
  ["小腿中部", "midi", "midi"],
  ["中长款", "midi", "midi"],
  ["及踝", "maxi", "maxi"],
  ["无袖", "sleeveless", ""],
  ["盖肩", "cap sleeve", ""],
  ["船领", "boat neck", ""],
  ["方领", "square neck", ""],
  ["露肩", "off shoulder", ""],
  ["吊带", "spaghetti strap", ""],
  ["收腰", "fitted waist", ""],
  ["A 字", "a line", ""],
  ["A字", "a line", ""],
  ["阔腿", "wide leg", ""],
  ["松紧腰", "elastic waist", ""],
  ["直筒", "straight", ""],
  ["高领", "high neck", ""],
  ["蕾丝", "lace", "lace"],
  ["分层", "tiered", "tiered"],
  ["荷叶边", "ruffle", "ruffle"],
  ["迷你", "mini", "mini"],
  ["长款", "maxi", "maxi"],
  ["修身", "slim fit", ""],
  ["纯色", "solid", ""],
  ["格纹", "plaid", "plaid"],
  ["碎花", "floral", "floral"],
  ["花卉", "floral", "floral"],
  ["连衣裙", "dress", "dress"],
  ["裙子", "dress", "dress"],
  ["咖啡豆", "coffee beans", "coffee"],
  ["咖啡", "coffee", "coffee"],
  ["笔记本电脑", "laptop", "laptop"],
  ["平板电脑", "tablet", "tablet"],
  ["智能手表", "smartwatch", "watch"],
  ["空气炸锅", "air fryer", "air fryer"],
  ["吸尘器", "vacuum cleaner", "vacuum"],
  ["洗衣机", "washing machine", "washer"],
  ["吹风机", "hair dryer", "hair dryer"],
  ["电视机", "television", "television"],
  ["电视", "television", "television"],
  ["冰箱", "refrigerator", "refrigerator"],
  ["手机", "smartphone", "smartphone"],
  ["沙发", "sofa", "sofa"],
  ["床垫", "mattress", "mattress"],
  ["枕头", "pillow", "pillow"],
  ["床单", "bed sheets", "sheets"],
  ["防晒霜", "sunscreen", "sunscreen"],
  ["蛋白粉", "protein powder", "protein powder"],
  ["维生素", "vitamins", "vitamins"],
  ["香水", "perfume", "perfume"],
  ["口红", "lipstick", "lipstick"],
  ["项链", "necklace", "necklace"],
  ["戒指", "ring", "ring"],
  ["手链", "bracelet", "bracelet"],
  ["背包", "backpack", "backpack"],
  ["钱包", "wallet", "wallet"],
  ["手提包", "handbag", "handbag"],
  ["相机镜头", "camera lens", "camera lens"],
  ["相机", "camera", "camera"],
  ["音箱", "speaker", "speaker"],
  ["键盘", "keyboard", "keyboard"],
  ["鼠标", "computer mouse", "mouse"],
  ["显示器", "computer monitor", "monitor"],
  ["充电器", "charger", "charger"],
  ["保护壳", "case", "case"],
  ["男士", "men", "men"],
  ["女士", "women", "women"],
  ["女款", "women", "women"],
  ["男款", "men", "men"],
  ["真皮", "genuine leather", "leather"],
  ["皮质", "leather", ""],
  ["皮革", "leather", ""],
  ["人造皮", "faux leather", ""],
  ["合成革", "synthetic leather", ""],
  ["日常穿", "everyday", ""],
  ["通勤", "office wear", ""],
  ["休闲", "casual", ""],
  ["极简", "minimalist", ""],
  ["黑色", "black", "black"],
  ["白色", "white", "white"],
  ["蓝色", "blue", "blue"],
  ["红色", "red", "red"],
  ["绿色", "green", "green"],
  ["粉色", "pink", "pink"],
  ["银色", "silver", "silver"],
  ["金色", "gold", "gold"],
  ["全新", "new", ""],
  ["英寸", "inch", "inch"],
  ["盎司", "oz", "oz"]
] as const;

const CHINESE_SEARCH_PHRASES = [
  "请帮我搜索", "请帮我找", "帮我搜索", "帮我找", "我想购买", "我要购买", "我想买", "我要买",
  "搜索一下", "查找一下", "搜索", "查找", "最便宜的", "最便宜", "便宜的", "推荐的", "推荐"
] as const;

const RELAXED_ENGLISH_TERMS = new Set([
  "best", "does", "exist", "find", "latest", "not", "official", "product", "recommended", "search", "that"
]);

export function planCatalogQueries(value: string): CatalogQuery[] {
  const primary = normalizeCatalogQuery(translateCatalogQuery(value, false));
  const relaxedTranslation = normalizeCatalogQuery(translateCatalogQuery(value, true));
  const relaxed = relaxCatalogQuery(relaxedTranslation);
  return [
    { kind: "PRIMARY", query: primary },
    ...(relaxed !== "" && relaxed !== primary ? [{ kind: "RELAXED" as const, query: relaxed }] : [])
  ];
}

export function createShopifyGlobalCatalogPort(
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: Dependencies = {}
): ShopifyPort {
  const profileUrl = parseProfileUrl(environment.SHOPIFY_AGENT_PROFILE_URL);
  const timeoutMs = parseTimeout(environment.SHOPIFY_GLOBAL_CATALOG_TIMEOUT_MS);
  const fetchRequest = dependencies.fetch ?? ((input, init) => fetch(input, init));
  const clock = dependencies.clock ?? { now: () => new Date() };
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());

  return {
    async search(input) {
      const startedAt = monotonicNow();
      try {
        const sourceQuery = input.query ?? input.handle?.replaceAll("-", " ") ?? "";
        const plan = planCatalogQueries(sourceQuery);
        let totals = emptyAttemptTotals();
        let latest: ShopifySearchResult | undefined;
        for (const [index, attempt] of plan.entries()) {
          const response = await fetchRequest(SHOPIFY_GLOBAL_CATALOG_ENDPOINT, {
            method: "POST",
            redirect: "error",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify(searchRequest(input, profileUrl, attempt.query)),
            signal: AbortSignal.timeout(remainingTimeoutMs(startedAt, timeoutMs, monotonicNow))
          });
          if (!response.ok) throw new Error("catalog request failed");
          const parsed = CatalogEnvelopeSchema.parse(JSON.parse(await readLimitedText(response)));
          const catalogProducts = parseCatalogProducts(parsed.result.structuredContent.products);
          latest = buildResult(
            catalogProducts.products,
            input.query === undefined ? input : { ...input, query: attempt.query },
            {
              checkedAt: clock.now().toISOString(),
              durationMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
              timeoutMs,
              relaxed: attempt.kind === "RELAXED",
              catalogVersion: parsed.result.structuredContent.ucp.version,
              malformedProductsExcluded: catalogProducts.malformedProductsExcluded
            }
          );
          totals = addAttemptTotals(totals, latest.diagnostics);
          latest = {
            ...latest,
            diagnostics: {
              ...latest.diagnostics,
              apiDurationMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
              queryAttempts: index + 1,
              fallbackQueryUsed: attempt.kind === "RELAXED",
              ...totals
            }
          };
          if (latest.products.length > 0) return latest;
        }
        if (latest === undefined) throw new Error("catalog query plan is empty");
        return latest;
      } catch (error) {
        if (error instanceof z.ZodError) recordCatalogSchemaChange(error);
        throw new Error(error instanceof z.ZodError ? "CATALOG_SCHEMA_CHANGED" : "DATA_SOURCE_UNAVAILABLE", {
          cause: error
        });
      }
    }
  };
}

function remainingTimeoutMs(startedAt: number, timeoutMs: number, now: () => number): number {
  const remaining = timeoutMs - Math.max(0, Math.round(now() - startedAt));
  if (remaining < 1) throw new Error("catalog search deadline exceeded");
  return remaining;
}

function searchRequest(input: ShopifySearchInput, profileUrl: string, query: string) {
  return {
    jsonrpc: "2.0",
    method: "tools/call",
    id: 1,
    params: {
      name: "search_catalog",
      arguments: {
        meta: { "ucp-agent": { profile: profileUrl } },
        catalog: {
          query,
          filters: {
            ships_to: { country: "US" },
            ...(input.includeOutOfStock === true ? {} : { available: true }),
            ...(input.maxItemPriceCents === undefined
              ? {}
              : { price: { max: input.maxItemPriceCents } })
          },
          context: { address_country: "US" }
        }
      }
    }
  };
}

function normalizeCatalogQuery(value: string): string {
  return value.normalize("NFKC").trim().replace(/\bdresses\b/giu, "dress").replace(/\s+/gu, " ");
}

function translateCatalogQuery(value: string, relaxed: boolean): string {
  let translated = value.normalize("NFKC");
  for (const phrase of CHINESE_SEARCH_PHRASES) translated = translated.replaceAll(phrase, " ");
  for (const [source, primary, fallback] of CHINESE_QUERY_REPLACEMENTS) {
    translated = translated.replaceAll(source, ` ${relaxed ? fallback : primary} `);
  }
  return translated.replace(/[，。！？、]/gu, " ");
}

function relaxCatalogQuery(value: string): string {
  const tokens = value.match(/[\p{L}\p{N}._+'-]+/gu) ?? [];
  return tokens.filter((token) => !RELAXED_ENGLISH_TERMS.has(token.toLocaleLowerCase("en-US"))).join(" ");
}

function buildResult(
  products: z.infer<typeof ProductSchema>[],
  input: ShopifySearchInput,
  context: {
    checkedAt: string;
    durationMs: number;
    timeoutMs: number;
    relaxed: boolean;
    catalogVersion: string;
    malformedProductsExcluded: number;
  }
): ShopifySearchResult {
  const unsupportedConditions = products.reduce((count, product) => count + product.variants.filter((variant) =>
    detectCondition([
      product.title,
      variant.title,
      ...(variant.condition ?? []),
      ...(product.options ?? []).flatMap((option) => [option.name, ...option.values.map((value) => value.label)]),
      ...(variant.options ?? []).flatMap((option) => [option.name, option.label])
    ]) === "UNSUPPORTED"
  ).length, 0);
  const raw = products.flatMap((product) => product.variants.flatMap((variant) => {
    const candidate = toCandidate(product, variant, context.checkedAt);
    return candidate === undefined ? [] : [candidate];
  }));
  const availabilityEligible = input.includeOutOfStock === true
    ? raw
    : raw.filter((candidate) => candidate.availability === "IN_STOCK");
  const priceEligible = input.maxItemPriceCents === undefined
    ? availabilityEligible
    : availabilityEligible.filter((candidate) =>
        candidate.itemPrice !== undefined && candidate.itemPrice.amountCents <= input.maxItemPriceCents!
      );
  const classified = input.query === undefined
    ? priceEligible.map((candidate) => ({
        ...candidate,
        matchStatus: "EXACT" as const,
        matchEvidence: ["Shopify catalog identifier exact"]
      }))
    : priceEligible.flatMap((candidate) => {
        const match = classifyShopifyCandidate(input.query ?? "", candidate);
        const catalogIdentityExact = match.status === "DISCOVERY_MATCH" && hasStrongProductIdentifier(input.query ?? "");
        return match.status === "IRRELEVANT" ? [] : [{
          ...candidate,
          matchStatus: context.relaxed
            ? "DISCOVERY_MATCH" as const
            : catalogIdentityExact ? "EXACT" as const : match.status,
          matchEvidence: context.relaxed
            ? [...match.evidence, "bounded relaxed Catalog query", "exact identity not independently verified"]
            : catalogIdentityExact
              ? [...match.evidence, "Shopify Universal Product ID exact"]
              : match.evidence
        }];
      });
  const requested = requestedCondition(input.query);
  const conditionEligible = classified.filter((candidate) => conditionMatches(candidate.condition, requested));
  const riskyMerchantProductsExcluded = conditionEligible.filter((candidate) =>
    candidate.merchantTrust.level === "RISKY"
  ).length;
  const safeMerchantCandidates = conditionEligible.filter((candidate) => candidate.merchantTrust.level !== "RISKY");
  const ranked = rankAndDeduplicate(safeMerchantCandidates);
  const upidGroup = input.comparisonMode === "SAME_PRODUCT" && !context.relaxed
    ? selectUpidGroup(ranked)
    : undefined;
  const sameProduct = upidGroup?.map((candidate) => ({
    ...candidate,
    matchStatus: "EXACT" as const,
    matchEvidence: [...new Set([...candidate.matchEvidence, "Shopify Universal Product ID exact"])]
  }));
  const pool = sameProduct ?? ranked;
  const unverifiedPool = pool.filter((candidate) => candidate.merchantTrust.level === "UNKNOWN");
  const selectionMode = input.selectionMode ?? "MERCHANT_DIVERSE";
  const selected = selectionMode === "LOWEST_PRICE"
    ? pool.slice(0, input.limit)
    : selectDiverseThenFill(pool, input.limit);
  const merchantCount = new Set(raw.map((candidate) => candidate.merchantId)).size;

  return {
    source: "SHOPIFY_GLOBAL_CATALOG",
    coverage: "COMPLETE",
    merchantsQueried: merchantCount,
    merchantsSucceeded: merchantCount,
    ...(input.maxItemPriceCents === undefined ? {} : { maxItemPriceCents: input.maxItemPriceCents }),
    comparison: sameProduct === undefined
      ? {
          status: "DISCOVERY_ONLY",
          evidence: ["no multi-merchant Shopify Universal Product ID group returned"],
          merchantCount: new Set(selected.map((candidate) => candidate.merchantId)).size,
          offerCount: selected.length
        }
      : {
          status: "SAME_PRODUCT",
          identityType: "UPID",
          evidence: ["Shopify Universal Product ID exact"],
          merchantCount: new Set(selected.map((candidate) => candidate.merchantId)).size,
          offerCount: selected.length
        },
    diagnostics: {
      apiDurationMs: context.durationMs,
      cacheStatus: "MISS",
      chromeFallbackEligible: selected.length === 0,
      queryAttempts: 1,
      fallbackQueryUsed: false,
      catalogProductsReturned: products.length,
      catalogVariantsReturned: products.reduce((count, product) => count + product.variants.length, 0),
      malformedCatalogProductsExcluded: context.malformedProductsExcluded,
      catalogZeroResultAttempts: products.length === 0 ? 1 : 0,
      outOfStockProductsExcluded: raw.length - availabilityEligible.length,
      identityProductsExcluded: priceEligible.length - classified.length,
      irrelevantProductsExcluded: priceEligible.length - classified.length + (raw.length - availabilityEligible.length),
      conditionProductsExcluded: unsupportedConditions + classified.length - conditionEligible.length,
      priceProductsExcluded: availabilityEligible.length - priceEligible.length,
      trustedMerchantProductsReturned: selected.filter((candidate) => isTrustedMerchant(candidate.merchantTrust)).length,
      unverifiedMerchantProductsReturned: selected.filter((candidate) => candidate.merchantTrust.level === "UNKNOWN").length,
      unverifiedMerchantProductsExcluded: Math.max(
        0,
        unverifiedPool.length - selected.filter((candidate) => candidate.merchantTrust.level === "UNKNOWN").length
      ),
      riskyMerchantProductsExcluded,
      merchantTrustRegistryVersion: MERCHANT_TRUST_REGISTRY_VERSION,
      merchantsFailed: 0,
      coveragePercent: 100,
      failedMerchantIds: [],
      timedOutMerchantIds: [],
      registryVersion: `shopify-global-${context.catalogVersion}`,
      searchTimeoutMs: context.timeoutMs,
      selectionPolicy: selectionMode === "LOWEST_PRICE"
        ? "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_PRICE"
        : "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE"
    },
    questions: selected.length > 0 && (
      selected.every((candidate) => candidate.matchStatus === "SIMILAR") ||
      (input.comparisonMode === "SAME_PRODUCT" && sameProduct === undefined)
    )
      ? ["Only similar products were found. Provide an exact model, SKU, GTIN, color, size, or capacity."]
      : [],
    products: selected.map(({ catalogProductId: _catalogProductId, ...candidate }) => candidate)
  };
}

type AttemptTotals = Pick<ShopifySearchResult["diagnostics"],
  | "catalogProductsReturned"
  | "catalogVariantsReturned"
  | "catalogZeroResultAttempts"
  | "malformedCatalogProductsExcluded"
  | "outOfStockProductsExcluded"
  | "identityProductsExcluded"
  | "irrelevantProductsExcluded"
  | "conditionProductsExcluded"
  | "priceProductsExcluded"
  | "unverifiedMerchantProductsExcluded"
  | "riskyMerchantProductsExcluded"
>;

function emptyAttemptTotals(): AttemptTotals {
  return {
    catalogProductsReturned: 0,
    catalogVariantsReturned: 0,
    catalogZeroResultAttempts: 0,
    malformedCatalogProductsExcluded: 0,
    outOfStockProductsExcluded: 0,
    identityProductsExcluded: 0,
    irrelevantProductsExcluded: 0,
    conditionProductsExcluded: 0,
    priceProductsExcluded: 0,
    unverifiedMerchantProductsExcluded: 0,
    riskyMerchantProductsExcluded: 0
  };
}

function addAttemptTotals(
  totals: AttemptTotals,
  diagnostics: ShopifySearchResult["diagnostics"]
): AttemptTotals {
  return Object.fromEntries(Object.keys(totals).map((key) => [
    key,
    (totals[key as keyof AttemptTotals] ?? 0) + (diagnostics[key as keyof AttemptTotals] ?? 0)
  ])) as AttemptTotals;
}

function toCandidate(
  product: z.infer<typeof ProductSchema>,
  variant: z.infer<typeof VariantSchema>,
  checkedAt: string
): GlobalCandidate | undefined {
  if (variant.price.currency !== "USD") return undefined;
  const productUrl = canonicalProductUrl(variant.url, variant.seller.url);
  if (productUrl === undefined) return undefined;
  const shopId = variant.seller.id.slice("gid://shopify/Shop/".length);
  const variantId = variant.id.slice("gid://shopify/ProductVariant/".length);
  const condition = detectCondition([
    product.title,
    variant.title,
    ...(variant.condition ?? []),
    ...(product.options ?? []).flatMap((option) => [option.name, ...option.values.map((value) => value.label)]),
    ...(variant.options ?? []).flatMap((option) => [option.name, option.label])
  ]);
  if (condition === "UNSUPPORTED") return undefined;
  const imageUrl = [...(variant.media ?? []), ...(product.media ?? [])]
    .map((entry) => entry.url)
    .find(isAllowedImageUrl);
  const merchantTrust = resolveMerchantTrust(new URL(productUrl).hostname, variant.seller.name);
  const productRating = normalizeProductRating(variant.rating ?? product.rating);
  const productType = categoryText(product.product_type ?? product.productType ?? product.category);
  return {
    catalogProductId: product.id,
    merchantId: `shopify-${shopId}`,
    merchant: variant.seller.name,
    sourceHost: new URL(productUrl).hostname,
    merchantTrust,
    recommendationTier: merchantRecommendationTier(merchantTrust, productRating),
    handle: variantId,
    title: variant.title,
    ...(productType === undefined ? {} : { productType }),
    description: [
      product.title,
      descriptionText(product.description),
      descriptionText(variant.description)
    ].filter((value): value is string => value !== undefined && value !== "").join(" "),
    gtins: [],
    variantDimensions: Object.fromEntries((variant.options ?? []).map((option) => [option.name, option.label])),
    matchStatus: "SIMILAR",
    matchEvidence: [],
    condition,
    ...(imageUrl === undefined ? {} : { imageUrl }),
    itemPrice: { amountCents: variant.price.amount, currency: "USD" },
    availability: variant.availability.available ? "IN_STOCK" : "OUT_OF_STOCK",
    merchantUrl: productUrl,
    checkedAt,
    ...(productRating === undefined ? {} : { productRating })
  };
}

function descriptionText(value: z.infer<typeof DescriptionSchema> | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (value?.plain !== undefined) return value.plain;
  if (value?.markdown !== undefined) return value.markdown;
  return value?.html === undefined ? undefined : stripHtml(value.html);
}

function categoryText(value: z.infer<typeof CategorySchema> | null | undefined): string | undefined {
  return typeof value === "string" ? value : value?.name ?? value?.label ?? value?.fullName;
}

function conditionText(value: z.infer<typeof ConditionValueSchema>): string {
  return typeof value === "string" ? value : value.value ?? value.name ?? value.status!;
}

function decimalDollarsToCents(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 100_000_000) {
    throw new Error("Catalog price is outside supported range");
  }
  return cents;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/gu, " ").replace(/&(?:amp|lt|gt|quot|#39);/gu, " ").replace(/\s+/gu, " ").trim();
}

function recordCatalogSchemaChange(error: z.ZodError): void {
  const issues = error.issues.slice(0, 10).map((issue) => ({ code: issue.code, path: issue.path.join(".") }));
  process.stderr.write(`[findcheap-catalog-schema] ${JSON.stringify({ code: "CATALOG_SCHEMA_CHANGED", issues })}\n`);
}

function parseCatalogProducts(products: unknown[]): {
  products: z.infer<typeof ProductSchema>[];
  malformedProductsExcluded: number;
} {
  const valid: z.infer<typeof ProductSchema>[] = [];
  let malformedProductsExcluded = 0;
  for (const [index, product] of products.entries()) {
    const parsed = ProductSchema.safeParse(product);
    if (parsed.success) {
      valid.push(parsed.data);
      continue;
    }
    malformedProductsExcluded += 1;
    recordCatalogProductSchemaChange(index, parsed.error);
  }
  if (products.length > 0 && valid.length === 0) ProductSchema.parse(products[0]);
  return { products: valid, malformedProductsExcluded };
}

function recordCatalogProductSchemaChange(index: number, error: z.ZodError): void {
  const issues = error.issues.slice(0, 5).map((issue) => ({ code: issue.code, path: issue.path.join(".") }));
  process.stderr.write(`[findcheap-catalog-product-excluded] ${JSON.stringify({ index, issues })}\n`);
}

function normalizeProductRating(
  rating: z.infer<typeof RatingSchema> | null | undefined
): ShopifyProduct["productRating"] {
  if (rating === null || rating === undefined) return undefined;
  const normalized = Math.min(5, Math.max(0, rating.value * 5 / rating.scale_max));
  return {
    value: Math.round(normalized * 100) / 100,
    count: rating.count,
    scaleMax: 5
  };
}

function canonicalProductUrl(value: string, sellerValue: string): string | undefined {
  const url = new URL(value);
  const seller = new URL(sellerValue);
  if (url.hostname !== seller.hostname || !url.pathname.startsWith("/products/")) return undefined;
  url.hash = "";
  return url.href;
}

function isAllowedImageUrl(value: string): boolean {
  const url = new URL(value);
  return url.hostname === "cdn.shopify.com";
}

function detectCondition(values: readonly string[]): ShopifyCondition | "UNSUPPORTED" {
  const text = values.join(" ").normalize("NFKC").toLocaleLowerCase("en-US").replaceAll("_", " ");
  if (/\b(?:defective|damaged|for parts|parts only)\b/u.test(text)) return "UNSUPPORTED";
  if (/\bopen[\s-]*box\b/u.test(text)) return "OPEN_BOX";
  if (/\b(?:refurbished|renewed|reconditioned)\b/u.test(text)) return "REFURBISHED";
  if (/\b(?:used|pre[\s-]*owned|resale|second[\s-]*hand)\b/u.test(text)) return "USED";
  if (/\bnew\b/u.test(text)) return "NEW";
  return "UNKNOWN";
}

function requestedCondition(query: string | undefined): ShopifyCondition | "DEFAULT" {
  const text = (query ?? "").normalize("NFKC").toLocaleLowerCase("en-US");
  if (/\bopen[\s-]*box\b/u.test(text)) return "OPEN_BOX";
  if (/\b(?:refurbished|renewed|reconditioned)\b/u.test(text)) return "REFURBISHED";
  if (/\b(?:used|pre[\s-]*owned|resale|second[\s-]*hand)\b/u.test(text)) return "USED";
  return "DEFAULT";
}

function conditionMatches(condition: ShopifyCondition, requested: ShopifyCondition | "DEFAULT"): boolean {
  return requested === "DEFAULT"
    ? condition === "NEW" || condition === "UNKNOWN"
    : condition === requested;
}

function rankAndDeduplicate(products: GlobalCandidate[]): GlobalCandidate[] {
  const unique = new Map<string, GlobalCandidate>();
  for (const product of products) if (!unique.has(product.merchantUrl)) unique.set(product.merchantUrl, product);
  return [...unique.values()].sort((left, right) =>
    merchantRecommendationRank(merchantRecommendationTier(left.merchantTrust, left.productRating)) -
      merchantRecommendationRank(merchantRecommendationTier(right.merchantTrust, right.productRating))
    || matchRank(left.matchStatus) - matchRank(right.matchStatus)
    || merchantTrustRank(left.merchantTrust.level) - merchantTrustRank(right.merchantTrust.level)
    || (right.productRating?.value ?? 0) - (left.productRating?.value ?? 0)
    || (right.productRating?.count ?? 0) - (left.productRating?.count ?? 0)
    || availabilityRank(left.availability) - availabilityRank(right.availability)
    || (left.itemPrice?.amountCents ?? Number.MAX_SAFE_INTEGER) - (right.itemPrice?.amountCents ?? Number.MAX_SAFE_INTEGER)
    || compareText(left.merchant, right.merchant)
    || compareText(left.merchantUrl, right.merchantUrl));
}

function selectUpidGroup(products: GlobalCandidate[]): GlobalCandidate[] | undefined {
  const groups = new Map<string, GlobalCandidate[]>();
  for (const product of products.filter((candidate) => candidate.matchStatus !== "SIMILAR")) {
    const group = groups.get(product.catalogProductId) ?? [];
    if (!group.some((candidate) => candidate.merchantId === product.merchantId)) group.push(product);
    groups.set(product.catalogProductId, group);
  }
  return [...groups.values()]
    .filter((group) => group.length >= 2)
    .sort((left, right) => right.length - left.length || lowestPrice(left) - lowestPrice(right))[0];
}

function selectDiverseThenFill(products: GlobalCandidate[], limit: number): GlobalCandidate[] {
  const selected: GlobalCandidate[] = [];
  const urls = new Set<string>();
  const merchants = new Set<string>();
  for (const product of products) {
    if (merchants.has(product.merchantId)) continue;
    selected.push(product);
    urls.add(product.merchantUrl);
    merchants.add(product.merchantId);
    if (selected.length === limit) return selected;
  }
  for (const product of products) {
    if (urls.has(product.merchantUrl)) continue;
    selected.push(product);
    if (selected.length === limit) break;
  }
  return selected;
}

async function readLimitedText(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    throw new Error("catalog response is too large");
  }
  if (response.body === null) throw new Error("catalog response body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("catalog response is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function parseProfileUrl(value: string | undefined): string {
  if (value === undefined) throw new Error("SHOPIFY_AGENT_PROFILE_URL is required");
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
      url.port !== "" || url.search !== "" || url.hash !== ""
    ) throw new Error();
    return url.href;
  } catch {
    throw new Error("SHOPIFY_AGENT_PROFILE_URL is invalid");
  }
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) return 10_000;
  if (!/^\d+$/u.test(value)) throw new Error("SHOPIFY_GLOBAL_CATALOG_TIMEOUT_MS is invalid");
  const timeout = Number(value);
  if (timeout < 500 || timeout > 20_000) throw new Error("SHOPIFY_GLOBAL_CATALOG_TIMEOUT_MS is invalid");
  return timeout;
}

function matchRank(value: ShopifyProduct["matchStatus"]): number {
  return value === "EXACT" ? 0 : value === "DISCOVERY_MATCH" ? 1 : 2;
}

function availabilityRank(value: ShopifyProduct["availability"]): number {
  return value === "IN_STOCK" ? 0 : value === "UNKNOWN" ? 1 : 2;
}

function lowestPrice(products: GlobalCandidate[]): number {
  return Math.min(...products.map((product) => product.itemPrice?.amountCents ?? Number.MAX_SAFE_INTEGER));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
