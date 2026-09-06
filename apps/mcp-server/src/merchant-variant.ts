type MerchantVariant = {
  sourceKind?: string | undefined;
  merchantId: string;
  sourceHost: string;
  handle: string;
  merchantUrl: string;
  title?: string;
};

function boundVariantUrl(product: MerchantVariant): URL | undefined {
  if (!/^\d{1,20}$/u.test(product.handle) || product.merchantUrl.length > 1024) return undefined;
  try {
    const url = new URL(product.merchantUrl);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      url.hostname === product.sourceHost.toLowerCase() && /^\/products\/[a-z0-9-]+\/?$/iu.test(url.pathname) &&
      [...url.searchParams.keys()].length === 1 && url.searchParams.get("variant") === product.handle
      ? url : undefined;
  } catch { return undefined; }
}

/** Display family only: never an exact-item, price-comparability or selection ID. */
export function merchantVariantStyleKey(product: MerchantVariant): string | undefined {
  const url = boundVariantUrl(product);
  return url === undefined ? undefined : JSON.stringify([
    product.sourceKind ?? "SHOPIFY_GLOBAL_CATALOG", product.merchantId, url.hostname, url.pathname.replace(/\/$/u, "")
  ]);
}

/** Source-reported suffix; no inferred units, normalized colors or quality claims. */
export function merchantReportedVariant(product: MerchantVariant): Record<string, string> {
  if (boundVariantUrl(product) === undefined || !product.title || product.title.length > 1000) return {};
  const separator = product.title.lastIndexOf(" - ");
  if (separator < 1) return {};
  const suffix = product.title.slice(separator + 3).trim();
  const parts = suffix.split(" / ");
  if (suffix.length > 160 || parts.length < 2 || parts.length > 4 || parts.some(part => !part.trim()) || [...suffix].some(char => char.charCodeAt(0) < 32)) return {};
  return { "Merchant variant": suffix };
}
