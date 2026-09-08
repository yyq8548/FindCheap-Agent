import type { z } from "zod";
import { readLimitedBody } from "../../../packages/awin-feed/src/index.js";
import { WooSearchInputSchema, WooSearchResultSchema, WooProductTargetSchema, WooInspectionInputSchema,
  WooLookupResultSchema, WooInspectionResultSchema,
  type WooProduct, type WooSearchInput, type WooSearchResult, type WooProductTarget, type WooVariantRequirements,
  type WooLookupResult, type WooInspectionResult } from "../../../packages/contracts/src/woocommerce.js";

export interface WooCommerceCatalogPort {
  search(input: WooSearchInput, options?: { signal?: AbortSignal }): Promise<WooSearchResult>;
}
export interface WooCommerceProductPort {
  lookup(target: WooProductTarget, options?: { signal?: AbortSignal }): Promise<WooLookupResult>;
  inspect(target: WooProductTarget, requirements: WooVariantRequirements, options?: { signal?: AbortSignal }): Promise<WooInspectionResult>;
}

/** The distributed client can query only its configured source service. Merchant
 * discovery, credentials and outbound merchant access belong to that service. */
export function createWooCommercePortFromEnvironment(environment: Readonly<Record<string, string | undefined>>,
  dependencies: { fetch?: typeof fetch } = {}): (WooCommerceCatalogPort & WooCommerceProductPort) | undefined {
  const raw = environment.WOOCOMMERCE_API_BASE_URL?.trim();
  if (!raw || environment.WOOCOMMERCE_SOURCE_ENABLED === "false") return undefined;
  const base = new URL(raw);
  if (base.protocol !== "https:" || base.username || base.password || base.port || base.search || base.hash || base.pathname !== "/") {
    throw new Error("WOOCOMMERCE_API_BASE_URL must be credential-free HTTPS origin on the default port");
  }
  const request = dependencies.fetch ?? fetch;
  const maxBytes = 1024 * 1024;
  const call = async <T>(path: string, input: unknown, schema: z.ZodType<T, z.ZodTypeDef, unknown>, parent?: AbortSignal): Promise<T> => {
    parent?.throwIfAborted();
    const signal = AbortSignal.any([AbortSignal.timeout(9_000), ...(parent ? [parent] : [])]);
    const response = await request(new URL(`/v1/woocommerce/${path}`, base).href, {
      method: "POST", redirect: "error", signal,
      headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(input)
    });
    if (response.status === 404) throw new Error("SOURCE_NOT_CONFIGURED");
    if (!response.ok) throw new Error(`WooCommerce Search service returned HTTP ${response.status}`);
    if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      throw new Error("WooCommerce Search service returned invalid content type");
    }
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maxBytes)) throw new Error("WooCommerce Search service response too large");
    const bytes = await readLimitedBody(response, maxBytes, "WooCommerce Search service", { signal });
    signal.throwIfAborted();
    return schema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  };
  const images = (product: WooProduct): WooProduct => {
    const proxied = product.images.map(image => ({ ...image, url: new URL(`/v1/woocommerce/images?${new URLSearchParams({ merchantId: product.merchantId, imageId: image.id })}`, base).href }));
    const { imageUrl: _imageUrl, ...rest } = product;
    return { ...rest, images: proxied, ...(proxied[0] ? { imageUrl: proxied[0].url } : {}) };
  };
  const validateTarget = (target: WooProductTarget, result: WooLookupResult | WooInspectionResult) => {
    const products = "products" in result ? result.products : result.product ? [result.product] : [];
    for (const product of products) {
      if (product.merchantId !== target.merchantId || product.productId !== target.productId ||
        (!("products" in result) && product.variationId !== target.variationId)) {
        throw new Error("WooCommerce Search service returned invalid product identity");
      }
    }
  };
  return {
    async search(input, options) {
      const result = await call("search", WooSearchInputSchema.parse(input), WooSearchResultSchema, options?.signal);
      return { ...result, products: result.products.map(images) };
    },
    async lookup(target, options) {
      const result = await call("products/lookup", WooProductTargetSchema.parse(target), WooLookupResultSchema, options?.signal);
      validateTarget(target, result);
      return { ...result, ...(result.product ? { product: images(result.product) } : {}) };
    },
    async inspect(target, requirements, options) {
      const result = await call("products/variants", WooInspectionInputSchema.parse({ target, requirements }), WooInspectionResultSchema, options?.signal);
      validateTarget(target, result);
      return { ...result, products: result.products.map(images), ...(result.parent ? { parent: images(result.parent) } : {}) };
    }
  };
}
