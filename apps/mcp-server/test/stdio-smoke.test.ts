import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type StdioServerConfig = {
  type: "stdio";
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
};

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const pluginRoot = path.join(repoRoot, "plugins", "shopping-agent");

describe("installed plugin stdio", () => {
  it("uses .mcp.json to initialize the committed bundle with protocol-clean stdout", async () => {
    const mcpFile = JSON.parse(
      await readFile(path.join(pluginRoot, ".mcp.json"), "utf8")
    ) as { mcpServers: { "shopping-agent": StdioServerConfig } };
    const config = mcpFile.mcpServers["shopping-agent"];
    expect(config).toEqual({
      type: "stdio",
      command: "node",
      args: ["./dist/mcp-server.js"],
      cwd: ".",
      env: {
        SHOPIFY_STOREFRONT_MODE: "audited-registry",
        SHOPIFY_SEARCH_TIMEOUT_MS: "3000"
      }
    });

    const transportErrors: Error[] = [];
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd: path.resolve(pluginRoot, config.cwd),
      env: { ...definedEnvironment(), ...config.env },
      stderr: "pipe"
    });
    transport.onerror = (error) => transportErrors.push(error);
    const client = new Client({ name: "shopping-agent-stdio-smoke", version: "0.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const comparison = await client.callTool({
        name: "compare_products",
        arguments: { query: "OLED65C4PUA", zipCode: "33433" }
      });

      expect(tools.tools.map((tool) => tool.name)).toEqual([
        "compare_products",
        "search_bestbuy_products",
        "search_shopify_products"
      ]);
      expect(comparison.structuredContent).toEqual({
        status: "DATA_SOURCE_UNAVAILABLE",
        message: "Live comparison is unavailable because no approved shopping data source is connected.",
        exactOffers: [],
        similarOffers: [],
        questions: []
      });
      const bestBuy = await client.callTool({
        name: "search_bestbuy_products",
        arguments: { query: "Sony WH-1000XM5", limit: 5 }
      });
      expect(bestBuy.structuredContent).toMatchObject({
        status: "DATA_SOURCE_UNAVAILABLE",
        merchant: "Best Buy",
        priceScope: "ITEM_PRICE_ONLY",
        products: []
      });
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
});

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
