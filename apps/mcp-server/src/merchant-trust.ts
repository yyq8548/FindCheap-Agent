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

export const MERCHANT_TRUST_REGISTRY_VERSION = "merchant-trust-2026-08-20";

type MerchantTrustRecord = {
  host: string;
  level: Exclude<MerchantTrustLevel, "UNKNOWN" | "RISKY">;
  evidenceUrl: string;
  reviewedAt: string;
};

// Trust records affect ranking only. They never limit Shopify Global Catalog search coverage.
// Every entry is an exact registrable host reviewed from the brand's own public website.
const MERCHANT_TRUST_RECORDS: readonly MerchantTrustRecord[] = [
  { host: "electronics.sony.com", level: "OFFICIAL", evidenceUrl: "https://electronics.sony.com/", reviewedAt: "2026-08-20" },
  { host: "shopdoen.com", level: "OFFICIAL", evidenceUrl: "https://www.shopdoen.com/", reviewedAt: "2026-08-20" },
  { host: "deathwishcoffee.com", level: "OFFICIAL", evidenceUrl: "https://www.deathwishcoffee.com/", reviewedAt: "2026-08-20" },
  { host: "blkandbold.com", level: "OFFICIAL", evidenceUrl: "https://blkandbold.com/", reviewedAt: "2026-08-20" },
  { host: "vervecoffee.com", level: "OFFICIAL", evidenceUrl: "https://www.vervecoffee.com/", reviewedAt: "2026-08-20" },
  { host: "fashionnova.com", level: "OFFICIAL", evidenceUrl: "https://www.fashionnova.com/", reviewedAt: "2026-08-20" },
  { host: "stevemadden.com", level: "OFFICIAL", evidenceUrl: "https://www.stevemadden.com/", reviewedAt: "2026-08-20" }
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
      evidence: [`independently reviewed official domain: ${record.evidenceUrl}`],
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

function normalizeHost(value: string): string | undefined {
  const normalized = value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\.$/u, "");
  if (normalized === "" || normalized.length > 253 || /[^a-z0-9.:[\]-]/u.test(normalized)) return undefined;
  return normalized.startsWith("www.") ? normalized.slice(4) : normalized;
}

function isRiskyHost(host: string): boolean {
  const ipCandidate = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return isIP(ipCandidate) !== 0 || host === "localhost" || host.endsWith(".localhost") ||
    host.split(".").some((label) => label.startsWith("xn--"));
}
