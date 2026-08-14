import { z } from "zod";
import {
  ComparisonOfferSchema,
  ComparisonResultSchema,
  PriceQuoteSchema,
  SimilarComparisonOfferSchema,
  type CanonicalProduct,
  type ComparisonResult,
  type PriceQuote
} from "../../../packages/contracts/src/index.js";
import {
  QuoteInputSchema,
  calculatePriceOptions,
  type QuoteInput
} from "../../../packages/pricing/src/index.js";
import { matchProduct, type CandidateProduct } from "../../../packages/product-identity/src/index.js";
import { rankExactOffers } from "../../../packages/ranking/src/rank-offers.js";

export const CompareInputSchema = z
  .object({
    query: z.string().trim().min(2).max(300),
    zipCode: z.string().regex(/^\d{5}$/),
    memberships: z
      .array(z.string().trim().min(1).max(80))
      .max(20)
      .default([])
      .transform((memberships) => [...new Set(memberships)].sort())
  })
  .strict();

export type CompareInput = z.infer<typeof CompareInputSchema>;
type ComparisonOffer = z.infer<typeof ComparisonOfferSchema>;

export type ComparableOffer = {
  offerId: string;
  merchantId: string;
  sellerName: string;
  merchantUrl: string;
  product: CandidateProduct;
};

export interface CurrentOfferRepository {
  /** Resolves the product and returns unquoted merchant candidates. */
  search(query: string, now: Date): Promise<OfferSearchResult>;
}

export type OfferSearchResult =
  | { status: "RESOLVED"; product: CanonicalProduct; candidates: ComparableOffer[] }
  | { status: "NEEDS_CLARIFICATION"; questions: string[] };

export type CompareDeps = {
  offers: CurrentOfferRepository;
  quoteExactOffer(
    candidate: ComparableOffer,
    context: QuoteContext
  ): Promise<QuoteInput | ContextualQuoteSet | undefined>;
  clock: { now(): Date };
};

export type QuoteContext = Pick<CompareInput, "zipCode" | "memberships"> & { now: Date };

const ContextualQuoteSetSchema = z.object({
  regularQuote: PriceQuoteSchema,
  memberQuote: z.object({
    programId: z.string().min(1),
    programName: z.string().min(1),
    memberships: z.array(z.string().min(1)),
    quote: PriceQuoteSchema
  }).strict().optional()
}).strict();

export type ContextualQuoteSet = z.infer<typeof ContextualQuoteSetSchema>;

type EvaluatedOffer =
  | { kind: "exact"; offer: ComparisonOffer }
  | { kind: "similar"; offer: z.infer<typeof SimilarComparisonOfferSchema> }
  | { kind: "question"; question: string };

export async function compareProducts(input: CompareInput, deps: CompareDeps): Promise<ComparisonResult> {
  const parsedInput = CompareInputSchema.parse(input);
  const now = deps.clock.now();
  if (!Number.isFinite(now.getTime())) throw new Error("clock returned an invalid time");
  const search = await deps.offers.search(parsedInput.query, now);
  if (search.status === "NEEDS_CLARIFICATION") {
    return ComparisonResultSchema.parse({
      productId: "",
      exactOffers: [],
      similarOffers: [],
      questions: search.questions
    });
  }
  const evaluated = await Promise.all(
    search.candidates.map((candidate) =>
      evaluateCandidate(candidate, search.product, parsedInput, now, deps.quoteExactOffer)
    )
  );
  const exactOffers = evaluated.flatMap((result) => result.kind === "exact" ? [result.offer] : []);
  const similarOffers = evaluated.flatMap((result) => result.kind === "similar" ? [result.offer] : []);
  const questions = evaluated.flatMap((result) => result.kind === "question" ? [result.question] : []);

  if (exactOffers.length === 0 && similarOffers.length === 0 && questions.length === 0) {
    questions.push("No current comparable offers were found.");
  }

  return ComparisonResultSchema.parse({
    productId: search.product.productId,
    exactOffers: rankExactOffers(exactOffers, { memberships: parsedInput.memberships }),
    similarOffers,
    questions: [...new Set(questions)]
  });
}

async function evaluateCandidate(
  candidate: ComparableOffer,
  product: CanonicalProduct,
  input: CompareInput,
  now: Date,
  quoteExactOffer: CompareDeps["quoteExactOffer"]
): Promise<EvaluatedOffer> {
  const decision = matchProduct(candidate.product, product);
  if (decision.status === "SIMILAR") {
    return {
      kind: "similar",
      offer: SimilarComparisonOfferSchema.parse({
        offerId: candidate.offerId,
        merchantId: candidate.merchantId,
        sellerName: candidate.sellerName,
        matchStatus: "SIMILAR",
        merchantUrl: candidate.merchantUrl,
        recommendationReasons: decision.evidence
      })
    };
  }
  if (decision.status === "NEEDS_CONFIRMATION") {
    return { kind: "question", question: "Please confirm the model or variant before comparing prices." };
  }
  if (decision.status === "INSUFFICIENT") {
    return { kind: "question", question: "Please provide a model number or GTIN before comparing prices." };
  }
  const stored = await quoteExactOffer(candidate, {
    zipCode: input.zipCode,
    memberships: input.memberships,
    now
  });
  if (stored === undefined) {
    return { kind: "question", question: "A current price is unavailable for an exact product match." };
  }
  const contextual = ContextualQuoteSetSchema.safeParse(stored);
  const prices = contextual.success
    ? contextualPrices(contextual.data, candidate.offerId, now, input.memberships)
    : calculatedPrices(QuoteInputSchema.parse(stored), candidate.offerId, input, now);
  if (prices === undefined) {
    return { kind: "question", question: "A current price is unavailable for an exact product match." };
  }
  return {
    kind: "exact",
    offer: ComparisonOfferSchema.parse({
      offerId: candidate.offerId,
      merchantId: candidate.merchantId,
      sellerName: candidate.sellerName,
      matchStatus: "EXACT",
      regularQuote: prices.regularQuote,
      ...(prices.memberQuote ? { memberQuote: prices.memberQuote } : {}),
      rankingQuote: prices.rankingQuote,
      merchantUrl: candidate.merchantUrl,
      recommendationReasons: decision.evidence
    })
  };
}

function calculatedPrices(
  quote: QuoteInput,
  offerId: string,
  input: CompareInput,
  now: Date
): { regularQuote: PriceQuote; memberQuote?: { programId: string; programName: string; eligible: boolean; quote: PriceQuote }; rankingQuote: PriceQuote } | undefined {
  if (!isCurrentQuote(quote, offerId, now)) return undefined;
  return calculatePriceOptions(quote, {
    memberships: input.memberships,
    isFirstOrder: false,
    hasSubscription: false,
    paymentMethods: [],
    zipCode: input.zipCode
  });
}

function contextualPrices(
  set: ContextualQuoteSet,
  offerId: string,
  now: Date,
  memberships: string[]
): { regularQuote: PriceQuote; memberQuote?: { programId: string; programName: string; eligible: boolean; quote: PriceQuote }; rankingQuote: PriceQuote } | undefined {
  if (!isCurrentQuote(set.regularQuote, offerId, now)) return undefined;
  if (set.memberQuote === undefined || !sameMemberships(set.memberQuote.memberships, memberships)) {
    return { regularQuote: set.regularQuote, rankingQuote: set.regularQuote };
  }
  if (!isCurrentQuote(set.memberQuote.quote, offerId, now)) return undefined;
  const { memberships: _memberships, ...storedMemberQuote } = set.memberQuote;
  const memberQuote = { ...storedMemberQuote, eligible: true };
  return {
    regularQuote: set.regularQuote,
    memberQuote,
    rankingQuote: memberQuote.quote
  };
}

function sameMemberships(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isCurrentQuote(
  quote: Pick<PriceQuote | QuoteInput, "offerId" | "checkedAt" | "expiresAt">,
  offerId: string,
  now: Date
): boolean {
  return quote.offerId === offerId &&
    Date.parse(quote.checkedAt) <= now.getTime() &&
    Date.parse(quote.expiresAt) > now.getTime();
}
