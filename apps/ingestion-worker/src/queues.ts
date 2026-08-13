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
  jobIdempotencyKey,
  type RefreshJob,
  type RefreshOutcome
} from "./jobs/refresh-product.js";

export const PRODUCT_REFRESH_QUEUE = "merchant-product-refresh";
export const PRICE_REFRESH_QUEUE = "merchant-price-refresh";

export const refreshIdempotencyKey = jobIdempotencyKey;

export function refreshJobId(job: RefreshJob): string {
  return Buffer.from(refreshIdempotencyKey(job), "utf8").toString("base64url");
}

export function refreshJobOptions(job: RefreshJob): JobsOptions {
  return {
    jobId: refreshJobId(job),
    attempts: 3,
    backoff: { type: "exponential", delay: 1_000 },
    removeOnComplete: 1_000
  };
}

export function refreshWorkerOptions(connection: ConnectionOptions): WorkerOptions {
  return {
    connection,
    concurrency: 20,
    limiter: { max: 100, duration: 60_000 }
  };
}

export function createRefreshQueues(connection: ConnectionOptions): {
  product: Queue<RefreshJob>;
  price: Queue<RefreshPriceJob>;
} {
  return {
    product: new Queue<RefreshJob>(PRODUCT_REFRESH_QUEUE, { connection }),
    price: new Queue<RefreshPriceJob>(PRICE_REFRESH_QUEUE, { connection })
  };
}

export function createRefreshWorkers(
  connection: ConnectionOptions,
  handlers: {
    product: Processor<RefreshJob, RefreshOutcome>;
    price: Processor<RefreshPriceJob, RefreshPriceOutcome>;
  }
): {
  product: Worker<RefreshJob, RefreshOutcome>;
  price: Worker<RefreshPriceJob, RefreshPriceOutcome>;
} {
  return {
    product: new Worker(PRODUCT_REFRESH_QUEUE, handlers.product, refreshWorkerOptions(connection)),
    price: new Worker(PRICE_REFRESH_QUEUE, handlers.price, refreshWorkerOptions(connection))
  };
}

export interface QueueWriter<T> {
  add(name: string, data: T, options?: JobsOptions): Promise<unknown>;
}

export async function enqueueProductRefresh(
  queue: QueueWriter<RefreshJob>,
  job: RefreshJob
): Promise<void> {
  await queue.add(
    "refresh",
    { ...job, idempotencyKey: refreshIdempotencyKey(job) },
    refreshJobOptions(job)
  );
}

export async function enqueuePriceRefresh(
  queue: QueueWriter<RefreshPriceJob>,
  job: RefreshPriceJob
): Promise<void> {
  await queue.add(
    "refresh",
    { ...job, idempotencyKey: refreshIdempotencyKey(job) },
    refreshJobOptions(job)
  );
}
