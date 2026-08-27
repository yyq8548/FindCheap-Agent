import { createHash } from "node:crypto";
import { z } from "zod";

const EBAY_SCOPE = "https://api.ebay.com/oauth/api_scope";
const MAX_RESPONSE_BYTES = 1024 * 1024;

const EbayEnvironmentSchema = z.enum(["PRODUCTION", "SANDBOX"]);
type EbayEnvironment = z.infer<typeof EbayEnvironmentSchema>;

const EBAY_ENDPOINTS: Record<EbayEnvironment, { token: string; browse: string }> = {
  PRODUCTION: {
    token: "https://api.ebay.com/identity/v1/oauth2/token",
    browse: "https://api.ebay.com/buy/browse/v1/item_summary/search"
  },
  SANDBOX: {
    token: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
    browse: "https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search"
  }
};

const QuerySchema = z.string().trim().min(2).max(300)
  .regex(/^[\p{L}\p{N}\s._+'-]+$/u)
  .refine((value) => /[\p{L}\p{N}]/u.test(value), "query must contain a letter or number");

const EbaySearchInputSchema = z.object({
  query: QuerySchema,
  limit: z.number().int().min(1).max(24),
  maxItemPriceCents: z.number().int().min(1).max(100_000_000).optional(),
  zipCode: z.string().regex(/^\d{5}(?:-\d{4})?$/u).optional()
}).strict();

const MoneySchema = z.object({
  value: z.string().regex(/^\d+(?:\.\d{1,2})?$/u),
  currency: z.string().length(3)
}).passthrough();

const EbayItemSchema = z.object({
  itemId: z.string().min(1).max(300),
  title: z.string().trim().min(1).max(500),
  price: MoneySchema,
  itemWebUrl: z.string().url().max(4_096),
  itemAffiliateWebUrl: z.string().url().max(4_096).optional(),
  image: z.object({ imageUrl: z.string().url().max(4_096) }).passthrough().optional(),
  seller: z.object({
    username: z.string().trim().min(1).max(128),
    feedbackPercentage: z.string().max(20).optional(),
    feedbackScore: z.number().int().nonnegative().max(2_147_483_647).optional()
  }).passthrough(),
  condition: z.string().trim().min(1).max(120).optional(),
  conditionId: z.string().max(20).optional(),
  categories: z.array(z.object({ categoryName: z.string().trim().min(1).max(300) }).passthrough()).max(20).optional(),
  localizedAspects: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(300)
  }).passthrough()).max(100).optional()
}).passthrough();

const EbayBrowseEnvelopeSchema = z.object({
  total: z.number().int().nonnegative().optional(),
  itemSummaries: z.array(z.unknown()).max(200).optional()
}).passthrough();

const TokenEnvelopeSchema = z.object({
  access_token: z.string().min(1).max(16_384),
  expires_in: z.number().int().min(60).max(86_400)
}).passthrough();

export type EbayBrowseEnvironment = {
  environment: EbayEnvironment;
  clientId: string;
  clientSecret: string;
  campaignId?: string;
  marketplaceId: "EBAY_US";
  timeoutMs: number;
  cacheTtlMs: number;
};

export type EbaySearchInput = z.infer<typeof EbaySearchInputSchema>;

export type EbayProduct = {
  environment: EbayEnvironment;
  itemId: string;
  productRef: string;
  title: string;
  category: string;
  attributes: string[];
  sellerName: string;
  sellerFeedbackPercentage?: number;
  sellerFeedbackScore?: number;
  matchStatus: "DISCOVERY_MATCH";
  matchEvidence: string[];
  condition: "NEW" | "USED" | "REFURBISHED" | "OPEN_BOX" | "UNKNOWN";
  imageUrl?: string;
  itemPrice: { amountCents: number; currency: "USD" };
  availability: "UNKNOWN";
  merchantUrl: string;
  affiliateUrl?: string;
  checkedAt: string;
};

export type EbaySearchResult = {
  source: "EBAY_BROWSE";
  environment: EbayEnvironment;
  coverage: "COMPLETE";
  snapshotAt: string;
  diagnostics: {
    queryMatches: number;
    itemsReturned: number;
    validItems: number;
    rejectedItems: number;
  };
  products: EbayProduct[];
};

export type EbayBrowseController = {
  search(input: EbaySearchInput): Promise<EbaySearchResult>;
};

export function parseEbayBrowseEnvironment(
  input: Readonly<Record<string, string | undefined>>
): EbayBrowseEnvironment | undefined {
  const enabled = input.EBAY_BROWSE_ENABLED?.trim().toLocaleLowerCase("en-US") ?? "false";
  if (enabled !== "true" && enabled !== "false") {
    throw new Error("EBAY_BROWSE_ENABLED must be true or false");
  }
  if (enabled === "false") return undefined;
  const environment = EbayEnvironmentSchema.parse(
    input.EBAY_ENVIRONMENT?.trim().toLocaleUpperCase("en-US") || "PRODUCTION"
  );
  const clientId = boundedSecret(input.EBAY_CLIENT_ID, "EBAY_CLIENT_ID", 8, 512);
  const clientSecret = boundedSecret(input.EBAY_CLIENT_SECRET, "EBAY_CLIENT_SECRET", 8, 4_096);
  const campaignId = input.EBAY_EPN_CAMPAIGN_ID?.trim();
  if (environment === "PRODUCTION" && (campaignId === undefined || !/^\d{1,20}$/u.test(campaignId))) {
    throw new Error("EBAY_EPN_CAMPAIGN_ID must be numeric");
  }
  if (campaignId !== undefined && !/^\d{1,20}$/u.test(campaignId)) {
    throw new Error("EBAY_EPN_CAMPAIGN_ID must be numeric");
  }
  const marketplaceId = input.EBAY_MARKETPLACE_ID?.trim() || "EBAY_US";
  if (marketplaceId !== "EBAY_US") throw new Error("v0.10.4 supports only EBAY_US");
  return {
    environment,
    clientId,
    clientSecret,
    ...(campaignId === undefined ? {} : { campaignId }),
    marketplaceId,
    timeoutMs: integerInRange(input.EBAY_BROWSE_TIMEOUT_MS ?? "5000", 1_000, 10_000, "EBAY_BROWSE_TIMEOUT_MS"),
    cacheTtlMs: integerInRange(input.EBAY_BROWSE_CACHE_SECONDS ?? "60", 15, 300, "EBAY_BROWSE_CACHE_SECONDS") * 1_000
  };
}

export function parseEbaySearchInput(value: unknown): EbaySearchInput {
  return EbaySearchInputSchema.parse(value);
}

export function createEbayBrowseController(
  environment: EbayBrowseEnvironment,
  dependencies: { fetch?: typeof fetch; now?: () => Date } = {}
): EbayBrowseController {
  const fetchRequest = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  let token: { value: string; expiresAt: number } | undefined;
  let activeTokenRequest: Promise<string> | undefined;
  const cache = new Map<string, { expiresAt: number; result: EbaySearchResult }>();
  const activeSearches = new Map<string, Promise<EbaySearchResult>>();

  const applicationToken = async (): Promise<string> => {
    const currentTime = validDate(now()).getTime();
    if (token !== undefined && token.expiresAt > currentTime) return token.value;
    activeTokenRequest ??= fetchApplicationToken(environment, fetchRequest, now).then((fresh) => {
      token = fresh;
      return fresh.value;
    }).finally(() => {
      activeTokenRequest = undefined;
    });
    return activeTokenRequest;
  };

  return {
    async search(rawInput) {
      const input = parseEbaySearchInput(rawInput);
      const key = JSON.stringify(input);
      const currentTime = validDate(now()).getTime();
      const cached = cache.get(key);
      if (cached !== undefined && cached.expiresAt > currentTime) return cached.result;
      let active = activeSearches.get(key);
      if (active === undefined) {
        active = runSearch(input, environment, await applicationToken(), fetchRequest, now)
          .then((result) => {
            cache.set(key, { expiresAt: validDate(now()).getTime() + environment.cacheTtlMs, result });
            while (cache.size > 500) cache.delete(cache.keys().next().value as string);
            return result;
          })
          .finally(() => activeSearches.delete(key));
        activeSearches.set(key, active);
      }
      return active;
    }
  };
}

async function fetchApplicationToken(
  environment: EbayBrowseEnvironment,
  fetchRequest: typeof fetch,
  now: () => Date
): Promise<{ value: string; expiresAt: number }> {
  const response = await fetchRequest(EBAY_ENDPOINTS[environment.environment].token, {
    method: "POST",
    redirect: "error",
    headers: {
      accept: "application/json",
      authorization: `Basic ${Buffer.from(`${environment.clientId}:${environment.clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: EBAY_SCOPE }).toString(),
    signal: AbortSignal.timeout(environment.timeoutMs)
  });
  if (!response.ok) throw new Error(`eBay OAuth returned HTTP ${response.status}`);
  const envelope = TokenEnvelopeSchema.parse(await responseJson(response, 64 * 1024, "eBay OAuth"));
  return {
    value: envelope.access_token,
    expiresAt: validDate(now()).getTime() + Math.max(1, envelope.expires_in - 60) * 1_000
  };
}

async function runSearch(
  input: EbaySearchInput,
  environment: EbayBrowseEnvironment,
  token: string,
  fetchRequest: typeof fetch,
  now: () => Date
): Promise<EbaySearchResult> {
  const endpoint = new URL(EBAY_ENDPOINTS[environment.environment].browse);
  endpoint.searchParams.set("q", input.query);
  endpoint.searchParams.set("limit", String(input.limit));
  const filters = ["buyingOptions:{FIXED_PRICE}", "deliveryCountry:US"];
  if (input.maxItemPriceCents !== undefined) {
    filters.push(`price:[..${(input.maxItemPriceCents / 100).toFixed(2)}]`, "priceCurrency:USD");
  }
  if (input.zipCode !== undefined) filters.push(`deliveryPostalCode:${input.zipCode}`);
  endpoint.searchParams.set("filter", filters.join(","));
  const endUserContext = [
    ...(environment.environment === "PRODUCTION" && environment.campaignId !== undefined
      ? [`affiliateCampaignId=${environment.campaignId}`]
      : []),
    ...(input.zipCode === undefined
      ? []
      : [`contextualLocation=${encodeURIComponent(`country=US,zip=${input.zipCode}`)}`])
  ].join(",");
  const response = await fetchRequest(endpoint, {
    method: "GET",
    redirect: "error",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(endUserContext === "" ? {} : { "x-ebay-c-enduserctx": endUserContext }),
      "x-ebay-c-marketplace-id": environment.marketplaceId
    },
    signal: AbortSignal.timeout(environment.timeoutMs)
  });
  if (!response.ok) throw new Error(`eBay Browse returned HTTP ${response.status}`);
  const envelope = EbayBrowseEnvelopeSchema.parse(await responseJson(response, MAX_RESPONSE_BYTES, "eBay Browse"));
  const checkedAt = validDate(now()).toISOString();
  const products: EbayProduct[] = [];
  let rejectedItems = 0;
  for (const raw of envelope.itemSummaries ?? []) {
    const parsed = EbayItemSchema.safeParse(raw);
    if (!parsed.success) {
      rejectedItems += 1;
      continue;
    }
    try {
      products.push(normalizeItem(parsed.data, environment, checkedAt));
    } catch {
      rejectedItems += 1;
    }
  }
  return {
    source: "EBAY_BROWSE",
    environment: environment.environment,
    coverage: "COMPLETE",
    snapshotAt: checkedAt,
    diagnostics: {
      queryMatches: envelope.total ?? products.length,
      itemsReturned: (envelope.itemSummaries ?? []).length,
      validItems: products.length,
      rejectedItems
    },
    products
  };
}

function normalizeItem(
  item: z.infer<typeof EbayItemSchema>,
  environment: EbayBrowseEnvironment,
  checkedAt: string
): EbayProduct {
  if (item.price.currency !== "USD") throw new Error("eBay item currency is unsupported");
  const merchantUrl = ebayItemUrl(item.itemWebUrl, environment.environment);
  const affiliateUrl = environment.environment === "SANDBOX" || item.itemAffiliateWebUrl === undefined || environment.campaignId === undefined
    ? undefined
    : ebayAffiliateUrl(item.itemAffiliateWebUrl, environment.campaignId);
  const imageUrl = item.image === undefined ? undefined : ebayImageUrl(item.image.imageUrl);
  const attributes = (item.localizedAspects ?? []).map(({ name, value }) => `${name}: ${value}`);
  const category = item.categories?.[0]?.categoryName ?? "eBay marketplace listing";
  const feedbackPercentage = parsePercentage(item.seller.feedbackPercentage);
  return {
    environment: environment.environment,
    itemId: item.itemId,
    productRef: `ebay-${createHash("sha256").update(item.itemId).digest("hex").slice(0, 32)}`,
    title: item.title,
    category,
    attributes,
    sellerName: item.seller.username,
    ...(feedbackPercentage === undefined ? {} : { sellerFeedbackPercentage: feedbackPercentage }),
    ...(item.seller.feedbackScore === undefined ? {} : { sellerFeedbackScore: item.seller.feedbackScore }),
    matchStatus: "DISCOVERY_MATCH",
    matchEvidence: [environment.environment === "SANDBOX"
      ? "eBay Sandbox fixed-price listing returned by Browse API"
      : "live eBay fixed-price listing returned by Browse API"],
    condition: normalizeCondition(item.condition),
    ...(imageUrl === undefined ? {} : { imageUrl }),
    itemPrice: { amountCents: decimalDollarsToCents(item.price.value), currency: "USD" },
    availability: "UNKNOWN",
    merchantUrl,
    ...(affiliateUrl === undefined ? {} : { affiliateUrl }),
    checkedAt
  };
}

function normalizeCondition(value: string | undefined): EbayProduct["condition"] {
  const normalized = value?.normalize("NFKC").toLocaleLowerCase("en-US") ?? "";
  if (/open[\s-]*box/u.test(normalized)) return "OPEN_BOX";
  if (/refurbished|renewed|reconditioned|remanufactured/u.test(normalized)) return "REFURBISHED";
  if (/used|pre[\s-]*owned|acceptable|very good|excellent/u.test(normalized)) return "USED";
  if (/\bnew\b|brand[\s-]*new|new with defects/u.test(normalized)) return "NEW";
  return "UNKNOWN";
}

function ebayItemUrl(value: string, environment: EbayEnvironment): string {
  const url = safeUrl(value);
  const hosts = environment === "PRODUCTION"
    ? ["www.ebay.com", "ebay.com"]
    : ["www.sandbox.ebay.com", "sandbox.ebay.com"];
  if (!hosts.includes(url.hostname)) {
    throw new Error("eBay item URL host is invalid");
  }
  url.hash = "";
  return url.href;
}

function ebayAffiliateUrl(value: string, campaignId: string): string {
  const url = new URL(ebayItemUrl(value, "PRODUCTION"));
  if (url.searchParams.get("campid") !== campaignId) {
    throw new Error("eBay affiliate URL campaign is invalid");
  }
  return url.href;
}

function ebayImageUrl(value: string): string {
  const url = safeUrl(value);
  if (url.hostname !== "i.ebayimg.com") throw new Error("eBay image URL host is invalid");
  return url.href;
}

function safeUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
    throw new Error("eBay URL is invalid");
  }
  return url;
}

function parsePercentage(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{1,3}(?:\.\d{1,2})?$/u.test(value)) return undefined;
  const parsed = Number(value);
  return parsed >= 0 && parsed <= 100 ? parsed : undefined;
}

function decimalDollarsToCents(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100_000_000) {
    throw new Error("eBay item price is invalid");
  }
  return cents;
}

async function responseJson(response: Response, limit: number, name: string): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new Error(`${name} returned unsupported content type`);
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > limit)) {
    throw new Error(`${name} response is too large`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new Error(`${name} response is too large`);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${name} returned invalid JSON`);
  }
}

function boundedSecret(value: string | undefined, name: string, minimum: number, maximum: number): string {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length < minimum || normalized.length > maximum) {
    throw new Error(`${name} must contain ${minimum} through ${maximum} characters`);
  }
  return normalized;
}

function integerInRange(value: string, minimum: number, maximum: number, name: string): number {
  if (!/^\d+$/u.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new Error("invalid eBay service clock");
  return value;
}
