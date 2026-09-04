import { z } from "zod";
import { assessSelectedProductDeal } from "./deal-assessment.js";

export const DealKindSchema = z.enum([
  "COUPON",
  "PROMO_CODE",
  "BRAND_PROMOTION",
  "MEMBERSHIP",
  "CASHBACK",
  "OFFLINE_BARCODE"
]);

export const DealApplicabilitySchema = z.enum([
  "PRODUCT_CONFIRMED",
  "MERCHANT_WIDE",
  "UNKNOWN"
]);

export const VerifiedDealSchema = z.object({
  dealId: z.string().trim().min(1).max(160),
  merchant: z.string().trim().min(1).max(160),
  kind: DealKindSchema,
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(1_000),
  code: z.string().trim().min(1).max(120).optional(),
  barcodeUrl: z.string().url().startsWith("https://").max(4_096).optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  discountAmountCents: z.number().int().positive().max(100_000_000).optional(),
  cashbackPercent: z.number().min(0).max(100).optional(),
  membershipProgram: z.string().trim().min(1).max(160).optional(),
  productApplicability: DealApplicabilitySchema.optional(),
  applicableProductIds: z.array(z.string().trim().min(1).max(300)).min(1).max(100).optional(),
  eligibility: z.array(z.string().trim().min(1).max(300)).max(30),
  channels: z.array(z.enum(["ONLINE", "IN_STORE"])).min(1).max(2),
  sourceUrl: z.string().url().startsWith("https://").max(4_096),
  checkedAt: z.string().datetime({ offset: true }),
  validFrom: z.string().datetime({ offset: true }),
  validTo: z.string().datetime({ offset: true }),
  verificationStatus: z.literal("VERIFIED")
}).strict().superRefine((deal, context) => {
  if (Date.parse(deal.validTo) <= Date.parse(deal.validFrom)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "validTo must be after validFrom" });
  }
  if (deal.kind === "PROMO_CODE" && deal.code === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "PROMO_CODE requires code" });
  }
  if (deal.kind === "OFFLINE_BARCODE" && deal.barcodeUrl === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "OFFLINE_BARCODE requires barcodeUrl" });
  }
  if (deal.kind === "CASHBACK" && deal.cashbackPercent === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "CASHBACK requires cashbackPercent" });
  }
  if (deal.productApplicability === "PRODUCT_CONFIRMED" && deal.applicableProductIds === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "PRODUCT_CONFIRMED requires applicableProductIds" });
  }
});

export type VerifiedDeal = z.infer<typeof VerifiedDealSchema>;

export function dealAppliesToProduct(deal: VerifiedDeal, productId: string): boolean {
  return deal.productApplicability !== "PRODUCT_CONFIRMED" ||
    deal.applicableProductIds?.includes(productId) === true;
}

export function dealApplicabilityRank(deal: VerifiedDeal, productId: string): number {
  if (!dealAppliesToProduct(deal, productId)) return -1;
  return deal.productApplicability === "PRODUCT_CONFIRMED"
    ? 2
    : deal.productApplicability === "MERCHANT_WIDE" ? 1 : 0;
}

export function estimatedItemPriceAfterCoupon(
  itemPriceCents: number,
  deals: readonly VerifiedDeal[],
  productId: string
): number | undefined {
  const estimates = deals.flatMap((deal) => {
    if (
      deal.productApplicability !== "PRODUCT_CONFIRMED" ||
      !dealAppliesToProduct(deal, productId) ||
      deal.eligibility.length > 0 ||
      assessSelectedProductDeal(deal, { merchantProductId: productId, itemPrice: { amountCents: itemPriceCents, currency: "USD" } }).status !== "CONFIRMED"
    ) return [];
    const hasPercentDiscount = deal.discountPercent !== undefined;
    const hasFixedDiscount = deal.discountAmountCents !== undefined;
    if (hasPercentDiscount === hasFixedDiscount) return [];
    const savings = deal.discountPercent !== undefined
      ? Math.floor(itemPriceCents * deal.discountPercent / 100)
      : deal.discountAmountCents ?? 0;
    return savings <= 0 ? [] : [Math.max(0, itemPriceCents - savings)];
  });
  return estimates.length === 0 ? undefined : Math.min(...estimates);
}

export const DealSearchInputSchema = z.object({
  merchant: z.string().trim().min(2).max(160),
  productQuery: z.string().trim().min(2).max(300).optional(),
  membershipIds: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  channel: z.enum(["ONLINE", "IN_STORE", "ANY"]).default("ANY")
}).strict();

export type DealSearchInput = z.infer<typeof DealSearchInputSchema>;

export const VerifiedDealsSchema = z.array(VerifiedDealSchema).max(200);

export const DealLookupStatusSchema = z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]);
export const DealLookupReasonSchema = z.enum([
  "TIMEOUT", "RATE_LIMITED", "UPSTREAM_UNAVAILABLE", "INVALID_RESPONSE", "STALE_EVIDENCE", "NOT_CONFIGURED"
]);
export const DealLookupResultSchema = z.object({
  status: DealLookupStatusSchema,
  reasonCodes: z.array(DealLookupReasonSchema).max(6),
  deals: VerifiedDealsSchema
}).strict();
export type DealLookupResult = z.infer<typeof DealLookupResultSchema>;
export type DealLookupReason = z.infer<typeof DealLookupReasonSchema>;

export interface DealPort {
  search(input: DealSearchInput): Promise<VerifiedDeal[]>;
  searchWithStatus?(input: DealSearchInput): Promise<DealLookupResult>;
}

export function createUnavailableDealPort(): DealPort {
  return {
    search: async () => { throw new Error("DATA_SOURCE_UNAVAILABLE"); },
    searchWithStatus: async () => unavailableDeals("NOT_CONFIGURED")
  };
}

const ProviderResponseSchema = z.object({ deals: z.array(z.unknown()).max(200) }).strict();

export async function searchDealsWithStatus(port: DealPort, input: DealSearchInput): Promise<DealLookupResult> {
  try {
    if (port.searchWithStatus !== undefined) return DealLookupResultSchema.parse(await port.searchWithStatus(input));
    return validateDealRecords(await port.search(input));
  } catch (error) {
    return unavailableDeals(error instanceof z.ZodError ? "INVALID_RESPONSE" : sourceFailureReason(error));
  }
}

function validateDealRecords(value: unknown): DealLookupResult {
  const records = z.array(z.unknown()).max(200).safeParse(value);
  if (!records.success) return unavailableDeals("INVALID_RESPONSE");
  const deals: VerifiedDeal[] = [];
  for (const record of records.data) {
    const parsed = VerifiedDealSchema.safeParse(record);
    if (parsed.success) deals.push(parsed.data);
  }
  if (deals.length === records.data.length) return { status: "COMPLETE", reasonCodes: [], deals };
  return { status: deals.length === 0 ? "UNAVAILABLE" : "PARTIAL", reasonCodes: ["INVALID_RESPONSE"], deals };
}

function unavailableDeals(reason: DealLookupReason): DealLookupResult {
  return { status: "UNAVAILABLE", reasonCodes: [reason], deals: [] };
}

function sourceFailureReason(error: unknown): DealLookupReason {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
    ? "TIMEOUT" : "UPSTREAM_UNAVAILABLE";
}

export function createDealPortFromEnvironment(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date()
): DealPort {
  const configuration = dealProviderConfiguration(environment);
  if (configuration === undefined) return createUnavailableDealPort();
  const { endpoint, token } = configuration;

  const searchWithStatus = async (input: DealSearchInput): Promise<DealLookupResult> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const response = await fetcher(endpoint, {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
            "content-type": "application/json",
            accept: "application/json"
          },
          body: JSON.stringify(DealSearchInputSchema.parse(input))
        });
        if (!response.ok) return unavailableDeals(response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_UNAVAILABLE");
        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > 524_288) return unavailableDeals("INVALID_RESPONSE");
        if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
          return unavailableDeals("INVALID_RESPONSE");
        }
        const text = await readBoundedText(response, 524_288);
        const parsed = ProviderResponseSchema.safeParse(JSON.parse(text));
        if (!parsed.success) return unavailableDeals("INVALID_RESPONSE");
        const result = validateDealRecords(parsed.data.deals);
        const timestamp = now().getTime();
        return { ...result, deals: result.deals.filter((deal) => {
          const channelsMatch = input.channel === "ANY" || deal.channels.includes(input.channel);
          return channelsMatch && Date.parse(deal.validFrom) <= timestamp && Date.parse(deal.validTo) > timestamp;
        }) };
      } catch (error) {
        return unavailableDeals(error instanceof SyntaxError ? "INVALID_RESPONSE" : sourceFailureReason(error));
      } finally {
        clearTimeout(timeout);
      }
  };
  return {
    searchWithStatus,
    async search(input) {
      const result = await searchWithStatus(input);
      if (result.status !== "COMPLETE") throw new Error("DATA_SOURCE_UNAVAILABLE");
      return result.deals;
    }
  };
}

export function hasDealProviderConfiguration(
  environment: Readonly<Record<string, string | undefined>>
): boolean {
  return dealProviderConfiguration(environment) !== undefined;
}

function dealProviderConfiguration(
  environment: Readonly<Record<string, string | undefined>>
): { endpoint: URL; token?: string } | undefined {
  const rawUrl = environment.FINDCHEAP_DEALS_API_URL?.trim();
  const token = environment.FINDCHEAP_DEALS_API_TOKEN?.trim();
  if (rawUrl === undefined || rawUrl === "" || token === undefined || token === "") {
    return publicAwinOffersConfiguration(environment);
  }
  try {
    const endpoint = new URL(rawUrl);
    if (endpoint.protocol !== "https:" || endpoint.username !== "" || endpoint.password !== "" || endpoint.hash !== "") {
      return undefined;
    }
    return { endpoint, token };
  } catch {
    return undefined;
  }
}

function publicAwinOffersConfiguration(
  environment: Readonly<Record<string, string | undefined>>
): { endpoint: URL } | undefined {
  const rawUrl = environment.AWIN_OFFERS_SEARCH_URL?.trim();
  if (rawUrl === undefined || rawUrl === "") return undefined;
  try {
    const endpoint = new URL(rawUrl);
    if (
      endpoint.protocol !== "https:" || endpoint.username !== "" || endpoint.password !== "" ||
      endpoint.port !== "" || endpoint.search !== "" || endpoint.hash !== "" ||
      endpoint.pathname !== "/v1/offers/search"
    ) return undefined;
    return { endpoint };
  } catch {
    return undefined;
  }
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error("DATA_SOURCE_UNAVAILABLE");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, total).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}
