import type { ComparisonOfferSchema } from "../../contracts/src/index.js";

export type ComparisonOffer = ReturnType<typeof ComparisonOfferSchema.parse>;
export type RankingContext = { memberships: string[] };

export function rankExactOffers(
  offers: ComparisonOffer[],
  context: RankingContext
): ComparisonOffer[] {
  return offers
    .filter((offer) => offer.matchStatus === "EXACT")
    .map((offer) => selectRankingQuote(offer, context.memberships))
    .sort((left, right) =>
      left.rankingQuote.deliveredPrice.amountCents -
        right.rankingQuote.deliveredPrice.amountCents ||
      freshnessScore(right) - freshnessScore(left) ||
      compareOfferIds(left.offerId, right.offerId)
    );
}

function selectRankingQuote(
  offer: ComparisonOffer,
  memberships: string[]
): ComparisonOffer {
  const memberQuote = offer.memberQuote;
  return {
    ...offer,
    rankingQuote:
      memberQuote?.eligible && memberships.includes(memberQuote.programId)
        ? memberQuote.quote
        : offer.regularQuote
  };
}

function freshnessScore(offer: ComparisonOffer): number {
  return Date.parse(offer.rankingQuote.checkedAt);
}

function compareOfferIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
