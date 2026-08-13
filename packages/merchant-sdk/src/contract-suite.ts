import type { MerchantAdapter, SearchProductsInput } from "./types.js";

export type ContractFixtures = { search: SearchProductsInput };

export type MerchantContractReport = {
  merchantId: string;
  failures: string[];
};

function parseUnambiguousTimestamp(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (match === null) {
    return undefined;
  }

  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const numericHour = Number(hour);
  const numericMinute = Number(minute);
  const numericSecond = Number(second);
  const numericOffsetHour = offsetHour === undefined ? 0 : Number(offsetHour);
  const numericOffsetMinute = offsetMinute === undefined ? 0 : Number(offsetMinute);
  const isLeapYear = numericYear % 4 === 0 && (numericYear % 100 !== 0 || numericYear % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const monthLength = daysInMonth[numericMonth - 1];

  if (
    numericMonth < 1 || numericMonth > 12 || monthLength === undefined ||
    numericDay < 1 || numericDay > monthLength || numericHour > 23 ||
    numericMinute > 59 || numericSecond > 59 || numericOffsetHour > 23 ||
    numericOffsetMinute > 59
  ) {
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

  return { merchantId: adapter.merchantId, failures };
}
