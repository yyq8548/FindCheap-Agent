import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { validateEnabledMerchants, type MerchantGatePaths } from "../../scripts/validate-enabled-merchants.js";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map(async (path) => rm(path, { recursive: true, force: true })));
});

function approvedCandidate(id = "approved-shop") {
  return {
    id,
    name: "Approved Shop",
    segment: "general",
    auditState: "approved",
    legalReview: "approved",
    provenSource: "http",
    allowedHosts: [`www.${id}.example`],
    identityCompleteness: 0.95,
    weightedScore: 85,
    enabled: true
  };
}

function enabledConfig(id = "approved-shop") {
  return {
    merchantId: id,
    enabled: true,
    killSwitch: false,
    allowedHosts: [`www.${id}.example`],
    source: { type: "http", host: `www.${id}.example`, resourcePath: "/products" },
    ttlSeconds: { product: 900, price: 900, inventory: 300, coupon: 900 },
    seller: { name: "Approved Shop", condition: "NEW" }
  };
}

function decisionMarkdown(name = "Approved Shop") {
  return `# Merchant Decision: ${name}\n## Data authorization and terms evidence\nRecorded evidence\n## Affiliate/deep-link status\nNot applicable\n## Source PoC and allowed hosts\nRecorded evidence\n## 100-SKU identity completeness sample\nRecorded evidence\n## ZIP, shipping, tax, Coupon, and membership behavior\nRecorded evidence\n## Maintenance and failure risks\nRecorded evidence\n## Approval signatures and date\nReviewer: Jane Reviewer\nDate: 2026-08-13\n`;
}

async function fixture(options: {
  candidates?: object[];
  configs?: Array<{ file: string; value: object }>;
  decisions?: Array<{ file: string; value: string }>;
} = {}): Promise<MerchantGatePaths> {
  const root = await mkdtemp(join(tmpdir(), "merchant-gate-"));
  cleanupPaths.push(root);
  const enabledDirectory = join(root, "enabled");
  const decisionsDirectory = join(root, "decisions");
  await Promise.all([mkdir(enabledDirectory), mkdir(decisionsDirectory)]);
  await writeFile(join(root, "catalog.yaml"), JSON.stringify({
    version: 1,
    candidates: options.candidates ?? [approvedCandidate()]
  }));
  await Promise.all((options.configs ?? []).map(async ({ file, value }) =>
    writeFile(join(enabledDirectory, file), JSON.stringify(value))
  ));
  await Promise.all((options.decisions ?? []).map(async ({ file, value }) =>
    writeFile(join(decisionsDirectory, file), value)
  ));
  return { root, catalogPath: "catalog.yaml", enabledDirectory: "enabled", decisionsDirectory: "decisions" };
}

describe("enabled merchant quality gate", () => {
  it("reports the seed catalog's intentional pre-audit minimum failure", async () => {
    const report = await validateEnabledMerchants({
      root: repositoryRoot,
      catalogPath: "config/merchants/catalog.yaml",
      enabledDirectory: "config/merchants/enabled",
      decisionsDirectory: "docs/product/merchant-decisions",
      minimum: 10
    });

    expect(report).toEqual({
      minimum: 10,
      enabledCount: 0,
      failures: [{ code: "MINIMUM_ENABLED_MERCHANTS", detail: "requires 10, found 0" }]
    });
  });

  it("rejects a config whose catalog merchant has not passed approval", async () => {
    const paths = await fixture({
      candidates: [{ ...approvedCandidate(), auditState: "required" }],
      configs: [{ file: "approved-shop.yaml", value: enabledConfig() }],
      decisions: [{ file: "approved-shop.md", value: decisionMarkdown() }]
    });

    expect((await validateEnabledMerchants(paths)).failures.map((failure) => failure.code)).toContain("CATALOG_AUDIT_GATE_FAILED");
  });

  it("rejects missing or malformed approval decisions and signature fields", async () => {
    const missing = await fixture({ configs: [{ file: "approved-shop.yaml", value: enabledConfig() }] });
    expect((await validateEnabledMerchants(missing)).failures).toContainEqual({
      code: "DECISION_MISSING",
      merchantId: "approved-shop"
    });

    const malformed = await fixture({
      configs: [{ file: "approved-shop.yaml", value: enabledConfig() }],
      decisions: [{ file: "approved-shop.md", value: "# Merchant Decision: Approved Shop\n## Approval signatures and date\nReviewer:\nDate: not-a-date\n" }]
    });
    expect((await validateEnabledMerchants(malformed)).failures.map((failure) => failure.code)).toEqual([
      "DECISION_HEADINGS_INVALID",
      "DECISION_REVIEWER_INVALID",
      "DECISION_DATE_INVALID",
      "MINIMUM_ENABLED_MERCHANTS"
    ]);
  });

  it("rejects duplicate and unknown merchant configurations", async () => {
    const paths = await fixture({
      configs: [
        { file: "one.yaml", value: enabledConfig() },
        { file: "two.yaml", value: enabledConfig() },
        { file: "unknown.yaml", value: enabledConfig("unknown-shop") }
      ],
      decisions: [{ file: "approved-shop.md", value: decisionMarkdown() }]
    });

    expect((await validateEnabledMerchants(paths)).failures.map((failure) => failure.code)).toEqual([
      "CONFIG_FILENAME_MISMATCH",
      "CONFIG_FILENAME_MISMATCH",
      "DUPLICATE_MERCHANT_CONFIG",
      "CONFIG_FILENAME_MISMATCH",
      "UNKNOWN_MERCHANT_CONFIG"
    ]);
  });

  it("enforces the requested minimum without making the regular suite fail", async () => {
    const paths = await fixture({
      configs: [{ file: "approved-shop.yaml", value: enabledConfig() }],
      decisions: [{ file: "approved-shop.md", value: decisionMarkdown() }]
    });

    expect(await validateEnabledMerchants({ ...paths, minimum: 2 })).toEqual({
      minimum: 2,
      enabledCount: 1,
      failures: [{ code: "MINIMUM_ENABLED_MERCHANTS", detail: "requires 2, found 1" }]
    });
  });

  it("passes a clean synthetic approved fixture", async () => {
    const paths = await fixture({
      configs: [{ file: "approved-shop.yaml", value: enabledConfig() }],
      decisions: [{ file: "approved-shop.md", value: decisionMarkdown() }]
    });

    expect(await validateEnabledMerchants(paths)).toEqual({ minimum: 1, enabledCount: 1, failures: [] });
  });
});
