import { describe, expect, it } from "vitest";
import { resolveKnownProductUrl } from "../src/known-product-url.js";

describe("reviewed official product URL intake", () => {
  it("separates a known PDP from retrieval terms without creating product identity", () => {
    const result = resolveKnownProductUrl("https://www.shopdoen.com/products/cornella-dress-black");
    expect(result).toMatchObject({ sourcePageUrl: "https://www.shopdoen.com/products/cornella-dress-black",
      storefront: { host: "www.shopdoen.com", brand: "DÔEN", platform: "SHOPIFY" },
      retrievalQuery: "DÔEN cornella dress black" });
    expect(result).not.toHaveProperty("identity");
    expect(result).not.toHaveProperty("matchStatus");
  });

  it("canonicalizes only reviewed host aliases and strips explicit tracking parameters", () => {
    expect(resolveKnownProductUrl("https://shopdoen.com/products/cornella-dress-black?variant=472002&srsltid=source&utm_source=test"))
      .toMatchObject({ sourcePageUrl: "https://www.shopdoen.com/products/cornella-dress-black?variant=472002" });
    expect(resolveKnownProductUrl("https://shopdoen.com/products/cornella-dress-black/"))
      .toMatchObject({ sourcePageUrl: "https://www.shopdoen.com/products/cornella-dress-black" });
  });

  it.each([
    "Cornella Dress Black", "https://unknown.example/products/cornella-dress-black",
    "https://shopdoen.com.evil.example/products/cornella-dress-black",
    "https://evil.shopdoen.com/products/cornella-dress-black", "https://127.0.0.1/products/dress",
    "http://www.shopdoen.com/products/cornella-dress-black",
    "https://user:password@www.shopdoen.com/products/cornella-dress-black",
    "https://www.shopdoen.com:443/products/cornella-dress-black",
    "https://www.shopdoen.com:444/products/cornella-dress-black",
    "https://www.shopdoen.com/products/cornella-dress-black?redirect=https://evil.example",
    "https://www.shopdoen.com/products/cornella-dress-black?variant=472002&variant=472003",
    "https://www.shopdoen.com/products/cornella-dress-black?variant=black",
    "https://www.shopdoen.com/products/cornella-dress-black?color=black",
    "https://www.shopdoen.com/products/cornella-dress-black#other-product",
    "https://www.shopdoen.com/products/../products/cornella-dress-black",
    "https://www.shopdoen.com/products/cornella%2Fdress-black",
    "https://www.shopdoen.com/account", "https://www.shopdoen.com/products/",
    "https://www.shopdoen.com/products/cornella-dress-black.js"
  ])("does not admit unsupported or ambiguous URL: %s", value => {
    expect(resolveKnownProductUrl(value)).toBeUndefined();
  });

  it("preserves supported generic storefront selectors and Sony paths", () => {
    expect(resolveKnownProductUrl("https://www.freepeople.com/shop/lace-mini-dress/?color=001&size=S"))
      .toMatchObject({ sourcePageUrl: "https://www.freepeople.com/shop/lace-mini-dress/?color=001&size=S",
        retrievalQuery: "Free People lace mini dress", storefront: { platform: "GENERIC_JSON_LD" } });
    expect(resolveKnownProductUrl("https://electronics.sony.com/audio/headphones/headband/p/wh1000xm6-b"))
      .toMatchObject({ sourcePageUrl: "https://electronics.sony.com/audio/headphones/headband/p/wh1000xm6-b",
        storefront: { platform: "SONY_OCC" } });
    expect(resolveKnownProductUrl("https://electronics.sony.com/audio/headphones/headband/p/wh1000xm6-b?variant=1"))
      .toBeUndefined();
  });
});
