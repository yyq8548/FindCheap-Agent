import { join } from "node:path";
import { homedir } from "node:os";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createShoppingServer } from "./server.js";
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
import { createMerchantTrustRegistryPortFromEnvironment } from "./merchant-trust-registry-client.js";
import { createFindCheapBackend } from "./backend.js";
import { createAffiliateLinkResolver } from "./affiliate-links.js";

const shopifyPort = createShopifyPortFromEnvironment(process.env);
const dealPort = createDealPortFromEnvironment(process.env);
const cartQuotePort = createShopifyCartQuotePort(process.env);
const awinPort = createAwinFeedPort(process.env);
const ebayPort = createEbayPortFromEnvironment(process.env);
const officialStorefrontRegistry = createOfficialStorefrontRegistryPortFromEnvironment(process.env);
const merchantTrustRegistry = createMerchantTrustRegistryPortFromEnvironment(process.env);
const affiliateLinks = createAffiliateLinkResolver();
const stateDirectory = process.env.FINDCHEAP_STATE_DIR ?? join(homedir(), ".findcheap-agent", "watches-v1");
const officialShopify = createOfficialShopifySearchPort({
  ...(officialStorefrontRegistry === undefined ? {} : { imageProxyOrigin: officialStorefrontRegistry.imageProxyOrigin })
});
const backend = createFindCheapBackend({
  catalog: {
    shopify: shopifyPort,
    awin: awinPort,
    ...(ebayPort === undefined ? {} : { ebay: ebayPort }),
    officialShopify,
    ...(officialStorefrontRegistry === undefined ? {} : { officialStorefrontRegistry }),
    ...(merchantTrustRegistry === undefined ? {} : { merchantTrustRegistry })
  },
  product: {
    affiliateLinks,
    awinShopifyQuotes: createAwinShopifyQuoteResolver(),
    cartQuotes: cartQuotePort,
    selectedProducts: createShopifySelectedProductInspector()
  },
  deals: dealPort,
  watches: createJsonWatchStore(stateDirectory),
  visualCandidateImages: createVisualCandidateImagePort(),
  verifiedDeals: hasDealProviderConfiguration(process.env)
});
const server = createShoppingServer(shopifyPort, affiliateLinks, {
  backend,
  productCardResourceDomains: productCardResourceDomains(process.env.AWIN_PRODUCT_SEARCH_URL),
});

try {
  await server.connect(new StdioServerTransport());
} catch {
  console.error("FindCheap Agent MCP server failed to start.");
  process.exitCode = 1;
}
