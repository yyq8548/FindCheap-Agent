import { z } from "zod";
import {
  ComparisonOfferSchema,
  ComparisonResultSchema,
  SimilarComparisonOfferSchema,
  type CanonicalProduct,
  type ComparisonResult
} from "../../../packages/contracts/src/index.js";
import { calculatePriceOptions, type QuoteInput } from "../../../packages/pricing/src/index.js";
import { matchProduct, type CandidateProduct } from "../../../packages/product-identity/src/index.js";
import { rankExactOffers } from "../../../packages/ranking/src/rank-offers.js";

export const CompareInputSchema = z
  .object({
    query: z.string().min(2).max(300),
    zipCode: z.string().regex(/^\d{5}$/),
    memberships: z.array(z.string().min(1)).max(30).default([])
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
  quote?: QuoteInput;
};

export interface CurrentOfferRepository {
  /** Returns candidates with current quotes only; stale database quotes are excluded by the repository. */
  search(query: string): Promise<OfferSearchResult>;
}

export type OfferSearchResult =
  | { status: "RESOLVED"; product: CanonicalProduct; candidates: ComparableOffer[] }
  | { status: "NEEDS_CLARIFICATION"; questions: string[] };

export type CompareDeps = {
  offers: CurrentOfferRepository;
  clock: { now(): Date };
};

type EvaluatedOffer =
  | { kind: "exact"; offer: ComparisonOffer }
  | { kind: "similar"; offer: z.infer<typeof SimilarComparisonOfferSchema> }
  | { kind: "question"; question: string };

export async function compareProducts(input: CompareInput, deps: CompareDeps): Promise<ComparisonResult> {
  const parsedInput = CompareInputSchema.parse(input);
  const search = await deps.offers.search(parsedInput.query);
  if (search.status === "NEEDS_CLARIFICATION") {
    return ComparisonResultSchema.parse({
      productId: "",
      exactOffers: [],
      similarOffers: [],
      questions: search.questions
    });
  }
  const now = deps.clock.now();
  const evaluated = await Promise.all(
    search.candidates.map((candidate) => evaluateCandidate(candidate, search.product, parsedInput, now))
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

function evaluateCandidate(
  candidate: ComparableOffer,
  product: CanonicalProduct,
  input: CompareInput,
  now: Date
): EvaluatedOffer {
  try {
    return classifyCandidate(candidate, product, input, now);
  } catch {
    return { kind: "question", question: "Some merchant data could not be verified." };
  }
}

function classifyCandidate(
  candidate: ComparableOffer,
  product: CanonicalProduct,
  input: CompareInput,
  now: Date
): EvaluatedOffer {
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
  if (
    !candidate.quote ||
    candidate.quote.offerId !== candidate.offerId ||
    Date.parse(candidate.quote.expiresAt) <= now.getTime()
  ) {
    return { kind: "question", question: "A current price is unavailable for an exact product match." };
  }

  try {
    const prices = calculatePriceOptions(candidate.quote, {
      memberships: input.memberships,
      isFirstOrder: false,
      hasSubscription: false,
      paymentMethods: [],
      zipCode: input.zipCode
    });
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
  } catch {
    return { kind: "question", question: "Some merchant prices could not be verified." };
  }
}
