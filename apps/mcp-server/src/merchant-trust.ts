import { isIP } from "node:net";

export type MerchantTrustLevel =
  | "OFFICIAL"
  | "AUTHORIZED_RETAILER"
  | "ESTABLISHED_RETAILER"
  | "UNKNOWN"
  | "RISKY";

export type MerchantTrustEvidence = {
  level: MerchantTrustLevel;
  verification: "INDEPENDENT" | "UNVERIFIED";
  evidence: string[];
  reviewedAt?: string;
};

export type ProductRating = {
  value: number;
  count: number;
  scaleMax: 5;
};

export type MerchantRecommendationTier =
  | "TRUSTED_OR_AFFILIATE"
  | "HIGH_RATED_UNVERIFIED"
  | "GENERAL_UNVERIFIED";

export const HIGH_PRODUCT_RATING_THRESHOLD = 3.8;
export const HIGH_PRODUCT_RATING_MIN_COUNT = 2;

export const MERCHANT_TRUST_REGISTRY_VERSION = "merchant-trust-2026-08-27";

type MerchantTrustRecord = {
  host: string;
  level: Exclude<MerchantTrustLevel, "UNKNOWN" | "RISKY">;
  evidenceUrl: string;
  reviewedAt: string;
  storefrontHost?: string;
  storefrontBrands?: readonly string[];
};

export type VerifiedOfficialStorefront = {
  host: string;
  brand: string;
};

// Every entry is an exact registrable host with manually reviewed merchant-identity evidence.
// Open marketplaces stay excluded until their individual seller identity can be verified.
const MERCHANT_TRUST_RECORDS: readonly MerchantTrustRecord[] = [
  // Official brand stores.
  { host: "electronics.sony.com", level: "OFFICIAL", evidenceUrl: "https://electronics.sony.com/", reviewedAt: "2026-08-20" },
  { host: "shopdoen.com", level: "OFFICIAL", evidenceUrl: "https://www.shopdoen.com/", reviewedAt: "2026-08-20", storefrontHost: "www.shopdoen.com", storefrontBrands: ["DÔEN", "DOEN"] },
  { host: "skims.com", level: "OFFICIAL", evidenceUrl: "https://skims.com/", reviewedAt: "2026-08-27", storefrontBrands: ["SKIMS", "NikeSKIMS"] },
  { host: "deathwishcoffee.com", level: "OFFICIAL", evidenceUrl: "https://www.deathwishcoffee.com/", reviewedAt: "2026-08-27", storefrontHost: "www.deathwishcoffee.com", storefrontBrands: ["Death Wish Coffee", "Death Wish"] },
  { host: "blkandbold.com", level: "OFFICIAL", evidenceUrl: "https://blkandbold.com/", reviewedAt: "2026-08-27", storefrontBrands: ["BLK & Bold", "BLK and Bold"] },
  { host: "vervecoffee.com", level: "OFFICIAL", evidenceUrl: "https://www.vervecoffee.com/", reviewedAt: "2026-08-27", storefrontHost: "www.vervecoffee.com", storefrontBrands: ["Verve Coffee", "Verve"] },
  { host: "fashionnova.com", level: "OFFICIAL", evidenceUrl: "https://www.fashionnova.com/", reviewedAt: "2026-08-20" },
  { host: "stevemadden.com", level: "OFFICIAL", evidenceUrl: "https://www.stevemadden.com/", reviewedAt: "2026-08-27", storefrontHost: "www.stevemadden.com", storefrontBrands: ["Steve Madden"] },
  { host: "apple.com", level: "OFFICIAL", evidenceUrl: "https://www.apple.com/", reviewedAt: "2026-08-24" },
  { host: "samsung.com", level: "OFFICIAL", evidenceUrl: "https://www.samsung.com/us/", reviewedAt: "2026-08-24" },
  { host: "microsoft.com", level: "OFFICIAL", evidenceUrl: "https://www.microsoft.com/en-us/store/b/home", reviewedAt: "2026-08-24" },
  { host: "dell.com", level: "OFFICIAL", evidenceUrl: "https://www.dell.com/en-us", reviewedAt: "2026-08-24" },
  { host: "hp.com", level: "OFFICIAL", evidenceUrl: "https://www.hp.com/us-en/shop", reviewedAt: "2026-08-24" },
  { host: "lenovo.com", level: "OFFICIAL", evidenceUrl: "https://www.lenovo.com/us/en/", reviewedAt: "2026-08-24" },
  { host: "nike.com", level: "OFFICIAL", evidenceUrl: "https://www.nike.com/", reviewedAt: "2026-08-24" },
  { host: "adidas.com", level: "OFFICIAL", evidenceUrl: "https://www.adidas.com/us/", reviewedAt: "2026-08-24" },
  { host: "patagonia.com", level: "OFFICIAL", evidenceUrl: "https://www.patagonia.com/", reviewedAt: "2026-08-24" },
  { host: "thenorthface.com", level: "OFFICIAL", evidenceUrl: "https://www.thenorthface.com/", reviewedAt: "2026-08-24" },
  { host: "allbirds.com", level: "OFFICIAL", evidenceUrl: "https://www.allbirds.com/", reviewedAt: "2026-08-27", storefrontHost: "www.allbirds.com", storefrontBrands: ["Allbirds"] },
  { host: "bombas.com", level: "OFFICIAL", evidenceUrl: "https://bombas.com/", reviewedAt: "2026-08-24" },
  { host: "brooklinen.com", level: "OFFICIAL", evidenceUrl: "https://www.brooklinen.com/", reviewedAt: "2026-08-27", storefrontHost: "www.brooklinen.com", storefrontBrands: ["Brooklinen"] },
  { host: "gymshark.com", level: "OFFICIAL", evidenceUrl: "https://www.gymshark.com/", reviewedAt: "2026-08-24" },
  { host: "glossier.com", level: "OFFICIAL", evidenceUrl: "https://www.glossier.com/", reviewedAt: "2026-08-27", storefrontHost: "www.glossier.com", storefrontBrands: ["Glossier"] },
  { host: "colourpop.com", level: "OFFICIAL", evidenceUrl: "https://colourpop.com/", reviewedAt: "2026-08-27", storefrontBrands: ["ColourPop", "Colour Pop"] },

  // Retailers with reviewed authorization evidence.
  { host: "expercom.com", level: "AUTHORIZED_RETAILER", evidenceUrl: "https://expercom.com/", reviewedAt: "2026-08-24" },
  { host: "clemsontigertechshop.com", level: "AUTHORIZED_RETAILER", evidenceUrl: "https://hdkb.clemson.edu/phpkb/article.php?id=1730", reviewedAt: "2026-08-24" },
  { host: "svacampusstore.com", level: "AUTHORIZED_RETAILER", evidenceUrl: "https://assets.sva.edu/download/welcome-week-schedule-sp22-v9-1639607385.pdf", reviewedAt: "2026-08-24" },

  // Established direct retailers. Marketplace-only domains are intentionally absent.
  { host: "bestbuy.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.bestbuy.com/", reviewedAt: "2026-08-24" },
  { host: "target.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.target.com/", reviewedAt: "2026-08-24" },
  { host: "walmart.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.walmart.com/", reviewedAt: "2026-08-24" },
  { host: "costco.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.costco.com/", reviewedAt: "2026-08-24" },
  { host: "bhphotovideo.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.bhphotovideo.com/find/b2b/AboutUs.jsp", reviewedAt: "2026-08-24" },
  { host: "adorama.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.adorama.com/g/about-adorama", reviewedAt: "2026-08-24" },
  { host: "microcenter.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.microcenter.com/", reviewedAt: "2026-08-24" },
  { host: "homedepot.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.homedepot.com/", reviewedAt: "2026-08-24" },
  { host: "lowes.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.lowes.com/", reviewedAt: "2026-08-24" },
  { host: "wayfair.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.wayfair.com/", reviewedAt: "2026-08-24" },
  { host: "nordstrom.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.nordstrom.com/", reviewedAt: "2026-08-24" },
  { host: "macys.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.macys.com/", reviewedAt: "2026-08-24" },
  { host: "rei.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.rei.com/", reviewedAt: "2026-08-24" },
  { host: "chewy.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.chewy.com/", reviewedAt: "2026-08-24" },
  { host: "petsmart.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.petsmart.com/", reviewedAt: "2026-08-24" },
  { host: "sephora.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.sephora.com/", reviewedAt: "2026-08-24" },
  { host: "ulta.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.ulta.com/", reviewedAt: "2026-08-24" },
  { host: "staples.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.staples.com/", reviewedAt: "2026-08-24" },
  { host: "officedepot.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.officedepot.com/", reviewedAt: "2026-08-24" },
  { host: "barnesandnoble.com", level: "ESTABLISHED_RETAILER", evidenceUrl: "https://www.barnesandnoble.com/", reviewedAt: "2026-08-24" }
];

export function resolveMerchantTrust(host: string, merchantName = ""): MerchantTrustEvidence {
  const normalized = normalizeHost(host);
  if (normalized === undefined || isRiskyHost(normalized)) {
    return {
      level: "RISKY",
      verification: "UNVERIFIED",
      evidence: ["merchant host failed public-domain safety checks"]
    };
  }
  const record = MERCHANT_TRUST_RECORDS.find((candidate) => candidate.host === normalized);
  if (record !== undefined) {
    return {
      level: record.level,
      verification: "INDEPENDENT",
      evidence: [`independently reviewed ${record.level.toLocaleLowerCase("en-US").replaceAll("_", " ")} domain: ${record.evidenceUrl}`],
      reviewedAt: record.reviewedAt
    };
  }
  return {
    level: "UNKNOWN",
    verification: "UNVERIFIED",
    evidence: [merchantName.toLocaleLowerCase("en-US").includes("official")
      ? "merchant self-description is not independent trust evidence"
      : "no independent merchant trust evidence"]
  };
}

export function isTrustedMerchant(value: MerchantTrustEvidence): boolean {
  return value.verification === "INDEPENDENT" && (
    value.level === "OFFICIAL" ||
    value.level === "AUTHORIZED_RETAILER" ||
    value.level === "ESTABLISHED_RETAILER"
  );
}

export function merchantTrustRank(value: MerchantTrustLevel): number {
  switch (value) {
    case "OFFICIAL": return 0;
    case "AUTHORIZED_RETAILER": return 1;
    case "ESTABLISHED_RETAILER": return 2;
    case "UNKNOWN": return 3;
    case "RISKY": return 4;
  }
}

export function resolveVerifiedOfficialStorefront(brand: string): VerifiedOfficialStorefront | undefined {
  const requested = normalizeBrand(brand);
  const record = MERCHANT_TRUST_RECORDS.find((candidate) =>
    candidate.level === "OFFICIAL" &&
    candidate.storefrontBrands?.some((alias) => normalizeBrand(alias) === requested) === true
  );
  if (record === undefined) return undefined;
  return { host: record.storefrontHost ?? record.host, brand: record.storefrontBrands?.[0] ?? brand.trim() };
}

export function isHighRatedProduct(rating: ProductRating | undefined): boolean {
  return rating !== undefined &&
    rating.value > HIGH_PRODUCT_RATING_THRESHOLD &&
    rating.count >= HIGH_PRODUCT_RATING_MIN_COUNT;
}

export function merchantRecommendationTier(
  trust: MerchantTrustEvidence,
  rating: ProductRating | undefined,
  affiliateApproved = false
): MerchantRecommendationTier {
  if (affiliateApproved || isTrustedMerchant(trust)) return "TRUSTED_OR_AFFILIATE";
  return isHighRatedProduct(rating) ? "HIGH_RATED_UNVERIFIED" : "GENERAL_UNVERIFIED";
}

export function merchantRecommendationRank(tier: MerchantRecommendationTier): number {
  switch (tier) {
    case "TRUSTED_OR_AFFILIATE": return 0;
    case "HIGH_RATED_UNVERIFIED": return 1;
    case "GENERAL_UNVERIFIED": return 2;
  }
}

function normalizeHost(value: string): string | undefined {
  const normalized = value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\.$/u, "");
  if (normalized === "" || normalized.length > 253 || /[^a-z0-9.:[\]-]/u.test(normalized)) return undefined;
  return normalized.startsWith("www.") ? normalized.slice(4) : normalized;
}

function normalizeBrand(value: string): string {
  return value.normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "");
}

function isRiskyHost(host: string): boolean {
  const ipCandidate = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return isIP(ipCandidate) !== 0 || host === "localhost" || host.endsWith(".localhost") ||
    host.split(".").some((label) => label.startsWith("xn--"));
}
