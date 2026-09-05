import { describe, expect, it, vi } from "vitest";

import type { AwinProductPort } from "../../../packages/awin-feed/src/index.js";
import {
  CodexVisualVerdictSchema,
  SearchProductsInputSchema,
  finalizeCodexVisualCandidates,
  resolveSearchIntent,
  shouldQueryAwin,
  searchProducts
} from "../src/search-products.js";
import type { ShopifyPort, ShopifySearchResult } from "../src/shopify-client.js";
import type { EbayBrowsePort } from "../src/ebay-client.js";
import type { OfficialShopifySearchPort } from "../src/shopify-official-store-search.js";
import { hasStrongProductIdentifier } from "../src/shopify-match.js";
import { DOEN_VISUAL_GOLDEN_CASES } from "./fixtures/doen-visual-golden.js";
import { SearchRun } from "../src/search-run.js";
import { sourceProductFingerprint } from "../src/visual-source-fingerprints.js";
import { visualOfficialStoreSearchQueries } from "../src/visual-product-discovery.js";

const now = "2026-08-24T12:00:00.000Z";

function awin(products = [awinProduct("mask-1", 1800)]): AwinProductPort {
  return {
    search: vi.fn(async () => ({
      source: "AWIN_PRODUCT_FEED" as const,
      coverage: "COMPLETE" as const,
      snapshotAt: now,
      diagnostics: {
        feedRows: products.length,
        validRows: products.length,
        rejectedRows: 0,
        queryMatches: products.length,
        priceProductsExcluded: 0
      },
      products
    }))
  };
}

function shopify(products = [shopifyProduct("101", 2500)]): ShopifyPort {
  return { search: vi.fn(async () => shopifyResult(products)) };
}

function ebay(products = [ebayProduct("1", 2100)]): EbayBrowsePort {
  return { search: vi.fn(async () => ({
    source: "EBAY_BROWSE" as const,
    environment: "PRODUCTION" as const,
    coverage: "COMPLETE" as const,
    snapshotAt: now,
    diagnostics: { queryMatches: products.length, itemsReturned: products.length, validItems: products.length, rejectedItems: 0 },
    products
  })) };
}

describe("unified product search", () => {
  it("does not convert a shoe size into a display requirement", async () => {
    const ports = { awin: awin([]), shopify: shopify([shopifyProduct("shoe", 9900, "UNKNOWN", {
      title: "Black ballet flats", productType: "ballet flats", variantDimensions: { Size: "US 7" }
    })]) };
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "ballet flats", productType: "ballet flats", requiredSize: "US 7" }), ports);
    expect(result.candidates[0]?.featureEvidence).toContain("US 7");
    expect(JSON.stringify(result.candidates)).not.toContain("US 7 display");
  });

  it("does not retain explicitly short wigs for a long-hair request", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "wig", productType: "wig", requiredFeatures: ["long hair"] }), {
      awin: awin([{ ...awinProduct("short", 3600), title: "Short human hair wig Finger Wave", category: "wig" }]),
      shopify: shopify([])
    });
    expect(result.candidates).toHaveLength(0);
  });
  it("keeps the original Shopify first query before the new structural continuation", async () => {
    const input = SearchProductsInputSchema.parse({ query: "cream floral dress", brand: "DÔEN", visualInput: {
      productType: "dress", colors: ["cream"], patterns: ["floral bouquets"], neckline: "scoop neck"
    } });
    const official = vi.fn<OfficialShopifySearchPort["search"]>(async () => []);
    await searchProducts({ ...input, deferVisualFiltering: true }, { awin: awin([]), shopify: shopify([]), officialShopify: { search: official } });
    expect(official.mock.calls[0]?.[0].query).toBe(visualOfficialStoreSearchQueries(input.visualInput!)[0]?.query);
    expect(official.mock.calls[1]?.[0].query).toBe("scoop neck dress");
  });
  it("continues official queries after review instead of stopping again on cached text matches", async () => {
    const first = shopifyProduct("first", 12000, "UNKNOWN", { sourceHost: "www.freepeople.com", merchant: "Free People",
      brand: "Free People", title: "Blue floral mini dress", productType: "dress",
      description: "Blue floral mini dress with round neck, sleeveless", merchantUrl: "https://www.freepeople.com/shop/first/" });
    const next = { ...first, handle: "next", merchantUrl: "https://www.freepeople.com/shop/next/" };
    let attempts = 0;
    const official = vi.fn<OfficialShopifySearchPort["search"]>(async () => ++attempts <= 2 ? [first] : [next]);
    const searchRun = new SearchRun();
    const input = { ...SearchProductsInputSchema.parse({ query: "blue floral mini dress", brand: "Free People", visualInput: {
      productType: "dress", colors: ["blue"], patterns: ["floral"], length: "mini", sleeveType: "sleeveless"
    } }), deferVisualFiltering: true, searchRun };
    const ports = { awin: awin([]), shopify: shopify([]), officialShopify: { search: official } };
    await searchProducts(input, ports);
    const prior = official.mock.calls.map(([call]) => call.query);
    expect(prior).toEqual(["blue floral mini dress"]);
    searchRun.recordVisualStage("REVIEW_CONFLICT", [sourceProductFingerprint("SHOPIFY", first)]);
    const result = await searchProducts(input, ports);
    expect(official.mock.calls.filter(([call]) => call.query === prior[0])).toHaveLength(1);
    expect(official.mock.calls.map(([call]) => call.query)).toContain("sleeveless mini dress");
    expect(result.reviewPool?.some(candidate => candidate.shopifyProduct?.handle === "next")).toBe(true);
  });
  it("uses the registered generic platform even when a global Shopify-shaped result exists", async () => {
    const product = shopifyProduct("generic-official", 12000, "UNKNOWN", { sourceHost: "www.freepeople.com", merchant: "Free People",
      brand: "Free People", title: "Free People Wrap Cami", productType: "top", merchantUrl: "https://www.freepeople.com/shop/wrap-cami/" });
    const officialSearch = vi.fn<OfficialShopifySearchPort["search"]>(async () => []);
    await searchProducts(SearchProductsInputSchema.parse({ query: "Free People cami", brand: "Free People", brandMode: "REQUIRED" }), {
      awin: awin([]), shopify: shopify([product]), officialShopify: { search: officialSearch }
    });
    expect(officialSearch).toHaveBeenCalledWith(expect.objectContaining({ seed: expect.objectContaining({ platform: "GENERIC_JSON_LD" }) }));
  });
  it.each([false, true])("ignores legacy local-catalog injection and uses current providers; visual=%s", async visual => {
    const product = shopifyProduct("live-provider", 12000, "UNKNOWN", { sourceHost: "www.shopdoen.com", merchant: "DÔEN",
      title: "Blue scoop neck floral dress", productType: "dress", merchantUrl: "https://www.shopdoen.com/products/blue-floral-dress" });
    // Legacy JavaScript callers may retain this extra field; it has no authority.
    const officialCatalog = { search: vi.fn(async () => { throw new Error("LOCAL_CATALOG_MUST_NOT_BE_READ"); }) };
    const ports = { awin: awin([]), shopify: shopify([product]), officialCatalog };
    const input = { ...SearchProductsInputSchema.parse({ query: "blue floral dress", ...(visual ? { visualInput: {
      productType: "dress", colors: ["blue"], patterns: ["floral"], neckline: "scoop neck"
    } } : {}) }), deferVisualFiltering: visual };
    const result = await searchProducts(input, ports);
    expect(officialCatalog.search).not.toHaveBeenCalled();
    expect(result.candidates.some(candidate => candidate.shopifyProduct?.handle === product.handle)).toBe(true);
    expect(result).not.toHaveProperty("officialCatalogDiagnostics");
    expect(JSON.stringify(result.searchRun?.diagnostics())).not.toContain("OFFICIAL_CATALOG");
    const calls = vi.mocked(ports.shopify.search).mock.calls.length;
    await searchProducts(input, ports);
    expect(vi.mocked(ports.shopify.search).mock.calls.length).toBeGreaterThan(calls);
    expect(officialCatalog.search).not.toHaveBeenCalled();
  });
  it("keeps reliable visual anchors in both global passes without a required brand", async () => {
    const ports = { awin: awin([]), shopify: shopify([]), ebay: ebay([]) };
    await searchProducts({
      ...SearchProductsInputSchema.parse({ query: "dress", visualInput: {
        productType: "dress", colors: ["black"], length: "mini",
        neckline: "boat neck", distinctiveDetails: ["horizontal lace bands"],
        observations: [{ attribute: "SLEEVE", value: "long sleeve", confidence: 0.2, visibility: "VISIBLE" }]
      } }), deferVisualFiltering: true
    }, ports);
    for (const port of [ports.awin, ports.shopify, ports.ebay]) {
      const calls = vi.mocked(port.search).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const [input] of calls) {
        expect(input.query).toMatch(/dress/u);
        expect(input.query).toMatch(/black/u);
        expect(input.query).toMatch(/mini/u);
        expect(input.query).toMatch(/lace|boat/u);
        expect(input.query).not.toMatch(/long sleeve/u);
      }
    }
  });

  it("starts a registry-backed observed-brand official search before the global catalog resolves", async () => {
    let releaseCatalog!: () => void;
    const catalogBlocked = new Promise<void>((resolve) => { releaseCatalog = resolve; });
    const officialSearch = vi.fn<OfficialShopifySearchPort["search"]>(async () => []);
    const pending = searchProducts({ ...SearchProductsInputSchema.parse({
      query: "black dress", visualInput: { brand: "DÔEN", productType: "dress", colors: ["black"] }
    }), deferVisualFiltering: true }, {
      awin: awin([]), shopify: { search: vi.fn(async () => { await catalogBlocked; return shopifyResult([]); }) },
      officialShopify: { search: officialSearch }
    });
    try {
      await vi.waitFor(() => expect(officialSearch).toHaveBeenCalled(), { timeout: 100 });
    } finally { releaseCatalog(); await pending; }
  });

  it("preserves an earlier official product when a later official query fails", async () => {
    const found = shopifyProduct("cornella-retained", 59_800, "UNKNOWN", {
      merchant: "DÔEN", brand: "DÔEN", sourceHost: "www.shopdoen.com",
      title: "Cornella Dress -- Black", productType: "dress",
      merchantUrl: "https://www.shopdoen.com/products/cornella-dress-black"
    });
    const officialSearch = vi.fn<OfficialShopifySearchPort["search"]>()
      .mockResolvedValueOnce([found]).mockRejectedValue(new Error("upstream timeout"));
    const result = await searchProducts({ ...SearchProductsInputSchema.parse({
      query: "black dress", brand: "DÔEN", visualInput: {
        productType: "dress", colors: ["black"], length: "mini", neckline: "boat neck"
      }
    }), deferVisualFiltering: true }, { awin: awin([]), shopify: shopify([]), officialShopify: { search: officialSearch } });
    expect(result.candidates.some((candidate) => candidate.shopifyProduct?.handle === found.handle)).toBe(true);
    expect(result.officialStoreFallback).toMatchObject({ status: "PARTIAL", productsReturned: 1 });
  });

  it("routes a known official source URL without inventing a required brand", async () => {
    const officialSearch = vi.fn<OfficialShopifySearchPort["search"]>(async () => []);
    const sourcePageUrl = "https://www.shopdoen.com/products/cornella-dress-black?variant=472002";
    await searchProducts({ ...SearchProductsInputSchema.parse({
      query: "black dress", visualInput: { productType: "dress", colors: ["black"], sourcePageUrl }
    }), deferVisualFiltering: true }, { awin: awin([]), shopify: shopify([]), officialShopify: { search: officialSearch } });
    expect(officialSearch.mock.calls[0]?.[0]).toMatchObject({
      sourcePageUrl, seed: { sourceHost: "www.shopdoen.com" }
    });
  });

  it("canonicalizes only registry-approved official aliases before direct hydration", async () => {
    const officialSearch = vi.fn<OfficialShopifySearchPort["search"]>(async () => []);
    await searchProducts({ ...SearchProductsInputSchema.parse({ query: "black dress", visualInput: {
      productType: "dress", sourcePageUrl: "https://shopdoen.com/products/cornella-dress-black"
    } }), deferVisualFiltering: true }, { awin: awin([]), shopify: shopify([]), officialShopify: { search: officialSearch } });
    expect(officialSearch.mock.calls[0]?.[0].sourcePageUrl).toBe("https://www.shopdoen.com/products/cornella-dress-black");
  });

  it("uses an observed brand for recall without excluding another brand's structurally valid candidate", async () => {
    const other = shopifyProduct("other-brand-dress", 1000, "UNKNOWN", {
      title: "Black Mini Dress", brand: "Other Brand", productType: "dress"
    });
    const result = await searchProducts({ ...SearchProductsInputSchema.parse({ query: "black mini dress", visualInput: {
      brand: "DÔEN", productType: "dress", colors: ["black"], length: "mini"
    } }), deferVisualFiltering: true }, { awin: awin([]), shopify: shopify([other]) });
    expect(result.reviewPool?.some((entry) => entry.shopifyProduct?.handle === other.handle)).toBe(true);
    expect(result.brandProductsExcluded).toBe(0);
  });

  it("accepts a bounded descriptive hard-feature alternative", () => {
    const feature = "contains ketoconazole, selenium sulfide, or zinc pyrithione as an active anti-dandruff ingredient";

    expect(feature.length).toBeGreaterThan(80);
    expect(SearchProductsInputSchema.parse({ query: "anti-dandruff shampoo", requiredFeatures: [feature] }))
      .toMatchObject({ requiredFeatures: [feature] });
  });

  it("rejects a visual attribute reported as both a match and a conflict", () => {
    const evidence = {
      attribute: "DISTINCTIVE_DETAIL" as const,
      referenceEvidence: "center-front tie",
      candidateEvidence: "center-front tie"
    };

    expect(() => CodexVisualVerdictSchema.parse({
      classification: "CONFLICT",
      matches: [evidence],
      conflicts: [evidence]
    })).toThrow("an attribute cannot both match and conflict");
  });

  it.each(DOEN_VISUAL_GOLDEN_CASES)(
    "recalls the verified official URL for $sourceImage before Codex image reranking",
    async ({ visualInput, expectedTitle, expectedHandle, expectedOfficialUrl, requiredQueryTerms }) => {
      const officialSeed = shopifyProduct("doen-seed", 36_800, "UNKNOWN", {
        merchantId: "official-shopdoen.com",
        merchant: "DÔEN",
        sourceHost: "www.shopdoen.com",
        merchantTrust: {
          level: "OFFICIAL",
          verification: "INDEPENDENT",
          evidence: ["official merchant domain"]
        },
        title: "DÔEN Dress",
        brand: "DÔEN",
        productType: "Dresses",
        description: "Official DÔEN dress",
        merchantUrl: "https://www.shopdoen.com/products/doen-seed"
      });
      const officialProduct = shopifyProduct(expectedHandle, 59_800, "UNKNOWN", {
        merchantId: officialSeed.merchantId,
        merchant: "DÔEN",
        sourceHost: "www.shopdoen.com",
        merchantTrust: officialSeed.merchantTrust,
        title: expectedTitle,
        brand: "DÔEN",
        productType: "Dresses",
        description: (visualInput.hardClues ?? []).join(" "),
        imageUrl: `https://cdn.shopify.com/${expectedHandle}.jpg`,
        merchantUrl: expectedOfficialUrl
      });
      const distractor = shopifyProduct(`other-${expectedHandle}`, 19_800, "UNKNOWN", {
        merchantId: officialSeed.merchantId,
        merchant: "DÔEN",
        sourceHost: "www.shopdoen.com",
        merchantTrust: officialSeed.merchantTrust,
        title: "Another DÔEN Dress",
        brand: "DÔEN",
        productType: "Dresses",
        description: "A different dress without the distinctive observed details",
        imageUrl: "https://cdn.shopify.com/other-doen-dress.jpg",
        merchantUrl: "https://www.shopdoen.com/products/other-doen-dress"
      });
      const officialSearch = vi.fn<OfficialShopifySearchPort["search"]>(async ({ query }) => {
        const normalized = query.toLocaleLowerCase("en-US");
        return requiredQueryTerms.every((term) => normalized.includes(term))
          ? [distractor, officialProduct]
          : [];
      });
      const parsed = SearchProductsInputSchema.parse({
        query: `DÔEN ${visualInput.productType}`,
        brand: "DÔEN",
        brandMode: "REQUIRED",
        productType: visualInput.productType,
        comparisonMode: "DISCOVERY",
        allowAlternatives: true,
        visualInput
      });

      const result = await searchProducts({
        ...parsed,
        deferVisualFiltering: true
      }, {
        awin: awin([]),
        shopify: { search: vi.fn(async () => shopifyResult([officialSeed])) },
        officialShopify: { search: officialSearch }
      });

      expect(officialSearch).toHaveBeenCalled();
      expect(result.candidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          presentationGroup: "OFFICIAL_STORE",
          shopifyProduct: expect.objectContaining({
            handle: expectedHandle,
            merchantUrl: expectedOfficialUrl
          })
        })
      ]));
      expect(result.visualProductsExcluded).toBe(0);
    }
  );

  it("keeps the official storefront's retrieval order until Codex visual review", async () => {
    const visualCase = DOEN_VISUAL_GOLDEN_CASES.find((entry) => entry.expectedHandle === "aloise-dress-salt")!;
    const trust = {
      level: "OFFICIAL" as const,
      verification: "INDEPENDENT" as const,
      evidence: ["official merchant domain"]
    };
    const seed = shopifyProduct("doen-seed", 36_800, "UNKNOWN", {
      merchantId: "official-shopdoen.com",
      merchant: "DÔEN",
      sourceHost: "www.shopdoen.com",
      merchantTrust: trust,
      title: "DÔEN Dress",
      brand: "DÔEN",
      productType: "Dresses",
      merchantUrl: "https://www.shopdoen.com/products/doen-seed"
    });
    const aloise = shopifyProduct("aloise-dress-salt", 36_800, "UNKNOWN", {
      merchantId: seed.merchantId,
      merchant: "DÔEN",
      sourceHost: "www.shopdoen.com",
      merchantTrust: trust,
      title: "Aloise Dress — Salt",
      brand: "DÔEN",
      productType: "FALL 26",
      description: "A ‘60s-inspired popover mini in ramie, with inset lace panels and scalloped lace framing the square neckline and straps.",
      imageUrl: "https://cdn.shopify.com/aloise-dress-salt.jpg",
      merchantUrl: "https://www.shopdoen.com/products/aloise-dress-salt"
    });
    const distractors = Array.from({ length: 6 }, (_, index) => shopifyProduct(
      `lower-price-dress-${index + 1}`,
      10_000 + index * 100,
      "UNKNOWN",
      {
        merchantId: seed.merchantId,
        merchant: "DÔEN",
        sourceHost: "www.shopdoen.com",
        merchantTrust: trust,
        title: `Lower Price Dress ${index + 1}`,
        brand: "DÔEN",
        productType: "FALL 26",
        description: "A different seasonal dress.",
        imageUrl: `https://cdn.shopify.com/lower-price-dress-${index + 1}.jpg`,
        merchantUrl: `https://www.shopdoen.com/products/lower-price-dress-${index + 1}`
      }
    ));

    const result = await searchProducts({
      ...SearchProductsInputSchema.parse({
        query: "DÔEN white lace mini dress",
        brand: "DÔEN",
        brandMode: "REQUIRED",
        productType: "women's mini dress",
        comparisonMode: "DISCOVERY",
        allowAlternatives: true,
        visualInput: visualCase.visualInput
      }),
      limit: 6,
      deferVisualFiltering: true
    }, {
      awin: awin([]),
      shopify: { search: vi.fn(async () => shopifyResult([seed])) },
      officialShopify: { search: vi.fn(async () => [aloise, ...distractors]) }
    });

    expect(result.candidates).toHaveLength(6);
    expect(result.candidates[0]).toMatchObject({
      presentationGroup: "OFFICIAL_STORE",
      shopifyProduct: {
        handle: "aloise-dress-salt",
        merchantUrl: "https://www.shopdoen.com/products/aloise-dress-salt"
      }
    });
  });

  it("rejects a conflicting product family before visual candidate review", async () => {
    const blouse = shopifyProduct("lace-blouse", 15_000, "UNKNOWN", {
      title: "DÔEN ivory lace blouse",
      brand: "DÔEN",
      productType: "women's tops",
      description: "ruffled tie-front blouse",
      imageUrl: "https://cdn.shopify.com/lace-blouse.jpg"
    });
    const shoe = shopifyProduct("slide-shoe", 12_000, "UNKNOWN", {
      title: "DÔEN flat slide shoe",
      brand: "DÔEN",
      productType: "women's shoes",
      imageUrl: "https://cdn.shopify.com/slide-shoe.jpg"
    });
    const result = await searchProducts({
      ...SearchProductsInputSchema.parse({
        query: "DÔEN ivory lace blouse",
        brand: "DÔEN",
        brandMode: "REQUIRED",
        productType: "women's blouse",
        comparisonMode: "DISCOVERY",
        visualInput: { brand: "DÔEN", colors: ["ivory"] }
      }),
      deferVisualFiltering: true
    }, {
      awin: awin([]),
      shopify: shopify([shoe, blouse])
    });

    expect(result.candidates.flatMap((candidate) => candidate.shopifyProduct === undefined
      ? []
      : [candidate.shopifyProduct.handle]
    )).toEqual(["lace-blouse"]);
    expect(result.visualProductsExcluded).toBe(1);
  });

  it("normalizes natural punctuation instead of rejecting a valid product query", () => {
    const input = SearchProductsInputSchema.parse({
      query: "DOEN dress, black (mini) & lace!",
      brand: "DOEN"
    });

    expect(input.query).toBe("DOEN dress black mini and lace");
    expect(input.brand).toBe("DÔEN");
  });

  it("queries Shopify in parallel and preserves merchant diversity when Awin fills the trusted pool", async () => {
    const awinPort = awin([
      awinProduct("1", 1800),
      awinProduct("2", 1900),
      awinProduct("3", 2000)
    ]);
    const shopifyPort = shopify();

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "keratin hair mask",
      limit: 3
    }), { awin: awinPort, shopify: shopifyPort });

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map((candidate) => candidate.source)).toEqual([
      "AWIN_PRODUCT_FEED",
      "SHOPIFY_GLOBAL_CATALOG",
      "AWIN_PRODUCT_FEED"
    ]);
    expect(result.candidates.every((candidate) =>
      candidate.presentationGroup === "TRUSTED_MATCH"
    )).toBe(true);
    expect(shopifyPort.search).toHaveBeenCalledTimes(1);
    expect(shopifyPort.search).toHaveBeenCalledWith(expect.objectContaining({ limit: 12 }));
  });

  it("fills missing affiliate results with Shopify without commission scoring", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "护发 发膜",
      limit: 3
    }), {
      awin: awin([awinProduct("1", 3000)]),
      shopify: shopify([shopifyProduct("101", 1000), shopifyProduct("102", 1200)])
    });

    expect(result.candidates.map((candidate) => candidate.source)).toEqual([
      "SHOPIFY_GLOBAL_CATALOG",
      "SHOPIFY_GLOBAL_CATALOG",
      "AWIN_PRODUCT_FEED"
    ]);
  });

  it("starts Awin, Shopify, and eBay together before any source completes", async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = searchProducts(SearchProductsInputSchema.parse({ query: "headphones", limit: 3 }), {
      awin: { search: vi.fn(async () => { started.push("awin"); await gate; return await awin([]).search({ query: "headphones", limit: 3 }); }) },
      shopify: { search: vi.fn(async () => { started.push("shopify"); await gate; return shopifyResult([]); }) },
      ebay: { search: vi.fn(async () => { started.push("ebay"); await gate; return await ebay([]).search({ query: "headphones", limit: 3 }); }) }
    });

    await vi.waitFor(() => expect(started.sort()).toEqual(["awin", "ebay", "shopify"]));
    release();
    await pending;
  });

  it("does not let an unconfirmed Coupon beat a lower raw price at equal match and trust", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "hair mask", limit: 2 }), {
      awin: awin([]),
      shopify: shopify([shopifyProduct("lower", 1000), shopifyProduct("coupon", 1200)]),
      deals: { search: vi.fn(async ({ merchant }) => merchant === "Merchant coupon" ? [verifiedCoupon(merchant)] : []) }
    });

    expect(result.candidates.map((candidate) => candidate.shopifyProduct?.handle)).toEqual(["lower", "coupon"]);
    expect(result.candidates[1]?.verifiedCoupons).toHaveLength(1);
  });

  it("uses a confirmed product Coupon price when it is lower than the raw-price alternative", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "hair mask", limit: 2 }), {
      awin: awin([]),
      shopify: shopify([shopifyProduct("lower", 1000), shopifyProduct("coupon", 1200)]),
      deals: { search: vi.fn(async ({ merchant }) => merchant === "Merchant coupon" ? [{
        ...verifiedCoupon(merchant),
        productApplicability: "PRODUCT_CONFIRMED" as const,
        applicableProductIds: ["coupon"],
        eligibility: []
      }] : []) }
    });

    expect(result.candidates.map((candidate) => candidate.shopifyProduct?.handle)).toEqual(["coupon", "lower"]);
  });

  it("uses cross-source price order only for explicit LOWEST_PRICE", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "hair mask",
      limit: 2,
      selectionMode: "LOWEST_PRICE"
    }), {
      awin: awin([awinProduct("1", 3000)]),
      shopify: shopify([shopifyProduct("101", 1000)])
    });

    expect(result.candidates.map((candidate) => candidate.source)).toEqual([
      "SHOPIFY_GLOBAL_CATALOG",
      "AWIN_PRODUCT_FEED"
    ]);
  });

  it("does not infer NEW when the query has no explicit condition", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "Apple MacBook Pro",
      limit: 1,
      conditionPreference: "NEW"
    }), { awin: awin([]), shopify: shopify([shopifyProduct("macbook", 199_900, "UNKNOWN", {
      title: "Apple MacBook Pro 14-inch",
      brand: "Apple",
      productType: "Computers"
    })]) });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.shopifyProduct?.condition).toBe("UNKNOWN");
  });

  it("keeps budget and usage out of source identity while applying the price ceiling", async () => {
    const search = vi.fn<ShopifyPort["search"]>(async () => shopifyResult([
      shopifyProduct("m5-pro", 234_900, "NEW", { title: "Apple MacBook Pro M5 Pro 24GB 1TB", brand: "Apple" }),
      shopifyProduct("m4-max", 259_900, "NEW", { title: "Apple MacBook Pro M4 Max 36GB 1TB", brand: "Apple" }),
      shopifyProduct("m3", 100_000, "NEW", { title: "Apple MacBook Pro M3 8GB 512GB", brand: "Apple" })
    ]));

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "MacBook Pro for programming under $3000",
      brand: "Apple",
      brandMode: "REQUIRED",
      productType: "MacBook Pro laptop",
      preferences: ["suitable for software development", "24GB unified memory", "1TB SSD"],
      maxItemPriceCents: 300_000,
      limit: 3
    }), { awin: awin([]), shopify: { search } });

    expect(search.mock.calls[0]?.[0]).toMatchObject({
      query: "Apple MacBook Pro",
      maxItemPriceCents: 300_000,
      limit: 12
    });
    expect(result.candidates[0]?.shopifyProduct?.title).toBe("Apple MacBook Pro M5 Pro 24GB 1TB");
  });

  it("keeps MacBook size and office use out of identity while ranking the preferred size", async () => {
    const search = vi.fn<ShopifyPort["search"]>(async () => shopifyResult([
      shopifyProduct("sixteen-cheap", 99_900, "NEW", {
        title: "16-inch MacBook Pro (M5)", brand: "Apple", productType: "Computers"
      }),
      shopifyProduct("tigertech", 299_900, "NEW", {
        title: "MacBook Pro - 14-inch - M5 Pro - 24GB - 2TB SSD", brand: "Apple", productType: "Computers"
      }),
      shopifyProduct("expercom", 190_900, "NEW", {
        title: "14-inch MacBook Pro (M5)", brand: "Apple", productType: "Computers"
      }),
      shopifyProduct("sva", 234_900, "NEW", {
        title: "MacBook Pro 14-inch (M5 Pro)", brand: "Apple", productType: "Computers"
      })
    ]));

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "Apple MacBook Pro 14-inch for office use under $3000",
      productType: "laptop",
      brand: "Apple",
      brandMode: "REQUIRED",
      comparisonMode: "DISCOVERY",
      contextMode: "CONTINUE_PREVIOUS_PRODUCT",
      limit: 8,
      maxItemPriceCents: 300_000,
      primaryUse: "办公",
      preferredSize: "14英寸",
      preferences: ["适合办公"]
    }), { awin: awin([]), shopify: { search } });

    expect(search.mock.calls[0]?.[0]).toMatchObject({
      query: "Apple MacBook Pro",
      maxItemPriceCents: 300_000
    });
    expect(result.searchIntent).toBe("EXACT_PRODUCT");
    expect(result.identityProductsExcluded).toBe(0);
    expect(result.chromeFallbackEligible).toBe(false);
    expect(result.candidates.map((candidate) => candidate.shopifyProduct?.handle)).toEqual([
      "expercom",
      "sva",
      "tigertech",
      "sixteen-cheap"
    ]);
    expect(result.candidates[0]?.preferenceEvidence).toContain("14英寸 屏幕");
    expect(result.candidates[3]?.presentationGroup).toBe("BEST_VALUE");
  });

  it("keeps compound ChatGPT/API use out of identity and enforces an explicitly selected size", async () => {
    const search = vi.fn<ShopifyPort["search"]>(async () => shopifyResult([
      shopifyProduct("fourteen", 238_900, "NEW", {
        title: "14-inch MacBook Pro (M5 Pro or Max)", brand: "Apple", productType: "Computers"
      }),
      shopifyProduct("sixteen", 249_900, "NEW", {
        title: "16-inch MacBook Pro (M5 Pro)", brand: "Apple", productType: "Computers"
      })
    ]));

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "Apple MacBook Pro 14-inch for ChatGPT and API-based AI programming under $3000",
      productType: "MacBook Pro",
      brand: "Apple",
      brandMode: "REQUIRED",
      primaryUse: "ChatGPT/API AI programming",
      requiredSize: "14-inch",
      maxItemPriceCents: 300_000,
      comparisonMode: "DISCOVERY",
      contextMode: "CONTINUE_PREVIOUS_PRODUCT",
      allowAlternatives: false,
      limit: 8
    }), { awin: awin([]), shopify: { search } });

    expect(search.mock.calls[0]?.[0]).toMatchObject({
      query: "Apple MacBook Pro",
      maxItemPriceCents: 300_000
    });
    expect(result.searchIntent).toBe("EXACT_PRODUCT");
    expect(result.identityProductsExcluded).toBe(0);
    expect(result.featureProductsExcluded).toBe(1);
    expect(result.candidates.map((candidate) => candidate.shopifyProduct?.handle)).toEqual(["fourteen"]);
    expect(result.candidates[0]?.featureEvidence).toContain("14-inch display");
  });

  it("keeps added required specifications out of product identity", async () => {
    const search = vi.fn<ShopifyPort["search"]>(async () => shopifyResult([
      shopifyProduct("m5-pro-24", 234_900, "NEW", {
        title: "Apple MacBook Pro M5 Pro 24GB 1TB",
        brand: "Apple"
      }),
      shopifyProduct("m5-16", 190_900, "NEW", {
        title: "Apple MacBook Pro M5 16GB 1TB",
        brand: "Apple"
      })
    ]));

    const result = await searchProducts(SearchProductsInputSchema.parse({
      contextMode: "CONTINUE_PREVIOUS_PRODUCT",
      query: "Apple MacBook Pro 24GB memory",
      brand: "Apple",
      brandMode: "REQUIRED",
      productType: "laptop",
      requiredFeatures: ["24GB memory"],
      maxItemPriceCents: 300_000,
      limit: 3
    }), { awin: awin([]), shopify: { search } });

    expect(search.mock.calls[0]?.[0].query).toBe("Apple MacBook Pro");
    expect(result.candidates.map((candidate) => candidate.shopifyProduct?.handle)).toEqual(["m5-pro-24"]);
  });

  it("keeps a branded two-term product identity during both search passes", async () => {
    const search = vi.fn<ShopifyPort["search"]>(async () => shopifyResult([
      shopifyProduct("dunk-low", 12_000, "NEW", {
        title: "Nike Dunk Low Retro",
        brand: "Nike",
        productType: "Sneakers"
      })
    ]));

    const result = await searchProducts(SearchProductsInputSchema.parse({
      contextMode: "NEW_PRODUCT",
      query: "Nike Dunk",
      productType: "sneakers",
      brand: "Nike",
      brandMode: "REQUIRED",
      limit: 3
    }), { awin: awin([]), shopify: { search } });

    expect(result.searchIntent).toBe("EXACT_PRODUCT");
    expect(search.mock.calls[0]?.[0].query).toBe("Nike Dunk");
    expect(search.mock.calls[1]?.[0].query).toContain("Nike Dunk");
    expect(result.candidates).toHaveLength(1);
  });

  it("does not treat compatibility text as required-brand evidence", async () => {
    const compatible = shopifyProduct("nacs-compatible", 39_999, "UNKNOWN", {
      title: "EVIQO EV Charger compatible with Tesla and NACS",
      brand: "EVIQO",
      productType: "EV Chargers",
      description: "Third-party home charger for Tesla vehicles"
    });
    const official = shopifyProduct("tesla-wall-connector", 47_500, "UNKNOWN", {
      title: "Tesla Universal Wall Connector",
      brand: "Tesla",
      productType: "EV Chargers"
    });

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "Tesla charger",
      productType: "EV charger",
      brand: "Tesla",
      brandMode: "REQUIRED",
      comparisonMode: "DISCOVERY"
    }), { awin: awin([]), shopify: shopify([compatible, official]) });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      source: "SHOPIFY_GLOBAL_CATALOG",
      shopifyProduct: { handle: "tesla-wall-connector", brand: "Tesla" }
    });
  });

  it("rejects UNKNOWN affiliate condition when NEW is explicitly required", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "全新 hair mask",
      limit: 1,
      conditionPreference: "NEW"
    }), { awin: awin(), shopify: shopify([shopifyProduct("101", 2500, "NEW")]) });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.source).toBe("SHOPIFY_GLOBAL_CATALOG");
  });

  it("fails closed for Chrome when a queried source is unavailable", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "hair mask",
      limit: 3
    }), {
      awin: { search: vi.fn(async () => { throw new Error("offline"); }) },
      shopify: shopify([])
    });

    expect(result.candidates).toEqual([]);
    expect(result.chromeFallbackEligible).toBe(false);
  });

  it("preserves a catalog schema-change error and does not retry the incompatible response", async () => {
    const search = vi.fn(async () => {
      throw new Error("CATALOG_SCHEMA_CHANGED");
    });

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "everyday ballet flats",
      limit: 3
    }), { awin: awin([]), shopify: { search } });

    expect(result.candidates).toEqual([]);
    expect(result.sourceStatus.shopify).toBe("UNAVAILABLE");
    expect(result.sourceErrors).toEqual({ shopify: "CATALOG_SCHEMA_CHANGED" });
    expect(result.chromeFallbackEligible).toBe(false);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("runs one feature-enriched expansion before Chrome and accepts minimum capacity", async () => {
    const shopifySearch = vi.fn()
      .mockResolvedValueOnce(shopifyResult([]))
      .mockResolvedValueOnce(shopifyResult([
        shopifyProduct("macbook-36", 329_900, "NEW", {
          title: "Apple MacBook Pro M5 Pro 16.2-inch 36GB",
          variantDimensions: { Memory: "36GB", Display: "16.2 inch" }
        })
      ]));

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "Apple MacBook Pro M5 Pro",
      limit: 3,
      conditionPreference: "NEW",
      features: ["at least 32GB", "16 inch", "M5 Pro"],
      featureMode: "REQUIRED"
    }), { awin: awin([]), shopify: { search: shopifySearch } });

    expect(shopifySearch).toHaveBeenCalledTimes(2);
    expect(shopifySearch.mock.calls[1]?.[0]).toMatchObject({
      query: "Apple MacBook Pro M5 Pro at least 32GB 16 inch M5 Pro",
      limit: 12
    });
    expect(result.searchPasses).toBe(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.featureEvidence).toEqual(["at least 32GB", "16 inch", "M5 Pro"]);
    expect(result.chromeFallbackEligible).toBe(false);
  });

  it("normalizes inch notation in titles and variant dimensions", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "MacBook Pro",
      limit: 3,
      features: ["14-inch display"],
      featureMode: "REQUIRED"
    }), {
      awin: awin([]),
      shopify: shopify([
        shopifyProduct("hyphen", 199_900, "UNKNOWN", { title: "MacBook Pro 14-inch M4" }),
        shopifyProduct("quote", 209_900, "UNKNOWN", { title: "MacBook Pro 14\" M4 Pro" }),
        shopifyProduct("variant", 219_900, "UNKNOWN", {
          title: "MacBook Pro M4 Pro",
          variantDimensions: { Size: "14 inch" }
        })
      ])
    });

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.every((candidate) =>
      candidate.featureEvidence.includes("14-inch display")
    )).toBe(true);
    expect(result.featureProductsExcluded).toBe(0);
  });

  it("counts unique products excluded by required features across both passes", async () => {
    const rejected = shopifyProduct("thirteen-inch", 149_900, "UNKNOWN", {
      title: "MacBook Pro 13-inch"
    });
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "MacBook Pro",
      limit: 3,
      features: ["14-inch display"],
      featureMode: "REQUIRED"
    }), {
      awin: awin([]),
      shopify: shopify([rejected])
    });

    expect(result.candidates).toEqual([]);
    expect(result.searchPasses).toBe(2);
    expect(result.featureProductsExcluded).toBe(1);
  });

  it("uses a broader feature query for paraphrased product needs", async () => {
    const shopifySearch = vi.fn()
      .mockResolvedValueOnce(shopifyResult([]))
      .mockResolvedValueOnce(shopifyResult([
        shopifyProduct("repair-conditioner", 2200, "NEW", {
          title: "Repair Conditioner for Dry Damaged Hair"
        })
      ]));

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "conditioner",
      features: ["repair dry damaged hair"],
      featureMode: "REQUIRED"
    }), { awin: awin([]), shopify: { search: shopifySearch } });

    expect(shopifySearch.mock.calls[1]?.[0].query).toBe("conditioner repair dry damaged hair");
    expect(result.candidates).toHaveLength(1);
  });

  it("keeps missing hard-feature evidence as a limited DISCOVERY_MATCH", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "women shoes",
      productType: "ballet flats",
      requiredFeatures: ["leather"],
      preferences: ["日常穿"]
    }), {
      awin: awin([]),
      shopify: shopify([shopifyProduct("flat-unknown", 7900, "UNKNOWN", {
        title: "Classic ballet flat",
        productType: "Women's flats",
        description: "Simple slip-on design"
      })])
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.shopifyProduct?.matchStatus).toBe("DISCOVERY_MATCH");
    expect(result.candidates[0]?.requiredFeatureLimitations).toEqual(["leather"]);
    expect(result.featureProductsExcluded).toBe(0);
  });

  it("uses title, category, description, and structured attributes as feature evidence", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "women shoes",
      productType: "flat shoes",
      requiredFeatures: ["皮质", "平底鞋"]
    }), {
      awin: awin([]),
      shopify: shopify([shopifyProduct("leather-flat", 9900, "UNKNOWN", {
        title: "Women's everyday shoe",
        productType: "Ballet flats",
        description: "Genuine leather upper",
        variantDimensions: { Construction: "flat sole" }
      })])
    });

    expect(result.candidates[0]?.featureEvidence).toEqual(["皮质", "平底鞋"]);
    expect(result.candidates[0]?.requiredFeatureLimitations).toEqual([]);
  });

  it("excludes explicit conflicts but never filters on a subjective preference", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "women shoes",
      productType: "flat shoes",
      requiredFeatures: ["flat sole"],
      preferences: ["日常穿"]
    }), {
      awin: awin([]),
      shopify: shopify([
        shopifyProduct("heels", 6000, "UNKNOWN", { title: "Women's high heel pump" }),
        shopifyProduct("plain-flat", 6500, "UNKNOWN", { title: "Women's ballet flat" }),
        shopifyProduct("daily-flat", 7000, "UNKNOWN", { title: "Women's everyday casual ballet flat" })
      ])
    });

    expect(result.candidates.map((candidate) => candidate.shopifyProduct?.handle)).toEqual([
      "daily-flat",
      "plain-flat"
    ]);
    expect(result.candidates[0]?.preferenceEvidence).toEqual(["日常穿"]);
    expect(result.featureProductsExcluded).toBe(1);
  });

  it("adds productType to the initial source query", async () => {
    const shopifySearch = vi.fn(async () => shopifyResult([shopifyProduct("flat", 5000)]));
    await searchProducts(SearchProductsInputSchema.parse({
      query: "women black",
      productType: "ballet flats"
    }), { awin: awin([]), shopify: { search: shopifySearch } });

    expect(shopifySearch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      query: "women black ballet flats"
    }));
  });

  it("orders trusted, qualified high-rated, then general unverified merchants", async () => {
    const highRated = shopifyProduct("high-rated", 1000, "NEW", {
      merchantTrust: {
        level: "UNKNOWN",
        verification: "UNVERIFIED",
        evidence: ["no independent merchant trust evidence"]
      },
      productRating: { value: 3.9, count: 2, scaleMax: 5 }
    });
    const general = shopifyProduct("general", 900, "NEW", {
      merchantTrust: {
        level: "UNKNOWN",
        verification: "UNVERIFIED",
        evidence: ["no independent merchant trust evidence"]
      },
      productRating: { value: 5, count: 1, scaleMax: 5 }
    });
    const trusted = shopifyProduct("trusted", 3000, "NEW");
    const shopifySearch = vi.fn(async () => shopifyResult([general, highRated, trusted]));

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "cat toy",
      limit: 3
    }), { awin: awin([]), shopify: { search: shopifySearch } });

    expect(shopifySearch).toHaveBeenCalledTimes(1);
    expect(result.candidates.map((candidate) => candidate.recommendationTier)).toEqual([
      "TRUSTED_OR_AFFILIATE",
      "HIGH_RATED_UNVERIFIED",
      "GENERAL_UNVERIFIED"
    ]);
    expect(result.candidates.map((candidate) => candidate.presentationGroup)).toEqual([
      "TRUSTED_MATCH",
      "BEST_VALUE",
      "BEST_VALUE"
    ]);
    expect(result.chromeFallbackEligible).toBe(false);
  });

  it.each([0, 1])("preserves %i first-pass Awin products but degrades coverage after expansion failure", async (count) => {
    const first = await awin(count === 0 ? [] : [awinProduct("retained-awin", 1_800)]).search({ query: "hair mask", limit: 12 });
    const search = vi.fn<AwinProductPort["search"]>().mockResolvedValueOnce(first)
      .mockRejectedValue(new Error("second-pass network unavailable"));
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "hair mask", limit: 3 }), {
      awin: { search }, shopify: shopify([])
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(result.awinResult).toBe(first);
    expect(result.candidates).toHaveLength(count);
    if (count > 0) expect(result.candidates[0]).toMatchObject({
      source: "AWIN_PRODUCT_FEED", awinProduct: { merchantProductId: "retained-awin" }
    });
    expect(result.sourceStatus.awin).toBe("UNAVAILABLE");
    expect(result.sourceErrors).toMatchObject({ awin: "DATA_SOURCE_UNAVAILABLE" });
    expect(result.chromeFallbackEligible).toBe(false);
    expect(result.searchRun?.diagnostics().budgetExhausted).toBe(false);
  });

  it("hides the official tier without an explicitly requested brand and does not pad its slots", async () => {
    const official = (handle: string) => shopifyProduct(handle, 4_000, "NEW", {
      merchant: "SKIMS",
      sourceHost: "skims.com",
      merchantTrust: {
        level: "OFFICIAL",
        verification: "INDEPENDENT",
        evidence: ["verified official domain"]
      },
      merchantUrl: `https://skims.com/products/${handle}`
    });
    const general = (handle: string, amountCents: number) => shopifyProduct(handle, amountCents, "NEW", {
      merchantTrust: {
        level: "UNKNOWN",
        verification: "UNVERIFIED",
        evidence: ["no independent merchant trust evidence"]
      }
    });
    const products = [
      official("official-1"),
      official("official-2"),
      official("official-3"),
      shopifyProduct("trusted-1", 3_000, "NEW"),
      shopifyProduct("trusted-2", 3_100, "NEW"),
      shopifyProduct("trusted-3", 3_200, "NEW"),
      shopifyProduct("trusted-4", 3_300, "NEW"),
      general("value-1", 900),
      general("value-2", 1_000),
      general("value-3", 1_100),
      general("value-4", 1_200)
    ];

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "keratin hair mask",
      limit: 8
    }), { awin: awin([]), shopify: shopify(products) });

    expect(result.candidates).toHaveLength(6);
    expect(result.candidates.map((candidate) => candidate.presentationGroup)).toEqual([
      "TRUSTED_MATCH",
      "TRUSTED_MATCH",
      "TRUSTED_MATCH",
      "BEST_VALUE",
      "BEST_VALUE",
      "BEST_VALUE"
    ]);
  });

  it("fills best-value with remaining high-rated candidates and keeps trusted merchants diverse", async () => {
    const highRated = (handle: string, amountCents: number) => shopifyProduct(handle, amountCents, "NEW", {
      merchantTrust: {
        level: "UNKNOWN",
        verification: "UNVERIFIED",
        evidence: ["no independent merchant trust evidence"]
      },
      productRating: { value: 4.9, count: 100, scaleMax: 5 }
    });
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "keratin hair mask",
      limit: 8,
      selectionMode: "MERCHANT_DIVERSE"
    }), {
      awin: awin([
        awinProduct("awin-1", 1_800),
        awinProduct("awin-2", 1_900),
        awinProduct("awin-3", 2_000)
      ]),
      shopify: shopify([
        highRated("rated-1", 2_100),
        highRated("rated-2", 2_200),
        highRated("rated-3", 2_300),
        highRated("rated-4", 2_400),
        highRated("rated-5", 2_500)
      ])
    });

    expect(result.candidates).toHaveLength(6);
    expect(result.candidates.map((candidate) => candidate.presentationGroup)).toEqual([
      "TRUSTED_MATCH",
      "TRUSTED_MATCH",
      "TRUSTED_MATCH",
      "BEST_VALUE",
      "BEST_VALUE",
      "BEST_VALUE"
    ]);
    expect(result.candidates.slice(0, 3).map((candidate) =>
      candidate.source === "AWIN_PRODUCT_FEED"
        ? candidate.awinProduct.merchant
        : candidate.source === "SHOPIFY_GLOBAL_CATALOG"
          ? candidate.shopifyProduct.merchant
          : "eBay"
    )).toEqual(["Amazonliss (US)", "Amazonliss (US)", "Amazonliss (US)"]);
    expect(result.candidates.slice(3).every((candidate) =>
      candidate.recommendationTier === "HIGH_RATED_UNVERIFIED"
    )).toBe(true);
  });

  it.each([undefined, 300_000])("keeps configuration evidence separate from budget eligibility: %s", async maxItemPriceCents => {
    const configured = shopifyProduct("macbook-m5-pro-24", 234_900, "UNKNOWN", {
      title: "MacBook Pro 14-inch M5 Pro",
      productType: "Laptop Computers",
      variantDimensions: { Memory: "24GB", Display: "14 inch", Chip: "M5 Pro" },
      matchStatus: "SIMILAR"
    });
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "Apple MacBook Pro 14-inch M5 Pro 24GB",
      brand: "Apple",
      brandMode: "REQUIRED",
      productType: "laptop computer",
      requiredFeatures: ["14-inch display", "M5 Pro chip", "24GB memory"],
      ...(maxItemPriceCents === undefined ? {} : { maxItemPriceCents }),
      limit: 3
    }), { awin: awin([]), shopify: shopify([configured]) });

    expect(hasStrongProductIdentifier("Apple MacBook Pro 14-inch M5 Pro 24GB")).toBe(false);
    expect(hasStrongProductIdentifier("Sony WH-1000XM6")).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      identityStatus: "DISCOVERY_MATCH",
      resultGroup: "REQUESTED_PRODUCT",
      requiredFeatureLimitations: ["M5 Pro chip"]
    });
    expect(result.candidates[0]?.identityEvidence).toContain(
      "all required configuration matched; stable product identity unavailable"
    );
  });

  it("does not use configuration discovery for explicit same-product comparison", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "Apple MacBook Pro 14-inch M5 Pro 24GB",
      comparisonMode: "SAME_PRODUCT",
      brand: "Apple",
      brandMode: "REQUIRED",
      requiredFeatures: ["14-inch display", "M5 Pro chip", "24GB memory"]
    }), {
      awin: awin([]),
      shopify: shopify([shopifyProduct("similar-config", 234_900, "UNKNOWN", {
        title: "MacBook Pro 14-inch M5 Pro",
        variantDimensions: { Memory: "24GB", Display: "14 inch", Chip: "M5 Pro" },
        matchStatus: "SIMILAR"
      })])
    });

    expect(result.candidates).toEqual([]);
  });

  it("does not use configuration discovery when the query contains a stable model identifier", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "Sony WH-1000XM6",
      brand: "Sony",
      brandMode: "REQUIRED",
      requiredFeatures: ["wireless", "noise cancelling"]
    }), {
      awin: awin([]),
      shopify: shopify([shopifyProduct("wh-1000xm5", 29_900, "UNKNOWN", {
        title: "Sony WH-1000XM5 Wireless Noise Cancelling Headphones",
        brand: "Sony",
        matchStatus: "SIMILAR"
      })])
    });

    expect(result.candidates).toEqual([]);
  });

  it("places only products hosted on verified official domains in the official group", async () => {
    const offDomain = shopifyProduct("off-domain", 3000, "NEW", {
      merchant: "SKIMS",
      sourceHost: "skims.com",
      merchantTrust: {
        level: "OFFICIAL",
        verification: "INDEPENDENT",
        evidence: ["official merchant domain"]
      },
      merchantUrl: "https://marketplace.example/products/off-domain"
    });

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "dress",
      limit: 3
    }), { awin: awin([]), shopify: shopify([offDomain]) });

    expect(result.candidates[0]).toMatchObject({
      presentationGroup: "TRUSTED_MATCH",
      shopifyProduct: { handle: "off-domain" }
    });
    expect(result.candidates.some((candidate) => candidate.presentationGroup === "OFFICIAL_STORE")).toBe(false);
  });

  it("does not promote a 3.8 rating or a product with only one review", async () => {
    const unknown = (handle: string, value: number, count: number) => shopifyProduct(handle, 1000, "NEW", {
      merchantTrust: {
        level: "UNKNOWN",
        verification: "UNVERIFIED",
        evidence: ["no independent merchant trust evidence"]
      },
      productRating: { value, count, scaleMax: 5 }
    });
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "cat toy",
      limit: 3
    }), {
      awin: awin([]),
      shopify: shopify([
        unknown("qualified", 3.81, 2),
        unknown("threshold", 3.8, 50),
        unknown("one-review", 5, 1)
      ])
    });

    expect(result.candidates.map((candidate) => candidate.recommendationTier)).toEqual([
      "HIGH_RATED_UNVERIFIED",
      "GENERAL_UNVERIFIED",
      "GENERAL_UNVERIFIED"
    ]);
  });

  it("queries Awin for every valid product category", () => {
    expect(shouldQueryAwin("角蛋白发膜")).toBe(true);
    expect(shouldQueryAwin("GardePro trail camera")).toBe(true);
    expect(shouldQueryAwin("野生动物相机")).toBe(true);
    expect(shouldQueryAwin("Watches Of USA 手表")).toBe(true);
    expect(shouldQueryAwin("SNFLEX macerating toilet")).toBe(true);
    expect(shouldQueryAwin("36 inch bathroom vanity")).toBe(true);
    expect(shouldQueryAwin("淋浴门")).toBe(true);
    expect(shouldQueryAwin("Sony headphones")).toBe(true);
    expect(shouldQueryAwin("digital camera")).toBe(true);
    expect(shouldQueryAwin(" ")).toBe(false);
  });

  it("includes eBay by price without treating EPN as seller trust", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "headphones",
      limit: 3,
      selectionMode: "LOWEST_PRICE"
    }), {
      awin: awin([awinProduct("1", 3000, {
        title: "Awin headphones 1",
        category: "Headphones"
      })]),
      ebay: ebay([ebayProduct("1", 900)]),
      shopify: shopify([shopifyProduct("101", 1200)])
    });

    expect(result.candidates.map((candidate) => candidate.source)).toEqual([
      "SHOPIFY_GLOBAL_CATALOG",
      "AWIN_PRODUCT_FEED",
      "EBAY_BROWSE"
    ]);
    expect(result.candidates[2]).toMatchObject({
      affiliateState: "APPROVED",
      recommendationTier: "GENERAL_UNVERIFIED",
      presentationGroup: "BEST_VALUE",
      ebayProduct: { sellerName: "seller-1" }
    });
    expect(result.sourceStatus.ebay).toBe("COMPLETE");
  });

  it("fails closed for Chrome when configured eBay is unavailable", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "headphones", limit: 3 }), {
      awin: awin([]),
      ebay: { search: vi.fn(async () => { throw new Error("offline"); }) },
      shopify: shopify([])
    });

    expect(result.sourceErrors).toMatchObject({ ebay: "DATA_SOURCE_UNAVAILABLE" });
    expect(result.chromeFallbackEligible).toBe(false);
  });

  it.each([0, 1])("preserves %i first-pass eBay products but degrades coverage after expansion failure", async (count) => {
    const first = await ebay(count === 0 ? [] : [ebayProduct("71", 2_100)]).search({ query: "headphones", limit: 1 });
    const search = vi.fn<EbayBrowsePort["search"]>().mockResolvedValueOnce(first)
      .mockRejectedValue(new Error("second-pass network unavailable"));
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "headphones", limit: 3 }), {
      awin: awin([]), ebay: { search }, shopify: shopify([])
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(result.ebayResult).toBe(first);
    expect(result.candidates).toHaveLength(count);
    if (count > 0) expect(result.candidates[0]).toMatchObject({ source: "EBAY_BROWSE", ebayProduct: { itemId: "v1|71|0" } });
    expect(result.sourceStatus.ebay).toBe("UNAVAILABLE");
    expect(result.sourceErrors).toMatchObject({ ebay: "DATA_SOURCE_UNAVAILABLE" });
    expect(result.chromeFallbackEligible).toBe(false);
    expect(result.searchRun?.diagnostics().budgetExhausted).toBe(false);
  });

  it("skips eBay without degrading coverage when the gateway is not configured", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "headphones", limit: 3 }), {
      awin: awin([]),
      ebay: { search: vi.fn(async () => { throw new Error("SOURCE_NOT_CONFIGURED"); }) },
      shopify: shopify([])
    });

    expect(result.sourceStatus.ebay).toBe("SKIPPED");
    expect(result.sourceErrors).toBeUndefined();
    expect(result.chromeFallbackEligible).toBe(true);
  });

  it("routes named SKIMS and Alo requests to exact-product safety", () => {
    expect(resolveSearchIntent(SearchProductsInputSchema.parse({
      query: "SKIMS Soft Lounge Mini Dress Onyx size 0"
    }))).toBe("EXACT_PRODUCT");
    expect(resolveSearchIntent(SearchProductsInputSchema.parse({
      query: "Alo Suit Up Trouser Navy size S"
    }))).toBe("EXACT_PRODUCT");
    expect(resolveSearchIntent(SearchProductsInputSchema.parse({
      query: "women leather ballet flats"
    }))).toBe("CATEGORY_DISCOVERY");
    expect(resolveSearchIntent(SearchProductsInputSchema.parse({
      query: "Nextrition Pet dog food",
      brand: "Nextrition Pet",
      brandMode: "REQUIRED"
    }))).toBe("CATEGORY_DISCOVERY");
    expect(resolveSearchIntent(SearchProductsInputSchema.parse({
      query: "Nextrition Pet All-Natural Chicken Recipe dog food",
      brand: "Nextrition Pet",
      brandMode: "REQUIRED"
    }))).toBe("EXACT_PRODUCT");
  });

  it("keeps whole wigs while excluding wig accessories and wiggle substring matches", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "wig",
      productType: "wig",
      comparisonMode: "DISCOVERY",
      selectionMode: "MERCHANT_DIVERSE",
      limit: 8
    }), {
      awin: awin([
        awinProduct("tape", 1290, {
          merchant: "Ishow Hair",
          title: "Invisible Hair Wig Tape Double Adhesive Extension Tape",
          category: "Hair Accessories > Wigs"
        }),
        awinProduct("wig", 3641, {
          merchant: "Ishow Hair",
          title: "Ishow Short Human Hair Wigs Finger Wave Virgin Remy Hair Wig",
          category: "Wigs"
        }),
        awinProduct("adult", 3999, {
          merchant: "Shenzhen Zhuole E-commerce Co., Ltd",
          title: "Realistic Dildo Sex Machine with Wiggle-Vibration",
          category: "Uncategorized"
        })
      ]),
      shopify: shopify([])
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      source: "AWIN_PRODUCT_FEED",
      awinProduct: { merchantProductId: "wig" }
    });
    expect(result.identityProductsExcluded).toBeGreaterThanOrEqual(2);
  });

  it("keeps a verified Awin brand when the product title omits it", async () => {
    const requested = awinProduct("42519172055262", 5498, {
      merchantId: "113600",
      merchant: "Nextrition Pet (US)",
      title: "All-Natural Chicken Recipe - 4.5 lb",
      category: "Animals & Pet Supplies",
      merchantUrl: "https://www.nextritionpet.com/products/chicken?variant=42519172055262"
    });
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "Nextrition Pet All-Natural Chicken Recipe dog food",
      productType: "dog food",
      brand: "Nextrition Pet",
      brandMode: "REQUIRED",
      comparisonMode: "SAME_PRODUCT",
      allowAlternatives: false,
      limit: 8
    }), {
      awin: awin([requested, awinProduct("unrelated", 1200)]),
      shopify: shopify([])
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      source: "AWIN_PRODUCT_FEED",
      recommendationTier: "TRUSTED_OR_AFFILIATE",
      resultGroup: "REQUESTED_PRODUCT",
      awinProduct: {
        merchantId: "113600",
        merchantProductId: "42519172055262"
      }
    });
    expect(result.brandProductsExcluded).toBeGreaterThanOrEqual(1);
    expect(result.identityProductsExcluded).toBe(0);
  });

  it("excludes Nextrition samples and expands the second pass to full-size products", async () => {
    const products = [
      awinProduct("sample", 199, {
        merchantId: "113600",
        merchant: "Nextrition Pet (US)",
        title: "Chicken Recipe Dog Food Sample",
        category: "Animals & Pet Supplies"
      }),
      awinProduct("trial", 999, {
        merchantId: "113600",
        merchant: "Nextrition Pet (US)",
        title: "Chicken Recipe Trial Pack (4-pack)",
        category: "Animals & Pet Supplies"
      }),
      awinProduct("bag-4-5", 5498, {
        merchantId: "113600",
        merchant: "Nextrition Pet (US)",
        title: "All-Natural Chicken Recipe - 4.5 lb",
        category: "Animals & Pet Supplies"
      }),
      awinProduct("bag-9", 10_558, {
        merchantId: "113600",
        merchant: "Nextrition Pet (US)",
        title: "All-Natural Chicken Recipe - 9 lb",
        category: "Animals & Pet Supplies"
      })
    ];
    const awinSearch = vi.fn<AwinProductPort["search"]>(async () => ({
      source: "AWIN_PRODUCT_FEED",
      coverage: "COMPLETE",
      snapshotAt: now,
      diagnostics: {
        feedRows: products.length,
        validRows: products.length,
        rejectedRows: 0,
        queryMatches: products.length,
        priceProductsExcluded: 0
      },
      products
    }));

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "Nextrition Pet dog food",
      productType: "dog food",
      brand: "Nextrition Pet",
      brandMode: "REQUIRED",
      comparisonMode: "DISCOVERY",
      contextMode: "CONTINUE_PREVIOUS_PRODUCT",
      requiredFeatures: ["full-size large bag, not a sample or trial pack"],
      allowAlternatives: false,
      limit: 8
    }), {
      awin: { search: awinSearch },
      shopify: shopify([])
    });

    expect(awinSearch).toHaveBeenCalledTimes(2);
    expect(awinSearch.mock.calls[0]?.[0].query).toBe("Nextrition Pet dog food");
    expect(awinSearch.mock.calls[1]?.[0]).toMatchObject({
      query: "Nextrition Pet dog food",
      limit: 24
    });
    expect(result.candidates.map((candidate) => candidate.awinProduct?.title)).toEqual([
      "All-Natural Chicken Recipe - 4.5 lb",
      "All-Natural Chicken Recipe - 9 lb"
    ]);
    expect(result.featureProductsExcluded).toBe(2);
    expect(result.candidates.every((candidate) => candidate.requiredFeatureLimitations.length === 0)).toBe(true);
  });

  it("returns only the requested SKIMS product and never pads with unrelated dresses", async () => {
    const requested = shopifyProduct("skims-soft-lounge", 8000, "NEW", {
      title: "Soft Lounge Mini Dress",
      brand: "SKIMS",
      productType: "Dresses",
      variantDimensions: { Color: "Onyx", Size: "0" }
    });
    const unrelated = shopifyProduct("black-lace", 3900, "NEW", {
      title: "Black Lace Sweater Spaghetti Strap Bodycon Mini Dress",
      brand: "Solace",
      productType: "Dresses",
      variantDimensions: { Color: "Black", Size: "S" }
    });
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "SKIMS Soft Lounge Mini Dress Onyx size 0",
      limit: 3
    }), {
      awin: awin([awinProduct("lace", 2900, {
        title: "Black Lace Spaghetti Strap Mini Dress",
        category: "Dresses"
      })]),
      ebay: ebay([ebayProduct("9", 3500, {
        title: "Black Lace Bodycon Mini Dress",
        category: "Dresses"
      })]),
      shopify: shopify([requested, unrelated])
    });

    expect(result.searchIntent).toBe("EXACT_PRODUCT");
    expect(result.searchPasses).toBe(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      source: "SHOPIFY_GLOBAL_CATALOG",
      resultGroup: "REQUESTED_PRODUCT",
      shopifyProduct: { handle: "skims-soft-lounge" }
    });
    expect(result.identityProductsExcluded).toBeGreaterThanOrEqual(3);
  });

  it("returns zero instead of substituting a different product for an Alo request", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "Alo Suit Up Trouser Navy size S",
      limit: 3
    }), {
      awin: awin([]),
      ebay: ebay([]),
      shopify: shopify([shopifyProduct("alo-dress", 9900, "NEW", {
        title: "Alo Suit Up Mini Dress",
        brand: "Alo",
        productType: "Dresses",
        variantDimensions: { Color: "Navy", Size: "S" }
      })])
    });

    expect(result.candidates).toEqual([]);
    expect(result.chromeFallbackEligible).toBe(true);
    expect(result.identityProductsExcluded).toBe(1);
  });

  it("keeps alternatives separate and only when explicitly enabled", async () => {
    const requested = shopifyProduct("alo-suit-up", 14_800, "NEW", {
      title: "Suit Up Trouser Regular",
      brand: "Alo",
      productType: "Pants",
      variantDimensions: { Color: "Navy", Size: "S" }
    });
    const alternative = shopifyProduct("alo-airbrush", 11_800, "NEW", {
      title: "Airbrush High-Waist Trouser",
      brand: "Alo",
      productType: "Pants",
      variantDimensions: { Color: "Navy", Size: "S" }
    });
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "Alo Suit Up Trouser Navy size S",
      limit: 3,
      allowAlternatives: true
    }), { awin: awin([]), shopify: shopify([alternative, requested]) });

    expect(result.candidates.map((candidate) => candidate.resultGroup)).toEqual([
      "REQUESTED_PRODUCT",
      "ALTERNATIVE"
    ]);
    expect(result.candidates[0]?.shopifyProduct?.handle).toBe("alo-suit-up");
  });

  it("keeps possible-same and highly-similar visual results without padding same-style cards", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "navy wool wide leg trousers",
      limit: 3,
      visualInput: {
        productType: "trousers",
        brand: "Alo",
        modelOrStyleNumber: "W51432R",
        colors: ["navy"],
        materials: ["wool"],
        patterns: ["solid"],
        silhouette: "wide leg"
      }
    }), {
      awin: awin([]),
      shopify: shopify([
        shopifyProduct("same", 14_800, "NEW", {
          title: "Alo Suit Up Trouser Navy Wool",
          brand: "Alo",
          sku: "W51432R",
          productType: "Pants",
          description: "Solid wide leg tailoring"
        }),
        shopifyProduct("similar", 11_800, "NEW", {
          title: "Navy Wool Wide Leg Trousers",
          productType: "Pants",
          description: "Solid tailored pants"
        }),
        shopifyProduct("style", 8_800, "NEW", {
          title: "Navy Relaxed Trousers",
          productType: "Pants"
        }),
        shopifyProduct("irrelevant", 5_800, "NEW", {
          title: "Navy Wool Mini Dress",
          productType: "Dresses"
        })
      ])
    });

    expect(result.searchIntent).toBe("VISUAL_DISCOVERY");
    expect(result.candidates.map((candidate) => candidate.visualMatchGroup)).toEqual([
      "POSSIBLE_SAME_ITEM",
      "HIGHLY_SIMILAR"
    ]);
    expect(result.candidates.every((candidate) => candidate.identityStatus !== "EXACT")).toBe(true);
    expect(result.visualProductsExcluded).toBe(1);
  });

  it("enforces the explicit DÔEN brand while reusing an identical second-pass source query", async () => {
    const candidate = shopifyProduct("doen-black-lace", 27_800, "UNKNOWN", {
      merchant: "DÔEN",
      sourceHost: "www.shopdoen.com",
      merchantTrust: {
        level: "OFFICIAL",
        verification: "INDEPENDENT",
        evidence: ["official merchant domain"]
      },
      title: "DÔEN Black Lace Tiered Mini Dress",
      productType: "Dresses",
      description: "Black mini dress with tiered lace panels"
    });
    const otherBrand = shopifyProduct("other-black-lace", 13_900, "UNKNOWN", {
      title: "Black Lace Tiered Mini Dress",
      brand: "Other Brand",
      productType: "Dresses",
      description: "Black mini dress with tiered lace panels"
    });
    const shopifySearch = vi.fn<ShopifyPort["search"]>(async () => shopifyResult([candidate, otherBrand]));

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "DÔEN black lace tiered mini dress",
      limit: 3,
      brand: "DÔEN",
      brandMode: "REQUIRED",
      comparisonMode: "SAME_PRODUCT",
      visualInput: {
        productType: "女士迷你连衣裙",
        colors: ["黑色"],
        patterns: ["蕾丝"],
        silhouette: "收腰A字",
        length: "迷你",
        styleClues: ["船领", "分层裙摆"]
      }
    }), { awin: awin([]), shopify: { search: shopifySearch } });

    expect(result.candidates[0]).toMatchObject({
      source: "SHOPIFY_GLOBAL_CATALOG",
      visualMatchGroup: "POSSIBLE_SAME_ITEM",
      shopifyProduct: { sourceHost: "www.shopdoen.com" }
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.brandProductsExcluded).toBe(1);
    expect(shopifySearch).toHaveBeenCalledTimes(1);
    expect(shopifySearch.mock.calls[0]?.[0].comparisonMode).toBe("SAME_PRODUCT");
    expect(shopifySearch.mock.calls[0]?.[0].query).toBe("DÔEN black lace tiered mini dress");
    expect(result.searchRun?.diagnostics().cacheHits).toBeGreaterThanOrEqual(1);
    expect(result.sourcePassDiagnostics).toEqual([
      expect.objectContaining({ pass: 1, query: "DÔEN black lace tiered mini dress", acceptedCandidates: expect.objectContaining({ shopify: 1 }) }),
      expect.objectContaining({ pass: 2, query: "DÔEN black lace tiered mini dress", acceptedCandidates: expect.objectContaining({ shopify: 1 }) })
    ]);
  });

  it("returns no cards when both passes only find other brands", async () => {
    const otherBrand = shopifyProduct("other-black-lace", 13_900, "UNKNOWN", {
      title: "Black Lace Tiered Mini Dress",
      brand: "Other Brand",
      productType: "Dresses"
    });
    const shopifySearch = vi.fn(async (_input: Parameters<ShopifyPort["search"]>[0]) => shopifyResult([otherBrand]));

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "DÔEN black lace mini dress",
      limit: 3,
      brand: "DÔEN",
      brandMode: "REQUIRED",
      productType: "dress",
      visualInput: { productType: "dress", colors: ["black"], patterns: ["lace"] }
    }), { awin: awin([]), shopify: { search: shopifySearch } });

    expect(result.candidates).toEqual([]);
    expect(result.searchPasses).toBe(2);
    expect(result.brandProductsExcluded).toBe(1);
    expect(result.chromeFallbackEligible).toBe(true);
    expect(shopifySearch).toHaveBeenCalledTimes(1);
    expect(result.searchRun?.diagnostics().cacheHits).toBeGreaterThan(0);
    expect(shopifySearch.mock.calls.every(([request]) => request.query?.startsWith("DÔEN ") === true)).toBe(true);
    expect(shopifySearch.mock.calls[0]?.[0].query).toBe("DÔEN dress black lace");
  });

  it("searches one independently verified official Shopify store when the catalog lacks a strong visual match", async () => {
    const officialSeed = shopifyProduct("nevita", 24_800, "UNKNOWN", {
      merchant: "DÔEN",
      sourceHost: "www.shopdoen.com",
      merchantTrust: {
        level: "OFFICIAL",
        verification: "INDEPENDENT",
        evidence: ["official merchant domain"]
      },
      title: "Nevita Floral Maxi Dress",
      brand: "DÔEN",
      productType: "Dresses",
      description: "Floral maxi dress"
    });
    const cornella = shopifyProduct("472002", 59_800, "UNKNOWN", {
      merchantId: officialSeed.merchantId,
      merchant: "DÔEN",
      sourceHost: "www.shopdoen.com",
      merchantTrust: officialSeed.merchantTrust,
      title: "Cornella Dress -- Black",
      brand: "DÔEN",
      productType: "Dresses",
      description: "Black lace mini dress with a tiered skirt",
      variantDimensions: { Size: "S" },
      merchantUrl: "https://www.shopdoen.com/products/cornella-dress-black?variant=472002"
    });
    const shopifySearch = vi.fn(async () => shopifyResult([officialSeed]));
    const officialSearch = vi.fn<OfficialShopifySearchPort["search"]>(async () => [cornella]);

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "DÔEN black lace tiered mini dress",
      limit: 3,
      brand: "DÔEN",
      brandMode: "REQUIRED",
      comparisonMode: "SAME_PRODUCT",
      visualInput: {
        productType: "女士迷你连衣裙",
        colors: ["黑色"],
        patterns: ["蕾丝"],
        length: "迷你",
        styleClues: ["分层裙摆"]
      }
    }), {
      awin: awin([]),
      shopify: { search: shopifySearch },
      officialShopify: { search: officialSearch }
    });

    expect(officialSearch).toHaveBeenCalledOnce();
    expect(officialSearch).toHaveBeenCalledWith(expect.objectContaining({
      seed: expect.objectContaining({ sourceHost: officialSeed.sourceHost, brand: "DÔEN" }),
      query: "black lace tiered mini dress",
      limit: 12
    }));
    expect(result.candidates[0]).toMatchObject({
      source: "SHOPIFY_GLOBAL_CATALOG",
      visualMatchGroup: "POSSIBLE_SAME_ITEM",
      shopifyProduct: { title: "Cornella Dress -- Black", handle: "472002" }
    });
    expect(result.officialStoreFallback).toEqual({
      status: "COMPLETE",
      productsReturned: 1,
      sourceHost: "www.shopdoen.com",
      diagnostic: {
        outcome: "ACCEPTED",
        attempts: [{
          stage: "FULL",
          query: "black lace tiered mini dress",
          productsReturned: 1,
          acceptedCandidates: 1
        }]
      }
    });
    expect(result.shopifyResult?.products).toEqual(expect.arrayContaining([
      expect.objectContaining({ handle: "472002" })
    ]));
    expect(result.chromeFallbackEligible).toBe(false);
  });

  it("continues official-store search past visually contradictory products", async () => {
    const trust = {
      level: "OFFICIAL" as const,
      verification: "INDEPENDENT" as const,
      evidence: ["official merchant domain"]
    };
    const seed = shopifyProduct("long-sleeve", 8_800, "UNKNOWN", {
      merchant: "SKIMS",
      sourceHost: "skims.com",
      merchantTrust: trust,
      title: "SKIMS Long Sleeve Brown Dress",
      brand: "SKIMS",
      productType: "Dresses",
      description: "Brown solid long-sleeve dress with a crew neck",
      merchantUrl: "https://skims.com/products/long-sleeve"
    });
    const match = shopifyProduct("sleeveless", 7_800, "UNKNOWN", {
      merchant: "SKIMS",
      sourceHost: "skims.com",
      merchantTrust: trust,
      title: "SKIMS Sleeveless Brown Slip Dress",
      brand: "SKIMS",
      productType: "Dresses",
      description: "Brown solid sleeveless dress with a square neck",
      merchantUrl: "https://skims.com/products/sleeveless"
    });
    const officialSearch = vi.fn<OfficialShopifySearchPort["search"]>()
      .mockResolvedValueOnce([seed])
      .mockResolvedValueOnce([match]);

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "SKIMS brown sleeveless dress",
      brand: "SKIMS",
      brandMode: "REQUIRED",
      visualInput: {
        productType: "women's dress",
        colors: ["brown"],
        patterns: ["solid"],
        hardClues: ["sleeveless", "square neck"],
        negativeClues: ["long sleeve"]
      }
    }), {
      awin: awin([]),
      shopify: { search: vi.fn(async () => shopifyResult([seed])) },
      officialShopify: { search: officialSearch }
    });

    expect(officialSearch).toHaveBeenCalledTimes(2);
    expect(result.candidates.map((candidate) => candidate.shopifyProduct?.handle)).toEqual(["sleeveless"]);
    expect(result.candidates[0]).toMatchObject({
      presentationGroup: "OFFICIAL_STORE",
      visualMatchGroup: "POSSIBLE_SAME_ITEM"
    });
    expect(result.officialStoreFallback.diagnostic).toEqual(expect.objectContaining({
      outcome: "ACCEPTED",
      attempts: [
        expect.objectContaining({ acceptedCandidates: 0 }),
        expect.objectContaining({ acceptedCandidates: 1 })
      ]
    }));
  });

  it("reranks visual candidates from structured Codex evidence without creating exact identity", async () => {
    const first = shopifyProduct("first", 4_000, "NEW", {
      title: "Blue floral sleeveless square neck dress",
      productType: "Dresses",
      description: "Blue floral sleeveless square neck mini dress",
      imageUrl: "https://cdn.example/first.jpg"
    });
    const second = shopifyProduct("second", 4_500, "NEW", {
      title: "Blue floral sleeveless square neck dress two",
      productType: "Dresses",
      description: "Blue floral sleeveless square neck mini dress",
      imageUrl: "https://cdn.example/second.jpg"
    });
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "blue floral mini dress",
      visualInput: {
        imageUrl: "https://uploads.example/reference.jpg",
        productType: "women's dress",
        colors: ["blue"],
        patterns: ["floral"],
        length: "mini",
        neckline: "square neck",
        sleeveType: "sleeveless",
        hardClues: ["square neck", "sleeveless"]
      }
    }), { awin: awin([]), shopify: shopify([first, second]) });
    const byHandle = new Map(result.candidates.map((candidate) => [candidate.shopifyProduct?.handle, candidate]));
    const finalized = finalizeCodexVisualCandidates([
      {
        candidate: byHandle.get("second")!,
        verdict: {
          classification: "POSSIBLE_SAME_ITEM",
          matches: [
            { attribute: "NECKLINE", referenceEvidence: "square", candidateEvidence: "square" },
            { attribute: "PATTERN", referenceEvidence: "floral", candidateEvidence: "floral" },
            { attribute: "SLEEVE", referenceEvidence: "sleeveless", candidateEvidence: "sleeveless" }
          ],
          conflicts: []
        }
      },
      {
        candidate: byHandle.get("first")!,
        verdict: {
          classification: "HIGHLY_SIMILAR",
          matches: [
            { attribute: "NECKLINE", referenceEvidence: "square", candidateEvidence: "square" },
            { attribute: "COLOR", referenceEvidence: "blue", candidateEvidence: "blue" }
          ],
          conflicts: []
        }
      }
    ], false);

    expect(finalized.map((candidate) => candidate.shopifyProduct?.handle)).toEqual(["second", "first"]);
    expect(finalized[0]).toMatchObject({
      visualMatchGroup: "POSSIBLE_SAME_ITEM",
      identityStatus: "DISCOVERY_MATCH"
    });
  });

  it("excludes a candidate when image verification reports a visual conflict", async () => {
    const conflicting = shopifyProduct("conflict", 4_000, "NEW", {
      title: "Blue floral sleeveless square neck dress",
      productType: "Dresses",
      description: "Blue floral sleeveless square neck mini dress",
      imageUrl: "https://cdn.example/conflict.jpg"
    });
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "blue floral mini dress",
      visualInput: {
        imageUrl: "https://uploads.example/reference.jpg",
        productType: "women's dress",
        colors: ["blue"],
        patterns: ["floral"],
        hardClues: ["square neck", "sleeveless"]
      }
    }), { awin: awin([]), shopify: shopify([conflicting]) });
    const finalized = finalizeCodexVisualCandidates([{
      candidate: result.candidates[0]!,
      verdict: {
        classification: "CONFLICT",
        matches: [],
        conflicts: [{
          attribute: "SLEEVE",
          referenceEvidence: "sleeveless",
          candidateEvidence: "long sleeve"
        }]
      }
    }], false);

    expect(finalized).toEqual([]);
  });

  it("does not exclude a structural match using a conflict from an occluded strap area", async () => {
    const candidate = shopifyProduct("occluded-strap-match", 36_800, "UNKNOWN", {
      title: "DÔEN Floral Smocked Dress",
      brand: "DÔEN",
      productType: "Dresses",
      description: "Red floral print, square neckline, smocked waist and gathered full skirt",
      imageUrl: "https://cdn.example/occluded-strap-match.jpg"
    });
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "DÔEN floral smocked dress",
      brand: "DÔEN",
      brandMode: "REQUIRED",
      productType: "dress",
      visualInput: {
        brand: "DÔEN",
        productType: "dress",
        patterns: ["red floral"],
        sleeveType: "narrow straps",
        waist: "smocked waist",
        occlusions: ["hair and phone partially obscure the upper straps"]
      }
    }), { awin: awin([]), shopify: shopify([candidate]) });

    const finalized = finalizeCodexVisualCandidates([{
      candidate: result.candidates[0]!,
      verdict: {
        classification: "CONFLICT",
        matches: [
          { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
          { attribute: "NECKLINE", referenceEvidence: "square", candidateEvidence: "square" },
          { attribute: "WAIST", referenceEvidence: "smocked", candidateEvidence: "smocked" },
          { attribute: "SILHOUETTE", referenceEvidence: "gathered", candidateEvidence: "gathered" }
        ],
        conflicts: [{
          attribute: "SLEEVE",
          referenceEvidence: "narrow straps partly obscured",
          candidateEvidence: "cap sleeve"
        }]
      }
    }], false, 3, {
      brand: "DÔEN",
      productType: "dress",
      colors: [],
      materials: [],
      patterns: ["red floral"],
      styleClues: [],
      sleeveType: "narrow straps",
      waist: "smocked waist",
      occlusions: ["hair and phone partially obscure the upper straps"]
    });

    expect(finalized[0]).toMatchObject({
      visualMatchGroup: "HIGHLY_SIMILAR",
      identityStatus: "DISCOVERY_MATCH"
    });
    expect(finalized[0]?.visualMatchEvidence?.join(" ")).not.toContain("cap sleeve");
  });

  it("keeps a structurally strong match as highly similar when only colorway differs", async () => {
    const candidate = shopifyProduct("quinn-black", 27_800, "UNKNOWN", {
      title: "Quinn Dress — Black",
      productType: "Dresses",
      description: "Maxi dress with square neckline, cap sleeves, fitted bodice and center keyhole",
      imageUrl: "https://cdn.example/quinn-black.jpg"
    });
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "floral maxi dress",
      visualInput: {
        imageUrl: "https://uploads.example/reference.jpg",
        productType: "maxi dress",
        colors: ["ivory"],
        patterns: ["floral"],
        length: "maxi",
        neckline: "square neck",
        sleeveType: "cap sleeve"
      }
    }), { awin: awin([]), shopify: shopify([candidate]) });
    const finalized = finalizeCodexVisualCandidates([{
      candidate: result.candidates[0]!,
      verdict: {
        classification: "CONFLICT",
        matches: [
          { attribute: "PRODUCT_TYPE", referenceEvidence: "maxi dress", candidateEvidence: "dress" },
          { attribute: "LENGTH", referenceEvidence: "maxi", candidateEvidence: "maxi" },
          { attribute: "NECKLINE", referenceEvidence: "square", candidateEvidence: "square" },
          { attribute: "SLEEVE", referenceEvidence: "cap", candidateEvidence: "cap" },
          { attribute: "DISTINCTIVE_DETAIL", referenceEvidence: "center keyhole", candidateEvidence: "center keyhole" }
        ],
        conflicts: [
          { attribute: "COLOR", referenceEvidence: "ivory", candidateEvidence: "black" },
          { attribute: "PATTERN", referenceEvidence: "floral", candidateEvidence: "solid" }
        ]
      }
    }], false);

    expect(finalized[0]).toMatchObject({
      visualMatchGroup: "HIGHLY_SIMILAR",
      identityStatus: "DISCOVERY_MATCH",
      resultGroup: "DISCOVERY"
    });
    expect(finalized[0]?.visualMatchEvidence).toContain(
      "Codex visual difference COLOR: ivory | black"
    );
  });

  it("requires two unique visual attributes for a high-similarity result", async () => {
    const product = shopifyProduct("fallback", 4_000, "NEW", {
      title: "Blue floral sleeveless square neck dress",
      productType: "Dresses",
      description: "Blue floral sleeveless square neck mini dress",
      imageUrl: "https://cdn.example/fallback.jpg"
    });
    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "blue floral mini dress",
      visualInput: {
        imageUrl: "https://uploads.example/reference.jpg",
        productType: "women's dress",
        colors: ["blue"],
        patterns: ["floral"],
        hardClues: ["square neck", "sleeveless"]
      }
    }), { awin: awin([]), shopify: shopify([product]) });
    const reviewed = [{
      candidate: result.candidates[0]!,
      verdict: {
        classification: "HIGHLY_SIMILAR" as const,
        matches: [{ attribute: "COLOR" as const, referenceEvidence: "blue", candidateEvidence: "blue" }],
        conflicts: []
      }
    }];

    expect(finalizeCodexVisualCandidates(reviewed, false)).toEqual([]);
    expect(finalizeCodexVisualCandidates(reviewed, true)).toEqual([]);
  });

  it("progressively broadens an official storefront query until a usable product is found", async () => {
    const officialSeed = shopifyProduct("nevita", 24_800, "UNKNOWN", {
      merchant: "DÔEN",
      sourceHost: "www.shopdoen.com",
      merchantTrust: {
        level: "OFFICIAL",
        verification: "INDEPENDENT",
        evidence: ["official merchant domain"]
      },
      title: "Nevita Floral Maxi Dress",
      brand: "DÔEN",
      productType: "Dresses",
      description: "Floral maxi dress"
    });
    const cornella = shopifyProduct("472002", 59_800, "UNKNOWN", {
      merchantId: officialSeed.merchantId,
      merchant: "DÔEN",
      sourceHost: "www.shopdoen.com",
      merchantTrust: officialSeed.merchantTrust,
      title: "Cornella Dress -- Black",
      brand: "DÔEN",
      productType: "Dresses",
      description: "Black lace mini dress with a tiered skirt",
      merchantUrl: "https://www.shopdoen.com/products/cornella-dress-black?variant=472002"
    });
    const officialSearch = vi.fn<OfficialShopifySearchPort["search"]>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cornella]);

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "DOEN black lace tiered mini dress",
      brand: "DOEN",
      brandMode: "REQUIRED",
      comparisonMode: "SAME_PRODUCT",
      visualInput: {
        productType: "女士迷你连衣裙",
        colors: ["黑色"],
        patterns: ["蕾丝"],
        length: "迷你",
        styleClues: ["分层裙摆"]
      }
    }), {
      awin: awin([]),
      shopify: { search: vi.fn(async () => shopifyResult([officialSeed])) },
      officialShopify: { search: officialSearch }
    });

    expect(officialSearch.mock.calls.map(([input]) => input.query)).toEqual([
      "black lace tiered mini dress",
      "dress black mini lace tiered",
      "dress black mini"
    ]);
    expect(result.candidates[0]?.source).toBe("SHOPIFY_GLOBAL_CATALOG");
    expect(result.officialStoreFallback.diagnostic).toEqual({
      outcome: "ACCEPTED",
      attempts: [
        expect.objectContaining({ stage: "FULL", productsReturned: 0 }),
        expect.objectContaining({ stage: "CORE", productsReturned: 0 }),
        expect.objectContaining({ stage: "CATEGORY", productsReturned: 1, acceptedCandidates: 1 })
      ]
    });
  });

  it("keeps an explicitly named product exact even when visual evidence is present", async () => {
    const onyx = shopifyProduct("onyx-other", 10_300, "UNKNOWN", {
      merchant: "SKIMS",
      sourceHost: "skims.com",
      merchantTrust: {
        level: "OFFICIAL",
        verification: "INDEPENDENT",
        evidence: ["official merchant domain"]
      },
      title: "SKIMS Body Mesh Plunge Midi Dress | Onyx",
      brand: "SKIMS",
      productType: "Dresses",
      description: "A black plunge midi dress"
    });
    const heatherGrey = shopifyProduct("34535377404036", 3_400, "UNKNOWN", {
      merchant: "SKIMS",
      sourceHost: "skims.com",
      merchantTrust: onyx.merchantTrust,
      title: "SOFT LOUNGE LONG SLIP DRESS | HEATHER GREY",
      brand: "SKIMS",
      productType: "Dresses",
      description: "A soft body-hugging long slip dress",
      variantDimensions: { Size: "XL" },
      merchantUrl: "https://skims.com/products/soft-lounge-long-slip-dress-heather-grey?variant=34535377404036"
    });
    const officialSearch = vi.fn<OfficialShopifySearchPort["search"]>(async () => [heatherGrey]);
    const shopifySearch = vi.fn<ShopifyPort["search"]>(async () => shopifyResult([onyx]));

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "SKIMS Soft Lounge Slip Dress gray",
      brand: "SKIMS",
      brandMode: "REQUIRED",
      productType: "slip maxi dress",
      requiredFeatures: ["gray"],
      featureMode: "REQUIRED",
      comparisonMode: "SAME_PRODUCT",
      allowAlternatives: false,
      visualInput: {
        brand: "SKIMS",
        colors: ["heather gray"],
        productType: "slip dress",
        length: "maxi / floor length",
        patterns: ["solid"],
        styleClues: ["Soft Lounge Slip Dress", "square neckline"]
      }
    }), {
      awin: awin([]),
      shopify: { search: shopifySearch },
      officialShopify: { search: officialSearch }
    });

    expect(result.searchIntent).toBe("EXACT_PRODUCT");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      source: "SHOPIFY_GLOBAL_CATALOG",
      resultGroup: "REQUESTED_PRODUCT",
      shopifyProduct: {
        title: "SOFT LOUNGE LONG SLIP DRESS | HEATHER GREY",
        handle: "34535377404036"
      }
    });
    expect(result.candidates.some((candidate) =>
      candidate.source === "SHOPIFY_GLOBAL_CATALOG" && candidate.shopifyProduct.handle === "onyx-other"
    )).toBe(false);
    expect(shopifySearch.mock.calls[0]?.[0].query).toBe("SKIMS Soft Lounge Slip Dress gray");
    expect(officialSearch.mock.calls[0]?.[0].query).toBe("Soft Lounge Slip Dress gray");
  });

  it("uses verified official storefront registry when Catalog returns zero products", async () => {
    const heatherGrey = shopifyProduct("34535377404036", 3_400, "UNKNOWN", {
      merchantId: "official-skims.com",
      merchant: "SKIMS",
      sourceHost: "skims.com",
      merchantTrust: {
        level: "OFFICIAL",
        verification: "INDEPENDENT",
        evidence: ["official merchant domain"]
      },
      title: "SOFT LOUNGE LONG SLIP DRESS | HEATHER GREY",
      brand: "SKIMS",
      productType: "Dresses",
      description: "A soft body-hugging long slip dress",
      variantDimensions: { Size: "XL" },
      merchantUrl: "https://skims.com/products/soft-lounge-long-slip-dress-heather-grey?variant=34535377404036"
    });
    const officialSearch = vi.fn<OfficialShopifySearchPort["search"]>(async () => [heatherGrey]);
    const shopifySearch = vi.fn<ShopifyPort["search"]>(async () => shopifyResult([]));

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "SKIMS Soft Lounge Long Slip Dress",
      brand: "SKIMS",
      brandMode: "REQUIRED",
      productType: "long slip dress",
      requiredFeatures: ["Soft Lounge", "Long Slip Dress"],
      featureMode: "REQUIRED",
      comparisonMode: "SAME_PRODUCT",
      allowAlternatives: false,
      visualInput: {
        brand: "SKIMS",
        colors: ["heather gray"],
        productType: "long slip dress",
        styleClues: ["square neckline", "thin shoulder straps"]
      }
    }), {
      awin: awin([]),
      shopify: { search: shopifySearch },
      officialShopify: { search: officialSearch }
    });

    expect(shopifySearch.mock.calls[0]?.[0].query).toBe("SKIMS Soft Lounge Long Slip Dress");
    expect(officialSearch.mock.calls[0]?.[0]).toMatchObject({
      seed: {
        merchantId: "official-skims.com",
        merchant: "SKIMS",
        sourceHost: "skims.com",
        merchantUrl: "https://skims.com/"
      },
      query: "Soft Lounge Long Slip Dress"
    });
    expect(result.officialStoreFallback.diagnostic?.outcome).toBe("ACCEPTED");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      presentationGroup: "OFFICIAL_STORE",
      shopifyProduct: { handle: "34535377404036" }
    });
  });

  it("does not query a storefront that lacks independent official-domain evidence", async () => {
    const unverified = shopifyProduct("dress", 10_000, "UNKNOWN", {
      merchant: "Unknown Label Official Store",
      sourceHost: "doen-official.example",
      merchantTrust: { level: "UNKNOWN", verification: "UNVERIFIED", evidence: ["self-described"] },
      title: "Unknown Label Maxi Dress",
      brand: "Unknown Label",
      productType: "Dresses"
    });
    const officialSearch = vi.fn<OfficialShopifySearchPort["search"]>(async () => []);

    const result = await searchProducts(SearchProductsInputSchema.parse({
      query: "Unknown Label black lace mini dress",
      brand: "Unknown Label",
      brandMode: "REQUIRED",
      visualInput: { productType: "dress", colors: ["black"], patterns: ["lace"] }
    }), {
      awin: awin([]),
      shopify: { search: vi.fn(async () => shopifyResult([unverified])) },
      officialShopify: { search: officialSearch }
    });

    expect(officialSearch).not.toHaveBeenCalled();
    expect(result.officialStoreFallback).toEqual({ status: "NOT_USED", productsReturned: 0 });
  });
});

function awinProduct(id: string, amountCents: number, overrides: Record<string, unknown> = {}) {
  return {
    merchantId: "20282",
    merchant: "Amazonliss (US)",
    merchantProductId: id,
    title: `Keratin hair mask ${id}`,
    category: "Hair care",
    matchStatus: "DISCOVERY_MATCH" as const,
    matchEvidence: ["approved Awin feed"],
    condition: "UNKNOWN" as const,
    itemPrice: { amountCents, currency: "USD" as const },
    availability: "IN_STOCK" as const,
    merchantUrl: `https://www.nutreecosmetics.com/products/${id}`,
    affiliateUrl: `https://www.awin1.com/cread.php?awinmid=20282&awinaffid=3047955&ued=https%3A%2F%2Fwww.nutreecosmetics.com%2Fproducts%2F${id}`,
    checkedAt: now,
    ...overrides
  };
}

function shopifyProduct(
  handle: string,
  amountCents: number,
  condition: "NEW" | "UNKNOWN" = "UNKNOWN",
  overrides: Record<string, unknown> = {}
) {
  return {
    merchantId: `merchant-${handle}`,
    merchant: `Merchant ${handle}`,
    sourceHost: `merchant-${handle}.example`,
    merchantTrust: {
      level: "ESTABLISHED_RETAILER" as const,
      verification: "INDEPENDENT" as const,
      evidence: ["test"]
    },
    handle,
    title: `Keratin hair mask ${handle}`,
    gtins: [],
    variantDimensions: {},
    matchStatus: "DISCOVERY_MATCH" as const,
    matchEvidence: ["query terms"],
    condition,
    itemPrice: { amountCents, currency: "USD" as const },
    availability: "IN_STOCK" as const,
    merchantUrl: `https://merchant-${handle}.example/products/${handle}`,
    checkedAt: now,
    ...overrides
  };
}

function shopifyResult(products: ReturnType<typeof shopifyProduct>[]): ShopifySearchResult {
  return {
    source: "SHOPIFY_GLOBAL_CATALOG",
    coverage: "COMPLETE",
    merchantsQueried: products.length,
    merchantsSucceeded: products.length,
    comparison: {
      status: "DISCOVERY_ONLY",
      evidence: [],
      merchantCount: products.length,
      offerCount: products.length
    },
    diagnostics: {
      apiDurationMs: 1,
      cacheStatus: "MISS",
      chromeFallbackEligible: products.length === 0,
      queryAttempts: 1,
      fallbackQueryUsed: false,
      catalogProductsReturned: products.length,
      catalogVariantsReturned: products.length,
      catalogZeroResultAttempts: products.length === 0 ? 1 : 0,
      outOfStockProductsExcluded: 0,
      identityProductsExcluded: 0,
      irrelevantProductsExcluded: 0,
      conditionProductsExcluded: 0,
      priceProductsExcluded: 0,
      trustedMerchantProductsReturned: products.length,
      unverifiedMerchantProductsReturned: 0,
      unverifiedMerchantProductsExcluded: 0,
      riskyMerchantProductsExcluded: 0,
      merchantTrustRegistryVersion: "test",
      merchantsFailed: 0,
      coveragePercent: 100,
      failedMerchantIds: [],
      timedOutMerchantIds: [],
      registryVersion: "test",
      searchTimeoutMs: 100,
      selectionPolicy: "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE"
    },
    questions: [],
    products
  };
}

function ebayProduct(id: string, amountCents: number, overrides: Record<string, unknown> = {}) {
  return {
    environment: "PRODUCTION" as const,
    itemId: `v1|${id}|0`,
    productRef: `ebay-${id.padStart(32, "0")}`,
    title: `eBay headphones ${id}`,
    category: "Headphones",
    attributes: [],
    sellerName: `seller-${id}`,
    matchStatus: "DISCOVERY_MATCH" as const,
    matchEvidence: ["live eBay fixed-price listing returned by Browse API"],
    condition: "NEW" as const,
    itemPrice: { amountCents, currency: "USD" as const },
    availability: "UNKNOWN" as const,
    merchantUrl: `https://www.ebay.com/itm/${id}`,
    affiliateUrl: `https://www.ebay.com/itm/${id}?campid=5339000012`,
    checkedAt: now,
    ...overrides
  };
}

function verifiedCoupon(merchant: string) {
  return {
    dealId: `coupon:${merchant}`,
    merchant,
    kind: "PROMO_CODE" as const,
    title: "20% off",
    description: "Verified merchant promotion",
    code: "SAVE20",
    discountPercent: 20,
    eligibility: ["Online only"],
    channels: ["ONLINE" as const],
    sourceUrl: "https://www.awin1.com/promotion",
    checkedAt: "2026-08-24T12:00:00.000Z",
    validFrom: "2026-08-24T00:00:00.000Z",
    validTo: "2026-08-30T00:00:00.000Z",
    verificationStatus: "VERIFIED" as const
  };
}
