type ProductReference = {
  sourceKind?: "AWIN_PRODUCT_FEED" | "SHOPIFY_GLOBAL_CATALOG" | "EBAY_BROWSE" | "WEB_PRODUCT_PAGE" | undefined;
  merchantId: string;
  sourceHost: string;
  handle: string;
};

/** Variant handles are only unique within their source and merchant. */
export function productReferenceKey(product: ProductReference): string {
  return JSON.stringify([
    product.sourceKind ?? "SHOPIFY_GLOBAL_CATALOG",
    product.merchantId,
    product.sourceHost.toLowerCase(),
    product.handle
  ]);
}
