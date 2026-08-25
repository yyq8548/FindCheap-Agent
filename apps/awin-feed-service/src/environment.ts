import { isAbsolute } from "node:path";

export type AwinFeedServiceEnvironment = {
  sourceUrls: string[];
  sourceAllowedHosts: string[];
  apiToken: string;
  dataPath: string;
  refreshIntervalMs: number;
  sourceTimeoutMs: number;
  host: "127.0.0.1" | "::1" | "0.0.0.0" | "::";
  port: number;
};

export function parseAwinFeedServiceEnvironment(
  input: Readonly<Record<string, string | undefined>>
): AwinFeedServiceEnvironment {
  const sourceAllowedHosts = (input.AWIN_SOURCE_ALLOWED_HOSTS ?? "productdata.awin.com,datafeed.api.productserve.com")
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
  if (sourceValues.length === 0) {
    throw new Error("AWIN_SOURCE_FEED_URL is required");
  }
  const sourceUrls = sourceValues.map((sourceValue) => {
    const sourceUrl = new URL(sourceValue);
    if (
      sourceUrl.protocol !== "https:" ||
      sourceUrl.username !== "" ||
      sourceUrl.password !== "" ||
      sourceUrl.port !== "" ||
      !sourceAllowedHosts.includes(sourceUrl.hostname.toLowerCase())
    ) {
      throw new Error("Awin source Feed URLs must use HTTPS on an allowed host");
    }
    return sourceUrl.href;
  });
  if (new Set(sourceUrls).size !== sourceUrls.length) {
    throw new Error("Awin source Feed URLs must be unique");
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
  const port = integerInRange(input.AWIN_FEED_SERVICE_PORT ?? input.PORT ?? "3010", 1, 65_535, "service port");
  const host = input.AWIN_FEED_SERVICE_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1" && host !== "0.0.0.0" && host !== "::") {
    throw new Error("AWIN_FEED_SERVICE_HOST must be a supported bind address");
  }
  return {
    sourceUrls,
    sourceAllowedHosts,
    apiToken,
    dataPath,
    refreshIntervalMs: refreshIntervalMinutes * 60_000,
    sourceTimeoutMs,
    host,
    port
  };
}

function integerInRange(value: string, minimum: number, maximum: number, name: string): number {
  if (!/^\d+$/u.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}
