import { lstat, readdir, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import {
  MerchantSourceConfigSchema,
  parseMerchantSourceConfig,
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

type ConfigFile = { name: string; path: string };

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

async function listConfigFiles(directory: string): Promise<{ files: ConfigFile[]; failures: MerchantGateFailure[] }> {
  try {
    const stats = await lstat(directory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("enabled directory must be a real directory");
  } catch (error: unknown) {
    if (isMissing(error)) return { files: [], failures: [] };
    return { files: [], failures: [failure("ENABLED_DIRECTORY_INVALID")] };
  }

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
  const headingsValid = REQUIRED_DECISION_HEADINGS.every((heading) =>
    new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "mu").test(markdown)
  );
  if (!/^# Merchant Decision: \S.+$/mu.test(markdown) || !headingsValid) {
    failures.push(failure("DECISION_HEADINGS_INVALID", merchantId));
  }
  const reviewer = /^Reviewer:[ \t]*([^\r\n]*\S)[ \t]*$/mu.exec(markdown)?.[1];
  if (reviewer === undefined) failures.push(failure("DECISION_REVIEWER_INVALID", merchantId));
  const date = /^Date:[ \t]*([^\r\n]*\S)[ \t]*$/mu.exec(markdown)?.[1];
  if (date === undefined || !validDecisionDate(date.trim())) failures.push(failure("DECISION_DATE_INVALID", merchantId));
  return failures;
}

async function validateDecisionFile(decisionsDirectory: string, merchantId: string): Promise<MerchantGateFailure[]> {
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
  const parsed = MerchantSourceConfigSchema.parse(sourceConfig);
  return { merchantId: parsed.merchantId, config: parsed };
}

/** Validates only audited, enabled configuration; it never performs merchant network requests. */
export async function validateEnabledMerchants(paths: MerchantGatePaths): Promise<MerchantGateReport> {
  const minimum = paths.minimum ?? 1;
  if (!Number.isInteger(minimum) || minimum < 1 || minimum > 20) throw new Error("minimum must be an integer from 1 through 20");
  const root = resolve(paths.root);
  const failures: MerchantGateFailure[] = [];
  let catalog: MerchantCatalog;
  try {
    catalog = await loadCatalog(root, paths.catalogPath);
  } catch {
    return { minimum, enabledCount: 0, failures: [failure("CATALOG_INVALID"), failure("MINIMUM_ENABLED_MERCHANTS", undefined, `requires ${minimum}, found 0`)] };
  }

  const catalogById = new Map<string, MerchantCatalog["candidates"][number]>();
  for (const merchant of catalog.candidates) {
    if (catalogById.has(merchant.id)) failures.push(failure("DUPLICATE_CATALOG_MERCHANT", merchant.id));
    catalogById.set(merchant.id, merchant);
  }

  let enabledDirectory: string;
  let decisionsDirectory: string;
  try {
    enabledDirectory = resolveConfined(root, paths.enabledDirectory);
    decisionsDirectory = resolveConfined(root, paths.decisionsDirectory);
  } catch {
    return { minimum, enabledCount: 0, failures: [...failures, failure("GATE_PATH_INVALID"), failure("MINIMUM_ENABLED_MERCHANTS", undefined, `requires ${minimum}, found 0`)] };
  }

  const configFiles = await listConfigFiles(enabledDirectory);
  failures.push(...configFiles.failures);
  const validMerchantIds = new Set<string>();
  const encounteredMerchantIds = new Set<string>();

  for (const file of configFiles.files) {
    let parsed: { merchantId: string; config: MerchantSourceConfigInput };
    try {
      parsed = parseEnabledConfig(parse(await readConfinedFile(file.path)));
    } catch {
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
    try {
      parseMerchantSourceConfig(parsed.config, candidate);
    } catch {
      failures.push(failure("CONFIG_CATALOG_ALIGNMENT_FAILED", merchantId));
      continue;
    }
    const decisionFailures = await validateDecisionFile(decisionsDirectory, merchantId);
    if (decisionFailures.length > 0) {
      failures.push(...decisionFailures);
      continue;
    }
    validMerchantIds.add(merchantId);
  }

  if (validMerchantIds.size < minimum) {
    failures.push(failure("MINIMUM_ENABLED_MERCHANTS", undefined, `requires ${minimum}, found ${validMerchantIds.size}`));
  }
  return { minimum, enabledCount: validMerchantIds.size, failures };
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

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
