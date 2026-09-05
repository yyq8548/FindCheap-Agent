import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShopifyPort } from "../src/server.js";
import type { VerifiedDeal } from "../src/deal-client.js";
import { CONVERSATION_REPLAY_CASES as cases } from "./fixtures/conversation-01a06df9.js";
import { connectReplay, product, REPLAY_NOW, searchResult } from "./fixtures/conversation-replay-support.js";

// Executes real MCP handlers with recorded tool inputs, NOT a natural-language model.
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function recordedCall(id: string) {
  const call = cases.find((item) => item.id === id)?.toolCall;
  if (!call) throw new Error(`No recorded tool call for ${id}`);
  return structuredClone(call);
}

type Snapshot = {
  renderId: string;
  locale: string;
  products: Array<{ selectionId: string; title: string; handle: string; quoteCapability: string }>;
};

async function openWigs(deals: VerifiedDeal[] = []) {
  const shampoo = product({ handle: "fixture-shampoo", title: "B24 pH Maintenance Shampoo", productType: "shampoo", brand: "B24" });
  const search = vi.fn<ShopifyPort["search"]>(async (input) => searchResult(input.query === "shampoo" ? [shampoo] : [
    product(), product({
      merchantId: "hairsofly", merchant: "HAIRSOFLY SHOP", sourceHost: "hairsoflyshop.com", handle: "fixture-long-wig",
      title: "Long synthetic hair wig", brand: "Sensationnel", itemPrice: { amountCents: 4_399, currency: "USD" },
      merchantUrl: "https://hairsoflyshop.com/products/fixture-long-wig"
    })
  ]));
  const couponSearch = vi.fn(async () => deals);
  const quote = vi.fn();
  const connection = await connectReplay(search, { deals: { search: couponSearch }, cartQuotes: { quote } });
  closers.push(connection.close);
  const result = await connection.client.callTool(recordedCall("wig-search"));
  expect(result.isError).not.toBe(true);
  const snapshot = result.structuredContent as Snapshot;
  expect(snapshot.products).toHaveLength(2);
  return { ...connection, search, couponSearch, quote, snapshot };
}

describe("conversation 01a06df9: original Chinese prompts -> MCP workflow regression", () => {
  it("retains all eight original prompts and three image references, without depending on Temp files", () => {
    expect(cases.map(({ prompt }) => prompt)).toEqual([
      "我要买假发", "第一款到手价多少", "优惠卷是什么", "可以比较我选择的两款吗",
      "我要买洗发水", "我要买这件DOEN的裙子", "skims", "DOEN"
    ]);
    expect(cases.filter(({ attachmentBasename }) => attachmentBasename)).toHaveLength(3);
    expect(cases.find(({ id }) => id === "wig-delivered-price")).toMatchObject({ recordedToolStatus: "NO_TOOL_CALL" });
    expect(cases.find(({ id }) => id === "doen-black-dress")).toMatchObject({ recordedToolStatus: "failed" });
  });

  it("我要买假发 — preserves wig routing and Chinese card output", async () => {
    const { client, search, snapshot } = await openWigs();
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: "wig" }));
    expect(snapshot).toMatchObject({ locale: "zh-CN" });
    expect(snapshot.products.map(({ title }) => title)).toEqual(["Short human hair wig", "Long synthetic hair wig"]);
    const resources = await client.listResources();
    expect(resources.resources.length).toBeGreaterThan(0);
  });

  it("第一款到手价多少 — unknown delivery stays unknown; no guessed ZIP or new title search", async () => {
    const { client, search, quote, snapshot } = await openWigs();
    const first = snapshot.products[0]!;
    expect(first.quoteCapability).toBe("MERCHANT_CHECKOUT_ONLY");
    const calls = search.mock.calls.length;
    // Negative API probe, not a fabricated user turn: no ZIP was supplied in the conversation.
    const missingZip = await client.callTool({ name: "quote_selected_shopify_product", arguments: {
      renderId: snapshot.renderId, selectionId: first.selectionId
    } });
    expect(missingZip.isError).toBe(true);
    expect(quote).not.toHaveBeenCalled();
    // Even with a synthetic ZIP, this merchant's unsupported capability cannot become a zero-shipping quote.
    const unsupported = await client.callTool({ name: "quote_selected_shopify_product", arguments: {
      renderId: snapshot.renderId, selectionId: first.selectionId, zipCode: "10001"
    } });
    expect(unsupported.isError).not.toBe(true);
    expect(JSON.stringify(unsupported.content)).toContain("MERCHANT_CHECKOUT_ONLY");
    const retained = (unsupported.structuredContent as { products: Array<{ handle: string }> }).products.find(({ handle }) => handle === first.handle);
    expect(retained).toMatchObject({ handle: first.handle, pricing: { deliveredPrice: { status: "UNAVAILABLE" } } });
    expect(retained).not.toHaveProperty("pricing.deliveredPrice.amount");
    expect(quote).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledTimes(calls);
  });

  it("优惠卷是什么 — keeps merchant-wide coupons conditional and tied to the first saved product", async () => {
    const coupon: VerifiedDeal = {
      dealId: "fixture-is18", merchant: "Ishow Hair", kind: "PROMO_CODE", code: "IS18",
      title: "18% off sitewide", description: "18% off all orders", discountPercent: 18,
      productApplicability: "MERCHANT_WIDE", eligibility: [], channels: ["ONLINE"],
      sourceUrl: "https://ishowbeauty.com/pages/fixture-coupons", checkedAt: REPLAY_NOW.toISOString(),
      validFrom: "2026-09-04T00:00:00.000Z", validTo: "2026-09-05T00:00:00.000Z", verificationStatus: "VERIFIED"
    };
    const { client, search, couponSearch, snapshot } = await openWigs([coupon]);
    const calls = search.mock.calls.length;
    const call = recordedCall("wig-coupons");
    // Bind runtime IDs from THIS test, never reuse the historic conversation UUID.
    call.arguments.renderId = snapshot.renderId;
    const result = await client.callTool(call);
    expect(result.isError).not.toBe(true);
    expect(couponSearch).toHaveBeenLastCalledWith(expect.objectContaining({ merchant: "Ishow Hair", productQuery: "Short human hair wig" }));
    expect(result.structuredContent).toMatchObject({
      currentPrice: { basis: "ITEM_PRICE", amount: { amountCents: 3_641 } },
      dealSummary: { status: "MERCHANT_CANDIDATE", recommendedDealId: coupon.dealId },
      deals: [{ code: "IS18", applicability: "REQUIRES_MERCHANT_CONFIRMATION" }]
    });
    expect(search).toHaveBeenCalledTimes(calls);
  });

  it("可以比较我选择的两款吗 — uses UI selection and immutable references without claiming unlike-item savings", async () => {
    const { client, search, snapshot } = await openWigs();
    const selectionIds = snapshot.products.map(({ selectionId }) => selectionId);
    const selection = await client.callTool({ name: "sync_product_card_selection", arguments: {
      renderId: snapshot.renderId, selectionIds, revision: 1
    } });
    expect(selection.structuredContent).toEqual({ status: "RECORDED", selectedCount: 2 });
    const call = recordedCall("wig-comparison");
    call.arguments.renderId = snapshot.renderId;
    const calls = search.mock.calls.length;
    const compared = await client.callTool(call);
    expect(compared.isError).not.toBe(true);
    expect(compared.structuredContent).toMatchObject({
      renderId: snapshot.renderId, locale: "zh-CN", mode: "PRODUCT_CHOICES", priceBasis: "ITEM_PRICE",
      priceComparability: "NOT_LIKE_FOR_LIKE",
      entries: selectionIds.map((selectionId) => ({ selectionId, deliveredTotalStatus: "MERCHANT_CHECKOUT_ONLY" }))
    });
    expect(compared.structuredContent).not.toHaveProperty("priceDelta");
    expect(search).toHaveBeenCalledTimes(calls);
    await client.callTool(recordedCall("shampoo-search"));
    const callsAfterShampoo = search.mock.calls.length;
    const oldComparison = await client.callTool(call);
    expect(oldComparison.structuredContent).toMatchObject({ renderId: snapshot.renderId, entries: selectionIds.map((selectionId) => ({ selectionId })) });
    expect(search).toHaveBeenCalledTimes(callsAfterShampoo);
  });

  it("我要买洗发水 — starts a new product snapshot without carrying over wig results", async () => {
    const { client, search, snapshot } = await openWigs();
    const result = await client.callTool(recordedCall("shampoo-search"));
    expect(result.isError).not.toBe(true);
    const next = result.structuredContent as Snapshot;
    expect(next.renderId).not.toBe(snapshot.renderId);
    expect(next).toMatchObject({ locale: "zh-CN", products: [{ handle: "fixture-shampoo" }] });
    expect(next.products).toHaveLength(1);
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ query: "shampoo" }));
    expect(next.products[0]!.selectionId).not.toBe(snapshot.products[0]!.selectionId);
  });
});
