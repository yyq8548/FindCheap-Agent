import { dealAppliesToProduct, searchDealsWithStatus, type DealPort, type DealLookupResult, type VerifiedDeal } from "./deal-client.js";
import { assessSelectedProductDeal, rankAssessedDeals, type DealAssessment, type DealSummary } from "./deal-assessment.js";
import type { ShopifyProduct } from "./shopify-client.js";
import type { ShopifyCartQuotePort } from "./shopify-cart-quote.js";

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
    quoteCapability: "DELIVERED_TOTAL_SUPPORTED" | "ZIP_ESTIMATE_ONLY" | "MERCHANT_CHECKOUT_ONLY" | "NOT_CHECKED";
    quoteProduct?: ShopifyProduct;
  };
  zipCode?: string;
  membershipIds: string[];
  dealPort: DealPort;
  cartQuotes?: ShopifyCartQuotePort;
  now: Date;
  responseLocale?: "en-US" | "zh-CN";
}): Promise<CurrentDealResearchResult> {
  const text = (english: string, chinese: string) => input.responseLocale === "zh-CN" ? chinese : english;
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

  const limitations: string[] = [];
  if (input.zipCode !== undefined) {
    limitations.push(text("Coupon research did not request a delivered-total quote. An explicit quote request is required; a ZIP alone does not authorize an anonymous cart.",
      "优惠查询未请求到手价报价。需要明确请求报价；提供 ZIP 不等于授权创建匿名购物车。"));
  }

  const currentAmount = input.selected.itemPrice;
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
      ? text("Current merchant deals could not be verified because the source is unavailable; this does not mean no coupon exists.", "优惠来源暂不可用，当前商家优惠尚未核实；不代表没有优惠。")
      : text("Only part of the merchant deal evidence was usable; the offer list may be incomplete.", "仅部分商家优惠证据可用；优惠列表可能不完整。"));
  }
  limitations.push(...(verifiedDeals.length === 0 && lookup.status !== "COMPLETE"
    ? []
    : verifiedDeals.length === 0
    ? [text("No current verified merchant deal was found.", "本次未找到当前已验证的商家优惠。")]
    : verifiedDeals.every((deal) => deal.applicability === "PRODUCT_CONFIRMED")
      ? [text("Verified deals are confirmed for this selected product; stacking and the final amount require checkout confirmation.", "优惠已确认适用于所选商品；能否叠加及最终金额需在结账页确认。")]
      : [text("Verified merchant deals are candidates only; product eligibility and stacking require merchant confirmation.", "已验证的商家优惠仅为候选；所选商品是否适用及能否叠加仍需商家确认。")]));

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
        basis: "ITEM_PRICE" as const,
        amount: currentAmount,
        checkedAt: input.selected.checkedAt
      }
    }),
    quoteStatus: "NOT_REQUESTED",
    limitations,
    deals: verifiedDeals
  };
}
