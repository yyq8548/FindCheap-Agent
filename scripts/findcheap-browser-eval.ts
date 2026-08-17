import { isIP } from "node:net";

export type BrowserPageType = "SEARCH" | "DETAIL";

export type BrowserProductObservation = {
  title: string;
  url: string;
};

export type GoldenExpectation = {
  expectedOutcome: "EXACT" | "AMBIGUOUS" | "NO_RESULT";
  expectedPageType?: BrowserPageType;
  expectedTokens: string[];
  relevanceTokens?: string[];
};

export type BrowserObservation = {
  pageType: BrowserPageType;
  products: BrowserProductObservation[];
};

export type BrowserRankCandidate = BrowserProductObservation & {
  merchant: string;
  sellerType: "DIRECT" | "MARKETPLACE";
  match: "EXACT" | "SIMILAR" | "UNCONFIRMED";
  variantMatch: boolean | undefined;
  itemPriceCents: number | undefined;
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
};

const TRANSIENT_BROWSER_ERROR =
  /(?:CDP operation exceeded its deadline|waiting for CDP command|playwright\.evaluate exceeded its deadline|Playwright selector deadline exceeded|Page\.createIsolatedWorld|Page\.getFrameTree|Runtime\.evaluate)/iu;

export function classifyGoldenObservation(
  expectation: GoldenExpectation,
  observation: BrowserObservation
): boolean {
  if (expectation.expectedPageType !== undefined && expectation.expectedPageType !== observation.pageType) {
    return false;
  }

  const products = observation.products.filter(hasAllowedMerchantUrl);
  if (expectation.expectedOutcome === "AMBIGUOUS") return products.length >= 2;
  if (expectation.expectedOutcome === "NO_RESULT") {
    const relevanceTokens = expectation.relevanceTokens ?? [];
    if (relevanceTokens.length === 0) return products.length === 0;
    return products.every((product) => !relevanceTokens.some((token) => includesToken(product.title, token)));
  }

  return products.some((product) =>
    expectation.expectedTokens.every((token) => includesToken(product.title, token))
  );
}

export async function runWithSingleTransientRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientBrowserError(error)) throw error;
    return operation();
  }
}

export function isTransientBrowserError(error: unknown): boolean {
  return error instanceof Error && TRANSIENT_BROWSER_ERROR.test(error.message);
}

export function selectBestVerifiedOptions(
  candidates: readonly BrowserRankCandidate[],
  limit = 3
): BrowserRankCandidate[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 3) {
    throw new Error("limit must be an integer from 1 to 3");
  }

  const sorted = candidates
    .filter((candidate) => candidate.match === "EXACT")
    .filter((candidate) => candidate.variantMatch !== false)
    .filter(hasAllowedMerchantUrl)
    .toSorted(compareRankCandidates);
  const selected: BrowserRankCandidate[] = [];
  const seenMerchants = new Set<string>();

  for (const candidate of sorted) {
    const merchantKey = candidate.merchant.normalize("NFKC").trim().toLocaleLowerCase("en-US");
    if (merchantKey.length === 0 || seenMerchants.has(merchantKey)) continue;
    seenMerchants.add(merchantKey);
    selected.push(candidate);
    if (selected.length === limit) break;
  }

  return selected;
}

function includesToken(value: string, token: string): boolean {
  const normalizedToken = normalizeToken(token);
  return normalizedToken.length > 0 && normalizeToken(value).includes(normalizedToken);
}

function normalizeToken(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, "");
}

function compareRankCandidates(left: BrowserRankCandidate, right: BrowserRankCandidate): number {
  return sellerRank(left.sellerType) - sellerRank(right.sellerType)
    || availabilityRank(left.availability) - availabilityRank(right.availability)
    || priceRank(left.itemPriceCents) - priceRank(right.itemPriceCents)
    || compareCodeUnits(left.merchant, right.merchant)
    || compareCodeUnits(left.url, right.url);
}

function sellerRank(value: BrowserRankCandidate["sellerType"]): number {
  return value === "DIRECT" ? 0 : 1;
}

function availabilityRank(value: BrowserRankCandidate["availability"]): number {
  if (value === "IN_STOCK") return 0;
  if (value === "UNKNOWN") return 1;
  return 2;
}

function priceRank(value: number | undefined): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? value
    : Number.MAX_SAFE_INTEGER;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const DISCOVERY_OR_SHORTENER_HOSTS = [
  "google.com",
  "bing.com",
  "duckduckgo.com",
  "search.yahoo.com",
  "t.co",
  "bit.ly",
  "tinyurl.com"
] as const;

function hasAllowedMerchantUrl(product: BrowserProductObservation): boolean {
  try {
    const url = new URL(product.url);
    const hostname = url.hostname.toLocaleLowerCase("en-US");
    return url.protocol === "https:"
      && url.username === ""
      && url.password === ""
      && hostname.includes(".")
      && !hostname.endsWith(".")
      && isIP(hostname.replace(/^\[|\]$/gu, "")) === 0
      && !DISCOVERY_OR_SHORTENER_HOSTS.some(
        (blockedHost) => hostname === blockedHost || hostname.endsWith(`.${blockedHost}`)
      );
  } catch {
    return false;
  }
}
