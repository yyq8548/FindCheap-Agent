import type { AffiliateLinkResolver } from "./affiliate-links.js";
import type { AwinShopifyQuoteResolver } from "./awin-shopify-quote.js";
import type { DealPort } from "./deal-client.js";
import type { EbayBrowsePort } from "./ebay-client.js";
import type { MerchantTrustRegistryPort } from "./merchant-trust-registry-client.js";
import type { OfficialStorefrontRegistryPort } from "./official-storefront-registry-client.js";
import type { OfficialShopifySearchPort } from "./shopify-official-store-search.js";
import type { ShopifyCartQuotePort } from "./shopify-cart-quote.js";
import type { ShopifyPort } from "./shopify-client.js";
import type { ShopifySelectedProductInspector } from "./shopify-selected-product.js";
import type { VisualCandidateImagePort } from "./visual-candidate-images.js";
import type { WatchStore } from "./watch-store.js";
import type { AwinProductPort } from "../../../packages/awin-feed/src/index.js";
import type { BackendCapability } from "./execution/capabilities.js";

export type CatalogBackend = {
  shopify: ShopifyPort;
  awin: AwinProductPort;
  ebay?: EbayBrowsePort;
  officialShopify?: OfficialShopifySearchPort;
  officialStorefrontRegistry?: OfficialStorefrontRegistryPort;
  merchantTrustRegistry?: MerchantTrustRegistryPort;
};

export type ProductBackend = {
  affiliateLinks: AffiliateLinkResolver;
  awinShopifyQuotes?: AwinShopifyQuoteResolver;
  cartQuotes?: ShopifyCartQuotePort;
  selectedProducts?: ShopifySelectedProductInspector;
};

export type FindCheapBackend = {
  catalog: CatalogBackend;
  product: ProductBackend;
  deals: DealPort;
  watches: WatchStore;
  visualCandidateImages?: VisualCandidateImagePort;
  capabilities: ReadonlySet<BackendCapability>;
};

export type FindCheapBackendInput = Omit<FindCheapBackend, "capabilities"> & {
  verifiedDeals: boolean;
};

export function createFindCheapBackend(input: FindCheapBackendInput): FindCheapBackend {
  const capabilities = new Set<BackendCapability>([
    "CATALOG",
    "WATCHES",
    ...(input.product.selectedProducts === undefined ? [] : ["PRODUCT_INSPECTION" as const]),
    ...(input.product.cartQuotes === undefined ? [] : ["PRODUCT_QUOTE" as const]),
    ...(input.visualCandidateImages === undefined ? [] : ["VISUAL_SEARCH" as const]),
    ...(input.verifiedDeals ? ["VERIFIED_DEALS" as const] : [])
  ]);
  return {
    catalog: input.catalog,
    product: input.product,
    deals: input.deals,
    watches: input.watches,
    ...(input.visualCandidateImages === undefined
      ? {}
      : { visualCandidateImages: input.visualCandidateImages }),
    capabilities
  };
}
