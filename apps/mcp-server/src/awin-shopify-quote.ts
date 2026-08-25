import { z } from "zod";

import { safeFetchWithProvenance } from "../../../packages/network-safety/src/safe-fetch.js";
import type { ShopifyProduct } from "./shopify-client.js";
import { ShopifyCartQuoteError } from "./shopify-cart-quote.js";

const VariantIdSchema = z.union([
  z.number().int().positive().transform(String),
  z.string().regex(/^\d{1,30}$/u)
]);
const ProductOptionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  position: z.number().int().min(1).max(3),
  values: z.array(z.string().trim().min(1).max(300)).max(100)
}).passthrough();
const ProductVariantSchema = z.object({
  id: VariantIdSchema,
  title: z.string().trim().min(1).max(1_000),
  available: z.boolean(),
  price: z.number().int().nonnegative().max(100_000_000),
  sku: z.string().trim().max(300).nullable().optional(),
  options: z.array(z.string().trim().min(1).max(300)).max(3).optional(),
  option1: z.string().trim().min(1).max(300).nullable().optional(),
  option2: z.string().trim().min(1).max(300).nullable().optional(),
  option3: z.string().trim().min(1).max(300).nullable().optional()
}).passthrough();
const ProductJsonSchema = z.object({
  title: z.string().trim().min(1).max(1_000),
  handle: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,200}$/u),
  options: z.array(ProductOptionSchema).max(3).default([]),
  variants: z.array(ProductVariantSchema).min(1).max(100)
}).passthrough();

const APPROVED_QUOTE_HOSTS: Readonly<Record<string, readonly string[]>> = {
  "20282": [
    "www.nutreecosmetics.com",
    "nutreecosmetics.com",
    "bondoxhair.com",
    "www.bondoxhair.com"
  ]
};

export type AwinShopifyQuoteSeed = {
  merchantId: string;
  merchant: string;
  merchantProductId: string;
  title: string;
  sourceHost: string;
  merchantUrl: string;
  itemPrice: { amountCents: number; currency: "USD" };
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  checkedAt: string;
};

export interface AwinShopifyQuoteResolver {
  supports(seed: AwinShopifyQuoteSeed): boolean;
  resolve(seed: AwinShopifyQuoteSeed): Promise<ShopifyProduct>;
}

type ProductFetch = (
  url: string,
  allowedHosts: readonly string[]
) => Promise<{ response: Response; finalUrl: string }>;

type Dependencies = {
  fetchProduct?: ProductFetch;
  clock?: { now(): Date };
};

export function createAwinShopifyQuoteResolver(
  dependencies: Dependencies = {}
): AwinShopifyQuoteResolver {
  const fetchProduct = dependencies.fetchProduct ?? ((url, allowedHosts) =>
    safeFetchWithProvenance({ url }, { allowedHosts }));
  const clock = dependencies.clock ?? { now: () => new Date() };

  return {
    supports(seed) {
      const hosts = APPROVED_QUOTE_HOSTS[seed.merchantId];
      if (hosts === undefined || !hosts.includes(seed.sourceHost.toLocaleLowerCase("en-US"))) return false;
      try {
        productTarget(seed.merchantUrl, seed.sourceHost);
        return true;
      } catch {
        return false;
      }
    },
    async resolve(seed) {
      try {
        const hosts = APPROVED_QUOTE_HOSTS[seed.merchantId];
        if (hosts === undefined || !hosts.includes(seed.sourceHost.toLocaleLowerCase("en-US"))) {
          throw new Error("merchant does not have an approved Shopify quote bridge");
        }
        const target = productTarget(seed.merchantUrl, seed.sourceHost);
        const fetched = await fetchProduct(target.jsonUrl, hosts);
        if (!fetched.response.ok) throw new Error("merchant product document unavailable");
        const final = finalProductTarget(fetched.finalUrl, hosts, target.productHandle);
        const product = ProductJsonSchema.parse(JSON.parse(await fetched.response.text()));
        if (
          product.handle !== target.productHandle ||
          !sameProductTitle(product.title, seed.title)
        ) {
          throw new ShopifyCartQuoteError("VARIANT_REJECTED");
        }
        const variant = selectVariant(product.variants, seed);
        const checkedAt = clock.now().toISOString();
        return {
          merchantId: seed.merchantId,
          merchant: seed.merchant,
          sourceHost: final.sourceHost,
          merchantTrust: {
            level: "UNKNOWN",
            verification: "UNVERIFIED",
            evidence: ["merchant product page resolved to a stable Shopify variant for this quote only"]
          },
          handle: variant.id,
          title: variant.title === "Default Title" ? product.title : `${product.title} — ${variant.title}`,
          ...(variant.sku === undefined || variant.sku === null || variant.sku === ""
            ? {}
            : { sku: variant.sku }),
          gtins: [],
          variantDimensions: variantDimensions(product.options, variant),
          matchStatus: "DISCOVERY_MATCH",
          matchEvidence: ["stable Awin merchant product ID", "exact merchant product path", "Shopify variant resolved without title search"],
          condition: "UNKNOWN",
          itemPrice: { amountCents: variant.price, currency: "USD" },
          availability: variant.available ? "IN_STOCK" : "OUT_OF_STOCK",
          merchantUrl: `${final.canonicalProductUrl}?variant=${variant.id}`,
          checkedAt
        };
      } catch (error) {
        if (error instanceof ShopifyCartQuoteError) throw error;
        throw new ShopifyCartQuoteError("MERCHANT_CART_UNAVAILABLE", { cause: error });
      }
    }
  };
}

function productTarget(merchantUrl: string, sourceHost: string): {
  productHandle: string;
  jsonUrl: string;
} {
  const url = new URL(merchantUrl);
  const normalizedSourceHost = sourceHost.toLocaleLowerCase("en-US");
  if (
    url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" ||
    url.hostname.toLocaleLowerCase("en-US") !== normalizedSourceHost
  ) throw new Error("merchant product source changed");
  const pathname = url.pathname.replace(/\/$/u, "");
  const match = pathname.match(/^\/(?:[A-Za-z]{2}(?:-[A-Za-z]{2})?\/)?products\/([A-Za-z0-9][A-Za-z0-9_-]{0,200})$/u);
  if (match === null) throw new Error("merchant product path is unsupported");
  return {
    productHandle: match[1]!,
    jsonUrl: `https://${normalizedSourceHost}${pathname}.js`
  };
}

function finalProductTarget(
  finalUrl: string,
  allowedHosts: readonly string[],
  expectedHandle: string
): { sourceHost: string; canonicalProductUrl: string } {
  const url = new URL(finalUrl);
  const sourceHost = url.hostname.toLocaleLowerCase("en-US");
  if (
    url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" ||
    !allowedHosts.includes(sourceHost) || url.search !== "" || url.hash !== "" ||
    url.pathname !== `/products/${expectedHandle}.js`
  ) throw new Error("merchant product redirect changed identity");
  return {
    sourceHost,
    canonicalProductUrl: `https://${sourceHost}/products/${expectedHandle}`
  };
}

function selectVariant(
  variants: z.infer<typeof ProductVariantSchema>[],
  seed: AwinShopifyQuoteSeed
): z.infer<typeof ProductVariantSchema> {
  const byId = variants.find((variant) => variant.id === seed.merchantProductId);
  if (byId !== undefined) return byId;
  if (variants.length === 1) return variants[0]!;
  const byPrice = variants.filter((variant) => variant.price === seed.itemPrice.amountCents);
  if (byPrice.length === 1) return byPrice[0]!;
  throw new ShopifyCartQuoteError("VARIANT_REJECTED");
}

function sameProductTitle(left: string, right: string): boolean {
  const normalizedLeft = normalizeTitle(left);
  const normalizedRight = normalizeTitle(right);
  return normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft);
}

function normalizeTitle(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}

function variantDimensions(
  productOptions: z.infer<typeof ProductOptionSchema>[],
  variant: z.infer<typeof ProductVariantSchema>
): Record<string, string> {
  const values = variant.options ?? [variant.option1, variant.option2, variant.option3]
    .filter((value): value is string => value !== undefined && value !== null && value !== "");
  return Object.fromEntries(productOptions
    .sort((left, right) => left.position - right.position)
    .map((option, index) => [option.name, values[index]])
    .filter((entry): entry is [string, string] => entry[1] !== undefined));
}
