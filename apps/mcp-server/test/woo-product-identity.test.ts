import { describe, expect, it } from "vitest";
import { createUnavailableAwinPort } from "../../../packages/awin-feed/src/index.js";
import { WooProductSchema, type WooProduct } from "../../../packages/contracts/src/woocommerce.js";
import { evaluateRecoveredProducts, SearchProductsInputSchema, searchProducts, type UnifiedCandidate } from "../src/search-products.js";
import type { ShopifyProduct } from "../src/shopify-client.js";
import { createWooProductAnchor, matchesWooAnchoredCandidate, matchesWooProductAnchor } from "../src/woo-product-identity.js";
import { product as shopifyFixture, searchResult } from "./fixtures/conversation-replay-support.js";

// These synthetic source observations test identity rules, not merchant trust,
// live inventory, independent GTIN ownership or current prices.
const familyUrl = "https://woo-fixture.example/product/fitted-shirt";
const selectedUrl = `${familyUrl}?variation_id=101&attribute_color=black&attribute_size=M`;
const base = { affiliateState: "NONE", recommendationTier: "HIGH_RATED_UNVERIFIED", featureEvidence: [],
  preferenceEvidence: [], requiredFeatureLimitations: [], verifiedCoupons: [], identityStatus: "DISCOVERY_MATCH",
  identityEvidence: [], resultGroup: "REQUESTED_PRODUCT" } as const;

function woo(overrides: Partial<WooProduct> = {}): WooProduct {
  const selectedAttributes = overrides.selectedAttributes ?? { Color: "Black", Size: "M" };
  const defaultUrl = new URL(familyUrl);
  defaultUrl.searchParams.set("variation_id", String(overrides.variationId ?? 101));
  defaultUrl.searchParams.set("attribute_color", selectedAttributes.Color!.toLowerCase());
  defaultUrl.searchParams.set("attribute_size", selectedAttributes.Size!);
  return WooProductSchema.parse({ sourceKind: "WOOCOMMERCE_STORE_API", merchantId: "woo-fixture", merchantName: "Fixture Clothing",
    sourceHost: "woo-fixture.example", productId: 100, parentProductId: 100, variationId: 101, productType: "variation",
    title: "Fitted shirt", category: "shirt", condition: "NEW", sku: "SHIRT-BLK-M",
    attributes: [], variantDimensions: { Color: ["Black", "White"], Size: ["M", "L"] },
    selectedAttributes, merchantUrl: defaultUrl.href, images: [],
    itemPrice: { amountCents: 3200, currency: "USD" }, priceEvidence: { amountMinor: "3200", currency: "USD",
      currencyMinorUnit: 2, scope: "VARIANT", taxBasis: "UNKNOWN" }, availability: "IN_STOCK", availabilityScope: "VARIANT",
    checkedAt: "2026-09-08T15:34:17.000Z", ...overrides });
}

function wooCandidate(product: WooProduct): UnifiedCandidate {
  return { ...base, featureEvidence: [], preferenceEvidence: [], requiredFeatureLimitations: [], verifiedCoupons: [], identityEvidence: [],
    source: "WOOCOMMERCE_STORE_API", woocommerceProduct: product };
}

function shopifyCandidate(overrides: Partial<ShopifyProduct> = {}): UnifiedCandidate {
  return { ...base, featureEvidence: [], preferenceEvidence: [], requiredFeatureLimitations: [], verifiedCoupons: [], identityEvidence: [],
    source: "SHOPIFY_GLOBAL_CATALOG", shopifyProduct: shopifyFixture({ merchantId: "other-fixture", merchant: "Other fixture",
      sourceHost: "other-fixture.example", merchantUrl: "https://other-fixture.example/products/fitted-shirt", handle: "101",
      title: "Fitted shirt", productType: "shirt", sku: "SHIRT-BLK-M", brand: "Fixture Clothing",
      variantDimensions: { Color: "Black", Size: "M" }, ...overrides }) };
}

describe("Woo source-owned product anchors", () => {
  it("still rejects an explicitly supplied URL that contradicts the fixture child", () => {
    expect(() => woo({ variationId: 102, merchantUrl: selectedUrl })).toThrow();
  });
  it("binds merchant, parent, child, selected dimensions and the requested URL", () => {
    const product = woo();
    const anchor = createWooProductAnchor(product);
    expect(anchor).toEqual({ url: selectedUrl, merchantId: "woo-fixture", sourceHost: "woo-fixture.example", productId: 100,
      variationId: 101, productType: "variation", selectedAttributes: { Color: "Black", Size: "M" } });
    expect(matchesWooProductAnchor(product, anchor)).toBe(true);
    expect(matchesWooAnchoredCandidate(wooCandidate(product), anchor)).toBe(true);
  });

  it("copies selected dimensions before the provider can mutate its observation", () => {
    const product = woo();
    const anchor = createWooProductAnchor(product);
    product.selectedAttributes.Color = "White";
    product.variationId = 102;
    expect(anchor).toMatchObject({ variationId: 101, selectedAttributes: { Color: "Black", Size: "M" } });
  });

  it.each<[string, Partial<WooProduct>]>([
    ["merchant", { merchantId: "other-merchant" }],
    ["source host", { sourceHost: "other-fixture.example", merchantUrl: selectedUrl.replace("woo-fixture.example", "other-fixture.example") }],
    ["parent ID", { productId: 200, parentProductId: 200 }],
    ["child ID", { variationId: 102 }],
    ["product URL", { merchantUrl: selectedUrl.replace("fitted-shirt", "different-shirt") }],
    ["selected color", { selectedAttributes: { Color: "White", Size: "M" } }],
    ["selected size", { selectedAttributes: { Color: "Black", Size: "L" } }]
  ])("rejects a different %s even when title and merchant SKU are identical", (_label, overrides) => {
    const anchor = createWooProductAnchor(woo());
    const other = woo(overrides);
    expect(matchesWooProductAnchor(other, anchor)).toBe(false);
    expect(matchesWooAnchoredCandidate(wooCandidate(other), anchor)).toBe(false);
  });

  it.each(["utm_source=fixture", "gclid=fixture", "fbclid=fixture", "srsltid=fixture"])(
    "accepts harmless tracking %s without loosening child or dimension identity", tracking => {
      const anchor = createWooProductAnchor(woo(), `${selectedUrl}&${tracking}`);
      expect(matchesWooProductAnchor(woo(), anchor)).toBe(true);
      expect(matchesWooProductAnchor(woo({ variationId: 102 }), anchor)).toBe(false);
      expect(matchesWooProductAnchor(woo({ selectedAttributes: { Color: "White", Size: "M" } }), anchor)).toBe(false);
    });

  it.each([
    `${selectedUrl}&add-to-cart=101`, `${selectedUrl}&coupon=FREE`, `${selectedUrl}#other`,
    selectedUrl.replace("https://", "https://user:password@"), selectedUrl.replace("woo-fixture.example", "evil.example")
  ])("rejects a changed or unsafe target URL: %s", url => {
    expect(matchesWooProductAnchor(woo(), { ...createWooProductAnchor(woo()), url })).toBe(false);
  });

  it("keeps a bare parent URL at family scope and does not borrow its first child's global identity", () => {
    const anchor = createWooProductAnchor(woo({ gtin: "4006381333931", mpn: "SHIRT-BLK-M", brand: "Fixture Clothing" }), familyUrl);
    expect(anchor.variationId).toBeUndefined();
    expect(anchor.selectedAttributes).toEqual({});
    expect(anchor.gtin).toBeUndefined();
    expect(anchor.mpn).toBeUndefined();
    const sibling = woo({ variationId: 102, selectedAttributes: { Color: "White", Size: "L" },
      merchantUrl: `${familyUrl}?variation_id=102&attribute_color=white&attribute_size=L` });
    expect(matchesWooProductAnchor(sibling, anchor)).toBe(true);
    expect(matchesWooProductAnchor(woo({ productId: 200, parentProductId: 200 }), anchor)).toBe(false);
    expect(matchesWooAnchoredCandidate(shopifyCandidate({ gtins: ["4006381333931"], mpn: "SHIRT-BLK-M" }), anchor)).toBe(false);
  });

  it("retains the exact child when variation_id alone explicitly selects it", () => {
    const anchor = createWooProductAnchor(woo(), `${familyUrl}?variation_id=101`);
    expect(anchor).toMatchObject({ variationId: 101, selectedAttributes: { Color: "Black", Size: "M" } });
    expect(matchesWooProductAnchor(woo({ variationId: 102 }), anchor)).toBe(false);
  });
});

describe("cross-source global identity evidence", () => {
  it.each(["4006381333931", "04006381333931"])("accepts equivalent observed GTIN %s with every selected dimension", gtin => {
    const anchor = createWooProductAnchor(woo({ gtin: "4006381333931" }));
    expect(matchesWooAnchoredCandidate(shopifyCandidate({ gtins: [gtin] }), anchor)).toBe(true);
  });

  it("accepts observed brand plus manufacturer MPN with normalized complete dimensions", () => {
    const anchor = createWooProductAnchor(woo({ brand: "Fixture Clothing", mpn: "MODEL-BLK-M" }));
    expect(matchesWooAnchoredCandidate(shopifyCandidate({ brand: " fixture   clothing ", mpn: "model-blk-m",
      variantDimensions: { color: "BLACK", size: "m" } }), anchor)).toBe(true);
  });

  it.each<[string, Partial<ShopifyProduct>]>([
    ["title, SKU and handle only", {}], ["unrelated GTIN", { gtins: ["5901234123457"] }],
    ["brand without MPN", { brand: "Fixture Clothing" }], ["MPN with another brand", { brand: "Another Brand", mpn: "MODEL-BLK-M" }],
    ["same brand but different MPN", { brand: "Fixture Clothing", mpn: "MODEL-WHT-L" }]
  ])("rejects %s", (_label, overrides) => {
    const anchor = createWooProductAnchor(woo({ gtin: "4006381333931", brand: "Fixture Clothing", mpn: "MODEL-BLK-M" }));
    expect(matchesWooAnchoredCandidate(shopifyCandidate(overrides), anchor)).toBe(false);
  });

  it.each<[string, Record<string, string>]>([
    ["all dimensions absent", {}], ["size absent", { Color: "Black" }],
    ["wrong color", { Color: "White", Size: "M" }], ["wrong size", { Color: "Black", Size: "L" }]
  ])("rejects matching GTIN when %s", (_label, variantDimensions) => {
    const anchor = createWooProductAnchor(woo({ gtin: "4006381333931" }));
    expect(matchesWooAnchoredCandidate(shopifyCandidate({ gtins: ["4006381333931"], variantDimensions }), anchor)).toBe(false);
  });

  it("does not let a global identifier override a conflicting explicit child in the same Woo source", () => {
    const anchor = createWooProductAnchor(woo({ gtin: "4006381333931" }));
    expect(matchesWooAnchoredCandidate(wooCandidate(woo({ variationId: 102, gtin: "4006381333931" })), anchor)).toBe(false);
  });

  it("allows another Woo merchant only with an independently observed global ID and complete dimensions", () => {
    const anchor = createWooProductAnchor(woo({ gtin: "4006381333931" }));
    const other = woo({ merchantId: "other-fixture", sourceHost: "other-fixture.example", gtin: "4006381333931",
      merchantUrl: selectedUrl.replace("woo-fixture.example", "other-fixture.example") });
    expect(matchesWooAnchoredCandidate(wooCandidate(other), anchor)).toBe(true);
    expect(matchesWooAnchoredCandidate(wooCandidate(woo({ ...other, selectedAttributes: { Color: "White", Size: "M" },
      merchantUrl: other.merchantUrl.replace("attribute_color=black", "attribute_color=white") })), anchor)).toBe(false);
  });
});

describe("public search input boundary", () => {
  it("rejects a client-supplied wooAnchor even when its shape looks valid", () => {
    const ordinary = { query: familyUrl, limit: 3 };
    expect(SearchProductsInputSchema.safeParse(ordinary).success).toBe(true);
    const result = SearchProductsInputSchema.safeParse({ ...ordinary, wooAnchor: createWooProductAnchor(woo()) });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ code: "unrecognized_keys", keys: ["wooAnchor"] }));
  });
});

describe("Woo anchor enforcement during recovery and continuation", () => {
  it("rejects a fresh WEB title match that has no global identity for the requested Woo product", () => {
    const request = SearchProductsInputSchema.parse({ query: "Fitted shirt", limit: 3 });
    const unbound = shopifyCandidate().shopifyProduct!;
    const page: ShopifyProduct = { ...unbound, sourceKind: "WEB_PRODUCT_PAGE" };
    // The control proves this observation would otherwise reach presentation.
    expect(evaluateRecoveredProducts(request, [page], false).candidates).toHaveLength(1);
    const result = evaluateRecoveredProducts({ ...request, wooAnchor: createWooProductAnchor(woo()) }, [page], false);
    expect(result.candidates).toEqual([]);
    expect(result.identityProductsExcluded).toBeGreaterThan(0);
  });

  it("rechecks a retained recovery candidate against the anchor even when its title and trust qualify", () => {
    const request = SearchProductsInputSchema.parse({ query: "Fitted shirt", limit: 3 });
    const controls = { previousCandidates: [shopifyCandidate()] };
    expect(evaluateRecoveredProducts(request, [], true, controls).candidates).toHaveLength(1);
    const result = evaluateRecoveredProducts({ ...request, wooAnchor: createWooProductAnchor(woo()) }, [], true, controls);
    expect(result.candidates).toEqual([]);
    expect(result.sourceStatus.web).toBe("PARTIAL");
    expect(result.identityProductsExcluded).toBeGreaterThan(0);
  });

  it("does not let normal search continuation retain an unrelated prior title match", async () => {
    const request = { ...SearchProductsInputSchema.parse({ query: "Fitted shirt", limit: 3,
      contextMode: "CONTINUE_PREVIOUS_PRODUCT" }), previousCandidates: [shopifyCandidate()] };
    const ports = { awin: createUnavailableAwinPort(), shopify: { search: async () => searchResult([]) } };
    expect((await searchProducts(request, ports)).candidates).toHaveLength(1);
    const result = await searchProducts({ ...request, wooAnchor: createWooProductAnchor(woo()) }, ports);
    expect(result.candidates).toEqual([]);
    expect(result.candidateFunnel?.previousRetained).toBe(0);
  });

  it("does not let a fresh page for another variation erase the original Woo child", () => {
    const original = woo({ merchantUrl: `${familyUrl}?variation_id=101`,
      rating: { value: 4.8, reviewCount: 20, scale: 5, productId: 100 } });
    const request = { ...SearchProductsInputSchema.parse({ query: "Fitted shirt", limit: 3 }),
      wooAnchor: createWooProductAnchor(original) };
    const otherChild: ShopifyProduct = { ...shopifyCandidate().shopifyProduct!, sourceKind: "WEB_PRODUCT_PAGE",
      merchantId: "woo-fixture", sourceHost: "woo-fixture.example", merchantUrl: `${familyUrl}?variation_id=102`,
      handle: "102", availability: "OUT_OF_STOCK", checkedAt: "2026-09-08T16:34:17.000Z",
      itemPrice: { amountCents: 1000, currency: "USD" } };
    const result = evaluateRecoveredProducts(request, [otherChild], false, { previousCandidates: [wooCandidate(original)] });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.woocommerceProduct).toMatchObject({ productId: 100, variationId: 101,
      merchantUrl: `${familyUrl}?variation_id=101`, availability: "IN_STOCK",
      itemPrice: { amountCents: 3200, currency: "USD" }, checkedAt: "2026-09-08T15:34:17.000Z" });
    expect(original.variationId).toBe(101);
  });
});
