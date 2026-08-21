import { join } from "node:path";
import { homedir } from "node:os";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createComparePortFromEnvironment, hasCommerceApiConfiguration } from "./commerce-client.js";
import { createShoppingServer, createUnavailableComparePort } from "./server.js";
import { createShopifyPortFromEnvironment } from "./shopify-client.js";
import { createDealPortFromEnvironment, hasDealProviderConfiguration } from "./deal-client.js";
import { createJsonWatchStore } from "./watch-store.js";
import { createShopifyCartQuotePort } from "./shopify-cart-quote.js";
import { createShopifySelectedProductInspector } from "./shopify-selected-product.js";

const comparePort = createComparePortFromEnvironment(process.env, createUnavailableComparePort);
const shopifyPort = createShopifyPortFromEnvironment(process.env);
const dealPort = createDealPortFromEnvironment(process.env);
const cartQuotePort = createShopifyCartQuotePort(process.env);
const stateDirectory = process.env.FINDCHEAP_STATE_DIR ?? join(homedir(), ".findcheap-agent", "watches-v1");
const server = createShoppingServer(comparePort, shopifyPort, undefined, {
  deals: dealPort,
  cartQuotes: cartQuotePort,
  selectedProducts: createShopifySelectedProductInspector(),
  watches: createJsonWatchStore(stateDirectory),
  toolAvailability: {
    commerceCompare: hasCommerceApiConfiguration(process.env),
    verifiedDeals: hasDealProviderConfiguration(process.env)
  }
});

try {
  await server.connect(new StdioServerTransport());
} catch {
  console.error("FindCheap Agent MCP server failed to start.");
  process.exitCode = 1;
}
