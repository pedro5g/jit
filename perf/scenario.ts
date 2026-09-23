import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { measureIsolatedRatio } from "./harness/measure.js";

const args = process.argv.slice(2);
const assumption = args[0];
if (assumption !== "PERF-ARRAY-001") throw new Error("supported scenario: PERF-ARRAY-001");
const runtimeFlag = args.indexOf("--runtime");
const processesFlag = args.indexOf("--processes");
const samplesFlag = args.indexOf("--samples");
const iterationsFlag = args.indexOf("--iterations");
const length = readNonNegativeInteger(args, "--length", 5);
const elementCost = readChoice(args, "--element-cost", ["trivial", "medium", "high"] as const, "trivial");
const outcome = readChoice(args, "--result", ["success", "fail-first", "fail-middle", "fail-last"] as const, "success");
const runtime = runtimeFlag < 0 ? process.execPath : args[runtimeFlag + 1];
const processes = readPositiveInteger(args, processesFlag, 5);
const samples = readPositiveInteger(args, samplesFlag, 9);
const iterations = readPositiveInteger(args, iterationsFlag, 1000);
if (!runtime) throw new Error("--runtime requires a Node executable path");

const scenarioUrl = pathToFileURL(resolve("perf/scenarios/fixed-array.ts")).href;
const scenario = { length, elementCost, result: outcome };
const measurement = measureIsolatedRatio(
  `array.fixed.validation.${length}.${elementCost}.${outcome}`,
  scenarioUrl,
  "indexed-loop",
  "unrolled",
  { runtime, processes, samples, iterations, warmup: 1000, scenario }
);

console.log(
  JSON.stringify(
    {
      assumption,
      scenario,
      reproductionCommand: `pnpm perf:scenario ${assumption} --runtime ${runtime} --length ${length} --element-cost ${elementCost} --result ${outcome}`,
      measurement,
    },
    null,
    2
  )
);

function readPositiveInteger(args: readonly string[], flagIndex: number, fallback: number): number {
  if (flagIndex < 0) return fallback;
  const value = Number(args[flagIndex + 1]);
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${args[flagIndex]} must be a positive integer`);
  return value;
}

function readNonNegativeInteger(args: readonly string[], flag: string, fallback: number): number {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${flag} must be a non-negative integer`);
  return value;
}

function readChoice<const T extends readonly string[]>(
  args: readonly string[],
  flag: string,
  allowed: T,
  fallback: T[number]
): T[number] {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!allowed.some((choice) => choice === value)) throw new TypeError(`${flag} must be one of ${allowed.join(", ")}`);
  return value as T[number];
}
