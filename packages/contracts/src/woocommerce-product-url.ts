// Product links are navigation evidence, never permission to mutate a merchant cart.
// Keep this independent of registry ownership so untrusted source responses use it too.
export function isReadOnlyWooProductUrl(value: string): boolean {
  try {
    if (/[\s\\]/u.test(value)) return false;
    const url = new URL(value);
    const path = decodeURIComponent(url.pathname);
    // eslint-disable-next-line no-control-regex -- Reject hidden URL controls before export to a browser.
    const controls = /[\u0000-\u001f\u007f\\]/u;
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || controls.test(path) || path.includes("%") ||
      /(?:^|\/)(?:cart|checkout|my-account|accounts?|login|logout|customer-logout|order-pay|order-received|add-to-cart|remove-from-cart|wp-admin|wp-login\.php|wp-json|wc-api|admin|api)(?:\/|$)/iu.test(path)) return false;
    const seen = new Set<string>();
    for (const [key, parameter] of url.searchParams) {
      if (seen.has(key) || controls.test(key) || controls.test(parameter)) return false;
      seen.add(key);
      if (/^(?:utm_[a-z_]+|gclid|fbclid|srsltid)$/u.test(key) || (key === "currency" && parameter === "USD")) continue;
      if (key === "p" || key === "variation_id") {
        if (/^[1-9]\d{0,15}$/u.test(parameter) && Number.isSafeInteger(Number(parameter))) continue;
      } else if (key === "post_type" && parameter === "product" && url.searchParams.has("p")) continue;
      else if (/^attribute_(?:pa_)?[a-zA-Z0-9_-]{1,80}$/u.test(key) && parameter.trim().length > 0 && parameter.length <= 300) continue;
      return false;
    }
    return path !== "/" || url.searchParams.has("p");
  } catch { return false; }
}

/** Compare display names and ordinary Woo taxonomy spelling, not semantic synonyms. */
export function normalizedWooAttributeName(value: string): string {
  const name = value.normalize("NFKC").toLowerCase().replace(/^attribute_(?:pa_)?|^pa_/u, "")
    .replace(/&amp;|&#0*38;|&#x0*26;/gu, "&").replace(/[-_\s/.:+&()|]+/gu, " ").trim();
  return name === "colour" ? "color" : name;
}

export function normalizedWooAttributeValue(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[-_\s]+/gu, " ").trim();
}

/** A navigation selection must agree with observed facts; it never supplies them. */
export function isBoundWooProductUrl(product: {
  merchantUrl: string; productId: number; variationId?: number | undefined; selectedAttributes: Readonly<Record<string, string>>;
}): boolean {
  if (!isReadOnlyWooProductUrl(product.merchantUrl)) return false;
  const selected = new Map<string, string>();
  for (const [name, value] of Object.entries(product.selectedAttributes)) {
    const key = normalizedWooAttributeName(name), normalized = normalizedWooAttributeValue(value);
    if (!key || !normalized || (selected.has(key) && selected.get(key) !== normalized)) return false;
    selected.set(key, normalized);
  }
  for (const [key, value] of new URL(product.merchantUrl).searchParams) {
    if (key === "p" && String(product.productId) !== value) return false;
    if (key === "variation_id" && String(product.variationId) !== value) return false;
    if (key.startsWith("attribute_") && selected.get(normalizedWooAttributeName(key)) !== normalizedWooAttributeValue(value)) return false;
  }
  return true;
}
