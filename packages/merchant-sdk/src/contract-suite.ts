import { parseRfc3339Timestamp } from "./time.js";
import type { MerchantAdapter, RefreshPriceInput, SearchProductsInput } from "./types.js";

export type ContractFixtures = { search: SearchProductsInput; priceRefresh: RefreshPriceInput };

export type MerchantContractReport = {
  merchantId: string;
  failures: string[];
};

function hasExpiryAfterCheck(checkedAt: string, expiresAt: string): boolean {
  const checkedTimestamp = parseRfc3339Timestamp(checkedAt);
  const expiryTimestamp = parseRfc3339Timestamp(expiresAt);
  return checkedTimestamp !== undefined && expiryTimestamp !== undefined && expiryTimestamp > checkedTimestamp;
}

export async function runMerchantContractSuite(
  factory: () => MerchantAdapter,
  fx: ContractFixtures
): Promise<MerchantContractReport> {
  const adapter = factory();
  const offers = await adapter.searchProducts(fx.search);
  const priceRefresh = await adapter.refreshPrice(fx.priceRefresh);
  const failures: string[] = [];

  for (const offer of offers) {
    if (!Array.isArray(offer.evidenceRefs) || !offer.evidenceRefs.some(
      (evidenceRef) => typeof evidenceRef === "string" && evidenceRef.trim().length > 0
    )) {
      failures.push("offer evidenceRefs must not be empty");
    }
    if (!hasExpiryAfterCheck(offer.checkedAt, offer.expiresAt)) {
      failures.push("expiresAt must be after checkedAt");
    }
    if (offer.currency !== "USD") {
      failures.push("currency must be USD");
    }
  }

  if (priceRefresh.sourceVersion !== fx.priceRefresh.sourceVersion) {
    failures.push("price refresh sourceVersion must match request");
  }
  if (
    priceRefresh.merchantProductId !== fx.priceRefresh.merchantProductId ||
    priceRefresh.quote.merchantProductId !== fx.priceRefresh.merchantProductId
  ) {
    failures.push("price refresh merchantProductId must match request");
  }
  if (priceRefresh.rawEvidence.length === 0) {
    failures.push("price refresh rawEvidence must not be empty");
  }
  if (!hasExpiryAfterCheck(priceRefresh.quote.checkedAt, priceRefresh.quote.expiresAt)) {
    failures.push("price refresh expiresAt must be after checkedAt");
  }

  return { merchantId: adapter.merchantId, failures };
}
