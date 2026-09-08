import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { parseAwinFeedServiceEnvironment } from "../src/environment.js";
import { createAwinFeedController, createAwinFeedHttpServer } from "../src/service.js";

describe("official registry platform negotiation", () => {
  it("keeps legacy clients compatible and isolates representation ETags", async () => {
    const stores = ["SHOPIFY", "WOOCOMMERCE"].map((platform, index) => ({
      brand: `Brand ${index}`, aliases: [], officialHost: `brand${index}.example`, platform,
      productPathPrefixes: ["/products/"], imageHosts: [], evidenceUrl: `https://brand${index}.example/about/`,
      reviewedAt: "2026-09-08", status: "APPROVED"
    }));
    const environment = parseAwinFeedServiceEnvironment({ AWIN_SOURCE_FEED_URL: "https://productdata.awin.com/feed.csv.gz",
      AWIN_FEED_API_TOKEN: "a".repeat(32), FINDCHEAP_OFFICIAL_STOREFRONTS_JSON: JSON.stringify({ version: "woo-reviewed", stores }) });
    const server = createAwinFeedHttpServer(createAwinFeedController(environment), "a".repeat(32),
      { officialStorefronts: environment.officialStorefronts });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing server address");
    const url = `http://127.0.0.1:${address.port}/v1/official-storefronts`;
    try {
      const legacy = await fetch(url);
      expect(legacy.status).toBe(200);
      expect((await legacy.json()).stores.map((store: { platform: string }) => store.platform)).toEqual(["SHOPIFY"]);
      expect(legacy.headers.get("vary")).toBe("x-findcheap-registry-schema");
      const modern = await fetch(url, { headers: { "x-findcheap-registry-schema": "2", "if-none-match": legacy.headers.get("etag")! } });
      expect(modern.status).toBe(200);
      expect((await modern.json()).stores).toEqual(stores);
      expect(modern.headers.get("etag")).not.toBe(legacy.headers.get("etag"));
      for (const [schema, etag] of [["1", legacy.headers.get("etag")!], ["2", modern.headers.get("etag")!]]) {
        const cached = await fetch(url, { headers: { "x-findcheap-registry-schema": schema!, "if-none-match": etag! } });
        expect(cached.status).toBe(304);
        expect(cached.headers.get("vary")).toBe("x-findcheap-registry-schema");
      }
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
