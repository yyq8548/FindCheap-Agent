import { createHash } from "node:crypto";
import type { AwinProduct } from "../../../packages/awin-feed/src/index.js";
import type { EbayProduct } from "./ebay-client.js";
import type { ShopifyProduct } from "./shopify-client.js";
import type { UnifiedCandidate } from "./search-products.js";
import { productReferenceKey } from "./product-reference.js";

export const visualQueryHash = (value: string): string => createHash("sha256").update(value).digest("hex");
export function sourceProductFingerprint(source: "AWIN" | "SHOPIFY" | "EBAY", product: AwinProduct | ShopifyProduct | EbayProduct): { productHash: string } {
  let reference;
  if (source === "AWIN") {
    const value = product as AwinProduct;
    reference = { sourceKind: "AWIN_PRODUCT_FEED" as const, merchantId: value.merchantId,
      sourceHost: new URL(value.merchantUrl).hostname, handle: value.merchantProductId };
  } else if (source === "EBAY") {
    const value = product as EbayProduct;
    reference = { sourceKind: "EBAY_BROWSE" as const, merchantId: `ebay:${value.sellerName}`,
      sourceHost: value.environment === "SANDBOX" ? "www.sandbox.ebay.com" : "www.ebay.com", handle: value.itemId };
  } else reference = product as ShopifyProduct;
  return { productHash: visualQueryHash(productReferenceKey(reference)) };
}
export function candidateFingerprint(candidate: UnifiedCandidate): { productHash: string } {
  return candidate.source === "AWIN_PRODUCT_FEED" ? sourceProductFingerprint("AWIN", candidate.awinProduct)
    : candidate.source === "EBAY_BROWSE" ? sourceProductFingerprint("EBAY", candidate.ebayProduct)
      : sourceProductFingerprint("SHOPIFY", candidate.shopifyProduct);
}
