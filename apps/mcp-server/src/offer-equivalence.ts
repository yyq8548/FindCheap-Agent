import type { UnifiedCandidate } from "./search-products.js";
import { matchesWooProductUrl } from "./woocommerce-product.js";

type SourceProduct = NonNullable<UnifiedCandidate["shopifyProduct"] | UnifiedCandidate["awinProduct"] | UnifiedCandidate["ebayProduct"] | UnifiedCandidate["woocommerceProduct"]>;
export type OfferObservation = { source: UnifiedCandidate["source"]; product: SourceProduct };
const productOf = (candidate: UnifiedCandidate): SourceProduct => candidate.shopifyProduct ?? candidate.awinProduct ?? candidate.ebayProduct ?? candidate.woocommerceProduct;

/** Unknown parameters, unbound variants and marketplace listings have no
 * cross-source equivalence proof. This is not general URL normalization. */
function offerKey(candidate: UnifiedCandidate): string | undefined {
  if (candidate.source === "EBAY_BROWSE") return undefined;
  const product = productOf(candidate);
  try {
    const url = new URL(product.merchantUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
      !/^\/products\/[a-zA-Z0-9_-]+\/?$/u.test(url.pathname)) return undefined;
    const variants = url.searchParams.getAll("variant");
    if (variants.length !== 1 || !/^\d{1,30}$/u.test(variants[0]!)) return undefined;
    if (candidate.shopifyProduct && (candidate.shopifyProduct.handle !== variants[0] ||
      candidate.shopifyProduct.sourceHost.toLowerCase() !== url.hostname)) return undefined;
    if ([...url.searchParams.keys()].some(key => key !== "variant" &&
      !/^utm_[a-z_]+$/u.test(key) && !["gclid", "fbclid", "_gsid"].includes(key))) return undefined;
    return JSON.stringify([url.hostname, url.pathname.replace(/\/$/u, ""), variants[0]]);
  } catch { return undefined; }
}

function compatible(left: SourceProduct, right: SourceProduct): boolean {
  if (left.condition !== "UNKNOWN" && right.condition !== "UNKNOWN" && left.condition !== right.condition) return false;
  const dimensions = (product: SourceProduct) => new Map(Object.entries("selectedAttributes" in product ? product.selectedAttributes : "variantDimensions" in product ? product.variantDimensions : {})
    .map(([key, value]) => [key.normalize("NFKC").trim().toLowerCase(), value.normalize("NFKC").trim().toLowerCase()]));
  const a = dimensions(left), b = dimensions(right);
  if ([...a].some(([key, value]) => b.has(key) && b.get(key) !== value)) return false;
  const quantities = (product: SourceProduct) => new Map([...product.title.toLowerCase().matchAll(/\b(\d+(?:\.\d+)?)\s*(g|kg|ml|l|pads?|count|ct|pcs|pack)\b/gu)]
    .map((match) => [/^(?:pads?|count|ct|pcs)$/u.test(match[2]!) ? "count" : match[2]!, match[1]!]));
  const aq = quantities(left), bq = quantities(right);
  return ![...aq].some(([unit, value]) => bq.has(unit) && bq.get(unit) !== value);
}

/** Keep one complete observation, not a synthetic cheapest/in-stock offer.
 * Private observations retain source references; historical snapshots are untouched. */
export function deduplicateCandidateOffers(candidates: readonly UnifiedCandidate[]): UnifiedCandidate[] {
  const woo = candidates.filter(candidate => candidate.source === "WOOCOMMERCE_STORE_API");
  const wooKey = (candidate: UnifiedCandidate): string | undefined => {
    const own = candidate.woocommerceProduct;
    const product = own ?? (candidate.source !== "AWIN_PRODUCT_FEED" ? undefined : woo.find(reference => {
      const raw = reference.woocommerceProduct!;
      const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
      if (normalize(raw.title) !== normalize(candidate.awinProduct.title) || !matchesWooProductUrl(raw, candidate.awinProduct.merchantUrl)) return false;
      // A parent URL from a feed never proves a selected child. Require an
      // explicit numeric child in the affiliate URL before joining a variation.
      return raw.productType === "simple" || (raw.productType === "variation" &&
        new URL(candidate.awinProduct.merchantUrl).searchParams.get("variation_id") === String(raw.variationId));
    })?.woocommerceProduct);
    return product === undefined ? undefined : JSON.stringify(["WOOCOMMERCE", product.sourceHost, product.productId, product.variationId ?? null]);
  };
  const groups: Array<{ key?: string | undefined; entries: UnifiedCandidate[] }> = [];
  for (const candidate of candidates) {
    const key = wooKey(candidate) ?? offerKey(candidate);
    const group = key === undefined ? undefined : groups.find(group => group.key === key &&
      group.entries.every(entry => compatible(productOf(entry), productOf(candidate))) &&
      group.entries.flatMap(entry => entry.offerObservations ?? []).every(observation => compatible(observation.product, productOf(candidate))));
    if (group) group.entries.push(candidate);
    else groups.push({ key, entries: [candidate] });
  }
  return groups.map(({ entries }) => {
    if (entries.length === 1) return entries[0]!;
    const time = (entry: UnifiedCandidate) => Date.parse(productOf(entry).checkedAt) || 0;
    const direct = (entry: UnifiedCandidate) => entry.shopifyProduct?.merchantId.startsWith("official-") || entry.shopifyProduct?.sourceKind === "WEB_PRODUCT_PAGE" ? 1 : 0;
    const winner = [...entries].sort((a, b) => time(b) - time(a) || direct(b) - direct(a))[0]!;
    const observations = entries.flatMap(entry => entry.offerObservations ?? [{ source: entry.source, product: productOf(entry) }]);
    return { ...winner, offerObservations: observations };
  });
}
