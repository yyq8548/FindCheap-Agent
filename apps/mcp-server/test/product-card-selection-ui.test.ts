import vm from "node:vm";
import { expect, it } from "vitest";
import { PRODUCT_CARD_HTML } from "../src/product-card-ui.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

class Node {
  children: Node[] = [];
  textContent = "";
  className = "";
  disabled = false;
  value = "";
  ariaPressed = "false";
  private readonly listeners = new Map<string, () => void>();
  constructor(readonly tagName = "DIV") {}
  append(...children: Node[]) { this.children.push(...children); }
  replaceChildren(...children: Node[]) { this.children = children; }
  addEventListener(event: string, listener: () => void) { this.listeners.set(event, listener); }
  click() { this.listeners.get("click")?.(); }
}

type Message = { id?: number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
type Snapshot = { renderId: string; products: Array<{ selectionId: string }> };
const nodes = (node: Node): Node[] => [node, ...node.children.flatMap(nodes)];
const cards = (renderId: string | undefined, ids = ["a", "b", "c"]) => ({
  renderId, locale: "en-US", products: ids.map(selectionId => ({ ...product({ title: `Wig ${selectionId}` }), selectionId }))
});

function mount(output: unknown) {
  const app = new Node("MAIN");
  const messages: Message[] = [];
  const listeners = new Map<string, (event: { source: object; data: unknown }) => void>();
  const parent = { postMessage: (message: Message) => messages.push(message) };
  const window = {
    parent, openai: { toolOutput: output },
    addEventListener: (name: string, listener: (event: { source: object; data: unknown }) => void) => listeners.set(name, listener),
    setTimeout: () => 1, clearTimeout: () => undefined,
    requestAnimationFrame: (callback: () => void) => { callback(); return 1; }
  };
  const document = {
    getElementById: () => app, createElement: (name: string) => new Node(name.toUpperCase()),
    documentElement: { dataset: {}, scrollWidth: 700, scrollHeight: 320, lang: "en-US" },
    body: { scrollWidth: 700, scrollHeight: 320 }
  };
  vm.runInNewContext(PRODUCT_CARD_HTML.match(/<script>([\s\S]*)<\/script>/u)![1]!, {
    window, document, URL, Intl, Number, String, Array, Object, Promise, Map, Set, Math, Date, Error
  });
  const send = (data: unknown) => listeners.get("message")?.({ source: parent, data });
  return {
    app, messages,
    button: (label: string) => {
      const button = nodes(app).find(node => node.tagName === "BUTTON" && node.textContent === label);
      expect(button, label).toBeDefined();
      return button!;
    },
    toggles: () => nodes(app).filter(node => node.tagName === "BUTTON" && /^(Select for comparison|Selected)$/u.test(node.textContent)),
    input: (renderId: string) => send({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { renderId } }),
    output: (value: unknown) => send({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: value } }),
    respond: (message: Message, result: unknown) => send({ jsonrpc: "2.0", id: message.id, result })
  };
}

it("keeps same-snapshot selections and increasing revisions after a real MCP comparison round trip", async () => {
  const replay = await connectReplay(async () => searchResult([
    product({ handle: "wig-a", title: "Human hair wig A" }),
    product({ handle: "wig-b", title: "Human hair wig B" }),
    product({ handle: "wig-c", title: "Human hair wig C" })
  ]));
  try {
    const found = await replay.client.callTool({ name: "search_products", arguments: { query: "wig", limit: 3 } });
    const snapshot = found.structuredContent as Snapshot;
    expect(snapshot.products).toHaveLength(3);
    const [a, b, c] = snapshot.products.map(entry => entry.selectionId);
    const ui = mount(snapshot);
    let consumed = 0;
    const flush = async () => {
      for (const message of ui.messages.slice(consumed)) {
        consumed++;
        if (!message.params?.name || !["sync_product_card_selection", "compare_selected_products"].includes(message.params.name)) continue;
        const result = await replay.client.callTool({ name: message.params.name, arguments: message.params.arguments });
        expect(result.isError).not.toBe(true);
        ui.respond(message, result);
      }
      await new Promise<void>(resolve => setImmediate(resolve));
    };
    ui.toggles()[0]!.click();
    ui.toggles()[1]!.click();
    await flush();
    ui.button("Compare selected (2)").click();
    await flush();
    ui.button("Back to results").click();
    expect(ui.toggles().map(toggle => toggle.ariaPressed)).toEqual(["true", "true", "false"]);
    ui.toggles()[0]!.click();
    ui.toggles()[2]!.click();
    await flush();
    expect(ui.messages.filter(message => message.params?.name === "sync_product_card_selection").map(message => message.params?.arguments)).toEqual([
      { renderId: snapshot.renderId, selectionIds: [a], revision: 1 },
      { renderId: snapshot.renderId, selectionIds: [a, b], revision: 2 },
      { renderId: snapshot.renderId, selectionIds: [b], revision: 3 },
      { renderId: snapshot.renderId, selectionIds: [b, c], revision: 4 }
    ]);
    const compared = await replay.client.callTool({ name: "compare_selected_products", arguments: { renderId: snapshot.renderId } });
    expect(compared.structuredContent).toMatchObject({ status: "OK", entries: [{ selectionId: b }, { selectionId: c }] });
  } finally { await replay.close(); }
});

it("isolates new and missing render scopes and removes IDs absent from the current snapshot", () => {
  const original = cards("first");
  const ui = mount(original);
  ui.toggles()[0]!.click();
  ui.toggles()[1]!.click();
  ui.output(cards("second", ["x", "y"]));
  expect(ui.toggles().map(toggle => toggle.ariaPressed)).toEqual(["false", "false"]);
  ui.toggles()[0]!.click();
  expect(ui.messages.at(-1)?.params?.arguments).toEqual({ renderId: "second", selectionIds: ["x"], revision: 1 });
  ui.output(original);
  expect(ui.toggles().map(toggle => toggle.ariaPressed)).toEqual(["true", "true", "false"]);
  ui.output(cards("first", ["b", "c"]));
  expect(ui.button("Compare selected (1)").disabled).toBe(true);
  ui.toggles()[1]!.click();
  expect(ui.messages.at(-1)?.params?.arguments).toEqual({ renderId: "first", selectionIds: ["b", "c"], revision: 3 });
  ui.output(cards(undefined));
  expect(ui.toggles().every(toggle => toggle.ariaPressed === "false" && toggle.disabled)).toBe(true);
  expect(ui.button("Compare selected (0)").disabled).toBe(true);
  const before = ui.messages.length;
  ui.toggles()[0]!.click();
  ui.button("Compare selected (0)").click();
  expect(ui.messages).toHaveLength(before);
});

it.each(["first", "second"])("ignores a delayed comparison after cards render again in scope %s", async (nextRenderId) => {
  const ui = mount(cards("first"));
  ui.toggles()[0]!.click();
  ui.toggles()[1]!.click();
  ui.button("Compare selected (2)").click();
  const pending = ui.messages.find(message => message.params?.name === "compare_selected_products")!;
  ui.output(cards(nextRenderId));
  const currentCards = [...ui.app.children];
  ui.respond(pending, { structuredContent: {
    status: "OK", renderId: "first", entries: [{ selectionId: "a", title: "Old A" }, { selectionId: "b", title: "Old B" }]
  } });
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(ui.app.children).toEqual(currentCards);
  expect(ui.toggles()).toHaveLength(3);
});

it("does not replace returned product cards with a delayed delivered-price comparison", async () => {
  const ui = mount(cards("first"));
  ui.toggles()[0]!.click();
  ui.toggles()[1]!.click();
  ui.button("Compare selected (2)").click();
  const comparison = { status: "OK", renderId: "first", entries: [
    { selectionId: "a", title: "Wig A", deliveredTotalStatus: "NOT_QUOTED" },
    { selectionId: "b", title: "Wig B", deliveredTotalStatus: "NOT_QUOTED" }
  ] };
  ui.respond(ui.messages.find(message => message.params?.name === "compare_selected_products")!, { structuredContent: comparison });
  await new Promise<void>(resolve => setImmediate(resolve));
  nodes(ui.app).find(node => node.tagName === "INPUT")!.value = "10001";
  ui.button("Quote delivered totals").click();
  const pending = ui.messages.find(message => message.params?.name === "quote_and_compare_selected_products")!;
  expect(pending).toBeDefined();
  ui.button("Back to results").click();
  const currentCards = [...ui.app.children];
  ui.respond(pending, { structuredContent: comparison });
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(ui.app.children).toEqual(currentCards);
  expect(ui.toggles().map(toggle => toggle.ariaPressed)).toEqual(["true", "true", "false"]);
});

it("ignores obsolete hydration responses and inputs after newer cards arrive", async () => {
  const ui = mount(undefined);
  ui.respond(ui.messages.find(message => message.method === "ui/initialize")!, {});
  await new Promise<void>(resolve => setImmediate(resolve));
  ui.input("first");
  const pending = ui.messages.find(message => message.params?.name === "render_product_cards")!;
  expect(pending).toBeDefined();
  ui.output(cards("second", ["x", "y"]));
  const currentCards = [...ui.app.children];
  ui.input("first");
  ui.respond(pending, { structuredContent: cards("first") });
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(ui.app.children).toEqual(currentCards);
  ui.toggles()[0]!.click();
  expect(ui.messages.at(-1)?.params?.arguments).toEqual({ renderId: "second", selectionIds: ["x"], revision: 1 });
});
