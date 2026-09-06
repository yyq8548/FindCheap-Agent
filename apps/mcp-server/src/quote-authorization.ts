/** Internal, request-local authority. Never expose permits in tool input, output or storage. */
declare const permitBrand: unique symbol;
export type QuoteAuthorization = { readonly [permitBrand]: true };

export type QuoteAuthorizationTarget = {
  merchantId: string;
  sourceHost: string;
  handle: string;
};

type PermitRecord = {
  remainingTargets: Set<string>;
  signal: AbortSignal;
  deadline: number;
  monotonicNow: () => number;
};

const permits = new WeakMap<QuoteAuthorization, PermitRecord>();
const QUOTE_TRANSACTION_BUDGET_MS = 5_000;

/** Called by the interactive server only after accepted elicitation and scope revalidation. */
export function issueQuoteAuthorization(
  targets: readonly QuoteAuthorizationTarget[],
  zipCode: string,
  signal: AbortSignal,
  monotonicNow: () => number = () => performance.now()
): QuoteAuthorization {
  const keys = new Set(targets.map(target => targetKey(target, zipCode)));
  const startedAt = monotonicNow();
  if (targets.length < 1 || targets.length > 4 || keys.size !== targets.length ||
    signal.aborted || !Number.isFinite(startedAt)) {
    throw new Error("Quote authorization scope is invalid");
  }
  const permit = Object.freeze(Object.create(null)) as QuoteAuthorization;
  permits.set(permit, {
    remainingTargets: keys,
    signal,
    deadline: startedAt + QUOTE_TRANSACTION_BUDGET_MS,
    monotonicNow
  });
  return permit;
}

export function consumeQuoteAuthorization(
  permit: QuoteAuthorization | undefined,
  target: QuoteAuthorizationTarget,
  zipCode: string
): { signal: AbortSignal; remainingMs(): number } | undefined {
  const record = permit === undefined ? undefined : permits.get(permit);
  if (record === undefined || record.signal.aborted) return undefined;
  const remainingMs = () => {
    const remaining = record.deadline - record.monotonicNow();
    return record.signal.aborted || !Number.isFinite(remaining) ? 0 : Math.max(0, Math.floor(remaining));
  };
  if (remainingMs() <= 0 || !record.remainingTargets.delete(targetKey(target, zipCode))) return undefined;
  return { signal: record.signal, remainingMs };
}

function targetKey(target: QuoteAuthorizationTarget, zipCode: string): string {
  return JSON.stringify([target.merchantId, target.sourceHost.toLowerCase(), target.handle, zipCode]);
}
