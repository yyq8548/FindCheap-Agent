import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadGateApprovedMerchantConfigs,
  validateEnabledMerchants,
  type MerchantGatePaths
} from "../../scripts/validate-enabled-merchants.js";

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
    enabled: true,
    affiliateStatus: "normal_link_only"
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
  it("loads zero runtime configs from the unaudited seed catalog without weakening the gate", async () => {
    await expect(loadGateApprovedMerchantConfigs({
      root: repositoryRoot,
      catalogPath: "config/merchants/catalog.yaml",
      enabledDirectory: "config/merchants/enabled",
      decisionsDirectory: "docs/product/merchant-decisions"
    })).resolves.toEqual([]);
  });

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
      decisions: [{ file: "approved-shop.md", value: decisionMarkdown()
        .replace("Reviewer: Jane Reviewer", "Reviewer:")
        .replace("Date: 2026-08-13", "Date: not-a-date") }]
    });
    expect((await validateEnabledMerchants(malformed)).failures.map((failure) => failure.code)).toEqual([
      "DECISION_REVIEWER_INVALID",
      "DECISION_DATE_INVALID",
      "MINIMUM_ENABLED_MERCHANTS"
    ]);
  });

  it("requires ordered, unique, substantive decision sections and final signatures", async () => {
    const emptySection = await fixture({
      configs: [{ file: "approved-shop.yaml", value: enabledConfig() }],
      decisions: [{ file: "approved-shop.md", value: decisionMarkdown().replace("Not applicable", "") }]
    });
    expect((await validateEnabledMerchants(emptySection)).failures.map((failure) => failure.code)).toContain("DECISION_SECTIONS_EMPTY");

    const reordered = await fixture({
      configs: [{ file: "approved-shop.yaml", value: enabledConfig() }],
      decisions: [{ file: "approved-shop.md", value: decisionMarkdown()
        .replace("## Affiliate/deep-link status", "## temporary")
        .replace("## Source PoC and allowed hosts", "## Affiliate/deep-link status")
        .replace("## temporary", "## Source PoC and allowed hosts") }]
    });
    expect((await validateEnabledMerchants(reordered)).failures.map((failure) => failure.code)).toContain("DECISION_HEADINGS_INVALID");

    const misplaced = await fixture({
      configs: [{ file: "approved-shop.yaml", value: enabledConfig() }],
      decisions: [{ file: "approved-shop.md", value: decisionMarkdown().replace(
        "Recorded evidence\n## Affiliate/deep-link status",
        "Recorded evidence\nReviewer: Early Reviewer\n## Affiliate/deep-link status"
      ) }]
    });
    expect((await validateEnabledMerchants(misplaced)).failures.map((failure) => failure.code)).toContain("DECISION_SIGNATURES_INVALID");
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

  it("requires an affiliate configuration to agree with the audited affiliate status", async () => {
    const missingAffiliate = await fixture({
      candidates: [{ ...approvedCandidate(), affiliateStatus: "approved" }],
      configs: [{ file: "approved-shop.yaml", value: enabledConfig() }],
      decisions: [{ file: "approved-shop.md", value: decisionMarkdown() }]
    });
    expect((await validateEnabledMerchants(missingAffiliate)).failures).toContainEqual({
      code: "AFFILIATE_STATUS_MISMATCH",
      merchantId: "approved-shop"
    });

    const enabledWithAffiliate = {
      ...enabledConfig(),
      affiliate: {
        template: "https://go.approved-shop.example/out",
        affiliateHosts: ["go.approved-shop.example"],
        affiliateOrigins: ["https://go.approved-shop.example"]
      }
    };
    const unapprovedAffiliate = await fixture({
      candidates: [{
        ...approvedCandidate(),
        affiliateHosts: ["go.approved-shop.example"],
        affiliateOrigins: ["https://go.approved-shop.example"]
      }],
      configs: [{ file: "approved-shop.yaml", value: enabledWithAffiliate }],
      decisions: [{ file: "approved-shop.md", value: decisionMarkdown() }]
    });
    expect((await validateEnabledMerchants(unapprovedAffiliate)).failures).toContainEqual({
      code: "AFFILIATE_STATUS_MISMATCH",
      merchantId: "approved-shop"
    });
  });

  it("accepts only the audited official Best Buy API provider", async () => {
    const paths = await fixture({
      candidates: [{
        ...approvedCandidate("best-buy"),
        name: "Best Buy",
        provenSource: "api",
        allowedHosts: ["api.bestbuy.com"]
      }],
      configs: [{
        file: "best-buy.yaml",
        value: {
          ...enabledConfig("best-buy"),
          allowedHosts: ["api.bestbuy.com"],
          source: {
            type: "api",
            provider: "bestbuy-products",
            host: "api.bestbuy.com",
            credentialEnv: "BEST_BUY_API_KEY"
          },
          seller: { name: "Best Buy", condition: "NEW" }
        }
      }],
      decisions: [{ file: "best-buy.md", value: decisionMarkdown("Best Buy") }]
    });
    expect(await validateEnabledMerchants(paths)).toEqual({ minimum: 1, enabledCount: 1, failures: [] });
  });

  it("reports source types outside configured adapters explicitly", async () => {
    const paths = await fixture({
      candidates: [{ ...approvedCandidate(), provenSource: "crawl4ai" }],
      configs: [{
        file: "approved-shop.yaml",
        value: { ...enabledConfig(), source: { type: "crawl4ai", host: "www.approved-shop.example" } }
      }],
      decisions: [{ file: "approved-shop.md", value: decisionMarkdown() }]
    });
    expect((await validateEnabledMerchants(paths)).failures).toContainEqual({
      code: "UNSUPPORTED_SOURCE_TYPE",
      merchantId: "approved-shop",
      detail: "crawl4ai"
    });
  });

  it("rejects symlinked enabled or decision directories when the platform permits symlinks", async () => {
    const paths = await fixture();
    const target = join(paths.root, "symlink-target");
    await mkdir(target);
    try {
      await symlink(target, join(paths.root, "enabled-link"), process.platform === "win32" ? "junction" : "dir");
      await symlink(target, join(paths.root, "decisions-link"), process.platform === "win32" ? "junction" : "dir");
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EPERM") return;
      throw error;
    }

    const enabledReport = await validateEnabledMerchants({ ...paths, enabledDirectory: "enabled-link" });
    expect(enabledReport.failures.map((failure) => failure.code)).toContain("ENABLED_DIRECTORY_INVALID");
    const decisionReport = await validateEnabledMerchants({ ...paths, decisionsDirectory: "decisions-link" });
    expect(decisionReport.failures.map((failure) => failure.code)).toContain("DECISIONS_DIRECTORY_INVALID");
  });

  it("passes a clean synthetic approved fixture", async () => {
    const paths = await fixture({
      configs: [{ file: "approved-shop.yaml", value: enabledConfig() }],
      decisions: [{ file: "approved-shop.md", value: decisionMarkdown() }]
    });

    expect(await validateEnabledMerchants(paths)).toEqual({ minimum: 1, enabledCount: 1, failures: [] });
    await expect(loadGateApprovedMerchantConfigs(paths)).resolves.toMatchObject([{
      merchantId: "approved-shop",
      candidate: { id: "approved-shop", enabled: true },
      config: { merchantId: "approved-shop", source: { type: "http" } }
    }]);
  });

  it("fails closed instead of returning any runtime configs when one gate check fails", async () => {
    const paths = await fixture({
      candidates: [{ ...approvedCandidate(), legalReview: "not_started" }],
      configs: [{ file: "approved-shop.yaml", value: enabledConfig() }],
      decisions: [{ file: "approved-shop.md", value: decisionMarkdown() }]
    });

    await expect(loadGateApprovedMerchantConfigs(paths)).rejects.toThrow(/CATALOG_AUDIT_GATE_FAILED/u);
  });
});
