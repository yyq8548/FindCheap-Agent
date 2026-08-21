import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { PRODUCT_CARD_HTML, PRODUCT_CARD_UI_URI } from "../src/product-card-ui.js";

class FakeNode {
  children: FakeNode[] = [];
  className = "";
  textContent = "";
  loading = "";
  fetchPriority = "";
  private readonly listeners = new Map<string, () => void>();

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

describe("product-card MCP Apps UI", () => {
  it("uses an embedded Codex-native surface with responsive cards", () => {
    expect(PRODUCT_CARD_UI_URI).toBe("ui://findcheap/product-cards/v18.html");
    expect(PRODUCT_CARD_HTML).toContain("--fc-surface:");
    expect(PRODUCT_CARD_HTML).toContain("background: var(--fc-action);");
    expect(PRODUCT_CARD_HTML).toContain("@media (max-width: 640px)");
    expect(PRODUCT_CARD_HTML).toContain("@media (prefers-reduced-motion: reduce)");
    expect(PRODUCT_CARD_HTML).not.toContain("#177245");
    expect(PRODUCT_CARD_HTML).not.toContain("0 8px 28px");
    expect(PRODUCT_CARD_HTML).toContain("box-shadow: none;");
    expect(PRODUCT_CARD_HTML).toContain("border: 1px solid var(--fc-border-strong);");
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
          merchant: "Fixture Merchant",
          title: "Fixture Product",
          matchStatus: "EXACT",
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
          version: "0.6.16",
          terminalStage: "DOM_RENDERED",
          stages: expect.objectContaining({ DOM_RENDERED: expect.any(Number) })
        })
      })
    }));
    expect(messages.some((message) => message.method === "notifications/message")).toBe(false);
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
    expect(text(app)).toContain("Shipping 免费配送 $0.00");
    expect(text(app)).toContain("Estimated tax (FL ZIP state average 6.98%) $0.91");
    expect(text(app)).toContain("Estimated total $13.90");
    expect(text(app)).toMatch(/Estimated total summary\s+Direct Product \$13\.90/u);
    expect(text(app)).toContain("Some merchants require a full address or checkout before calculating tax");
    expect(text(app)).toContain("Final checkout total may change");
    expect(messages.some((message) => message.method === "tools/call")).toBe(false);
    expect(PRODUCT_CARD_HTML).toContain('image.loading = "lazy"');
    expect(PRODUCT_CARD_HTML).toContain('image.fetchPriority = "low"');
    expect(PRODUCT_CARD_HTML).not.toContain('image.loading = "eager"');
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

  it("separates exact, discovery, and similar cards with identity evidence", () => {
    const script = PRODUCT_CARD_HTML.match(/<script>([\s\S]*)<\/script>/u)?.[1];
    const app = new FakeNode();
    const parent = { postMessage: () => undefined };
    const product = (matchStatus: "EXACT" | "DISCOVERY_MATCH" | "SIMILAR", title: string) => ({
      merchant: "Merchant",
      title,
      brand: "Sony",
      sku: "WH1000XM5",
      gtins: [],
      variantDimensions: { Color: "Black" },
      matchStatus,
      matchEvidence: [matchStatus === "EXACT" ? "brand and MPN exact" : "matched query terms"],
      merchantTrust: {
        level: "OFFICIAL",
        verification: "INDEPENDENT",
        evidence: ["Official merchant domain independently reviewed"]
      },
      condition: "UNKNOWN",
      availability: "IN_STOCK",
      checkedAt: "2026-08-19T12:00:00.000Z",
      merchantUrl: `https://example.com/products/${matchStatus.toLowerCase()}`,
      card: {
        merchant: "Merchant",
        title,
        primaryPrice: { amountCents: 1299, currency: "USD" },
        matchBadge: matchStatus,
        merchantTrustBadge: "OFFICIAL",
        conditionBadge: "UNKNOWN",
        availability: "IN_STOCK"
      }
    });
    const window = {
      parent,
      openai: { toolOutput: { products: [
        product("SIMILAR", "Similar Product"),
        product("DISCOVERY_MATCH", "Discovery Product"),
        product("EXACT", "Exact Product")
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
    expect(output).toContain("Trusted exact matches");
    expect(output).toContain("Trusted discovery matches");
    expect(output).toContain("Trusted similar options");
    expect(output.indexOf("Exact Product")).toBeLessThan(output.indexOf("Discovery Product"));
    expect(output.indexOf("Discovery Product")).toBeLessThan(output.indexOf("Similar Product"));
    expect(output).toContain("Sony");
    expect(output).toContain("WH1000XM5");
    expect(output).toContain("Color: Black");
    expect(output).toContain("brand and MPN exact");
    expect(output).toContain("Official merchant domain independently reviewed");
    expect(output).toContain("Observed Aug 19, 2026");
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
        appInfo: { name: "FindCheap Agent product cards", version: "0.6.16" },
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
    expect(text(app)).toContain("We may earn a commission");

    listeners.get("openai:set_globals")?.({
      detail: { globals: { toolInput: { renderId: "ignored" }, toolOutput: { products: [] } } }
    });

    listeners.get("message")?.({
      source: parent,
      data: {
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: {
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
