import { readFile } from "node:fs/promises";
import { CanonicalProductSchema, type CanonicalProduct } from "../../contracts/src/index.js";
import { matchProduct, type CandidateProduct } from "../../product-identity/src/index.js";

export const matchStatuses = ["EXACT", "NEEDS_CONFIRMATION", "SIMILAR", "INSUFFICIENT"] as const;

export type MatchStatus = (typeof matchStatuses)[number];

export type GoldCase = {
  caseId: string;
  expected: MatchStatus;
  canonical: CanonicalProduct;
  candidate: CandidateProduct;
};

export type EvaluationFailure = {
  caseId: string;
  expected: MatchStatus;
  actual: MatchStatus;
};

export type ConfusionMatrix = Record<MatchStatus, Record<MatchStatus, number>>;

export type EvaluationReport = {
  total: number;
  exactPrecision: number;
  coverage: number;
  failures: EvaluationFailure[];
  confusion: ConfusionMatrix;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const formatError = (line: number, message: string): Error =>
  new Error(`Invalid gold set line ${line}: ${message}`);

const assertKeys = (
  record: Record<string, unknown>,
  allowed: readonly string[],
  line: number,
  context: string
): void => {
  const unexpected = Object.keys(record).find((key) => !allowed.includes(key));
  if (unexpected) throw formatError(line, `${context} contains unrecognized field \"${unexpected}\"`);
};

const requiredString = (record: Record<string, unknown>, key: string, line: number): string => {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw formatError(line, `${key} must be a non-empty string`);
  }
  return value;
};

const requiredStringArray = (record: Record<string, unknown>, key: string, line: number): string[] => {
  const value = record[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw formatError(line, `${key} must be an array of strings`);
  }
  return value;
};

const requiredStringRecord = (record: Record<string, unknown>, key: string, line: number): Record<string, string> => {
  const value = record[key];
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== "string")) {
    throw formatError(line, `${key} must be an object whose values are strings`);
  }
  return value as Record<string, string>;
};

const requiredSimilarity = (record: Record<string, unknown>, line: number): number => {
  const value = record.coreSimilarity;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw formatError(line, "coreSimilarity must be a number from 0 through 1");
  }
  return value;
};

const parseCandidate = (value: unknown, line: number): CandidateProduct => {
  if (!isRecord(value)) throw formatError(line, "candidate must be an object");
  assertKeys(value, ["brand", "mpn", "gtins", "title", "variantDimensions", "coreSimilarity"], line, "candidate");

  const mpn = value.mpn;
  if (mpn !== undefined && (typeof mpn !== "string" || mpn.length === 0)) {
    throw formatError(line, "candidate.mpn must be a non-empty string when present");
  }

  return {
    brand: requiredString(value, "brand", line),
    gtins: requiredStringArray(value, "gtins", line),
    title: requiredString(value, "title", line),
    variantDimensions: requiredStringRecord(value, "variantDimensions", line),
    coreSimilarity: requiredSimilarity(value, line),
    ...(mpn === undefined ? {} : { mpn })
  };
};

const parseGoldCase = (value: unknown, line: number): GoldCase => {
  if (!isRecord(value)) throw formatError(line, "record must be an object");
  assertKeys(value, ["caseId", "expected", "canonical", "candidate"], line, "record");

  const expected = requiredString(value, "expected", line);
  if (!matchStatuses.includes(expected as MatchStatus)) {
    throw formatError(line, `expected must be one of ${matchStatuses.join(", ")}`);
  }

  const canonical = CanonicalProductSchema.safeParse(value.canonical);
  if (!canonical.success) throw formatError(line, `canonical is invalid: ${canonical.error.issues[0]?.message ?? "unknown error"}`);

  return {
    caseId: requiredString(value, "caseId", line),
    expected: expected as MatchStatus,
    canonical: canonical.data,
    candidate: parseCandidate(value.candidate, line)
  };
};

export const parseGoldSetJsonl = (input: string): GoldCase[] => {
  const lines = input.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();

  return lines.map((line, index) => {
    const lineNumber = index + 1;
    if (line.length === 0) throw formatError(lineNumber, "blank lines are not allowed");
    try {
      return parseGoldCase(JSON.parse(line) as unknown, lineNumber);
    } catch (error) {
      if (error instanceof SyntaxError) throw formatError(lineNumber, "invalid JSON");
      throw error;
    }
  });
};

export const loadGoldSet = async (path: string): Promise<GoldCase[]> =>
  parseGoldSetJsonl(await readFile(path, "utf8"));

const emptyConfusionRow = (): Record<MatchStatus, number> => ({
  EXACT: 0,
  NEEDS_CONFIRMATION: 0,
  SIMILAR: 0,
  INSUFFICIENT: 0
});

export const evaluateGoldSet = (cases: GoldCase[]): EvaluationReport => {
  const confusion: ConfusionMatrix = {
    EXACT: emptyConfusionRow(),
    NEEDS_CONFIRMATION: emptyConfusionRow(),
    SIMILAR: emptyConfusionRow(),
    INSUFFICIENT: emptyConfusionRow()
  };
  const failures: EvaluationFailure[] = [];
  let predictedExact = 0;
  let trueExact = 0;
  let covered = 0;

  for (const item of cases) {
    const actual = matchProduct(item.candidate, item.canonical).status;
    confusion[item.expected][actual] += 1;
    if (actual === "EXACT") {
      predictedExact += 1;
      if (item.expected === "EXACT") trueExact += 1;
    }
    if (actual !== "INSUFFICIENT") covered += 1;
    if (actual !== item.expected) failures.push({ caseId: item.caseId, expected: item.expected, actual });
  }

  return {
    total: cases.length,
    exactPrecision: predictedExact === 0 ? 0 : trueExact / predictedExact,
    coverage: cases.length === 0 ? 0 : covered / cases.length,
    failures,
    confusion
  };
};
