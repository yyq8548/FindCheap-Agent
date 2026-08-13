import {
  Queue,
  Worker,
  type ConnectionOptions,
  type JobsOptions,
  type Processor,
  type WorkerOptions
} from "bullmq";
import type { RefreshPriceJob, RefreshPriceOutcome } from "./jobs/refresh-price.js";
import {
  canonicalizePriceRefreshJob,
  canonicalizeProductRefreshJob,
  type RefreshJob
} from "./jobs/refresh-identity.js";
import type { RefreshOutcome } from "./jobs/refresh-product.js";

export const PRODUCT_REFRESH_QUEUE = "merchant-product-refresh";
export const PRICE_REFRESH_QUEUE = "merchant-price-refresh";

export type RefreshQueueRuntimeOptions = {
  prefix?: string;
  concurrency?: number;
};

function isPriceJob(job: RefreshJob | RefreshPriceJob): job is RefreshPriceJob {
  return "zipCode" in job && "memberships" in job;
}

export function refreshIdempotencyKey(job: RefreshJob | RefreshPriceJob): string {
  return isPriceJob(job)
    ? canonicalizePriceRefreshJob(job).idempotencyKey
    : canonicalizeProductRefreshJob(job).idempotencyKey;
}

export function refreshJobId(job: RefreshJob | RefreshPriceJob): string {
  return Buffer.from(refreshIdempotencyKey(job), "hex").toString("base64url");
}

export function refreshJobOptions(job: RefreshJob | RefreshPriceJob): JobsOptions {
  return {
    jobId: refreshJobId(job),
    attempts: 3,
    backoff: { type: "exponential", delay: 1_000 },
    removeOnComplete: 1_000
  };
}

export function refreshWorkerOptions(
  connection: ConnectionOptions,
  runtime: RefreshQueueRuntimeOptions = {}
): WorkerOptions {
  return {
    connection,
    concurrency: runtime.concurrency ?? 20,
    limiter: { max: 100, duration: 60_000 },
    ...(runtime.prefix === undefined ? {} : { prefix: runtime.prefix })
  };
}

export function createRefreshQueues(
  connection: ConnectionOptions,
  runtime: RefreshQueueRuntimeOptions = {}
): {
  product: Queue<RefreshJob>;
  price: Queue<RefreshPriceJob>;
} {
  return {
    product: new Queue<RefreshJob>(PRODUCT_REFRESH_QUEUE, {
      connection,
      ...(runtime.prefix === undefined ? {} : { prefix: runtime.prefix })
    }),
    price: new Queue<RefreshPriceJob>(PRICE_REFRESH_QUEUE, {
      connection,
      ...(runtime.prefix === undefined ? {} : { prefix: runtime.prefix })
    })
  };
}

export function createRefreshWorkers(
  connection: ConnectionOptions,
  handlers: {
    product: Processor<RefreshJob, RefreshOutcome>;
    price: Processor<RefreshPriceJob, RefreshPriceOutcome>;
  },
  runtime: RefreshQueueRuntimeOptions = {}
): {
  product: Worker<RefreshJob, RefreshOutcome>;
  price: Worker<RefreshPriceJob, RefreshPriceOutcome>;
} {
  return {
    product: new Worker(PRODUCT_REFRESH_QUEUE, handlers.product, refreshWorkerOptions(connection, runtime)),
    price: new Worker(PRICE_REFRESH_QUEUE, handlers.price, refreshWorkerOptions(connection, runtime))
  };
}

export interface QueueWriter<T> {
  add(name: string, data: T, options?: JobsOptions): Promise<unknown>;
}

export async function enqueueProductRefresh(
  queue: QueueWriter<RefreshJob>,
  job: RefreshJob
): Promise<void> {
  const canonical = canonicalizeProductRefreshJob(job);
  await queue.add(
    "refresh",
    canonical,
    refreshJobOptions(canonical)
  );
}

export async function enqueuePriceRefresh(
  queue: QueueWriter<RefreshPriceJob>,
  job: RefreshPriceJob
): Promise<void> {
  const canonical = canonicalizePriceRefreshJob(job);
  await queue.add(
    "refresh",
    canonical,
    refreshJobOptions(canonical)
  );
}
