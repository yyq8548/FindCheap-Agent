import type {
  MerchantAdapter,
  RefreshOfferInput,
  RefreshPriceInput,
  SearchProductsInput
} from "./types.js";
import {
  requireHttpsUrl,
  requireMetadata,
  requireOfferShape,
  requireQuoteShape,
  requireRawEvidence,
  requireSourceType,
  requireStrictTimestamp
} from "./validation.js";

export type ContractFixtures = {
  search: SearchProductsInput;
  offerRefresh: RefreshOfferInput;
  priceRefresh: RefreshPriceInput;
  maxSourceEntitySkewMs: number;
};

export type MerchantContractReport = { merchantId: string; failures: string[] };

function recordFailure(failures: string[], work: () => void): void {
  try {
    work();
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "unknown contract failure");
  }
}

function validateSourceEnvelope(
  result: {
    sourceUrl: string;
    rawEvidence: string;
    metadata: Record<string, string>;
    checkedAt: string;
  },
  failures: string[]
): number | undefined {
  recordFailure(failures, () => requireHttpsUrl(result.sourceUrl));
  recordFailure(failures, () => requireRawEvidence(result.rawEvidence));
  recordFailure(failures, () => {
    requireMetadata(result.metadata);
    requireSourceType(result.metadata.sourceType ?? "unknown");
  });
  let checked: number | undefined;
  recordFailure(failures, () => {
    checked = requireStrictTimestamp(result.checkedAt, "source checkedAt");
  });
  return checked;
}

function validateSkew(
  sourceChecked: number | undefined,
  entityCheckedAt: string,
  maxSkewMs: number,
  failures: string[]
): void {
  recordFailure(failures, () => {
    if (!Number.isFinite(maxSkewMs) || maxSkewMs < 0) throw new Error("contract skew policy is invalid");
    const entityChecked = requireStrictTimestamp(entityCheckedAt, "entity checkedAt");
    if (sourceChecked === undefined || Math.abs(sourceChecked - entityChecked) > maxSkewMs) {
      throw new Error("source evidence time does not match entity checkedAt");
    }
  });
}

export async function runMerchantContractSuite(
  factory: () => MerchantAdapter,
  fx: ContractFixtures
): Promise<MerchantContractReport> {
  const adapter = factory();
  const [offers, offerRefresh, priceRefresh] = await Promise.all([
    adapter.searchProducts(fx.search),
    adapter.refreshOffer(fx.offerRefresh),
    adapter.refreshPrice(fx.priceRefresh)
  ]);
  const failures: string[] = [];

  for (const offer of offers) {
    if (!Array.isArray(offer.evidenceRefs) || offer.evidenceRefs.length === 0 ||
        offer.evidenceRefs.every((ref) => typeof ref !== "string" || ref.trim() === "")) {
      failures.push("offer evidenceRefs must not be empty");
    }
    if (offer.merchantId !== adapter.merchantId) {
      failures.push("offer merchantId must match adapter");
    }
    if (offer.currency !== "USD") failures.push("offer currency must be USD");
    recordFailure(failures, () => {
      const checked = requireStrictTimestamp(offer.checkedAt, "offer checkedAt");
      const expires = requireStrictTimestamp(offer.expiresAt, "offer expiresAt");
      if (expires <= checked) throw new Error("offer expiresAt must be after checkedAt");
    });
    recordFailure(failures, () => requireOfferShape({
      ...offer,
      sellerName: "contract-search-result",
      condition: "NEW",
      inventoryStatus: "UNKNOWN",
      itemPriceCents: 0
    }));
  }

  if (
    offerRefresh.sourceVersion !== fx.offerRefresh.sourceVersion ||
    offerRefresh.merchantProductId !== fx.offerRefresh.merchantProductId ||
    offerRefresh.offer?.merchantProductId !== fx.offerRefresh.merchantProductId ||
    (offerRefresh.offer != null && offerRefresh.offer.merchantId !== adapter.merchantId)
  ) {
    failures.push("offer refresh identity must match request");
  }
  const offerSourceChecked = validateSourceEnvelope(offerRefresh, failures);
  if (offerRefresh.offer) {
    recordFailure(failures, () => requireOfferShape(offerRefresh.offer!));
    validateSkew(
      offerSourceChecked,
      offerRefresh.offer.checkedAt,
      fx.maxSourceEntitySkewMs,
      failures
    );
  }

  if (
    priceRefresh.sourceVersion !== fx.priceRefresh.sourceVersion ||
    priceRefresh.merchantProductId !== fx.priceRefresh.merchantProductId ||
    priceRefresh.quote.merchantProductId !== fx.priceRefresh.merchantProductId
  ) {
    failures.push("price refresh identity must match request");
  }
  const priceSourceChecked = validateSourceEnvelope(priceRefresh, failures);
  recordFailure(failures, () => requireQuoteShape(priceRefresh.quote));
  validateSkew(
    priceSourceChecked,
    priceRefresh.quote.checkedAt,
    fx.maxSourceEntitySkewMs,
    failures
  );

  return { merchantId: adapter.merchantId, failures };
}
