import { z } from "zod";
import { VerifiedDealsSchema, type DealPort, type VerifiedDeal } from "./deal-client.js";
import type { ShopifyProduct } from "./shopify-client.js";
import type { ShopifyCartEstimate, ShopifyCartQuotePort } from "./shopify-cart-quote.js";

export const PriceHistoryObservationSchema = z.object({
  amountCents: z.number().int().positive().max(100_000_000),
  currency: z.literal("USD"),
  basis: z.enum(["ITEM_PRICE", "DELIVERED_TOTAL"]),
  observedAt: z.string().datetime({ offset: true })
}).strict();

export type PriceHistoryObservation = z.infer<typeof PriceHistoryObservationSchema>;

export interface PriceHistoryPort {
  observe(input: {
    merchantId: string;
    merchantProductId: string;
    basis: "ITEM_PRICE" | "DELIVERED_TOTAL";
    amountCents: number;
    currency: "USD";
    sourceKind: "AWIN_PRODUCT_FEED" | "SHOPIFY_GLOBAL_CATALOG" | "EBAY_BROWSE" | "SHOPIFY_CART_ESTIMATE";
    observedAt: string;
    zipCode?: string;
    membershipIds: string[];
  }): Promise<void>;
  lookup(input: {
    merchantId: string;
    merchantProductId: string;
    basis: "ITEM_PRICE" | "DELIVERED_TOTAL";
    zipCode?: string;
    membershipIds: string[];
  }): Promise<PriceHistoryObservation[]>;
}

const PriceHistoryProviderResponseSchema = z.object({
  status: z.enum(["OK", "UNAVAILABLE"]),
  observations: z.array(PriceHistoryObservationSchema).max(366)
}).strict();

export function createPriceHistoryPortFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  fetcher: typeof fetch = fetch
): PriceHistoryPort | undefined {
  const rawUrl = environment.FINDCHEAP_PRICE_HISTORY_URL?.trim();
  const token = environment.FINDCHEAP_PRICE_HISTORY_TOKEN?.trim();
  if (rawUrl === undefined || rawUrl === "" || token === undefined || token.length < 32 || token.length > 512) {
    return undefined;
  }
  let endpoint: URL;
  try {
    endpoint = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (
    endpoint.protocol !== "https:" || endpoint.username !== "" || endpoint.password !== "" ||
    endpoint.hash !== "" || endpoint.search !== "" || endpoint.pathname !== "/v1/price-history"
  ) return undefined;
  const observationEndpoint = new URL("/v1/price-observations", endpoint);
  const request = async (url: URL, body: unknown): Promise<Response> => fetcher(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return {
    async observe(input) {
      const response = await request(observationEndpoint, input);
      if (![200, 201].includes(response.status)) throw new Error("PRICE_HISTORY_UNAVAILABLE");
    },
    async lookup(input) {
      const response = await request(endpoint, input);
      if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
        throw new Error("PRICE_HISTORY_UNAVAILABLE");
      }
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > 262_144) throw new Error("PRICE_HISTORY_UNAVAILABLE");
      const text = await readBoundedText(response, 262_144);
      const parsed = PriceHistoryProviderResponseSchema.parse(JSON.parse(text));
      if (parsed.status !== "OK") throw new Error("PRICE_HISTORY_UNAVAILABLE");
      return parsed.observations;
    }
  };
}

export type DealConciergeDecision = {
  recommendation: "BUY_NOW" | "WAIT" | "WATCH";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  reasons: string[];
  limitations: string[];
  watchSuggested: boolean;
  history: {
    status: "AVAILABLE" | "INSUFFICIENT_EVIDENCE" | "UNAVAILABLE";
    basis: "ITEM_PRICE" | "DELIVERED_TOTAL";
    sampleCount: number;
    sampleFrom?: string;
    sampleTo?: string;
    historicalLowCents?: number;
    typicalMedianCents?: number;
    saleCadence: {
      status: "OBSERVED_INTERVAL" | "INSUFFICIENT_EVIDENCE";
      observedSaleEvents: number;
      medianIntervalDays?: number;
    };
  };
  deals: Array<VerifiedDeal & { applicability: "REQUIRES_MERCHANT_CONFIRMATION" }>;
};

export type DealConciergeResearchResult = {
  decision: DealConciergeDecision;
  currentPrice?: {
    basis: "ITEM_PRICE" | "DELIVERED_TOTAL";
    amount: { amountCents: number; currency: "USD" };
    checkedAt: string;
  };
  quoteStatus: "NOT_REQUESTED" | "ESTIMATED" | "UNAVAILABLE";
  quoteLimitations: string[];
};

export async function researchSelectedProductDeal(input: {
  selected: {
    merchantId: string;
    merchantProductId: string;
    merchant: string;
    availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
    itemPrice?: { amountCents: number; currency: "USD" };
    checkedAt: string;
    quoteCapability: "DELIVERED_TOTAL_SUPPORTED" | "ZIP_ESTIMATE_ONLY" | "MERCHANT_CHECKOUT_ONLY";
    sourceKind: "AWIN_PRODUCT_FEED" | "SHOPIFY_GLOBAL_CATALOG" | "EBAY_BROWSE";
    quoteProduct?: ShopifyProduct;
  };
  zipCode?: string;
  membershipIds: string[];
  dealPort: DealPort;
  cartQuotes?: ShopifyCartQuotePort;
  priceHistory?: PriceHistoryPort;
  now: Date;
}): Promise<DealConciergeResearchResult> {
  const timestamp = input.now.getTime();
  const dealsPromise = input.dealPort.search({
    merchant: input.selected.merchant,
    membershipIds: input.membershipIds,
    channel: "ONLINE"
  }).then((deals) => VerifiedDealsSchema.parse(deals).filter((deal) =>
    deal.merchant.toLocaleLowerCase("en-US") === input.selected.merchant.toLocaleLowerCase("en-US") &&
    deal.channels.includes("ONLINE") &&
    Date.parse(deal.checkedAt) <= timestamp + 120_000 &&
    Date.parse(deal.checkedAt) >= timestamp - 86_400_000 &&
    Date.parse(deal.validFrom) <= timestamp && Date.parse(deal.validTo) > timestamp
  )).catch(() => [] as VerifiedDeal[]);

  let quoteStatus: DealConciergeResearchResult["quoteStatus"] = "NOT_REQUESTED";
  let quote: ShopifyCartEstimate | undefined;
  const quoteLimitations: string[] = [];
  if (input.zipCode !== undefined) {
    if (
      input.cartQuotes === undefined || input.selected.quoteProduct === undefined ||
      input.selected.quoteCapability === "MERCHANT_CHECKOUT_ONLY"
    ) {
      quoteStatus = "UNAVAILABLE";
      quoteLimitations.push("The selected merchant cannot provide a ZIP delivered-total estimate; final shipping and tax require merchant checkout.");
    } else {
      try {
        quote = await input.cartQuotes.quote(input.selected.quoteProduct, input.zipCode);
        quoteStatus = "ESTIMATED";
      } catch {
        quoteStatus = "UNAVAILABLE";
        quoteLimitations.push("The selected merchant did not return a usable ZIP delivered-total estimate.");
      }
    }
  }
  const basis = quote === undefined ? "ITEM_PRICE" as const : "DELIVERED_TOTAL" as const;
  const currentAmount = quote?.deliveredPrice ?? input.selected.itemPrice;
  let observations: PriceHistoryObservation[] = [];
  let historyUnavailable = input.priceHistory === undefined;
  if (input.priceHistory !== undefined) {
    if (currentAmount !== undefined) {
      try {
        await input.priceHistory.observe({
          merchantId: input.selected.merchantId,
          merchantProductId: input.selected.merchantProductId,
          basis,
          amountCents: currentAmount.amountCents,
          currency: currentAmount.currency,
          sourceKind: quote === undefined ? input.selected.sourceKind : "SHOPIFY_CART_ESTIMATE",
          observedAt: quote?.checkedAt ?? input.selected.checkedAt,
          membershipIds: input.membershipIds,
          ...(basis === "DELIVERED_TOTAL" && input.zipCode !== undefined ? { zipCode: input.zipCode } : {})
        });
      } catch {
        // A failed append never blocks the current research result or a read of prior evidence.
      }
    }
    try {
      observations = PriceHistoryObservationSchema.array().max(366).parse(await input.priceHistory.lookup({
        merchantId: input.selected.merchantId,
        merchantProductId: input.selected.merchantProductId,
        basis,
        membershipIds: input.membershipIds,
        ...(basis === "DELIVERED_TOTAL" && input.zipCode !== undefined ? { zipCode: input.zipCode } : {})
      }));
      historyUnavailable = false;
    } catch {
      historyUnavailable = true;
    }
  }
  const decision = evaluateDealConcierge({
    availability: input.selected.availability,
    ...(currentAmount === undefined ? {} : { currentPriceCents: currentAmount.amountCents }),
    basis,
    observations,
    historyUnavailable,
    deals: await dealsPromise
  });
  return {
    decision,
    ...(currentAmount === undefined ? {} : {
      currentPrice: {
        basis,
        amount: currentAmount,
        checkedAt: quote?.checkedAt ?? input.selected.checkedAt
      }
    }),
    quoteStatus,
    quoteLimitations
  };
}

export function evaluateDealConcierge(input: {
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  currentPriceCents?: number;
  basis: "ITEM_PRICE" | "DELIVERED_TOTAL";
  observations?: PriceHistoryObservation[];
  historyUnavailable?: boolean;
  deals: VerifiedDeal[];
}): DealConciergeDecision {
  const observations = PriceHistoryObservationSchema.array().max(366).parse(input.observations ?? [])
    .filter((observation) => observation.basis === input.basis)
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
  const distinctDays = new Set(observations.map((observation) => observation.observedAt.slice(0, 10))).size;
  const sufficientHistory = observations.length >= 5 && distinctDays >= 5;
  const amounts = observations.map((observation) => observation.amountCents).sort((left, right) => left - right);
  const historicalLowCents = amounts[0];
  const typicalMedianCents = median(amounts);
  const cadence = saleCadence(observations, typicalMedianCents);
  const historyStatus = input.historyUnavailable
    ? "UNAVAILABLE" as const
    : sufficientHistory ? "AVAILABLE" as const : "INSUFFICIENT_EVIDENCE" as const;
  const history = {
    status: historyStatus,
    basis: input.basis,
    sampleCount: observations.length,
    ...(observations[0] === undefined ? {} : { sampleFrom: observations[0].observedAt }),
    ...(observations.at(-1) === undefined ? {} : { sampleTo: observations.at(-1)!.observedAt }),
    ...(sufficientHistory && historicalLowCents !== undefined ? { historicalLowCents } : {}),
    ...(sufficientHistory && typicalMedianCents !== undefined ? { typicalMedianCents } : {}),
    saleCadence: cadence
  };
  const deals = input.deals.map((deal) => ({
    ...deal,
    applicability: "REQUIRES_MERCHANT_CONFIRMATION" as const
  }));
  const limitations = [
    ...(deals.length === 0 ? ["No current verified merchant deal was found."] : [
      "Verified merchant deals are candidates only; product eligibility and stacking require merchant confirmation."
    ]),
    ...(historyStatus === "UNAVAILABLE" ? ["Price-history source is unavailable; no historical claim was made."] : []),
    ...(historyStatus === "INSUFFICIENT_EVIDENCE" ? [
      `Only ${observations.length} historical observation(s) across ${distinctDays} day(s) were available; no historical-low or sale-cadence claim was made.`
    ] : [])
  ];

  if (input.availability === "OUT_OF_STOCK") {
    return {
      recommendation: "WATCH",
      confidence: "MEDIUM",
      reasons: ["The exact selected product is currently out of stock."],
      limitations,
      watchSuggested: true,
      history,
      deals
    };
  }
  if (input.currentPriceCents === undefined) {
    return {
      recommendation: "WATCH",
      confidence: "LOW",
      reasons: ["A current price for the exact selected product is unavailable."],
      limitations,
      watchSuggested: true,
      history,
      deals
    };
  }
  if (sufficientHistory && historicalLowCents !== undefined && typicalMedianCents !== undefined) {
    if (input.currentPriceCents <= Math.round(historicalLowCents * 1.02)) {
      return {
        recommendation: "BUY_NOW",
        confidence: observations.length >= 10 ? "HIGH" : "MEDIUM",
        reasons: ["The current observed price is within 2% of the historical low in the stated sample window."],
        limitations,
        watchSuggested: false,
        history,
        deals
      };
    }
    if (input.currentPriceCents > Math.round(typicalMedianCents * 1.1) &&
        observations.filter((observation) => observation.amountCents < input.currentPriceCents!).length >= 2) {
      return {
        recommendation: "WAIT",
        confidence: "MEDIUM",
        reasons: ["The current observed price is more than 10% above the median in the stated sample window."],
        limitations,
        watchSuggested: true,
        history,
        deals
      };
    }
    return {
      recommendation: "WATCH",
      confidence: "MEDIUM",
      reasons: ["The current price is neither near the observed low nor clearly above the observed typical range."],
      limitations,
      watchSuggested: true,
      history,
      deals
    };
  }
  return {
    recommendation: "WATCH",
    confidence: "LOW",
    reasons: ["There is not enough price-history evidence for a defensible buy-now or wait recommendation."],
    limitations,
    watchSuggested: true,
    history,
    deals
  };
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? values[middle]
    : Math.round((values[middle - 1]! + values[middle]!) / 2);
}

function saleCadence(
  observations: PriceHistoryObservation[],
  typicalMedianCents: number | undefined
): DealConciergeDecision["history"]["saleCadence"] {
  if (typicalMedianCents === undefined) {
    return { status: "INSUFFICIENT_EVIDENCE", observedSaleEvents: 0 };
  }
  const saleDays = [...new Set(observations
    .filter((observation) => observation.amountCents <= Math.round(typicalMedianCents * 0.9))
    .map((observation) => observation.observedAt.slice(0, 10)))]
    .map((day) => Date.parse(`${day}T00:00:00.000Z`))
    .sort((left, right) => left - right);
  if (saleDays.length < 3) {
    return { status: "INSUFFICIENT_EVIDENCE", observedSaleEvents: saleDays.length };
  }
  const intervals = saleDays.slice(1).map((timestamp, index) =>
    Math.round((timestamp - saleDays[index]!) / 86_400_000)
  ).sort((left, right) => left - right);
  return {
    status: "OBSERVED_INTERVAL",
    observedSaleEvents: saleDays.length,
    medianIntervalDays: median(intervals)!
  };
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  if (response.body === null) throw new Error("PRICE_HISTORY_UNAVAILABLE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new Error("PRICE_HISTORY_UNAVAILABLE");
      chunks.push(value);
    }
    return Buffer.concat(chunks, total).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}
