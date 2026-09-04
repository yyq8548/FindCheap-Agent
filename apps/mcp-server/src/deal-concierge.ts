import { VerifiedDealsSchema, dealAppliesToProduct, type DealPort, type VerifiedDeal } from "./deal-client.js";
import type { ShopifyProduct } from "./shopify-client.js";
import type { ShopifyCartEstimate, ShopifyCartQuotePort } from "./shopify-cart-quote.js";

export type CurrentDealStatus =
  | "CURRENT_DEAL_FOUND"
  | "NO_CURRENT_DEAL"
  | "OUT_OF_STOCK"
  | "CURRENT_PRICE_UNAVAILABLE";

export type CurrentDealResearchResult = {
  dealStatus: CurrentDealStatus;
  currentPrice?: {
    basis: "ITEM_PRICE" | "DELIVERED_TOTAL";
    amount: { amountCents: number; currency: "USD" };
    checkedAt: string;
  };
  quoteStatus: "NOT_REQUESTED" | "ESTIMATED" | "UNAVAILABLE";
  limitations: string[];
  deals: Array<VerifiedDeal & {
    applicability: "PRODUCT_CONFIRMED" | "REQUIRES_MERCHANT_CONFIRMATION";
  }>;
};

export async function researchSelectedProductDeal(input: {
  selected: {
    merchantProductId: string;
    merchant: string;
    availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
    itemPrice?: { amountCents: number; currency: "USD" };
    checkedAt: string;
    quoteCapability: "DELIVERED_TOTAL_SUPPORTED" | "ZIP_ESTIMATE_ONLY" | "MERCHANT_CHECKOUT_ONLY";
    quoteProduct?: ShopifyProduct;
  };
  zipCode?: string;
  membershipIds: string[];
  dealPort: DealPort;
  cartQuotes?: ShopifyCartQuotePort;
  now: Date;
}): Promise<CurrentDealResearchResult> {
  const timestamp = input.now.getTime();
  const deals = await input.dealPort.search({
    merchant: input.selected.merchant,
    membershipIds: input.membershipIds,
    channel: "ONLINE"
  }).then((results) => VerifiedDealsSchema.parse(results).filter((deal) =>
    deal.merchant.toLocaleLowerCase("en-US") === input.selected.merchant.toLocaleLowerCase("en-US") &&
    dealAppliesToProduct(deal, input.selected.merchantProductId) &&
    deal.channels.includes("ONLINE") &&
    Date.parse(deal.checkedAt) <= timestamp + 120_000 &&
    Date.parse(deal.checkedAt) >= timestamp - 86_400_000 &&
    Date.parse(deal.validFrom) <= timestamp && Date.parse(deal.validTo) > timestamp
  )).catch(() => [] as VerifiedDeal[]);

  let quoteStatus: CurrentDealResearchResult["quoteStatus"] = "NOT_REQUESTED";
  let quote: ShopifyCartEstimate | undefined;
  const limitations: string[] = [];
  if (input.zipCode !== undefined) {
    if (
      input.cartQuotes === undefined || input.selected.quoteProduct === undefined ||
      input.selected.quoteCapability === "MERCHANT_CHECKOUT_ONLY"
    ) {
      quoteStatus = "UNAVAILABLE";
      limitations.push("The selected merchant cannot provide a ZIP delivered-total estimate; final shipping and tax require merchant checkout.");
    } else {
      try {
        quote = await input.cartQuotes.quote(input.selected.quoteProduct, input.zipCode);
        quoteStatus = "ESTIMATED";
      } catch {
        quoteStatus = "UNAVAILABLE";
        limitations.push("The selected merchant did not return a usable ZIP delivered-total estimate.");
      }
    }
  }

  const currentAmount = quote?.deliveredPrice ?? input.selected.itemPrice;
  const verifiedDeals = deals.map((deal) => ({
    ...deal,
    applicability: deal.productApplicability === "PRODUCT_CONFIRMED"
      ? "PRODUCT_CONFIRMED" as const
      : "REQUIRES_MERCHANT_CONFIRMATION" as const
  }));
  limitations.push(...(verifiedDeals.length === 0
    ? ["No current verified merchant deal was found."]
    : verifiedDeals.every((deal) => deal.applicability === "PRODUCT_CONFIRMED")
      ? ["Verified deals are confirmed for this selected product; stacking and the final amount require checkout confirmation."]
      : ["Verified merchant deals are candidates only; product eligibility and stacking require merchant confirmation."]));

  const dealStatus: CurrentDealStatus = input.selected.availability === "OUT_OF_STOCK"
    ? "OUT_OF_STOCK"
    : verifiedDeals.length > 0
      ? "CURRENT_DEAL_FOUND"
      : currentAmount === undefined
        ? "CURRENT_PRICE_UNAVAILABLE"
        : "NO_CURRENT_DEAL";

  return {
    dealStatus,
    ...(currentAmount === undefined ? {} : {
      currentPrice: {
        basis: quote === undefined ? "ITEM_PRICE" as const : "DELIVERED_TOTAL" as const,
        amount: currentAmount,
        checkedAt: quote?.checkedAt ?? input.selected.checkedAt
      }
    }),
    quoteStatus,
    limitations,
    deals: verifiedDeals
  };
}
