import { describe, expect, it, vi } from "vitest";

import type { SqlExecutor } from "../src/client.js";
import { reviewRegistryCandidate } from "../src/repositories/registry-repository.js";

const merchant = {
  host: "merchant.example",
  level: "ESTABLISHED_RETAILER" as const,
  evidenceUrl: "https://merchant.example/about",
  reviewedAt: "2026-08-29",
  status: "APPROVED" as const
};

describe("registry repository review gate", () => {
  it("does not accept technical reachability as merchant trust evidence", async () => {
    const executor = executorReturning([{ evidence_kind: "TECHNICAL_STOREFRONT" }]);
    await expect(reviewRegistryCandidate(executor, {
      kind: "MERCHANT_TRUST",
      key: merchant.host,
      status: "APPROVED",
      record: merchant,
      note: "reviewed"
    })).rejects.toThrow("decisive passed evidence");
  });

  it("accepts an explicit manual review and then updates the candidate", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ evidence_kind: "MANUAL_REVIEW" }] })
      .mockResolvedValueOnce({ rows: [{ candidate_key: merchant.host }] });
    const executor = { query } as unknown as SqlExecutor;

    await expect(reviewRegistryCandidate(executor, {
      kind: "MERCHANT_TRUST",
      key: merchant.host,
      status: "APPROVED",
      record: merchant,
      note: "reviewed"
    })).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("rejects a reviewed record whose host differs from the candidate", async () => {
    const executor = executorReturning([]);
    await expect(reviewRegistryCandidate(executor, {
      kind: "MERCHANT_TRUST",
      key: "other.example",
      status: "APPROVED",
      record: merchant,
      note: "reviewed"
    })).rejects.toThrow("does not match candidate key");
  });
});

function executorReturning(rows: Record<string, unknown>[]): SqlExecutor {
  return { async query() { return { rows }; } } as SqlExecutor;
}
