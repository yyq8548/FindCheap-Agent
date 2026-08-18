import {
  createShopifyStorefrontReader,
  type ShopifyStorefrontReaderConfig
} from "../../../packages/merchant-adapters/src/configured/shopify-storefront-reader.js";
import type { ReaderDependencies } from "../../../packages/merchant-adapters/src/configured/feed-reader.js";

const PILOT: { host: string; merchant: string; apiVersion: ShopifyStorefrontReaderConfig["apiVersion"] } = {
  host: "deathwishcoffee.com",
  merchant: "Death Wish Coffee",
  apiVersion: "2026-07"
};

export type ShopifySearchInput = {
  query?: string | undefined;
  handle?: string | undefined;
  limit: number;
};

export type ShopifyProduct = {
  handle: string;
  title: string;
  brand?: string;
  sku?: string;
  gtins: string[];
  imageUrl?: string;
  itemPrice?: { amountCents: number; currency: "USD" };
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  merchantUrl: string;
  checkedAt: string;
};

export interface ShopifyPort {
  search(input: ShopifySearchInput): Promise<{ merchant: string; products: ShopifyProduct[] }>;
}

export function createShopifyPortFromEnvironment(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
  dependencies: ReaderDependencies = {}
): ShopifyPort {
  if (environment.SHOPIFY_STOREFRONT_HOST?.trim().toLowerCase() !== PILOT.host) {
    return unavailablePort();
  }
  const reader = createShopifyStorefrontReader([PILOT.host, `www.${PILOT.host}`], {
    host: PILOT.host,
    apiVersion: PILOT.apiVersion
  }, dependencies);
  return {
    async search(input) {
      const snapshot = input.handle === undefined
        ? await reader.capture({ operation: "search", query: input.query ?? "", limit: input.limit })
        : await reader.capture({ operation: "get", merchantProductId: input.handle });
      return {
        merchant: PILOT.merchant,
        products: snapshot.records.map((record) => ({
          handle: record.merchantProductId,
          title: record.title,
          ...(record.brand === undefined ? {} : { brand: record.brand }),
          ...(record.mpn === undefined ? {} : { sku: record.mpn }),
          gtins: record.gtins,
          ...(record.imageUrl === undefined ? {} : { imageUrl: record.imageUrl }),
          ...(record.rawOffer?.price === undefined
            ? {}
            : { itemPrice: { amountCents: decimalToCents(record.rawOffer.price), currency: "USD" as const } }),
          availability: record.rawOffer?.availability === "IN_STOCK"
            ? "IN_STOCK" as const
            : record.rawOffer?.availability === "OUT_OF_STOCK"
              ? "OUT_OF_STOCK" as const
              : "UNKNOWN" as const,
          merchantUrl: record.rawOffer?.url ?? snapshot.sourceUrl,
          checkedAt: snapshot.checkedAt
        }))
      };
    }
  };
}

export function createUnavailableShopifyPort(): ShopifyPort {
  return unavailablePort();
}

function unavailablePort(): ShopifyPort {
  return {
    async search() {
      throw new Error("DATA_SOURCE_UNAVAILABLE");
    }
  };
}

function decimalToCents(value: string | number): number {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/u.test(text)) throw new Error("Shopify price is invalid");
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("Shopify price is outside supported range");
  return cents;
}
