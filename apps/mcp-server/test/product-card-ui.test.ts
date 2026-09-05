import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  PRODUCT_CARD_HTML,
  PRODUCT_CARD_UI_URI,
  productCardResourceDomains
} from "../src/product-card-ui.js";

class FakeNode {
  children: FakeNode[] = [];
  className = "";
  textContent = "";
  loading = "";
  fetchPriority = "";
  disabled = false;
  type = "";
  value = "";
  inputMode = "";
  maxLength = 0;
  placeholder = "";
  ariaPressed = "false";
  private readonly listeners = new Map<string, () => void>();
  constructor(readonly tagName = "DIV") {}

  append(...nodes: FakeNode[]) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: FakeNode[]) {
    this.children = nodes;
  }

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }

  dispatch(type: string) {
    this.listeners.get(type)?.();
  }
  remove() {}
}

function text(node: FakeNode): string {
  return [node.textContent, ...node.children.map(text)].join(" ");
}

function nodes(node: FakeNode): FakeNode[] {
  return [node, ...node.children.flatMap(nodes)];
}

function renderFixture(output: Record<string, unknown>): FakeNode {
  const app = new FakeNode("MAIN");
  const window = {
    parent: { postMessage: () => undefined }, openai: { toolOutput: output },
    addEventListener: () => undefined, setTimeout: () => 1, clearTimeout: () => undefined,
    requestAnimationFrame: (callback: () => void) => { callback(); return 1; }
  };
  const document = {
    getElementById: () => app, createElement: (tag: string) => new FakeNode(tag.toUpperCase()),
    documentElement: { dataset: {}, scrollWidth: 700, scrollHeight: 320 },
    body: { scrollWidth: 700, scrollHeight: 320 }
  };
  vm.runInNewContext(PRODUCT_CARD_HTML.match(/<script>([\s\S]*)<\/script>/u)![1]!, {
    window, document, URL, Intl, Number, String, Array, Object, Promise, Map, Set, Math, Date
  });
  return app;
}

function couponFixture(coupons: Record<string, unknown>) {
  return {
    locale: "zh-CN", products: [{
      selectionId: "fixture", title: "示例商品", merchant: "商家", matchStatus: "EXACT",
      condition: "NEW", availability: "IN_STOCK", presentationGroup: "OFFICIAL_STORE",
      recommendationTier: "TRUSTED_OR_AFFILIATE", merchantUrl: "https://merchant.example/product",
      purchaseLink: { kind: "APPROVED_AFFILIATE", url: "https://affiliate.example/click" }, coupons,
      card: { title: "示例商品", merchant: "商家", primaryPrice: { amountCents: 4000, currency: "USD" } }
    }]
  };
}

describe("product-card MCP Apps UI", () => {
  it("unwraps an updated snapshot and shows inherited requirements without HTML interpretation", () => {
    const fixture = couponFixture({ verified: [] });
    const app = renderFixture({ updatedSnapshot: { ...fixture,
      requirementsSummary: { requiredSize: "US 7", maxItemPriceCents: 5000, requiredFeatures: ["long hair", "<script>bad()</script>"], excludedFeatures: [] },
      retrieval: { extent: "BOUNDED" } } });
    expect(text(app)).toContain("当前要求："); expect(text(app)).toContain("US 7");
    expect(text(app)).toContain("长发"); expect(text(app)).toContain("US$50.00");
    expect(text(app)).toContain("未覆盖完整目录");
    expect(nodes(app).some(node => node.tagName === "SCRIPT")).toBe(false);
  });

  it.each([
    ["zh-CN", "同色尺码库存尚未确认。", "同色可售尺码："],
    ["en-US", "Size availability for this color has not been confirmed.", "Available sizes in this color:"]
  ])("does not promote stale size metadata when availability is unknown in %s", (locale, expected, forbidden) => {
    const output = couponFixture({ verified: [] });
    Object.assign(output.products[0]!, { availabilityScope: "PRODUCT_COLOR", availability: "UNKNOWN", availableSizes: ["S", "M"] });
    const app = renderFixture({ ...output, locale });
    expect(text(app)).toContain(expected);
    expect(text(app)).not.toContain(forbidden);
  });
  it.each([
    ["zh-CN", "同色可售尺码：S、M", "报价对应规格：Size: S"],
    ["en-US", "Available sizes in this color: S, M", "Price shown for variant: Size: S"]
  ])("shows colorway size availability in %s without creating size controls", (locale, expected, variantLabel) => {
    const output = couponFixture({ verified: [] });
    Object.assign(output.products[0]!, { availabilityScope: "PRODUCT_COLOR", availableSizes: ["S", "M"], variantDimensions: { Size: "S" } });
    const app = renderFixture({ ...output, locale });
    expect(text(app)).toContain(expected);
    expect(text(app)).toContain(variantLabel);
    expect(nodes(app).some((node) => node.tagName === "SELECT")).toBe(false);
    expect(nodes(app).filter((node) => node.tagName === "BUTTON").some((node) => ["S", "M"].includes(node.textContent))).toBe(false);
  });

  it.each([
    ["zh-CN", "当前选规格库存：缺货", "不代表其他尺码或颜色的库存。"],
    ["en-US", "Selected variant stock: Out of stock", "This does not describe other sizes or colors."]
  ])("scopes an out-of-stock badge to the selected variant in %s", (locale, expected, limitation) => {
    const output = couponFixture({ verified: [] });
    Object.assign(output.products[0]!, { availabilityScope: "SELECTED_VARIANT", availability: "OUT_OF_STOCK", availableSizes: ["M"], variantDimensions: { Size: "XXS" } });
    const app = renderFixture({ ...output, locale });
    expect(text(app)).toContain(expected);
    expect(text(app)).toContain(limitation);
    expect(nodes(app).some((node) => node.className === "badge" && ["缺货", "Out of stock"].includes(node.textContent))).toBe(false);
  });

  it.each([
    ["zh-CN", "当前同色暂无已确认可售尺码。"],
    ["en-US", "No saleable sizes are currently confirmed for this color."]
  ])("keeps an empty confirmed size list explicit in %s", (locale, expected) => {
    const output = couponFixture({ verified: [] });
    Object.assign(output.products[0]!, { availabilityScope: "PRODUCT_COLOR", availableSizes: [] });
    expect(text(renderFixture({ ...output, locale }))).toContain(expected);
  });

  it("renders untrusted available-size values as text, not markup", () => {
    const output = couponFixture({ verified: [] });
    Object.assign(output.products[0]!, { availabilityScope: "PRODUCT_COLOR", availableSizes: ["<img src=x onerror=alert(1)>", "M"] });
    const app = renderFixture(output);
    expect(text(app)).toContain("<img src=x onerror=alert(1)>");
    expect(nodes(app).some((node) => node.tagName === "IMG")).toBe(false);
  });
  it("uses the server Coupon summary and folds other merchant offers without confirming product eligibility", () => {
    const app = renderFixture(couponFixture({
      lookupStatus: "COMPLETE", summary: { status: "MERCHANT_CANDIDATE", recommendedDealId: "recommended", reasonCodes: [] },
      verified: [
        { dealId: "wholesale", code: "WHOLESALE30", productApplicability: "MERCHANT_WIDE", assessment: { status: "INELIGIBLE", reasonCodes: ["MINIMUM_SPEND_NOT_MET"], recommendationEligible: false } },
        { dealId: "recommended", code: "TRY18", productApplicability: "MERCHANT_WIDE", assessment: { status: "CONDITIONAL", reasonCodes: ["MERCHANT_ELIGIBILITY_UNCONFIRMED"], recommendationEligible: true } },
        { dealId: "other", code: "<img src=x onerror=alert(1)>", productApplicability: "MERCHANT_WIDE" }
      ]
    }));
    expect(nodes(app).find((node) => node.className === "badge" && node.textContent.includes("TRY18"))).toBeDefined();
    const couponSection = nodes(app).find((node) => node.className === "coupon-summary");
    expect(couponSection).toBeDefined();
    expect(text(couponSection!)).toContain("Findcheap 找到了可用的coupon");
    expect(text(couponSection!)).toContain("此商品适用性未确认");
    expect(text(couponSection!)).toContain("商家适用条件未确认");
    const folded = nodes(couponSection!).find((node) => node.tagName === "DETAILS");
    expect(folded).toBeDefined();
    expect(text(folded!)).toContain("WHOLESALE30");
    expect(text(folded!)).toContain("不适用于此商品");
    expect(nodes(app).some((node) => node.tagName === "IMG")).toBe(false);
    expect(text(app)).not.toContain("已验证优惠：TRY18");
  });

  it("does not call a failed Coupon lookup empty or available", () => {
    const app = renderFixture(couponFixture({ lookupStatus: "UNAVAILABLE", verified: [] }));
    expect(text(app)).toContain("优惠查询暂不可用");
    expect(text(app)).not.toContain("Findcheap 找到了可用的coupon");
    expect(text(app)).not.toContain("暂无优惠");
  });

  it("keeps partial Coupon coverage distinct from a completed search", () => {
    const app = renderFixture(couponFixture({ lookupStatus: "PARTIAL", verified: [{ id: "one", code: "SAVE10", productApplicability: "MERCHANT_WIDE" }] }));
    expect(text(app)).toContain("优惠查询仅部分完成");
    expect(text(app)).toContain("此商品适用性未确认");
  });

  it("does not invent a best Coupon or discounted price when the server has no eligible recommendation", () => {
    const app = renderFixture(couponFixture({
      lookupStatus: "COMPLETE", summary: { status: "NO_ELIGIBLE_DEAL", reasonCodes: ["MINIMUM_SPEND_NOT_MET"] },
      verified: [{ dealId: "minimum", code: "SAVE50", productApplicability: "PRODUCT_CONFIRMED",
        assessment: { status: "INELIGIBLE", reasonCodes: ["MINIMUM_SPEND_NOT_MET"], recommendationEligible: false } }],
      estimatedItemPriceAfterCoupon: { amountCents: 100, currency: "USD" }
    }));
    expect(text(app)).toContain("暂无已确认适用于此商品的优惠");
    expect(text(app)).toContain("不适用于此商品");
    expect(text(app)).not.toContain("Findcheap 找到了可用的coupon");
    expect(text(app)).not.toContain("已验证优惠：SAVE50");
    expect(text(app)).not.toContain("使用优惠后预计");
  });

  it("localizes the Coupon summary in English without promoting merchant-wide evidence", () => {
    const output = couponFixture({ lookupStatus: "PARTIAL", verified: [{ code: "TRY18", productApplicability: "MERCHANT_WIDE" }] });
    const app = renderFixture({ ...output, locale: "en-US" });
    expect(text(app)).toContain("Coupon lookup only partially completed");
    expect(text(app)).toContain("FindCheap found an available coupon.");
    expect(text(app)).toContain("Not confirmed for this product");
    expect(text(app)).not.toContain("Confirmed for this product");
    expect(text(app)).not.toContain("优惠查询");
  });

  it("shows comparison decision conditions and limitations in the native card comparison", () => {
    const app = renderFixture({
      status: "OK", locale: "zh-CN", message: "比较", recommendation: {
        state: "READY", recommendedSelectionId: "a", conditions: ["如果你更看重短发款式"],
        limitations: ["不同材质，不能只凭商品价判断体验"]
      },
      entries: [{ selectionId: "a", title: "短假发", merchant: "A" }, { selectionId: "b", title: "长假发", merchant: "B" }]
    });
    expect(text(app)).toContain("推荐条件");
    expect(text(app)).toContain("如果你更看重短发款式");
    expect(text(app)).toContain("比较限制");
    expect(text(app)).toContain("不同材质，不能只凭商品价判断体验");
  });

  it("retains deal lookup and assessment metadata in the inline comparison", () => {
    const app = renderFixture({
      status: "OK", locale: "zh-CN", message: "比较",
      entries: [
        { selectionId: "a", title: "A", merchant: "A", dealLookupStatus: "UNAVAILABLE", verifiedDeals: [] },
        { selectionId: "b", title: "B", merchant: "B", dealLookupStatus: "COMPLETE",
          dealSummary: { status: "NO_ELIGIBLE_DEAL", reasonCodes: ["MINIMUM_SPEND_NOT_MET"] },
          verifiedDeals: [{ dealId: "excluded", code: "SAVE50", productApplicability: "MERCHANT_WIDE",
            assessment: { status: "INELIGIBLE", reasonCodes: ["MINIMUM_SPEND_NOT_MET"], recommendationEligible: false } }] }
      ]
    });
    expect(text(app)).toContain("优惠查询暂不可用");
    expect(text(app)).toContain("暂无已确认适用于此商品的优惠");
    const folded = nodes(app).find((node) => node.tagName === "DETAILS");
    expect(folded).toBeDefined();
    expect(text(folded!)).toContain("SAVE50");
    expect(text(folded!)).toContain("不适用于此商品");
  });

  it("uses an embedded Codex-native surface with responsive cards", () => {
    expect(PRODUCT_CARD_UI_URI).toBe("ui://findcheap/product-cards/v34.html");
    expect(PRODUCT_CARD_HTML).toContain("--fc-surface:");
    expect(PRODUCT_CARD_HTML).toContain("background: var(--fc-action);");
    expect(PRODUCT_CARD_HTML).toContain("@media (max-width: 640px)");
    expect(PRODUCT_CARD_HTML).toContain("@media (prefers-reduced-motion: reduce)");
    expect(PRODUCT_CARD_HTML).not.toContain("#177245");
    expect(PRODUCT_CARD_HTML).not.toContain("0 8px 28px");
    expect(PRODUCT_CARD_HTML).toContain("grid-template-columns: 1fr;");
    expect(PRODUCT_CARD_HTML).toContain("box-shadow: none;");
    expect(PRODUCT_CARD_HTML).toContain("border: 1px solid var(--fc-border-strong);");
    expect(PRODUCT_CARD_HTML).toContain("border-top: 1px solid var(--fc-border);");
    expect(PRODUCT_CARD_HTML).toContain("Why this matches");
    expect(PRODUCT_CARD_HTML).toContain("a:active { transform: translateY(1px); }");
    expect(PRODUCT_CARD_HTML).toContain("replace(/[—–]/gu, \"-\")");
    expect(PRODUCT_CARD_HTML).toContain("Possible same item");
    expect(PRODUCT_CARD_HTML).toContain("Highly similar");
    expect(PRODUCT_CARD_HTML).toContain("Same style");
  });

  it("allows only built-in image CDNs plus the configured public search origin", () => {
    expect(productCardResourceDomains("https://findcheap.example/v1/search")).toEqual([
      "https://cdn.shopify.com",
      "https://i.ebayimg.com",
      "https://findcheap.example"
    ]);
    expect(productCardResourceDomains("http://findcheap.example/v1/search")).toEqual([
      "https://cdn.shopify.com",
      "https://i.ebayimg.com"
    ]);
  });

  it("reports size only after rendered DOM, without ResizeObserver, and persists app-only metrics", async () => {
    const script = PRODUCT_CARD_HTML.match(/<script>([\s\S]*)<\/script>/u)?.[1];
    const app = new FakeNode();
    type TestEvent = { source?: object; data?: unknown };
    const listeners = new Map<string, (event: TestEvent) => void>();
    const messages: Array<{ id?: number; method?: string; params?: Record<string, unknown> }> = [];
    const timers: Array<() => void> = [];
    const parent = { postMessage: (message: (typeof messages)[number]) => messages.push(message) };
    const window = {
      parent,
      openai: { toolOutput: {
        renderId: "11111111-1111-4111-8111-111111111111",
        products: [{
          sourceEnvironment: "SANDBOX",
          merchant: "Fixture Merchant",
          title: "Fixture Product",
          matchStatus: "EXACT",
          visualMatchEvidence: ["candidate-image similarity: 0.91", "same neckline", "same print placement"],
          requiredFeatureLimitations: ["genuine leather"],
          preferenceEvidence: ["daily wear"],
          condition: "UNKNOWN",
          availability: "IN_STOCK",
          merchantUrl: "https://example.com/products/fixture",
          card: {
            merchant: "Fixture Merchant",
            title: "Fixture Product",
            imageUrl: "https://cdn.shopify.com/fixture.jpg",
            matchBadge: "EXACT",
            conditionBadge: "UNKNOWN",
            availability: "IN_STOCK"
          }
        }]
      } },
      addEventListener: (type: string, listener: (event: TestEvent) => void) => { listeners.set(type, listener); },
      setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; },
      clearTimeout: () => undefined,
      requestAnimationFrame: (callback: () => void) => { callback(); return 1; },
      ResizeObserver: class { constructor() { throw new Error("ResizeObserver must not be used"); } }
    };
    const document = {
      getElementById: () => app,
      createElement: () => new FakeNode(),
      documentElement: { dataset: {}, scrollWidth: 700, scrollHeight: 320 },
      body: { scrollWidth: 700, scrollHeight: 320 }
    };

    vm.runInNewContext(script!, { window, document, URL, Intl, Number, String, Array, Object, Promise, Map, Math, Date });
    expect(messages.some((message) => message.method === "ui/notifications/size-changed")).toBe(false);

    listeners.get("message")?.({ source: parent, data: { jsonrpc: "2.0", id: 1, result: {} } });
    await Promise.resolve();

    const methods = messages.map((message) => message.method).filter(Boolean);
    expect(methods.indexOf("ui/notifications/initialized"))
      .toBeLessThan(methods.indexOf("ui/notifications/size-changed"));
    expect(messages.filter((message) => message.method === "ui/notifications/size-changed")).toHaveLength(1);
    document.documentElement.scrollHeight = 500;
    document.body.scrollHeight = 500;
    nodes(app).find((node) => node.className === "image")?.dispatch("load");
    await Promise.resolve();
    expect(messages.filter((message) => message.method === "ui/notifications/size-changed")).toHaveLength(2);
    expect(PRODUCT_CARD_HTML).not.toContain("ResizeObserver");
    expect(messages).toContainEqual(expect.objectContaining({
      method: "tools/call",
      params: expect.objectContaining({
        name: "report_product_card_metrics",
        arguments: expect.objectContaining({
          version: "0.17.19",
          terminalStage: "DOM_RENDERED",
          stages: expect.objectContaining({ DOM_RENDERED: expect.any(Number) })
        })
      })
    }));
    expect(messages.some((message) => message.method === "notifications/message")).toBe(false);
    expect(text(app)).toContain("Not verified: genuine leather");
    expect(text(app)).toContain("Preference match: daily wear");
    expect(text(app)).toContain("Visual evidence: same neckline; same print placement");
    expect(text(app)).not.toContain("candidate-image similarity");
    expect(text(app)).toContain("eBay Sandbox review only. This test link does not earn a commission.");
  });

  it("fails a stalled snapshot request instead of waiting forever", async () => {
    const script = PRODUCT_CARD_HTML.match(/<script>([\s\S]*)<\/script>/u)?.[1];
    const app = new FakeNode();
    type TestEvent = { source?: object; data?: unknown };
    const listeners = new Map<string, (event: TestEvent) => void>();
    const messages: Array<{ id?: number; method?: string }> = [];
    const timers = new Map<number, () => void>();
    let nextTimerId = 1;
    const parent = { postMessage: (message: (typeof messages)[number]) => messages.push(message) };
    const window = {
      parent,
      openai: undefined,
      addEventListener: (type: string, listener: (event: TestEvent) => void) => { listeners.set(type, listener); },
      setTimeout: (callback: () => void) => { const id = nextTimerId++; timers.set(id, callback); return id; },
      clearTimeout: (id: number) => { timers.delete(id); },
      requestAnimationFrame: (callback: () => void) => { callback(); return 1; },
      ResizeObserver: undefined
    };
    const document = {
      getElementById: () => app,
      createElement: () => new FakeNode(),
      documentElement: { dataset: {}, scrollWidth: 700, scrollHeight: 320 },
      body: { scrollWidth: 700, scrollHeight: 320 }
    };

    vm.runInNewContext(script!, { window, document, URL, Intl, Number, String, Array, Object, Promise, Map, Math, Date, Error });
    listeners.get("message")?.({ source: parent, data: { jsonrpc: "2.0", id: 1, result: {} } });
    await Promise.resolve();
    listeners.get("message")?.({
      source: parent,
      data: {
        jsonrpc: "2.0",
        method: "ui/notifications/tool-input",
        params: { renderId: "11111111-1111-4111-8111-111111111111" }
      }
    });
    const pendingTimeout = [...timers.values()].at(-1);
    expect(pendingTimeout).toBeDefined();
    pendingTimeout?.();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(text(app)).toContain("Product-card snapshot could not be loaded");
    expect(messages.some((message) => message.method === "tools/call")).toBe(true);
    expect(messages).toContainEqual(expect.objectContaining({
      method: "tools/call",
      params: expect.objectContaining({
        name: "report_product_card_metrics",
        arguments: expect.objectContaining({ terminalStage: "TOOL_OUTPUT_TIMEOUT" })
      })
    }));
  });

  it("renders search tool output immediately without a fallback tool call", () => {
    const script = PRODUCT_CARD_HTML.match(/<script>([\s\S]*)<\/script>/u)?.[1];
    const app = new FakeNode();
    const messages: Array<{ method?: string }> = [];
    const parent = { postMessage: (message: { method?: string }) => messages.push(message) };
    const window = {
      parent,
      openai: { toolOutput: { products: [{
        merchant: "Direct Merchant",
        title: "Direct Product",
        matchStatus: "EXACT",
        condition: "NEW",
        availability: "IN_STOCK",
        merchantUrl: "https://example.com/products/direct",
        pricing: { scope: "SHOPIFY_CART_ESTIMATE" },
        card: {
          merchant: "Direct Merchant",
          title: "Direct Product",
          primaryPrice: { amountCents: 1390, currency: "USD" },
          itemPrice: { amountCents: 1299, currency: "USD" },
          shippingLabel: "免费配送 $0.00",
          taxPrice: { amountCents: 91, currency: "USD" },
          taxLabel: "Estimated tax (FL ZIP state average 6.98%)",
          estimatedTotal: { amountCents: 1390, currency: "USD" },
          priceLabel: "Estimated total",
          matchBadge: "EXACT",
          conditionBadge: "NEW",
          availability: "IN_STOCK"
        }
      }] } },
      addEventListener: () => undefined,
      setTimeout: () => 1,
      ResizeObserver: undefined
    };
    const document = {
      getElementById: () => app,
      createElement: () => new FakeNode(),
      documentElement: { scrollWidth: 700, scrollHeight: 320 },
      body: { scrollWidth: 700, scrollHeight: 320 }
    };

    vm.runInNewContext(script!, { window, document, URL, Intl, Number, String, Array, Object, Promise, Map, Math });

    expect(text(app)).toContain("Direct Product");
    expect(text(app)).toContain("$13.90");
    expect(text(app)).toContain("Item price $12.99");
    expect(text(app)).toContain("Shipping Free shipping $0.00");
    expect(text(app)).toContain("Estimated tax (FL ZIP state average 6.98%) $0.91");
    expect(text(app)).toContain("Estimated total $13.90");
    expect(text(app)).toMatch(/Estimated total summary\s+Direct Product \$13\.90/u);
    expect(text(app)).toContain("Estimated for the supplied ZIP; checkout confirms the final total");
    expect(messages.some((message) => message.method === "tools/call")).toBe(false);
    expect(PRODUCT_CARD_HTML).toContain('image.loading = "lazy"');
    expect(PRODUCT_CARD_HTML).toContain('image.fetchPriority = "low"');
    expect(PRODUCT_CARD_HTML).not.toContain('image.loading = "eager"');
  });

  it("renders all card chrome in Chinese for a Chinese search", () => {
    const script = PRODUCT_CARD_HTML.match(/<script>([\s\S]*)<\/script>/u)?.[1];
    const app = new FakeNode();
    const window = {
      parent: { postMessage: () => undefined },
      openai: { toolOutput: {
        locale: "zh-CN",
        products: [{
          merchant: "示例商家",
          title: "示例商品",
          matchStatus: "DISCOVERY_MATCH",
          resultGroup: "DISCOVERY",
          recommendationTier: "GENERAL_UNVERIFIED",
          condition: "UNKNOWN",
          availability: "IN_STOCK",
          merchantUrl: "https://example.com/product",
          card: {
            merchant: "示例商家",
            title: "示例商品",
            primaryPrice: { amountCents: 1999, currency: "USD" },
            matchBadge: "DISCOVERY_MATCH",
            conditionBadge: "UNKNOWN",
            merchantTrustBadge: "MERCHANT_UNVERIFIED",
            availability: "IN_STOCK"
          }
        }]
      } },
      addEventListener: () => undefined,
      setTimeout: () => 1,
      ResizeObserver: undefined
    };
    const document = {
      getElementById: () => app,
      createElement: () => new FakeNode(),
      documentElement: { lang: "en-US", scrollWidth: 700, scrollHeight: 320 },
      body: { scrollWidth: 700, scrollHeight: 320 }
    };

    vm.runInNewContext(script!, { window, document, URL, Intl, Number, String, Array, Object, Promise, Map, Math, Date });

    expect(document.documentElement.lang).toBe("zh-CN");
    expect(text(app)).toContain("发现结果 / 其他相关商品 - 请仔细核验商家");
    expect(text(app)).toContain("前往商家页面");
    expect(text(app)).not.toContain("View at merchant");
  });

  it("prewarms the compatibility bridge when window.openai arrives after resource evaluation", () => {
    const script = PRODUCT_CARD_HTML.match(/<script>([\s\S]*)<\/script>/u)?.[1];
    const app = new FakeNode();
    const timers: Array<{ callback: () => void; delay: number }> = [];
    const window: {
      parent: { postMessage: () => void };
      openai?: { toolOutput?: unknown };
      addEventListener: () => void;
      setTimeout: (callback: () => void, delay?: number) => number;
      clearTimeout: () => void;
      ResizeObserver: undefined;
      __findcheapCardMetrics?: { stages: Record<string, number> };
    } = {
      parent: { postMessage: () => undefined },
      addEventListener: () => undefined,
      setTimeout: (callback, delay = 0) => {
        timers.push({ callback, delay });
        return timers.length;
      },
      clearTimeout: () => undefined,
      ResizeObserver: undefined
    };
    const document = {
      getElementById: () => app,
      createElement: () => new FakeNode(),
      documentElement: { dataset: {}, scrollWidth: 700, scrollHeight: 320 },
      body: { scrollWidth: 700, scrollHeight: 320 }
    };

    vm.runInNewContext(script!, { window, document, URL, Intl, Number, String, Array, Object, Promise, Map, Set, Math, Date, Error });
    window.openai = { toolOutput: { products: [{
      merchant: "Warm Merchant",
      title: "Warm Product",
      matchStatus: "EXACT",
      condition: "NEW",
      availability: "IN_STOCK",
      merchantUrl: "https://example.com/products/warm",
      card: {
        merchant: "Warm Merchant",
        title: "Warm Product",
        primaryPrice: { amountCents: 2199, currency: "USD" },
        matchBadge: "EXACT",
        conditionBadge: "NEW",
        availability: "IN_STOCK"
      }
    }] } };
    const compatibilityPoll = timers.find((timer) => timer.delay === 16);
    expect(compatibilityPoll).toBeDefined();
    const timerCountBeforeOutput = timers.length;
    compatibilityPoll?.callback();

    expect(text(app)).toContain("Warm Product");
    expect(text(app)).toContain("$21.99");
    expect(timers).toHaveLength(timerCountBeforeOutput);
    expect(window.__findcheapCardMetrics?.stages.COMPAT_BRIDGE_READY).toBeDefined();
    expect(window.__findcheapCardMetrics?.stages.COMPAT_OUTPUT_RECEIVED).toBeDefined();
  });

  it("separates trusted, high-rated unverified, and general unverified cards", () => {
    const script = PRODUCT_CARD_HTML.match(/<script>([\s\S]*)<\/script>/u)?.[1];
    const app = new FakeNode();
    const parent = { postMessage: () => undefined };
    const product = (
      matchStatus: "EXACT" | "DISCOVERY_MATCH" | "SIMILAR",
      title: string,
      recommendationTier: "TRUSTED_OR_AFFILIATE" | "HIGH_RATED_UNVERIFIED" | "GENERAL_UNVERIFIED",
      productRating?: { value: number; count: number; scaleMax: 5 }
    ) => ({
      merchant: "Merchant",
      title,
      brand: "Sony",
      sku: "WH1000XM5",
      gtins: [],
      variantDimensions: { Color: "Black" },
      matchStatus,
      matchEvidence: [matchStatus === "EXACT" ? "brand and MPN exact" : "matched query terms"],
      merchantTrust: recommendationTier === "TRUSTED_OR_AFFILIATE"
        ? {
            level: "OFFICIAL",
            verification: "INDEPENDENT",
            evidence: ["Official merchant domain independently reviewed"]
          }
        : {
            level: "UNKNOWN",
            verification: "UNVERIFIED",
            evidence: ["No independent merchant trust evidence"]
          },
      recommendationTier,
      ...(productRating === undefined ? {} : { productRating }),
      condition: "UNKNOWN",
      availability: "IN_STOCK",
      checkedAt: "2026-08-19T12:00:00.000Z",
      merchantUrl: `https://example.com/products/${matchStatus.toLowerCase()}`,
      card: {
        merchant: "Merchant",
        title,
        primaryPrice: { amountCents: 1299, currency: "USD" },
        matchBadge: matchStatus,
        merchantTrustBadge: recommendationTier === "TRUSTED_OR_AFFILIATE"
          ? "OFFICIAL"
          : recommendationTier === "HIGH_RATED_UNVERIFIED" ? "SHOPIFY_HIGH_RATED" : "MERCHANT_UNVERIFIED",
        conditionBadge: "UNKNOWN",
        availability: "IN_STOCK"
      }
    });
    const window = {
      parent,
      openai: { toolOutput: { products: [
        product("EXACT", "Exact Product", "TRUSTED_OR_AFFILIATE"),
        product("DISCOVERY_MATCH", "Discovery Product", "HIGH_RATED_UNVERIFIED", { value: 3.9, count: 2, scaleMax: 5 }),
        product("SIMILAR", "Similar Product", "GENERAL_UNVERIFIED")
      ] } },
      addEventListener: () => undefined,
      setTimeout: () => 1,
      ResizeObserver: undefined
    };
    const document = {
      getElementById: () => app,
      createElement: () => new FakeNode(),
      documentElement: { scrollWidth: 700, scrollHeight: 320 },
      body: { scrollWidth: 700, scrollHeight: 320 }
    };

    vm.runInNewContext(script!, { window, document, URL, Intl, Number, String, Array, Object, Promise, Map, Math, Date });

    const output = text(app);
    expect(output).toContain("Trusted merchants");
    expect(output).toContain("Highly rated products · unverified merchants");
    expect(output).toContain("Shopify rating is above 3.8 with at least 2 reviews.");
    expect(output).toContain("Other relevant products - review merchant carefully");
    expect(output.indexOf("Exact Product")).toBeLessThan(output.indexOf("Discovery Product"));
    expect(output.indexOf("Discovery Product")).toBeLessThan(output.indexOf("Similar Product"));
    expect(output).toContain("Product rating: 3.9/5 (2 reviews)");
    expect(output).toContain("Highly rated product · merchant unverified");
    expect(output).toContain("Verify seller identity, returns, and payment protection");
    expect(output).toContain("Sony");
    expect(output).toContain("WH1000XM5");
    expect(output).toContain("Color: Black");
    expect(output).toContain("brand and MPN exact");
    expect(output).toContain("Official merchant domain independently reviewed");
    expect(output).toContain("Observed Aug 19, 2026");
  });

  it("renders the primary recommendation first, then the remaining presentation groups", () => {
    const script = PRODUCT_CARD_HTML.match(/<script>([\s\S]*)<\/script>/u)?.[1];
    const app = new FakeNode();
    const product = (title: string, presentationGroup: string, selectionId: string) => ({
      merchant: "Merchant",
      title,
      selectionId,
      matchStatus: "DISCOVERY_MATCH",
      condition: "UNKNOWN",
      availability: "IN_STOCK",
      presentationGroup,
      recommendationTier: "TRUSTED_OR_AFFILIATE",
      merchantUrl: "https://example.com/products/item",
      card: {
        merchant: "Merchant",
        title,
        primaryPrice: { amountCents: 1299, currency: "USD" },
        matchBadge: "DISCOVERY_MATCH",
        conditionBadge: "UNKNOWN",
        availability: "IN_STOCK"
      }
    });
    const window = {
      parent: { postMessage: () => undefined },
      openai: { toolOutput: {
        recommendation: {
          state: "READY",
          primarySelectionId: "00000000-0000-4000-8000-000000000002",
          reasonCodes: ["EXACT_MATCH", "TRUSTED_MERCHANT", "LOWER_PRICE"]
        },
        products: [
          product("Official Product", "OFFICIAL_STORE", "00000000-0000-4000-8000-000000000001"),
          product("Trusted Product", "TRUSTED_MATCH", "00000000-0000-4000-8000-000000000002"),
          product("Value Product", "BEST_VALUE", "00000000-0000-4000-8000-000000000003"),
          product("Another Trusted Product", "TRUSTED_MATCH", "00000000-0000-4000-8000-000000000004")
        ]
      } },
      addEventListener: () => undefined,
      setTimeout: () => 1,
      ResizeObserver: undefined
    };
    const document = {
      getElementById: () => app,
      createElement: () => new FakeNode(),
      documentElement: { scrollWidth: 700, scrollHeight: 320 },
      body: { scrollWidth: 700, scrollHeight: 320 }
    };

    vm.runInNewContext(script!, { window, document, URL, Intl, Number, String, Array, Object, Promise, Map, Math, Date });

    const output = text(app);
    expect(output).toContain("First recommendation");
    expect(output).toContain("Official website matches");
    expect(output).toContain("Trusted exact and similar matches");
    expect(output).toContain("Best-value high-match options");
    expect(output).toContain("Only products hosted on independently verified official brand websites");
    expect(output).toContain("approved Awin merchants");
    expect(output).toContain("Product ratings do not verify merchants.");
    expect(output).toContain("First to consider");
    const featured = nodes(app).filter((node) => node.className.includes("featured"));
    expect(featured).toHaveLength(1);
    expect(text(featured[0]!)).toContain("Trusted Product");
    expect(output.indexOf("Trusted Product")).toBeLessThan(output.indexOf("Official Product"));
    expect(output.indexOf("Official Product")).toBeLessThan(output.indexOf("Another Trusted Product"));
    expect(output.indexOf("Another Trusted Product")).toBeLessThan(output.indexOf("Value Product"));
  });

  it("selects 2-4 native cards and renders the server comparison without focus", async () => {
    const script = PRODUCT_CARD_HTML.match(/<script>([\s\S]*)<\/script>/u)?.[1];
    const app = new FakeNode();
    type TestEvent = { source?: object; data?: unknown };
    const listeners = new Map<string, (event: TestEvent) => void>();
    const messages: Array<{ id?: number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }> = [];
    const parent = { postMessage: (message: (typeof messages)[number]) => messages.push(message) };
    const product = (selectionId: string, title: string) => ({
      selectionId,
      merchant: "Merchant",
      title,
      matchStatus: "DISCOVERY_MATCH",
      condition: "NEW",
      availability: "IN_STOCK",
      presentationGroup: "TRUSTED_MATCH",
      recommendationTier: "TRUSTED_OR_AFFILIATE",
      merchantUrl: "https://merchant.example/product",
      card: {
        merchant: "Merchant",
        title,
        primaryPrice: { amountCents: 100_000, currency: "USD" },
        matchBadge: "DISCOVERY_MATCH",
        conditionBadge: "NEW",
        availability: "IN_STOCK"
      }
    });
    const firstId = "11111111-1111-4111-8111-111111111111";
    const secondId = "22222222-2222-4222-8222-222222222222";
    const renderId = "33333333-3333-4333-8333-333333333333";
    const window = {
      parent,
      openai: { toolOutput: { renderId, locale: "en-US", products: [product(firstId, "Laptop A"), product(secondId, "Laptop B")] } },
      addEventListener: (type: string, listener: (event: TestEvent) => void) => { listeners.set(type, listener); },
      setTimeout: () => 1,
      clearTimeout: () => undefined,
      requestAnimationFrame: (callback: () => void) => { callback(); return 1; },
      ResizeObserver: undefined
    };
    const document = {
      getElementById: () => app,
      createElement: () => new FakeNode(),
      documentElement: { dataset: {}, scrollWidth: 700, scrollHeight: 320, lang: "en-US" },
      body: { scrollWidth: 700, scrollHeight: 320 }
    };

    vm.runInNewContext(script!, { window, document, URL, Intl, Number, String, Array, Object, Promise, Map, Set, Math, Date, Error });
    const toggles = nodes(app).filter((node) => node.textContent === "Select for comparison");
    expect(toggles).toHaveLength(2);
    toggles[0]!.dispatch("click");
    toggles[1]!.dispatch("click");
    const syncCalls = messages.filter((message) => message.params?.name === "sync_product_card_selection");
    expect(syncCalls.map((message) => message.params?.arguments)).toEqual([
      { renderId, selectionIds: [firstId], revision: 1 },
      { renderId, selectionIds: [firstId, secondId], revision: 2 }
    ]);
    nodes(app).find((node) => node.textContent === "Compare selected (2)")?.dispatch("click");

    const call = messages.find((message) => message.params?.name === "compare_selected_products");
    expect(call?.params?.arguments).toEqual({
      renderId,
      selectionIds: [firstId, secondId],
      mode: "AUTO",
      responseLocale: "en-US"
    });
    expect(call?.params?.arguments).not.toHaveProperty("focus");
    listeners.get("message")?.({
      source: parent,
      data: {
        jsonrpc: "2.0",
        id: call?.id,
        result: {
          structuredContent: {
            status: "OK",
            renderId,
            message: "Different product choices. Delivered totals have not been quoted.",
            locale: "en-US",
            entries: [
              { selectionId: firstId, title: "Laptop A", merchant: "Merchant", purchaseUrl: "https://merchant.example/a", itemPrice: { amountCents: 100_000, currency: "USD" }, comparedPrice: { amountCents: 100_000, currency: "USD" }, deliveredTotalStatus: "NOT_QUOTED", condition: "NEW", availability: "IN_STOCK", merchantTrust: { level: "ESTABLISHED_RETAILER", verification: "INDEPENDENT" }, requirementEvidence: ["RTX 5070"], limitations: [], unknowns: ["DELIVERED_TOTAL"] },
              { selectionId: secondId, title: "Laptop B", merchant: "Merchant", purchaseUrl: "https://merchant.example/b", itemPrice: { amountCents: 110_000, currency: "USD" }, comparedPrice: { amountCents: 110_000, currency: "USD" }, deliveredTotalStatus: "NOT_QUOTED", condition: "NEW", availability: "IN_STOCK", merchantTrust: { level: "ESTABLISHED_RETAILER", verification: "INDEPENDENT" }, requirementEvidence: ["RTX 5070"], limitations: [], unknowns: ["DELIVERED_TOTAL"] }
            ]
          }
        }
      }
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(text(app)).toContain("Laptop A");
    expect(text(app)).toContain("Not quoted: provide ZIP");
    expect(text(app)).toContain("Quote delivered totals");
    expect(text(app)).toContain("Back to results");
    const zipInput = nodes(app).find((node) => node.className === "quote-field")?.children[0];
    expect(zipInput).toBeDefined();
    zipInput!.value = "10001";
    nodes(app).find((node) => node.textContent === "Quote delivered totals")?.dispatch("click");
    const quoteCall = messages.find((message) => message.params?.name === "quote_and_compare_selected_products");
    expect(quoteCall?.params?.arguments).toEqual({
      renderId,
      selectionIds: [firstId, secondId],
      zipCode: "10001",
      mode: "AUTO",
      focus: ["DELIVERED_TOTAL"],
      responseLocale: "en-US"
    });
  });

  it("localizes Coupon labels and keeps unknown condition out of the badge row", () => {
    const script = PRODUCT_CARD_HTML.match(/<script>([\s\S]*)<\/script>/u)?.[1];
    const app = new FakeNode();
    const window = {
      parent: { postMessage: () => undefined },
      openai: { toolOutput: {
        locale: "zh-CN",
        products: [{
          merchant: "示例官网",
          title: "示例商品",
          matchStatus: "EXACT",
          condition: "UNKNOWN",
          availability: "IN_STOCK",
          presentationGroup: "OFFICIAL_STORE",
          recommendationTier: "TRUSTED_OR_AFFILIATE",
          merchantUrl: "https://example.com/products/item",
          purchaseLink: {
            kind: "APPROVED_AFFILIATE",
            url: "https://affiliate.example/click",
            disclosure: "We may earn a commission if you buy through this link."
          },
          coupons: {
            status: "VERIFIED",
            verified: [{
              code: "SAVE20",
              discountPercent: 20,
              productApplicability: "MERCHANT_WIDE",
              validTo: "2026-09-10T00:00:00.000Z"
            }]
          },
          card: {
            merchant: "示例官网",
            title: "示例商品",
            primaryPrice: { amountCents: 4_000, currency: "USD" },
            couponLabel: "Coupon: SAVE20",
            matchBadge: "EXACT",
            conditionBadge: "UNKNOWN",
            availability: "IN_STOCK",
            merchantTrustBadge: "OFFICIAL"
          }
        }, {
          merchant: "确认优惠官网",
          title: "确认优惠商品",
          matchStatus: "EXACT",
          condition: "NEW",
          availability: "IN_STOCK",
          presentationGroup: "OFFICIAL_STORE",
          recommendationTier: "TRUSTED_OR_AFFILIATE",
          merchantUrl: "https://confirmed.example/products/item",
          coupons: {
            status: "VERIFIED",
            verified: [{
              code: "EXACT20",
              discountPercent: 20,
              productApplicability: "PRODUCT_CONFIRMED",
              validTo: "2026-09-10T00:00:00.000Z"
            }],
            estimatedItemPriceAfterCoupon: { amountCents: 3_200, currency: "USD" }
          },
          card: {
            merchant: "确认优惠官网",
            title: "确认优惠商品",
            primaryPrice: { amountCents: 4_000, currency: "USD" },
            matchBadge: "EXACT",
            conditionBadge: "NEW",
            availability: "IN_STOCK",
            merchantTrustBadge: "OFFICIAL"
          }
        }]
      } },
      addEventListener: () => undefined,
      setTimeout: () => 1,
      ResizeObserver: undefined
    };
    const document = {
      getElementById: () => app,
      createElement: () => new FakeNode(),
      documentElement: { scrollWidth: 700, scrollHeight: 320 },
      body: { scrollWidth: 700, scrollHeight: 320 }
    };

    vm.runInNewContext(script!, { window, document, URL, Intl, Number, String, Array, Object, Promise, Map, Math, Date });

    const output = text(app);
    expect(output).toContain("商家优惠：SAVE20");
    expect(output).toContain("该商家当前有优惠");
    expect(output).toContain("已验证优惠：EXACT20");
    expect(output).toContain("使用优惠后预计：US$32.00");
    expect(output).toContain("该优惠已确认适用于此商品");
    expect(output).toContain("值得先看");
    expect(output).toContain("为什么匹配");
    expect(output).toContain("商品状态未核实");
    expect(output).toContain("Findcheap 找到了可用的coupon");
    expect(output).not.toContain("佣金");
    expect(output).not.toContain("Coupon: SAVE20");
    expect(nodes(app).filter((node) => node.className === "badge").map((node) => node.textContent))
      .not.toContain("未知");
  });

  it("loads the immutable snapshot when Codex forwards tool input without tool output", async () => {
    const script = PRODUCT_CARD_HTML.match(/<script>([\s\S]*)<\/script>/u)?.[1];
    expect(script).toBeDefined();

    const app = new FakeNode();
    type TestEvent = {
      source?: object;
      data?: unknown;
      detail?: { globals?: { toolInput?: unknown; toolOutput?: unknown } };
    };
    const listeners = new Map<string, (event: TestEvent) => void>();
    const messages: unknown[] = [];
    const parent = { postMessage: (message: unknown) => messages.push(message) };
    const window = {
      parent,
      openai: undefined,
      addEventListener: (type: string, listener: (event: TestEvent) => void) => { listeners.set(type, listener); },
      setTimeout: () => 1,
      requestAnimationFrame: (callback: () => void) => { callback(); return 1; },
      ResizeObserver: undefined
    };
    const document = {
      getElementById: () => app,
      createElement: () => new FakeNode(),
      documentElement: { scrollWidth: 700, scrollHeight: 320 },
      body: { scrollWidth: 700, scrollHeight: 320 }
    };

    vm.runInNewContext(script!, { window, document, URL, Intl, Number, String, Array, Object, Promise, Map, Math });
    expect(messages[0]).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "ui/initialize",
      params: {
        protocolVersion: "2026-01-26",
        appInfo: { name: "FindCheap Agent product cards", version: "0.17.19" },
        appCapabilities: { availableDisplayModes: ["inline"] }
      }
    });
    listeners.get("message")?.({ source: parent, data: { jsonrpc: "2.0", id: 1, result: {} } });
    await Promise.resolve();
    expect(messages).toContainEqual({
      jsonrpc: "2.0",
      method: "ui/notifications/initialized",
      params: {}
    });
    expect(messages).not.toContainEqual(expect.objectContaining({ method: "ui/notifications/size-changed" }));
    listeners.get("message")?.({
      source: parent,
      data: {
        jsonrpc: "2.0",
        method: "ui/notifications/tool-input",
        params: { renderId: "11111111-1111-4111-8111-111111111111" }
      }
    });
    expect(messages).toContainEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "render_product_cards",
        arguments: { renderId: "11111111-1111-4111-8111-111111111111" }
      }
    });
    listeners.get("message")?.({
      source: parent,
      data: {
        jsonrpc: "2.0",
        id: 2,
        result: {
          structuredContent: {
            products: [{
              merchant: "Example Coffee",
              title: "Verified Coffee",
              matchStatus: "EXACT",
              condition: "UNKNOWN",
              availability: "IN_STOCK",
              merchantUrl: "https://example.com/products/coffee",
              purchaseLink: {
                kind: "APPROVED_AFFILIATE",
                url: "https://affiliate.example/click",
                disclosure: "We may earn a commission if you buy through this link. This does not raise your price or affect ranking."
              },
              card: {
                merchant: "Example Coffee",
                title: "Verified Coffee",
                primaryPrice: { amountCents: 1499, currency: "USD" },
                matchBadge: "EXACT",
                conditionBadge: "UNKNOWN",
                availability: "IN_STOCK",
                actionLabel: "View at merchant"
              }
            }]
          }
        }
      }
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(messages).toContainEqual({
      jsonrpc: "2.0",
      method: "ui/notifications/size-changed",
      params: { width: 700, height: 320 }
    });

    expect(text(app)).toContain("Verified Coffee");
    expect(text(app)).toContain("$14.99");
    expect(text(app)).toContain("1 product card");
    expect(text(app)).not.toContain("We may earn a commission");
    expect(text(app)).not.toContain("FindCheap found an available coupon.");
    expect(text(app)).toContain("Quote unsupported: shipping, tax, and final total require merchant checkout.");

    listeners.get("openai:set_globals")?.({
      detail: { globals: { toolInput: { renderId: "ignored" }, toolOutput: { products: [] } } }
    });

    listeners.get("message")?.({
      source: parent,
      data: {
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: {
          result: {
            structuredContent: {
              products: [{
                merchant: "Notification Merchant",
                title: "Notification Coffee",
                matchStatus: "EXACT",
                condition: "UNKNOWN",
                availability: "IN_STOCK",
                merchantUrl: "https://example.com/products/notification-coffee",
                card: {
                  merchant: "Notification Merchant",
                  title: "Notification Coffee",
                  primaryPrice: { amountCents: 1599, currency: "USD" },
                  matchBadge: "EXACT",
                  conditionBadge: "UNKNOWN",
                  availability: "IN_STOCK",
                  actionLabel: "View at merchant"
                }
              }]
            }
          }
        }
      }
    });
    expect(text(app)).toContain("Notification Coffee");
    expect(text(app)).toContain("$15.99");
  });

  it("recovers when the host misses the first ui/initialize message", async () => {
    const script = PRODUCT_CARD_HTML.match(/<script>([\s\S]*)<\/script>/u)?.[1];
    const app = new FakeNode();
    type TestEvent = { source?: object; data?: unknown };
    const listeners = new Map<string, (event: TestEvent) => void>();
    const messages: Array<{ id?: number; method?: string; params?: Record<string, unknown> }> = [];
    const timers = new Map<number, { callback: () => void; delay: number }>();
    let nextTimerId = 1;
    const parent = { postMessage: (message: (typeof messages)[number]) => messages.push(message) };
    const window = {
      parent,
      openai: undefined,
      addEventListener: (type: string, listener: (event: TestEvent) => void) => { listeners.set(type, listener); },
      setTimeout: (callback: () => void, delay = 0) => {
        const id = nextTimerId++;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: (id: number) => { timers.delete(id); },
      requestAnimationFrame: (callback: () => void) => { callback(); return 1; },
      ResizeObserver: undefined
    };
    const document = {
      getElementById: () => app,
      createElement: () => new FakeNode(),
      documentElement: { dataset: {}, scrollWidth: 700, scrollHeight: 320 },
      body: { scrollWidth: 700, scrollHeight: 320 }
    };

    vm.runInNewContext(script!, { window, document, URL, Intl, Number, String, Array, Object, Promise, Map, Set, Math, Date, Error });
    expect(messages.filter((message) => message.method === "ui/initialize")).toHaveLength(1);

    const firstTimeout = [...timers.values()].find((timer) => timer.delay === 750);
    expect(firstTimeout).toBeDefined();
    firstTimeout?.callback();
    await Promise.resolve();
    await Promise.resolve();

    const firstRetry = [...timers.values()].find((timer) => timer.delay === 50);
    expect(firstRetry).toBeDefined();
    firstRetry?.callback();
    expect(messages.filter((message) => message.method === "ui/initialize")).toHaveLength(2);

    const secondInitialize = messages.findLast((message) => message.method === "ui/initialize");
    listeners.get("message")?.({
      source: parent,
      data: { jsonrpc: "2.0", id: secondInitialize?.id, result: {} }
    });
    await Promise.resolve();

    expect(messages).toContainEqual({
      jsonrpc: "2.0",
      method: "ui/notifications/initialized",
      params: {}
    });
    expect(messages.filter((message) => message.method === "ui/notifications/initialized")).toHaveLength(1);
    expect((window as { __findcheapCardMetrics?: { stages: Record<string, number> } })
      .__findcheapCardMetrics?.stages.INITIALIZE_RETRY).toBeDefined();
  });

  it("removes eager-image blockers across 20 golden card tasks and records first-paint stages", () => {
    const script = PRODUCT_CARD_HTML.match(/<script>([\s\S]*)<\/script>/u)?.[1];
    expect(script).toBeDefined();
    const fixture = JSON.parse(readFileSync(
      new URL("../../../tests/evals/shopify-match-golden.json", import.meta.url),
      "utf8"
    )) as { tasks: Array<{ id: string }> };
    const goldenTasks = fixture.tasks.slice(0, 20);
    expect(goldenTasks).toHaveLength(20);
    const baselineEagerImageBlockers = 20;
    let candidateEagerImageBlockers = 0;

    for (const [index, task] of goldenTasks.entries()) {
      const app = new FakeNode();
      let now = 0;
      const documentElement = {
        dataset: {} as Record<string, string>,
        scrollWidth: 700,
        scrollHeight: 320
      };
      const window: {
        parent: { postMessage: () => void };
        openai: { toolOutput: unknown };
        addEventListener: () => void;
        setTimeout: () => number;
        requestAnimationFrame: (callback: () => void) => number;
        ResizeObserver: undefined;
        __findcheapCardMetrics?: { stages: Record<string, number> };
      } = {
        parent: { postMessage: () => undefined },
        openai: { toolOutput: { products: [{
          merchant: `Golden Merchant ${index + 1}`,
          title: task.id,
          matchStatus: index % 3 === 0 ? "EXACT" : index % 3 === 1 ? "DISCOVERY_MATCH" : "SIMILAR",
          condition: "UNKNOWN",
          availability: "IN_STOCK",
          checkedAt: "2026-08-19T12:00:00.000Z",
          merchantUrl: `https://example.com/products/golden-${index + 1}`,
          card: {
            merchant: `Golden Merchant ${index + 1}`,
            title: task.id,
            imageUrl: `https://cdn.shopify.com/golden-${index + 1}.jpg`,
            primaryPrice: { amountCents: 1000 + index, currency: "USD" },
            matchBadge: index % 3 === 0 ? "EXACT" : index % 3 === 1 ? "DISCOVERY_MATCH" : "SIMILAR",
            conditionBadge: "UNKNOWN",
            availability: "IN_STOCK"
          }
        }] } },
        addEventListener: () => undefined,
        setTimeout: () => 1,
        requestAnimationFrame: (callback: () => void) => { callback(); return 1; },
        ResizeObserver: undefined
      };
      const document = {
        getElementById: () => app,
        createElement: () => new FakeNode(),
        documentElement,
        body: { scrollWidth: 700, scrollHeight: 320 }
      };
      const performance = { now: () => ++now, mark: () => undefined };

      vm.runInNewContext(script!, { window, document, performance, URL, Intl, Number, String, Array, Object, Promise, Map, Math, Date });

      const image = nodes(app).find((node) => node.loading !== "");
      expect(image?.loading).toBe("lazy");
      expect(image?.fetchPriority).toBe("low");
      if (image?.loading === "eager") candidateEagerImageBlockers += 1;
      expect(window.__findcheapCardMetrics?.stages.DOM_RENDERED).toBeDefined();
      expect(window.__findcheapCardMetrics?.stages.FIRST_IMAGE_PAINTED).toBeUndefined();
      image?.dispatch("load");
      expect(window.__findcheapCardMetrics!.stages.FIRST_IMAGE_PAINTED)
        .toBeGreaterThanOrEqual(window.__findcheapCardMetrics!.stages.DOM_RENDERED!);
    }

    expect({ baselineEagerImageBlockers, candidateEagerImageBlockers }).toEqual({
      baselineEagerImageBlockers: 20,
      candidateEagerImageBlockers: 0
    });
  });
});
