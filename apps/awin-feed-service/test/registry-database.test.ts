import { describe, expect, it } from "vitest";

import type { SqlExecutor } from "../../../packages/db/src/client.js";
import { EMBEDDED_MERCHANT_TRUST_REGISTRY } from "../../../packages/contracts/src/index.js";
import { refreshServedRegistriesFromDatabase } from "../src/registry-database.js";
import {
  DEFAULT_OFFICIAL_STOREFRONT_REGISTRY,
  serveOfficialStorefrontRegistry
} from "../src/official-storefront-registry.js";
import { serveMerchantTrustRegistry } from "../src/merchant-trust-registry.js";

describe("registry database snapshots", () => {
  it("atomically replaces both served registries from one validated release", async () => {
    const officialStorefronts = {
      version: "release-1-official",
      stores: [DEFAULT_OFFICIAL_STOREFRONT_REGISTRY.stores[0]!]
    };
    const merchantTrust = {
      version: "release-1-trust",
      merchants: [EMBEDDED_MERCHANT_TRUST_REGISTRY.merchants[0]!]
    };
    const served = {
      officialStorefronts: serveOfficialStorefrontRegistry(DEFAULT_OFFICIAL_STOREFRONT_REGISTRY),
      merchantTrust: serveMerchantTrustRegistry(EMBEDDED_MERCHANT_TRUST_REGISTRY)
    };
    const executor = executorWith([{ version: "release-1", official_storefronts: officialStorefronts, merchant_trust: merchantTrust }]);

    await expect(refreshServedRegistriesFromDatabase(executor, served)).resolves.toBe(true);
    expect(served.officialStorefronts.registry).toEqual(officialStorefronts);
    expect(served.merchantTrust.registry).toEqual(merchantTrust);
  });

  it("keeps last valid data when the next database snapshot is invalid", async () => {
    const served = {
      officialStorefronts: serveOfficialStorefrontRegistry(DEFAULT_OFFICIAL_STOREFRONT_REGISTRY),
      merchantTrust: serveMerchantTrustRegistry(EMBEDDED_MERCHANT_TRUST_REGISTRY)
    };
    const officialBody = served.officialStorefronts.body;
    const trustBody = served.merchantTrust.body;
    const executor = executorWith([{
      version: "bad",
      official_storefronts: { version: "bad", stores: [{ status: "CANDIDATE" }] },
      merchant_trust: { version: "bad", merchants: [] }
    }]);

    await expect(refreshServedRegistriesFromDatabase(executor, served)).rejects.toThrow();
    expect(served.officialStorefronts.body).toBe(officialBody);
    expect(served.merchantTrust.body).toBe(trustBody);
  });
});

function executorWith(rows: Record<string, unknown>[]): SqlExecutor {
  return { async query() { return { rows }; } } as SqlExecutor;
}
