import { safeFetchWithProvenance } from "../../../packages/network-safety/src/safe-fetch.js";
import type { ShopifyProduct } from "./shopify-client.js";
import { ShopifyProductJsonSchema, shopifyVariantDimensions } from "./shopify-product-json.js";

export type SelectedProductInspection = {
  productTitle: string;
  canonicalProductUrl: string;
  variants: ShopifyProduct[];
};

export type ShopifySelectedProductInspector = {
  inspect(
    selected: ShopifyProduct,
    requestedVariantDimensions: Readonly<Record<string, string>>
  ): Promise<SelectedProductInspection>;
};

export type ProductJsonFetch = (
  url: string,
  allowedHost: string
) => Promise<{ response: Response; finalUrl: string }>;

type Dependencies = {
  fetchProduct?: ProductJsonFetch;
  clock?: { now(): Date };
};

export function createShopifySelectedProductInspector(
  dependencies: Dependencies = {}
): ShopifySelectedProductInspector {
  const fetchProduct = dependencies.fetchProduct ?? ((url, allowedHost) =>
    safeFetchWithProvenance({ url }, { allowedHosts: [allowedHost] }));
  const clock = dependencies.clock ?? { now: () => new Date() };

  return {
    async inspect(selected, requestedVariantDimensions) {
      const target = selectedProductJsonTarget(selected);
      const fetched = await fetchProduct(target.jsonUrl, target.sourceHost);
      if (canonicalHref(fetched.finalUrl) !== target.jsonUrl) {
        throw new Error("selected product path changed");
      }
      if (!fetched.response.ok) throw new Error("selected product document unavailable");
      const product = ShopifyProductJsonSchema.parse(JSON.parse(await fetched.response.text()));
      if (product.handle !== target.productHandle) {
        throw new Error("selected product handle changed");
      }
      if (!product.variants.some((variant) => variant.id === selected.handle)) {
        throw new Error("selected variant identity was not present");
      }

      const checkedAt = clock.now().toISOString();
      const hasRequestedDimensions = Object.keys(requestedVariantDimensions).length > 0;
      const variants = product.variants
        .map((variant) => ({ variant, dimensions: shopifyVariantDimensions(product.options, variant) }))
        .filter(({ variant, dimensions }) => hasRequestedDimensions
          ? matchesDimensions(dimensions, requestedVariantDimensions)
          : variant.id === selected.handle)
        .slice(0, 3)
        .map(({ variant, dimensions }): ShopifyProduct => ({
          ...selected,
          handle: variant.id,
          title: variant.title === "Default Title"
            ? product.title
            : `${product.title} — ${variant.title}`,
          ...(variant.sku === undefined || variant.sku === null || variant.sku === ""
            ? {}
            : { sku: variant.sku }),
          variantDimensions: dimensions,
          itemPrice: { amountCents: variant.price, currency: "USD" },
          availability: variant.available ? "IN_STOCK" : "OUT_OF_STOCK",
          merchantUrl: `${target.canonicalProductUrl}?variant=${variant.id}`,
          checkedAt
        }));

      return {
        productTitle: product.title,
        canonicalProductUrl: target.canonicalProductUrl,
        variants
      };
    }
  };
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
