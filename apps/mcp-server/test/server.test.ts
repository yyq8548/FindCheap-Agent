import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import type { ComparisonResult } from "../../../packages/contracts/src/index.js";
import {
  createShoppingServer,
  createUnavailableComparePort,
  type ComparePort
} from "../src/server.js";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function connect(port: ComparePort) {
  const server = createShoppingServer(port);
  const client = new Client({ name: "shopping-agent-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

const quote = (quoteId: string, offerId: string, amountCents: number) => ({
  quoteId,
  offerId,
  status: "VERIFIED" as const,
  deliveredPrice: { amountCents, currency: "USD" as const },
  lineItems: [{
    kind: "ITEM" as const,
    amount: { amountCents, currency: "USD" as const },
    label: "ITEM"
  }],
  eligibilityConditions: [],
  evidenceRefs: ["provider-secret-evidence"],
  checkedAt: "2026-08-13T12:00:00.000Z",
  expiresAt: "2026-08-13T12:15:00.000Z"
});

const comparison: ComparisonResult = {
  productId: "internal-product-id",
  exactOffers: [{
    offerId: "internal-offer-id",
    merchantId: "internal-merchant-id",
    sellerName: "Merchant One",
    matchStatus: "EXACT",
    regularQuote: quote("internal-regular-quote-id", "internal-offer-id", 109_999),
    memberQuote: {
      programId: "internal-program-id",
      programName: "Warehouse Club",
      eligible: true,
      quote: quote("internal-member-quote-id", "internal-offer-id", 99_999)
    },
    rankingQuote: quote("internal-member-quote-id", "internal-offer-id", 99_999),
    merchantUrl: "https://merchant.example/products/tv",
    recommendationReasons: ["Exact manufacturer part number"]
  }],
  similarOffers: [{
    offerId: "internal-similar-offer-id",
    merchantId: "internal-similar-merchant-id",
    sellerName: "Merchant Two",
    matchStatus: "SIMILAR",
    merchantUrl: "https://merchant.example/products/similar-tv",
    recommendationReasons: ["Same family, different size"]
  }],
  questions: []
};

describe("shopping MCP server", () => {
  it("discovers only the read-only compare_products tool", async () => {
    const client = await connect({ compare: async () => comparison });

    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name)).toEqual(["compare_products"]);
    expect(Object.keys(tools.tools[0]?.inputSchema.properties ?? {}).sort()).toEqual([
      "membershipIds",
      "query",
      "zipCode"
    ]);
    expect(tools.tools[0]?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false
    });
    expect(tools.tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/order|checkout|payment/i)
    ]));
  });

  it.each([
    { query: "OLED65C4PUA", zipCode: "3343" },
    { query: "OLED65C4PUA", zipCode: "33433-123" },
    { query: "OLED65C4PUA", zipCode: "ABCDE" },
    { query: " ", zipCode: "33433" },
    { query: "OLED65C4PUA", zipCode: "33433", membershipIds: ["costco", "costco"] },
    { query: "OLED65C4PUA", zipCode: "33433", arbitraryUrl: "https://untrusted.example" }
  ])("rejects invalid input %#", async (args) => {
    let compareCalls = 0;
    const client = await connect({
      compare: async () => {
        compareCalls += 1;
        return comparison;
      }
    });

    const result = await client.callTool({ name: "compare_products", arguments: args });

    expect(result.isError).toBe(true);
    expect(compareCalls).toBe(0);
  });

  it("returns an explicit unavailable result without fabricated offers", async () => {
    const client = await connect(createUnavailableComparePort());

    const result = await client.callTool({
      name: "compare_products",
      arguments: { query: "OLED65C4PUA", zipCode: "33433" }
    });

    expect(result.structuredContent).toEqual({
      status: "DATA_SOURCE_UNAVAILABLE",
      message: "Live comparison is unavailable because no approved shopping data source is connected.",
      exactOffers: [],
      similarOffers: [],
      questions: []
    });
    expect(result.content).toEqual([{
      type: "text",
      text: "Live comparison is unavailable because no approved shopping data source is connected."
    }]);
  });

  it("preserves user-facing comparison detail without exposing provider IDs or secrets", async () => {
    const client = await connect({ compare: async () => comparison });

    const result = await client.callTool({
      name: "compare_products",
      arguments: {
        query: "OLED65C4PUA",
        zipCode: "33433-1234",
        membershipIds: ["warehouse-club"]
      }
    });

    expect(result.structuredContent).toMatchObject({
      status: "OK",
      exactOffers: [{
        sellerName: "Merchant One",
        matchStatus: "EXACT",
        regularQuote: { deliveredPrice: { amountCents: 109_999, currency: "USD" } },
        memberQuote: {
          programName: "Warehouse Club",
          eligible: true,
          quote: { deliveredPrice: { amountCents: 99_999, currency: "USD" } }
        }
      }],
      similarOffers: [{ sellerName: "Merchant Two", matchStatus: "SIMILAR" }]
    });
    expect(result.content).toEqual([{
      type: "text",
      text: "Comparison complete: 1 exact and 1 similar result(s)."
    }]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/internal-|provider-secret/);
  });
});
