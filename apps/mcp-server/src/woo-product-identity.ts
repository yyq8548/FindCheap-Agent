import { WooProductSchema, type WooProduct } from "../../../packages/contracts/src/woocommerce.js";
import { isBoundWooProductUrl } from "../../../packages/contracts/src/woocommerce-product-url.js";
import type { UnifiedCandidate } from "./search-products.js";
import { matchesWooProductUrl, candidateProductFacts } from "./woocommerce-product.js";

/** Source-owned identity retained privately with the search snapshot. A short
 * display title is never sufficient evidence to replace a requested URL. */
export type WooProductAnchor = Pick<WooProduct, "merchantId" | "sourceHost" | "productId" | "productType" |
  "selectedAttributes" | "gtin" | "brand" | "mpn"> & { url: string; variationId?: number };

/** Private persisted identity uses the source DTO's bounded fields, not arbitrary JSON. */
export const WooProductAnchorSchema = WooProductSchema.innerType().pick({ merchantId: true, sourceHost: true,
  productId: true, productType: true, selectedAttributes: true, gtin: true, brand: true, mpn: true, variationId: true })
  .extend({ url: WooProductSchema.innerType().shape.merchantUrl }).strict().refine(anchor =>
    new URL(anchor.url).hostname === anchor.sourceHost &&
    (anchor.variationId === undefined || anchor.productType === "variation" && anchor.variationId !== anchor.productId) &&
    isBoundWooProductUrl({ ...anchor, merchantUrl: anchor.url }), "Bound source-owned WooCommerce identity required");

export function createWooProductAnchor(product: WooProduct, url = product.merchantUrl): WooProductAnchor {
  const selected = [...new URL(url).searchParams.keys()].some(key => key === "variation_id" || key.startsWith("attribute_"));
  return { url, merchantId: product.merchantId, sourceHost: product.sourceHost, productId: product.productId,
    productType: product.productType, selectedAttributes: selected ? { ...product.selectedAttributes } : {},
    ...(selected && product.variationId !== undefined ? { variationId: product.variationId } : {}),
    ...(product.gtin === undefined || product.productType === "variation" && !selected ? {} : { gtin: product.gtin }),
    ...(product.brand === undefined ? {} : { brand: product.brand }),
    ...(product.mpn === undefined || product.productType === "variation" && !selected ? {} : { mpn: product.mpn }) };
}

export function matchesWooProductAnchor(product: WooProduct, anchor: WooProductAnchor): boolean {
  return product.merchantId === anchor.merchantId && product.sourceHost === anchor.sourceHost &&
    product.productId === anchor.productId && (anchor.variationId === undefined || product.variationId === anchor.variationId) &&
    matchesWooProductUrl(product, anchor.url);
}

/** Cross-merchant equivalence needs a global identifier, never a title, SKU,
 * handle, store name or merchant-scoped numeric ID. Selected dimensions must
 * also be observed; a family-level MPN cannot prove an unspecified variant. */
export function matchesWooAnchoredCandidate(candidate: UnifiedCandidate, anchor: WooProductAnchor): boolean {
  if (candidate.woocommerceProduct && (candidate.woocommerceProduct.merchantId === anchor.merchantId ||
    candidate.woocommerceProduct.sourceHost === anchor.sourceHost)) return matchesWooProductAnchor(candidate.woocommerceProduct, anchor);
  const facts = candidateProductFacts(candidate);
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
  const gtins = "gtins" in facts ? facts.gtins : [];
  const globalId = anchor.gtin !== undefined && gtins.some(value => value.padStart(14, "0") === anchor.gtin!.padStart(14, "0"));
  const manufacturerId = anchor.brand !== undefined && anchor.mpn !== undefined && "brand" in facts && "mpn" in facts &&
    facts.brand !== undefined && facts.mpn !== undefined && normalize(anchor.brand) === normalize(facts.brand) && normalize(anchor.mpn) === normalize(facts.mpn);
  if (!globalId && !manufacturerId) return false;
  const dimensions = new Map(Object.entries("variantDimensions" in facts ? facts.variantDimensions : {})
    .map(([key, value]) => [normalize(key), normalize(value)]));
  return Object.entries(anchor.selectedAttributes).every(([key, value]) => dimensions.get(normalize(key)) === normalize(value));
}
