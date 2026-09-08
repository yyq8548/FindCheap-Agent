import { describe, expect, it, vi } from "vitest";
import { evaluateProductRequirements } from "../src/product-requirements.js";
import { SearchProductsInputSchema, searchProducts } from "../src/search-products.js";
import { functionalQueryFeatures } from "../src/functional-requirements.js";
import { createShopifySelectedProductInspector } from "../src/shopify-selected-product.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";
import type { ProductCardContent } from "../src/server.js";
import type { ShopifyProduct } from "../src/shopify-client.js";
import type { AwinProduct } from "../../../packages/awin-feed/src/index.js";

const trusted = product({ title: "Black human hair wig", variantDimensions: { Color: "Black" } });
const emptyAwin = () => ({ source: "AWIN_PRODUCT_FEED" as const, coverage: "COMPLETE" as const,
  snapshotAt: "2026-09-08T00:00:00.000Z", diagnostics: { queryMatches: 0, feedRows: 0, validRows: 0, rejectedRows: 0, priceProductsExcluded: 0 }, products: [] });
const requirements = (requiredFeatures: string[]) => ({ requiredFeatures, excludedFeatures: [], preferences: [] });
const awinProduct: AwinProduct = { merchantId: "50707", merchant: "Ishow", merchantProductId: "wig-a",
  title: "Black human hair wig", category: "wig", matchStatus: "DISCOVERY_MATCH", matchEvidence: [], condition: "UNKNOWN",
  itemPrice: { amountCents: 2000, currency: "USD" }, availability: "IN_STOCK", checkedAt: "2026-09-08T00:00:00.000Z",
  merchantUrl: "https://ishowbeauty.com/products/a", affiliateUrl: "https://www.awin1.com/pclick.php?p=1&a=3047955&m=50707" };

describe("merchant requirements use merchant evidence, not product prose", () => {
  it.each(["trusted merchant", "verified merchant", "可信商家", "已验证商家"])("accepts reviewed trust for %s", requirement => {
    const result = evaluateProductRequirements(trusted, requirements([requirement, "black color"]));
    expect(result.assessment.status).toBe("SATISFIED");
    expect(result.assessment.entries[0]).toMatchObject({ requirement, status: "MATCHED", source: "MERCHANT_TRUST", scope: "MERCHANT_TRUST" });
  });

  it("keeps US merchant location and US delivery distinct and unverified without their own source facts", () => {
    const input = requirements(["trusted merchant", "merchant based in the United States", "ships to the United States"]);
    const claimed = { ...trusted, sourceHost: "store.us", description:
      "We are a trusted merchant based in the United States. This wig ships to the United States.", itemPrice: { amountCents: 1000, currency: "USD" } };
    const result = evaluateProductRequirements(claimed, input);
    expect(result.matched).toEqual(["trusted merchant"]);
    expect(result.unknown).toEqual(input.requiredFeatures.slice(1));
    expect(result.assessment.entries.slice(1)).toMatchObject([
      { status: "UNKNOWN", source: "MISSING", scope: "MERCHANT_LOCATION" },
      { status: "UNKNOWN", source: "MISSING", scope: "DELIVERY_MARKET" }
    ]);
  });

  it.each(["trusted merchant", "trusted merchant and waterproof", "not a trusted merchant", "美国商家", "支持配送到美国"])(
    "does not use ratings or echoed merchant claims to satisfy %s", requirement => {
    const claimed = product({ ...trusted, merchantTrust: { level: "UNKNOWN", verification: "UNVERIFIED", evidence: [] },
      description: requirement, productRating: { value: 5, count: 999, scaleMax: 5 } });
    const result = evaluateProductRequirements(claimed, requirements([requirement]));
    expect(result.matched).toEqual([]);
    expect(result.unknown).toEqual([requirement]);
  });

  it("retains unknown merchant exclusions and does not award unsupported merchant preferences", () => {
    const result = evaluateProductRequirements(trusted, { requiredFeatures: [], excludedFeatures: ["merchant based in China"],
      preferences: ["ships to the United States"] });
    expect(result.unknown).toEqual(["excluded: merchant based in China"]);
    expect(result.preferences).toEqual([]);
  });

  it("does not add merchant prose to product retrieval queries or consume the functional feature budget", () => {
    expect(functionalQueryFeatures(["trusted merchant", "black color", "merchant based in the United States"])).toEqual(["black color"]);
    expect(functionalQueryFeatures(["trusted merchant and anti-dandruff"])).toEqual([]);
  });

  it("retains ordinary product storage attributes without treating store as a merchant noun", () => {
    expect(functionalQueryFeatures(["easy to store"])).toEqual(["easy to store"]);
    expect(evaluateProductRequirements({ title: "Foldable chair", description: "easy to store" }, requirements(["easy to store"])).matched)
      .toEqual(["easy to store"]);
  });

  it.each(["seller refurbished", "seller-refurbished"])("retains the explicit product condition %s through search", async requirement => {
    const offer = product({ title: `Black wig - ${requirement}`, condition: "REFURBISHED" });
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "wig", productType: "wig",
      requiredFeatures: [requirement], conditionPreference: "REFURBISHED" }), {
      awin: { search: async () => emptyAwin() }, shopify: { search: async () => searchResult([offer]) }
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ presentationGroup: "TRUSTED_MATCH", requiredFeatureLimitations: [],
      requirementAssessment: { status: "SATISFIED", entries: [{ requirement, status: "MATCHED", source: "PRODUCT" }] } });
    expect(functionalQueryFeatures([requirement])).toEqual([requirement]);
  });

  it("does not use a refurbished-condition prefix to accept an entire merchant conjunction", () => {
    for (const requirement of ["seller refurbished and trusted merchant", "seller-refurbished with trusted merchant warranty", "not seller refurbished"]) {
      const result = evaluateProductRequirements({ title: "Wig", description: requirement }, requirements([requirement]));
      expect(result.matched).toEqual([]);
      expect(result.unknown).toEqual([requirement]);
    }
  });

  it("strips only a complete merchant requirement repeated in query, while preserving the original request", async () => {
    const search = vi.fn(async () => searchResult([]));
    const request = SearchProductsInputSchema.parse({ query: "black wig trusted merchant", productType: "wig", requiredFeatures: ["trusted merchant"] });
    await searchProducts(request, { awin: { search: async () => emptyAwin() }, shopify: { search } });
    const calls = search.mock.calls as unknown as Array<[{ query?: string }]>;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(([input]) => !input.query?.includes("trusted merchant"))).toBe(true);
    expect(request.query).toBe("black wig trusted merchant");
    expect(request.requiredFeatures).toEqual(["trusted merchant"]);
  });

  it("does not spend variant reads on a missing merchant-country fact", async () => {
    const inspect = vi.fn(async (selected: ShopifyProduct) => ({ productTitle: selected.title, canonicalProductUrl: selected.merchantUrl, variants: [selected] }));
    await searchProducts(SearchProductsInputSchema.parse({ query: "black wig", productType: "wig",
      requiredFeatures: ["black color", "merchant based in the United States"] }), {
      awin: { search: async () => emptyAwin() }, shopify: { search: async () => searchResult([{ ...trusted, checkoutPlatform: "SHOPIFY" }]) },
      selectedProducts: { inspect }
    });
    expect(inspect).not.toHaveBeenCalled();
  });

  it("returns a trusted black wig through MCP while retaining the original requirement ledger", async () => {
    const replay = await connectReplay(async () => searchResult([trusted]), { awin: { search: async () => emptyAwin() } });
    try {
      const result = await replay.client.callTool({ name: "search_products", arguments: {
        query: "black wig", productType: "wig", requiredFeatures: ["black color", "trusted merchant"], maxItemPriceCents: 9999
      } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ requirementsSummary: { requiredFeatures: ["black color", "trusted merchant"] },
        products: [{ presentationGroup: "TRUSTED_MATCH", requiredFeatureLimitations: [], requirementAssessment: { status: "SATISFIED" } }],
        recovery: { qualifiedMatches: 1 } });
    } finally { await replay.close(); }
  });

  it("rechecks approved Awin evidence and exact-host Shopify joins without trusting near-matching hosts", async () => {
    const peers = ["ishowbeauty.com", "shop.ishowbeauty.com", "ishowbeauty.example"].map(host => product({
      title: "Black human hair wig", handle: host, merchantId: host, sourceHost: host, merchantUrl: `https://${host}/products/b`,
      merchantTrust: { level: "UNKNOWN", verification: "UNVERIFIED", evidence: [] }, recommendationTier: "HIGH_RATED_UNVERIFIED"
    }));
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "wig", productType: "wig", requiredFeatures: ["trusted merchant"] }), {
      awin: { search: async () => ({ ...emptyAwin(), products: [awinProduct] }) }, shopify: { search: async () => searchResult(peers) }
    });
    const direct = result.candidates.find(candidate => candidate.source === "AWIN_PRODUCT_FEED")!;
    expect(direct.requirementAssessment?.status).toBe("SATISFIED");
    for (const candidate of result.candidates.filter(candidate => candidate.shopifyProduct !== undefined)) {
      expect(candidate.requirementAssessment?.status).toBe(candidate.shopifyProduct!.sourceHost === "ishowbeauty.com" ? "SATISFIED" : "NEEDS_VERIFICATION");
    }
    expect(result.candidates.find(candidate => candidate.shopifyProduct?.sourceHost === "ishowbeauty.com")?.requiredFeatureLimitations).toEqual([]);
    expect(result.shopifyResult?.products.find(entry => entry.sourceHost === "ishowbeauty.com"))
      .toMatchObject({ merchantTrust: { verification: "INDEPENDENT" }, recommendationTier: "TRUSTED_OR_AFFILIATE" });
  });

  it("keeps merchant conditions out of legacy Awin product filters without deleting the hard conditions", async () => {
    const search = vi.fn(async () => ({ ...emptyAwin(), supportsRequirements: true }));
    await searchProducts(SearchProductsInputSchema.parse({ query: "wig", productType: "wig", features: ["black color", "trusted merchant"],
      featureMode: "REQUIRED" }), { awin: { search }, shopify: { search: async () => searchResult([]) } });
    const calls = search.mock.calls as unknown as Array<[{ requiredFeatures?: string[] }]>;
    expect(calls.at(-1)?.[0].requiredFeatures).toEqual(["black color"]);
  });

  it("does not revive an explicitly excluded merchant condition when a late exact-host join verifies it", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "wig", productType: "wig", excludedFeatures: ["trusted merchant"] }), {
      awin: { search: async () => ({ ...emptyAwin(), products: [awinProduct] }) }, shopify: { search: async () => searchResult([
        { ...trusted, merchantTrust: { level: "UNKNOWN", verification: "UNVERIFIED", evidence: [] } }
      ]) }
    });
    expect(result.candidates).toEqual([]);
  });

  it("does not upgrade conflicting advertiser identities or known risky storefronts", async () => {
    const result = await searchProducts(SearchProductsInputSchema.parse({ query: "wig", productType: "wig", requiredFeatures: ["trusted merchant"] }), {
      awin: { search: async () => ({ ...emptyAwin(), products: [awinProduct, { ...awinProduct, merchantId: "different-advertiser", merchantProductId: "different" }] }) },
      shopify: { search: async () => searchResult([
        { ...trusted, merchantTrust: { level: "UNKNOWN", verification: "UNVERIFIED", evidence: [] } },
        { ...trusted, handle: "risky", merchantTrust: { level: "RISKY", verification: "UNVERIFIED", evidence: [] } }
      ]) }
    });
    const candidates = result.candidates.filter(candidate => candidate.shopifyProduct !== undefined);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.shopifyProduct?.merchantTrust.verification).toBe("UNVERIFIED");
    expect(candidates[0]?.requiredFeatureLimitations).toEqual(["trusted merchant"]);
  });

  it("does not discard an inspectable variant because merchant location is not a product specification", async () => {
    const selected = { ...trusted, handle: "123", merchantUrl: "https://ishowbeauty.com/products/black-wig?variant=123" };
    const inspector = createShopifySelectedProductInspector({ fetchProduct: async url => ({ finalUrl: url, response: new Response(JSON.stringify({
      currency: "USD", title: "Black human hair wig", handle: "black-wig", options: [{ name: "Color", position: 1, values: ["Black"] }],
      variants: [{ id: 123, title: "Black", price: 2000, available: true, options: ["Black"] }]
    })) }) });
    const result = await inspector.inspect(selected, {}, { requirements: { requiredFeatures: ["black color", "trusted merchant", "merchant based in the United States"] } });
    expect(result.variants).toHaveLength(1);
    expect(evaluateProductRequirements(result.variants[0]!, requirements(["trusted merchant", "merchant based in the United States"])).unknown)
      .toEqual(["merchant based in the United States"]);
  });

  it("keeps the merchant restriction in inspection-derived snapshots and leaves the parent unchanged", async () => {
    const requirement = "merchant based in the United States";
    const replay = await connectReplay(async () => searchResult([{ ...trusted, handle: "123", checkoutPlatform: "SHOPIFY" }]), { awin: { search: async () => emptyAwin() },
      selectedProducts: { inspect: async selected => ({ productTitle: selected.title, canonicalProductUrl: selected.merchantUrl, variants: [selected] }) } });
    try {
      const initial = (await replay.client.callTool({ name: "search_products", arguments: { query: "black wig", productType: "wig",
        requiredFeatures: ["black color", "trusted merchant", requirement] } })).structuredContent as ProductCardContent;
      const inspected = await replay.client.callTool({ name: "inspect_selected_shopify_product", arguments: {
        renderId: initial.renderId, selectionId: initial.products[0]!.selectionId
      } });
      expect(inspected.isError, JSON.stringify(inspected.content)).not.toBe(true);
      expect(inspected.structuredContent).toMatchObject({ updatedSnapshot: { products: [{ requiredFeatureLimitations: [requirement],
        presentationGroup: "RESEARCH_ONLY" }], requirementsSummary: initial.requirementsSummary } });
      expect(initial.products[0]?.requiredFeatureLimitations).toEqual([requirement]);
    } finally { await replay.close(); }
  });
});
