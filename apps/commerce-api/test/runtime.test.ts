import { describe, expect, it, vi } from "vitest";

import type { Database } from "../../../packages/db/src/client.js";
import type { GateApprovedMerchantConfig } from "../../../scripts/validate-enabled-merchants.js";
import { startCommerceRuntime } from "../src/runtime.js";

describe("Commerce API runtime", () => {
  it("does not create a database or listener when unconfigured", async () => {
    const createDb = vi.fn();
    const runtime = await startCommerceRuntime({
      environment: {},
      factories: { loadConfigs: async () => [], createDatabase: createDb }
    });
    expect(runtime.status).toBe("disabled");
    expect(createDb).not.toHaveBeenCalled();
    await runtime.close();
  });

  it("closes the database when startup connectivity fails", async () => {
    const close = vi.fn(async () => {});
    const db = {
      connect: vi.fn(async () => { throw new Error("connection failed"); }),
      close,
      query: vi.fn(),
      transaction: vi.fn()
    } as unknown as Database;
    await expect(startCommerceRuntime({
      environment: {
        DATABASE_URL: "postgresql://shopping:local-only@127.0.0.1:5432/shopping",
        COMMERCE_API_TOKEN: "x".repeat(32)
      },
      factories: {
        loadConfigs: async () => [approvedEntry()],
        createDatabase: () => db
      }
    })).rejects.toThrow("connection failed");
    expect(close).toHaveBeenCalledOnce();
  });

  it("fails startup when the all-or-nothing merchant gate fails", async () => {
    const createDatabase = vi.fn();
    await expect(startCommerceRuntime({
      environment: {},
      factories: {
        loadConfigs: async () => { throw new Error("merchant configuration gate failed"); },
        createDatabase
      }
    })).rejects.toThrow(/gate failed/);
    expect(createDatabase).not.toHaveBeenCalled();
  });
});

function approvedEntry(): GateApprovedMerchantConfig {
  return {
    merchantId: "approved-shop",
    candidate: {
      id: "approved-shop",
      name: "Approved Shop",
      segment: "general",
      auditState: "approved",
      legalReview: "approved",
      affiliateStatus: "normal_link_only",
      provenSource: "feed",
      allowedHosts: ["data.approved-shop.example"],
      affiliateHosts: [],
      affiliateOrigins: [],
      identityCompleteness: 0.95,
      weightedScore: 90,
      enabled: true
    },
    config: {
      merchantId: "approved-shop",
      allowedHosts: ["data.approved-shop.example"],
      source: {
        type: "feed",
        host: "data.approved-shop.example",
        resourcePath: "/feed.json",
        recordsPath: "products",
        fields: { merchantProductId: "id", title: "title" }
      },
      ttlSeconds: { product: 900, price: 900, inventory: 300, coupon: 900 },
      seller: { name: "Approved Shop", condition: "NEW" }
    }
  };
}
