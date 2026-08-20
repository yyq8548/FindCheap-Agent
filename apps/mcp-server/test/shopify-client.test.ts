import { describe, expect, it, vi } from "vitest";

import { createShopifyPortFromEnvironment } from "../src/shopify-client.js";

describe("Shopify client routing", () => {
  it("fails closed unless the Global Catalog mode is explicitly enabled", async () => {
    const fetch = vi.fn();
    const port = createShopifyPortFromEnvironment({}, { fetch });

    await expect(port.search({ query: "coffee", limit: 3 })).rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("routes explicit global mode to the Shopify Global Catalog client", async () => {
    const fetch = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(
      async () => new Response("{}", { status: 503 })
    );
    const port = createShopifyPortFromEnvironment({
      SHOPIFY_CATALOG_MODE: "global",
      SHOPIFY_AGENT_PROFILE_URL: "https://merchant.example/agent-profile.json"
    }, { fetch });

    await expect(port.search({ query: "coffee", limit: 3 })).rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe("https://catalog.shopify.com/api/ucp/mcp");
  });
});
