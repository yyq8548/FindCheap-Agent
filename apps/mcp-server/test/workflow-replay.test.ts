import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShoppingServer, type ShoppingServerDependencies, type ShopifyPort } from "../src/server.js";
import type { ShopifyProduct, ShopifySearchResult } from "../src/shopify-client.js";

// Synthetic provider records and observation text only: no user images, live URLs, or account data.
const now = new Date("2026-09-04T19:51:00.000Z");
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function product(overrides: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    merchantId: "ishow", merchant: "Ishow Hair", sourceHost: "ishowbeauty.com",
    merchantTrust: { level: "ESTABLISHED_RETAILER", verification: "INDEPENDENT", evidence: ["synthetic reviewed merchant"] },
    recommendationTier: "TRUSTED_OR_AFFILIATE", handle: "fixture-short-wig", title: "Short human hair wig",
    productType: "wig", brand: "Ishow", gtins: [], variantDimensions: {}, matchStatus: "DISCOVERY_MATCH",
    matchEvidence: ["same product family"], condition: "NEW", itemPrice: { amountCents: 3_641, currency: "USD" },
    availability: "IN_STOCK", merchantUrl: "https://ishowbeauty.com/products/fixture-short-wig",
    checkedAt: now.toISOString(), checkoutPlatform: "MERCHANT", ...overrides
  };
}

function visualProduct(handle: string, productType = "dress"): ShopifyProduct {
  return product({
    merchantId: "doen", merchant: "DÔEN", sourceHost: "shopdoen.com", brand: "DOEN", handle,
    title: `DÔEN ${handle} ${productType}`, productType,
    description: `${productType} with lace trim`,
    merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT", evidence: ["synthetic official merchant"] },
    imageUrl: `https://cdn.shopify.com/${handle}.jpg`, merchantUrl: `https://shopdoen.com/products/${handle}`
  });
}

function result(products: ShopifyProduct[]): ShopifySearchResult {
  return {
    source: "SHOPIFY_GLOBAL_CATALOG", coverage: "COMPLETE", merchantsQueried: 2, merchantsSucceeded: 2,
    comparison: { status: "DISCOVERY_ONLY", evidence: ["not verified same-product identity"], merchantCount: 2, offerCount: products.length },
    questions: [], products,
    diagnostics: {
      apiDurationMs: 1, cacheStatus: "MISS", chromeFallbackEligible: false, queryAttempts: 1, fallbackQueryUsed: false,
      catalogProductsReturned: products.length, catalogVariantsReturned: products.length, catalogZeroResultAttempts: products.length === 0 ? 1 : 0,
      outOfStockProductsExcluded: 0, identityProductsExcluded: 0, irrelevantProductsExcluded: 0,
      conditionProductsExcluded: 0, priceProductsExcluded: 0, trustedMerchantProductsReturned: products.length,
      unverifiedMerchantProductsReturned: 0, unverifiedMerchantProductsExcluded: 0, riskyMerchantProductsExcluded: 0,
      merchantTrustRegistryVersion: "fixture", merchantsFailed: 0, coveragePercent: 100,
      failedMerchantIds: [], timedOutMerchantIds: [], registryVersion: "fixture", searchTimeoutMs: 3_000,
      selectionPolicy: "EXACT_THEN_DISCOVERY_THEN_SIMILAR_THEN_DIVERSE_MERCHANTS_THEN_PRICE"
    }
  };
}

async function connect(search: ShopifyPort["search"], dependencies: ShoppingServerDependencies = {}) {
  // Any accidental real provider access fails this replay instead of reaching the network.
  const network = vi.fn(async () => { throw new Error("NETWORK_FORBIDDEN_IN_REPLAY"); });
  vi.stubGlobal("fetch", network);
  const server = createShoppingServer({ search }, undefined, {
    now: () => now,
    visualCandidateImages: { load: async () => ({ data: Buffer.from("synthetic-candidate").toString("base64"), mimeType: "image/jpeg" }) },
    ...dependencies
  });
  const client = new Client({ name: "workflow-replay", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closers.push(async () => { await client.close(); await server.close(); expect(network).not.toHaveBeenCalled(); });
  return client;
}

type VisualSession = { visualSessionId: string; candidates: Array<{ candidateId: string; title: string }> };
const blackDetail = "multiple horizontal sheer floral lace insertion bands alternating with densely gathered opaque panels";
const blackDressRequest = {
  query: "DOEN dress", brand: "DOEN", brandMode: "REQUIRED", productType: "dress",
  contextMode: "NEW_PRODUCT", comparisonMode: "DISCOVERY", responseLocale: "zh-CN", allowAlternatives: false,
  visualInput: {
    brand: "DOEN", productType: "dress", imageQuality: "HIGH",
    observations: [
      { attribute: "COLOR", value: "black", confidence: 0.99, evidence: "Dress fabric is black." },
      { attribute: "DISTINCTIVE_DETAIL", value: blackDetail, confidence: 0.99, evidence: "Repeated horizontal lace and gathered fabric bands." },
      { attribute: "NECKLINE", value: "wide boat neckline with lace edging", confidence: 0.95 },
      { attribute: "SLEEVE", value: "short cap sleeves", confidence: 0.96 },
      { attribute: "HEM", value: "scalloped lace trim at hem", confidence: 0.93 }
    ],
    occlusions: ["Hands obscure the lower center front."]
  }
};

async function rejectAll(client: Client, session: VisualSession) {
  return client.callTool({ name: "finalize_visual_search", arguments: {
    visualSessionId: session.visualSessionId,
    verdicts: session.candidates.map(({ candidateId }) => ({
      candidateId, verdict: {
        classification: "CONFLICT", matches: [{ attribute: "PRODUCT_TYPE", referenceEvidence: "blouse", candidateEvidence: "blouse" }],
        conflicts: [{ attribute: "DISTINCTIVE_DETAIL", referenceEvidence: "layered chest ruffles and front tie bow", candidateEvidence: "plain buttoned front without ruffles or tie" }]
      }
    }))
  } });
}

describe("sanitized conversational workflow replay", () => {
  it("replays search, UI selection, unavailable coupons, comparison and a new image without losing the old render", async () => {
    const search = vi.fn<ShopifyPort["search"]>(async (input) => result((input.query ?? "").normalize("NFD").replace(/\p{M}/gu, "").includes("DOEN")
      ? [visualProduct("black-lace-mini")]
      : [product(), product({
          merchantId: "hairsofly", merchant: "HAIRSOFLY SHOP", sourceHost: "hairsoflyshop.com", handle: "fixture-long-wig",
          title: "Long synthetic hair wig", brand: "Sensationnel", itemPrice: { amountCents: 4_399, currency: "USD" },
          merchantUrl: "https://hairsoflyshop.com/products/fixture-long-wig"
        })]));
    const client = await connect(search, { deals: { search: async () => { throw new DOMException("request timed out", "TimeoutError"); } } });
    const found = await client.callTool({ name: "search_products", arguments: {
      query: "wig", productType: "wig", contextMode: "NEW_PRODUCT", comparisonMode: "DISCOVERY", responseLocale: "zh-CN", limit: 8
    } });
    expect(found.isError).not.toBe(true);
    const snapshot = found.structuredContent as { renderId: string; traceId: string; products: Array<{ selectionId: string }> };
    expect(snapshot.products).toHaveLength(2);
    expect(snapshot.traceId).toEqual(expect.any(String));
    const selectionIds = snapshot.products.map(({ selectionId }) => selectionId);
    const initialSearchCalls = search.mock.calls.length;
    expect((await client.callTool({ name: "sync_product_card_selection", arguments: { renderId: snapshot.renderId, selectionIds, revision: 1 } })).structuredContent)
      .toEqual({ status: "RECORDED", selectedCount: 2 });
    const deal = await client.callTool({ name: "research_selected_product_deal", arguments: { renderId: snapshot.renderId, position: 1, objective: "CURRENT_DEALS" } });
    expect(deal.isError).not.toBe(true);
    expect(deal.structuredContent).toMatchObject({ dealStatus: "DEAL_LOOKUP_UNAVAILABLE", dealLookupStatus: "UNAVAILABLE", dealSummary: { status: "UNAVAILABLE" } });
    expect(deal._meta).toMatchObject({ "findcheap/referenceTrace": { traceId: snapshot.traceId, renderId: snapshot.renderId, operation: "DEAL_RESEARCH" } });
    expect(JSON.stringify(deal.content)).not.toMatch(/No current verified merchant deal was found|没有优惠券/u);
    const compare = () => client.callTool({ name: "compare_selected_products", arguments: { renderId: snapshot.renderId, mode: "AUTO", responseLocale: "zh-CN" } });
    const comparison = await compare();
    expect(comparison.structuredContent).toMatchObject({ renderId: snapshot.renderId, mode: "PRODUCT_CHOICES", entries: selectionIds.map((selectionId) => ({ selectionId })) });
    expect(comparison._meta).toMatchObject({ "findcheap/referenceTrace": { traceId: snapshot.traceId, renderId: snapshot.renderId, operation: "COMPARISON" } });
    expect(search).toHaveBeenCalledTimes(initialSearchCalls);

    const visual = await client.callTool({ name: "search_visual_candidates", arguments: blackDressRequest });
    expect(blackDetail).toHaveLength(101);
    expect(visual.isError).not.toBe(true);
    const session = visual.structuredContent as VisualSession;
    expect(session.candidates).toHaveLength(1);
    const final = await client.callTool({ name: "finalize_visual_search", arguments: {
      visualSessionId: session.visualSessionId,
      verdicts: session.candidates.map(({ candidateId }) => ({ candidateId, verdict: {
        classification: "HIGHLY_SIMILAR", conflicts: [],
        matches: [
          { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
          { attribute: "DISTINCTIVE_DETAIL", referenceEvidence: blackDetail, candidateEvidence: "repeated horizontal lace insertion bands" },
          { attribute: "NECKLINE", referenceEvidence: "boat neckline", candidateEvidence: "boat neckline" }
        ]
      } }))
    } });
    expect(final.isError).not.toBe(true);
    expect(final.structuredContent).toMatchObject({ status: "OK", products: [{ visualMatchGroup: "HIGHLY_SIMILAR" }] });
    expect((final.structuredContent as { renderId: string }).renderId).not.toBe(snapshot.renderId);
    expect((final.structuredContent as { traceId: string }).traceId).not.toBe(snapshot.traceId);
    const visualSearchCalls = search.mock.calls.length;
    const oldComparison = await compare();
    expect(oldComparison.structuredContent).toMatchObject({ renderId: snapshot.renderId, entries: selectionIds.map((selectionId) => ({ selectionId })) });
    expect(oldComparison._meta).toMatchObject({ "findcheap/referenceTrace": { traceId: snapshot.traceId, renderId: snapshot.renderId, operation: "COMPARISON" } });
    expect(search).toHaveBeenCalledTimes(visualSearchCalls);
  });

  it("publishes the same observation bound it enforces and rejects oversized input before any provider call", async () => {
    const search = vi.fn<ShopifyPort["search"]>(async () => result([]));
    const client = await connect(search);
    const tools = await client.listTools();
    const visual = tools.tools.find((tool) => tool.name === "search_visual_candidates");
    expect(visual?.inputSchema).toMatchObject({
      properties: { visualInput: { properties: {
        distinctiveDetails: { items: { maxLength: 240 } },
        observations: { items: { properties: { value: { $ref: "#/properties/visualInput/properties/distinctiveDetails/items" } } } }
      } } }
    });
    const invalid = await client.callTool({ name: "search_visual_candidates", arguments: {
      ...blackDressRequest, visualInput: { productType: "dress", observations: [{ attribute: "DISTINCTIVE_DETAIL", value: "x".repeat(241), confidence: 0.99 }] }
    } });
    expect(invalid.isError).toBe(true);
    expect(invalid._meta).toMatchObject({ "findcheap/errorCode": "INVALID_ARGUMENTS" });
    expect(search).not.toHaveBeenCalled();
    expect(JSON.stringify(invalid)).not.toContain("x".repeat(241));
  });

  it("retains the brand, blouse family and two visible details in the required second review", async () => {
    const search = vi.fn<ShopifyPort["search"]>(async (input) => result([
      visualProduct((input.query ?? "").includes("layered ruffles") ? "second-plain-blouse" : "first-plain-blouse", "blouse")
    ]));
    const client = await connect(search);
    const first = await client.callTool({ name: "search_visual_candidates", arguments: {
      query: "DOEN blouse", brand: "DOEN", brandMode: "REQUIRED", productType: "blouse", contextMode: "NEW_PRODUCT", responseLocale: "zh-CN",
      visualInput: {
        brand: "DOEN", productType: "blouse",
        observations: [
          { attribute: "DISTINCTIVE_DETAIL", value: "layered ruffles across the upper chest and shoulders", confidence: 0.98 },
          { attribute: "DISTINCTIVE_DETAIL", value: "front tie bow with scalloped lace trim", confidence: 0.97 }
        ], occlusions: ["The right shoulder and neckline are partially obscured by a phone."]
      }
    } });
    expect(first.isError).not.toBe(true);
    const retry = await rejectAll(client, first.structuredContent as VisualSession);
    expect(retry.isError).not.toBe(true);
    const second = (retry.structuredContent as { visualReview: VisualSession }).visualReview;
    expect(second).toMatchObject({ stage: "RELAXED_REVIEW", finalAnswerAllowed: false, candidates: [{ title: "DÔEN second-plain-blouse blouse" }] });
    expect(search.mock.calls.map(([input]) => input.query)).toEqual(expect.arrayContaining([
      expect.stringMatching(/D[OÔ]EN (?:blouse|shirt).*layered ruffles.*front tie bow/u)
    ]));
    const callsBeforeFinal = search.mock.calls.length;
    const final = await rejectAll(client, second);
    expect(final.isError).not.toBe(true);
    expect(final.structuredContent).toMatchObject({ products: [], visualSearchFailure: { code: "CANDIDATES_CONFLICTED" } });
    expect(search).toHaveBeenCalledTimes(callsBeforeFinal);
    expect(callsBeforeFinal).toBeLessThanOrEqual(4);
  });

  it("keeps candidate image failures separate from reference-image rejection", async () => {
    const client = await connect(async () => result([visualProduct("unavailable-image")]), {
      visualCandidateImages: { load: async () => { throw new Error("IMAGE_UNAVAILABLE"); } }
    });
    const response = await client.callTool({ name: "search_visual_candidates", arguments: blackDressRequest });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({ status: "NO_IMAGE_CANDIDATES", visualSearchFailure: { code: "NO_LOADABLE_IMAGES", message: expect.stringContaining("参考图片已接受") } });
    expect(response._meta).toMatchObject({ "findcheap/visualImageLoadDiagnostics": { loaded: 0, failures: [{ sourceHost: "cdn.shopify.com", code: "REQUEST_FAILED" }] } });
  });

  it.each([true, false])("retains an unreviewed variant while deduplicating an identical variant and image (new variant: %s)", async (newVariant) => {
    const gray = visualProduct("variant-family");
    gray.merchantUrl = "https://shopdoen.com/products/variant-family?variant=111";
    gray.variantDimensions = { Color: "Grey" };
    gray.imageUrl = "https://cdn.shopify.com/variant-family-grey.jpg";
    const black: ShopifyProduct = {
      ...gray, handle: "variant-family-black", title: "DÔEN variant-family black dress",
      merchantUrl: "https://shopdoen.com/products/variant-family?variant=222",
      variantDimensions: { Color: "Black" }, imageUrl: "https://cdn.shopify.com/variant-family-black.jpg"
    };
    const search = vi.fn<ShopifyPort["search"]>(async (input) => result((input.query ?? "").includes("horizontal") && newVariant
      ? [gray, black, { ...gray }] : [gray, { ...gray }]));
    const load = vi.fn(async () => ({ data: Buffer.from("synthetic-variant").toString("base64"), mimeType: "image/jpeg" as const }));
    const client = await connect(search, { visualCandidateImages: { load } });
    const initial = await client.callTool({ name: "search_visual_candidates", arguments: blackDressRequest });
    expect(initial.isError).not.toBe(true);
    const session = initial.structuredContent as VisualSession;
    expect(session.candidates).toHaveLength(1);
    expect(load).toHaveBeenCalledOnce();
    const retry = await client.callTool({ name: "finalize_visual_search", arguments: {
      visualSessionId: session.visualSessionId,
      verdicts: session.candidates.map(({ candidateId }) => ({ candidateId, verdict: {
        classification: "CONFLICT", matches: [{ attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" }],
        conflicts: [{ attribute: "COLOR", referenceEvidence: "black", candidateEvidence: "grey" }]
      } }))
    } });
    expect(retry.isError).not.toBe(true);
    if (!newVariant) {
      expect(retry.structuredContent).toMatchObject({ products: [], visualSearchFailure: { code: "CANDIDATES_CONFLICTED" } });
      expect(retry.structuredContent).not.toHaveProperty("visualReview");
      expect(load).toHaveBeenCalledOnce();
      return;
    }
    const review = (retry.structuredContent as { visualReview: VisualSession }).visualReview;
    expect(review).toMatchObject({ finalAnswerAllowed: false, candidates: [{ title: black.title }] });
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls).toEqual([[gray.imageUrl], [black.imageUrl]]);
    const final = await client.callTool({ name: "finalize_visual_search", arguments: {
      visualSessionId: review.visualSessionId,
      verdicts: review.candidates.map(({ candidateId }) => ({ candidateId, verdict: {
        classification: "HIGHLY_SIMILAR", conflicts: [],
        matches: [
          { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
          { attribute: "DISTINCTIVE_DETAIL", referenceEvidence: blackDetail, candidateEvidence: "horizontal lace insertion bands" },
          { attribute: "COLOR", referenceEvidence: "black", candidateEvidence: "black" }
        ]
      } }))
    } });
    expect(final.isError).not.toBe(true);
    expect(final.structuredContent).toMatchObject({ products: [{ merchantUrl: black.merchantUrl, title: black.title }] });
  });

  it("does not call an evidence-insufficient verdict a visible conflict", async () => {
    const search = vi.fn<ShopifyPort["search"]>(async () => result([visualProduct("insufficient-evidence")]));
    const client = await connect(search);
    const initial = await client.callTool({ name: "search_visual_candidates", arguments: blackDressRequest });
    const session = initial.structuredContent as VisualSession;
    const finalized = await client.callTool({ name: "finalize_visual_search", arguments: {
      visualSessionId: session.visualSessionId,
      verdicts: session.candidates.map(({ candidateId }) => ({ candidateId, verdict: { classification: "SAME_STYLE", matches: [], conflicts: [] } }))
    } });
    expect(finalized.isError).not.toBe(true);
    expect(finalized.structuredContent).toMatchObject({ products: [], visualSearchFailure: { code: "VISUAL_EVIDENCE_INSUFFICIENT" } });
    expect(JSON.stringify(finalized.content)).not.toMatch(/visible non-occluded conflict|未被遮挡的冲突/u);
    expect(search.mock.calls.length).toBeLessThanOrEqual(9);
  });

  it("fills failed image slots from the bounded pool and delays coupon reads until final candidates", async () => {
    const logs = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const search = vi.fn<ShopifyPort["search"]>(async () => result(Array.from({ length: 10 }, (_, index) => visualProduct(`pool-${index}`))));
    let attempts = 0;
    const load = vi.fn(async () => {
      attempts += 1;
      if (attempts <= 2) throw new Error("IMAGE_UNAVAILABLE");
      return { data: Buffer.from("synthetic-candidate").toString("base64"), mimeType: "image/jpeg" as const };
    });
    const deals = vi.fn(async () => []);
    const client = await connect(search, { visualCandidateImages: { load }, deals: { search: deals } });
    const initial = await client.callTool({ name: "search_visual_candidates", arguments: blackDressRequest });
    expect(initial.isError).not.toBe(true);
    const session = initial.structuredContent as VisualSession;
    expect(session.candidates).toHaveLength(6);
    expect(load).toHaveBeenCalledTimes(8);
    expect(deals).not.toHaveBeenCalled();
    const incomplete = await client.callTool({ name: "finalize_visual_search", arguments: {
      visualSessionId: session.visualSessionId,
      verdicts: [{ candidateId: session.candidates[0]!.candidateId, verdict: { classification: "SAME_STYLE", matches: [], conflicts: [] } }]
    } });
    expect(incomplete.isError).toBe(true);
    expect(deals).not.toHaveBeenCalled();
    const finalized = await client.callTool({ name: "finalize_visual_search", arguments: {
      visualSessionId: session.visualSessionId,
      verdicts: session.candidates.map(({ candidateId }) => ({ candidateId, verdict: {
        classification: "HIGHLY_SIMILAR", conflicts: [],
        matches: [
          { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
          { attribute: "DISTINCTIVE_DETAIL", referenceEvidence: blackDetail, candidateEvidence: "horizontal lace insertion bands" }
        ]
      } }))
    } });
    expect(finalized.isError).not.toBe(true);
    expect((finalized.structuredContent as { products: unknown[] }).products.length).toBeGreaterThan(0);
    expect(deals).toHaveBeenCalledOnce();
    expect(search.mock.calls.length).toBeLessThanOrEqual(9);
    const calls = search.mock.calls.length;
    const replay = await client.callTool({ name: "finalize_visual_search", arguments: {
      visualSessionId: session.visualSessionId,
      verdicts: session.candidates.map(({ candidateId }) => ({ candidateId, verdict: { classification: "SAME_STYLE", matches: [], conflicts: [] } }))
    } });
    expect(replay.isError).toBe(true);
    expect(search).toHaveBeenCalledTimes(calls);
    const traceText = logs.mock.calls.map(([message]) => String(message)).filter((message) => message.startsWith("[findcheap-search-trace] "));
    const traces = traceText.map((message) => JSON.parse(message.slice("[findcheap-search-trace] ".length)) as {
      traceId: string; catalogRequests: number; imageRequests: number; dealRequests: number;
    });
    expect(traces.length).toBeGreaterThanOrEqual(2);
    expect(new Set(traces.map((trace) => trace.traceId)).size).toBe(1);
    expect(traces.every((trace) => trace.catalogRequests <= 9 && trace.imageRequests <= 12 && trace.dealRequests <= 1)).toBe(true);
    expect(traceText.join(" ")).not.toContain(blackDetail);
  });

  it("does not count product family, inferred material and visible text as three structural matches", async () => {
    const client = await connect(async () => result([visualProduct("wrong-color-no-structure")]));
    const initial = await client.callTool({ name: "search_visual_candidates", arguments: blackDressRequest });
    const session = initial.structuredContent as VisualSession;
    const finalized = await client.callTool({ name: "finalize_visual_search", arguments: {
      visualSessionId: session.visualSessionId,
      verdicts: session.candidates.map(({ candidateId }) => ({ candidateId, verdict: {
        classification: "HIGHLY_SIMILAR",
        matches: [
          { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
          { attribute: "MATERIAL", referenceEvidence: "cotton-like fabric", candidateEvidence: "cotton-like fabric" },
          { attribute: "VISIBLE_TEXT", referenceEvidence: "DOEN", candidateEvidence: "DOEN" }
        ],
        conflicts: [{ attribute: "COLOR", referenceEvidence: "black", candidateEvidence: "lavender" }]
      } }))
    } });
    expect(finalized.isError).not.toBe(true);
    expect(finalized.structuredContent).toMatchObject({ products: [], visualSearchFailure: { code: "CANDIDATES_CONFLICTED" } });
  });

  it("never substitutes newer IDs into an earlier render when UI selection arrives late", async () => {
    const search = vi.fn<ShopifyPort["search"]>(async () => result([product(), product({ handle: "second-wig", title: "Second human hair wig" })]));
    const client = await connect(search);
    const args = { query: "wig", productType: "wig", comparisonMode: "DISCOVERY", limit: 2 };
    const older = (await client.callTool({ name: "search_products", arguments: args })).structuredContent as { renderId: string; products: Array<{ selectionId: string }> };
    const newer = (await client.callTool({ name: "search_products", arguments: args })).structuredContent as { renderId: string; products: Array<{ selectionId: string }> };
    const calls = search.mock.calls.length;
    const sync = await client.callTool({ name: "sync_product_card_selection", arguments: { renderId: older.renderId, selectionIds: newer.products.map(({ selectionId }) => selectionId), revision: 1 } });
    expect(sync.isError).toBe(true);
    const missing = await client.callTool({ name: "compare_selected_products", arguments: { mode: "AUTO" } });
    expect(missing._meta).toMatchObject({ "findcheap/errorCode": "MISSING_REFERENCE_CONTEXT" });
    expect(search).toHaveBeenCalledTimes(calls);
  });

  it("reviews the seventh recalled dress before spending the second round on a new search", async () => {
    // Sparse, equally ranked metadata keeps the target seventh; model verdicts are synthetic.
    const pool = Array.from({ length: 9 }, (_, index) => visualProduct(`queued-${String(index).padStart(2, "0")}${index === 6 ? "-cornella" : ""}`));
    const search = vi.fn<ShopifyPort["search"]>(async () => result(pool));
    const load = vi.fn(async () => ({ data: Buffer.from("synthetic-image").toString("base64"), mimeType: "image/jpeg" as const }));
    const client = await connect(search, { visualCandidateImages: { load } });
    const first = await client.callTool({ name: "search_visual_candidates", arguments: blackDressRequest });
    const initial = first.structuredContent as VisualSession;
    expect(initial.candidates).toHaveLength(6);
    const calls = search.mock.calls.length;

    const retry = await rejectAll(client, initial);
    const second = (retry.structuredContent as { visualReview: VisualSession }).visualReview;
    expect(second).toMatchObject({ finalAnswerAllowed: false, candidates: pool.slice(6).map(({ title }) => ({ title })) });
    expect(search).toHaveBeenCalledTimes(calls);
    expect(load).toHaveBeenCalledTimes(9);
    expect(second.candidates.every(({ candidateId }) => !initial.candidates.some((entry) => entry.candidateId === candidateId))).toBe(true);

    const final = await client.callTool({ name: "finalize_visual_search", arguments: {
      visualSessionId: second.visualSessionId,
      verdicts: second.candidates.map(({ candidateId, title }) => ({ candidateId, verdict: title.includes("cornella") ? {
        classification: "HIGHLY_SIMILAR", conflicts: [], matches: [
          { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
          { attribute: "DISTINCTIVE_DETAIL", referenceEvidence: blackDetail, candidateEvidence: "horizontal lace insertion bands" },
          { attribute: "NECKLINE", referenceEvidence: "boat neckline", candidateEvidence: "boat neckline" }
        ]
      } : { classification: "CONFLICT", conflicts: [
        { attribute: "NECKLINE", referenceEvidence: "boat neckline", candidateEvidence: "deep V neckline" }
      ] } }))
    } });
    expect(final.isError).not.toBe(true);
    expect(final.structuredContent).toMatchObject({ products: [{ title: pool[6]!.title, merchantUrl: pool[6]!.merchantUrl, matchStatus: "DISCOVERY_MATCH" }] });
    expect((final.structuredContent as { products: unknown[] }).products).toHaveLength(1);
    expect(search).toHaveBeenCalledTimes(calls);
  });

  it("reserves second-round images and does not reload failed or already reviewed candidates", async () => {
    const pool = Array.from({ length: 12 }, (_, index) => visualProduct(`budget-pool-${String(index).padStart(2, "0")}`));
    const search = vi.fn<ShopifyPort["search"]>(async () => result(pool));
    const load = vi.fn(async (url: string) => {
      if (/budget-pool-0[0-3]\.jpg/u.test(url)) throw new Error("IMAGE_UNAVAILABLE");
      return { data: Buffer.from("synthetic-image").toString("base64"), mimeType: "image/jpeg" as const };
    });
    const client = await connect(search, { visualCandidateImages: { load } });
    const first = await client.callTool({ name: "search_visual_candidates", arguments: blackDressRequest });
    const initial = first.structuredContent as VisualSession;
    expect(initial.candidates).toHaveLength(5);
    expect(load).toHaveBeenCalledTimes(9);
    const calls = search.mock.calls.length;
    const retry = await rejectAll(client, initial);
    const second = (retry.structuredContent as { visualReview: VisualSession }).visualReview;
    expect(second).toMatchObject({ candidates: pool.slice(9).map(({ title }) => ({ title })) });
    expect(load).toHaveBeenCalledTimes(12);
    expect(new Set(load.mock.calls.map(([url]) => url)).size).toBe(12);
    expect(search).toHaveBeenCalledTimes(calls);
    const final = await rejectAll(client, second);
    expect(final.structuredContent).toMatchObject({ products: [], visualSearchFailure: { code: "CANDIDATES_CONFLICTED" } });
    expect(final.structuredContent).not.toHaveProperty("visualReview");
    expect(search).toHaveBeenCalledTimes(calls);
    expect(load).toHaveBeenCalledTimes(12);
  });

  it.each([false, true])("fills only second-round vacancies without duplicating the retained candidate or exceeding image output (large images: %s)", async (largeImages) => {
    const pool = Array.from({ length: 7 }, (_, index) => visualProduct(`pending-${index}`));
    const additional = [visualProduct("supplement-one"), visualProduct("supplement-two")];
    const search = vi.fn<ShopifyPort["search"]>(async (input) => result((input.query ?? "").includes("horizontal")
      ? [pool[6]!, ...additional] : pool));
    const load = vi.fn(async (url: string) => ({
      data: largeImages && /pending-6|supplement/u.test(url) ? "a".repeat(240_000) : Buffer.from("synthetic-image").toString("base64"),
      mimeType: "image/jpeg" as const
    }));
    const client = await connect(search, { visualCandidateImages: { load } });
    const first = await client.callTool({ name: "search_visual_candidates", arguments: blackDressRequest });
    const retry = await rejectAll(client, first.structuredContent as VisualSession);
    const second = (retry.structuredContent as { visualReview: VisualSession }).visualReview;
    expect(second).toMatchObject({ stage: "RELAXED_REVIEW", finalAnswerAllowed: false });
    expect(second.candidates.map(({ title }) => title)).toEqual(largeImages
      ? [pool[6]!.title] : [pool[6]!.title, ...additional.map(({ title }) => title)]);
    expect(load.mock.calls.filter(([url]) => url === pool[6]!.imageUrl)).toHaveLength(1);
    const images = (retry.content as Array<{ type: string; data?: string }>).filter(({ type }) => type === "image");
    expect(images.reduce((total, entry) => total + (entry.data?.length ?? 0), 0)).toBeLessThanOrEqual(400_000);
    const calls = search.mock.calls.length;
    const final = await rejectAll(client, second);
    expect(final.structuredContent).toMatchObject({ products: [] });
    expect(final.structuredContent).not.toHaveProperty("visualReview");
    expect(search).toHaveBeenCalledTimes(calls);
  });
});
