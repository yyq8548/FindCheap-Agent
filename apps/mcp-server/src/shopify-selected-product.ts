import { safeFetchWithProvenance } from "../../../packages/network-safety/src/safe-fetch.js";
import type { ShopifyProduct } from "./shopify-client.js";
import { parseOfficialStructuredProduct } from "./shopify-official-store-search.js";
import { ShopifyProductJsonSchema, shopifyVariantDimensions } from "./shopify-product-json.js";
import { evaluateProductRequirements, sizeEvidence } from "./product-requirements.js";

type InspectionOptions = { signal?: AbortSignal; requirements?: { requiredFeatures: readonly string[]; requiredSize?: string | undefined } };

export type SelectedProductInspection = {
  productTitle: string;
  canonicalProductUrl: string;
  variants: ShopifyProduct[];
};

export type ShopifySelectedProductInspector = {
  inspect(
    selected: ShopifyProduct,
    requestedVariantDimensions: Readonly<Record<string, string>>,
    options?: InspectionOptions
  ): Promise<SelectedProductInspection>;
};

export type ProductJsonFetch = (
  url: string,
  allowedHost: string,
  signal?: AbortSignal
) => Promise<{ response: Response; finalUrl: string }>;

type Dependencies = {
  fetchProduct?: ProductJsonFetch;
  clock?: { now(): Date };
};

export function createShopifySelectedProductInspector(
  dependencies: Dependencies = {}
): ShopifySelectedProductInspector {
  const fetchProduct = dependencies.fetchProduct ?? ((url, allowedHost, signal) =>
    safeFetchWithProvenance({ url }, { allowedHosts: [allowedHost], ...(signal === undefined ? {} : { signal }) }));
  const clock = dependencies.clock ?? { now: () => new Date() };

  return {
    async inspect(selected, requestedVariantDimensions, options) {
      const target = selectedProductJsonTarget(selected);
      const fetched = await fetchProduct(target.jsonUrl, target.sourceHost, options?.signal);
      if (canonicalHref(fetched.finalUrl) !== target.jsonUrl) {
        throw new Error("selected product path changed");
      }
      const checkedAt = clock.now().toISOString();
      const hasRequestedDimensions = Object.keys(requestedVariantDimensions).length > 0;
      if (fetched.response.ok) {
        const product = ShopifyProductJsonSchema.parse(JSON.parse(await fetched.response.text()));
        if (product.handle !== target.productHandle) {
          throw new Error("selected product handle changed");
        }
        if (!product.variants.some((variant) => variant.id === selected.handle)) {
          throw new Error("selected variant identity was not present");
        }
        // /products/*.js may omit currency. Never relabel a local-market price as
        // USD: accept explicit USD, or the exact page's USD offer for that variant.
        const usdOffers = new Map<string, number>();
        if (product.currency === undefined && product.priceCurrency === undefined) {
          try {
            const page = await fetchProduct(target.canonicalProductUrl, target.sourceHost, options?.signal);
            if (page.response.ok && canonicalHref(page.finalUrl) === canonicalHref(target.canonicalProductUrl)) {
              const details = parseOfficialStructuredProduct(await page.response.text(), target.sourceHost, target.productHandle);
              for (const variant of details.variants) usdOffers.set(variant.variantId, variant.amountCents);
            }
          } catch { options?.signal?.throwIfAborted(); }
        }
        const { sku: _oldSku, gtins: _oldGtins, cartQuote: _oldQuote, itemPrice: _oldPrice,
          availableSizes: _oldSizes, imageUrl: _oldImage, ...baseProduct } = selected;
        const variants = product.variants
          .map((variant) => ({ variant, dimensions: shopifyVariantDimensions(product.options, variant) }))
          .filter(({ variant, dimensions }) => options?.requirements !== undefined || hasRequestedDimensions
            ? matchesDimensions(dimensions, requestedVariantDimensions)
            : variant.id === selected.handle)
          .map(({ variant, dimensions }): ShopifyProduct => ({
            ...baseProduct,
            handle: variant.id,
            gtins: typeof variant.barcode === "string" && /^(?:\d{8}|\d{12,14})$/u.test(variant.barcode) ? [variant.barcode] : [],
            title: variant.title === "Default Title"
              ? product.title
              : `${product.title} — ${variant.title}`,
            ...(variant.sku === undefined || variant.sku === null || variant.sku === ""
              ? {}
              : { sku: variant.sku }),
            description: (product.description ?? selected.description ?? "").replace(/<[^>]*>/gu, " ").slice(0, 6000),
            variantDimensions: Object.fromEntries(Object.entries(dimensions).map(([name, value]) =>
              [name, /^size$/iu.test(name) ? sizeEvidence(value, product.description ?? selected.description) : value])),
            ...variantImage(selected, dimensions, variant.featured_image),
            ...((product.currency === "USD" || product.priceCurrency === "USD")
              ? { itemPrice: { amountCents: variant.price, currency: "USD" as const } }
              : usdOffers.has(variant.id) ? { itemPrice: { amountCents: usdOffers.get(variant.id)!, currency: "USD" as const } } : {}),
            availabilityScope: "SELECTED_VARIANT",
            availability: variant.available ? "IN_STOCK" : "OUT_OF_STOCK",
            merchantUrl: `${target.canonicalProductUrl}?variant=${variant.id}`,
            checkedAt
          }))
          .filter(variant => meetsRequirements(variant, options))
          .slice(0, 3);
        return { productTitle: product.title, canonicalProductUrl: target.canonicalProductUrl, variants };
      }

      const page = await fetchProduct(target.canonicalProductUrl, target.sourceHost, options?.signal);
      if (canonicalHref(page.finalUrl) !== canonicalHref(target.canonicalProductUrl) || !page.response.ok) {
        throw new Error("selected product page changed");
      }
      const product = parseOfficialStructuredProduct(
        await page.response.text(),
        target.sourceHost,
        target.productHandle
      );
      if (!product.variants.some((variant) => variant.variantId === selected.handle)) {
        throw new Error("selected variant identity was not present");
      }
      const { sku: _oldSku, gtins: _oldGtins, cartQuote: _oldQuote, itemPrice: _oldPrice,
        availableSizes: _oldSizes, imageUrl: _oldImage, ...baseProduct } = selected;
      const variants = product.variants
        .map((variant) => ({
          variant,
          dimensions: variant.size === undefined ? {} : { Size: variant.size }
        }))
        .filter(({ variant, dimensions }) => options?.requirements !== undefined || hasRequestedDimensions
          ? matchesDimensions(dimensions, requestedVariantDimensions)
          : variant.variantId === selected.handle)
        .map(({ variant, dimensions }): ShopifyProduct => ({
          ...baseProduct,
          handle: variant.variantId,
          title: variant.title,
          ...(variant.sku === undefined ? {} : { sku: variant.sku }),
          gtins: variant.gtin === undefined ? [] : [variant.gtin],
          variantDimensions: dimensions,
          ...(variant.imageUrl === undefined ? {} : { imageUrl: variant.imageUrl }),
          itemPrice: { amountCents: variant.amountCents, currency: "USD" },
          availability: variant.available ? "IN_STOCK" : "OUT_OF_STOCK",
          availabilityScope: "SELECTED_VARIANT",
          merchantUrl: variant.merchantUrl,
          checkedAt
        }));
      return { productTitle: product.title, canonicalProductUrl: target.canonicalProductUrl,
        variants: variants.filter(variant => meetsRequirements(variant, options)).slice(0, 3) };
    }
  };
}

function meetsRequirements(product: ShopifyProduct, options: InspectionOptions | undefined): boolean {
  return options?.requirements === undefined || evaluateProductRequirements(product, {
    ...options.requirements, excludedFeatures: [], preferences: []
  }).assessment.status === "SATISFIED";
}

function variantImage(selected: ShopifyProduct, dimensions: Record<string, string>, image: unknown): { imageUrl?: string } {
  const value = typeof image === "object" && image !== null && "src" in image && typeof image.src === "string" ? image.src : undefined;
  if (value !== undefined) {
    try {
      const url = new URL(value.startsWith("//") ? `https:${value}` : value);
      if (url.protocol === "https:" && url.username === "" && url.password === "") return { imageUrl: url.href };
    } catch { /* Invalid source image stays absent. */ }
  }
  const sameColor = Object.entries(dimensions).filter(([key]) => /colou?r/iu.test(key))
    .every(([key, value]) => selected.variantDimensions[key] === value);
  return sameColor && selected.imageUrl !== undefined ? { imageUrl: selected.imageUrl } : {};
}

function selectedProductJsonTarget(selected: ShopifyProduct): {
  sourceHost: string;
  productHandle: string;
  canonicalProductUrl: string;
  jsonUrl: string;
} {
  const sourceHost = selected.sourceHost.toLocaleLowerCase("en-US");
  const url = new URL(selected.merchantUrl);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.hostname.toLocaleLowerCase("en-US") !== sourceHost
  ) {
    throw new Error("selected product source changed");
  }
  const pathname = url.pathname.replace(/\/$/u, "");
  const match = pathname.match(/^\/(?:[A-Za-z]{2}(?:-[A-Za-z]{2})?\/)?products\/([A-Za-z0-9][A-Za-z0-9_-]{0,200})$/u);
  if (match === null) throw new Error("selected product path is unsupported");
  const canonicalProductUrl = `https://${sourceHost}${pathname}`;
  return {
    sourceHost,
    productHandle: match[1]!,
    canonicalProductUrl,
    jsonUrl: `${canonicalProductUrl}.js`
  };
}

function canonicalHref(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

function matchesDimensions(
  actual: Readonly<Record<string, string>>,
  requested: Readonly<Record<string, string>>
): boolean {
  return Object.entries(requested).every(([requestedName, requestedValue]) => {
    const match = Object.entries(actual).find(([actualName]) =>
      normalizeVariantToken(actualName) === normalizeVariantToken(requestedName));
    return match !== undefined && normalizeVariantToken(match[1]) === normalizeVariantToken(requestedValue);
  });
}

function normalizeVariantToken(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}
