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
  it("renders structured product results delivered by the host bridge", () => {
    const script = PRODUCT_CARD_HTML.match(/<script>([\s\S]*)<\/script>/u)?.[1];
    expect(script).toBeDefined();

    const app = new FakeNode();
    let onMessage: ((event: { source: object; data: unknown }) => void) | undefined;
    const parent = {};
    const window = {
      parent,
      openai: undefined,
      addEventListener: (_type: string, listener: typeof onMessage) => { onMessage = listener; },
      setTimeout: () => 1
    };
    const document = {
      getElementById: () => app,
      createElement: () => new FakeNode()
    };

    vm.runInNewContext(script!, { window, document, URL, Intl, Number, String, Array, Object });
    onMessage?.({
      source: parent,
      data: {
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: {
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

    expect(text(app)).toContain("Verified Coffee");
    expect(text(app)).toContain("$14.99");
    expect(text(app)).toContain("1 verified product card");
  });
});
