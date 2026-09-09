import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createUnavailableAwinPort } from "../../../packages/awin-feed/src/index.js";
import { evaluateRecoveredProducts, parseStoredSearchRequest, SearchProductsInputSchema, searchProducts } from "../src/search-products.js";
import { mergeSearchRequirements } from "../src/search-requirements-context.js";
import type { ShopifyProduct } from "../src/shopify-client.js";
import type { ProductCardContent } from "../src/server.js";
import { createTaskStateStore } from "../src/task-state-store.js";
import { connectReplay, product, searchResult, REPLAY_NOW } from "./fixtures/conversation-replay-support.js";

// Product/variant paths reproduce the real Glossier counterexample. Responses
// are reduced fixtures, not current prices or independent GTIN ownership proof.
const url = "https://www.glossier.com/products/balm-dotcom?variant=46731565826293";
const original = product({ merchantId: "shopify-62791647477", merchant: "Glossier", sourceHost: "www.glossier.com",
  merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT", evidence: ["reviewed fixture"] },
  brand: "Glossier", handle: "46731565826293", title: "Balm Dotcom", productType: "lip balm", description: "Espresso lip balm",
  variantDimensions: { Flavor: "Espresso" }, itemPrice: { amountCents: 1600, currency: "USD" },
  merchantUrl: url, checkoutPlatform: "SHOPIFY" });
const bundles = [
  { title: "Balm Dotcom Trio", handle: "46731770429685", path: "balm-dotcom-trio", amountCents: 4200 },
  { title: "The Balm Dotcom Quintet", handle: "45782337126645", path: "balm-dotcom-quintet", amountCents: 6400 }
].map(value => ({ ...original, ...value, description: value.title, variantDimensions: {},
  itemPrice: { amountCents: value.amountCents, currency: "USD" as const },
  merchantUrl: `https://www.glossier.com/products/${value.path}?variant=${value.handle}` }));
const otherVariant = { ...original, handle: "46731565826294", merchantUrl: url.replace("46731565826293", "46731565826294") };
const input = () => SearchProductsInputSchema.parse({ query: url, brand: "Glossier", requiredFeatures: ["Espresso"],
  maxItemPriceCents: 7000, allowAlternatives: false });
const anchor = { url, gtins: [], brand: "Glossier", variantDimensions: { Flavor: "Espresso" } };
const stored = () => parseStoredSearchRequest({ ...input(), query: "Glossier Balm Dotcom", shopifyAnchor: anchor });
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });

function ports(catalog: ShopifyProduct[] = [original, ...bundles], target: ShopifyProduct = original) {
  return { awin: createUnavailableAwinPort(), shopify: { search: vi.fn(async () => searchResult(catalog)) },
    officialShopify: { search: vi.fn(async () => [target]) } };
}
async function replay(variants: ShopifyProduct[] = [original], catalog = [original, ...bundles]) {
  const dependencies = ports(catalog);
  const inspector = vi.fn(async () => ({ sourceVariantId: original.handle, merchant: original.merchant,
    sourceHost: original.sourceHost, productTitle: original.title, canonicalProductUrl: url.split("?")[0]!, variants }));
  const harness = await connectReplay(dependencies.shopify.search, { officialShopify: dependencies.officialShopify,
    selectedProducts: { inspect: inspector }, now: () => REPLAY_NOW });
  closers.push(harness.close);
  const first = await harness.client.callTool({ name: "search_products", arguments: input() });
  expect(first.isError, JSON.stringify(first.content)).not.toBe(true);
  return { ...harness, inspector, originalCards: first.structuredContent as ProductCardContent };
}

describe("source-proven Shopify URL identity", () => {
  it("retains the selected single product and excludes the real Trio/Quintet research-card counterexample", async () => {
    const result = await searchProducts(input(), ports());
    expect(result.candidates.map(candidate => candidate.shopifyProduct?.merchantUrl)).toEqual([url]);
    expect(result.resolvedRequest).toMatchObject({ shopifyAnchor: anchor, requiredFeatures: ["Espresso"], maxItemPriceCents: 7000 });
  });
  it("rejects another selected variant despite identical title and copied flavor", async () => {
    const result = await searchProducts(input(), ports([original, otherVariant]));
    expect(result.candidates.map(candidate => candidate.shopifyProduct?.handle)).toEqual([original.handle]);
  });
  it.each([false, true])("rejects a Shopify variant ID contradicting its copied URL even with alternatives=%s", async allowAlternatives => {
    const wrong = { ...original, handle: otherVariant.handle, itemPrice: { amountCents: 100, currency: "USD" as const } };
    const result = await searchProducts({ ...input(), allowAlternatives }, ports([original, wrong]));
    expect(result.candidates.map(candidate => candidate.shopifyProduct?.handle)).not.toContain(wrong.handle);
  });
  it.each(["GTIN", "MPN", "GTIN_WITH_DEFAULT_TITLE"] as const)("keeps cross-merchant %s identity without comparing merchant-local variant IDs", async kind => {
    const identity = kind === "MPN" ? { mpn: "BDC-ESPRESSO" } : { gtins: ["1234567890123"] };
    const source = { ...original, ...identity, variantDimensions: { ...original.variantDimensions,
      ...(kind === "GTIN_WITH_DEFAULT_TITLE" ? { Title: "Default Title" } : {}) } };
    const retailer = { ...source, merchantId: "different", merchant: "Reviewed Retailer", sourceHost: "retailer.example",
      handle: "other-local-id", merchantUrl: "https://retailer.example/products/balm-espresso?variant=99", variantDimensions: { Flavor: "Espresso" },
      merchantTrust: { level: "ESTABLISHED_RETAILER" as const, verification: "INDEPENDENT" as const, evidence: ["reviewed fixture"] } };
    const result = await searchProducts(input(), ports([source, retailer], source));
    expect(result.candidates.map(candidate => candidate.shopifyProduct?.sourceHost).sort()).toEqual(["retailer.example", "www.glossier.com"]);
  });
  it("does not turn same titles or reused local IDs into cross-merchant identity", async () => {
    const retailer = { ...original, merchantId: "different", merchant: "Reviewed Retailer", sourceHost: "retailer.example",
      merchantUrl: `https://retailer.example/products/balm-dotcom?variant=${original.handle}`,
      merchantTrust: { level: "ESTABLISHED_RETAILER" as const, verification: "INDEPENDENT" as const, evidence: ["reviewed fixture"] } };
    const result = await searchProducts(input(), ports([original, retailer]));
    expect(result.candidates.map(candidate => candidate.shopifyProduct?.sourceHost)).toEqual(["www.glossier.com"]);
  });
  it("does not let shared GTIN evidence override an explicit manufacturer model conflict", async () => {
    const source = { ...original, gtins: ["1234567890123"], mpn: "BDC-ESPRESSO" };
    const retailer = { ...source, mpn: "BDC-VANILLA", merchantId: "different", merchant: "Reviewed Retailer", sourceHost: "retailer.example",
      merchantUrl: "https://retailer.example/products/balm?variant=99",
      merchantTrust: { level: "ESTABLISHED_RETAILER" as const, verification: "INDEPENDENT" as const, evidence: ["reviewed fixture"] } };
    const result = await searchProducts(input(), ports([source, retailer], source));
    expect(result.candidates.map(candidate => candidate.shopifyProduct?.sourceHost)).toEqual(["www.glossier.com"]);
  });
  it("keeps URL identity through text continuation and rejects recovered same-merchant bundles", async () => {
    const previous = stored();
    const next = mergeSearchRequirements(SearchProductsInputSchema.parse({ query: url, contextMode: "CONTINUE_PREVIOUS_PRODUCT",
      maxItemPriceCents: 5000 }), previous);
    expect(next).toMatchObject({ query: "Glossier Balm Dotcom", shopifyAnchor: anchor, maxItemPriceCents: 5000 });
    const recovered = evaluateRecoveredProducts(next, [original, bundles[0]!].map(product => ({ ...product, sourceKind: "WEB_PRODUCT_PAGE" as const })), false);
    expect(recovered.candidates.map(candidate => candidate.shopifyProduct?.handle)).toEqual([original.handle]);
  });
  it.each(["NEW_PRODUCT", "CORRECT_PREVIOUS_PRODUCT"] as const)("releases previous identity only for %s", contextMode => {
    const previous = stored();
    const next = mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "Glossier Balm Dotcom", contextMode }), previous);
    expect((next as unknown as Record<string, unknown>).shopifyAnchor).toBeUndefined();
    if (contextMode === "CORRECT_PREVIOUS_PRODUCT") expect(next.maxItemPriceCents).toBe(7000);
    expect(previous).toMatchObject({ shopifyAnchor: anchor });
  });
  it("keeps old requests compatible without fabricating a source-proven anchor", () => {
    const previous = parseStoredSearchRequest({ query: "Glossier Balm Dotcom", requiredFeatures: ["Espresso"] });
    const next = mergeSearchRequirements(SearchProductsInputSchema.parse({ query: "Glossier Balm Dotcom", contextMode: "CONTINUE_PREVIOUS_PRODUCT" }), previous);
    expect((next as unknown as Record<string, unknown>).shopifyAnchor).toBeUndefined();
    expect(SearchProductsInputSchema.safeParse({ ...input(), shopifyAnchor: anchor }).success).toBe(false);
  });
});

describe("registered MCP URL selection and derived snapshots", () => {
  it("shows explicitly requested alternatives through continuation and inspection without claiming same-product identity", async () => {
    const alternate = { ...bundles[0]!, description: "Espresso lip balm trio", variantDimensions: { Flavor: "Espresso" } };
    const harness = await replay([alternate], [original, alternate]);
    const continued = await harness.client.callTool({ name: "search_products", arguments: { query: url,
      contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: harness.originalCards.renderId, allowAlternatives: true } });
    const cards = continued.structuredContent as ProductCardContent;
    const selected = cards.products.find(card => card.handle === alternate.handle);
    expect(selected).toMatchObject({ matchStatus: "SIMILAR", resultGroup: "ALTERNATIVE", requestIdentityStatus: "NEEDS_VERIFICATION",
      presentationGroup: "RESEARCH_ONLY" });
    const inspected = await harness.client.callTool({ name: "inspect_selected_product", arguments: { renderId: cards.renderId,
      selectionId: selected!.selectionId } });
    const next = (inspected.structuredContent as { updatedSnapshot: ProductCardContent }).updatedSnapshot;
    expect(next.products.find(card => card.handle === alternate.handle)).toMatchObject({ matchStatus: "SIMILAR", resultGroup: "ALTERNATIVE",
      requestIdentityStatus: "NEEDS_VERIFICATION", presentationGroup: "RESEARCH_ONLY" });
    expect(next.products.find(card => card.handle === original.handle)?.requestIdentityStatus).toBe("CONFIRMED");
    const exactAgain = await harness.client.callTool({ name: "search_products", arguments: { query: url,
      contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: next.renderId, clearConstraints: ["allowAlternatives"], allowAlternatives: false } });
    expect((exactAgain.structuredContent as ProductCardContent).products.map(card => card.handle)).toEqual([original.handle]);
  });
  it.each(["EXPLICIT_SAME_PARENT", "WRONG_PARENT", "UNREQUESTED_VARIANT"])("checks the globally confirmed selected retailer before %s inspection", async kind => {
    const source = { ...original, gtins: ["1234567890123"] };
    const retailer = { ...source, merchantId: "retailer", merchant: "Reviewed Retailer", sourceHost: "retailer.example", handle: "99",
      merchantUrl: "https://retailer.example/products/balm-dotcom?variant=99",
      merchantTrust: { level: "ESTABLISHED_RETAILER" as const, verification: "INDEPENDENT" as const, evidence: ["reviewed fixture"] } };
    const vanilla = { ...retailer, handle: "100", gtins: ["1234567890999"],
      merchantUrl: `https://retailer.example/products/${kind === "WRONG_PARENT" ? "balm-dotcom-trio" : "balm-dotcom"}?variant=100`,
      title: "Balm Dotcom — Vanilla", description: "Vanilla lip balm", variantDimensions: { Flavor: "Vanilla" } };
    const inspect = vi.fn(async () => ({ sourceVariantId: retailer.handle, merchant: retailer.merchant, sourceHost: retailer.sourceHost,
      productTitle: retailer.title, canonicalProductUrl: retailer.merchantUrl.split("?")[0]!, variants: [vanilla] }));
    const harness = await connectReplay(async () => searchResult([source, retailer, vanilla]), {
      officialShopify: { search: async () => [source] }, selectedProducts: { inspect }, now: () => REPLAY_NOW });
    closers.push(harness.close);
    const first = await harness.client.callTool({ name: "search_products", arguments: input() });
    const cards = first.structuredContent as ProductCardContent;
    const selected = cards.products.find(card => card.handle === retailer.handle)!;
    expect(selected.requestIdentityStatus).toBe("CONFIRMED");
    inspect.mockClear();
    const inspected = await harness.client.callTool({ name: "inspect_selected_product", arguments: { renderId: cards.renderId,
      selectionId: selected.selectionId, ...(kind === "UNREQUESTED_VARIANT" ? {} : { variantDimensions: { Flavor: "Vanilla" } }) } });
    expect(inspect).toHaveBeenCalledOnce();
    if (kind !== "EXPLICIT_SAME_PARENT") {
      expect(inspected.structuredContent).toMatchObject({ status: "NO_MATCHING_VARIANT", variants: [] });
      expect(inspected.structuredContent).not.toHaveProperty("updatedSnapshot");
      return;
    }
    const next = (inspected.structuredContent as { updatedSnapshot: ProductCardContent }).updatedSnapshot;
    expect(next.products).toHaveLength(1);
    expect(next.products[0]).toMatchObject({ handle: vanilla.handle, variantDimensions: { Flavor: "Vanilla" } });
    expect(next.requirementsSummary).toMatchObject({ requiredFeatures: ["Vanilla"], maxItemPriceCents: 7000 });
    expect(next.goalId).toBe(cards.goalId);
    const continued = await harness.client.callTool({ name: "search_products", arguments: { query: "Glossier Balm Dotcom",
      contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: next.renderId } });
    expect((continued.structuredContent as ProductCardContent).products.map(card => card.handle)).toEqual([vanilla.handle]);
  });
  it.each(["GTIN", "MPN"])("preserves cross-merchant %s evidence through final public card eligibility", async kind => {
    const source = { ...original, ...(kind === "GTIN" ? { gtins: ["1234567890123"] } : { mpn: "BDC-ESPRESSO" }) };
    const retailer = { ...source, merchantId: "different", merchant: "Reviewed Retailer", sourceHost: "retailer.example",
      handle: "other-local-id", merchantUrl: "https://retailer.example/products/balm-espresso?variant=99",
      merchantTrust: { level: "ESTABLISHED_RETAILER" as const, verification: "INDEPENDENT" as const, evidence: ["reviewed fixture"] } };
    const dependencies = ports([source, retailer], source);
    const harness = await connectReplay(dependencies.shopify.search, { officialShopify: dependencies.officialShopify });
    closers.push(harness.close);
    const response = await harness.client.callTool({ name: "search_products", arguments: input() });
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
    expect((response.structuredContent as ProductCardContent).products.map(product => product.sourceHost).sort())
      .toEqual(["retailer.example", "www.glossier.com"]);
  });
  it("rejects model-supplied identity anchors before reading any provider", async () => {
    const dependencies = ports();
    const harness = await connectReplay(dependencies.shopify.search, { officialShopify: dependencies.officialShopify });
    closers.push(harness.close);
    const response = await harness.client.callTool({ name: "search_products", arguments: { ...input(), shopifyAnchor: anchor } });
    expect(response.isError).toBe(true);
    expect(dependencies.shopify.search).not.toHaveBeenCalled();
    expect(dependencies.officialShopify.search).not.toHaveBeenCalled();
  });
  it("returns only the original target through search and inspection, preserving the original snapshot", async () => {
    const harness = await replay();
    const first = harness.originalCards;
    expect(first.products).toHaveLength(1);
    const inspected = await harness.client.callTool({ name: "inspect_selected_product", arguments: { renderId: first.renderId,
      selectionId: first.products[0]!.selectionId } });
    expect(inspected.isError, JSON.stringify(inspected.content)).not.toBe(true);
    const next = (inspected.structuredContent as { updatedSnapshot: ProductCardContent }).updatedSnapshot;
    expect(next.products).toHaveLength(1);
    expect(next.products[0]).toMatchObject({ handle: original.handle, itemPrice: original.itemPrice, variantDimensions: { Flavor: "Espresso" } });
    expect(next.goalId).toBe(first.goalId);
    expect(next.goalRevision).toBe(2);
    const old = await harness.client.callTool({ name: "render_product_cards", arguments: { renderId: first.renderId } });
    expect(old.structuredContent).toEqual(first);
  });
  it.each(["OTHER_PRODUCT", "OTHER_VARIANT"])("does not create selectable cards for an inspector's %s response", async kind => {
    const wrong = kind === "OTHER_PRODUCT" ? { ...bundles[0]!, variantDimensions: { Flavor: "Espresso" } } : otherVariant;
    const harness = await replay([wrong], [original]);
    const first = harness.originalCards;
    const inspected = await harness.client.callTool({ name: "inspect_selected_product", arguments: { renderId: first.renderId,
      selectionId: first.products[0]!.selectionId } });
    const result = inspected.structuredContent as { variants?: unknown[]; updatedSnapshot?: ProductCardContent } | undefined;
    expect(result?.variants ?? []).toEqual([]);
    expect(result?.updatedSnapshot).toBeUndefined();
    expect(harness.inspector).toHaveBeenCalledOnce();
  });
  it("updates a variant only from explicit options verified on the same original product, retaining budget", async () => {
    const vanilla = { ...otherVariant, title: "Balm Dotcom — Vanilla", description: "Vanilla lip balm", variantDimensions: { Flavor: "Vanilla" } };
    const harness = await replay([vanilla], [original, vanilla]);
    const first = harness.originalCards;
    const inspected = await harness.client.callTool({ name: "inspect_selected_product", arguments: { renderId: first.renderId,
      selectionId: first.products[0]!.selectionId, variantDimensions: { Flavor: "Vanilla" } } });
    const next = (inspected.structuredContent as { updatedSnapshot: ProductCardContent }).updatedSnapshot;
    expect(next.products).toHaveLength(1);
    expect(next.products[0]).toMatchObject({ handle: vanilla.handle, variantDimensions: { Flavor: "Vanilla" } });
    expect(next.requirementsSummary).toMatchObject({ requiredFeatures: ["Vanilla"], maxItemPriceCents: 7000 });
    expect(next.goalId).toBe(first.goalId);
    expect(next.goalRevision).toBe(2);
    const continued = await harness.client.callTool({ name: "search_products", arguments: { query: "Glossier Balm Dotcom",
      contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: next.renderId } });
    expect((continued.structuredContent as ProductCardContent).products.map(product => product.handle)).toEqual([vanilla.handle]);
    const old = await harness.client.callTool({ name: "render_product_cards", arguments: { renderId: first.renderId } });
    expect(old.structuredContent).toEqual(first);
  });
  it("cannot use explicit options to move inspection to another same-name product", async () => {
    const wrong = { ...bundles[0]!, description: "Vanilla lip balm", variantDimensions: { Flavor: "Vanilla" } };
    const harness = await replay([wrong], [original]);
    const inspected = await harness.client.callTool({ name: "inspect_selected_product", arguments: { renderId: harness.originalCards.renderId,
      selectionId: harness.originalCards.products[0]!.selectionId, variantDimensions: { Flavor: "Vanilla" } } });
    expect(inspected.structuredContent).toMatchObject({ status: "NO_MATCHING_VARIANT", variants: [] });
    expect(inspected.structuredContent).not.toHaveProperty("updatedSnapshot");
  });
  it.each([false, true])("hydrates source-owned requests across server recreation (legacyWithoutAnchor=%s)", async legacy => {
    const state = createTaskStateStore(":memory:");
    const threadId = randomUUID();
    const dependencies = ports();
    const first = await connectReplay(dependencies.shopify.search, { taskState: state,
      officialShopify: dependencies.officialShopify }, undefined, "codex-mcp-client");
    let initial: ProductCardContent;
    try {
      const response = await first.client.callTool({ name: "search_products", arguments: input(), _meta: { threadId } });
      initial = response.structuredContent as ProductCardContent;
      expect(initial.products).toHaveLength(1);
    } finally { await first.close(); }
    if (legacy) {
      const saved = state.load(threadId);
      const snapshots = saved.data.renderSnapshots as Array<[string, { request: Record<string, unknown> }]>;
      for (const [, snapshot] of snapshots) delete snapshot.request.shopifyAnchor;
      state.save(threadId, saved.revision, saved.data);
    }
    const next = await connectReplay(dependencies.shopify.search, { taskState: state,
      officialShopify: dependencies.officialShopify }, undefined, "codex-mcp-client");
    try {
      const old = await next.client.callTool({ name: "render_product_cards", arguments: { renderId: initial!.renderId }, _meta: { threadId } });
      expect(old.isError, JSON.stringify(old.content)).not.toBe(true);
      expect((old.structuredContent as ProductCardContent).products).toEqual(initial!.products);
      const saved = state.load(threadId);
      const snapshots = saved.data.renderSnapshots as Array<[string, { request: Record<string, unknown> }]>;
      expect(snapshots[0]![1].request.shopifyAnchor).toEqual(legacy ? undefined : anchor);
    } finally { await next.close(); state.close(); }
  });
});
