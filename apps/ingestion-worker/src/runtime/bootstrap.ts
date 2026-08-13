import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ConnectionOptions, Processor } from "bullmq";

import {
  loadGateApprovedMerchantConfigs,
  type GateApprovedMerchantConfig,
  type MerchantGatePaths
} from "../../../../scripts/validate-enabled-merchants.js";
import { createDatabase, type Database } from "../../../../packages/db/src/client.js";
import { createIngestionPersistence } from "../../../../packages/db/src/repositories/ingestion-repository.js";
import { createPromotionRepository } from "../../../../packages/db/src/repositories/promotion-repository.js";
import { createConfiguredAdapter } from "../../../../packages/merchant-adapters/src/configured/configured-adapter.js";
import { createConfiguredSource } from "../../../../packages/merchant-adapters/src/configured/configured-source.js";
import type { EvidenceRecord, MerchantAdapter } from "../../../../packages/merchant-sdk/src/index.js";
import { refreshPrice, type RefreshPriceJob, type RefreshPriceOutcome } from "../jobs/refresh-price.js";
import { refreshProduct, type RefreshJob, type RefreshOutcome } from "../jobs/refresh-product.js";
import {
  createRefreshQueues,
  createRefreshWorkers,
  enqueuePriceRefresh,
  enqueueProductRefresh
} from "../queues.js";
import { createRuntimeControls } from "./controls.js";
import {
  parseIngestionEnvironment,
  redisConnectionOptions,
  type IngestionEnvironment
} from "./environment.js";

type RefreshQueues = ReturnType<typeof createRefreshQueues>;
type RefreshWorkers = ReturnType<typeof createRefreshWorkers>;

export type IngestionHealth = {
  status: "disabled" | "running" | "stopped";
  enabledMerchants: string[];
  workersRunning: boolean;
  queueFailures: number;
  circuitOpen: string[];
};

export type IngestionRuntime = {
  health(): IngestionHealth;
  enqueueProduct(job: RefreshJob): Promise<void>;
  enqueuePrice(job: RefreshPriceJob): Promise<void>;
  close(): Promise<void>;
};

type RuntimeLogger = { info(event: IngestionHealth & { event: string }): void };

type RuntimeFactories = {
  loadConfigs(paths: MerchantGatePaths): Promise<GateApprovedMerchantConfig[]>;
  createDatabase(connectionString: string): Database;
  createSource(entry: GateApprovedMerchantConfig): ReturnType<typeof createConfiguredSource>;
  createPersistence: typeof createIngestionPersistence;
  createPromotions: typeof createPromotionRepository;
  createQueues(connection: ConnectionOptions): RefreshQueues;
  createWorkers(
    connection: ConnectionOptions,
    handlers: {
      product: Processor<RefreshJob, RefreshOutcome>;
      price: Processor<RefreshPriceJob, RefreshPriceOutcome>;
    }
  ): RefreshWorkers;
};

export type StartIngestionRuntimeOptions = {
  root?: string;
  environment?: Record<string, string | undefined>;
  clock?: { now(): Date };
  logger?: RuntimeLogger;
  factories?: Partial<RuntimeFactories>;
};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(
  moduleDirectory,
  basename(moduleDirectory) === "dist" ? "../../.." : "../../../.."
);
const defaultLogger: RuntimeLogger = {
  info: (event) => console.log(JSON.stringify(event))
};

function gatePaths(root: string): MerchantGatePaths {
  return {
    root,
    catalogPath: "config/merchants/catalog.yaml",
    enabledDirectory: "config/merchants/enabled",
    decisionsDirectory: "docs/product/merchant-decisions"
  };
}

function requireOperationalEnvironment(environment: IngestionEnvironment): {
  databaseUrl: string;
  redis: ConnectionOptions;
} {
  if (environment.databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required when merchants are enabled");
  }
  return { databaseUrl: environment.databaseUrl, redis: redisConnectionOptions(environment) };
}

async function findEvidence(
  db: Database,
  merchantId: string,
  merchantProductId: string
): Promise<EvidenceRecord[]> {
  const result = await db.query<{
    id: string;
    merchant_id: string;
    source_url: string;
    source_type: string;
    content_hash: string;
    captured_at: Date;
    metadata: Record<string, string>;
  }>(
    `SELECT id, merchant_id, source_url, source_type, content_hash, captured_at, metadata
     FROM ingestion_evidence
     WHERE merchant_id = $1 AND merchant_product_id = $2
     ORDER BY captured_at DESC LIMIT 50`,
    [merchantId, merchantProductId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    merchantId: row.merchant_id,
    sourceUrl: row.source_url,
    sourceType: row.source_type,
    contentHash: row.content_hash,
    capturedAt: row.captured_at.toISOString(),
    metadata: row.metadata
  }));
}

function disabledRuntime(
  logger: RuntimeLogger,
  requiredMinimum: number
): IngestionRuntime {
  let stopped = false;
  const health = (): IngestionHealth => ({
    status: stopped ? "stopped" : "disabled",
    enabledMerchants: [],
    workersRunning: false,
    queueFailures: 0,
    circuitOpen: []
  });
  logger.info({ event: requiredMinimum === 0 ? "ingestion.disabled" : "ingestion.minimum_failed", ...health() });
  return {
    health,
    async enqueueProduct() {
      throw new Error("ingestion runtime is disabled because no merchants are enabled");
    },
    async enqueuePrice() {
      throw new Error("ingestion runtime is disabled because no merchants are enabled");
    },
    async close() {
      stopped = true;
    }
  };
}

export async function startIngestionRuntime(
  options: StartIngestionRuntimeOptions = {}
): Promise<IngestionRuntime> {
  const environmentInput = options.environment ?? process.env;
  const environment = parseIngestionEnvironment(environmentInput);
  const logger = options.logger ?? defaultLogger;
  const clock = options.clock ?? { now: () => new Date() };
  const factories: RuntimeFactories = {
    loadConfigs: loadGateApprovedMerchantConfigs,
    createDatabase,
    createSource: (entry) => createConfiguredSource(entry.config, entry.candidate, { clock }),
    createPersistence: createIngestionPersistence,
    createPromotions: createPromotionRepository,
    createQueues: createRefreshQueues,
    createWorkers: createRefreshWorkers,
    ...options.factories
  };
  const entries = await factories.loadConfigs(gatePaths(options.root ?? defaultRoot));
  if (entries.length < environment.minimumEnabledMerchants) {
    throw new Error(
      `enabled merchant minimum not met: requires ${environment.minimumEnabledMerchants}, found ${entries.length}`
    );
  }
  if (entries.length === 0) return disabledRuntime(logger, environment.minimumEnabledMerchants);

  const operational = requireOperationalEnvironment(environment);
  const merchantIds = entries.map((entry) => entry.merchantId).sort();
  const controls = createRuntimeControls({
    enabledMerchantIds: merchantIds,
    environment: () => environmentInput,
    circuitFailureThreshold: environment.circuitFailureThreshold,
    circuitResetMs: environment.circuitResetMs,
    clock
  });
  const sources = new Map(entries.map((entry) => [entry.merchantId, factories.createSource(entry)]));
  const db = factories.createDatabase(operational.databaseUrl);
  let queues: RefreshQueues | undefined;
  let workers: RefreshWorkers | undefined;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let queueFailures = 0;

  const closeResources = async (): Promise<void> => {
    const errors: unknown[] = [];
    const closeGroup = async (actions: Array<() => Promise<void>>): Promise<void> => {
      const results = await Promise.allSettled(actions.map(async (action) => action()));
      for (const result of results) if (result.status === "rejected") errors.push(result.reason);
    };
    if (workers !== undefined) {
      await closeGroup([async () => workers!.product.close(), async () => workers!.price.close()]);
    }
    if (queues !== undefined) {
      await closeGroup([async () => queues!.product.close(), async () => queues!.price.close()]);
    }
    await closeGroup([async () => db.close()]);
    if (errors.length > 0) throw new AggregateError(errors, "ingestion runtime shutdown failed");
  };

  try {
    await db.connect();
    const persistence = factories.createPersistence(db);
    const promotions = factories.createPromotions(db);
    const adapters = new Map<string, MerchantAdapter>();
    for (const entry of entries) {
      const source = sources.get(entry.merchantId);
      if (source === undefined) throw new Error(`configured source unavailable for ${entry.merchantId}`);
      const ttlMs = Math.max(...Object.values(entry.config.ttlSeconds)) * 1_000;
      adapters.set(entry.merchantId, createConfiguredAdapter(entry.config, {
        catalogCandidate: entry.candidate,
        sources: { [entry.config.source.type]: source },
        evidence: { find: (merchantId, entityId) => findEvidence(db, merchantId, entityId) },
        redirectValidator: { isAllowed: () => false },
        controls: {
          isEnabled: controls.flags.isMerchantEnabled,
          isKillSwitchActive: controls.killSwitch.isActive
        },
        freshness: { maxAgeMs: ttlMs, maxFutureSkewMs: 5_000 },
        clock
      }));
    }
    const adapterRegistry = {
      get(merchantId: string): MerchantAdapter {
        const adapter = adapters.get(merchantId);
        if (adapter === undefined) throw new Error("merchant adapter is unavailable");
        return adapter;
      }
    };
    const ttlMs = Math.max(...entries.flatMap((entry) => Object.values(entry.config.ttlSeconds))) * 1_000;
    const freshness = {
      ttlMs,
      maxFutureSkewMs: 5_000,
      evidenceMaxAgeMs: ttlMs,
      maxEvidenceToEntitySkewMs: 5_000
    };
    queues = factories.createQueues(operational.redis);
    workers = factories.createWorkers(operational.redis, {
      product: async (job) => {
        try {
          const outcome = await refreshProduct(job.data, {
            adapters: adapterRegistry,
            evidence: persistence.evidence,
            offers: persistence.offers,
            flags: controls.flags,
            killSwitch: controls.killSwitch,
            circuitBreaker: controls.circuitBreaker,
            clock,
            freshness
          });
          if (outcome.status === "PUBLISHED" || outcome.status === "NOT_FOUND") {
            controls.circuitBreaker.recordSuccess(job.data.merchantId);
          }
          if (outcome.status === "PUBLISHED") {
            await promotions.promoteProduct(outcome.offerId);
            await promotions.promotePendingQuotes(job.data.merchantId, job.data.merchantProductId);
          }
          return outcome;
        } catch (error) {
          controls.circuitBreaker.recordFailure(job.data.merchantId);
          throw error;
        }
      },
      price: async (job) => {
        try {
          const outcome = await refreshPrice(job.data, {
            adapters: adapterRegistry,
            evidence: persistence.evidence,
            quotes: persistence.quotes,
            quarantine: persistence.quarantine,
            flags: controls.flags,
            killSwitch: controls.killSwitch,
            circuitBreaker: controls.circuitBreaker,
            clock,
            freshness
          });
          if (outcome.status === "PUBLISHED" || outcome.status === "QUARANTINED") {
            controls.circuitBreaker.recordSuccess(job.data.merchantId);
          }
          if (outcome.status === "PUBLISHED") {
            await promotions.promoteQuote(outcome.quoteId);
          }
          return outcome;
        } catch (error) {
          controls.circuitBreaker.recordFailure(job.data.merchantId);
          throw error;
        }
      }
    });
    for (const worker of [workers.product, workers.price]) {
      worker.on("failed", () => { queueFailures += 1; });
    }
    await Promise.all([
      queues.product.waitUntilReady(),
      queues.price.waitUntilReady(),
      workers.product.waitUntilReady(),
      workers.price.waitUntilReady()
    ]);
  } catch (error) {
    try {
      await closeResources();
    } catch (cleanupError) {
      const cleanupErrors = cleanupError instanceof AggregateError
        ? cleanupError.errors
        : [cleanupError];
      const primary = error instanceof Error ? error : new Error("ingestion runtime startup failed", {
        cause: error
      });
      Object.defineProperty(primary, "cleanupErrors", {
        value: cleanupErrors,
        enumerable: false,
        configurable: true
      });
      throw primary;
    }
    throw error;
  }

  const health = (): IngestionHealth => ({
    status: closed ? "stopped" : "running",
    enabledMerchants: merchantIds,
    workersRunning: !closed,
    queueFailures,
    circuitOpen: controls.circuitBreaker.openMerchantIds()
  });
  logger.info({ event: "ingestion.started", ...health() });

  return {
    health,
    async enqueueProduct(job) {
      if (closed || queues === undefined) throw new Error("ingestion runtime is stopped");
      await enqueueProductRefresh(queues.product, job);
    },
    async enqueuePrice(job) {
      if (closed || queues === undefined) throw new Error("ingestion runtime is stopped");
      await enqueuePriceRefresh(queues.price, job);
    },
    async close() {
      if (closePromise !== undefined) return closePromise;
      closed = true;
      closePromise = closeResources().then(() => {
        logger.info({ event: "ingestion.stopped", ...health() });
      });
      return closePromise;
    }
  };
}
