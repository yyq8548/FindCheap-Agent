import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUnavailableAwinPort } from "../../../packages/awin-feed/src/index.js";
import { WooProductSchema, WooSearchResultSchema, type WooProduct } from "../../../packages/contracts/src/woocommerce.js";
import { createAffiliateLinkResolver } from "../src/affiliate-links.js";
import { createFindCheapBackend } from "../src/backend.js";
import { createUnavailableDealPort } from "../src/deal-client.js";
import { createShoppingServer, type ProductCardContent } from "../src/server.js";
import { candidateFingerprint, sourceProductFingerprint } from "../src/visual-source-fingerprints.js";
import { createVisualCandidateImagePort } from "../src/visual-candidate-images.js";
import { createMemoryWatchStore } from "../src/watch-store.js";
import { createWooCommercePortFromEnvironment } from "../src/woocommerce-client.js";
import { product as shopifyFixture, searchResult } from "./fixtures/conversation-replay-support.js";

// Synthetic source responses and a valid 1x1 WebP exercise transport contracts.
// They are not merchant evidence, image matching ground truth, or native host acceptance.
const checkedAt = "2026-09-08T16:00:00.000Z";
const imageBytes = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=", "base64");
const sourceOrigin = "https://woo-source.example";
const originalImage = "https://reference.example/private-user-reference.webp?token=reference-only";
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map(close => close())); vi.unstubAllGlobals(); });

function woo(overrides: Partial<WooProduct> = {}): WooProduct {
  return WooProductSchema.parse({ sourceKind: "WOOCOMMERCE_STORE_API", merchantId: "woo-one", merchantName: "Woo One",
    sourceHost: "woo-one.example", productId: 1000, parentProductId: 1000, variationId: 1001, productType: "variation",
    title: "Black boat neck mini dress", category: "dress", description: "Black boat neck mini dress", condition: "NEW",
    attributes: [], variantDimensions: { Color: ["Black"], Size: ["S", "M"] }, selectedAttributes: { Color: "Black", Size: "S" },
    merchantUrl: "https://woo-one.example/product/dress?variation_id=1001", images: [{ id: "image-1001", url: "https://merchant-cdn.example/dress.webp" }],
    imageUrl: "https://merchant-cdn.example/dress.webp", itemPrice: { amountCents: 2200, currency: "USD" },
    priceEvidence: { amountMinor: "2200", currency: "USD", currencyMinorUnit: 2, scope: "VARIANT", taxBasis: "UNKNOWN" },
    availability: "IN_STOCK", availabilityScope: "VARIANT", rating: { value: 4.8, reviewCount: 25, scale: 5, productId: 1000 }, checkedAt,
    ...overrides });
}
function response(products: WooProduct[]) {
  return WooSearchResultSchema.parse({ source: "WOOCOMMERCE_STORE_API", schemaVersion: 1, registryVersion: "visual-fixture-v1",
    requestId: "woo-visual-fixture", status: "COMPLETE", snapshotAt: checkedAt, products,
    stores: [{ merchantId: "woo-one", status: "COMPLETE", requests: 1, returned: products.length }],
    diagnostics: { eligibleStores: 1, plannedStores: 1, attemptedStores: 1, succeededStores: 1, failedStores: 0, skippedStores: 0,
      physicalRequests: 1, responseBytes: 1000, cacheHits: 0, elapsedMs: 1, truncated: false, registryCoverageComplete: true } });
}
function sourceClient(products = [woo()]) {
  const request = vi.fn<typeof fetch>(async () => Response.json(response(products)));
  const port = createWooCommercePortFromEnvironment({ WOOCOMMERCE_API_BASE_URL: sourceOrigin }, { fetch: request })!;
  return { port, request };
}
function imageLoader(finalUrl?: string) {
  const fetchImage = vi.fn(async (input: { url: string }) => ({ response: new Response(Uint8Array.from(imageBytes), {
    headers: { "content-type": "image/webp" } }), finalUrl: finalUrl ?? input.url }));
  return { port: createVisualCandidateImagePort(fetchImage), fetchImage };
}
type Session = { visualSessionId: string; candidates: Array<{ candidateId: string }>; workflow: { finalAnswerAllowed: boolean } };
const verdict = { classification: "SAME_STYLE", matches: [
  { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
  { attribute: "NECKLINE", referenceEvidence: "boat neck", candidateEvidence: "boat neck" }
], conflicts: [] };
async function connect() {
  const network = vi.fn(async () => { throw new Error("WOO_VISUAL_FORBIDS_LIVE_NETWORK"); });
  vi.stubGlobal("fetch", network);
  const source = sourceClient();
  const images = imageLoader();
  const inspect = vi.fn(async () => ({ source: "WOOCOMMERCE_STORE_API" as const, registryVersion: "visual-fixture-v1",
    status: "COMPLETE" as const, checkedAt, truncated: false, products: [woo({ variationId: 1002,
      selectedAttributes: { Color: "Black", Size: "M" }, imageUrl: `${sourceOrigin}/v1/woocommerce/images?merchantId=woo-one&imageId=image-1002`,
      merchantUrl: "https://woo-one.example/product/dress?variation_id=1002" })] }));
  const backend = createFindCheapBackend({ catalog: { shopify: { search: async () => searchResult([]) },
    awin: createUnavailableAwinPort(), woocommerce: source.port }, product: { affiliateLinks: createAffiliateLinkResolver(),
    woocommerceProducts: { lookup: source.port.lookup, inspect } }, visualCandidateImages: images.port,
    deals: createUnavailableDealPort(), verifiedDeals: false, watches: createMemoryWatchStore() });
  const server = createShoppingServer(undefined, undefined, { backend, now: () => new Date(checkedAt) });
  const client = new Client({ name: "woo-visual-contract", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closers.push(async () => { await client.close(); await server.close(); expect(network).not.toHaveBeenCalled(); });
  const begin = async () => {
    const result = await client.callTool({ name: "search_visual_candidates", arguments: {
      query: "black mini dress", productType: "dress", visualInput: { imageUrl: originalImage,
        productType: "dress", colors: ["black"], neckline: "boat neck", length: "mini" } } });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    const session = result.structuredContent as Session;
    expect(session.candidates).toHaveLength(1);
    expect(session.workflow.finalAnswerAllowed).toBe(false);
    return { ...session, metadata: result._meta };
  };
  const finalize = (session: Session) => client.callTool({ name: "finalize_visual_search", arguments: {
    visualSessionId: session.visualSessionId, verdicts: session.candidates.map(({ candidateId }) => ({ candidateId, verdict })) } });
  return { client, source, images, inspect, begin, finalize };
}

describe("WooCommerce visual source contract", () => {
  it.each([
    ["merchant", { merchantId: "woo-two" }],
    ["host", { sourceHost: "woo-two.example", merchantUrl: "https://woo-two.example/product/dress?variation_id=1001" }],
    ["parent", { productId: 2000, parentProductId: 2000, rating: undefined }],
    ["variant", { variationId: 1002 }]
  ] satisfies Array<[string, Partial<WooProduct>]>)("binds visual fingerprints to the Woo %s", (_field, change) => {
    expect(sourceProductFingerprint("WOOCOMMERCE", woo(change))).not.toEqual(sourceProductFingerprint("WOOCOMMERCE", woo()));
  });
  it("keeps Woo and Shopify source namespaces separate for identical merchant/host/numeric handles", () => {
    const product = woo();
    const peer = shopifyFixture({ merchantId: product.merchantId, sourceHost: product.sourceHost, handle: String(product.variationId) });
    expect(sourceProductFingerprint("WOOCOMMERCE", product)).not.toEqual(sourceProductFingerprint("SHOPIFY", peer));
    expect(candidateFingerprint({ source: "WOOCOMMERCE_STORE_API", woocommerceProduct: product, affiliateState: "NONE",
      recommendationTier: "TRUSTED_OR_AFFILIATE", featureEvidence: [], preferenceEvidence: [], requiredFeatureLimitations: [],
      verifiedCoupons: [], identityStatus: "DISCOVERY_MATCH", identityEvidence: [], resultGroup: "DISCOVERY" }))
      .toEqual(sourceProductFingerprint("WOOCOMMERCE", product));
  });
  it("loads only the client-rewritten proxy URL under the existing bounded image policy", async () => {
    const source = sourceClient();
    const result = await source.port.search({ query: "dress", limit: 3, market: "US", currency: "USD" });
    const proxy = `${sourceOrigin}/v1/woocommerce/images?merchantId=woo-one&imageId=image-1001`;
    expect(result.products[0]).toMatchObject({ imageUrl: proxy, images: [{ id: "image-1001", url: proxy }] });
    const loader = imageLoader();
    await expect(loader.port.load(result.products[0]!.imageUrl!)).resolves.toEqual({ data: imageBytes.toString("base64"),
      mimeType: "image/webp", sourceContentSha256: createHash("sha256").update(imageBytes).digest("hex") });
    expect(loader.fetchImage).toHaveBeenCalledExactlyOnceWith({ url: proxy }, { allowedHosts: ["woo-source.example"], maxResponseBytes: 1_500_000 });
  });
  it("rejects an image response whose final host is outside the proxy source", async () => {
    const loader = imageLoader("https://unknown-source.example/forged.webp");
    await expect(loader.port.load(`${sourceOrigin}/v1/woocommerce/images?merchantId=woo-one&imageId=image-1001`))
      .rejects.toMatchObject({ code: "REDIRECT_NOT_APPROVED" });
  });
  it.each(["source", "product"])("rejects an unknown %s namespace before visual candidates exist", async field => {
    const payload = response([woo()]);
    const invalid = field === "source" ? { ...payload, source: "UNKNOWN_CATALOG" }
      : { ...payload, products: [{ ...payload.products[0]!, sourceKind: "UNKNOWN_CATALOG" }] };
    const request = vi.fn<typeof fetch>(async () => Response.json(invalid));
    const source = createWooCommercePortFromEnvironment({ WOOCOMMERCE_API_BASE_URL: sourceOrigin }, { fetch: request })!;
    await expect(source.search({ query: "dress", limit: 3, market: "US", currency: "USD" })).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("sends derived text to Woo and loads its candidate proxy without forwarding the original image", async () => {
    const harness = await connect();
    const session = await harness.begin();
    const trace = session.metadata?.["findcheap/searchTrace"] as {
      visualFunnel: { stages: Array<{ stage: string; source?: string; fingerprints: Array<{ productHash: string }> }> }
    };
    const normalized = trace.visualFunnel.stages.find(stage => stage.stage === "NORMALIZED" && stage.source === "WOOCOMMERCE")!;
    const presented = trace.visualFunnel.stages.find(stage => stage.stage === "IMAGES_PRESENTED")!;
    expect(presented.fingerprints.map(entry => entry.productHash)).toEqual(normalized.fingerprints.map(entry => entry.productHash));
    expect(harness.source.request).toHaveBeenCalled();
    for (const [url, options] of harness.source.request.mock.calls) {
      expect(url).toBe(`${sourceOrigin}/v1/woocommerce/search`);
      const body = String(options?.body);
      expect(body).not.toContain(originalImage);
      expect(body).not.toMatch(/imageUrl|sourcePageUrl|data:image|reference-only/u);
      expect(JSON.parse(body)).toMatchObject({ query: expect.stringContaining("dress"), includeOutOfStock: true });
    }
    expect(harness.images.fetchImage).toHaveBeenCalled();
    expect(harness.images.fetchImage.mock.calls.every(([request]) => request.url.startsWith(`${sourceOrigin}/v1/woocommerce/images?`))).toBe(true);
  });
  it("rejects candidate IDs from another Woo review session and makes completed sessions single-use", async () => {
    const harness = await connect();
    const first = await harness.begin();
    const second = await harness.begin();
    const mixed = await harness.client.callTool({ name: "finalize_visual_search", arguments: {
      visualSessionId: second.visualSessionId, verdicts: [{ candidateId: first.candidates[0]!.candidateId, verdict }] } });
    expect(mixed.isError).toBe(true);
    const final = await harness.finalize(second);
    expect(final.isError, JSON.stringify(final.content)).not.toBe(true);
    expect((final.structuredContent as ProductCardContent).products[0]).toMatchObject({ sourceKind: "WOOCOMMERCE_STORE_API", handle: "1001" });
    expect((await harness.finalize(second)).isError).toBe(true);
  });
  it("invalidates a visual verdict after Woo variant inspection while preserving the reviewed parent snapshot", async () => {
    const harness = await connect();
    const final = await harness.finalize(await harness.begin());
    expect(final.isError, JSON.stringify(final.content)).not.toBe(true);
    const old = final.structuredContent as ProductCardContent;
    expect(old.products[0]?.visualReviewAssessment).toBeDefined();
    const inspected = await harness.client.callTool({ name: "inspect_selected_product", arguments: { renderId: old.renderId,
      selectionId: old.products[0]!.selectionId, variantDimensions: { Size: "M" } } });
    expect(inspected.isError, JSON.stringify(inspected.content)).not.toBe(true);
    const next = (inspected.structuredContent as { updatedSnapshot: ProductCardContent }).updatedSnapshot;
    expect(next.products[0]).toMatchObject({ handle: "1002", visualReviewRequired: true });
    expect(next.products[0]!.visualReviewAssessment).toBeUndefined();
    expect(next.products[0]!.visualMatchGroup).toBeUndefined();
    expect(next.recommendation).toMatchObject({ state: "RESEARCH_ONLY",
      reasonCodes: expect.arrayContaining(["VISUAL_REVIEW_REQUIRED", "UNVERIFIED_MERCHANT"]) });
    expect(next.recommendation?.primarySelectionId).toBeUndefined();
    const oldAgain = await harness.client.callTool({ name: "render_product_cards", arguments: { renderId: old.renderId } });
    expect((oldAgain.structuredContent as ProductCardContent).products).toEqual(old.products);
  });
});
