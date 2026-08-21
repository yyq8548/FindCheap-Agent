import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import http from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type StdioServerConfig = {
  type: "stdio";
  command: string;
  args: string[];
  cwd: string;
  enabled: boolean;
  env_vars: string[];
  startup_timeout_sec: number;
  tool_timeout_sec: number;
  env: Record<string, string>;
};

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const pluginRoot = path.join(repoRoot, "plugins", "findcheap-agent");

describe("installed plugin stdio", () => {
  it("uses .mcp.json to initialize the committed bundle with protocol-clean stdout", async () => {
    const mcpFile = JSON.parse(
      await readFile(path.join(pluginRoot, ".mcp.json"), "utf8")
    ) as { mcpServers: { "findcheap-agent": StdioServerConfig } };
    const config = mcpFile.mcpServers["findcheap-agent"];
    expect(config).toEqual({
      type: "stdio",
      command: "node",
      args: ["./dist/mcp-server.js"],
      cwd: ".",
      enabled: true,
      env_vars: ["PATH", "FINDCHEAP_DEALS_API_URL", "FINDCHEAP_DEALS_API_TOKEN", "FINDCHEAP_STATE_DIR", "SHOPPING_COMMERCE_API_URL", "SHOPPING_COMMERCE_API_TOKEN"],
      startup_timeout_sec: 10,
      tool_timeout_sec: 30,
      env: {
        SHOPIFY_CATALOG_MODE: "global",
        SHOPIFY_CART_QUOTE_MODE: "tokenless",
        SHOPIFY_CART_QUOTE_TIMEOUT_MS: "2500",
        SHOPIFY_AGENT_PROFILE_URL: "https://cdn.jsdelivr.net/gh/yyq8548/FindCheap-Agent@24267014f0433adefb89181e4123d7b785e30285/plugins/findcheap-agent/ucp-agent-profile.json",
        SHOPIFY_GLOBAL_CATALOG_TIMEOUT_MS: "10000"
      }
    });

    const transportErrors: Error[] = [];
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd: path.resolve(pluginRoot, config.cwd),
      env: { ...unconfiguredEnvironment(), ...config.env },
      stderr: "pipe"
    });
    transport.onerror = (error) => transportErrors.push(error);
    const client = new Client({ name: "shopping-agent-stdio-smoke", version: "0.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const resources = await client.listResources();
      const productCards = await client.readResource({
        uri: "ui://findcheap/product-cards/v17.html"
      });
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        "search_shopify_products",
        "inspect_selected_shopify_product",
        "quote_selected_shopify_product",
        "create_watch",
        "bind_watch_automation",
        "check_watch",
        "list_watches",
        "pause_watch",
        "delete_watch",
        "render_product_cards",
        "report_product_card_metrics"
      ]);
      const shopifyTool = tools.tools.find((tool) => tool.name === "search_shopify_products");
      const quoteTool = tools.tools.find((tool) => tool.name === "quote_selected_shopify_product");
      const renderTool = tools.tools.find((tool) => tool.name === "render_product_cards");
      expect(shopifyTool?._meta).toMatchObject({
        ui: { resourceUri: "ui://findcheap/product-cards/v17.html" },
        "openai/outputTemplate": "ui://findcheap/product-cards/v17.html"
      });
      expect(renderTool?._meta).toMatchObject({
        ui: {
          resourceUri: "ui://findcheap/product-cards/v17.html",
          visibility: ["app"]
        }
      });
      expect(quoteTool?._meta).toMatchObject({
        ui: { resourceUri: "ui://findcheap/product-cards/v17.html" },
        "openai/outputTemplate": "ui://findcheap/product-cards/v17.html"
      });
      expect(resources.resources).toEqual([expect.objectContaining({
        name: "findcheap-product-cards",
        uri: "ui://findcheap/product-cards/v17.html",
        mimeType: "text/html;profile=mcp-app"
      })]);
      expect(productCards.contents).toEqual([expect.objectContaining({
        uri: "ui://findcheap/product-cards/v17.html",
        mimeType: "text/html;profile=mcp-app",
        text: expect.stringContaining("ui/notifications/tool-result")
      })]);
      expect(Object.keys(shopifyTool?.inputSchema.properties ?? {}).sort()).toEqual([
        "comparisonMode",
        "limit",
        "maxItemPriceCents",
        "membershipIds",
        "query",
        "selectionMode",
        "zipCode"
      ]);
      expect(shopifyTool?.inputSchema.required).toContain("selectionMode");
      expect(shopifyTool?.inputSchema.required).toContain("comparisonMode");
      expect(Object.keys(quoteTool?.inputSchema.properties ?? {}).sort()).toEqual([
        "renderId",
        "variantId",
        "zipCode"
      ]);
    } finally {
      await client.close();
    }
    expect(transportErrors).toEqual([]);
  }, 10_000);

  it("uses the configured Commerce API without exposing internal IDs", async () => {
    const token = "stdio-commerce-token-that-is-at-least-32-characters";
    const api = http.createServer((request, response) => {
      expect(request.url).toBe("/v1/comparisons");
      expect(request.headers.authorization).toBe(`Bearer ${token}`);
      request.resume();
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        productId: "internal-product",
        exactOffers: [{
          offerId: "internal-offer",
          merchantId: "internal-merchant",
          sellerName: "Merchant",
          matchStatus: "EXACT",
          regularQuote: quote("internal-regular", 10_000),
          rankingQuote: quote("internal-regular", 10_000),
          merchantUrl: "https://merchant.example/item",
          recommendationReasons: ["GTIN exact"]
        }],
        similarOffers: [],
        questions: []
      }));
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const address = api.address();
    if (address === null || typeof address === "string") throw new Error("test API did not bind TCP");
    const transport = new StdioClientTransport({
      command: "node",
      args: ["./dist/mcp-server.js"],
      cwd: pluginRoot,
      stderr: "pipe",
      env: {
        ...definedEnvironment(),
        SHOPPING_COMMERCE_API_URL: `http://127.0.0.1:${address.port}`,
        SHOPPING_COMMERCE_API_TOKEN: token
      }
    });
    const client = new Client({ name: "configured-stdio-smoke", version: "0.0.0" });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("compare_products");
      const result = await client.callTool({
        name: "compare_products",
        arguments: { query: "OLED65C4PUA", zipCode: "33433" }
      });
      expect(result.structuredContent).toMatchObject({
        status: "OK",
        exactOffers: [{ sellerName: "Merchant" }]
      });
      expect(JSON.stringify(result)).not.toMatch(/internal-/);
    } finally {
      await client.close();
      await new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
    }
  }, 10_000);

  it("persists the Watch-to-Automation lifecycle across MCP restarts", async () => {
    const stateDirectory = await mkdtemp(path.join(tmpdir(), "findcheap-watch-e2e-"));
    let first: Client | undefined;
    let second: Client | undefined;
    try {
      first = await connectBundledClient({ FINDCHEAP_STATE_DIR: stateDirectory });
      const created = await first.callTool({ name: "create_watch", arguments: {
        query: "Sony WH-1000XM5",
        condition: "PRICE_BELOW",
        threshold: 25_000,
        identity: { modelNumber: "WH-1000XM5" },
        conditionPreference: "NEW",
        intervalMinutes: 60
      } });
      const watchId = (created.structuredContent as { watchId: string }).watchId;
      expect(created.structuredContent).toMatchObject({ status: "READY_TO_SCHEDULE" });
      expect((await first.callTool({ name: "bind_watch_automation", arguments: {
        watchId,
        automationId: "findcheap-sony-xm5"
      } })).structuredContent).toMatchObject({ status: "ACTIVE" });
      await first.close();
      first = undefined;

      second = await connectBundledClient({ FINDCHEAP_STATE_DIR: stateDirectory });
      expect((await second.callTool({ name: "list_watches", arguments: {} })).structuredContent).toMatchObject({
        watches: [{ watchId, monitoringStatus: "ACTIVE", automationId: "findcheap-sony-xm5" }]
      });
      expect((await second.callTool({ name: "pause_watch", arguments: {
        watchId,
        paused: true,
        automationId: "findcheap-sony-xm5"
      } })).structuredContent).toMatchObject({ status: "PAUSED" });
      expect((await second.callTool({ name: "delete_watch", arguments: {
        watchId,
        automationId: "findcheap-sony-xm5"
      } })).structuredContent).toMatchObject({ status: "DELETED", deleted: true });
    } finally {
      await first?.close();
      await second?.close();
      await rm(stateDirectory, { recursive: true, force: true });
    }
  }, 10_000);
});

async function connectBundledClient(extraEnvironment: Record<string, string>): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["./dist/mcp-server.js"],
    cwd: pluginRoot,
    stderr: "pipe",
    env: { ...unconfiguredEnvironment(), ...extraEnvironment }
  });
  const client = new Client({ name: "watch-lifecycle-stdio-smoke", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

function quote(quoteId: string, amountCents: number) {
  return {
    quoteId,
    offerId: "internal-offer",
    status: "VERIFIED",
    deliveredPrice: { amountCents, currency: "USD" },
    lineItems: [{
      kind: "ITEM",
      amount: { amountCents, currency: "USD" },
      label: "Item price"
    }],
    eligibilityConditions: [],
    evidenceRefs: ["internal-evidence"],
    checkedAt: "2026-08-13T12:00:00.000Z",
    expiresAt: "2026-08-13T12:15:00.000Z"
  };
}

function definedEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

function unconfiguredEnvironment(): Record<string, string> {
  const environment = definedEnvironment();
  delete environment.FINDCHEAP_DEALS_API_URL;
  delete environment.FINDCHEAP_DEALS_API_TOKEN;
  delete environment.SHOPPING_COMMERCE_API_URL;
  delete environment.SHOPPING_COMMERCE_API_TOKEN;
  return environment;
}
