import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseRegistryApprovalBatch } from "./registry-builder.js";

describe("registry builder reviewed expansion", () => {
  it("keeps the fashion expansion scoped and Reformation on its verified non-Shopify host", () => {
    const approvals = parseRegistryApprovalBatch(JSON.parse(readFileSync(
      resolve("config/registries/reviewed-expansion-2026-09-05-01.json"), "utf8"
    )));
    const official = approvals.filter((approval) => approval.kind === "OFFICIAL_STOREFRONT");
    const trusted = approvals.filter((approval) => approval.kind === "MERCHANT_TRUST");
    expect(official).toHaveLength(10);
    expect(trusted).toHaveLength(10);
    expect(trusted.map((approval) => approval.record.host).sort())
      .toEqual(official.map((approval) => approval.record.officialHost).sort());
    expect(trusted.every((approval) => approval.record.level === "OFFICIAL" && approval.evidenceKind === "BRAND_DOMAIN")).toBe(true);
    expect(official.find((approval) => approval.record.officialHost === "thereformation.com")?.record)
      .toMatchObject({ storefrontHost: "www.thereformation.com", platform: "GENERIC_JSON_LD",
        productPathPrefixes: ["/products/"], searchPathTemplate: "/search?q={query}", imageHosts: ["media.thereformation.com"] });
    expect(official.filter((approval) => approval.record.platform === "SHOPIFY")).toHaveLength(9);
    expect(official.every((approval) => approval.record.imageHosts.every((host) => !host.includes("*")))).toBe(true);
    expect(official.flatMap((approval) => approval.record.aliases).some((alias) => ["Woman", "U26C"].includes(alias))).toBe(false);
  });

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
