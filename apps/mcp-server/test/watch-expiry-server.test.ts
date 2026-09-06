import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createShoppingServer } from "../src/server.js";

describe("Watch default expiry MCP contract", () => {
  it.each([true, false])("expires after 30 days with prior Automation binding = %s", async (bindBeforeExpiry) => {
    let current = new Date("2026-09-06T12:00:00.000Z");
    let sourceCalls = 0;
    const server = createShoppingServer({ search: async () => {
      sourceCalls += 1;
      throw new Error("NETWORK_FORBIDDEN_IN_WATCH_TEST");
    } }, undefined, { now: () => current });
    const client = new Client({ name: "watch-expiry-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const created = await client.callTool({ name: "create_watch", arguments: {
        query: "Black Lace Dress", condition: "RESTOCKED", identity: { gtin: "1234567890123" },
        conditionPreference: "ANY"
      } });
      const { watchId } = created.structuredContent as { watchId: string };
      expect(created.structuredContent).toMatchObject({ status: "READY_TO_SCHEDULE", intervalMinutes: 60 });
      if (bindBeforeExpiry) {
        current = new Date("2026-10-06T11:59:59.999Z");
        const bound = await client.callTool({ name: "bind_watch_automation", arguments: { watchId, automationId: "test-only-automation" } });
        expect(bound.structuredContent).toMatchObject({ status: "ACTIVE" });
      }
      current = new Date("2026-10-06T12:00:00.000Z");
      const checked = await client.callTool({ name: "check_watch", arguments: { watchId } });
      const rebound = await client.callTool({ name: "bind_watch_automation", arguments: { watchId, automationId: "test-only-automation" } });

      expect(checked.structuredContent).toMatchObject({ status: "EXPIRED", watchId });
      expect(rebound.structuredContent).toMatchObject({ status: "EXPIRED", watchId });
      expect(sourceCalls).toBe(0);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
