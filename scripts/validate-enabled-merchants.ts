import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import {
  MerchantSourceConfigSchema,
  parseMerchantSourceConfig,
  type MerchantSourceConfig,
  type MerchantSourceConfigInput
} from "../packages/merchant-adapters/src/configured/source-config.js";
import { MerchantCatalogSchema, selectForBuild, type MerchantCatalog } from "../config/merchants/schema.js";

const REQUIRED_DECISION_HEADINGS = [
  "Data authorization and terms evidence",
  "Affiliate/deep-link status",
  "Source PoC and allowed hosts",
  "100-SKU identity completeness sample",
  "ZIP, shipping, tax, Coupon, and membership behavior",
  "Maintenance and failure risks",
  "Approval signatures and date"
] as const;

const SECRET_KEY = /(?:secret|token|password|api[_-]?key|private[_-]?key)/iu;
const SECRET_VALUE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|rk|pk)_[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,})/u;
const CONFIGURED_SOURCE_TYPES = new Set(["feed", "jsonld", "http", "api"]);

export type MerchantGatePaths = {
  root: string;
  catalogPath: string;
  enabledDirectory: string;
  decisionsDirectory: string;
  minimum?: number;
};

export type MerchantGateFailure = {
  code: string;
  merchantId?: string;
  detail?: string;
};

export type MerchantGateReport = {
  minimum: number;
  enabledCount: number;
  failures: MerchantGateFailure[];
};

export type GateApprovedMerchantConfig = {
  merchantId: string;
  candidate: MerchantCatalog["candidates"][number];
  config: MerchantSourceConfig;
};

type MerchantGateInspection = {
  report: MerchantGateReport;
  approvedConfigs: GateApprovedMerchantConfig[];
};

type ConfigFile = { name: string; path: string };
type DirectoryStatus = "valid" | "missing" | "invalid";

class UnsupportedSourceTypeError extends Error {
  constructor(readonly sourceType: string, readonly merchantId?: string) {
    super("source type is not supported by configured adapters");
  }
}

function failure(code: string, merchantId?: string, detail?: string): MerchantGateFailure {
  return { code, ...(merchantId === undefined ? {} : { merchantId }), ...(detail === undefined ? {} : { detail }) };
}

function resolveConfined(root: string, candidate: string): string {
  if (isAbsolute(candidate)) throw new Error("gate paths must be relative to root");
  const target = resolve(root, candidate);
  const fromRoot = relative(root, target);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error("gate path escapes root");
  }
  return target;
}

async function regularFile(path: string): Promise<boolean> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) throw new Error("symlinked gate files are not allowed");
  return stats.isFile();
}

async function readConfinedFile(path: string): Promise<string> {
  if (!(await regularFile(path))) throw new Error("gate path must be a regular file");
  return readFile(path, "utf8");
}

async function directoryStatus(directory: string): Promise<DirectoryStatus> {
  try {
    const stats = await lstat(directory);
    return stats.isSymbolicLink() || !stats.isDirectory() ? "invalid" : "valid";
  } catch (error: unknown) {
    return isMissing(error) ? "missing" : "invalid";
  }
}

async function listConfigFiles(directory: string, status: DirectoryStatus): Promise<{ files: ConfigFile[]; failures: MerchantGateFailure[] }> {
  if (status !== "valid") return { files: [], failures: [] };

  const entries = await readdir(directory, { withFileTypes: true });
  const files: ConfigFile[] = [];
  const failures: MerchantGateFailure[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      failures.push(failure("SYMLINKED_CONFIG_REJECTED", undefined, entry.name));
    } else if (!entry.isFile() || !entry.name.endsWith(".yaml")) {
      failures.push(failure("UNEXPECTED_CONFIG_FILE", undefined, entry.name));
    } else {
      files.push({ name: entry.name, path });
    }
  }
  return { files, failures };
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function containsInlineSecret(value: unknown, key = ""): boolean {
  if (SECRET_KEY.test(key)) return true;
  if (typeof value === "string") return SECRET_VALUE.test(value);
  if (Array.isArray(value)) return value.some((item) => containsInlineSecret(item));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(([childKey, childValue]) => containsInlineSecret(childValue, childKey));
  }
  return false;
}

function validDecisionDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validateDecision(markdown: string, merchantId: string): MerchantGateFailure[] {
  const failures: MerchantGateFailure[] = [];
  const headings = [...markdown.matchAll(/^## ([^\r\n]+)$/gmu)];
  const headingTitles = headings.map((heading) => heading[1]);
  const headingsValid =
    /^# Merchant Decision: \S.+$/mu.test(markdown) &&
    headingTitles.length === REQUIRED_DECISION_HEADINGS.length &&
    headingTitles.every((heading, index) => heading === REQUIRED_DECISION_HEADINGS[index]);
  if (!headingsValid) {
    failures.push(failure("DECISION_HEADINGS_INVALID", merchantId));
    return failures;
  }

  const sections = headings.map((heading, index) => {
    const contentStart = heading.index! + heading[0].length;
    const contentEnd = headings[index + 1]?.index ?? markdown.length;
    return markdown.slice(contentStart, contentEnd).trim();
  });
  if (sections.slice(0, -1).some((section) => section.length === 0)) {
    failures.push(failure("DECISION_SECTIONS_EMPTY", merchantId));
  }

  const reviewerLines = [...markdown.matchAll(/^Reviewer:[ \t]*([^\r\n]*)$/gmu)];
  const dateLines = [...markdown.matchAll(/^Date:[ \t]*([^\r\n]*)$/gmu)];
  const approvalSection = sections.at(-1) ?? "";
  const approvalLines = approvalSection.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  const reviewerLine = reviewerLines[0];
  const dateLine = dateLines[0];
  const signaturesAtEnd =
    reviewerLines.length === 1 &&
    dateLines.length === 1 &&
    approvalLines.length >= 2 &&
    approvalLines.at(-2) === reviewerLine?.[0] &&
    approvalLines.at(-1) === dateLine?.[0];
  if (!signaturesAtEnd) failures.push(failure("DECISION_SIGNATURES_INVALID", merchantId));

  const reviewer = reviewerLine?.[1]?.trim();
  if (reviewer === undefined || reviewer.split(/\s+/u).length < 2) {
    failures.push(failure("DECISION_REVIEWER_INVALID", merchantId));
  }
  const date = dateLine?.[1]?.trim();
  if (date === undefined || !validDecisionDate(date)) failures.push(failure("DECISION_DATE_INVALID", merchantId));
  return failures;
}

async function validateDecisionFile(
  decisionsDirectory: string,
  decisionsDirectoryStatus: DirectoryStatus,
  merchantId: string
): Promise<MerchantGateFailure[]> {
  if (decisionsDirectoryStatus !== "valid") {
    return [failure(decisionsDirectoryStatus === "missing" ? "DECISION_MISSING" : "DECISIONS_DIRECTORY_INVALID", merchantId)];
  }
  const path = resolve(decisionsDirectory, `${merchantId}.md`);
  try {
    return validateDecision(await readConfinedFile(path), merchantId);
  } catch (error: unknown) {
    return [failure(isMissing(error) ? "DECISION_MISSING" : "DECISION_FILE_INVALID", merchantId)];
  }
}

async function loadCatalog(root: string, catalogPath: string): Promise<MerchantCatalog> {
  const source = await readConfinedFile(resolveConfined(root, catalogPath));
  return MerchantCatalogSchema.parse(parse(source));
}

function parseEnabledConfig(value: unknown): { merchantId: string; config: MerchantSourceConfigInput } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("enabled config must be an object");
  if (containsInlineSecret(value)) throw new Error("enabled config contains inline secret material");
  const objectValue = value as Record<string, unknown>;
  if (objectValue.enabled !== true || objectValue.killSwitch !== false) {
    throw new Error("enabled config requires enabled: true and killSwitch: false");
  }
  const { enabled: _enabled, killSwitch: _killSwitch, ...sourceConfig } = objectValue;
  const source = sourceConfig.source;
  const sourceRecord = source !== null && typeof source === "object" && !Array.isArray(source)
    ? source as Record<string, unknown>
    : undefined;
  const sourceType = sourceRecord?.type;
  if (typeof sourceType === "string" && !CONFIGURED_SOURCE_TYPES.has(sourceType)) {
    const merchantId = typeof sourceConfig.merchantId === "string" && /^[a-z0-9-]{1,80}$/u.test(sourceConfig.merchantId)
      ? sourceConfig.merchantId
      : undefined;
    throw new UnsupportedSourceTypeError(sourceType, merchantId);
  }
  const parsed = MerchantSourceConfigSchema.parse(sourceConfig);
  return { merchantId: parsed.merchantId, config: parsed };
}

async function inspectEnabledMerchants(
  paths: MerchantGatePaths,
  minimum: number
): Promise<MerchantGateInspection> {
  const root = resolve(paths.root);
  const failures: MerchantGateFailure[] = [];
  const approvedConfigs: GateApprovedMerchantConfig[] = [];
  let enabledDirectory: string;
  let decisionsDirectory: string;
  try {
    enabledDirectory = resolveConfined(root, paths.enabledDirectory);
    decisionsDirectory = resolveConfined(root, paths.decisionsDirectory);
  } catch {
    return {
      report: { minimum, enabledCount: 0, failures: [failure("GATE_PATH_INVALID"), ...(minimum > 0 ? [failure("MINIMUM_ENABLED_MERCHANTS", undefined, `requires ${minimum}, found 0`)] : [])] },
      approvedConfigs
    };
  }
  const enabledDirectoryStatus = await directoryStatus(enabledDirectory);
  const decisionsDirectoryStatus = await directoryStatus(decisionsDirectory);
  if (enabledDirectoryStatus === "invalid") failures.push(failure("ENABLED_DIRECTORY_INVALID"));
  if (decisionsDirectoryStatus === "invalid") failures.push(failure("DECISIONS_DIRECTORY_INVALID"));

  let catalog: MerchantCatalog;
  try {
    catalog = await loadCatalog(root, paths.catalogPath);
  } catch {
    return {
      report: { minimum, enabledCount: 0, failures: [...failures, failure("CATALOG_INVALID"), ...(minimum > 0 ? [failure("MINIMUM_ENABLED_MERCHANTS", undefined, `requires ${minimum}, found 0`)] : [])] },
      approvedConfigs
    };
  }

  const catalogById = new Map<string, MerchantCatalog["candidates"][number]>();
  for (const merchant of catalog.candidates) {
    if (catalogById.has(merchant.id)) failures.push(failure("DUPLICATE_CATALOG_MERCHANT", merchant.id));
    catalogById.set(merchant.id, merchant);
  }

  const configFiles = await listConfigFiles(enabledDirectory, enabledDirectoryStatus);
  failures.push(...configFiles.failures);
  const validMerchantIds = new Set<string>();
  const encounteredMerchantIds = new Set<string>();

  for (const file of configFiles.files) {
    let parsed: { merchantId: string; config: MerchantSourceConfigInput };
    try {
      parsed = parseEnabledConfig(parse(await readConfinedFile(file.path)));
    } catch (error: unknown) {
      if (error instanceof UnsupportedSourceTypeError) {
        failures.push(failure("UNSUPPORTED_SOURCE_TYPE", error.merchantId, error.sourceType));
        continue;
      }
      failures.push(failure("CONFIG_INVALID", undefined, file.name));
      continue;
    }
    const merchantId = parsed.merchantId;
    const expectedFile = `${merchantId}.yaml`;
    if (file.name !== expectedFile) failures.push(failure("CONFIG_FILENAME_MISMATCH", merchantId, file.name));
    if (encounteredMerchantIds.has(merchantId)) {
      failures.push(failure("DUPLICATE_MERCHANT_CONFIG", merchantId));
      continue;
    }
    encounteredMerchantIds.add(merchantId);
    const candidate = catalogById.get(merchantId);
    if (candidate === undefined) {
      failures.push(failure("UNKNOWN_MERCHANT_CONFIG", merchantId));
      continue;
    }
    if (!candidate.enabled) {
      failures.push(failure("CATALOG_NOT_ENABLED", merchantId));
      continue;
    }
    if (selectForBuild({ version: 1, candidates: [candidate] }).length !== 1) {
      failures.push(failure("CATALOG_AUDIT_GATE_FAILED", merchantId));
      continue;
    }
    if (!CONFIGURED_SOURCE_TYPES.has(candidate.provenSource!)) {
      failures.push(failure("UNSUPPORTED_SOURCE_TYPE", merchantId, candidate.provenSource));
      continue;
    }
    const hasAffiliate = parsed.config.affiliate !== undefined;
    if (
      (hasAffiliate && candidate.affiliateStatus !== "approved") ||
      (!hasAffiliate && candidate.affiliateStatus !== "normal_link_only")
    ) {
      failures.push(failure("AFFILIATE_STATUS_MISMATCH", merchantId));
      continue;
    }
    let config: MerchantSourceConfig;
    try {
      config = parseMerchantSourceConfig(parsed.config, candidate);
    } catch {
      failures.push(failure("CONFIG_CATALOG_ALIGNMENT_FAILED", merchantId));
      continue;
    }
    const decisionFailures = await validateDecisionFile(decisionsDirectory, decisionsDirectoryStatus, merchantId);
    if (decisionFailures.length > 0) {
      failures.push(...decisionFailures);
      continue;
    }
    validMerchantIds.add(merchantId);
    approvedConfigs.push({ merchantId, candidate, config });
  }

  if (validMerchantIds.size < minimum) {
    failures.push(failure("MINIMUM_ENABLED_MERCHANTS", undefined, `requires ${minimum}, found ${validMerchantIds.size}`));
  }
  return { report: { minimum, enabledCount: validMerchantIds.size, failures }, approvedConfigs };
}

/** Validates only audited, enabled configuration; it never performs merchant network requests. */
export async function validateEnabledMerchants(paths: MerchantGatePaths): Promise<MerchantGateReport> {
  const minimum = paths.minimum ?? 1;
  if (!Number.isInteger(minimum) || minimum < 1 || minimum > 20) {
    throw new Error("minimum must be an integer from 1 through 20");
  }
  return (await inspectEnabledMerchants(paths, minimum)).report;
}

/** Returns an all-or-nothing runtime snapshot of configs that passed the same audit gate. */
export async function loadGateApprovedMerchantConfigs(
  paths: MerchantGatePaths
): Promise<GateApprovedMerchantConfig[]> {
  const inspection = await inspectEnabledMerchants(paths, 0);
  if (inspection.report.failures.length > 0) {
    throw new Error(`merchant configuration gate failed: ${inspection.report.failures
      .map((entry) => [entry.code, entry.merchantId, entry.detail].filter(Boolean).join(":"))
      .join(", ")}`);
  }
  return inspection.approvedConfigs;
}

function parseArguments(arguments_: string[]): MerchantGatePaths {
  const values = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  let minimum = 10;
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (value === undefined) throw new Error("Usage: pnpm merchants:gate -- --minimum <1-20>");
    if (flag !== "--minimum") throw new Error("Usage: pnpm merchants:gate -- --minimum <1-20>");
    minimum = Number(value);
  }
  if (values.length !== 2) throw new Error("Usage: pnpm merchants:gate -- --minimum <1-20>");
  return {
    root: process.cwd(),
    catalogPath: "config/merchants/catalog.yaml",
    enabledDirectory: "config/merchants/enabled",
    decisionsDirectory: "docs/product/merchant-decisions",
    minimum
  };
}

async function main(): Promise<void> {
  const report = await validateEnabledMerchants(parseArguments(process.argv.slice(2)));
  console.log(JSON.stringify(report));
  if (report.failures.length > 0) process.exitCode = 1;
}

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]) &&
  /^validate-enabled-merchants\.(?:[cm]?js|ts)$/u.test(basename(process.argv[1]))
) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
