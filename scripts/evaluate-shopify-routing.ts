export type ShopifyRoutingRun = {
  taskId: string;
  shopifyToolCalls: number;
  status: "OK" | "DATA_SOURCE_UNAVAILABLE";
  coverage: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  productCount: number;
  chromeUsed: boolean;
  totalLatencyMs: number;
};

export function scoreShopifyRouting(runs: ShopifyRoutingRun[]) {
  const redundantToolCallCount = runs.reduce(
    (count, run) => count + Math.max(0, run.shopifyToolCalls - 1),
    0
  );
  const routingViolationCount = runs.filter((run) => {
    if (run.status !== "OK" || run.coverage !== "COMPLETE") return run.chromeUsed;
    return run.productCount === 0 ? !run.chromeUsed : run.chromeUsed;
  }).length;
  const sortedLatency = runs.map((run) => run.totalLatencyMs).sort((left, right) => left - right);
  const p95Index = Math.max(0, Math.ceil(sortedLatency.length * 0.95) - 1);
  return {
    decision: runs.length === 20 && redundantToolCallCount === 0 && routingViolationCount === 0
      ? "PASS" as const
      : "FAIL" as const,
    taskCount: runs.length,
    redundantToolCallCount,
    routingViolationCount,
    p95TotalLatencyMs: sortedLatency[p95Index] ?? 0
  };
}
