import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateGoldSet, parseGoldSetJsonl } from "../src/gold-set.js";

const seedPath = fileURLToPath(new URL("../../../data/gold-set/products.jsonl", import.meta.url));
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const cliPath = join(projectRoot, "scripts", "evaluate-matching.ts");
const tsxCliPath = join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");

const seedCases = async () => parseGoldSetJsonl(await readFile(seedPath, "utf8"));
const runCli = (args: string[]) =>
  spawnSync(process.execPath, [tsxCliPath, cliPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8"
  });

describe("gold set evaluation", () => {
  it("computes exact precision from the seed cases", async () => {
    const report = evaluateGoldSet(await seedCases());

    expect(report.total).toBe(3);
    expect(report.exactPrecision).toBe(1);
    expect(report.coverage).toBe(1);
    expect(report.failures).toEqual([]);
    expect(report.confusion).toEqual({
      EXACT: { EXACT: 1, NEEDS_CONFIRMATION: 0, SIMILAR: 0, INSUFFICIENT: 0 },
      NEEDS_CONFIRMATION: { EXACT: 0, NEEDS_CONFIRMATION: 1, SIMILAR: 0, INSUFFICIENT: 0 },
      SIMILAR: { EXACT: 0, NEEDS_CONFIRMATION: 0, SIMILAR: 1, INSUFFICIENT: 0 },
      INSUFFICIENT: { EXACT: 0, NEEDS_CONFIRMATION: 0, SIMILAR: 0, INSUFFICIENT: 0 }
    });
  });

  it("uses zero exact precision when no case is predicted exact", () => {
    const report = evaluateGoldSet([
      {
        caseId: "no-predicted-exact",
        expected: "INSUFFICIENT",
        canonical: {
          productId: "canonical-1",
          brand: "LG",
          gtins: [],
          title: "LG TV",
          categoryPath: ["Electronics", "Televisions"],
          attributes: [],
          variantDimensions: {}
        },
        candidate: {
          brand: "Samsung",
          gtins: [],
          title: "Samsung TV",
          variantDimensions: {},
          coreSimilarity: 0
        }
      }
    ]);

    expect(report.exactPrecision).toBe(0);
    expect(report.coverage).toBe(0);
  });

  it("rejects JSONL records with unrecognized fields", () => {
    expect(() =>
      parseGoldSetJsonl(
        '{"caseId":"bad","expected":"EXACT","canonical":{},"candidate":{},"unexpected":true}'
      )
    ).toThrow("line 1");
  });

  it("prints JSON metrics and enforces the exact precision gate", async () => {
    const passing = runCli(["--min-exact-precision=0.98"]);
    expect(passing.status).toBe(0);
    expect(JSON.parse(passing.stdout)).toMatchObject({ total: 3, exactPrecision: 1, coverage: 1 });

    const passingViaPnpmSeparator = runCli(["--", "--min-exact-precision=0.98"]);
    expect(passingViaPnpmSeparator.status).toBe(0);

    const fixtureDirectory = await mkdtemp(join(tmpdir(), "gold-set-"));
    const failingInput = join(fixtureDirectory, "failing.jsonl");
    try {
      await writeFile(
        failingInput,
        (await readFile(seedPath, "utf8")).replace('"expected":"EXACT"', '"expected":"SIMILAR"'),
        "utf8"
      );
      const failing = runCli([`--input=${failingInput}`, "--min-exact-precision=0.98"]);
      expect(failing.status).toBe(1);
      expect(JSON.parse(failing.stdout)).toMatchObject({ exactPrecision: 0 });
      expect(failing.stderr).toContain("exact precision 0.0000 is below minimum 0.9800");
    } finally {
      await rm(fixtureDirectory, { force: true, recursive: true });
    }
  });

  it("rejects invalid CLI thresholds and inputs", () => {
    const badThreshold = runCli(["--min-exact-precision=not-a-number"]);
    expect(badThreshold.status).toBe(2);
    expect(badThreshold.stderr).toContain("--min-exact-precision must be a number from 0 through 1");

    const missingInput = runCli(["--input=missing.jsonl"]);
    expect(missingInput.status).toBe(2);
    expect(missingInput.stderr).toContain("Unable to evaluate gold set");
  });
});
