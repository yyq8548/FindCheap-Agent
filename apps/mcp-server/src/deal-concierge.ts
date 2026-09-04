import { dealAppliesToProduct, searchDealsWithStatus, type DealPort, type DealLookupResult, type VerifiedDeal } from "./deal-client.js";
import { assessSelectedProductDeal, rankAssessedDeals, type DealAssessment, type DealSummary } from "./deal-assessment.js";
import type { ShopifyProduct } from "./shopify-client.js";
import type { ShopifyCartEstimate, ShopifyCartQuotePort } from "./shopify-cart-quote.js";

export type CurrentDealStatus =
  | "CURRENT_DEAL_FOUND"
  | "NO_CURRENT_DEAL"
  | "DEAL_LOOKUP_UNAVAILABLE"
  | "OUT_OF_STOCK"
  | "CURRENT_PRICE_UNAVAILABLE";

export type CurrentDealResearchResult = {
  dealStatus: CurrentDealStatus;
  dealLookupStatus: DealLookupResult["status"];
  dealLookupReasonCodes: DealLookupResult["reasonCodes"];
  dealSummary: DealSummary;
  currentPrice?: {
    basis: "ITEM_PRICE" | "DELIVERED_TOTAL";
    amount: { amountCents: number; currency: "USD" };
    checkedAt: string;
  };
  quoteStatus: "NOT_REQUESTED" | "ESTIMATED" | "UNAVAILABLE";
  limitations: string[];
  deals: Array<VerifiedDeal & {
    applicability: "PRODUCT_CONFIRMED" | "REQUIRES_MERCHANT_CONFIRMATION";
    assessment: DealAssessment;
  }>;
};

export async function researchSelectedProductDeal(input: {
  selected: {
    merchantProductId: string;
    merchant: string;
    title?: string;
    productType?: string;
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
  const lookup = await searchDealsWithStatus(input.dealPort, {
    merchant: input.selected.merchant,
    ...(input.selected.title === undefined ? {} : { productQuery: input.selected.title.slice(0, 300) }),
    membershipIds: input.membershipIds,
    channel: "ONLINE"
  });
  const merchantDeals = lookup.deals.filter((deal) =>
    deal.merchant.toLocaleLowerCase("en-US") === input.selected.merchant.toLocaleLowerCase("en-US") &&
    dealAppliesToProduct(deal, input.selected.merchantProductId) &&
    deal.channels.includes("ONLINE") &&
    Date.parse(deal.validFrom) <= timestamp && Date.parse(deal.validTo) > timestamp
  );
  const deals = merchantDeals.filter((deal) =>
    Date.parse(deal.checkedAt) <= timestamp + 120_000 && Date.parse(deal.checkedAt) >= timestamp - 86_400_000
  );
  if (deals.length !== merchantDeals.length) {
    lookup.status = deals.length === 0 ? "UNAVAILABLE" : "PARTIAL";
    lookup.reasonCodes = [...new Set([...lookup.reasonCodes, "STALE_EVIDENCE" as const])];
  }

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
  const verifiedDeals = rankAssessedDeals(deals.map((deal) => {
    const assessment = assessSelectedProductDeal(deal, input.selected);
    return {
      ...deal,
      assessment,
      applicability: assessment.status === "CONFIRMED"
        ? "PRODUCT_CONFIRMED" as const
        : "REQUIRES_MERCHANT_CONFIRMATION" as const
    };
  }));
  const bestDeal = verifiedDeals.find((deal) => deal.assessment.recommendationEligible);
  const dealSummary: DealSummary = lookup.status === "UNAVAILABLE" || (lookup.status === "PARTIAL" && verifiedDeals.length === 0)
    ? { status: "UNAVAILABLE", reasonCodes: [] }
    : bestDeal === undefined
      ? { status: "NO_ELIGIBLE_DEAL", reasonCodes: [] }
      : {
          status: bestDeal.assessment.status === "CONFIRMED" ? "CONFIRMED_DEAL" : "MERCHANT_CANDIDATE",
          recommendedDealId: bestDeal.dealId,
          reasonCodes: bestDeal.assessment.reasonCodes
        };
  if (lookup.status !== "COMPLETE") {
    limitations.push(lookup.status === "UNAVAILABLE"
      ? "Current merchant deals could not be verified because the source is unavailable; this does not mean no coupon exists."
      : "Only part of the merchant deal evidence was usable; the offer list may be incomplete.");
  }
  limitations.push(...(verifiedDeals.length === 0 && lookup.status !== "COMPLETE"
    ? []
    : verifiedDeals.length === 0
    ? ["No current verified merchant deal was found."]
    : verifiedDeals.every((deal) => deal.applicability === "PRODUCT_CONFIRMED")
      ? ["Verified deals are confirmed for this selected product; stacking and the final amount require checkout confirmation."]
      : ["Verified merchant deals are candidates only; product eligibility and stacking require merchant confirmation."]));

  const dealStatus: CurrentDealStatus = input.selected.availability === "OUT_OF_STOCK"
    ? "OUT_OF_STOCK"
    : lookup.status === "UNAVAILABLE" || (lookup.status === "PARTIAL" && verifiedDeals.length === 0)
      ? "DEAL_LOOKUP_UNAVAILABLE"
      : verifiedDeals.length > 0
      ? "CURRENT_DEAL_FOUND"
      : currentAmount === undefined
        ? "CURRENT_PRICE_UNAVAILABLE"
        : "NO_CURRENT_DEAL";

  return {
    dealStatus,
    dealLookupStatus: lookup.status,
    dealLookupReasonCodes: lookup.reasonCodes,
    dealSummary,
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
