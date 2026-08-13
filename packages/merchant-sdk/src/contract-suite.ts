import type { MerchantAdapter, SearchProductsInput } from "./types.js";

export type ContractFixtures = { search: SearchProductsInput };

export type MerchantContractReport = {
  merchantId: string;
  failures: string[];
};

function parseUnambiguousTimestamp(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function hasExpiryAfterCheck(checkedAt: string, expiresAt: string): boolean {
  const checkedTimestamp = parseUnambiguousTimestamp(checkedAt);
  const expiryTimestamp = parseUnambiguousTimestamp(expiresAt);
  return checkedTimestamp !== undefined && expiryTimestamp !== undefined && expiryTimestamp > checkedTimestamp;
}

export async function runMerchantContractSuite(
  factory: () => MerchantAdapter,
  fx: ContractFixtures
): Promise<MerchantContractReport> {
  const adapter = factory();
  const offers = await adapter.searchProducts(fx.search);
  const failures: string[] = [];

  for (const offer of offers) {
    if (!Array.isArray(offer.evidenceRefs) || offer.evidenceRefs.length === 0) {
      failures.push("offer evidenceRefs must not be empty");
    }
    if (!hasExpiryAfterCheck(offer.checkedAt, offer.expiresAt)) {
      failures.push("expiresAt must be after checkedAt");
    }
    if (offer.currency !== "USD") {
      failures.push("currency must be USD");
    }
  }

  return { merchantId: adapter.merchantId, failures };
}
