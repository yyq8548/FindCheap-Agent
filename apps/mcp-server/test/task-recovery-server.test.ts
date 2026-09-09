import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createTaskStateStore } from "../src/task-state-store.js";
import { connectReplay, product, REPLAY_NOW, searchResult } from "./fixtures/conversation-replay-support.js";
import type { ProductCardContent } from "../src/server.js";

describe("task-bound server recovery (synthetic sources)", () => {
  it("restores original selection and comparison IDs, isolates another task, and continues old requirements", async () => {
    const directory = mkdtempSync(join(tmpdir(), "findcheap-recovery-test-")), taskId = randomUUID();
    const store = createTaskStateStore(join(directory, "state.sqlite"));
    const search = vi.fn(async () => searchResult([product(), product({ handle: "second", merchantUrl: "https://ishowbeauty.com/products/second" })]));
    const metadata = { threadId: taskId };
    const first = await connectReplay(search, { taskState: store, webProducts: { read: async () => { throw new Error("unexpected read"); } } }, undefined, "codex-mcp-client");
    let original!: ProductCardContent, comparisonId!: string;
    try {
      const found = await first.client.callTool({ name: "search_products", arguments: { query: "short human hair wig", maxItemPriceCents: 5000 }, _meta: metadata });
      expect(found.isError, JSON.stringify(found.content)).not.toBe(true);
      original = found.structuredContent as ProductCardContent;
      const selectionIds = original.products.map(p => p.selectionId!);
      expect(selectionIds).toHaveLength(2);
      await first.client.callTool({ name: "sync_product_card_selection", arguments: { renderId: original.renderId, selectionIds, revision: 1 }, _meta: metadata });
      const compared = await first.client.callTool({ name: "compare_selected_products", arguments: { renderId: original.renderId }, _meta: metadata });
      comparisonId = (compared.structuredContent as { comparisonId: string }).comparisonId;
      expect(comparisonId, JSON.stringify(compared)).toBeTruthy();
    } finally { await first.close(); }
    const next = await connectReplay(search, { taskState: store, webProducts: { read: async () => { throw new Error("unexpected read"); } } }, undefined, "codex-mcp-client");
    try {
      const restored = await next.client.callTool({ name: "render_product_cards", arguments: { renderId: original.renderId }, _meta: metadata });
      expect(restored.structuredContent).toEqual(original);
      const comparison = await next.client.callTool({ name: "render_product_comparison", arguments: { comparisonId }, _meta: metadata });
      expect(comparison.structuredContent).toMatchObject({ comparisonId, renderId: original.renderId });
      const other = await next.client.callTool({ name: "render_product_cards", arguments: { renderId: original.renderId }, _meta: { threadId: randomUUID() } });
      expect(other.isError).toBe(true);
      const followup = await next.client.callTool({ name: "search_products", arguments: { query: "short human hair wig",
        contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: original.renderId, requiredFeatures: ["black"] }, _meta: metadata });
      expect(followup.isError, JSON.stringify(followup)).not.toBe(true);
      expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ maxItemPriceCents: 5000 }));
      expect(followup.structuredContent).toMatchObject({ goalId: original.goalId, goalRevision: (original.goalRevision ?? 0) + 1 });
      const permission = await next.client.callTool({ name: "begin_web_search", arguments: { renderId: original.renderId }, _meta: metadata });
      expect(permission.isError).toBe(true);
    } finally { await next.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
  });
  it("lets an expired quote snapshot supply history without reviving its quote lifetime", async () => {
    const directory = mkdtempSync(join(tmpdir(), "findcheap-expiry-test-")), id = randomUUID();
    const store = createTaskStateStore(join(directory, "state.sqlite"));
    const search = vi.fn(async () => searchResult([]));
    const first = await connectReplay(search, { taskState: store, webProducts: { read: async () => { throw new Error("unexpected read"); } } }, undefined, "codex-mcp-client");
    let original!: ProductCardContent;
    try {
      const result = await first.client.callTool({ name: "search_products", arguments: { query: "Sony 1000XM5", maxItemPriceCents: 35000 }, _meta: { threadId: id } });
      original = result.structuredContent as ProductCardContent;
    } finally { await first.close(); }
    const next = await connectReplay(search, { taskState: store, selectedProducts: { inspect: async () => { throw new Error("unexpected inspection"); } }, now: () => new Date(REPLAY_NOW.getTime() + 3 * 60 * 60_000) }, undefined, "codex-mcp-client");
    try {
      const inspect = await next.client.callTool({ name: "inspect_selected_product", arguments: { renderId: original.renderId, position: 1 }, _meta: { threadId: id } });
      expect(JSON.stringify(inspect)).toContain("EXPIRED");
      const continued = await next.client.callTool({ name: "search_products", arguments: { query: "Sony WH-1000XM5",
        productType: "over-ear headphones", contextMode: "CONTINUE_PREVIOUS_PRODUCT", parentRenderId: original.renderId }, _meta: { threadId: id } });
      expect(continued.isError, JSON.stringify(continued)).not.toBe(true);
      expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ maxItemPriceCents: 35000 }));
    } finally { await next.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
