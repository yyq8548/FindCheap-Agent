import { resolve } from "node:path";

import {
  loadGateApprovedMerchantConfigs,
  type GateApprovedMerchantConfig,
  type MerchantGatePaths
} from "../../../scripts/validate-enabled-merchants.js";
import { createDatabase, type Database } from "../../../packages/db/src/client.js";
import { buildApp } from "./app.js";
import { createCurrentOfferStore } from "./current-offer-store.js";
import { createPriceHistoryRepository } from "./price-history.js";
import { parseCommerceEnvironment } from "./environment.js";

export type CommerceRuntime = {
  status: "disabled" | "running";
  close(): Promise<void>;
};

type RuntimeFactories = {
  loadConfigs(paths: MerchantGatePaths): Promise<GateApprovedMerchantConfig[]>;
  createDatabase(url: string): Database;
};

export type StartCommerceRuntimeOptions = {
  environment?: Record<string, string | undefined>;
  root?: string;
  factories?: Partial<RuntimeFactories>;
};

function gatePaths(root: string): MerchantGatePaths {
  return {
    root,
    catalogPath: "config/merchants/catalog.yaml",
    enabledDirectory: "config/merchants/enabled",
    decisionsDirectory: "docs/product/merchant-decisions"
  };
}

export async function startCommerceRuntime(
  options: StartCommerceRuntimeOptions = {}
): Promise<CommerceRuntime> {
  const environment = parseCommerceEnvironment(options.environment ?? process.env);
  const factories: RuntimeFactories = {
    loadConfigs: loadGateApprovedMerchantConfigs,
    createDatabase: (url) => createDatabase(url, {
      statementTimeoutMs: 5_000,
      queryTimeoutMs: 6_000,
      connectionTimeoutMs: 5_000
    }),
    ...options.factories
  };
  const configs = await factories.loadConfigs(gatePaths(resolve(options.root ?? process.cwd())));
  if (configs.length === 0 && environment.databaseUrl === undefined) {
    return { status: "disabled", async close() {} };
  }
  if (environment.databaseUrl === undefined || environment.bearerToken === undefined) {
    throw new Error("DATABASE_URL and COMMERCE_API_TOKEN are required when merchants are enabled");
  }
  const enabledMerchantIds = new Set(configs.map((entry) => entry.merchantId));
  const db = factories.createDatabase(environment.databaseUrl);
  try {
    await db.connect();
  } catch (error) {
    await db.close();
    throw error;
  }
  const store = createCurrentOfferStore(db, enabledMerchantIds);
  const app = buildApp({
    offers: store,
    quoteExactOffer: store.quoteExactOffer,
    priceHistory: createPriceHistoryRepository(db),
    clock: { now: () => new Date() }
  }, { bearerToken: environment.bearerToken });
  try {
    await app.listen({ host: environment.host, port: environment.port });
  } catch (error) {
    await db.close();
    throw error;
  }
  return {
    status: "running",
    async close() {
      try {
        await app.close();
      } finally {
        await db.close();
      }
    }
  };
}
