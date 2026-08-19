import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { PRODUCT_CARD_HTML } from "../src/product-card-ui.js";

class FakeNode {
  children: FakeNode[] = [];
  className = "";
  textContent = "";

  append(...nodes: FakeNode[]) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: FakeNode[]) {
    this.children = nodes;
  }

  addEventListener() {}
  remove() {}
}

function text(node: FakeNode): string {
  return [node.textContent, ...node.children.map(text)].join(" ");
}

describe("product-card MCP Apps UI", () => {
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
        appInfo: { name: "FindCheap product cards", version: "0.3.7" },
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
    expect(messages).toContainEqual({
      jsonrpc: "2.0",
      method: "ui/notifications/size-changed",
      params: { width: 700, height: 320 }
    });
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

    expect(text(app)).toContain("Verified Coffee");
    expect(text(app)).toContain("$14.99");
    expect(text(app)).toContain("1 verified product card");

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
});
