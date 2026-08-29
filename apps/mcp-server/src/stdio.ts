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
import { createAwinFeedPort } from "../../../packages/awin-feed/src/index.js";
import { createAwinShopifyQuoteResolver } from "./awin-shopify-quote.js";
import { createEbayPortFromEnvironment } from "./ebay-client.js";
import { createOfficialShopifySearchPort } from "./shopify-official-store-search.js";
import { createVisualCandidateImagePort } from "./visual-candidate-images.js";
import { productCardResourceDomains } from "./product-card-ui.js";
import { createOfficialStorefrontRegistryPortFromEnvironment } from "./official-storefront-registry-client.js";

const comparePort = createComparePortFromEnvironment(process.env, createUnavailableComparePort);
const shopifyPort = createShopifyPortFromEnvironment(process.env);
const dealPort = createDealPortFromEnvironment(process.env);
const cartQuotePort = createShopifyCartQuotePort(process.env);
const awinPort = createAwinFeedPort(process.env);
const ebayPort = createEbayPortFromEnvironment(process.env);
const officialStorefrontRegistry = createOfficialStorefrontRegistryPortFromEnvironment(process.env);
const stateDirectory = process.env.FINDCHEAP_STATE_DIR ?? join(homedir(), ".findcheap-agent", "watches-v1");
const server = createShoppingServer(comparePort, shopifyPort, undefined, {
  awin: awinPort,
  ...(ebayPort === undefined ? {} : { ebay: ebayPort }),
  awinShopifyQuotes: createAwinShopifyQuoteResolver(),
  deals: dealPort,
  cartQuotes: cartQuotePort,
  selectedProducts: createShopifySelectedProductInspector(),
  officialShopify: createOfficialShopifySearchPort({
    ...(officialStorefrontRegistry === undefined ? {} : { imageProxyOrigin: officialStorefrontRegistry.imageProxyOrigin })
  }),
  ...(officialStorefrontRegistry === undefined ? {} : { officialStorefrontRegistry }),
  visualCandidateImages: createVisualCandidateImagePort(),
  watches: createJsonWatchStore(stateDirectory),
  productCardResourceDomains: productCardResourceDomains(process.env.AWIN_PRODUCT_SEARCH_URL),
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
