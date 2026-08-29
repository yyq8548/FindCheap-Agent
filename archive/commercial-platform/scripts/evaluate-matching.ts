import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { evaluateGoldSet, loadGoldSet } from "../packages/test-kit/src/gold-set.js";

const defaultInputPath = fileURLToPath(new URL("../data/gold-set/products.jsonl", import.meta.url));

type Options = {
  inputPath: string;
  minimumExactPrecision: number;
};

const usageError = (message: string): Error => new Error(message);

const parseOptions = (args: string[]): Options => {
  let inputPath = defaultInputPath;
  let minimumExactPrecision = 0;
  let hasInput = false;
  let hasThreshold = false;

  for (const [index, arg] of args.entries()) {
    if (arg === "--" && index === 0) continue;
    if (arg.startsWith("--input=")) {
      if (hasInput) throw usageError("--input may be supplied only once");
      const value = arg.slice("--input=".length);
      if (value.length === 0) throw usageError("--input must name a JSONL file");
      inputPath = resolve(value);
      hasInput = true;
      continue;
    }
    if (arg.startsWith("--min-exact-precision=")) {
      if (hasThreshold) throw usageError("--min-exact-precision may be supplied only once");
      const value = arg.slice("--min-exact-precision=".length);
      const threshold = Number(value);
      if (value.length === 0 || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        throw usageError("--min-exact-precision must be a number from 0 through 1");
      }
      minimumExactPrecision = threshold;
      hasThreshold = true;
      continue;
    }
    throw usageError(`Unrecognized argument: ${arg}`);
  }

  return { inputPath, minimumExactPrecision };
};

const main = async (): Promise<void> => {
  try {
    const options = parseOptions(process.argv.slice(2));
    const report = evaluateGoldSet(await loadGoldSet(options.inputPath));
    console.log(JSON.stringify(report, null, 2));

    if (report.exactPrecision < options.minimumExactPrecision) {
      console.error(
        `exact precision ${report.exactPrecision.toFixed(4)} is below minimum ${options.minimumExactPrecision.toFixed(4)}`
      );
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Unable to evaluate gold set: ${message}`);
    process.exitCode = 2;
  }
};

void main();
