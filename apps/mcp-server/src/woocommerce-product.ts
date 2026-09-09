import type { WooProduct } from "../../../packages/contracts/src/woocommerce.js";
import { isBoundWooProductUrl, normalizedWooAttributeName, normalizedWooAttributeValue } from "../../../packages/contracts/src/woocommerce-product-url.js";
import type { ShopifyProduct } from "./shopify-client.js";
import { resolveMerchantTrust } from "./merchant-trust.js";
import type { UnifiedCandidate } from "./search-products.js";

/** Common assessment facts, never a Shopify source observation or quote target. */
export type CatalogProductFacts = Omit<ShopifyProduct, "sourceKind" | "cartQuote">;
export type WooProductFacts = CatalogProductFacts & { sourceKind: "WOOCOMMERCE_STORE_API" };

export function dealProductId(product: { sourceKind?: string | undefined; merchantId: string; handle: string }): string {
  return product.sourceKind === "WOOCOMMERCE_STORE_API" ? `woocommerce:${product.merchantId}:${product.handle}` : product.handle;
}

export function candidateProductFacts(candidate: UnifiedCandidate) {
  return candidate.source === "WOOCOMMERCE_STORE_API" ? wooProductFacts(candidate.woocommerceProduct)
    : candidate.awinProduct ?? candidate.shopifyProduct ?? candidate.ebayProduct;
}

/** Only extracts a public URL to be resolved against the source service's
 * registry. This does not grant access to the origin or establish trust. */
export function wooProductUrl(query: string): string | undefined {
  try {
    if (!/^https:\/\//iu.test(query) || /\s|\\/u.test(query)) return undefined;
    const url = new URL(query);
    if (url.username || url.password || url.port || url.hash) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function matchesWooProductUrl(product: WooProduct, value: string): boolean {
  if (!isBoundWooProductUrl({ ...product, merchantUrl: value })) return false;
  let target: URL, observed: URL;
  try { target = new URL(value); observed = new URL(product.merchantUrl); } catch { return false; }
  if (target.username || target.password || target.port || target.hash) return false;
  if (target.origin !== observed.origin || target.pathname.replace(/\/$/u, "") !== observed.pathname.replace(/\/$/u, "")) return false;
  for (const [key, parameter] of target.searchParams) {
    if (key === "variation_id" && String(product.variationId) !== parameter) return false;
    if (key.startsWith("attribute_")) {
      const selected = Object.entries(product.selectedAttributes).find(([name]) => normalizedWooAttributeName(name) === normalizedWooAttributeName(key));
      if (selected === undefined || normalizedWooAttributeValue(selected[1]) !== normalizedWooAttributeValue(parameter)) return false;
    } else if (key !== "variation_id" && !/^utm_/u.test(key) && !["gclid", "fbclid", "srsltid"].includes(key) && observed.searchParams.get(key) !== parameter) return false;
  }
  return true;
}

export function wooProductFacts(product: WooProduct): WooProductFacts {
  return {
    sourceKind: "WOOCOMMERCE_STORE_API", merchantId: product.merchantId, merchant: product.merchantName,
    sourceHost: product.sourceHost, merchantTrust: resolveMerchantTrust(product.sourceHost, product.merchantName),
    handle: String(product.variationId ?? product.productId), title: product.title,
    productType: product.category, description: [product.description, ...product.attributes].filter(Boolean).join("\n"),
    ...(product.brand === undefined ? {} : { brand: product.brand }),
    ...(product.sku === undefined ? {} : { sku: product.sku }),
    ...(product.mpn === undefined ? {} : { mpn: product.mpn }),
    gtins: product.gtin === undefined ? [] : [product.gtin], variantDimensions: { ...product.selectedAttributes },
    ...(product.availabilityScope === "VARIANT" || product.productType === "simple" ? { availabilityScope: "SELECTED_VARIANT" as const } : {}),
    matchStatus: "DISCOVERY_MATCH", matchEvidence: ["public WooCommerce Store API product observation"],
    condition: product.condition, ...(product.imageUrl === undefined ? {} : { imageUrl: product.imageUrl }),
    ...(product.itemPrice === undefined ? {} : { itemPrice: product.itemPrice }),
    availability: product.availability === "BACKORDER" ? "UNKNOWN" : product.availability,
    merchantUrl: product.merchantUrl, checkedAt: product.checkedAt, checkoutPlatform: "MERCHANT",
    ...(product.rating === undefined ? {} : { productRating: { value: product.rating.value, count: product.rating.reviewCount, scaleMax: 5 as const } })
  };
}
