import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { PRODUCT_COMPARISON_HTML } from "../src/product-comparison-ui.js";

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  className = "";
  textContent = "";
  src = "";
  alt = "";
  loading = "";
  href = "";
  target = "";
  rel = "";
  type = "";
  value = "";
  inputMode = "";
  maxLength = 0;
  placeholder = "";
  disabled = false;
  private readonly listeners = new Map<string, () => void>();

  constructor(readonly tagName = "DIV") {}

  append(...nodes: FakeNode[]) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: FakeNode[]) {
    this.children.splice(0, this.children.length, ...nodes);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }

  dispatch(type: string) {
    this.listeners.get(type)?.();
  }
}

function nodes(node: FakeNode): FakeNode[] {
  return [node, ...node.children.flatMap(nodes)];
}

function text(node: FakeNode): string {
  return [node.textContent, ...node.children.map(text)].filter(Boolean).join(" ");
}

function executeUi(output: Record<string, unknown>) {
  const script = PRODUCT_COMPARISON_HTML.match(/<script>([\s\S]*)<\/script>/u)?.[1];
  const app = new FakeNode("MAIN");
  const listeners = new Map<string, (event: { source?: object; data?: unknown }) => void>();
  const messages: unknown[] = [];
  const parent = { postMessage: (message: unknown) => messages.push(message) };
  const window = {
    parent,
    openai: { toolOutput: output },
    addEventListener: (type: string, listener: (event: { source?: object; data?: unknown }) => void) => {
      listeners.set(type, listener);
    },
    setTimeout: () => 1,
    clearTimeout: () => undefined
  };
  const document = {
    getElementById: () => app,
    createElement: (tag: string) => new FakeNode(tag.toUpperCase()),
    documentElement: { scrollHeight: 500 }
  };
  vm.runInNewContext(script!, { window, document, URL, Intl, Number, String, Array, Object, Promise, Map });
  return { app, messages };
}

describe("product comparison MCP Apps UI", () => {
  it("renders server facts, price delta, unknowns, variants, and focus order", () => {
    const output = {
      status: "OK",
      message: "Server comparison",
      comparisonId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      evaluatedAt: "2026-09-03T06:00:00.000Z",
      expiresAt: "2026-09-03T07:00:00.000Z",
      locale: "en-US",
      mode: "SAME_PRODUCT_OFFERS",
      focus: ["IDENTITY", "PRICE"],
      priceBasis: "ITEM_PRICE",
      priceDelta: {
        basis: "ITEM_PRICE",
        currency: "USD",
        lowestSelectionId: "11111111-1111-4111-8111-111111111111",
        highestSelectionId: "22222222-2222-4222-8222-222222222222",
        amountCents: 100
      },
      recommendation: {
        state: "READY",
        recommendedSelectionId: "11111111-1111-4111-8111-111111111111",
        reasonCodes: ["EXACT_MATCH", "LOWER_PRICE"]
      },
      entries: [
        {
          selectionId: "11111111-1111-4111-8111-111111111111",
          title: "Fixture A",
          merchant: "Merchant A",
          sellerName: "Seller A",
          purchaseUrl: "https://merchant.example/a",
          brand: "Fixture Brand",
          sku: "MODEL-1",
          gtins: ["100000000001"],
          variantDimensions: { Size: "Standard" },
          matchStatus: "EXACT",
          itemPrice: { amountCents: 1500, currency: "USD" },
          deliveredTotal: { amountCents: 1700, currency: "USD" },
          deliveredTotalExpiresAt: "2026-09-03T07:00:00.000Z",
          deliveredTotalStatus: "QUOTED",
          comparedPrice: { amountCents: 1500, currency: "USD" },
          availability: "IN_STOCK",
          condition: "NEW",
          merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT" },
          verifiedDeals: [{
            kind: "COUPON",
            title: "Fixture offer",
            code: "SAVE10",
            discountPercent: 10,
            discountAmount: { amountCents: 100, currency: "USD" },
            productApplicability: "MERCHANT_WIDE",
            validTo: "2026-09-30T23:59:59.000Z"
          }],
          identityEvidence: ["GTIN exact"],
          requirementEvidence: ["Required feature"],
          preferenceEvidence: ["Preferred color"],
          limitations: ["Delivered total unavailable"],
          unknowns: ["DELIVERED_TOTAL"],
          checkedAt: "2026-09-03T06:00:00.000Z"
        },
        {
          selectionId: "22222222-2222-4222-8222-222222222222",
          title: "Fixture B",
          merchant: "Merchant B",
          purchaseUrl: "https://merchant.example/b",
          brand: "Fixture Brand",
          sku: "MODEL-1",
          gtins: ["100000000001"],
          variantDimensions: { Size: "Standard" },
          matchStatus: "EXACT",
          itemPrice: { amountCents: 1600, currency: "USD" },
          deliveredTotalStatus: "NOT_QUOTED",
          comparedPrice: { amountCents: 1600, currency: "USD" },
          availability: "IN_STOCK",
          condition: "NEW",
          merchantTrust: { level: "ESTABLISHED_RETAILER", verification: "INDEPENDENT" },
          verifiedDeals: [],
          identityEvidence: ["GTIN exact"],
          requirementEvidence: [],
          preferenceEvidence: [],
          limitations: [],
          unknowns: ["DELIVERED_TOTAL"],
          checkedAt: "2026-09-03T06:00:00.000Z"
        }
      ]
    };
    const { app, messages } = executeUi(output);

    const renderedText = text(app);
    expect(renderedText).toContain("Price spread: $1.00");
    expect(renderedText).toContain("Merchant A · Seller A");
    expect(renderedText).toContain("SKU: MODEL-1");
    expect(renderedText).toContain("GTIN: 100000000001");
    expect(renderedText).toContain("Size: Standard");
    expect(renderedText).toContain("DELIVERED_TOTAL");
    expect(renderedText).toContain("EXACT");
    expect(renderedText).toContain("same-product offers");
    expect(renderedText).toContain("EXACT_MATCH, LOWER_PRICE");
    expect(renderedText).toContain("COUPON · Fixture offer");
    expect(renderedText).toContain("SAVE10");
    expect(renderedText).toContain("10%");
    expect(renderedText).toContain("$1.00 off");
    expect(renderedText).toContain("merchant offer; product eligibility requires confirmation");
    expect(renderedText).toContain("valid to");
    expect(renderedText).toContain("valid until");
    expect(renderedText).toContain("Not quoted: provide ZIP");
    const rowLabels = nodes(app)
      .filter((node) => node.tagName === "TR")
      .slice(1)
      .map((row) => text(row.children[0]!));
    expect(rowLabels.indexOf("Match status")).toBeLessThan(rowLabels.indexOf("Compared price"));
    expect(messages.length).toBeGreaterThan(0);
    const zipInput = nodes(app).find((node) => node.tagName === "INPUT");
    expect(zipInput).toBeDefined();
    zipInput!.value = "10001";
    nodes(app).find((node) => node.textContent === "Quote delivered totals")?.dispatch("click");
    const quoteCall = (messages as Array<{ params?: { name?: string; arguments?: unknown } }>).find(
      (message) => message.params?.name === "quote_and_compare_selected_products"
    );
    expect(quoteCall?.params?.arguments).toEqual({
      selectionIds: [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222"
      ],
      zipCode: "10001",
      mode: "AUTO",
      focus: ["DELIVERED_TOTAL"],
      responseLocale: "en-US"
    });
  });

  it.each([2, 3, 4])("renders %i comparison columns", (entryCount) => {
    const entries = Array.from({ length: entryCount }, (_, index) => ({
      selectionId: `${index + 1}`.repeat(8) + "-1111-4111-8111-111111111111",
      title: `Fixture ${index + 1}`,
      merchant: `Merchant ${index + 1}`,
      purchaseUrl: `https://merchant.example/${index + 1}`,
      gtins: [],
      variantDimensions: {},
      matchStatus: "DISCOVERY_MATCH",
      itemPrice: { amountCents: 1000 + index, currency: "USD" },
      deliveredTotalStatus: "NOT_QUOTED",
      comparedPrice: { amountCents: 1000 + index, currency: "USD" },
      availability: "IN_STOCK",
      condition: "NEW",
      merchantTrust: { level: "ESTABLISHED_RETAILER", verification: "INDEPENDENT" },
      verifiedDeals: [],
      identityEvidence: [],
      requirementEvidence: [],
      preferenceEvidence: [],
      limitations: [],
      unknowns: ["DELIVERED_TOTAL"],
      checkedAt: "2026-09-03T06:00:00.000Z"
    }));
    const { app } = executeUi({
      status: "OK",
      message: "Server comparison",
      comparisonId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      locale: "en-US",
      mode: "PRODUCT_CHOICES",
      focus: [],
      priceBasis: "ITEM_PRICE",
      recommendation: { state: "RESEARCH_ONLY", reasonCodes: [] },
      entries
    });
    const header = nodes(app).find((node) => node.tagName === "TR");
    expect(header?.children).toHaveLength(entryCount + 1);
    expect(header?.children.slice(1).every((cell) => cell.tagName === "TH" && cell.className === "")).toBe(true);
    expect(header?.children.slice(1).every((cell) => cell.children[0]?.className.includes("product-head"))).toBe(true);
  });

  it("renders Chinese comparison labels", () => {
    const baseEntry = {
      title: "商品",
      merchant: "商家",
      purchaseUrl: "https://merchant.example/product",
      gtins: [],
      variantDimensions: {},
      matchStatus: "DISCOVERY_MATCH",
      itemPrice: { amountCents: 1000, currency: "USD" },
      comparedPrice: { amountCents: 1000, currency: "USD" },
      availability: "IN_STOCK",
      condition: "NEW",
      merchantTrust: { level: "ESTABLISHED_RETAILER", verification: "INDEPENDENT" },
      verifiedDeals: [],
      identityEvidence: [],
      requirementEvidence: [],
      preferenceEvidence: [],
      limitations: [],
      unknowns: ["DELIVERED_TOTAL"],
      checkedAt: "2026-09-03T06:00:00.000Z"
    };
    const { app } = executeUi({
      status: "OK",
      message: "服务器对比",
      comparisonId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      locale: "zh-CN",
      mode: "PRODUCT_CHOICES",
      focus: [],
      priceBasis: "ITEM_PRICE",
      recommendation: { state: "RESEARCH_ONLY", reasonCodes: [] },
      entries: [
        { ...baseEntry, selectionId: "11111111-1111-4111-8111-111111111111", deliveredTotalStatus: "NOT_QUOTED" },
        { ...baseEntry, selectionId: "22222222-2222-4222-8222-222222222222", deliveredTotalStatus: "MERCHANT_CHECKOUT_ONLY" }
      ]
    });
    expect(text(app)).toContain("不同商品选择");
    expect(text(app)).toContain("推荐结论");
    expect(text(app)).toContain("商品价口径");
    expect(text(app)).toContain("发现匹配");
    expect(text(app)).toContain("有货");
    expect(text(app)).toContain("全新");
    expect(text(app)).toContain("仅供研究");
    expect(text(app)).toContain("暂无已验证优惠");
    expect(text(app)).toContain("暂无已知限制");
    expect(text(app)).toContain("到手价");
    expect(text(app)).toContain("未报价：请提供 ZIP");
    expect(text(app)).toContain("不支持报价：仅商家结账页提供");
  });
});
