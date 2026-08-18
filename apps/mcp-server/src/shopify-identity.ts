import { normalizeGtin, normalizeToken } from "../../../packages/product-identity/src/normalize.js";

export type ShopifyIdentityCandidate = {
  merchantId: string;
  merchantUrl: string;
  brand?: string;
  sku?: string;
  gtins: readonly string[];
  variantDimensions: Readonly<Record<string, string>>;
  itemPrice?: { amountCents: number };
};

export type SameProductGroup<T> = {
  identityType: "GTIN" | "BRAND_MPN";
  evidence: string[];
  offers: T[];
};

export function selectSameProductGroup<T extends ShopifyIdentityCandidate>(
  candidates: readonly T[]
): SameProductGroup<T> | undefined {
  const groups = new Map<string, { identityType: "GTIN" | "BRAND_MPN"; offers: T[] }>();

  for (const candidate of candidates) {
    for (const identity of identityKeys(candidate)) {
      const group = groups.get(identity.key) ?? { identityType: identity.type, offers: [] };
      if (!group.offers.some((offer) => offer.merchantId === candidate.merchantId)) {
        group.offers.push(candidate);
      }
      groups.set(identity.key, group);
    }
  }

  const eligible = [...groups.entries()]
    .filter(([, group]) => group.offers.length >= 2)
    .sort(([leftKey, left], [rightKey, right]) =>
      identityPriority(left.identityType) - identityPriority(right.identityType) ||
      right.offers.length - left.offers.length ||
      lowestPrice(left.offers) - lowestPrice(right.offers) ||
      compareText(leftKey, rightKey)
    );
  const selected = eligible[0]?.[1];
  if (selected === undefined) return undefined;

  return {
    identityType: selected.identityType,
    evidence: [selected.identityType === "GTIN" ? "GTIN and variant exact" : "brand, MPN/SKU, and variant exact"],
    offers: selected.offers
  };
}

function identityKeys(candidate: ShopifyIdentityCandidate): Array<{
  key: string;
  type: "GTIN" | "BRAND_MPN";
}> {
  const variantKey = Object.entries(candidate.variantDimensions)
    .map(([name, value]) => [normalizeToken(name), normalizeToken(value)] as const)
    .filter(([name, value]) => name !== "" && value !== "")
    .sort(([leftName, leftValue], [rightName, rightValue]) =>
      compareText(leftName, rightName) || compareText(leftValue, rightValue)
    )
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  const keys: Array<{ key: string; type: "GTIN" | "BRAND_MPN" }> = [
    ...new Set(candidate.gtins.flatMap((value) => normalizeGtin(value) ?? []))
  ]
    .sort()
    .map((gtin) => ({ key: `GTIN:${gtin}|${variantKey}`, type: "GTIN" as const }));
  const brand = candidate.brand === undefined ? "" : normalizeToken(candidate.brand);
  const mpn = candidate.sku === undefined ? "" : normalizeToken(candidate.sku);
  if (brand !== "" && mpn !== "") {
    keys.push({ key: `BRAND_MPN:${brand}:${mpn}|${variantKey}`, type: "BRAND_MPN" as const });
  }
  return keys;
}

function identityPriority(identityType: "GTIN" | "BRAND_MPN") {
  return identityType === "GTIN" ? 0 : 1;
}

function lowestPrice(offers: readonly ShopifyIdentityCandidate[]) {
  return Math.min(...offers.map((offer) => offer.itemPrice?.amountCents ?? Number.MAX_SAFE_INTEGER));
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
