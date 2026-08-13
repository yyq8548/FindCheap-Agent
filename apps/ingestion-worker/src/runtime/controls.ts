const MerchantIdPattern = /^[a-z0-9-]{1,80}$/u;

export type RuntimeControls = {
  flags: {
    isMerchantEnabled(merchantId: string): boolean;
    isSourceEnabled(merchantId: string): boolean;
  };
  killSwitch: { isActive(merchantId: string): boolean };
  circuitBreaker: {
    isOpen(merchantId: string): boolean;
    recordFailure(merchantId: string): void;
    recordSuccess(merchantId: string): void;
    openMerchantIds(): string[];
  };
};

type CircuitState = { failures: number; openedAt?: number };

function liveKillSwitch(
  input: Record<string, string | undefined>,
  merchantId: string
): boolean {
  const global = input.INGESTION_GLOBAL_KILL_SWITCH;
  if (global !== undefined && global !== "true" && global !== "false") return true;
  if (global === "true") return true;
  const configured = input.INGESTION_MERCHANT_KILL_SWITCHES;
  if (configured === undefined || configured.trim() === "") return false;
  const values = configured.split(",").map((value) => value.trim());
  if (values.length > 20 || values.some((value) => !MerchantIdPattern.test(value))) return true;
  return values.includes(merchantId);
}

export function createRuntimeControls(input: {
  enabledMerchantIds: readonly string[];
  environment: () => Record<string, string | undefined>;
  circuitFailureThreshold: number;
  circuitResetMs: number;
  clock: { now(): Date };
}): RuntimeControls {
  const enabled = new Set(input.enabledMerchantIds);
  const state = new Map<string, CircuitState>();
  const validNow = (): number => {
    const value = input.clock.now().getTime();
    if (!Number.isFinite(value)) throw new Error("runtime controls clock is invalid");
    return value;
  };
  const isOpen = (merchantId: string): boolean => {
    const current = state.get(merchantId);
    if (current?.openedAt === undefined) return false;
    if (validNow() - current.openedAt >= input.circuitResetMs) {
      state.delete(merchantId);
      return false;
    }
    return true;
  };

  return {
    flags: {
      isMerchantEnabled: (merchantId) => enabled.has(merchantId),
      isSourceEnabled: (merchantId) => enabled.has(merchantId)
    },
    killSwitch: {
      isActive: (merchantId) => liveKillSwitch(input.environment(), merchantId)
    },
    circuitBreaker: {
      isOpen,
      recordFailure(merchantId) {
        if (!enabled.has(merchantId) || isOpen(merchantId)) return;
        const failures = (state.get(merchantId)?.failures ?? 0) + 1;
        state.set(merchantId, failures >= input.circuitFailureThreshold
          ? { failures, openedAt: validNow() }
          : { failures });
      },
      recordSuccess(merchantId) {
        state.delete(merchantId);
      },
      openMerchantIds() {
        return [...enabled].filter(isOpen).sort();
      }
    }
  };
}
