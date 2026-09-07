import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { PRODUCT_CARD_HTML } from "../src/product-card-ui.js";
import { PRODUCT_COMPARISON_HTML } from "../src/product-comparison-ui.js";

class Node {
  children: Node[] = [];
  textContent = "";
  className = "";
  value = "";
  disabled = false;
  listeners = new Map<string, () => void>();
  constructor(readonly tagName: string) {}
  append(...nodes: Node[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Node[]) { this.children = nodes; }
  setAttribute() {}
  remove() {}
  addEventListener(type: string, callback: () => void) { this.listeners.set(type, callback); }
  click() { this.listeners.get("click")?.(); }
}
const all = (node: Node): Node[] => [node, ...node.children.flatMap(all)];
const text = (node: Node): string => all(node).map(value => value.textContent).join(" ");
const output = (locale: string, renderId = "original") => ({ status: "OK", locale, renderId, comparisonId: "comparison",
  entries: ["a", "b"].map(selectionId => ({ selectionId, title: `Product ${selectionId}`, deliveredTotalStatus: "NOT_QUOTED" })) });
type Message = { id?: number; method?: string; params?: { name?: string; arguments?: unknown }; result?: unknown; error?: unknown };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function harness(html: string, locale = "zh-CN") {
  const app = new Node("MAIN");
  const messages: Message[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const timers = new Map<number, { at: number; callback: () => void }>();
  let now = 0;
  let nextTimer = 0;
  const parent = { postMessage: (message: Message) => messages.push(message) };
  const window = { parent, openai: { toolOutput: output(locale) },
    addEventListener: (type: string, callback: (event: unknown) => void) => listeners.set(type, callback),
    setTimeout: (callback: () => void, delay = 0) => { const id = ++nextTimer; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout: (id: number) => timers.delete(id), requestAnimationFrame: (callback: () => void) => { callback(); return 1; }
  };
  const document = { getElementById: () => app, createElement: (tag: string) => new Node(tag.toUpperCase()),
    documentElement: { dataset: {}, scrollWidth: 700, scrollHeight: 320 }, body: { scrollWidth: 700, scrollHeight: 320 } };
  vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/u)![1]!, { window, document, URL, Intl, Number, String, Array, Object, Promise, Map, Set, Math, Date });
  const deliver = (data: unknown, source: unknown = parent) => listeners.get("message")?.({ source, data });
  const button = all(app).find(node => node.tagName === "BUTTON" && /查询到手价|Quote delivered/.test(node.textContent))!;
  const input = all(app).find(node => node.tagName === "INPUT")!;
  const calls = () => messages.filter(message => message.params?.name === "quote_and_compare_selected_products");
  return { app, button, calls, deliver, start: () => { input.value = "33065"; button.click(); },
    respond: (result: unknown) => deliver({ jsonrpc: "2.0", id: calls()[0]!.id, result }),
    advance: async (milliseconds: number) => { now += milliseconds;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
      await flush();
    }
  };
}

describe.each([["standalone", PRODUCT_COMPARISON_HTML], ["embedded", PRODUCT_CARD_HTML]])("%s quote feedback", (_surface, html) => {
  it.each([
    ["QUOTE_AUTHORIZATION_DECLINED", "宿主未授予"], ["QUOTE_AUTHORIZATION_UNAVAILABLE", "授权不可用"],
    ["QUOTE_AUTHORIZATION_CANCELLED", "授权已取消"], ["PERMISSION_DENIED", "宿主未授予"],
    ["MISSING_REFERENCE_CONTEXT", "原商品引用"], ["QUOTE_REFERENCE_EXPIRED", "原商品引用"],
    ["QUOTE_TARGET_UNVERIFIED", "不支持本次报价"], ["QUOTE_RESULT_DISCARDED", "结果尚不确定"],
    ["UNRECOGNIZED", "结果尚不确定"]
  ])("preserves comparison and distinguishes %s without blind retry", async (code, expected) => {
    const ui = harness(html!);
    ui.start();
    ui.respond({ isError: true, content: [{ type: "text", text: `[${code}] private-token-do-not-display` }] });
    await flush();
    expect(text(ui.app)).toContain(expected);
    expect(text(ui.app)).toContain("Product a");
    expect(text(ui.app)).not.toMatch(/请重试一次|private-token|Try once more/);
    expect(ui.button.disabled).toBe(true);
    ui.button.click();
    expect(ui.calls()).toHaveLength(1);
  });
  it("keeps waiting after eight seconds and accepts a bound success after consent", async () => {
    const ui = harness(html!);
    ui.start();
    await ui.advance(9000);
    expect(ui.button.disabled).toBe(true);
    expect(text(ui.app)).toContain("等待授权或报价结果");
    ui.respond({ structuredContent: { ...output("zh-CN"), message: "报价完成",
      entries: output("zh-CN").entries.map(entry => ({ ...entry, deliveredTotalStatus: "QUOTED" })) } });
    await flush();
    expect(text(ui.app)).toContain("报价完成");
    expect(ui.calls()).toHaveLength(1);
  });
  it("times out to unknown outcome, ignores late responses and never repeats a write", async () => {
    const ui = harness(html!);
    ui.start();
    await ui.advance(36000);
    expect(text(ui.app)).toContain("结果尚不确定");
    expect(text(ui.app)).toContain("可能已创建");
    expect(ui.button.disabled).toBe(true);
    ui.respond({ structuredContent: { ...output("zh-CN"), message: "LATE-RESULT" } });
    await flush();
    expect(text(ui.app)).not.toContain("LATE-RESULT");
    expect(ui.calls()).toHaveLength(1);
  });
  it("does not overwrite a newer view or accept a forged host response", async () => {
    const ui = harness(html!);
    ui.start();
    ui.deliver({ jsonrpc: "2.0", id: ui.calls()[0]!.id, result: { structuredContent: { ...output("zh-CN"), message: "FORGED" } } }, {});
    await flush();
    expect(text(ui.app)).not.toContain("FORGED");
    ui.deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { ...output("zh-CN", "new-view"), message: "NEW-VIEW" } } });
    ui.respond({ structuredContent: { ...output("zh-CN"), message: "OLD-VIEW" } });
    await flush();
    expect(text(ui.app)).toContain("NEW-VIEW");
    expect(text(ui.app)).not.toContain("OLD-VIEW");
  });
  it("uses current English locale for unknown RPC failures", async () => {
    const ui = harness(html!, "en-US"); ui.start();
    ui.deliver({ jsonrpc: "2.0", id: ui.calls()[0]!.id, error: { code: -32000, message: "private-token" } });
    await flush();
    expect(text(ui.app)).toContain("Quote outcome is unknown");
    expect(text(ui.app)).not.toMatch(/private-token|重试/);
  });
  it("rejects a successful response for different selections", async () => {
    const ui = harness(html!); ui.start(); ui.button.click();
    expect(ui.calls()).toHaveLength(1);
    ui.respond({ structuredContent: { ...output("zh-CN"), message: "WRONG-SELECTION",
      entries: [{ selectionId: "c" }, { selectionId: "d" }] } });
    await flush();
    expect(text(ui.app)).toContain("结果尚不确定");
    expect(text(ui.app)).not.toContain("WRONG-SELECTION");
  });
});
