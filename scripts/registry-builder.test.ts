import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseRegistryApprovalBatch } from "./registry-builder.js";

describe("registry builder reviewed expansion", () => {
  it("expands the reviewed growth manifest into unique gated approvals", () => {
    const input = JSON.parse(readFileSync(
      resolve("config/registries/reviewed-expansion-2026-08-29.json"),
      "utf8"
    ));
    const approvals = parseRegistryApprovalBatch(input);

    expect(approvals).toHaveLength(142);
    expect(approvals.filter((approval) => approval.kind === "OFFICIAL_STOREFRONT")).toHaveLength(39);
    expect(approvals.filter((approval) => approval.kind === "MERCHANT_TRUST")).toHaveLength(103);
    expect(new Set(approvals.map((approval) => approval.kind === "OFFICIAL_STOREFRONT"
      ? `${approval.kind}:${approval.record.officialHost}`
      : `${approval.kind}:${approval.record.host}`)).size).toBe(approvals.length);
  });
});
