import { isAbsolute } from "node:path";

import { parseEbayBrowseEnvironment, type EbayBrowseEnvironment } from "./ebay-browse.js";

export type AwinFeedServiceEnvironment = {
  sourceUrls: string[];
  sourceFeedListUrl?: string;
  sourceFeedRegion: string;
  sourceFeedLanguage: string;
  sourceAllowedHosts: string[];
  apiToken: string;
  dataPath: string;
  refreshIntervalMs: number;
  sourceTimeoutMs: number;
  offers?: {
    apiToken: string;
    publisherId: string;
    dataPath: string;
    refreshIntervalMs: number;
    sourceTimeoutMs: number;
  };
  ebay?: EbayBrowseEnvironment;
  host: "127.0.0.1" | "::1" | "0.0.0.0" | "::";
  port: number;
};

export function parseAwinFeedServiceEnvironment(
  input: Readonly<Record<string, string | undefined>>
): AwinFeedServiceEnvironment {
  const sourceAllowedHosts = (input.AWIN_SOURCE_ALLOWED_HOSTS ?? "productdata.awin.com,datafeed.api.productserve.com,ui.awin.com")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== "");
  if (
    sourceAllowedHosts.length === 0 ||
    new Set(sourceAllowedHosts).size !== sourceAllowedHosts.length ||
    sourceAllowedHosts.some((host) => !/^[a-z0-9.-]+$/u.test(host))
  ) {
    throw new Error("AWIN_SOURCE_ALLOWED_HOSTS must contain unique comma-separated hostnames");
  }
  const sourceValues = [
    input.AWIN_SOURCE_FEED_URL,
    ...Array.from({ length: 9 }, (_unused, index) => input[`AWIN_SOURCE_FEED_URL_${index + 2}`])
  ].map((value) => value?.trim()).filter((value): value is string => value !== undefined && value !== "");
  const sourceUrls = sourceValues.map((sourceValue) => validateAwinSourceUrl(sourceValue, sourceAllowedHosts));
  if (new Set(sourceUrls).size !== sourceUrls.length) {
    throw new Error("Awin source Feed URLs must be unique");
  }
  const feedListValue = input.AWIN_SOURCE_FEED_LIST_URL?.trim();
  const sourceFeedListUrl = feedListValue === undefined || feedListValue === ""
    ? undefined
    : validateAwinSourceUrl(feedListValue, sourceAllowedHosts);
  if (sourceUrls.length === 0 && sourceFeedListUrl === undefined) {
    throw new Error("AWIN_SOURCE_FEED_LIST_URL or AWIN_SOURCE_FEED_URL is required");
  }
  const sourceFeedRegion = input.AWIN_SOURCE_FEED_REGION?.trim().toUpperCase() || "US";
  if (!/^[A-Z]{2}$/u.test(sourceFeedRegion)) {
    throw new Error("AWIN_SOURCE_FEED_REGION must be a two-letter region code");
  }
  const sourceFeedLanguage = input.AWIN_SOURCE_FEED_LANGUAGE?.trim() || "English";
  if (sourceFeedLanguage.length < 2 || sourceFeedLanguage.length > 40) {
    throw new Error("AWIN_SOURCE_FEED_LANGUAGE must contain 2 through 40 characters");
  }
  const apiToken = input.AWIN_FEED_API_TOKEN;
  if (apiToken === undefined || apiToken.length < 32 || apiToken.length > 512) {
    throw new Error("AWIN_FEED_API_TOKEN must contain 32 through 512 characters");
  }
  const dataPath = input.AWIN_FEED_DATA_PATH ?? "/data/current.csv.gz";
  if (!isAbsolute(dataPath) || !dataPath.toLowerCase().endsWith(".csv.gz")) {
    throw new Error("AWIN_FEED_DATA_PATH must be an absolute .csv.gz path");
  }
  const refreshIntervalMinutes = integerInRange(
    input.AWIN_REFRESH_INTERVAL_MINUTES ?? "360",
    15,
    1_440,
    "AWIN_REFRESH_INTERVAL_MINUTES"
  );
  const sourceTimeoutMs = integerInRange(
    input.AWIN_SOURCE_TIMEOUT_MS ?? "15000",
    1_000,
    60_000,
    "AWIN_SOURCE_TIMEOUT_MS"
  );
  const offersToken = input.AWIN_API_TOKEN?.trim();
  const offers = offersToken === undefined || offersToken === ""
    ? undefined
    : {
        apiToken: validSecret(offersToken, "AWIN_API_TOKEN"),
        publisherId: validPublisherId(input.AWIN_PUBLISHER_ID?.trim() || "3047955"),
        dataPath: validJsonPath(input.AWIN_OFFERS_DATA_PATH ?? "/data/offers.json"),
        refreshIntervalMs: integerInRange(
          input.AWIN_OFFERS_REFRESH_INTERVAL_MINUTES ?? "60",
          15,
          1_440,
          "AWIN_OFFERS_REFRESH_INTERVAL_MINUTES"
        ) * 60_000,
        sourceTimeoutMs: integerInRange(
          input.AWIN_OFFERS_TIMEOUT_MS ?? "15000",
          1_000,
          60_000,
          "AWIN_OFFERS_TIMEOUT_MS"
        )
      };
  const ebay = parseEbayBrowseEnvironment(input);
  const port = integerInRange(input.AWIN_FEED_SERVICE_PORT ?? input.PORT ?? "3010", 1, 65_535, "service port");
  const host = input.AWIN_FEED_SERVICE_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1" && host !== "0.0.0.0" && host !== "::") {
    throw new Error("AWIN_FEED_SERVICE_HOST must be a supported bind address");
  }
  return {
    sourceUrls,
    ...(sourceFeedListUrl === undefined ? {} : { sourceFeedListUrl }),
    sourceFeedRegion,
    sourceFeedLanguage,
    sourceAllowedHosts,
    apiToken,
    dataPath,
    refreshIntervalMs: refreshIntervalMinutes * 60_000,
    sourceTimeoutMs,
    ...(offers === undefined ? {} : { offers }),
    ...(ebay === undefined ? {} : { ebay }),
    host,
    port
  };
}

function validSecret(value: string, name: string): string {
  if (value.length < 32 || value.length > 4_096) {
    throw new Error(`${name} must contain 32 through 4096 characters`);
  }
  return value;
}

function validPublisherId(value: string): string {
  if (!/^\d{1,20}$/u.test(value)) throw new Error("AWIN_PUBLISHER_ID must be numeric");
  return value;
}

function validJsonPath(value: string): string {
  if (!isAbsolute(value) || !value.toLowerCase().endsWith(".json")) {
    throw new Error("AWIN_OFFERS_DATA_PATH must be an absolute .json path");
  }
  return value;
}

export function validateAwinSourceUrl(value: string, allowedHosts: readonly string[]): string {
  const sourceUrl = new URL(value);
  const host = sourceUrl.hostname.toLowerCase();
  if (
    (sourceUrl.protocol !== "https:" && sourceUrl.protocol !== "http:") ||
    sourceUrl.username !== "" ||
    sourceUrl.password !== "" ||
    sourceUrl.port !== "" ||
    !allowedHosts.includes(host)
  ) {
    throw new Error("Awin source Feed URLs must use HTTPS on an allowed host");
  }
  sourceUrl.protocol = "https:";
  return sourceUrl.href;
}

function integerInRange(value: string, minimum: number, maximum: number, name: string): number {
  if (!/^\d+$/u.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}
