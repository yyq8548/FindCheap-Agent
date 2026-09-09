import { afterEach, describe, expect, it, vi } from "vitest";
import { matchesSelectedShopifyInspection } from "../src/shopify-product-anchor.js";
import type { ShopifyProduct } from "../src/shopify-client.js";
import type { ProductCardContent } from "../src/server.js";
import { connectReplay, product, searchResult, REPLAY_NOW } from "./fixtures/conversation-replay-support.js";

// Exact product, option and tracking-key shape from the R3 native failure;
// the attribution value is redacted and no live request is made by these tests.
const url = "https://www.glossier.com/products/balm-dotcom?variant=46731565826293";
const tracking = "&_gsid=redacted&utm_source=shopify&utm_medium=catalog";
const original = product({ merchantId: "shopify-62791647477", merchant: "Glossier", sourceHost: "www.glossier.com",
  merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT", evidence: ["reviewed fixture"] },
  brand: "Glossier", handle: "46731565826293", title: "Balm Dotcom", productType: "lip balm",
  description: "Espresso nourishing lip balm", variantDimensions: { Flavor: "Espresso" },
  itemPrice: { amountCents: 1600, currency: "USD" }, merchantUrl: url, checkoutPlatform: "SHOPIFY" });
const tracked = { ...original, merchantUrl: url + tracking };
const vanilla = { ...original, handle: "46731565826294", title: "Balm Dotcom Vanilla", description: "Vanilla nourishing lip balm",
  merchantUrl: url.replace(original.handle, "46731565826294") + tracking, variantDimensions: { Flavor: "Vanilla" } };
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });

describe("selected Shopify tracking and identity", () => {
  it.each([tracking, "&srsltid=redacted&gclid=redacted&fbclid=redacted",
    "&utm_campaign=test&utm_term=test&utm_content=test&utm_id=test"])("ignores only known attribution keys on both identity views: %s", suffix => {
    const value = { ...original, merchantUrl: url + suffix };
    expect(matchesSelectedShopifyInspection(value, {}, value)).toBe(true);
    expect(value.merchantUrl).toBe(url + suffix);
  });

  it.each(["selling_plan=42", "currency=CAD", "quantity=2", "utm_variant=46731565826294"])(
    "does not erase semantic or unrecognized query %s on either side", query => {
      const withQuery = { ...original, merchantUrl: `${url}&${query}` };
      expect(matchesSelectedShopifyInspection(withQuery, {}, original)).toBe(false);
      expect(matchesSelectedShopifyInspection(original, {}, withQuery)).toBe(false);
    });

  it.each(["DUPLICATE_VARIANT", "CONFLICTING_VARIANT", "OTHER_PARENT", "OTHER_HOST", "SOURCE_HOST_CONFLICT"])(
    "does not relax %s when tracking is present", kind => {
      const wrong = { ...tracked,
        ...(kind === "DUPLICATE_VARIANT" ? { merchantUrl: tracked.merchantUrl + `&variant=${original.handle}` } : {}),
        ...(kind === "CONFLICTING_VARIANT" ? { merchantUrl: tracked.merchantUrl.replace(original.handle, vanilla.handle) } : {}),
        ...(kind === "OTHER_PARENT" ? { merchantUrl: tracked.merchantUrl.replace("balm-dotcom?", "balm-dotcom-trio?") } : {}),
        ...(kind === "OTHER_HOST" ? { merchantUrl: tracked.merchantUrl.replace("www.glossier.com", "other.example"), sourceHost: "other.example" } : {}),
        ...(kind === "SOURCE_HOST_CONFLICT" ? { sourceHost: "other.example" } : {}) };
      expect(matchesSelectedShopifyInspection(tracked, {}, wrong)).toBe(false);
    });

  it("keeps the selected variant without explicit options and allows only verified requested options", () => {
    expect(matchesSelectedShopifyInspection(tracked, {}, vanilla)).toBe(false);
    expect(matchesSelectedShopifyInspection(tracked, { Flavor: "Vanilla" }, vanilla)).toBe(true);
    expect(matchesSelectedShopifyInspection(tracked, { Flavor: "Vanilla" }, { ...vanilla, variantDimensions: {} })).toBe(false);
  });

  it("returns false for invalid local anchor metadata instead of throwing a source-read schema error", () => {
    expect(matchesSelectedShopifyInspection({ ...tracked, gtins: ["invalid"] }, {}, original)).toBe(false);
    expect(matchesSelectedShopifyInspection(tracked, {}, { ...original, gtins: ["invalid"] })).toBe(false);
  });
});

describe("registered MCP tracked selection", () => {
  async function replay(returned: ShopifyProduct, failSource = false) {
    const inspect = vi.fn(async () => {
      if (failSource) throw new SyntaxError("invalid source JSON fixture");
      return { productTitle: original.title, canonicalProductUrl: url.split("?")[0]!, variants: [returned] };
    });
    const harness = await connectReplay(async () => searchResult([tracked]), {
      officialShopify: { search: async () => [original] }, selectedProducts: { inspect }, now: () => REPLAY_NOW });
    closers.push(harness.close);
    const response = await harness.client.callTool({ name: "search_products", arguments: { query: url, brand: "Glossier",
      brandMode: "REQUIRED", productType: "lip balm", requiredFeatures: ["Espresso"], contextMode: "NEW_PRODUCT",
      maxItemPriceCents: 7000, allowAlternatives: false, responseLocale: "zh-CN" } });
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
    const cards = response.structuredContent as ProductCardContent;
    expect(cards.products).toHaveLength(1);
    expect(cards.products[0]!.merchantUrl).toContain("_gsid=redacted");
    const argumentsForInspection = { renderId: cards.renderId, selectionId: cards.products[0]!.selectionId,
      variantId: original.handle, responseLocale: "zh-CN" };
    return { ...harness, cards, inspect, argumentsForInspection };
  }

  it.each(["SAME_VARIANT", "EXPLICIT_VARIANT"])("inspects %s while retaining exact binding and the original snapshot", async kind => {
    const returned = kind === "SAME_VARIANT" ? original : vanilla;
    const harness = await replay(returned);
    const result = await harness.client.callTool({ name: "inspect_selected_product", arguments: {
      ...harness.argumentsForInspection, ...(kind === "EXPLICIT_VARIANT" ? { variantDimensions: { Flavor: "Vanilla" } } : {}) } });
    expect(harness.inspect).toHaveBeenCalledOnce();
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    const updated = (result.structuredContent as { updatedSnapshot: ProductCardContent }).updatedSnapshot;
    expect(updated.products).toHaveLength(1);
    expect(updated.products[0]).toMatchObject({ handle: returned.handle, variantDimensions: returned.variantDimensions,
      itemPrice: { amountCents: 1600, currency: "USD" } });
    expect(updated.requirementsSummary).toMatchObject({ requiredFeatures: [kind === "SAME_VARIANT" ? "Espresso" : "Vanilla"], maxItemPriceCents: 7000 });
    const old = await harness.client.callTool({ name: "render_product_cards", arguments: { renderId: harness.cards.renderId } });
    expect(old.structuredContent).toEqual(harness.cards);
  });

  it("refuses an observed subscription selection without reporting a source-read failure", async () => {
    const harness = await replay({ ...original, merchantUrl: url + "&selling_plan=42" });
    const result = await harness.client.callTool({ name: "inspect_selected_product", arguments: harness.argumentsForInspection });
    expect(result.structuredContent).toMatchObject({ status: "NO_MATCHING_VARIANT", variants: [] });
    expect(result.structuredContent).not.toHaveProperty("updatedSnapshot");
    expect(result._meta).not.toHaveProperty("findcheap/inspectionFailure");
  });

  it("does not reuse the old price when a valid tracked inspection has no verified price", async () => {
    const { itemPrice: _oldPrice, ...withoutPrice } = tracked;
    const harness = await replay(withoutPrice);
    const result = await harness.client.callTool({ name: "inspect_selected_product", arguments: harness.argumentsForInspection });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    const updated = (result.structuredContent as { updatedSnapshot: ProductCardContent }).updatedSnapshot;
    expect(updated.products).toEqual([]);
  });

  it("keeps actual provider schema errors classified as SOURCE_READ", async () => {
    const harness = await replay(original, true);
    const result = await harness.client.callTool({ name: "inspect_selected_product", arguments: harness.argumentsForInspection });
    expect(result.isError).toBe(true);
    expect(result._meta).toMatchObject({ "findcheap/inspectionFailure": { reason: "SCHEMA_INVALID", phase: "SOURCE_READ" } });
  });
});
