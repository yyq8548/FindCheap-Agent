import type { ShopifyProduct } from "./shopify-client.js";
import type { UnifiedCandidate } from "./search-products.js";
import { productReferenceKey } from "./product-reference.js";
import { wooProductFacts } from "./woocommerce-product.js";

export type SnapshotSourceProduct =
  | { sourceKind: "SHOPIFY_GLOBAL_CATALOG"; product: ShopifyProduct }
  | { sourceKind: "AWIN_PRODUCT_FEED"; product: NonNullable<UnifiedCandidate["awinProduct"]> }
  | { sourceKind: "EBAY_BROWSE"; product: NonNullable<UnifiedCandidate["ebayProduct"]> }
  | { sourceKind: "WOOCOMMERCE_STORE_API"; product: NonNullable<UnifiedCandidate["woocommerceProduct"]> };

/** Snapshot-owned source observations. No lookup may search another snapshot. */
export function snapshotProductIndex(shopify: readonly ShopifyProduct[], candidates: readonly UnifiedCandidate[] = []) {
  const index = new Map<string, SnapshotSourceProduct>(shopify.map(product => [productReferenceKey(product), { sourceKind: "SHOPIFY_GLOBAL_CATALOG", product }]));
  for (const candidate of candidates) {
    if (candidate.source === "WOOCOMMERCE_STORE_API") index.set(productReferenceKey(wooProductFacts(candidate.woocommerceProduct)), { sourceKind: candidate.source, product: candidate.woocommerceProduct });
    else if (candidate.source === "SHOPIFY_GLOBAL_CATALOG") index.set(productReferenceKey(candidate.shopifyProduct), { sourceKind: candidate.source, product: candidate.shopifyProduct });
    else if (candidate.source === "AWIN_PRODUCT_FEED") {
      const product = candidate.awinProduct;
      index.set(productReferenceKey({ sourceKind: candidate.source, merchantId: product.merchantId, sourceHost: new URL(product.merchantUrl).hostname, handle: product.merchantProductId }), { sourceKind: candidate.source, product });
    } else {
      const product = candidate.ebayProduct;
      index.set(productReferenceKey({ sourceKind: candidate.source, merchantId: `ebay:${product.sellerName}`, sourceHost: new URL(product.merchantUrl).hostname, handle: product.productRef }), { sourceKind: candidate.source, product });
    }
  }
  return new Map([...index].map(([key, observation]) => [key, structuredClone(observation)]));
}
