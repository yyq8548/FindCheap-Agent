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

const TRANSIENT_BROWSER_ERROR =
  /(?:CDP operation exceeded its deadline|waiting for CDP command|playwright\.evaluate exceeded its deadline|Playwright selector deadline exceeded|Page\.createIsolatedWorld|Page\.getFrameTree|Runtime\.evaluate)/iu;

export function classifyGoldenObservation(
  expectation: GoldenExpectation,
  observation: BrowserObservation
): boolean {
  if (expectation.expectedPageType !== undefined && expectation.expectedPageType !== observation.pageType) {
    return false;
  }

  const products = observation.products.filter(hasAllowedBestBuyUrl);
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

function includesToken(value: string, token: string): boolean {
  const normalizedToken = normalizeToken(token);
  return normalizedToken.length > 0 && normalizeToken(value).includes(normalizedToken);
}

function normalizeToken(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, "");
}

function hasAllowedBestBuyUrl(product: BrowserProductObservation): boolean {
  try {
    return new URL(product.url).hostname === "www.bestbuy.com";
  } catch {
    return false;
  }
}
