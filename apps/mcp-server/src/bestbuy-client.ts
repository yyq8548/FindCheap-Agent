import {
  createBestBuyProductsReader,
  type BestBuyProductsReaderDependencies
} from "../../../packages/merchant-adapters/src/configured/bestbuy-products-reader.js";

export type BestBuySearchInput = {
  query?: string | undefined;
  sku?: string | undefined;
  limit: number;
};

export type BestBuyProduct = {
  sku: string;
  title: string;
  brand?: string;
  modelNumber?: string;
  gtins: string[];
  imageUrl?: string;
  itemPrice?: { amountCents: number; currency: "USD" };
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  merchantUrl: string;
  checkedAt: string;
};

export interface BestBuyPort {
  search(input: BestBuySearchInput): Promise<{ products: BestBuyProduct[] }>;
}

export function createBestBuyPortFromEnvironment(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
  dependencies: Omit<BestBuyProductsReaderDependencies, "apiKey"> = {}
): BestBuyPort {
  const apiKey = environment.BEST_BUY_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") return unavailablePort();
  let reader: ReturnType<typeof createBestBuyProductsReader>;
  try {
    reader = createBestBuyProductsReader(["api.bestbuy.com"], {
      ...dependencies,
      apiKey
    });
  } catch {
    return unavailablePort();
  }

  return {
    async search(input) {
      const snapshot = input.sku === undefined
        ? await reader.capture({ operation: "search", query: input.query ?? "", limit: input.limit })
        : await reader.capture({ operation: "get", merchantProductId: input.sku });
      return {
        products: snapshot.records.map((record) => ({
          sku: record.merchantProductId,
          title: record.title,
          ...(record.brand === undefined ? {} : { brand: record.brand }),
          ...(record.mpn === undefined ? {} : { modelNumber: record.mpn }),
          gtins: record.gtins,
          ...(record.imageUrl === undefined ? {} : { imageUrl: record.imageUrl }),
          ...(record.rawOffer?.price === undefined
            ? {}
            : { itemPrice: { amountCents: Math.round(Number(record.rawOffer.price) * 100), currency: "USD" as const } }),
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

export function createUnavailableBestBuyPort(): BestBuyPort {
  return unavailablePort();
}

function unavailablePort(): BestBuyPort {
  return {
    async search() {
      throw new Error("DATA_SOURCE_UNAVAILABLE");
    }
  };
}
