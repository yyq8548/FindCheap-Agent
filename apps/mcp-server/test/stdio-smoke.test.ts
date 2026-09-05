import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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
const pluginRoot = process.env.FINDCHEAP_PLUGIN_ROOT ?? path.join(repoRoot, "plugins", "findcheap-agent");

describe("installed plugin stdio", () => {
  it("publishes bounded visual observations and returns safe correction details before provider execution", async () => {
    const client = await connectBundledClient({});
    try {
      const tools = await client.listTools();
      const visualTool = tools.tools.find((tool) => tool.name === "search_visual_candidates");
      expect(visualTool).toBeDefined();
      const schema = visualTool!.inputSchema;
      const property = (node: Record<string, unknown>, key: string) =>
        resolveSchemaReference(schema, (node.properties as Record<string, unknown> | undefined)?.[key]);
      const observations = property(property(schema, "visualInput"), "observations");
      expect(observations.maxItems).toBe(24);
      const observation = resolveSchemaReference(schema, observations.items);
      expect(property(observation, "value")).toMatchObject({ type: "string", maxLength: 240 });
      expect(property(observation, "confidence")).toMatchObject({ minimum: 0, maximum: 1 });
      expect(property(observation, "visibility")).toMatchObject({ enum: ["VISIBLE", "PARTIAL", "OCCLUDED", "UNKNOWN"] });
      // Deliberately invalid: the provider handler must never receive this request.
      const privateValue = `private-fixture-${"x".repeat(241)}`;
      const invalid = await client.callTool({
        name: "search_visual_candidates",
        arguments: {
          query: "DOEN dress", contextMode: "NEW_PRODUCT", responseLocale: "zh-CN",
          visualInput: { productType: "dress", observations: [{ attribute: "DETAIL", value: privateValue, confidence: 0.9 }] }
        }
      });
      const expectedDetails = {
        phase: "INPUT_VALIDATION",
        recovery: { action: "CORRECT_ARGUMENTS", maxAttempts: 1 },
        issues: [{ path: "visualInput.observations[0].value", code: "TOO_LONG", maximum: 240, action: "SHORTEN_TEXT" }]
      };
      expect(invalid.isError).toBe(true);
      expect(invalid._meta).toMatchObject({
        "findcheap/errorCode": "INVALID_ARGUMENTS",
        "findcheap/errorDetails": expectedDetails
      });
      const content = invalid.content as Array<{ type: string; text?: string }>;
      const modelText = content.find((entry) => entry.type === "text")?.text ?? "";
      expect(modelText).toContain("[INVALID_ARGUMENTS]");
      expect(JSON.parse(modelText.slice(modelText.indexOf("\n") + 1))).toMatchObject(expectedDetails);
      expect(JSON.stringify(invalid)).not.toContain(privateValue);
      expect(invalid.structuredContent).toBeUndefined();
    } finally {
      await client.close();
    }
  }, 10_000);

  it("uses .mcp.json to initialize the selected plugin bundle with protocol-clean stdout", async () => {
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
      env_vars: ["PATH", "FINDCHEAP_DEALS_API_URL", "FINDCHEAP_DEALS_API_TOKEN", "FINDCHEAP_STATE_DIR"],
      startup_timeout_sec: 10,
      tool_timeout_sec: 30,
      env: {
        SHOPIFY_CATALOG_MODE: "global",
        SHOPIFY_CART_QUOTE_MODE: "tokenless",
        SHOPIFY_CART_QUOTE_TIMEOUT_MS: "2500",
        AWIN_PRODUCT_SEARCH_URL: "https://findcheap-agent-production.up.railway.app/v1/search",
        AWIN_PRODUCT_SEARCH_TIMEOUT_MS: "5000",
        AWIN_OFFERS_SEARCH_URL: "https://findcheap-agent-production.up.railway.app/v1/offers/search",
        EBAY_PRODUCT_SEARCH_URL: "https://findcheap-agent-production.up.railway.app/v1/ebay/search",
        EBAY_PRODUCT_SEARCH_TIMEOUT_MS: "5000",
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
        uri: "ui://findcheap/product-cards/v34.html"
      });
      const productComparison = await client.readResource({
        uri: "ui://findcheap/product-comparison/v4.html"
      });
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        "search_products",
        "begin_web_search",
        "complete_web_search",
        "search_visual_candidates",
        "finalize_visual_search",
        "search_shopify_products",
        "search_awin_products",
        "inspect_selected_shopify_product",
        "quote_selected_shopify_product",
        "quote_and_compare_selected_products",
        "research_selected_product_deal",
        "compare_selected_products",
        "render_product_comparison",
        "find_coupons",
        "create_watch",
        "bind_watch_automation",
        "check_watch",
        "list_watches",
        "pause_watch",
        "delete_watch",
        "render_product_cards",
        "sync_product_card_selection",
        "report_product_card_metrics"
      ]);
      const shopifyTool = tools.tools.find((tool) => tool.name === "search_products");
      const quoteTool = tools.tools.find((tool) => tool.name === "quote_selected_shopify_product");
      const quotedComparisonTool = tools.tools.find((tool) => tool.name === "quote_and_compare_selected_products");
      const dealResearchTool = tools.tools.find((tool) => tool.name === "research_selected_product_deal");
      const visualFinalizeTool = tools.tools.find((tool) => tool.name === "finalize_visual_search");
      const renderTool = tools.tools.find((tool) => tool.name === "render_product_cards");
      const compareTool = tools.tools.find((tool) => tool.name === "compare_selected_products");
      const renderComparisonTool = tools.tools.find((tool) => tool.name === "render_product_comparison");
      expect(shopifyTool?._meta).toMatchObject({
        ui: { resourceUri: "ui://findcheap/product-cards/v34.html" },
        "openai/outputTemplate": "ui://findcheap/product-cards/v34.html"
      });
      expect(renderTool?._meta).toMatchObject({
        ui: {
          resourceUri: "ui://findcheap/product-cards/v34.html",
          visibility: ["app"]
        }
      });
      expect(quoteTool?._meta).toMatchObject({
        ui: { resourceUri: "ui://findcheap/product-cards/v34.html" },
        "openai/outputTemplate": "ui://findcheap/product-cards/v34.html"
      });
      expect(quotedComparisonTool?._meta).toMatchObject({
        ui: { resourceUri: "ui://findcheap/product-comparison/v4.html" },
        "openai/outputTemplate": "ui://findcheap/product-comparison/v4.html"
      });
      expect(quotedComparisonTool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
      expect(visualFinalizeTool?._meta).toMatchObject({
        ui: { resourceUri: "ui://findcheap/product-cards/v34.html" },
        "openai/outputTemplate": "ui://findcheap/product-cards/v34.html"
      });
      expect(compareTool?._meta).toMatchObject({
        ui: { resourceUri: "ui://findcheap/product-comparison/v4.html" },
        "openai/outputTemplate": "ui://findcheap/product-comparison/v4.html"
      });
      expect(compareTool?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(renderComparisonTool?._meta).toMatchObject({
        ui: {
          resourceUri: "ui://findcheap/product-comparison/v4.html",
          visibility: ["app"]
        }
      });
      expect(resources.resources).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: "findcheap-product-cards",
          uri: "ui://findcheap/product-cards/v34.html",
          mimeType: "text/html;profile=mcp-app"
        }),
        expect.objectContaining({
          name: "findcheap-product-comparison",
          uri: "ui://findcheap/product-comparison/v4.html",
          mimeType: "text/html;profile=mcp-app"
        })
      ]));
      expect(resources.resources).toHaveLength(2);
      expect(productCards.contents).toEqual([expect.objectContaining({
        uri: "ui://findcheap/product-cards/v34.html",
        mimeType: "text/html;profile=mcp-app",
        text: expect.stringContaining("ui/notifications/tool-result")
      })]);
      expect(productComparison.contents).toEqual([expect.objectContaining({
        uri: "ui://findcheap/product-comparison/v4.html",
        mimeType: "text/html;profile=mcp-app",
        text: expect.stringContaining('make("table")')
      })]);
      const comparisonHtml = productComparison.contents[0] !== undefined && "text" in productComparison.contents[0]
        ? productComparison.contents[0].text
        : "";
      expect(comparisonHtml).toContain("暂无已验证优惠");
      expect(comparisonHtml).toContain("价格更低");
      expect(comparisonHtml).toContain("暂无已知限制");
      expect(Object.keys(shopifyTool?.inputSchema.properties ?? {}).sort()).toEqual([
        "allowAlternatives",
        "brand",
        "brandMode",
        "budgetFlexible",
        "clearConstraints",
        "comparisonMode",
        "conditionPreference",
        "contextMode",
        "excludedFeatures",
        "featureMode",
        "features",
        "goalId",
        "goalRevision",
        "limit",
        "maxItemPriceCents",
        "membershipIds",
        "parentRenderId",
        "preferences",
        "preferredSize",
        "primaryUse",
        "productType",
        "query",
        "removeRequiredFeatures",
        "requiredFeatures",
        "requiredSize",
        "responseLocale",
        "selectionMode",
        "visualInput",
        "zipCode"
      ]);
      expect(shopifyTool?.inputSchema.required).toEqual(["query"]);
      const invalid = await client.callTool({ name: "search_products", arguments: {} });
      expect(invalid._meta).toMatchObject({ "findcheap/errorCode": "INVALID_ARGUMENTS" });
      expect(JSON.stringify(invalid)).not.toContain("Input validation error");
      const unavailableComparison = await client.callTool({
        name: "render_product_comparison",
        arguments: { comparisonId: "11111111-1111-4111-8111-111111111111" }
      });
      expect(unavailableComparison._meta).toMatchObject({
        "findcheap/errorCode": "TOOL_REQUEST_REJECTED"
      });
      expect(Object.keys(quoteTool?.inputSchema.properties ?? {}).sort()).toEqual([
        "position",
        "renderId",
        "selectionId",
        "variantId",
        "zipCode"
      ]);
      expect(quoteTool?.inputSchema.required).toEqual(["renderId", "zipCode"]);
      expect(Object.keys(compareTool?.inputSchema.properties ?? {}).sort()).toEqual([
        "focus",
        "mode",
        "renderId",
        "responseLocale",
        "selectionIds"
      ]);
      expect(compareTool?.inputSchema.required).toEqual(["renderId"]);
      expect([...(quotedComparisonTool?.inputSchema.required ?? [])].sort()).toEqual(["renderId", "zipCode"]);
      expect(dealResearchTool?.inputSchema.required).toEqual(["renderId"]);
      expect(dealResearchTool?.inputSchema.properties).toHaveProperty("position");
    } finally {
      await client.close();
    }
    expect(transportErrors).toEqual([]);
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
        priceBasis: "ITEM_PRICE",
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

function resolveSchemaReference(root: Record<string, unknown>, value: unknown): Record<string, unknown> {
  for (let depth = 0; depth < 8; depth += 1) {
    if (value === null || typeof value !== "object") return {};
    const node = value as Record<string, unknown>;
    if (typeof node.$ref !== "string" || !node.$ref.startsWith("#/")) return node;
    value = node.$ref.slice(2).split("/").reduce<unknown>((current, key) =>
      current !== null && typeof current === "object"
        ? (current as Record<string, unknown>)[key.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined, root);
  }
  throw new Error("Published schema reference chain exceeded test limit");
}

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

function definedEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

function unconfiguredEnvironment(): Record<string, string> {
  const environment = definedEnvironment();
  delete environment.FINDCHEAP_DEALS_API_URL;
  delete environment.FINDCHEAP_DEALS_API_TOKEN;
  delete environment.AWIN_OFFERS_SEARCH_URL;
  return environment;
}
