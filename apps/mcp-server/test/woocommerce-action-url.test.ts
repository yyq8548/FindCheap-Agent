import { describe, expect, it, vi } from "vitest";
import { WooRegistrySchema, wooProductUrl } from "../../awin-feed-service/src/woocommerce-registry.js";
import { normalizeWooProduct } from "../../awin-feed-service/src/woocommerce-store.js";
import { WooProductSchema } from "../../../packages/contracts/src/woocommerce.js";
import { createWooCommercePortFromEnvironment } from "../src/woocommerce-client.js";

const store = WooRegistrySchema.parse({ version: "test", stores: [{ merchantId: "url-store", name: "URL Store",
  origin: "https://store.example", productPathPrefixes: ["/"], currency: "USD", reviewedAt: "2026-09-08",
  evidenceUrl: "https://store.example/product/book/", enabled: true, capabilities: { search: true, variations: true }
}] }).stores[0]!;
const raw = { id: 123, name: "A Book", type: "simple", permalink: "/product/book/",
  prices: { price: "1099", currency_code: "USD", currency_minor_unit: 2 }, is_in_stock: true };
const at = "2026-09-08T12:00:00.000Z";
const product = normalizeWooProduct(raw, store, at)!;
const forbidden = [
  "/?add-to-cart=123", "/cart", "/checkout/", "/CaRt/", "/%63art/", "/%2563art/",
  "/product/book/?wc-ajax=add_to_cart", "/product/book/?ADD-TO-CART=123", "/product/book/?%61dd-to-cart=123",
  "/product/book/?remove_item=123", "/product/book/?redirect_to=https%3A%2F%2Fevil.example",
  "/product/book/?attribute_pa_color=red&attribute_pa_color=blue", "/wp-admin/", "/wp-login.php",
  "/my-account/customer-logout/", "/product/%00book/", "/product/book/?attribute_pa_color=%00red"
];

describe("Woo product links cannot export shopping actions", () => {
  it.each(forbidden)("source rejects raw action/ambiguous permalink %s", (path) => {
    const url = store.origin + path;
    expect(wooProductUrl(store, url)).toBeUndefined();
    expect(normalizeWooProduct({ ...raw, permalink: url }, store, at)).toBeUndefined();
  });

  it.each(forbidden)("untrusted product response rejects %s", (path) => {
    expect(WooProductSchema.safeParse({ ...product, merchantUrl: store.origin + path }).success).toBe(false);
  });

  it("also rejects action parameters on a narrowly allowed product prefix", () => {
    const narrow = { ...store, productPathPrefixes: ["/product/"] };
    expect(normalizeWooProduct({ ...raw, permalink: "/product/book/?add-to-cart=123" }, narrow, at)).toBeUndefined();
  });

  it.each([
    "/product/cartoon-book/", "/checkout-story/", "/product/coffee%20book/", "/?p=123",
    "/?p=123&post_type=product", "/product/book/?variation_id=124&attribute_pa_color=Red&attribute_size=L",
    "/product/book/?attribute_add-casters=No+Thank+you&utm_source=example&srsltid=abc",
    "/product/book/?currency=USD&attribute_pa_size=extra-large&attribute_pa_color=white"
  ])("retains legitimate product identity and query selections %s", (path) => {
    const url = store.origin + path;
    const selected = [...new URL(url).searchParams].filter(([key]) => key.startsWith("attribute_"))
      .map(([key, value]) => ({ name: key.replace(/^attribute_(?:pa_)?/u, ""), value }));
    const hasSelection = selected.length > 0 || new URL(url).searchParams.has("variation_id");
    const parent = { ...raw, type: "variable", variations: [{ id: 124, attributes: selected }] };
    const observation = hasSelection
      ? normalizeWooProduct({ ...raw, id: 124, parent: 123, type: "variation", permalink: url }, store, at, parent)
      : normalizeWooProduct({ ...raw, permalink: url }, store, at);
    expect(wooProductUrl(store, url)).toBe(url);
    expect(observation?.merchantUrl).toBe(url);
    expect(WooProductSchema.safeParse(observation).success).toBe(true);
  });

  it("client rejects an action link even when all product/target IDs and price evidence agree", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ source: "WOOCOMMERCE_STORE_API",
      registryVersion: "test", status: "FOUND", product: { ...product, merchantUrl: "https://store.example/?add-to-cart=123" }, checkedAt: at }));
    const port = createWooCommercePortFromEnvironment({ WOOCOMMERCE_API_BASE_URL: "https://source.example" }, { fetch })!;
    await expect(port.lookup({ merchantId: store.merchantId, productId: 123 })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://source.example/v1/woocommerce/products/lookup");
  });
});
