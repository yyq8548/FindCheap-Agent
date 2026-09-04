import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

const AWIN_PROMOTIONS_ENDPOINT = "https://api.awin.com/publisher";
const PAGE_SIZE = 200;
const MAX_PAGES = 100;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const AwinPromotionSchema = z.object({
  promotionId: z.union([z.string(), z.number()]).transform(String),
  type: z.enum(["promotion", "voucher"]),
  advertiser: z.object({
    id: z.union([z.string(), z.number()]).transform(String),
    name: z.string().trim().min(1).max(300),
    joined: z.boolean()
  }).passthrough(),
  title: z.string().trim().min(1).max(1_000),
  description: z.string().max(10_000).nullish(),
  terms: z.string().max(10_000).nullish(),
  startDate: z.string(),
  endDate: z.string(),
  urlTracking: z.string(),
  regions: z.object({
    all: z.boolean().optional(),
    list: z.array(z.object({ countryCode: z.string().optional() }).passthrough()).optional()
  }).passthrough().optional(),
  voucher: z.object({
    code: z.string().trim().min(1).max(120),
    exclusive: z.boolean().optional(),
    attributable: z.boolean().optional()
  }).passthrough().optional()
}).passthrough();

const VerifiedOfferSchema = z.object({
  dealId: z.string().trim().min(1).max(160),
  merchant: z.string().trim().min(1).max(160),
  kind: z.enum(["PROMO_CODE", "BRAND_PROMOTION"]),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(1_000),
  code: z.string().trim().min(1).max(120).optional(),
  productApplicability: z.literal("MERCHANT_WIDE").optional(),
  eligibility: z.array(z.string().trim().min(1).max(300)).max(30),
  channels: z.tuple([z.literal("ONLINE")]),
  sourceUrl: z.string().url().startsWith("https://").max(4_096),
  checkedAt: z.string().datetime({ offset: true }),
  validFrom: z.string().datetime({ offset: true }),
  validTo: z.string().datetime({ offset: true }),
  verificationStatus: z.literal("VERIFIED")
}).strict();

const CacheSchema = z.object({
  snapshotAt: z.string().datetime({ offset: true }),
  deals: z.array(VerifiedOfferSchema).max(20_000)
}).strict();

const SearchInputSchema = z.object({
  merchant: z.string().trim().min(2).max(160),
  productQuery: z.string().trim().min(2).max(300).optional(),
  membershipIds: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  channel: z.enum(["ONLINE", "IN_STORE", "ANY"]).default("ANY")
}).strict();

export type VerifiedAwinOffer = z.infer<typeof VerifiedOfferSchema>;
export type AwinOfferSearchInput = z.infer<typeof SearchInputSchema>;

export type AwinOffersEnvironment = {
  apiToken: string;
  publisherId: string;
  dataPath: string;
  refreshIntervalMs: number;
  sourceTimeoutMs: number;
};

type OffersState = {
  deals?: VerifiedAwinOffer[];
  snapshotAt?: string;
  lastRefreshAt?: string;
  lastErrorAt?: string;
  lastErrorCode?: "SOURCE_REQUEST_FAILED" | "SOURCE_HTTP_ERROR" | "SOURCE_READ_FAILED" | "OFFERS_INVALID" | "STORAGE_WRITE_FAILED";
};

export type AwinOffersController = {
  loadExisting(): Promise<void>;
  refresh(): Promise<void>;
  getState(): Readonly<OffersState>;
  search(input: AwinOfferSearchInput): { deals: VerifiedAwinOffer[] } | undefined;
};

export function parseAwinOfferSearchInput(input: unknown): AwinOfferSearchInput {
  return SearchInputSchema.parse(input);
}

export function createAwinOffersController(
  environment: AwinOffersEnvironment,
  dependencies: { fetch?: typeof fetch; now?: () => Date } = {}
): AwinOffersController {
  const fetchRequest = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const state: OffersState = {};
  let activeRefresh: Promise<void> | undefined;

  const loadExisting = async (): Promise<void> => {
    try {
      const cache = CacheSchema.parse(JSON.parse(await readFile(environment.dataPath, "utf8")));
      state.deals = cache.deals;
      state.snapshotAt = cache.snapshotAt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };

  const runRefresh = async (): Promise<void> => {
    let failureCode: NonNullable<OffersState["lastErrorCode"]> = "SOURCE_REQUEST_FAILED";
    try {
      const checkedAt = validDate(now()).toISOString();
      const collected: unknown[] = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const endpoint = new URL(`${AWIN_PROMOTIONS_ENDPOINT}/${environment.publisherId}/promotions`);
        endpoint.searchParams.set("accessToken", environment.apiToken);
        const response = await fetchRequest(endpoint, {
          method: "POST",
          redirect: "error",
          headers: {
            authorization: `Bearer ${environment.apiToken}`,
            accept: "application/json",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            filters: { membership: "joined", regionCodes: ["US"], status: "active", type: "all" },
            pagination: { page, pageSize: PAGE_SIZE }
          }),
          signal: AbortSignal.timeout(environment.sourceTimeoutMs)
        });
        if (!response.ok) {
          failureCode = "SOURCE_HTTP_ERROR";
          throw new Error(`Awin Promotions API returned HTTP ${response.status}`);
        }
        failureCode = "SOURCE_READ_FAILED";
        const items = extractPromotionItems(JSON.parse(await readBoundedText(response)));
        collected.push(...items);
        if (items.length < PAGE_SIZE) break;
        if (page === MAX_PAGES) throw new Error("Awin Promotions API exceeded the pagination limit");
      }
      failureCode = "OFFERS_INVALID";
      const deals = collected.flatMap((item) => {
        const parsed = AwinPromotionSchema.safeParse(item);
        if (!parsed.success || !parsed.data.advertiser.joined) return [];
        const normalized = normalizePromotion(parsed.data, checkedAt);
        return normalized === undefined ? [] : [normalized];
      });
      const uniqueDeals = [...new Map(deals.map((deal) => [deal.dealId, deal])).values()];
      if (uniqueDeals.length > 20_000) throw new Error("Awin Promotions API returned too many active offers");
      const cache = CacheSchema.parse({ snapshotAt: checkedAt, deals: uniqueDeals });
      failureCode = "STORAGE_WRITE_FAILED";
      await writeJsonAtomically(environment.dataPath, cache);
      state.deals = cache.deals;
      state.snapshotAt = cache.snapshotAt;
      state.lastRefreshAt = checkedAt;
      delete state.lastErrorAt;
      delete state.lastErrorCode;
    } catch (error) {
      state.lastErrorAt = validDate(now()).toISOString();
      state.lastErrorCode = failureCode;
      throw error;
    }
  };

  return {
    loadExisting,
    refresh() {
      activeRefresh ??= runRefresh().finally(() => {
        activeRefresh = undefined;
      });
      return activeRefresh;
    },
    getState: () => state,
    search(input) {
      if (state.deals === undefined) return undefined;
      const parsed = SearchInputSchema.parse(input);
      if (parsed.channel === "IN_STORE") return { deals: [] };
      const merchant = canonicalText(parsed.merchant);
      const productQuery = parsed.productQuery === undefined ? undefined : canonicalText(parsed.productQuery);
      const merchantDeals = state.deals.filter((deal) => canonicalText(deal.merchant) === merchant);
      if (productQuery !== undefined) merchantDeals.sort((left, right) =>
        Number(canonicalText(`${right.title} ${right.description}`).includes(productQuery)) -
        Number(canonicalText(`${left.title} ${left.description}`).includes(productQuery))
      );
      return {
        deals: merchantDeals.slice(0, 200)
      };
    }
  };
}

function extractPromotionItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || typeof value !== "object") throw new Error("Awin Promotions API returned invalid JSON");
  const record = value as Record<string, unknown>;
  for (const key of ["data", "promotions", "offers", "results"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate;
    if (candidate !== null && typeof candidate === "object") {
      for (const nestedKey of ["promotions", "offers", "results", "items"]) {
        const nested = (candidate as Record<string, unknown>)[nestedKey];
        if (Array.isArray(nested)) return nested;
      }
    }
  }
  throw new Error("Awin Promotions API response does not contain an offer list");
}

function normalizePromotion(
  promotion: z.infer<typeof AwinPromotionSchema>,
  checkedAt: string
): VerifiedAwinOffer | undefined {
  const validFrom = normalizeDate(promotion.startDate);
  const validTo = normalizeDate(promotion.endDate);
  if (validFrom === undefined || validTo === undefined || Date.parse(validTo) <= Date.parse(validFrom)) return undefined;
  const sourceUrl = validTrackingUrl(promotion.urlTracking);
  if (sourceUrl === undefined) return undefined;
  if (promotion.regions?.all !== true && promotion.regions?.list !== undefined &&
      !promotion.regions.list.some((region) => region.countryCode?.toUpperCase() === "US")) return undefined;
  const description = cleanText(promotion.description ?? promotion.title, 1_000);
  if (description === "") return undefined;
  const terms = cleanText(promotion.terms ?? "", 300);
  const base = {
    dealId: `awin:${promotion.promotionId}`,
    merchant: cleanText(promotion.advertiser.name, 160),
    title: cleanText(promotion.title, 300),
    description,
    productApplicability: "MERCHANT_WIDE" as const,
    eligibility: terms === "" ? [] : [terms],
    channels: ["ONLINE"] as const,
    sourceUrl,
    checkedAt,
    validFrom,
    validTo,
    verificationStatus: "VERIFIED" as const
  };
  if (base.merchant === "" || base.title === "") return undefined;
  return VerifiedOfferSchema.parse(promotion.type === "voucher" && promotion.voucher !== undefined
    ? { ...base, kind: "PROMO_CODE", code: promotion.voucher.code }
    : { ...base, kind: "BRAND_PROMOTION" });
}

function validTrackingUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return undefined;
    const host = url.hostname.toLowerCase();
    if (host !== "awin1.com" && !host.endsWith(".awin1.com") && host !== "tidd.ly") return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function normalizeDate(value: string): string | undefined {
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(value) ? `${value}Z` : value;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function cleanText(value: string, maximumLength: number): string {
  return value.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maximumLength).trim();
}

function canonicalText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

async function readBoundedText(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) throw new Error("Awin Promotions API did not return JSON");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("Awin Promotions API response is too large");
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Awin Promotions API response is too large");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, total).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new Error("invalid Offers service clock");
  return value;
}
